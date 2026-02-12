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
}

export interface NextActionEvaluation {
  item: NextActionItem
  isNextAction: boolean
  blockedReason: Array<"completed" | "canceled" | "not-started" | "dependency-unmet">
}

export async function collectNextActions(
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): Promise<NextActionItem[]> {
  const taskBlocks = await queryTaskBlocks(schema.tagAlias)
  const taskMap = buildTaskMap(taskBlocks)

  const evaluations = taskBlocks.map((block) => {
    return evaluateNextAction(block, taskMap, schema, now)
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

  if (!isDependencySatisfied(values.dependsOn, values.dependsMode, taskMap, schema)) {
    blockedReason.push("dependency-unmet")
  }

  return {
    item: {
      blockId: getMirrorId(block.id),
      text: resolveTaskText(block),
      status,
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

function isDependencySatisfied(
  dependsOn: DbId[],
  rawMode: string,
  taskMap: Map<DbId, Block>,
  schema: TaskSchemaDefinition,
): boolean {
  if (dependsOn.length === 0) {
    return true
  }

  const mode = normalizeDependsMode(rawMode)
  const completionList = dependsOn.map((dependencyId) => {
    const targetId = getMirrorId(dependencyId)
    const dependencyTask = taskMap.get(targetId)

    if (dependencyTask == null) {
      return false
    }

    const dependencyRef = findTaskTagRef(dependencyTask, schema.tagAlias)
    const dependencyStatus = getTaskStatus(dependencyRef?.data, schema)
    return isDoneStatus(dependencyStatus, schema)
  })

  return mode === "ANY"
    ? completionList.some((value) => value)
    : completionList.every((value) => value)
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

function resolveTaskText(block: Block): string {
  if (typeof block.text === "string" && block.text.trim() !== "") {
    return block.text.trim()
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return "(无标题任务)"
  }

  const text = block.content
    .map((fragment) => (typeof fragment.v === "string" ? fragment.v : ""))
    .join("")
    .trim()

  return text === "" ? "(无标题任务)" : text
}
