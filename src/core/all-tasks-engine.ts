import type { Block, BlockProperty, BlockRef, DbId } from "../orca.d.ts"
import { getMirrorId, getMirrorIdFromBlock } from "./block-utils"
import { invalidateNextActionEvaluationCache } from "./dependency-engine"
import {
  getTaskPropertiesFromRef,
  normalizeTaskValuesForStatus,
  toTaskMetaPropertyForSave,
  type TaskPropertyValues,
} from "./task-properties"
import { TASK_META_PROPERTY_NAME } from "./task-meta"
import {
  DEFAULT_TASK_SCORE,
  type TaskSchemaDefinition,
} from "./task-schema"
import { createRecurringTaskInTodayJournal } from "./task-recurrence"
import {
  resolveEffectiveNextReview,
  resolveNextReviewAfterMarkReviewed,
  type TaskReviewType,
} from "./task-review"

const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const BOOLEAN_PROP_TYPE = 4

export interface AllTaskItem {
  blockId: DbId
  sourceBlockId: DbId
  parentBlockId: DbId | null
  parentId: DbId | null
  children: DbId[]
  text: string
  status: string
  endTime: Date | null
  reviewEnabled: boolean
  reviewType: TaskReviewType
  nextReview: Date | null
  reviewEvery: string
  lastReviewed: Date | null
  labels: string[]
  star: boolean
  taskTagRef: BlockRef
}

export async function collectAllTasks(
  schema: TaskSchemaDefinition,
): Promise<AllTaskItem[]> {
  const raw = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]
  const taskMap = new Map<DbId, AllTaskItem>()
  const liveBlockByTaskId = new Map<DbId, Block>()
  const blockCacheById = new Map<DbId, Block | null>()
  const taskIdByAliasId = new Map<DbId, DbId>()

  for (const sourceBlock of raw) {
    cacheBlockByKnownIds(sourceBlock, blockCacheById)
    const sourceTaskRef = findTaskTagRef(sourceBlock, schema.tagAlias)
    const liveBlock = getLiveTaskBlock(sourceBlock)
    cacheBlockByKnownIds(liveBlock, blockCacheById)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? sourceTaskRef
    if (taskRef == null) {
      continue
    }

    const blockId = getMirrorIdFromBlock(sourceBlock)
    if (taskMap.has(blockId)) {
      continue
    }

    const values = getTaskPropertiesFromRef(taskRef.data, schema, liveBlock)
    const parentBlockId = liveBlock.parent != null ? getMirrorId(liveBlock.parent) : null
    taskMap.set(blockId, {
      blockId,
      sourceBlockId: sourceBlock.id,
      parentBlockId,
      parentId: null,
      children: [],
      text: resolveTaskText(liveBlock, schema.tagAlias),
      status: values.status,
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
      star: values.star,
      taskTagRef: taskRef,
    })
    liveBlockByTaskId.set(blockId, liveBlock)
    registerTaskAliasIds(taskIdByAliasId, blockId, sourceBlock, liveBlock)
  }

  const taskIds = new Set(taskMap.keys())
  for (const item of taskMap.values()) {
    const liveBlock = liveBlockByTaskId.get(item.blockId) ?? orca.state.blocks[item.blockId]
    item.parentId = await resolveNearestTaskAncestorId(
      item.blockId,
      item.parentBlockId,
      taskIdByAliasId,
      blockCacheById,
    )
    item.children =
      liveBlock != null
        ? collectVisibleChildTaskIds(liveBlock, item.blockId, taskIds)
        : []
  }

  return Array.from(taskMap.values()).sort((left, right) => {
    return left.blockId - right.blockId
  })
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
    const block = await orca.invokeBackend("get-block", blockId) as Block | null
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

function collectVisibleChildTaskIds(
  taskBlock: Block,
  taskId: DbId,
  taskIds: Set<DbId>,
): DbId[] {
  const result: DbId[] = []
  const seen = new Set<DbId>()
  const visited = new Set<DbId>()

  for (const childId of taskBlock.children) {
    collectFirstTaskDescendants(
      getMirrorId(childId),
      taskId,
      taskIds,
      result,
      seen,
      visited,
    )
  }

  return result
}

function collectFirstTaskDescendants(
  blockId: DbId,
  sourceTaskId: DbId,
  taskIds: Set<DbId>,
  result: DbId[],
  seen: Set<DbId>,
  visited: Set<DbId>,
) {
  if (blockId === sourceTaskId || visited.has(blockId)) {
    return
  }

  visited.add(blockId)
  if (taskIds.has(blockId)) {
    if (!seen.has(blockId)) {
      seen.add(blockId)
      result.push(blockId)
    }
    return
  }

  const block = orca.state.blocks[blockId]
  if (block == null) {
    return
  }

  for (const childId of block.children) {
    collectFirstTaskDescendants(
      getMirrorId(childId),
      sourceTaskId,
      taskIds,
      result,
      seen,
      visited,
    )
  }
}

export async function cycleTaskStatusInView(
  blockId: DbId,
  schema: TaskSchemaDefinition,
  taskTagRef?: BlockRef | null,
  sourceBlockId?: DbId | null,
): Promise<void> {
  const targetIds = collectCandidateIds(
    sourceBlockId ?? null,
    getMirrorId(blockId),
    blockId,
  )
  const taskBlock = resolveTaskBlockFromCandidates(targetIds)
  const taskRefFromState = resolveTaskRefFromState(blockId, schema)
  const effectiveTaskRef = taskRefFromState ?? taskTagRef
  const values = getTaskPropertiesFromRef(effectiveTaskRef?.data, schema, taskBlock)
  const nextStatus = getNextStatus(values.status, schema)
  const [, doingStatus] = schema.statusChoices
  const dependsMode =
    values.dependsMode === "ALL" || values.dependsMode === "ANY"
      ? values.dependsMode
      : schema.dependencyModeChoices[0]
  const nextValues = normalizeTaskValuesForStatus({
    ...values,
    status: nextStatus,
    startTime:
      nextStatus === doingStatus && values.startTime == null
        ? new Date()
        : values.startTime,
    endTime: values.endTime,
  }, schema)
  const payload: Array<{ name: string; type?: number; value: unknown }> = [
    { name: schema.propertyNames.status, value: nextValues.status },
    {
      name: schema.propertyNames.startTime,
      type: DATE_TIME_PROP_TYPE,
      value: nextValues.startTime,
    },
    {
      name: schema.propertyNames.endTime,
      type: DATE_TIME_PROP_TYPE,
      value: nextValues.endTime,
    },
    {
      name: schema.propertyNames.dependsMode,
      value: dependsMode,
    },
  ]
  const metaProperty = toTaskMetaPropertyForSave(nextValues, taskBlock)

  if (effectiveTaskRef != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        effectiveTaskRef,
        payload,
      )
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [targetIds[0] ?? blockId],
        [metaProperty],
      )
      await createRecurringTaskInTodayJournal(
        values.status,
        nextValues,
        sourceBlockId ?? blockId,
        schema,
      )
      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      console.error(error)
    }
  }

  let lastError: unknown = null
  for (const targetId of targetIds) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        targetId,
        schema.tagAlias,
        payload,
      )
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [targetId],
        [metaProperty],
      )
      await createRecurringTaskInTodayJournal(
        values.status,
        nextValues,
        sourceBlockId ?? blockId,
        schema,
      )
      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      lastError = error
      console.error(error)
    }
  }

  if (lastError != null) {
    throw lastError
  }
}

export async function toggleTaskStarInView(
  blockId: DbId,
  nextStar: boolean,
  schema: TaskSchemaDefinition,
  taskTagRef?: BlockRef | null,
  sourceBlockId?: DbId | null,
): Promise<void> {
  const payload = [
    {
      name: schema.propertyNames.star,
      type: BOOLEAN_PROP_TYPE,
      value: nextStar,
    },
  ]

  if (taskTagRef != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        taskTagRef,
        payload,
      )
      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      console.error(error)
    }
  }

  const targetIds = [sourceBlockId ?? null, getMirrorId(blockId), blockId]
    .filter((id): id is DbId => id != null && !Number.isNaN(id))
    .filter((id, index, all) => all.indexOf(id) === index)

  let lastError: unknown = null
  for (const targetId of targetIds) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        targetId,
        schema.tagAlias,
        payload,
      )
      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      lastError = error
      console.error(error)
    }
  }

  if (lastError != null) {
    throw lastError
  }
}

export async function markTaskReviewedInView(
  blockId: DbId,
  schema: TaskSchemaDefinition,
  taskTagRef?: BlockRef | null,
  sourceBlockId?: DbId | null,
): Promise<void> {
  const targetIds = collectCandidateIds(
    sourceBlockId ?? null,
    getMirrorId(blockId),
    blockId,
  )
  const taskBlock = resolveTaskBlockFromCandidates(targetIds)
  const taskRefFromState = resolveTaskRefFromState(blockId, schema)
  const effectiveTaskRef = taskRefFromState ?? taskTagRef
  const values = getTaskPropertiesFromRef(effectiveTaskRef?.data, schema, taskBlock)
  const reviewedAt = new Date()
  const nextReview = resolveNextReviewAfterMarkReviewed({
    enabled: values.reviewEnabled,
    type: values.reviewType,
    nextReview: values.nextReview,
    reviewEvery: values.reviewEvery,
    lastReviewed: values.lastReviewed,
  }, reviewedAt)
  const nextValues = {
    ...values,
    nextReview,
    lastReviewed: reviewedAt,
  }
  const metaProperty = toTaskMetaPropertyForSave(nextValues, taskBlock)

  let lastError: unknown = null
  for (const targetId of targetIds) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [targetId],
        [metaProperty],
      )
      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      lastError = error
      console.error(error)
    }
  }

  if (lastError != null) {
    throw lastError
  }
}

export async function addSubtaskInView(
  parentBlockId: DbId,
  schema: TaskSchemaDefinition,
  options?: {
    parentSourceBlockId?: DbId | null
    initialText?: string
  },
): Promise<DbId> {
  const parentCandidateIds = collectCandidateIds(
    getMirrorId(parentBlockId),
    parentBlockId,
    options?.parentSourceBlockId ?? null,
  )

  if (parentCandidateIds.length === 0) {
    throw new Error("No parent block id available for subtask")
  }

  const contentText = typeof options?.initialText === "string"
    ? options.initialText
    : ""
  let lastError: unknown = null

  for (const parentId of parentCandidateIds) {
    try {
      const createdTaskId = await createTaskBlockAsLastChild(
        parentId,
        schema,
        contentText,
      )
      invalidateNextActionEvaluationCache()
      return resolveUsableBlockId(createdTaskId)
    } catch (error) {
      lastError = error
      console.error(error)
    }
  }

  if (lastError != null) {
    throw lastError
  }

  throw new Error("Failed to add subtask")
}

export async function removeTaskTagInView(
  blockId: DbId,
  schema: TaskSchemaDefinition,
  sourceBlockId?: DbId | null,
): Promise<void> {
  const targetIds = collectCandidateIds(
    sourceBlockId ?? null,
    getMirrorId(blockId),
    blockId,
  )

  let lastError: unknown = null
  for (const targetId of targetIds) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.removeTag",
        null,
        targetId,
        schema.tagAlias,
      )

      try {
        await orca.commands.invokeEditorCommand(
          "core.editor.deleteProperties",
          null,
          [targetId],
          [TASK_META_PROPERTY_NAME],
        )
      } catch (error) {
        console.error(error)
      }

      invalidateNextActionEvaluationCache()
      return
    } catch (error) {
      lastError = error
      console.error(error)
    }
  }

  if (lastError != null) {
    throw lastError
  }
}

type MoveTaskPosition = "before" | "after" | "child"

export async function moveTaskInView(
  sourceBlockId: DbId,
  targetBlockId: DbId,
  options: {
    sourceSourceBlockId?: DbId | null
    targetSourceBlockId?: DbId | null
    position: MoveTaskPosition
    moveToTodayJournalRoot?: boolean
  },
): Promise<void> {
  const sourceCandidates = collectCandidateIds(
    options.sourceSourceBlockId ?? null,
    getMirrorId(sourceBlockId),
    sourceBlockId,
  )

  if (sourceCandidates.length === 0) {
    throw new Error("No source block id available for move")
  }

  const position = options.position === "child" ? "lastChild" : options.position
  if (options.moveToTodayJournalRoot) {
    const journalBlock = (await orca.invokeBackend(
      "get-journal-block",
      new Date(),
    )) as Block | null
    if (journalBlock == null) {
      throw new Error("Failed to resolve today journal block")
    }

    let lastError: unknown = null
    for (const sourceId of sourceCandidates) {
      try {
        await orca.commands.invokeEditorCommand(
          "core.editor.moveBlocks",
          null,
          [sourceId],
          journalBlock.id,
          "lastChild",
        )
        invalidateNextActionEvaluationCache()
        return
      } catch (error) {
        lastError = error
        console.error(error)
      }
    }

    if (lastError != null) {
      throw lastError
    }
    return
  }

  const targetCandidates = collectCandidateIds(
    options.targetSourceBlockId ?? null,
    getMirrorId(targetBlockId),
    targetBlockId,
  )

  if (targetCandidates.length === 0) {
    throw new Error("No target block id available for move")
  }

  let lastError: unknown = null
  for (const sourceId of sourceCandidates) {
    for (const targetId of targetCandidates) {
      try {
        await orca.commands.invokeEditorCommand(
          "core.editor.moveBlocks",
          null,
          [sourceId],
          targetId,
          position,
        )
        invalidateNextActionEvaluationCache()
        return
      } catch (error) {
        lastError = error
        console.error(error)
      }
    }
  }

  if (lastError != null) {
    throw lastError
  }
}

async function createTaskBlockAsLastChild(
  parentBlockId: DbId,
  schema: TaskSchemaDefinition,
  contentText: string,
): Promise<DbId> {
  let insertedTaskId: DbId | null = null
  const defaultTaskValues = createDefaultTaskValues(schema)

  await orca.commands.invokeGroup(async () => {
    const createdId = (await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      parentBlockId,
      "lastChild",
      [{ t: "t", v: contentText }],
    )) as DbId
    insertedTaskId = createdId

    await orca.commands.invokeEditorCommand(
      "core.editor.insertTag",
      null,
      createdId,
      schema.tagAlias,
      [
        {
          name: schema.propertyNames.status,
          value: defaultTaskValues.status,
        },
        {
          name: schema.propertyNames.startTime,
          value: defaultTaskValues.startTime,
        },
        {
          name: schema.propertyNames.endTime,
          value: defaultTaskValues.endTime,
        },
        {
          name: schema.propertyNames.dependsMode,
          value: defaultTaskValues.dependsMode,
        },
      ],
    )

    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [createdId],
      [toTaskMetaPropertyForSave(defaultTaskValues)],
    )
  })

  if (insertedTaskId == null) {
    throw new Error("Failed to create subtask block")
  }

  return insertedTaskId
}

function createDefaultTaskValues(schema: TaskSchemaDefinition): TaskPropertyValues {
  const [todoStatus] = schema.statusChoices
  const [defaultDependsMode] = schema.dependencyModeChoices

  return {
    status: todoStatus,
    startTime: null,
    endTime: null,
    reviewEnabled: false,
    reviewType: "single",
    nextReview: null,
    reviewEvery: "",
    lastReviewed: null,
    importance: DEFAULT_TASK_SCORE,
    urgency: DEFAULT_TASK_SCORE,
    effort: DEFAULT_TASK_SCORE,
    star: false,
    repeatRule: "",
    labels: [],
    remark: "",
    dependsOn: [],
    dependsMode: defaultDependsMode,
    dependencyDelay: null,
  }
}

function resolveUsableBlockId(blockId: DbId): DbId {
  const candidateIds = collectCandidateIds(blockId, getMirrorId(blockId))
  for (const candidateId of candidateIds) {
    if (orca.state.blocks[candidateId] != null) {
      return candidateId
    }
  }

  return candidateIds[0] ?? blockId
}

function getLiveTaskBlock(block: Block): Block {
  return orca.state.blocks[getMirrorId(block.id)] ?? block
}

function resolveTaskBlockFromCandidates(candidateIds: DbId[]): Block | null {
  for (const candidateId of candidateIds) {
    const block = orca.state.blocks[candidateId]
    if (block != null) {
      return getLiveTaskBlock(block)
    }
  }

  return null
}

function collectCandidateIds(...candidates: Array<DbId | null | undefined>): DbId[] {
  return candidates
    .filter((id): id is DbId => id != null && !Number.isNaN(id))
    .filter((id, index, all) => all.indexOf(id) === index)
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): BlockRef | null {
  return block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ?? null
}

function resolveTaskRefFromState(
  blockId: DbId,
  schema: TaskSchemaDefinition,
): BlockRef | null {
  const idsToCheck = [getMirrorId(blockId), blockId]
  for (const candidateId of idsToCheck) {
    const block = orca.state.blocks[candidateId]
    if (block == null) {
      continue
    }

    const taskRef = findTaskTagRef(block, schema.tagAlias)
    if (taskRef != null) {
      return taskRef
    }
  }

  return null
}

function getNextStatus(
  currentStatus: string,
  schema: TaskSchemaDefinition,
): string {
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices

  if (currentStatus === todoStatus) {
    return doingStatus
  }
  if (currentStatus === doingStatus) {
    return doneStatus
  }
  if (currentStatus === doneStatus) {
    return todoStatus
  }

  return todoStatus
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
