import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import { getTaskPropertiesFromRef } from "./task-properties"
import type { DependencyMode, TaskSchemaDefinition } from "./task-schema"
import { getMirrorId } from "./block-utils"

const TAG_REF_TYPE = 2

// Next Actions 运行时数据，供视图层直接渲染。
export interface NextActionItem {
  blockId: DbId
  text: string
  status: string
  endTime: Date | null
}

export interface NextActionEvaluation {
  item: NextActionItem
  isNextAction: boolean
  blockedReason: Array<
    | "completed"
    | "canceled"
    | "not-started"
    | "dependency-unmet"
    | "has-open-children"
    | "ancestor-dependency-unmet"
  >
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

export async function collectNextActions(
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): Promise<NextActionItem[]> {
  const taskBlocks = await queryTaskBlocks(schema.tagAlias)
  const taskMap = buildTaskMap(taskBlocks)
  const cycleContext = buildDependencyCycleContext(taskBlocks, taskMap, schema)
  const subtaskContext = buildSubtaskContext(taskBlocks, schema)

  const evaluations = taskBlocks.map((block) => {
    return evaluateNextAction(block, taskMap, schema, now, cycleContext, subtaskContext)
  })

  return evaluations
    .filter((evaluation) => evaluation.isNextAction)
    .sort((left, right) => left.item.blockId - right.item.blockId)
    .map((evaluation) => evaluation.item)
}

export function evaluateNextAction(
  block: Block,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
  cycleContext: DependencyCycleContext | null = null,
  subtaskContext: SubtaskContext | null = null,
): NextActionEvaluation {
  const taskRef = findTaskTagRef(block, schema.tagAlias)
  const status = getTaskStatus(taskRef?.data, schema)

  const blockedReason: NextActionEvaluation["blockedReason"] = []
  if (isDoneStatus(status, schema) || isCanceledStatus(status)) {
    blockedReason.push(isDoneStatus(status, schema) ? "completed" : "canceled")
  }

  const values = getTaskPropertiesFromRef(taskRef?.data, schema)

  if (values.startTime != null && values.startTime.getTime() > now.getTime()) {
    blockedReason.push("not-started")
  }

  if (hasOpenSubtask(block, schema, subtaskContext)) {
    blockedReason.push("has-open-children")
  }

  if (hasAncestorDependencyUnmet(block, taskMap, schema, cycleContext, subtaskContext)) {
    blockedReason.push("ancestor-dependency-unmet")
  }

  if (!isDependencySatisfied(
    block,
    values.dependsOn,
    values.dependsMode,
    taskMap,
    schema,
    cycleContext,
    subtaskContext,
  )) {
    blockedReason.push("dependency-unmet")
  }

  return {
    item: {
      blockId: getMirrorId(block.id),
      text: resolveTaskText(block, schema.tagAlias),
      status,
      endTime: values.endTime,
    },
    isNextAction: blockedReason.length === 0,
    blockedReason,
  }
}

async function queryTaskBlocks(tagAlias: string): Promise<Block[]> {
  const raw = (await orca.invokeBackend("get-blocks-with-tags", [
    tagAlias,
  ])) as Block[]

  return raw.filter((block) => findTaskTagRef(block, tagAlias) != null)
}

function buildTaskMap(blocks: Block[]): Map<DbId, Block> {
  const map = new Map<DbId, Block>()

  for (const block of blocks) {
    map.set(getMirrorId(block.id), block)
    map.set(block.id, block)
  }

  return map
}

function buildSubtaskContext(
  taskBlocks: Block[],
  schema: TaskSchemaDefinition,
): SubtaskContext | null {
  if (taskBlocks.length === 0) {
    return null
  }

  const statusByTaskId = new Map<DbId, string>()
  const childTaskIdsByParentId = new Map<DbId, DbId[]>()
  const parentTaskIdByTaskId = new Map<DbId, DbId | null>()

  for (const block of taskBlocks) {
    const liveBlock = getLiveTaskBlock(block)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }

    const taskId = getMirrorId(liveBlock.id)
    statusByTaskId.set(taskId, getTaskStatus(taskRef.data, schema))
    parentTaskIdByTaskId.set(taskId, null)
  }

  for (const block of taskBlocks) {
    const liveBlock = getLiveTaskBlock(block)
    const taskId = getMirrorId(liveBlock.id)
    const childTaskIds: DbId[] = []

    for (const childId of liveBlock.children.map((item) => getMirrorId(item))) {
      if (childId === taskId) {
        continue
      }
      if (!statusByTaskId.has(childId)) {
        continue
      }
      if (!childTaskIds.includes(childId)) {
        childTaskIds.push(childId)
      }
    }

    childTaskIdsByParentId.set(taskId, childTaskIds)

    const parentId = liveBlock.parent != null ? getMirrorId(liveBlock.parent) : null
    if (parentId != null && parentId !== taskId && statusByTaskId.has(parentId)) {
      parentTaskIdByTaskId.set(taskId, parentId)
    }
  }

  return {
    statusByTaskId,
    childTaskIdsByParentId,
    parentTaskIdByTaskId,
  }
}

function isDependencySatisfied(
  sourceBlock: Block,
  dependsOn: DbId[],
  rawMode: string,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
  cycleContext: DependencyCycleContext | null,
  subtaskContext: SubtaskContext | null,
): boolean {
  if (dependsOn.length === 0) {
    return true
  }

  const sourceBlockInState =
    orca.state.blocks[getMirrorId(sourceBlock.id)] ?? sourceBlock
  const mode = normalizeDependsMode(rawMode)
  const sourceTaskId = getMirrorId(sourceBlockInState.id)
  const completionList = dependsOn.flatMap((dependencyId) => {
    if (isSelfDependencyByRefId(sourceBlockInState, dependencyId, sourceTaskId)) {
      return []
    }

    const dependencyTask = resolveDependencyTask(
      sourceBlockInState,
      dependencyId,
      taskMap,
    )

    if (dependencyTask == null) {
      return [false]
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

    const dependencyRef = findTaskTagRef(dependencyTask, schema.tagAlias)
    const dependencyStatus = subtaskContext?.statusByTaskId.get(dependencyTaskId) ??
      getTaskStatus(dependencyRef?.data, schema)
    return [
      isDoneStatus(dependencyStatus, schema) &&
      !hasOpenSubtaskByTaskId(dependencyTaskId, schema, subtaskContext),
    ]
  })

  if (completionList.length === 0) {
    return true
  }

  return mode === "ANY"
    ? completionList.some((value) => value)
    : completionList.every((value) => value)
}

function hasOpenSubtask(
  sourceBlock: Block,
  schema: TaskSchemaDefinition,
  subtaskContext: SubtaskContext | null,
): boolean {
  return hasOpenSubtaskByTaskId(getMirrorId(sourceBlock.id), schema, subtaskContext)
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
      const ancestorValues = getTaskPropertiesFromRef(ancestorRef?.data, schema)
      if (!isDependencySatisfied(
        ancestorBlock,
        ancestorValues.dependsOn,
        ancestorValues.dependsMode,
        taskMap,
        schema,
        cycleContext,
        subtaskContext,
      )) {
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
    const values = getTaskPropertiesFromRef(taskRef?.data, schema)
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

function normalizeDependsMode(mode: string): DependencyMode {
  return mode === "ANY" ? "ANY" : "ALL"
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): { data?: BlockProperty[] } | null {
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
