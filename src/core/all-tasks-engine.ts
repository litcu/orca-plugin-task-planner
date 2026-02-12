import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import { getMirrorId } from "./block-utils"
import { getTaskPropertiesFromRef } from "./task-properties"
import type { TaskSchemaDefinition } from "./task-schema"

const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5

export interface AllTaskItem {
  blockId: DbId
  parentId: DbId | null
  children: DbId[]
  text: string
  status: string
}

export async function collectAllTasks(
  schema: TaskSchemaDefinition,
): Promise<AllTaskItem[]> {
  const raw = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]
  const taskMap = new Map<DbId, AllTaskItem>()

  for (const sourceBlock of raw) {
    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }

    const blockId = getMirrorId(liveBlock.id)
    if (taskMap.has(blockId)) {
      continue
    }

    const values = getTaskPropertiesFromRef(taskRef.data, schema)
    taskMap.set(blockId, {
      blockId,
      parentId: liveBlock.parent != null ? getMirrorId(liveBlock.parent) : null,
      children: liveBlock.children.map((childId) => getMirrorId(childId)),
      text: resolveTaskText(liveBlock),
      status: values.status,
    })
  }

  return Array.from(taskMap.values()).sort((left, right) => {
    return left.blockId - right.blockId
  })
}

export async function cycleTaskStatusInView(
  blockId: DbId,
  schema: TaskSchemaDefinition,
): Promise<void> {
  const targetId = getMirrorId(blockId)
  const block = orca.state.blocks[targetId]
  if (block == null) {
    return
  }

  const taskRef = findTaskTagRef(block, schema.tagAlias)
  if (taskRef == null) {
    return
  }

  const values = getTaskPropertiesFromRef(taskRef.data, schema)
  const nextStatus = getNextStatus(values.status, schema)
  const [, doingStatus] = schema.statusChoices
  const dependsMode =
    values.dependsMode === "ALL" || values.dependsMode === "ANY"
      ? values.dependsMode
      : schema.dependencyModeChoices[0]

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    targetId,
    schema.tagAlias,
    [
      { name: schema.propertyNames.status, value: nextStatus },
      {
        name: schema.propertyNames.startTime,
        type: DATE_TIME_PROP_TYPE,
        value:
          nextStatus === doingStatus && values.startTime == null
            ? new Date()
            : values.startTime,
      },
      {
        name: schema.propertyNames.endTime,
        type: DATE_TIME_PROP_TYPE,
        value: values.endTime,
      },
      {
        name: schema.propertyNames.dependsMode,
        value: dependsMode,
      },
    ],
  )
}

function getLiveTaskBlock(block: Block): Block {
  return orca.state.blocks[getMirrorId(block.id)] ?? block
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): { data?: BlockProperty[] } | null {
  return (
    block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ??
    null
  )
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
