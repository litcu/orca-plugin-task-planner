import type { Block, BlockRef, DbId } from "../orca.d.ts"
import { getMirrorId, isValidDbId } from "./block-utils"
import { invalidateNextActionEvaluationCache } from "./dependency-engine"
import {
  getTaskPropertiesFromRef,
  toRefDataForSave,
  toTaskMetaPropertyForSave,
  type TaskPropertyValues,
} from "./task-properties"
import type { TaskSchemaDefinition } from "./task-schema"
import { buildNextRecurringTaskValues } from "./task-repeat"

const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5

interface DescendantTaskTarget {
  blockId: DbId
  taskRef: BlockRef
}

export async function createRecurringTaskInTodayJournal(
  previousStatus: string,
  nextValues: TaskPropertyValues,
  sourceBlockId: DbId,
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): Promise<boolean> {
  const recurringValues = buildNextRecurringTaskValues(
    previousStatus,
    nextValues,
    schema,
    now,
  )
  if (recurringValues == null) {
    return false
  }

  const sourceTaskId = getMirrorId(sourceBlockId)
  if (!isValidDbId(sourceTaskId)) {
    return false
  }

  const blockCacheById = new Map<DbId, Block | null>()

  try {
    await orca.commands.invokeGroup(async () => {
      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        sourceTaskId,
        schema.tagAlias,
        toRefDataForSave(recurringValues, schema),
      )
      const sourceBlock = orca.state.blocks[sourceTaskId] ?? null
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [sourceTaskId],
        [toTaskMetaPropertyForSave(recurringValues, sourceBlock)],
      )

      await reopenDescendantTasks(
        sourceTaskId,
        nextValues,
        recurringValues,
        schema,
        blockCacheById,
      )
    })
    invalidateNextActionEvaluationCache()
    return true
  } catch (error) {
    console.error(error)
    return false
  }
}

async function reopenDescendantTasks(
  sourceTaskId: DbId,
  previousParentValues: TaskPropertyValues,
  nextParentValues: TaskPropertyValues,
  schema: TaskSchemaDefinition,
  blockCacheById: Map<DbId, Block | null>,
) {
  const descendants = await collectDescendantTaskTargets(
    sourceTaskId,
    schema.tagAlias,
    blockCacheById,
  )
  if (descendants.length === 0) {
    return
  }

  const [todoStatus] = schema.statusChoices
  const dateShiftMs = resolveDateShiftMs(previousParentValues, nextParentValues)

  for (const descendant of descendants) {
    const descendantValues = getTaskPropertiesFromRef(descendant.taskRef.data, schema)
    await orca.commands.invokeEditorCommand(
      "core.editor.insertTag",
      null,
      descendant.blockId,
      schema.tagAlias,
      [
        { name: schema.propertyNames.status, value: todoStatus },
        {
          name: schema.propertyNames.startTime,
          type: DATE_TIME_PROP_TYPE,
          value: shiftDateByMs(descendantValues.startTime, dateShiftMs),
        },
        {
          name: schema.propertyNames.endTime,
          type: DATE_TIME_PROP_TYPE,
          value: shiftDateByMs(descendantValues.endTime, dateShiftMs),
        },
      ],
    )
  }
}

async function collectDescendantTaskTargets(
  rootBlockId: DbId,
  tagAlias: string,
  blockCacheById: Map<DbId, Block | null>,
): Promise<DescendantTaskTarget[]> {
  const rootBlock = await getBlockByIdWithCache(rootBlockId, blockCacheById)
  if (rootBlock == null) {
    return []
  }

  const targets: DescendantTaskTarget[] = []
  const seenTargetIds = new Set<DbId>()
  const visitedBlockIds = new Set<DbId>([getMirrorId(rootBlockId)])
  const queue = [...rootBlock.children]

  while (queue.length > 0) {
    const rawId = queue.shift()
    if (!isValidDbId(rawId)) {
      continue
    }

    const currentId = getMirrorId(rawId)
    if (!isValidDbId(currentId)) {
      continue
    }

    if (visitedBlockIds.has(currentId)) {
      continue
    }
    visitedBlockIds.add(currentId)

    const rawBlock = await getBlockByIdWithCache(currentId, blockCacheById)
    if (rawBlock == null) {
      continue
    }
    const block = getLiveBlock(rawBlock)
    const blockId = getMirrorId(block.id)
    const taskRef = findTaskTagRef(block, tagAlias) ?? findTaskTagRef(rawBlock, tagAlias)

    if (taskRef != null && !seenTargetIds.has(blockId)) {
      seenTargetIds.add(blockId)
      targets.push({
        blockId,
        taskRef,
      })
    }

    for (const childId of block.children) {
      if (isValidDbId(childId)) {
        queue.push(childId)
      }
    }
  }

  return targets
}

async function getBlockByIdWithCache(
  blockId: DbId,
  blockCacheById: Map<DbId, Block | null>,
): Promise<Block | null> {
  const normalizedId = getMirrorId(blockId)
  if (!isValidDbId(normalizedId)) {
    return null
  }

  if (blockCacheById.has(normalizedId)) {
    return blockCacheById.get(normalizedId) ?? null
  }

  const stateBlock =
    orca.state.blocks[normalizedId] ??
    orca.state.blocks[blockId] ??
    null
  if (stateBlock != null) {
    cacheBlockByKnownIds(stateBlock, blockCacheById)
    return stateBlock
  }

  try {
    const block = (await orca.invokeBackend("get-block", normalizedId)) as Block | null
    if (block != null) {
      cacheBlockByKnownIds(block, blockCacheById)
      return block
    }
  } catch (error) {
    console.error(error)
  }

  blockCacheById.set(normalizedId, null)
  return null
}

function getLiveBlock(block: Block): Block {
  return orca.state.blocks[getMirrorId(block.id)] ?? block
}

function cacheBlockByKnownIds(
  block: Block,
  blockCacheById: Map<DbId, Block | null>,
) {
  const aliasIds = [block.id, getMirrorId(block.id)]
  for (const aliasId of aliasIds) {
    if (isValidDbId(aliasId)) {
      blockCacheById.set(aliasId, block)
    }
  }
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): BlockRef | null {
  return block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ?? null
}

function resolveDateShiftMs(
  previousParentValues: TaskPropertyValues,
  nextParentValues: TaskPropertyValues,
): number | null {
  const shiftByStart = resolveDateDelta(
    previousParentValues.startTime,
    nextParentValues.startTime,
  )
  if (shiftByStart != null) {
    return shiftByStart
  }

  return resolveDateDelta(
    previousParentValues.endTime,
    nextParentValues.endTime,
  )
}

function resolveDateDelta(
  previousDate: Date | null,
  nextDate: Date | null,
): number | null {
  const previousMs = toTimestamp(previousDate)
  const nextMs = toTimestamp(nextDate)
  if (previousMs == null || nextMs == null) {
    return null
  }

  return nextMs - previousMs
}

function shiftDateByMs(
  value: Date | null,
  shiftMs: number | null,
): Date | null {
  if (shiftMs == null) {
    return value
  }

  const currentMs = toTimestamp(value)
  if (currentMs == null) {
    return null
  }

  return new Date(currentMs + shiftMs)
}

function toTimestamp(value: Date | null): number | null {
  if (!(value instanceof Date)) {
    return null
  }

  const timestamp = value.getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}
