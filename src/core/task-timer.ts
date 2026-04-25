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
  isTaskClosedStatus,
  isTaskDoneStatus,
  isTaskWaitingStatus,
  type TaskSchemaDefinition,
} from "./task-schema"
import { getTaskPropertiesFromRef, mergeTaskRefData } from "./task-properties"

const PROP_TYPE_JSON = 0
const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const TEXT_CHOICES_PROP_TYPE = 6
const TASK_TIMER_SCHEMA_VERSION = 2

export const TASK_TIMER_PROPERTY_NAME = "_mlo_task_timer"

export type TaskTimerMode = "direct" | "pomodoro"
export type TaskTimerSessionKind = TaskTimerMode
export type TaskTimerPomodoroPhase = "focus" | "short-break" | "long-break"
export type TaskTimerPrimaryAction = "start" | "stop" | "resume" | "next"

export interface TaskTimerPomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
}

export interface TaskTimerData {
  schema: number
  elapsedMs: number
  running: boolean
  startedAt: number | null
  sessionKind: TaskTimerSessionKind | null
  phase: TaskTimerPomodoroPhase | null
  phaseElapsedMs: number
  phaseDurationMs: number
  completedPomodoros: number
  focusStreakCount: number
}

export interface TaskTimerPomodoroProgress {
  phase: TaskTimerPomodoroPhase
  elapsedMs: number
  durationMs: number
  remainingMs: number
  completed: boolean
  running: boolean
}

interface ResolvedTaskBlock {
  writableBlockId: DbId
  sourceBlock: Block
  liveBlock: Block
  taskId: DbId
}

const DEFAULT_TASK_TIMER_POMODORO_SETTINGS: TaskTimerPomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
}

export function createDefaultTaskTimerData(): TaskTimerData {
  return {
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: 0,
    running: false,
    startedAt: null,
    sessionKind: null,
    phase: null,
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
    completedPomodoros: 0,
    focusStreakCount: 0,
  }
}

export function getDefaultTaskTimerPomodoroSettings(): TaskTimerPomodoroSettings {
  return { ...DEFAULT_TASK_TIMER_POMODORO_SETTINGS }
}

export function normalizeTaskTimerPomodoroSettings(
  raw?: Partial<TaskTimerPomodoroSettings> | null,
): TaskTimerPomodoroSettings {
  return {
    focusMinutes: normalizePomodoroMinutes(
      raw?.focusMinutes,
      DEFAULT_TASK_TIMER_POMODORO_SETTINGS.focusMinutes,
    ),
    shortBreakMinutes: normalizePomodoroMinutes(
      raw?.shortBreakMinutes,
      DEFAULT_TASK_TIMER_POMODORO_SETTINGS.shortBreakMinutes,
    ),
    longBreakMinutes: normalizePomodoroMinutes(
      raw?.longBreakMinutes,
      DEFAULT_TASK_TIMER_POMODORO_SETTINGS.longBreakMinutes,
    ),
    longBreakEvery: normalizePomodoroLongBreakEvery(raw?.longBreakEvery),
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
  return timer.elapsedMs > 0 ||
    timer.running ||
    timer.startedAt != null ||
    timer.completedPomodoros > 0 ||
    timer.phase != null
}

export function resolveTaskTimerElapsedMs(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): number {
  if (!timer.running || timer.startedAt == null) {
    return timer.elapsedMs
  }

  if (timer.sessionKind !== "pomodoro") {
    const delta = nowMs - timer.startedAt
    if (!Number.isFinite(delta) || Number.isNaN(delta) || delta <= 0) {
      return timer.elapsedMs
    }

    return timer.elapsedMs + delta
  }

  if (timer.phase !== "focus") {
    return timer.elapsedMs
  }

  const progress = resolveTaskPomodoroPhaseProgress(timer, nowMs)
  if (progress == null) {
    return timer.elapsedMs
  }

  return timer.elapsedMs + progress.elapsedMs - timer.phaseElapsedMs
}

export function formatTaskTimerDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const hourText = hours < 100 ? String(hours).padStart(2, "0") : String(hours)

  return `${hourText}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function resolveTaskPomodoroPhaseProgress(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): TaskTimerPomodoroProgress | null {
  if (timer.phase == null || timer.phaseDurationMs <= 0) {
    return null
  }

  const baseElapsedMs = Math.max(0, Math.min(timer.phaseDurationMs, timer.phaseElapsedMs))
  const liveDelta = timer.running && timer.startedAt != null
    ? Math.max(0, nowMs - timer.startedAt)
    : 0
  const elapsedMs = Math.min(timer.phaseDurationMs, baseElapsedMs + liveDelta)
  const remainingMs = Math.max(0, timer.phaseDurationMs - elapsedMs)

  return {
    phase: timer.phase,
    elapsedMs,
    durationMs: timer.phaseDurationMs,
    remainingMs,
    completed: elapsedMs >= timer.phaseDurationMs,
    running: timer.running,
  }
}

export function resolveTaskTimerPrimaryAction(
  timer: TaskTimerData,
  mode: TaskTimerMode,
  nowMs: number = Date.now(),
): TaskTimerPrimaryAction {
  if (timer.running) {
    return "stop"
  }

  if (mode !== "pomodoro") {
    return "start"
  }

  const progress = resolveTaskPomodoroPhaseProgress(timer, nowMs)
  if (progress == null) {
    return "start"
  }

  if (progress.completed) {
    return "next"
  }

  if (progress.elapsedMs > 0) {
    return "resume"
  }

  return "start"
}

export function resolveTaskPomodoroPhaseDurationMs(
  phase: TaskTimerPomodoroPhase,
  settings?: Partial<TaskTimerPomodoroSettings> | null,
): number {
  const normalizedSettings = normalizeTaskTimerPomodoroSettings(settings)
  switch (phase) {
    case "focus":
      return normalizedSettings.focusMinutes * 60 * 1000
    case "short-break":
      return normalizedSettings.shortBreakMinutes * 60 * 1000
    case "long-break":
      return normalizedSettings.longBreakMinutes * 60 * 1000
    default:
      return normalizedSettings.focusMinutes * 60 * 1000
  }
}

export function startTaskTimerState(
  timer: TaskTimerData,
  mode: TaskTimerMode,
  nowMs: number = Date.now(),
  pomodoroSettings?: Partial<TaskTimerPomodoroSettings> | null,
  resetPomodoroPhase: boolean = false,
): TaskTimerData {
  const safeNowMs = normalizeNowMs(nowMs)
  if (timer.running) {
    return timer
  }

  if (mode !== "pomodoro") {
    return {
      ...clearPomodoroPhaseState(timer, { resetFocusStreak: true }),
      schema: TASK_TIMER_SCHEMA_VERSION,
      running: true,
      startedAt: safeNowMs,
      sessionKind: "direct",
    }
  }

  const normalizedSettings = normalizeTaskTimerPomodoroSettings(pomodoroSettings)
  const baseTimer = resetPomodoroPhase
    ? clearPomodoroPhaseState(timer, { resetFocusStreak: true })
    : timer
  const progress = resolveTaskPomodoroPhaseProgress(baseTimer, safeNowMs)

  if (progress == null) {
    return createPomodoroPhaseState(baseTimer, "focus", normalizedSettings, safeNowMs)
  }

  if (!progress.completed) {
    return {
      ...baseTimer,
      schema: TASK_TIMER_SCHEMA_VERSION,
      running: true,
      startedAt: safeNowMs,
      sessionKind: "pomodoro",
      phaseElapsedMs: progress.elapsedMs,
      phaseDurationMs: progress.durationMs,
    }
  }

  return createPomodoroPhaseState(
    baseTimer,
    resolveNextTaskPomodoroPhase(baseTimer, normalizedSettings),
    normalizedSettings,
    safeNowMs,
  )
}

export function finalizeTaskTimerState(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
  clearPomodoroPhase: boolean = false,
): TaskTimerData {
  if (!timer.running) {
    return clearPomodoroPhase
      ? clearPomodoroPhaseState(timer, { resetFocusStreak: true })
      : timer
  }

  let nextTimer = timer.sessionKind === "pomodoro"
    ? finalizePomodoroTimerState(timer, nowMs)
    : finalizeDirectTimerState(timer, nowMs)

  if (clearPomodoroPhase) {
    nextTimer = clearPomodoroPhaseState(nextTimer, { resetFocusStreak: true })
  }

  return nextTimer
}

export function checkpointTaskTimerState(
  timer: TaskTimerData,
  nowMs: number = Date.now(),
): TaskTimerData {
  if (!timer.running || timer.startedAt == null) {
    return timer
  }

  if (timer.sessionKind !== "pomodoro") {
    return {
      ...timer,
      schema: TASK_TIMER_SCHEMA_VERSION,
      elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
      running: true,
      startedAt: normalizeNowMs(nowMs),
    }
  }

  const progress = resolveTaskPomodoroPhaseProgress(timer, nowMs)
  if (progress == null) {
    return {
      ...timer,
      schema: TASK_TIMER_SCHEMA_VERSION,
      running: false,
      startedAt: null,
    }
  }

  if (progress.completed) {
    return completePomodoroPhaseState(timer, nowMs)
  }

  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
    running: true,
    startedAt: normalizeNowMs(nowMs),
    sessionKind: "pomodoro",
    phaseElapsedMs: progress.elapsedMs,
    phaseDurationMs: progress.durationMs,
  }
}

export function clearPomodoroPhaseState(
  timer: TaskTimerData,
  options?: {
    resetFocusStreak?: boolean
  },
): TaskTimerData {
  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    sessionKind: timer.sessionKind === "direct" ? "direct" : null,
    phase: null,
    phaseElapsedMs: 0,
    phaseDurationMs: 0,
    focusStreakCount: options?.resetFocusStreak === false ? timer.focusStreakCount : 0,
  }
}

export async function startTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  mode?: TaskTimerMode
  nowMs?: number
  pomodoroSettings?: Partial<TaskTimerPomodoroSettings> | null
  resetPomodoroPhase?: boolean
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const mode: TaskTimerMode = options.mode === "pomodoro" ? "pomodoro" : "direct"
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const status = resolveTaskStatusFromBlock(target.liveBlock, options.schema)
  if (isTaskDoneStatus(status, options.schema)) {
    throw new Error(t("Completed task cannot start timer"))
  }
  if (isTaskClosedStatus(status, options.schema)) {
    throw new Error(t("Closed task cannot start timer"))
  }

  await promoteTaskStatusToDoingIfNeeded(target, options.schema)

  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (currentTimer.running) {
    return currentTimer
  }

  await stopAllRunningTaskTimers(options.schema, target.taskId, nowMs, {
    clearPomodoroPhase: true,
  })

  const nextTimer = startTaskTimerState(
    currentTimer,
    mode,
    nowMs,
    options.pomodoroSettings,
    options.resetPomodoroPhase === true,
  )
  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function stopTaskTimer(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
  clearPomodoroPhase?: boolean
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  const nextTimer = finalizeTaskTimerState(
    currentTimer,
    nowMs,
    options.clearPomodoroPhase === true,
  )
  if (areTaskTimersEqual(currentTimer, nextTimer)) {
    return nextTimer
  }

  await saveTaskTimer(options.schema, target, nextTimer)
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
  const nextTimer = checkpointTaskTimerState(currentTimer, nowMs)
  if (areTaskTimersEqual(currentTimer, nextTimer)) {
    return nextTimer
  }

  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function completeTaskPomodoroPhaseIfNeeded(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  if (!currentTimer.running || currentTimer.sessionKind !== "pomodoro") {
    return currentTimer
  }

  const progress = resolveTaskPomodoroPhaseProgress(currentTimer, nowMs)
  if (progress == null || !progress.completed) {
    return currentTimer
  }

  const nextTimer = completePomodoroPhaseState(currentTimer, nowMs)
  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function advanceTaskPomodoroPhase(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  nowMs?: number
  pomodoroSettings?: Partial<TaskTimerPomodoroSettings> | null
}): Promise<TaskTimerData> {
  const nowMs = normalizeNowMs(options.nowMs)
  const target = await resolveTaskBlock(options.blockId, options.sourceBlockId, options.schema)
  const currentTimer = readTaskTimerFromSourceAndLiveBlocks(target.sourceBlock, target.liveBlock)
  const normalizedSettings = normalizeTaskTimerPomodoroSettings(options.pomodoroSettings)
  const progress = resolveTaskPomodoroPhaseProgress(currentTimer, nowMs)
  const nextTimer = progress != null && progress.completed
    ? createPomodoroPhaseState(
        currentTimer,
        resolveNextTaskPomodoroPhase(currentTimer, normalizedSettings),
        normalizedSettings,
        nowMs,
      )
    : startTaskTimerState(currentTimer, "pomodoro", nowMs, normalizedSettings)

  if (areTaskTimersEqual(currentTimer, nextTimer)) {
    return nextTimer
  }

  await saveTaskTimer(options.schema, target, nextTimer)
  return nextTimer
}

export async function stopAllRunningTaskTimers(
  schema: TaskSchemaDefinition,
  exceptTaskId?: DbId | null,
  nowMs: number = Date.now(),
  options?: {
    clearPomodoroPhase?: boolean
  },
): Promise<number> {
  const taskBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    schema.tagAlias,
  ])) as Block[]

  const normalizedExceptId = isValidDbId(exceptTaskId) ? getMirrorId(exceptTaskId) : null
  let stoppedCount = 0
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

    await saveTaskTimer(
      schema,
      target,
      finalizeTaskTimerState(timer, nowMs, options?.clearPomodoroPhase === true),
    )
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

    const nextTimer = checkpointTaskTimerState(timer, nowMs)
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
  timerMode?: TaskTimerMode
  pomodoroSettings?: Partial<TaskTimerPomodoroSettings> | null
}): Promise<void> {
  if (isTaskClosedStatus(options.nextStatus, options.schema)) {
    await stopTaskTimer({
      blockId: options.blockId,
      sourceBlockId: options.sourceBlockId,
      schema: options.schema,
      clearPomodoroPhase: true,
    })
    return
  }

  if (isTaskWaitingStatus(options.nextStatus, options.schema)) {
    await stopTaskTimer({
      blockId: options.blockId,
      sourceBlockId: options.sourceBlockId,
      schema: options.schema,
      clearPomodoroPhase: true,
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
      mode: options.timerMode,
      pomodoroSettings: options.pomodoroSettings,
      resetPomodoroPhase: options.timerMode === "pomodoro",
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
  const sessionKind = normalizeTaskTimerSessionKind(raw.sessionKind)
  const phase = normalizeTaskTimerPomodoroPhase(raw.phase)
  const phaseDurationMs = normalizeElapsedMs(raw.phaseDurationMs)
  const phaseElapsedMs = Math.min(
    phaseDurationMs,
    normalizeElapsedMs(raw.phaseElapsedMs),
  )
  const hasPomodoroPhase = sessionKind === "pomodoro" && phase != null && phaseDurationMs > 0

  return {
    schema: normalizePositiveInt(raw.schema, TASK_TIMER_SCHEMA_VERSION),
    elapsedMs: normalizeElapsedMs(raw.elapsedMs),
    running: running && startedAt != null,
    startedAt: running && startedAt != null ? startedAt : null,
    sessionKind: hasPomodoroPhase
      ? "pomodoro"
      : sessionKind === "direct"
        ? "direct"
        : null,
    phase: hasPomodoroPhase ? phase : null,
    phaseElapsedMs: hasPomodoroPhase ? phaseElapsedMs : 0,
    phaseDurationMs: hasPomodoroPhase ? phaseDurationMs : 0,
    completedPomodoros: normalizeNonNegativeInt(raw.completedPomodoros, 0),
    focusStreakCount: hasPomodoroPhase || raw.focusStreakCount != null
      ? normalizeNonNegativeInt(raw.focusStreakCount, 0)
      : 0,
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

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 0 ? normalized : fallback
}

function normalizePomodoroMinutes(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.round(parsed)
  if (normalized < 1) {
    return 1
  }

  return Math.min(normalized, 240)
}

function normalizePomodoroLongBreakEvery(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return DEFAULT_TASK_TIMER_POMODORO_SETTINGS.longBreakEvery
  }

  const normalized = Math.round(parsed)
  if (normalized < 1) {
    return 1
  }

  return Math.min(normalized, 12)
}

function normalizeTaskTimerSessionKind(value: unknown): TaskTimerSessionKind | null {
  return value === "pomodoro" || value === "direct" ? value : null
}

function normalizeTaskTimerPomodoroPhase(value: unknown): TaskTimerPomodoroPhase | null {
  return value === "focus" || value === "short-break" || value === "long-break"
    ? value
    : null
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

function areTaskTimersEqual(
  left: TaskTimerData,
  right: TaskTimerData,
): boolean {
  return left.schema === right.schema &&
    left.elapsedMs === right.elapsedMs &&
    left.running === right.running &&
    left.startedAt === right.startedAt &&
    left.sessionKind === right.sessionKind &&
    left.phase === right.phase &&
    left.phaseElapsedMs === right.phaseElapsedMs &&
    left.phaseDurationMs === right.phaseDurationMs &&
    left.completedPomodoros === right.completedPomodoros &&
    left.focusStreakCount === right.focusStreakCount
}

function createPomodoroPhaseState(
  timer: TaskTimerData,
  phase: TaskTimerPomodoroPhase,
  settings: TaskTimerPomodoroSettings,
  nowMs: number,
): TaskTimerData {
  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    running: true,
    startedAt: normalizeNowMs(nowMs),
    sessionKind: "pomodoro",
    phase,
    phaseElapsedMs: 0,
    phaseDurationMs: resolveTaskPomodoroPhaseDurationMs(phase, settings),
  }
}

function resolveNextTaskPomodoroPhase(
  timer: TaskTimerData,
  settings: TaskTimerPomodoroSettings,
): TaskTimerPomodoroPhase {
  if (timer.phase === "focus") {
    return timer.focusStreakCount > 0 && timer.focusStreakCount % settings.longBreakEvery === 0
      ? "long-break"
      : "short-break"
  }

  return "focus"
}

function finalizeDirectTimerState(
  timer: TaskTimerData,
  nowMs: number,
): TaskTimerData {
  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
    running: false,
    startedAt: null,
  }
}

function finalizePomodoroTimerState(
  timer: TaskTimerData,
  nowMs: number,
): TaskTimerData {
  const progress = resolveTaskPomodoroPhaseProgress(timer, nowMs)
  if (progress == null) {
    return {
      ...timer,
      schema: TASK_TIMER_SCHEMA_VERSION,
      running: false,
      startedAt: null,
      sessionKind: "pomodoro",
    }
  }

  if (progress.completed) {
    return completePomodoroPhaseState(timer, nowMs)
  }

  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
    running: false,
    startedAt: null,
    sessionKind: "pomodoro",
    phaseElapsedMs: progress.elapsedMs,
    phaseDurationMs: progress.durationMs,
  }
}

function completePomodoroPhaseState(
  timer: TaskTimerData,
  nowMs: number,
): TaskTimerData {
  const progress = resolveTaskPomodoroPhaseProgress(timer, nowMs)
  if (progress == null) {
    return {
      ...timer,
      schema: TASK_TIMER_SCHEMA_VERSION,
      running: false,
      startedAt: null,
    }
  }

  const completedFocus = progress.phase === "focus"
  const completedLongBreak = progress.phase === "long-break"

  return {
    ...timer,
    schema: TASK_TIMER_SCHEMA_VERSION,
    elapsedMs: resolveTaskTimerElapsedMs(timer, nowMs),
    running: false,
    startedAt: null,
    sessionKind: "pomodoro",
    phaseElapsedMs: progress.durationMs,
    phaseDurationMs: progress.durationMs,
    completedPomodoros: completedFocus ? timer.completedPomodoros + 1 : timer.completedPomodoros,
    focusStreakCount: completedFocus
      ? timer.focusStreakCount + 1
      : completedLongBreak
        ? 0
        : timer.focusStreakCount,
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

