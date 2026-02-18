import type { Block, BlockProperty, BlockRef, DbId } from "../orca.d.ts"
import {
  getTaskPropertiesFromRef,
  type TaskPropertyValues,
} from "./task-properties"
import type { DependencyMode, TaskSchemaDefinition } from "./task-schema"
import { getMirrorId, getMirrorIdFromBlock } from "./block-utils"
import {
  calculateTaskScoreFromValues,
  type TaskScoreContext,
} from "./score-engine"
import { resolveEffectiveNextReview, type TaskReviewType } from "./task-review"

const TAG_REF_TYPE = 2
const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * ONE_HOUR_MS
const NEXT_ACTION_CACHE_TTL_MS = 1500

// Next Actions 运行时数据，供视图层直接渲染。
export interface NextActionItem {
  blockId: DbId
  sourceBlockId: DbId
  parentBlockId: DbId | null
  text: string
  status: string
  endTime: Date | null
  reviewEnabled: boolean
  reviewType: TaskReviewType
  nextReview: Date | null
  reviewEvery: string
  lastReviewed: Date | null
  labels: string[]
  score: number
  star: boolean
  parentTaskName: string | null
  taskTagRef: BlockRef | null
  blockProperties: BlockProperty[]
}

export type NextActionBlockedReason =
  | "completed"
  | "canceled"
  | "not-started"
  | "dependency-unmet"
  | "dependency-delayed"
  | "has-open-children"
  | "ancestor-dependency-unmet"

export interface NextActionEvaluation {
  item: NextActionItem
  isNextAction: boolean
  blockedReason: NextActionBlockedReason[]
}

interface CollectNextActionEvaluationsOptions {
  includeCompleted?: boolean
  useCache?: boolean
}

interface DependencyCycleContext {
  componentByTaskId: Map<DbId, number>
  componentSizeById: Map<number, number>
}

interface SubtaskContext {
  statusByTaskId: Map<DbId, string>
  childTaskIdsByParentId: Map<DbId, DbId[]>
  parentTaskIdByTaskId: Map<DbId, DbId | null>
}

interface TaskScoringContext {
  descendantsByTaskId: Map<DbId, number>
  demandByTaskId: Map<DbId, number>
  waitingDaysByTaskId: Map<DbId, number>
}

interface DependencyEvaluationResult {
  satisfied: boolean
  unmet: boolean
  delayed: boolean
}

interface DependencyCompletionState {
  completed: boolean
  completedAtMs: number | null
}

interface NextActionEvaluationCacheEntry {
  key: string
  expiresAtMs: number
  evaluations: NextActionEvaluation[]
}

let nextActionEvaluationCache: NextActionEvaluationCacheEntry | null = null

export async function collectNextActions(
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): Promise<NextActionItem[]> {
  const evaluations = await collectNextActionEvaluations(schema, now)
  return selectNextActionsFromEvaluations(evaluations)
}

export async function collectNextActionEvaluations(
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
  options: CollectNextActionEvaluationsOptions = {},
): Promise<NextActionEvaluation[]> {
  const includeCompleted = options.includeCompleted === true
  const useCache = options.useCache !== false
  const nowMs = now.getTime()
  const cacheKey = buildNextActionCacheKey(schema.tagAlias, nowMs, includeCompleted)
  const cached = useCache ? readNextActionEvaluationCache(cacheKey, nowMs) : null
  if (cached != null) {
    return cached
  }

  const taskBlocks = await queryTaskBlocks(schema.tagAlias)
  const taskMap = buildTaskMap(taskBlocks)
  const cycleContext = buildDependencyCycleContext(taskBlocks, taskMap, schema)
  const subtaskContext = await buildSubtaskContext(taskBlocks, schema)

  const candidateBlocks = includeCompleted
    ? taskBlocks
    : taskBlocks.filter((block) => !isCompletedTaskBlock(block, schema))
  const scoringContext = buildTaskScoringContext(
    candidateBlocks,
    taskMap,
    schema,
    now,
  )
  const evaluations = candidateBlocks.map((block) => {
    return evaluateNextAction(
      block,
      taskMap,
      schema,
      now,
      cycleContext,
      subtaskContext,
      scoringContext,
    )
  })

  const sortedEvaluations = evaluations
    .sort((left, right) => left.item.blockId - right.item.blockId)
  if (useCache) {
    writeNextActionEvaluationCache(cacheKey, sortedEvaluations, nowMs)
  }

  return sortedEvaluations
}

export function selectNextActionsFromEvaluations(
  evaluations: NextActionEvaluation[],
): NextActionItem[] {
  return evaluations
    .filter((evaluation) => evaluation.isNextAction)
    .map((evaluation) => evaluation.item)
    .sort(compareNextActionItems)
}

export function invalidateNextActionEvaluationCache() {
  nextActionEvaluationCache = null
}

export function evaluateNextAction(
  block: Block,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
  cycleContext: DependencyCycleContext | null = null,
  subtaskContext: SubtaskContext | null = null,
  scoringContext: TaskScoringContext | null = null,
): NextActionEvaluation {
  const sourceTaskRef = findTaskTagRef(block, schema.tagAlias)
  const liveTaskBlock = getLiveTaskBlock(block)
  const taskRef = findTaskTagRef(liveTaskBlock, schema.tagAlias) ?? sourceTaskRef
  const status = getTaskStatus(taskRef?.data, schema)
  const taskId = getMirrorIdFromBlock(liveTaskBlock)
  const parentBlockId = liveTaskBlock.parent != null ? getMirrorId(liveTaskBlock.parent) : null

  const blockedReason: NextActionEvaluation["blockedReason"] = []
  if (isDoneStatus(status, schema) || isCanceledStatus(status)) {
    blockedReason.push(isDoneStatus(status, schema) ? "completed" : "canceled")
  }

  const values = getTaskPropertiesFromRef(taskRef?.data, schema, liveTaskBlock)
  const parentTaskName = resolveParentTaskName(taskId, taskMap, schema, subtaskContext)

  if (values.startTime != null && values.startTime.getTime() > now.getTime()) {
    blockedReason.push("not-started")
  }

  if (hasOpenSubtask(block, schema, subtaskContext)) {
    blockedReason.push("has-open-children")
  }

  if (
    hasAncestorDependencyUnmet(
      block,
      taskMap,
      schema,
      cycleContext,
      subtaskContext,
      now,
    )
  ) {
    blockedReason.push("ancestor-dependency-unmet")
  }

  const dependencyResult = evaluateDependencyEligibility(
    block,
    values.dependsOn,
    values.dependsMode,
    values.dependencyDelay,
    taskMap,
    schema,
    cycleContext,
    subtaskContext,
    now,
  )

  if (dependencyResult.unmet) {
    blockedReason.push("dependency-unmet")
  }
  if (dependencyResult.delayed) {
    blockedReason.push("dependency-delayed")
  }

  const score = calculateTaskScoreFromValues(
    values,
    now,
    resolveTaskScoreContext(taskId, scoringContext),
  )
  const forceActiveByReview = values.reviewEnabled

  return {
    item: {
      blockId: taskId,
      sourceBlockId: block.id,
      parentBlockId,
      text: resolveTaskText(liveTaskBlock, schema.tagAlias),
      status,
      endTime: values.endTime,
      reviewEnabled: values.reviewEnabled,
      reviewType: values.reviewType,
      nextReview: resolveEffectiveNextReview({
        enabled: values.reviewEnabled,
        type: values.reviewType,
        nextReview: values.nextReview,
        reviewEvery: values.reviewEvery,
        lastReviewed: values.lastReviewed,
      }),
      reviewEvery: values.reviewEvery,
      lastReviewed: values.lastReviewed,
      labels: values.labels,
      score,
      star: values.star,
      parentTaskName,
      taskTagRef: taskRef,
      blockProperties: collectTaskBlockProperties(liveTaskBlock, block),
    },
    isNextAction: forceActiveByReview || blockedReason.length === 0,
    blockedReason,
  }
}

async function queryTaskBlocks(tagAlias: string): Promise<Block[]> {
  const raw = (await orca.invokeBackend("get-blocks-with-tags", [
    tagAlias,
  ])) as Block[]

  return raw.filter((block) => findTaskTagRef(block, tagAlias) != null)
}

function isCompletedTaskBlock(
  block: Block,
  schema: TaskSchemaDefinition,
): boolean {
  const taskRef = resolveTaskRefFromBlock(block, schema.tagAlias)
  const status = getTaskStatus(taskRef?.data, schema)
  return isDoneStatus(status, schema)
}

function resolveTaskRefFromBlock(
  block: Block,
  tagAlias: string,
): BlockRef | null {
  const liveBlock = getLiveTaskBlock(block)
  return findTaskTagRef(liveBlock, tagAlias) ?? findTaskTagRef(block, tagAlias)
}

function buildTaskMap(blocks: Block[]): Map<DbId, Block> {
  const map = new Map<DbId, Block>()

  for (const block of blocks) {
    map.set(getMirrorIdFromBlock(block), block)
    map.set(getMirrorId(block.id), block)
    map.set(block.id, block)
  }

  return map
}

function buildTaskScoringContext(
  taskBlocks: Block[],
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  now: Date,
): TaskScoringContext | null {
  if (taskBlocks.length === 0) {
    return null
  }

  const dependentsByTaskId = new Map<DbId, Set<DbId>>()
  const waitingDaysByTaskId = new Map<DbId, number>()
  const taskDemandByTaskId = new Map<DbId, number>()
  const valuesByTaskId = new Map<DbId, TaskPropertyValues>()

  for (const block of taskBlocks) {
    const liveTaskBlock = getLiveTaskBlock(block)
    const taskId = getMirrorId(liveTaskBlock.id)
    const sourceTaskRef = findTaskTagRef(block, schema.tagAlias)
    const taskRef = findTaskTagRef(liveTaskBlock, schema.tagAlias) ?? sourceTaskRef
    const values = getTaskPropertiesFromRef(taskRef?.data, schema, liveTaskBlock)

    dependentsByTaskId.set(taskId, new Set<DbId>())
    waitingDaysByTaskId.set(taskId, resolveTaskWaitingDays(liveTaskBlock, now))
    valuesByTaskId.set(taskId, values)
    taskDemandByTaskId.set(taskId, resolveTaskDemand(values))
  }

  for (const block of taskBlocks) {
    const sourceTaskBlock = getLiveTaskBlock(block)
    const sourceTaskId = getMirrorId(sourceTaskBlock.id)
    const values = valuesByTaskId.get(sourceTaskId)
    if (values == null) {
      continue
    }

    for (const dependencyId of values.dependsOn) {
      const dependencyTask = resolveDependencyTask(
        sourceTaskBlock,
        dependencyId,
        taskMap,
      )
      if (dependencyTask == null) {
        continue
      }

      const dependencyTaskId = getMirrorId(dependencyTask.id)
      if (dependencyTaskId === sourceTaskId) {
        continue
      }

      const dependents = dependentsByTaskId.get(dependencyTaskId)
      if (dependents == null) {
        continue
      }

      dependents.add(sourceTaskId)
    }
  }

  const descendantsByTaskId = new Map<DbId, number>()
  const demandByTaskId = new Map<DbId, number>()
  for (const [taskId, dependents] of dependentsByTaskId.entries()) {
    const descendantCount = countReachableDependents(taskId, dependentsByTaskId)
    const normalizedDescendants = normalizeDescendantCount(descendantCount)
    const dependencyDemand = resolveDependencyDemandScore(
      dependents,
      taskDemandByTaskId,
    )
    descendantsByTaskId.set(taskId, normalizedDescendants)
    demandByTaskId.set(taskId, dependencyDemand)
  }

  return {
    descendantsByTaskId,
    demandByTaskId,
    waitingDaysByTaskId,
  }
}

function countReachableDependents(
  taskId: DbId,
  dependentsByTaskId: Map<DbId, Set<DbId>>,
): number {
  const visited = new Set<DbId>()
  const stack = [...(dependentsByTaskId.get(taskId) ?? [])]

  while (stack.length > 0) {
    const dependentTaskId = stack.pop() as DbId
    if (dependentTaskId === taskId) {
      continue
    }
    if (visited.has(dependentTaskId)) {
      continue
    }
    visited.add(dependentTaskId)

    const childDependents = dependentsByTaskId.get(dependentTaskId)
    if (childDependents == null || childDependents.size === 0) {
      continue
    }

    for (const childTaskId of childDependents) {
      if (!visited.has(childTaskId)) {
        stack.push(childTaskId)
      }
    }
  }

  return visited.size
}

function resolveTaskDemand(values: TaskPropertyValues): number {
  const importance = normalizeDemandValue(values.importance)
  const urgency = normalizeDemandValue(values.urgency)
  const weightedDemand = importance * 0.6 + urgency * 0.4
  return clampRatio((weightedDemand - 0.5) * 2)
}

function normalizeDemandValue(value: number | null): number {
  if (value == null || Number.isNaN(value)) {
    return 0.5
  }

  if (value <= 0) {
    return 0
  }
  if (value >= 100) {
    return 1
  }

  return value / 100
}

function resolveDependencyDemandScore(
  dependents: Set<DbId>,
  taskDemandByTaskId: Map<DbId, number>,
): number {
  let demandScore = 0

  for (const dependentTaskId of dependents) {
    demandScore = Math.max(demandScore, taskDemandByTaskId.get(dependentTaskId) ?? 0)
  }

  return clampRatio(demandScore)
}

function normalizeDescendantCount(descendantCount: number): number {
  if (descendantCount <= 0) {
    return 0
  }

  return clampRatio(1 - Math.exp(-descendantCount / 2))
}

function resolveTaskWaitingDays(taskBlock: Block, now: Date): number {
  const modifiedAtMs = normalizeDateTimeToTimestamp(taskBlock.modified)
  const createdAtMs = normalizeDateTimeToTimestamp(taskBlock.created)
  const anchorMs = modifiedAtMs ?? createdAtMs
  if (anchorMs == null) {
    return 0
  }

  const ageMs = now.getTime() - anchorMs
  if (ageMs <= 0) {
    return 0
  }

  return ageMs / ONE_DAY_MS
}

function resolveTaskScoreContext(
  taskId: DbId,
  scoringContext: TaskScoringContext | null,
): TaskScoreContext {
  if (scoringContext == null) {
    return {}
  }

  return {
    dependencyDescendants: scoringContext.descendantsByTaskId.get(taskId) ?? 0,
    dependencyDemand: scoringContext.demandByTaskId.get(taskId) ?? 0,
    waitingDays: scoringContext.waitingDaysByTaskId.get(taskId) ?? 0,
  }
}

async function buildSubtaskContext(
  taskBlocks: Block[],
  schema: TaskSchemaDefinition,
): Promise<SubtaskContext | null> {
  if (taskBlocks.length === 0) {
    return null
  }

  const statusByTaskId = new Map<DbId, string>()
  const childTaskIdsByParentId = new Map<DbId, DbId[]>()
  const parentTaskIdByTaskId = new Map<DbId, DbId | null>()
  const parentBlockIdByTaskId = new Map<DbId, DbId | null>()
  const taskIdByAliasId = new Map<DbId, DbId>()
  const blockCacheById = new Map<DbId, Block | null>()

  for (const block of taskBlocks) {
    cacheBlockByKnownIds(block, blockCacheById)
    const liveBlock = getLiveTaskBlock(block)
    cacheBlockByKnownIds(liveBlock, blockCacheById)
    const sourceTaskRef = findTaskTagRef(block, schema.tagAlias)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? sourceTaskRef
    if (taskRef == null) {
      continue
    }

    const taskId = getMirrorIdFromBlock(liveBlock)
    const parentBlockId = liveBlock.parent != null ? getMirrorId(liveBlock.parent) : null
    statusByTaskId.set(taskId, getTaskStatus(taskRef.data, schema))
    parentTaskIdByTaskId.set(taskId, null)
    parentBlockIdByTaskId.set(taskId, parentBlockId)
    registerTaskAliasIds(taskIdByAliasId, taskId, block, liveBlock)
    childTaskIdsByParentId.set(taskId, [])
  }

  for (const [taskId, parentBlockId] of parentBlockIdByTaskId.entries()) {
    const parentTaskId = await resolveNearestTaskAncestorId(
      taskId,
      parentBlockId,
      taskIdByAliasId,
      blockCacheById,
    )
    parentTaskIdByTaskId.set(taskId, parentTaskId)

    if (parentTaskId == null || parentTaskId === taskId) {
      continue
    }
    if (!statusByTaskId.has(parentTaskId)) {
      continue
    }

    const childTaskIds = childTaskIdsByParentId.get(parentTaskId) ?? []
    if (!childTaskIds.includes(taskId)) {
      childTaskIds.push(taskId)
    }
    childTaskIdsByParentId.set(parentTaskId, childTaskIds)
  }

  return {
    statusByTaskId,
    childTaskIdsByParentId,
    parentTaskIdByTaskId,
  }
}

async function resolveNearestTaskAncestorId(
  taskId: DbId,
  parentBlockId: DbId | null,
  taskIdByAliasId: Map<DbId, DbId>,
  blockCacheById: Map<DbId, Block | null>,
): Promise<DbId | null> {
  const visited = new Set<DbId>()
  let currentId = parentBlockId

  while (currentId != null) {
    if (currentId === taskId || visited.has(currentId)) {
      return null
    }

    const currentTaskId = taskIdByAliasId.get(currentId)
    if (currentTaskId != null) {
      if (currentTaskId === taskId) {
        return null
      }
      return currentTaskId
    }

    visited.add(currentId)
    const block = await getBlockByIdWithCache(currentId, blockCacheById)
    const resolvedByBlock = block != null
      ? resolveTaskIdByBlock(block, taskIdByAliasId)
      : null
    if (resolvedByBlock != null) {
      if (resolvedByBlock === taskId) {
        return null
      }
      return resolvedByBlock
    }

    if (block?.parent == null) {
      return null
    }

    currentId = block.parent
  }

  return null
}

function registerTaskAliasIds(
  taskIdByAliasId: Map<DbId, DbId>,
  taskId: DbId,
  sourceBlock: Block,
  liveBlock: Block,
) {
  const aliasIds = [
    taskId,
    sourceBlock.id,
    liveBlock.id,
    getMirrorIdFromBlock(sourceBlock),
    getMirrorIdFromBlock(liveBlock),
    getMirrorId(sourceBlock.id),
    getMirrorId(liveBlock.id),
  ]

  for (const aliasId of aliasIds) {
    if (aliasId == null || taskIdByAliasId.has(aliasId)) {
      continue
    }

    taskIdByAliasId.set(aliasId, taskId)
  }
}

function resolveTaskIdByBlock(
  block: Block,
  taskIdByAliasId: Map<DbId, DbId>,
): DbId | null {
  const candidateIds = [block.id, getMirrorIdFromBlock(block), getMirrorId(block.id)]
  for (const candidateId of candidateIds) {
    const taskId = taskIdByAliasId.get(candidateId)
    if (taskId != null) {
      return taskId
    }
  }

  return null
}

async function getBlockByIdWithCache(
  blockId: DbId,
  blockCacheById: Map<DbId, Block | null>,
): Promise<Block | null> {
  if (blockCacheById.has(blockId)) {
    return blockCacheById.get(blockId) ?? null
  }

  const stateBlock = orca.state.blocks[blockId]
  if (stateBlock != null) {
    cacheBlockByKnownIds(stateBlock, blockCacheById)
    return stateBlock
  }

  try {
    const block = (await orca.invokeBackend("get-block", blockId)) as Block | null
    if (block != null) {
      cacheBlockByKnownIds(block, blockCacheById)
      return block
    }
  } catch (error) {
    console.error(error)
  }

  blockCacheById.set(blockId, null)
  return null
}

function cacheBlockByKnownIds(
  block: Block,
  blockCacheById: Map<DbId, Block | null>,
) {
  const aliasIds = [block.id, getMirrorIdFromBlock(block), getMirrorId(block.id)]
  for (const aliasId of aliasIds) {
    if (aliasId == null) {
      continue
    }

    blockCacheById.set(aliasId, block)
  }
}

function evaluateDependencyEligibility(
  sourceBlock: Block,
  dependsOn: DbId[],
  rawMode: string,
  rawDelayHours: number | null,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  cycleContext: DependencyCycleContext | null,
  subtaskContext: SubtaskContext | null,
  now: Date,
): DependencyEvaluationResult {
  if (dependsOn.length === 0) {
    return {
      satisfied: true,
      unmet: false,
      delayed: false,
    }
  }

  const sourceBlockInState =
    orca.state.blocks[getMirrorId(sourceBlock.id)] ?? sourceBlock
  const mode = normalizeDependsMode(rawMode)
  const delayHours = normalizeDependencyDelayHours(rawDelayHours)
  const sourceTaskId = getMirrorId(sourceBlockInState.id)
  const completionStates = dependsOn.flatMap((dependencyId) => {
    if (isSelfDependencyByRefId(sourceBlockInState, dependencyId, sourceTaskId)) {
      return []
    }

    const dependencyTask = resolveDependencyTask(
      sourceBlockInState,
      dependencyId,
      taskMap,
    )

    if (dependencyTask == null) {
      return [{ completed: false, completedAtMs: null }]
    }

    // 自依赖无效：忽略该条依赖，避免任务被永久阻塞。
    const dependencyTaskId = getMirrorId(dependencyTask.id)
    if (dependencyTaskId === sourceTaskId) {
      return []
    }

    // 循环依赖中的内部边不参与阻塞判定，避免 A<->B 等死锁。
    if (isDependencyInCycle(sourceTaskId, dependencyTaskId, cycleContext)) {
      return []
    }

    const liveDependencyTask = getLiveTaskBlock(dependencyTask)
    const dependencyRef = findTaskTagRef(liveDependencyTask, schema.tagAlias)
    const dependencyStatus = subtaskContext?.statusByTaskId.get(dependencyTaskId) ??
      getTaskStatus(dependencyRef?.data, schema)
    const completed = isDoneStatus(dependencyStatus, schema) &&
      !hasOpenSubtaskByTaskId(dependencyTaskId, schema, subtaskContext)
    return [
      {
        completed,
        completedAtMs: completed ? resolveTaskCompletionTimestamp(liveDependencyTask) : null,
      } satisfies DependencyCompletionState,
    ]
  })

  if (completionStates.length === 0) {
    return {
      satisfied: true,
      unmet: false,
      delayed: false,
    }
  }

  const satisfiedByCompletion = mode === "ANY"
    ? completionStates.some((item) => item.completed)
    : completionStates.every((item) => item.completed)

  if (!satisfiedByCompletion) {
    return {
      satisfied: false,
      unmet: true,
      delayed: false,
    }
  }

  if (delayHours <= 0) {
    return {
      satisfied: true,
      unmet: false,
      delayed: false,
    }
  }

  const completedAtMsList = completionStates
    .filter((item) => item.completed)
    .map((item) => item.completedAtMs)
    .filter((value): value is number => value != null && !Number.isNaN(value))

  if (completedAtMsList.length === 0) {
    return {
      satisfied: true,
      unmet: false,
      delayed: false,
    }
  }

  const anchorCompletedAtMs = mode === "ANY"
    ? Math.min(...completedAtMsList)
    : Math.max(...completedAtMsList)
  const unlockAtMs = anchorCompletedAtMs + delayHours * ONE_HOUR_MS

  if (now.getTime() >= unlockAtMs) {
    return {
      satisfied: true,
      unmet: false,
      delayed: false,
    }
  }

  return {
    satisfied: false,
    unmet: false,
    delayed: true,
  }
}

function hasOpenSubtask(
  sourceBlock: Block,
  schema: TaskSchemaDefinition,
  subtaskContext: SubtaskContext | null,
): boolean {
  return hasOpenSubtaskByTaskId(getMirrorId(sourceBlock.id), schema, subtaskContext)
}

function resolveParentTaskName(
  taskId: DbId,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  subtaskContext: SubtaskContext | null,
): string | null {
  if (subtaskContext == null) {
    return null
  }

  const parentTaskId = subtaskContext.parentTaskIdByTaskId.get(taskId) ?? null
  if (parentTaskId == null) {
    return null
  }

  const parentTask = taskMap.get(parentTaskId) ?? orca.state.blocks[parentTaskId]
  if (parentTask == null) {
    return null
  }

  return resolveTaskText(getLiveTaskBlock(parentTask), schema.tagAlias)
}

function hasOpenSubtaskByTaskId(
  taskId: DbId,
  schema: TaskSchemaDefinition,
  subtaskContext: SubtaskContext | null,
): boolean {
  if (subtaskContext == null) {
    return false
  }

  const directChildren = subtaskContext.childTaskIdsByParentId.get(taskId) ?? []
  if (directChildren.length === 0) {
    return false
  }

  const queue = [...directChildren]
  const visited = new Set<DbId>()

  while (queue.length > 0) {
    const childTaskId = queue.shift() as DbId
    if (visited.has(childTaskId)) {
      continue
    }
    visited.add(childTaskId)

    const status = subtaskContext.statusByTaskId.get(childTaskId)
    if (status != null && !isDoneStatus(status, schema) && !isCanceledStatus(status)) {
      return true
    }

    const grandChildren = subtaskContext.childTaskIdsByParentId.get(childTaskId) ?? []
    for (const grandChildId of grandChildren) {
      if (!visited.has(grandChildId)) {
        queue.push(grandChildId)
      }
    }
  }

  return false
}

function hasAncestorDependencyUnmet(
  sourceBlock: Block,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  cycleContext: DependencyCycleContext | null,
  subtaskContext: SubtaskContext | null,
  now: Date,
): boolean {
  if (subtaskContext == null) {
    return false
  }

  const sourceTaskId = getMirrorId(sourceBlock.id)
  const visited = new Set<DbId>([sourceTaskId])
  let ancestorTaskId = subtaskContext.parentTaskIdByTaskId.get(sourceTaskId) ?? null

  while (ancestorTaskId != null) {
    if (visited.has(ancestorTaskId)) {
      break
    }
    visited.add(ancestorTaskId)

    const ancestorBlock = taskMap.get(ancestorTaskId) ?? orca.state.blocks[ancestorTaskId]
    if (ancestorBlock != null) {
      const ancestorRef = findTaskTagRef(ancestorBlock, schema.tagAlias)
      const ancestorValues = getTaskPropertiesFromRef(
        ancestorRef?.data,
        schema,
        getLiveTaskBlock(ancestorBlock),
      )
      const dependencyResult = evaluateDependencyEligibility(
        ancestorBlock,
        ancestorValues.dependsOn,
        ancestorValues.dependsMode,
        ancestorValues.dependencyDelay,
        taskMap,
        schema,
        cycleContext,
        subtaskContext,
        now,
      )
      if (!dependencyResult.satisfied) {
        return true
      }
    }

    ancestorTaskId = subtaskContext.parentTaskIdByTaskId.get(ancestorTaskId) ?? null
  }

  return false
}

function isSelfDependencyByRefId(
  sourceBlock: Block,
  dependencyId: DbId,
  sourceTaskId: DbId,
): boolean {
  const matchedRef = sourceBlock.refs.find((item) => item.id === dependencyId)
  if (matchedRef == null) {
    return false
  }

  return getMirrorId(matchedRef.to) === sourceTaskId
}

function resolveDependencyTask(
  sourceBlock: Block,
  dependencyId: DbId,
  taskMap: Map<DbId, Block>,
): Block | null {
  // 优先按 ref ID 解析：dependsOn 常见存储是 ref ID，避免与块 ID 偶发冲突误判。
  const ref = sourceBlock.refs.find((item) => item.id === dependencyId)
  if (ref != null) {
    const taskByRef = taskMap.get(getMirrorId(ref.to)) ?? taskMap.get(ref.to)
    if (taskByRef != null) {
      return taskByRef
    }
  }

  // 回退兼容直接存块 ID 的情况。
  const targetId = getMirrorId(dependencyId)
  const taskByBlockId = taskMap.get(targetId) ?? taskMap.get(dependencyId)
  return taskByBlockId ?? null
}

function buildDependencyCycleContext(
  taskBlocks: Block[],
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
): DependencyCycleContext | null {
  if (taskBlocks.length === 0) {
    return null
  }

  const adjacency = new Map<DbId, DbId[]>()

  for (const block of taskBlocks) {
    const sourceBlock = getLiveTaskBlock(block)
    const sourceId = getMirrorId(sourceBlock.id)
    const taskRef = findTaskTagRef(sourceBlock, schema.tagAlias)
    const values = getTaskPropertiesFromRef(taskRef?.data, schema, sourceBlock)
    const edges: DbId[] = []

    for (const dependencyId of values.dependsOn) {
      const dependencyTask = resolveDependencyTask(sourceBlock, dependencyId, taskMap)
      if (dependencyTask == null) {
        continue
      }

      const targetId = getMirrorId(dependencyTask.id)
      if (!edges.includes(targetId)) {
        edges.push(targetId)
      }
    }

    adjacency.set(sourceId, edges)
  }

  // Tarjan SCC
  const indexById = new Map<DbId, number>()
  const lowById = new Map<DbId, number>()
  const onStack = new Set<DbId>()
  const stack: DbId[] = []
  let index = 0
  let componentId = 0
  const componentByTaskId = new Map<DbId, number>()
  const componentSizeById = new Map<number, number>()

  const strongConnect = (taskId: DbId) => {
    indexById.set(taskId, index)
    lowById.set(taskId, index)
    index += 1
    stack.push(taskId)
    onStack.add(taskId)

    const neighbors = adjacency.get(taskId) ?? []
    for (const neighbor of neighbors) {
      if (!indexById.has(neighbor)) {
        strongConnect(neighbor)
        const nextLow = Math.min(
          lowById.get(taskId) ?? Number.MAX_SAFE_INTEGER,
          lowById.get(neighbor) ?? Number.MAX_SAFE_INTEGER,
        )
        lowById.set(taskId, nextLow)
      } else if (onStack.has(neighbor)) {
        const nextLow = Math.min(
          lowById.get(taskId) ?? Number.MAX_SAFE_INTEGER,
          indexById.get(neighbor) ?? Number.MAX_SAFE_INTEGER,
        )
        lowById.set(taskId, nextLow)
      }
    }

    if (lowById.get(taskId) !== indexById.get(taskId)) {
      return
    }

    let size = 0
    while (stack.length > 0) {
      const member = stack.pop() as DbId
      onStack.delete(member)
      componentByTaskId.set(member, componentId)
      size += 1

      if (member === taskId) {
        break
      }
    }

    componentSizeById.set(componentId, size)
    componentId += 1
  }

  for (const taskId of adjacency.keys()) {
    if (!indexById.has(taskId)) {
      strongConnect(taskId)
    }
  }

  return {
    componentByTaskId,
    componentSizeById,
  }
}

function isDependencyInCycle(
  sourceTaskId: DbId,
  dependencyTaskId: DbId,
  cycleContext: DependencyCycleContext | null,
): boolean {
  if (cycleContext == null) {
    return false
  }

  const sourceComponent = cycleContext.componentByTaskId.get(sourceTaskId)
  const dependencyComponent = cycleContext.componentByTaskId.get(dependencyTaskId)
  if (sourceComponent == null || dependencyComponent == null) {
    return false
  }
  if (sourceComponent !== dependencyComponent) {
    return false
  }

  return (cycleContext.componentSizeById.get(sourceComponent) ?? 0) > 1
}

function getLiveTaskBlock(block: Block): Block {
  return orca.state.blocks[getMirrorId(block.id)] ?? block
}

function collectTaskBlockProperties(...blocks: Block[]): BlockProperty[] {
  const merged: BlockProperty[] = []
  const seen = new Set<string>()

  for (const block of blocks) {
    if (!Array.isArray(block.properties)) {
      continue
    }

    for (const property of block.properties) {
      const name = typeof property.name === "string"
        ? property.name.replace(/\s+/g, " ").trim()
        : ""
      if (name === "") {
        continue
      }

      const dedupKey = `${name.toLowerCase()}::${property.type}`
      if (seen.has(dedupKey)) {
        continue
      }

      seen.add(dedupKey)
      merged.push({
        ...property,
        name,
      })
    }
  }

  return merged
}

function normalizeDependsMode(mode: string): DependencyMode {
  return mode === "ANY" ? "ANY" : "ALL"
}

function normalizeDependencyDelayHours(rawDelayHours: number | null): number {
  if (rawDelayHours == null || Number.isNaN(rawDelayHours)) {
    return 0
  }

  return rawDelayHours > 0 ? rawDelayHours : 0
}

function resolveTaskCompletionTimestamp(taskBlock: Block): number | null {
  // 当前无“完成时间”专用字段，使用 modified 近似表示完成时刻，回退到 created。
  const modifiedAt = normalizeDateTimeToTimestamp(taskBlock.modified)
  if (modifiedAt != null) {
    return modifiedAt
  }

  return normalizeDateTimeToTimestamp(taskBlock.created)
}

function normalizeDateTimeToTimestamp(
  value: Date | string | number | undefined,
): number | null {
  if (value == null) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  const timestamp = date.getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function compareNextActionItems(left: NextActionItem, right: NextActionItem): number {
  const leftOverdue = isOverdueTask(left.endTime)
  const rightOverdue = isOverdueTask(right.endTime)
  if (leftOverdue !== rightOverdue) {
    return leftOverdue ? -1 : 1
  }

  if (left.score !== right.score) {
    return right.score - left.score
  }

  const leftDueTime = normalizeDueTime(left.endTime)
  const rightDueTime = normalizeDueTime(right.endTime)
  if (leftDueTime !== rightDueTime) {
    return leftDueTime - rightDueTime
  }

  return left.blockId - right.blockId
}

function buildNextActionCacheKey(
  tagAlias: string,
  nowMs: number,
  includeCompleted: boolean,
): string {
  const nowBucket = Math.floor(nowMs / NEXT_ACTION_CACHE_TTL_MS)
  return `${tagAlias}|${includeCompleted ? 1 : 0}|${nowBucket}`
}

function readNextActionEvaluationCache(
  key: string,
  nowMs: number,
): NextActionEvaluation[] | null {
  if (nextActionEvaluationCache == null) {
    return null
  }

  if (nextActionEvaluationCache.key !== key) {
    return null
  }

  if (nextActionEvaluationCache.expiresAtMs < nowMs) {
    nextActionEvaluationCache = null
    return null
  }

  return nextActionEvaluationCache.evaluations
}

function writeNextActionEvaluationCache(
  key: string,
  evaluations: NextActionEvaluation[],
  nowMs: number,
) {
  nextActionEvaluationCache = {
    key,
    expiresAtMs: nowMs + NEXT_ACTION_CACHE_TTL_MS,
    evaluations,
  }
}

function normalizeDueTime(endTime: Date | null): number {
  if (endTime == null) {
    return Number.POSITIVE_INFINITY
  }

  const timestamp = endTime.getTime()
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

function isOverdueTask(endTime: Date | null): boolean {
  if (endTime == null) {
    return false
  }

  const dueTime = endTime.getTime()
  if (Number.isNaN(dueTime)) {
    return false
  }

  return dueTime < Date.now()
}

function clampRatio(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }

  return value
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): BlockRef | null {
  const taskRef = block.refs.find((ref) => {
    return ref.type === TAG_REF_TYPE && ref.alias === tagAlias
  })

  return taskRef ?? null
}

function getTaskStatus(
  refData: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
): string {
  return getTaskPropertiesFromRef(refData, schema).status
}

function isDoneStatus(status: string, schema: TaskSchemaDefinition): boolean {
  return status === schema.statusChoices[2]
}

function isCanceledStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "已取消" ||
    normalized === "取消"
  )
}

function resolveTaskText(block: Block, tagAlias: string): string {
  if (typeof block.text === "string" && block.text.trim() !== "") {
    const normalized = stripTaskTagFromText(block.text, tagAlias)
    return normalized === "" ? "(无标题任务)" : normalized
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return "(无标题任务)"
  }

  const text = block.content
    .map((fragment) => (typeof fragment.v === "string" ? fragment.v : ""))
    .join("")
    .trim()

  const normalized = stripTaskTagFromText(text, tagAlias)
  return normalized === "" ? "(无标题任务)" : normalized
}

function stripTaskTagFromText(text: string, tagAlias: string): string {
  if (text.trim() === "") {
    return ""
  }

  const escapedAlias = tagAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const normalized = text
    .replace(
      new RegExp(`(^|[\\s,，;；、])#${escapedAlias}(?=[\\s,，;；、]|$)`, "gi"),
      " ",
    )
    .replace(/(^|[\s,，;；、])#[^\s#,，;；、]+(?=[\s,，;；、]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized
}
