import type { Block, BlockProperty, BlockRef, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import {
  dedupeDbIds,
  getMirrorId,
  getMirrorIdFromBlock,
  isValidDbId,
} from "./block-utils"
import {
  getDefaultTaskStatus,
  getTaskStatusValues,
  isTaskDoneStatus,
  isTaskWaitingStatus,
  type TaskSchemaDefinition,
} from "./task-schema"
import { getTaskPropertiesFromRef } from "./task-properties"

const PROP_TYPE_JSON = 0
const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const TASK_TIMER_SCHEMA_VERSION = 1
const POMODORO_DURATION_MS = 25 * 60 * 1000

export const TASK_TIMER_PROPERTY_NAME = "_mlo_task_timer"

export type TaskTimerMode = "direct" | "pomodoro"

export interface TaskTimerData {
  schema: number
  elapsedMs: number
  running: boolean
  startedAt: number | null
}

interface ResolvedTaskBlock {
  writableBlockId: DbId
  sourceBlock: Block
  liveBlock: Block
  taskId: DbId
}

export function createDefaultTaskTimerData(): TaskTimerData {
  return {
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: 0,
    running: false,
    startedAt: null,
  }
}

export function readTaskTimerFromProperties(
  properties: BlockProperty[] | null | undefined,
): TaskTimerData {
  const property = properties?.find((item) => item.name === TASK_TIMER_PROPERTY_NAME)
  return normalizeTaskTimerData(property?.value)
}

export function readTaskTimerFromBlock(
  block: Block | null | undefined,
): TaskTimerData {
  return readTaskTimerFromProperties(block?.properties)
}

export function toTaskTimerProperty(
  timer: TaskTimerData,
  existingProperty?: BlockProperty,
): BlockProperty {
  return {
    name: TASK_TIMER_PROPERTY_NAME,
    type: PROP_TYPE_JSON,
    value: normalizeTaskTimerData(timer),
    pos: existingProperty?.pos,
  }
}

export function hasTaskTimerRecord(timer: TaskTimerData): boolean {
  return timer.elapsedMs > 0 || timer.running || timer.startedAt != null
}

export function resolveTaskTimerElapsedMs(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): number {
  if (!timer.running || timer.startedAt == null) {
    return timer.elapsedMs
  }

  const delta = nowMs - timer.startedAt
  if (!Number.isFinite(delta) || Number.isNaN(delta) || delta <= 0) {
    return timer.elapsedMs
  }

  return timer.elapsedMs + delta
}

export function formatTaskTimerDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const hourText = hours < 100 ? String(hours).padStart(2, "0") : String(hours)

  return `${hourText}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function resolveTaskPomodoroProgress(elapsedMs: number): {
  cycle: number
  cycleElapsedMs: number
  cycleRemainingMs: number
  completedCycles: number
} {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs))
  const completedCycles = Math.floor(safeElapsedMs / POMODORO_DURATION_MS)
  const cycleElapsedMs = safeElapsedMs % POMODORO_DURATION_MS
  const cycleRemainingMs =
    cycleElapsedMs === 0
      ? POMODORO_DURATION_MS
      : POMODORO_DURATION_MS - cycleElapsedMs

  return {
    cycle: completedCycles + 1,
    cycleElapsedMs,
    cycleRemainingMs,
    completedCycles,
  }
}

export async function startTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const status = resolveTaskStatusFromBlock(target.liveBlock, options.schema)
  if (isTaskCompletedStatus(status, options.schema)) {
    throw new Error(t("Completed task cannot start timer"))
  }

  await promoteTaskStatusToDoingIfNeeded(target, options.schema)

  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (currentTimer.running) {
    return currentTimer
  }

  await stopAllRunningTaskTimers(options.schema, target.taskId, nowMs)

  const nextTimer: TaskTimerData = {
    ...currentTimer,
    running: true,
    startedAt: nowMs,
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function stopTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  const nextTimer = finalizeRunningTaskTimer(currentTimer, nowMs)
  if (nextTimer.running === currentTimer.running && nextTimer.elapsedMs === currentTimer.elapsedMs) {
    return nextTimer
  }

  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function checkpointRunningTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!currentTimer.running || currentTimer.startedAt == null) {
    return currentTimer
  }

  const nextTimer: TaskTimerData = {
    ...currentTimer,
    elapsedMs: resolveTaskTimerElapsedMs(currentTimer, nowMs),
    running: true,
    startedAt: nowMs,
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function stopAllRunningTaskTimers(
  schema: TaskSchemaDefinition,
  exceptTaskId?: DbId | null,
  nowMs: number = Date.now(),
): Promise<number> {
  const taskBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]

  const normalizedExceptId = isValidDbId(exceptTaskId) ? getMirrorId(exceptTaskId) : null
  let stoppedCount = 0

  for (const sourceBlock of taskBlocks) {
    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }

    const taskId = getMirrorIdFromBlock(liveBlock)
    if (normalizedExceptId != null && taskId === normalizedExceptId) {
      continue
    }

    const timer = readTaskTimerFromSourceAndLiveBlocks(sourceBlock, liveBlock)
    if (!timer.running) {
      continue
    }

    const writableBlockId = await resolveWritableBlockId([
      getMirrorIdFromBlock(liveBlock),
      liveBlock.id,
      taskId,
      sourceBlock.id,
      getMirrorId(sourceBlock.id),
      getMirrorId(liveBlock.id),
    ])
    if (writableBlockId == null) {
      continue
    }

    const target: ResolvedTaskBlock = {
      writableBlockId,
      sourceBlock,
      liveBlock,
      taskId,
    }

    await saveTaskTimer(schema, target, finalizeRunningTaskTimer(timer, nowMs))
    stoppedCount += 1
  }

  return stoppedCount
}

export async function checkpointAllRunningTaskTimers(
  schema: TaskSchemaDefinition,
  nowMs: number = Date.now(),
): Promise<number> {
  const taskBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]
  let checkpointedCount = 0
  const seenTaskIds = new Set<DbId>()

  for (const sourceBlock of taskBlocks) {
    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }

    const taskId = getMirrorIdFromBlock(liveBlock)
    if (seenTaskIds.has(taskId)) {
      continue
    }
    seenTaskIds.add(taskId)

    const timer = readTaskTimerFromSourceAndLiveBlocks(sourceBlock, liveBlock)
    if (!timer.running || timer.startedAt == null) {
      continue
    }

    const writableBlockId = await resolveWritableBlockId([
      getMirrorIdFromBlock(liveBlock),
      liveBlock.id,
      taskId,
      sourceBlock.id,
      getMirrorId(sourceBlock.id),
      getMirrorId(liveBlock.id),
    ])
    if (writableBlockId == null) {
      continue
    }

    const target: ResolvedTaskBlock = {
      writableBlockId,
      sourceBlock,
      liveBlock,
      taskId,
    }

    const nextTimer: TaskTimerData = {
      ...timer,
      elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
      running: true,
      startedAt: nowMs,
    }
    await saveTaskTimer(schema, target, nextTimer)
    checkpointedCount += 1
  }

  return checkpointedCount
}

export async function applyTaskTimerForStatusChange(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  previousStatus: string
  nextStatus: string
  autoStartOnDoing: boolean
}): Promise<void> {
  if (isTaskCompletedStatus(options.nextStatus, options.schema)) {
    await stopTaskTimer({
      blockId: options.blockId,
      sourceBlockId: options.sourceBlockId,
      schema: options.schema,
    })
    return
  }

  if (isTaskWaitingStatus(options.nextStatus, options.schema)) {
    await stopTaskTimer({
      blockId: options.blockId,
      sourceBlockId: options.sourceBlockId,
      schema: options.schema,
    })
    return
  }

  const { doing: doingStatus } = getTaskStatusValues(options.schema)
  if (
    options.autoStartOnDoing &&
    options.nextStatus === doingStatus &&
    options.previousStatus !== doingStatus
  ) {
    await startTaskTimer({
      blockId: options.blockId,
      sourceBlockId: options.sourceBlockId,
      schema: options.schema,
    })
  }
}

export function resolveTaskStatusFromBlock(
  block: Block,
  schema: TaskSchemaDefinition,
): string {
  const taskRef = findTaskTagRef(getLiveTaskBlock(block), schema.tagAlias) ??
    findTaskTagRef(block, schema.tagAlias)
  return readTaskStatusFromRefData(taskRef?.data, schema)
}

function normalizeTaskTimerData(raw: unknown): TaskTimerData {
  const fallback = createDefaultTaskTimerData()
  if (!isRecord(raw)) {
    return fallback
  }

  const running = raw.running === true
  const startedAt = normalizeTimestamp(raw.startedAt)

  return {
    schema: normalizePositiveInt(raw.schema, TASK_TIMER_SCHEMA_VERSION),
    elapsedMs: normalizeElapsedMs(raw.elapsedMs),
    running: running && startedAt != null,
    startedAt: running && startedAt != null ? startedAt : null,
  }
}

function normalizeElapsedMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return 0
  }

  return Math.floor(parsed)
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null
  }

  return Math.floor(parsed)
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : fallback
}

function normalizeNowMs(rawNowMs?: number): number {
  if (rawNowMs == null || Number.isNaN(rawNowMs) || !Number.isFinite(rawNowMs)) {
    return Date.now()
  }

  return Math.floor(rawNowMs)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function readTaskTimerFromSourceAndLiveBlocks(
  sourceBlock: Block,
  liveBlock: Block,
): TaskTimerData {
  const liveProperty = liveBlock.properties?.find((item) => item.name === TASK_TIMER_PROPERTY_NAME)
  if (liveProperty != null) {
    return normalizeTaskTimerData(liveProperty.value)
  }

  const sourceProperty = sourceBlock.properties?.find((item) => item.name === TASK_TIMER_PROPERTY_NAME)
  if (sourceProperty != null) {
    return normalizeTaskTimerData(sourceProperty.value)
  }

  return createDefaultTaskTimerData()
}

function finalizeRunningTaskTimer(
  timer: TaskTimerData,
  nowMs: number,
): TaskTimerData {
  return {
    ...timer,
    elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
    running: false,
    startedAt: null,
  }
}

async function promoteTaskStatusToDoingIfNeeded(
  target: ResolvedTaskBlock,
  schema: TaskSchemaDefinition,
): Promise<void> {
  const taskRef = findTaskTagRef(target.liveBlock, schema.tagAlias) ??
    findTaskTagRef(target.sourceBlock, schema.tagAlias)
  const values = getTaskPropertiesFromRef(taskRef?.data, schema, target.liveBlock)
  const { todo: todoStatus, waiting: waitingStatus, doing: doingStatus } =
    getTaskStatusValues(schema)
  if (values.status !== todoStatus && values.status !== waitingStatus) {
    return
  }

  const payload: Array<{ name: string; type?: number; value: unknown }> = [
    { name: schema.propertyNames.status, value: doingStatus },
  ]
  if (values.startTime == null) {
    payload.push({
      name: schema.propertyNames.startTime,
      type: DATE_TIME_PROP_TYPE,
      value: new Date(),
    })
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    target.writableBlockId,
    schema.tagAlias,
    payload,
  )
}

async function saveTaskTimer(
  _schema: TaskSchemaDefinition,
  target: ResolvedTaskBlock,
  timer: TaskTimerData,
): Promise<void> {
  const existingProperty = target.liveBlock.properties?.find((item) => item.name === TASK_TIMER_PROPERTY_NAME) ??
    target.sourceBlock.properties?.find((item) => item.name === TASK_TIMER_PROPERTY_NAME)

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [target.writableBlockId],
    [toTaskTimerProperty(timer, existingProperty)],
  )
}

async function resolveTaskBlock(
  blockId: DbId,
  sourceBlockId: DbId | null | undefined,
  schema: TaskSchemaDefinition,
): Promise<ResolvedTaskBlock> {
  const candidates = dedupeDbIds([
    sourceBlockId,
    sourceBlockId == null ? null : getMirrorId(sourceBlockId),
    getMirrorId(blockId),
    blockId,
  ])

  for (const candidateId of candidates) {
    const sourceBlock = await resolveBlockById(candidateId)
    if (sourceBlock == null) {
      continue
    }

    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef =
      findTaskTagRef(liveBlock, schema.tagAlias) ??
      findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }

    const writableBlockId = await resolveWritableBlockId([
      getMirrorIdFromBlock(liveBlock),
      liveBlock.id,
      getMirrorId(sourceBlock.id),
      sourceBlock.id,
      candidateId,
    ])
    if (writableBlockId == null) {
      continue
    }

    return {
      writableBlockId,
      sourceBlock,
      liveBlock,
      taskId: getMirrorIdFromBlock(liveBlock),
    }
  }

  throw new Error(t("Current block is not a task"))
}

async function resolveWritableBlockId(
  candidates: Array<DbId | null | undefined>,
): Promise<DbId | null> {
  const uniqueIds = dedupeDbIds(candidates)
  for (const candidateId of uniqueIds) {
    if (orca.state.blocks[candidateId] != null) {
      return candidateId
    }

    try {
      const block = (await orca.invokeBackend("get-block", candidateId)) as Block | null
      if (block != null) {
        return candidateId
      }
    } catch (error) {
      console.error(error)
    }
  }

  return uniqueIds[0] ?? null
}

async function resolveBlockById(blockId: DbId): Promise<Block | null> {
  const stateBlock = orca.state.blocks[blockId]
  if (stateBlock != null) {
    return stateBlock
  }

  try {
    const block = (await orca.invokeBackend("get-block", blockId)) as Block | null
    return block
  } catch (error) {
    console.error(error)
    return null
  }
}

function getLiveTaskBlock(block: Block): Block {
  return orca.state.blocks[getMirrorId(block.id)] ?? block
}

function findTaskTagRef(
  block: Block,
  tagAlias: string,
): BlockRef | null {
  return block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ?? null
}

function readTaskStatusFromRefData(
  refData: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
): string {
  const property = refData?.find((item) => item.name === schema.propertyNames.status)
  return typeof property?.value === "string" ? property.value : getDefaultTaskStatus(schema)
}

function isTaskCompletedStatus(
  status: string,
  schema: TaskSchemaDefinition,
): boolean {
  return isTaskDoneStatus(status, schema)
}
