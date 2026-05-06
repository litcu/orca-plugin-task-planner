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
import { getTaskPropertiesFromRef, mergeTaskRefData } from "./task-properties"
import { hasProjectTagRef } from "./project-schema"

const PROP_TYPE_JSON = 0
const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const TEXT_CHOICES_PROP_TYPE = 6
const TASK_TIMER_SCHEMA_VERSION = 2
const POMODORO_DURATION_MS = 25 * 60 * 1000
const SHORT_BREAK_DURATION_MS = 5 * 60 * 1000
const LONG_BREAK_DURATION_MS = 15 * 60 * 1000
const POMODOROS_BEFORE_LONG_BREAK = 4

export const TASK_TIMER_PROPERTY_NAME = "_mlo_task_timer"
export const TASK_TIMER_EVENT_NAME = "mlo:task-timer-change"

export type TaskTimerMode = "direct" | "pomodoro"
export type TaskTimerPhase = "idle" | "focus" | "short-break" | "long-break" | "paused"

export interface TaskTimerSessionLogEntry {
  startedAt: number
  endedAt: number
  durationMs: number
  mode: TaskTimerMode
  phase: Exclude<TaskTimerPhase, "idle" | "paused">
  completed: boolean
}

export interface TaskTimerData {
  schema: number
  elapsedMs: number
  totalFocusMs: number
  completedPomodoros: number
  running: boolean
  startedAt: number | null
  sessionId: string | null
  activeMode: TaskTimerMode
  activePhase: TaskTimerPhase
  phaseDurationMs: number | null
  pausedPhase: Exclude<TaskTimerPhase, "idle" | "paused"> | null
  pausedRemainingMs: number | null
  sessionLog: TaskTimerSessionLogEntry[]
}

interface ResolvedTaskBlock {
  writableBlockId: DbId
  sourceBlock: Block
  liveBlock: Block
  taskId: DbId
}

interface RunningTaskTimerIndexEntry {
  taskId: DbId
  sourceBlockId: DbId | null
}

let runningTaskTimerIndex: RunningTaskTimerIndexEntry | null = null

export function createDefaultTaskTimerData(): TaskTimerData {
  return {
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: 0,
    totalFocusMs: 0,
    completedPomodoros: 0,
    running: false,
    startedAt: null,
    sessionId: null,
    activeMode: "direct",
    activePhase: "idle",
    phaseDurationMs: null,
    pausedPhase: null,
    pausedRemainingMs: null,
    sessionLog: [],
  }
}

export interface TaskTimerChangeEventDetail {
  taskId: DbId
  sourceBlockId: DbId
  running: boolean
  activePhase: TaskTimerPhase
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
  return timer.elapsedMs > 0 ||
    timer.totalFocusMs > 0 ||
    timer.completedPomodoros > 0 ||
    timer.running ||
    timer.startedAt != null ||
    timer.activePhase !== "idle"
}

export function finalizeStaleRunningTaskTimer(timer: TaskTimerData): TaskTimerData {
  if (!timer.running) {
    return timer
  }

  return {
    ...timer,
    running: false,
    startedAt: null,
    sessionId: null,
    activePhase: "idle",
    phaseDurationMs: null,
    pausedPhase: null,
    pausedRemainingMs: null,
  }
}

export function resolveTaskTimerElapsedMs(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): number {
  if (!timer.running || timer.startedAt == null || !doesPhaseCountAsFocus(timer.activePhase)) {
    return timer.elapsedMs
  }

  const delta = nowMs - timer.startedAt
  if (!Number.isFinite(delta) || Number.isNaN(delta) || delta <= 0) {
    return timer.elapsedMs
  }

  return timer.elapsedMs + delta
}

export function resolveTaskTimerPhaseElapsedMs(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): number {
  if (!timer.running || timer.startedAt == null) {
    if (timer.activePhase === "paused" && timer.pausedRemainingMs != null && timer.phaseDurationMs != null) {
      return Math.max(0, timer.phaseDurationMs - timer.pausedRemainingMs)
    }
    return 0
  }

  const delta = nowMs - timer.startedAt
  if (!Number.isFinite(delta) || Number.isNaN(delta) || delta <= 0) {
    return 0
  }

  return Math.floor(delta)
}

export function resolveTaskTimerPhaseRemainingMs(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): number | null {
  if (timer.activePhase === "paused") {
    return timer.pausedRemainingMs
  }

  if (!timer.running || timer.phaseDurationMs == null) {
    return null
  }

  return Math.max(0, timer.phaseDurationMs - resolveTaskTimerPhaseElapsedMs(timer, nowMs))
}

export function isTaskTimerPomodoroPhaseComplete(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): boolean {
  if (
    !timer.running ||
    timer.activeMode !== "pomodoro" ||
    timer.startedAt == null ||
    timer.phaseDurationMs == null ||
    timer.activePhase === "idle" ||
    timer.activePhase === "paused"
  ) {
    return false
  }

  return resolveTaskTimerPhaseElapsedMs(timer, nowMs) >= timer.phaseDurationMs
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

export function getTaskTimerDefaultPhaseDurationMs(
  phase: TaskTimerPhase,
  completedPomodoros: number = 0,
): number | null {
  switch (phase) {
    case "focus":
      return POMODORO_DURATION_MS
    case "short-break":
      return SHORT_BREAK_DURATION_MS
    case "long-break":
      return LONG_BREAK_DURATION_MS
    case "paused":
    case "idle":
      return null
  }
}

export function resolveNextPomodoroBreakPhase(completedPomodoros: number): "short-break" | "long-break" {
  return completedPomodoros > 0 && completedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0
    ? "long-break"
    : "short-break"
}

export async function startTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  mode?: TaskTimerMode
  sessionId?: string | null
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
    updateRunningTaskTimerIndex(target, currentTimer)
    return currentTimer
  }

  await stopAllRunningTaskTimers(options.schema, target.taskId, nowMs)

  const mode = options.mode ?? currentTimer.activeMode
  const activePhase: TaskTimerPhase =
    mode === "pomodoro" &&
      currentTimer.activePhase === "paused" &&
      currentTimer.pausedPhase != null
      ? currentTimer.pausedPhase
      : "focus"
  const phaseDurationMs = mode === "pomodoro"
    ? currentTimer.activePhase === "paused" && currentTimer.pausedRemainingMs != null
      ? currentTimer.pausedRemainingMs
      : getTaskTimerDefaultPhaseDurationMs(activePhase, currentTimer.completedPomodoros)
    : null
  const nextTimer: TaskTimerData = {
    ...currentTimer,
    running: true,
    startedAt: nowMs,
    sessionId: normalizeSessionId(options.sessionId),
    activeMode: mode,
    activePhase,
    phaseDurationMs,
    pausedPhase: null,
    pausedRemainingMs: null,
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
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
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return nextTimer
}

export async function pauseTaskTimer(options: {
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

  const remainingMs = resolveTaskTimerPhaseRemainingMs(currentTimer, nowMs)
  const nextTimer = finalizeRunningTaskTimer(currentTimer, nowMs, {
    nextPhase: "paused",
    pausedPhase: currentTimer.activeMode === "pomodoro"
      ? currentTimer.activePhase === "paused" || currentTimer.activePhase === "idle"
        ? "focus"
        : currentTimer.activePhase
      : null,
    pausedRemainingMs: currentTimer.activeMode === "pomodoro" ? remainingMs : null,
    completed: false,
  })
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return nextTimer
}

export async function switchTaskTimerPhase(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  phase: Exclude<TaskTimerPhase, "idle" | "paused">
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  const finalizedTimer = finalizeRunningTaskTimer(currentTimer, nowMs, {
    nextPhase: "idle",
    completed: false,
  })
  const nextTimer: TaskTimerData = {
    ...finalizedTimer,
    running: true,
    startedAt: nowMs,
    activeMode: "pomodoro",
    activePhase: options.phase,
    phaseDurationMs: getTaskTimerDefaultPhaseDurationMs(options.phase, finalizedTimer.completedPomodoros),
    pausedPhase: null,
    pausedRemainingMs: null,
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return nextTimer
}

export async function completeTaskTimerPomodoroPhase(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  continueTo?: Exclude<TaskTimerPhase, "idle" | "paused"> | "idle"
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!isTaskTimerPomodoroPhaseComplete(currentTimer, nowMs)) {
    return currentTimer
  }

  const completedTimer = finalizeRunningTaskTimer(currentTimer, nowMs, {
    nextPhase: "idle",
    completed: true,
  })
  const continueTo = options.continueTo ?? "idle"
  if (continueTo === "idle") {
    await saveTaskTimer(options.schema, target, completedTimer)
    updateRunningTaskTimerIndex(target, completedTimer)
    dispatchTaskTimerChange(target, completedTimer)
    return completedTimer
  }

  const nextTimer: TaskTimerData = {
    ...completedTimer,
    running: true,
    startedAt: nowMs,
    activeMode: "pomodoro",
    activePhase: continueTo,
    phaseDurationMs: getTaskTimerDefaultPhaseDurationMs(continueTo, completedTimer.completedPomodoros),
    pausedPhase: null,
    pausedRemainingMs: null,
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return nextTimer
}

export async function clearTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
}): Promise<TaskTimerData> {
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!hasTaskTimerRecord(currentTimer)) {
    return currentTimer
  }

  const nextTimer = createDefaultTaskTimerData()
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
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
    totalFocusMs: doesPhaseCountAsFocus(currentTimer.activePhase)
      ? resolveTaskTimerElapsedMs(currentTimer, nowMs)
      : currentTimer.totalFocusMs,
    running: true,
    startedAt: nowMs,
    sessionId: currentTimer.sessionId,
    phaseDurationMs: currentTimer.phaseDurationMs == null
      ? null
      : Math.max(
        0,
        currentTimer.phaseDurationMs - resolveTaskTimerPhaseElapsedMs(currentTimer, nowMs),
      ),
  }
  await saveTaskTimer(options.schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return nextTimer
}

export async function stopAllRunningTaskTimers(
  schema: TaskSchemaDefinition,
  exceptTaskId?: DbId | null,
  nowMs: number = Date.now(),
): Promise<number> {
  const normalizedExceptId = isValidDbId(exceptTaskId) ? getMirrorId(exceptTaskId) : null
  const indexedTaskId = runningTaskTimerIndex?.taskId ?? null
  if (indexedTaskId != null && indexedTaskId !== normalizedExceptId) {
    const stopped = await stopIndexedRunningTaskTimer(schema, nowMs)
    if (stopped != null) {
      return stopped ? 1 : 0
    }
  }

  const taskBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]
  const filteredTaskBlocks = taskBlocks.filter((block) => !isProjectTaggedTaskBlock(block, schema))

  let stoppedCount = 0

  for (const sourceBlock of filteredTaskBlocks) {
    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }
    if (isProjectTaggedTaskBlock(sourceBlock, schema) || isProjectTaggedTaskBlock(liveBlock, schema)) {
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

    const nextTimer = finalizeRunningTaskTimer(timer, nowMs)
    await saveTaskTimer(schema, target, nextTimer)
    updateRunningTaskTimerIndex(target, nextTimer)
    stoppedCount += 1
  }

  return stoppedCount
}

export async function checkpointAllRunningTaskTimers(
  schema: TaskSchemaDefinition,
  nowMs: number = Date.now(),
): Promise<number> {
  const indexedTaskId = runningTaskTimerIndex?.taskId ?? null
  if (indexedTaskId != null) {
    const checkpointed = await checkpointIndexedRunningTaskTimer(schema, nowMs)
    if (checkpointed != null) {
      return checkpointed ? 1 : 0
    }
  }

  const taskBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]
  const filteredTaskBlocks = taskBlocks.filter((block) => !isProjectTaggedTaskBlock(block, schema))
  let checkpointedCount = 0
  const seenTaskIds = new Set<DbId>()

  for (const sourceBlock of filteredTaskBlocks) {
    const liveBlock = getLiveTaskBlock(sourceBlock)
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }
    if (isProjectTaggedTaskBlock(sourceBlock, schema) || isProjectTaggedTaskBlock(liveBlock, schema)) {
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
      totalFocusMs: doesPhaseCountAsFocus(timer.activePhase)
        ? resolveTaskTimerElapsedMs(timer, nowMs)
        : timer.totalFocusMs,
      running: true,
      startedAt: nowMs,
      sessionId: timer.sessionId,
      phaseDurationMs: timer.phaseDurationMs == null
        ? null
        : Math.max(0, timer.phaseDurationMs - resolveTaskTimerPhaseElapsedMs(timer, nowMs)),
    }
    await saveTaskTimer(schema, target, nextTimer)
    updateRunningTaskTimerIndex(target, nextTimer)
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

async function stopIndexedRunningTaskTimer(
  schema: TaskSchemaDefinition,
  nowMs: number,
): Promise<boolean | null> {
  const indexed = runningTaskTimerIndex
  if (indexed == null) {
    return null
  }

  const target = await resolveTaskBlockOrNull(indexed.taskId, indexed.sourceBlockId, schema)
  if (target == null) {
    runningTaskTimerIndex = null
    return null
  }

  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!currentTimer.running) {
    updateRunningTaskTimerIndex(target, currentTimer)
    return null
  }

  const nextTimer = finalizeRunningTaskTimer(currentTimer, nowMs)
  await saveTaskTimer(schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return true
}

async function checkpointIndexedRunningTaskTimer(
  schema: TaskSchemaDefinition,
  nowMs: number,
): Promise<boolean | null> {
  const indexed = runningTaskTimerIndex
  if (indexed == null) {
    return null
  }

  const target = await resolveTaskBlockOrNull(indexed.taskId, indexed.sourceBlockId, schema)
  if (target == null) {
    runningTaskTimerIndex = null
    return null
  }

  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!currentTimer.running || currentTimer.startedAt == null) {
    updateRunningTaskTimerIndex(target, currentTimer)
    return null
  }

  const nextTimer: TaskTimerData = {
    ...currentTimer,
    elapsedMs: resolveTaskTimerElapsedMs(currentTimer, nowMs),
    totalFocusMs: doesPhaseCountAsFocus(currentTimer.activePhase)
      ? resolveTaskTimerElapsedMs(currentTimer, nowMs)
      : currentTimer.totalFocusMs,
    running: true,
    startedAt: nowMs,
    sessionId: currentTimer.sessionId,
    phaseDurationMs: currentTimer.phaseDurationMs == null
      ? null
      : Math.max(0, currentTimer.phaseDurationMs - resolveTaskTimerPhaseElapsedMs(currentTimer, nowMs)),
  }
  await saveTaskTimer(schema, target, nextTimer)
  updateRunningTaskTimerIndex(target, nextTimer)
  dispatchTaskTimerChange(target, nextTimer)
  return true
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
  const elapsedMs = normalizeElapsedMs(raw.elapsedMs)
  const totalFocusMs = normalizeElapsedMs(raw.totalFocusMs ?? raw.focusMs ?? elapsedMs)
  const activeMode = normalizeTaskTimerMode(raw.activeMode)
  const activePhase = normalizeTaskTimerPhase(raw.activePhase, running)
  const phaseDurationMs = normalizeNullableDuration(raw.phaseDurationMs)
  const pausedPhase = normalizePausedPhase(raw.pausedPhase)
  const pausedRemainingMs = normalizeNullableDuration(raw.pausedRemainingMs)
  const sessionId = normalizeSessionId(raw.sessionId)

  return {
    schema: normalizePositiveInt(raw.schema, TASK_TIMER_SCHEMA_VERSION),
    elapsedMs,
    totalFocusMs,
    completedPomodoros: normalizeNonNegativeInt(raw.completedPomodoros, Math.floor(totalFocusMs / POMODORO_DURATION_MS)),
    running: running && startedAt != null,
    startedAt: running && startedAt != null ? startedAt : null,
    sessionId: running && startedAt != null ? sessionId : null,
    activeMode,
    activePhase: running && startedAt != null
      ? activePhase === "idle" || activePhase === "paused" ? "focus" : activePhase
      : activePhase === "paused" ? "paused" : "idle",
    phaseDurationMs,
    pausedPhase: activePhase === "paused" ? pausedPhase ?? "focus" : null,
    pausedRemainingMs: activePhase === "paused" ? pausedRemainingMs : null,
    sessionLog: normalizeSessionLog(raw.sessionLog),
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

function normalizeNullableDuration(value: unknown): number | null {
  if (value == null) {
    return null
  }

  return normalizeElapsedMs(value)
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return fallback
  }

  return Math.floor(parsed)
}

function normalizeTaskTimerMode(value: unknown): TaskTimerMode {
  return value === "pomodoro" ? "pomodoro" : "direct"
}

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim()
  return normalized === "" ? null : normalized
}

function normalizeTaskTimerPhase(value: unknown, running: boolean): TaskTimerPhase {
  switch (value) {
    case "focus":
    case "short-break":
    case "long-break":
    case "paused":
      return value
    case "idle":
      return "idle"
    default:
      return running ? "focus" : "idle"
  }
}

function normalizePausedPhase(value: unknown): Exclude<TaskTimerPhase, "idle" | "paused"> | null {
  switch (value) {
    case "focus":
    case "short-break":
    case "long-break":
      return value
    default:
      return null
  }
}

function normalizeSessionLog(value: unknown): TaskTimerSessionLogEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item): TaskTimerSessionLogEntry | null => {
      if (!isRecord(item)) {
        return null
      }

      const startedAt = normalizeTimestamp(item.startedAt)
      const endedAt = normalizeTimestamp(item.endedAt)
      const durationMs = normalizeElapsedMs(item.durationMs)
      const mode = normalizeTaskTimerMode(item.mode)
      const phase = normalizePausedPhase(item.phase)
      if (startedAt == null || endedAt == null || phase == null) {
        return null
      }

      return {
        startedAt,
        endedAt,
        durationMs,
        mode,
        phase,
        completed: item.completed === true,
      }
    })
    .filter((item): item is TaskTimerSessionLogEntry => item != null)
    .slice(-20)
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
  options?: {
    nextPhase?: TaskTimerPhase
    pausedPhase?: Exclude<TaskTimerPhase, "idle" | "paused"> | null
    pausedRemainingMs?: number | null
    completed?: boolean
  },
): TaskTimerData {
  const elapsedMs = resolveTaskTimerElapsedMs(timer, nowMs)
  const phaseElapsedMs = resolveTaskTimerPhaseElapsedMs(timer, nowMs)
  const phaseCompleted = options?.completed === true
  const countedFocus = doesPhaseCountAsFocus(timer.activePhase)
  const nextCompletedPomodoros =
    timer.activeMode === "pomodoro" &&
      timer.activePhase === "focus" &&
      phaseCompleted
      ? timer.completedPomodoros + 1
      : timer.completedPomodoros
  const sessionLogEntry = buildSessionLogEntry(timer, nowMs, phaseElapsedMs, phaseCompleted)

  return {
    ...timer,
    elapsedMs,
    totalFocusMs: countedFocus ? elapsedMs : timer.totalFocusMs,
    completedPomodoros: nextCompletedPomodoros,
    running: false,
    startedAt: null,
    sessionId: null,
    activePhase: options?.nextPhase ?? "idle",
    phaseDurationMs: null,
    pausedPhase: options?.pausedPhase ?? null,
    pausedRemainingMs: options?.pausedRemainingMs ?? null,
    sessionLog: sessionLogEntry == null
      ? timer.sessionLog
      : [...timer.sessionLog, sessionLogEntry].slice(-20),
  }
}

function buildSessionLogEntry(
  timer: TaskTimerData,
  nowMs: number,
  durationMs: number,
  completed: boolean,
): TaskTimerSessionLogEntry | null {
  if (
    timer.startedAt == null ||
    timer.activePhase === "idle" ||
    timer.activePhase === "paused" ||
    durationMs <= 0
  ) {
    return null
  }

  return {
    startedAt: timer.startedAt,
    endedAt: nowMs,
    durationMs,
    mode: timer.activeMode,
    phase: timer.activePhase,
    completed,
  }
}

function doesPhaseCountAsFocus(phase: TaskTimerPhase): boolean {
  return phase === "focus"
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

  const payload: BlockProperty[] = [
    {
      name: schema.propertyNames.status,
      type: TEXT_CHOICES_PROP_TYPE,
      value: doingStatus,
    },
  ]
  if (values.startTime == null) {
    payload.push({
      name: schema.propertyNames.startTime,
      type: DATE_TIME_PROP_TYPE,
      value: new Date(),
    })
  }

  if (taskRef != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        taskRef,
        payload,
      )
      return
    } catch (error) {
      console.error(error)
    }
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    target.writableBlockId,
    schema.tagAlias,
    mergeTaskRefData(taskRef?.data, payload),
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

function dispatchTaskTimerChange(target: ResolvedTaskBlock, timer: TaskTimerData) {
  window.dispatchEvent(
    new CustomEvent<TaskTimerChangeEventDetail>(TASK_TIMER_EVENT_NAME, {
      detail: {
        taskId: target.taskId,
        sourceBlockId: target.writableBlockId,
        running: timer.running,
        activePhase: timer.activePhase,
      },
    }),
  )
}

function updateRunningTaskTimerIndex(
  target: ResolvedTaskBlock,
  timer: TaskTimerData,
) {
  if (timer.running) {
    runningTaskTimerIndex = {
      taskId: target.taskId,
      sourceBlockId: target.writableBlockId,
    }
    return
  }

  if (runningTaskTimerIndex?.taskId === target.taskId) {
    runningTaskTimerIndex = null
  }
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
    if (isProjectTaggedTaskBlock(sourceBlock, schema) || isProjectTaggedTaskBlock(liveBlock, schema)) {
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

async function resolveTaskBlockOrNull(
  blockId: DbId,
  sourceBlockId: DbId | null | undefined,
  schema: TaskSchemaDefinition,
): Promise<ResolvedTaskBlock | null> {
  try {
    return await resolveTaskBlock(blockId, sourceBlockId, schema)
  } catch {
    return null
  }
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

function isProjectTaggedTaskBlock(
  block: Block,
  schema: TaskSchemaDefinition,
): boolean {
  const liveBlock = getLiveTaskBlock(block)
  return hasProjectTagRef(liveBlock, schema.projectTagAlias) ||
    hasProjectTagRef(block, schema.projectTagAlias)
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
