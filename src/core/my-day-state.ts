import type { Block, DbId } from "../orca.d.ts"
import { dedupeDbIds, getMirrorId, isValidDbId } from "./block-utils"

const MY_DAY_DATA_KEY = "taskMyDay.v1"
const MY_DAY_SCHEMA_VERSION = 1
const PROP_TYPE_TEXT = 1
const PROP_TYPE_NUMBER = 3
const PROP_TYPE_BOOLEAN = 4
const INLINE_REF_TYPE = 1
const CONTENT_TYPE_LINK = "r"
const MINUTE_PER_DAY = 24 * 60
const DEFAULT_SCHEDULE_DURATION_MINUTES = 60
const MIN_SCHEDULE_DURATION_MINUTES = 15
const MAX_SCHEDULE_DURATION_MINUTES = 12 * 60
const MY_DAY_SECTION_MARKER_PROPERTY = "_mlo_task_my_day_section"
const MY_DAY_ENTRY_TASK_ID_PROPERTY = "_mlo_task_my_day_task_id"
const MY_DAY_ENTRY_DAY_KEY_PROPERTY = "_mlo_task_my_day_day_key"
const MY_DAY_INSERT_TOKEN_PATTERN = /(?:__)?mlo_myday_\d+_[a-z0-9]+(?:__)?\s*/gi

export const DEFAULT_MY_DAY_RESET_HOUR = 5

export type MyDayDisplayMode = "list" | "schedule"

export interface MyDayTaskEntry {
  taskId: DbId
  sourceBlockId: DbId | null
  addedAt: number
  scheduleStartMinute: number | null
  scheduleEndMinute: number | null
  order: number
  mirrorBlockId: DbId | null
}

export interface MyDayState {
  schema: number
  dayKey: string
  displayMode: MyDayDisplayMode
  journalSectionBlockId: DbId | null
  tasks: MyDayTaskEntry[]
  updatedAt: number
}

interface NormalizeResult {
  state: MyDayState
  changed: boolean
}

export function normalizeMyDayResetHour(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return DEFAULT_MY_DAY_RESET_HOUR
  }

  const normalized = Math.round(value)
  if (normalized < 0) {
    return 0
  }

  if (normalized > 23) {
    return 23
  }

  return normalized
}

export function resolveMyDayKey(now: Date, resetHour: number): string {
  const boundaryHour = normalizeMyDayResetHour(resetHour)
  const effectiveDate = new Date(now)
  if (effectiveDate.getHours() < boundaryHour) {
    effectiveDate.setDate(effectiveDate.getDate() - 1)
  }

  const year = effectiveDate.getFullYear()
  const month = String(effectiveDate.getMonth() + 1).padStart(2, "0")
  const day = String(effectiveDate.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function createDefaultMyDayState(dayKey: string): MyDayState {
  return {
    schema: MY_DAY_SCHEMA_VERSION,
    dayKey,
    displayMode: "list",
    journalSectionBlockId: null,
    tasks: [],
    updatedAt: Date.now(),
  }
}

export async function loadMyDayState(
  pluginName: string,
  resetHour: number,
  now: Date = new Date(),
): Promise<MyDayState> {
  const currentDayKey = resolveMyDayKey(now, resetHour)
  const raw = await orca.plugins.getData(pluginName, MY_DAY_DATA_KEY)
  let parsed: unknown = null

  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error(error)
    }
  }

  const normalized = normalizeMyDayState(parsed, currentDayKey)
  if (normalized.changed) {
    await persistMyDayState(pluginName, normalized.state)
  }

  return normalized.state
}

export async function saveMyDayState(
  pluginName: string,
  state: MyDayState,
): Promise<MyDayState> {
  const normalized = normalizeMyDayState(state, state.dayKey)
  await persistMyDayState(pluginName, normalized.state)
  return normalized.state
}

export function isTaskInMyDay(state: MyDayState, taskId: DbId): boolean {
  return state.tasks.some((item: MyDayTaskEntry) => item.taskId === taskId)
}

export function setMyDayDisplayMode(
  state: MyDayState,
  mode: MyDayDisplayMode,
): MyDayState {
  const normalizedMode: MyDayDisplayMode = mode === "schedule" ? "schedule" : "list"
  if (state.displayMode === normalizedMode) {
    return state
  }

  return {
    ...state,
    displayMode: normalizedMode,
    updatedAt: Date.now(),
  }
}

export function addTaskToMyDayState(
  state: MyDayState,
  options: {
    taskId: DbId
    sourceBlockId?: DbId | null
  },
): {
  state: MyDayState
  entry: MyDayTaskEntry
  added: boolean
} {
  const normalizedTaskId = getMirrorId(options.taskId)
  if (!isValidDbId(normalizedTaskId)) {
    throw new Error("Invalid task id")
  }

  const normalizedSourceBlockId = normalizeTaskDbId(options.sourceBlockId)
  const existing = state.tasks.find((item: MyDayTaskEntry) => item.taskId === normalizedTaskId)
  if (existing != null) {
    if (existing.sourceBlockId === normalizedSourceBlockId || normalizedSourceBlockId == null) {
      return {
        state,
        entry: existing,
        added: false,
      }
    }

    const nextTasks = state.tasks.map((item: MyDayTaskEntry) => {
      if (item.taskId !== normalizedTaskId) {
        return item
      }

      return {
        ...item,
        sourceBlockId: normalizedSourceBlockId,
      }
    })

    const nextState = {
      ...state,
      tasks: nextTasks,
      updatedAt: Date.now(),
    }
    const nextEntry = nextTasks.find((item: MyDayTaskEntry) => item.taskId === normalizedTaskId)

    return {
      state: nextState,
      entry: nextEntry ?? existing,
      added: false,
    }
  }

  const maxOrder = state.tasks.reduce((maxValue: number, item: MyDayTaskEntry) => {
    return Math.max(maxValue, item.order)
  }, -1)

  const nextEntry: MyDayTaskEntry = {
    taskId: normalizedTaskId,
    sourceBlockId: normalizedSourceBlockId,
    addedAt: Date.now(),
    scheduleStartMinute: null,
    scheduleEndMinute: null,
    order: maxOrder + 1,
    mirrorBlockId: null,
  }

  return {
    state: {
      ...state,
      tasks: [...state.tasks, nextEntry],
      updatedAt: Date.now(),
    },
    entry: nextEntry,
    added: true,
  }
}

export function removeTaskFromMyDayState(
  state: MyDayState,
  taskId: DbId,
): {
  state: MyDayState
  removedEntry: MyDayTaskEntry | null
  removed: boolean
} {
  const normalizedTaskId = getMirrorId(taskId)
  if (!isValidDbId(normalizedTaskId)) {
    return {
      state,
      removedEntry: null,
      removed: false,
    }
  }

  const removedEntry = state.tasks.find((item: MyDayTaskEntry) => item.taskId === normalizedTaskId)
  if (removedEntry == null) {
    return {
      state,
      removedEntry: null,
      removed: false,
    }
  }

  const nextTasks = state.tasks
    .filter((item: MyDayTaskEntry) => item.taskId !== normalizedTaskId)
    .map((item: MyDayTaskEntry, index: number) => ({
      ...item,
      order: index,
    }))

  return {
    state: {
      ...state,
      tasks: nextTasks,
      updatedAt: Date.now(),
    },
    removedEntry,
    removed: true,
  }
}

export function updateMyDayTaskSchedule(
  state: MyDayState,
  taskId: DbId,
  scheduleStartMinute: number | null,
  scheduleEndMinute: number | null,
): MyDayState {
  const normalizedTaskId = getMirrorId(taskId)
  if (!isValidDbId(normalizedTaskId)) {
    return state
  }

  const [normalizedStart, normalizedEnd] = normalizeScheduleRange(
    scheduleStartMinute,
    scheduleEndMinute,
  )

  let changed = false
  const nextTasks = state.tasks.map((item: MyDayTaskEntry) => {
    if (item.taskId !== normalizedTaskId) {
      return item
    }

    if (
      item.scheduleStartMinute === normalizedStart &&
      item.scheduleEndMinute === normalizedEnd
    ) {
      return item
    }

    changed = true
    return {
      ...item,
      scheduleStartMinute: normalizedStart,
      scheduleEndMinute: normalizedEnd,
    }
  })

  if (!changed) {
    return state
  }

  return {
    ...state,
    tasks: nextTasks,
    updatedAt: Date.now(),
  }
}

export function setMyDayTaskMirrorBlockId(
  state: MyDayState,
  taskId: DbId,
  mirrorBlockId: DbId | null,
): MyDayState {
  const normalizedTaskId = getMirrorId(taskId)
  if (!isValidDbId(normalizedTaskId)) {
    return state
  }

  const normalizedMirrorBlockId = normalizeRawDbId(mirrorBlockId)
  let changed = false

  const nextTasks = state.tasks.map((item: MyDayTaskEntry) => {
    if (item.taskId !== normalizedTaskId) {
      return item
    }

    if (item.mirrorBlockId === normalizedMirrorBlockId) {
      return item
    }

    changed = true
    return {
      ...item,
      mirrorBlockId: normalizedMirrorBlockId,
    }
  })

  if (!changed) {
    return state
  }

  return {
    ...state,
    tasks: nextTasks,
    updatedAt: Date.now(),
  }
}

export function setMyDayJournalSectionBlockId(
  state: MyDayState,
  journalSectionBlockId: DbId | null,
): MyDayState {
  const normalizedSectionId = normalizeRawDbId(journalSectionBlockId)
  if (state.journalSectionBlockId === normalizedSectionId) {
    return state
  }

  return {
    ...state,
    journalSectionBlockId: normalizedSectionId,
    updatedAt: Date.now(),
  }
}

export function pruneMissingMyDayTasks(
  state: MyDayState,
  validTaskIds: Set<DbId>,
): {
  state: MyDayState
  removedEntries: MyDayTaskEntry[]
} {
  const removedEntries = state.tasks.filter((item: MyDayTaskEntry) => {
    return !validTaskIds.has(item.taskId)
  })

  if (removedEntries.length === 0) {
    return {
      state,
      removedEntries,
    }
  }

  const nextTasks = state.tasks
    .filter((item: MyDayTaskEntry) => validTaskIds.has(item.taskId))
    .map((item: MyDayTaskEntry, index: number) => ({
      ...item,
      order: index,
    }))

  return {
    state: {
      ...state,
      tasks: nextTasks,
      updatedAt: Date.now(),
    },
    removedEntries,
  }
}

export async function ensureMyDayMirrorInTodayJournal(options: {
  taskId: DbId
  dayKey: string
  sectionTitle: string
  existingSectionBlockId?: DbId | null
}): Promise<{
  mirrorBlockId: DbId | null
  journalSectionBlockId: DbId | null
}> {
  const normalizedTaskId = getMirrorId(options.taskId)
  if (!isValidDbId(normalizedTaskId)) {
    return {
      mirrorBlockId: null,
      journalSectionBlockId: null,
    }
  }

  const journalBlock =
    (await resolveJournalBlockByDayKey(options.dayKey)) ??
    (await resolveTodayJournalBlock())
  if (journalBlock == null) {
    return {
      mirrorBlockId: null,
      journalSectionBlockId: null,
    }
  }

  const journalSectionBlockId = normalizeRawDbId(journalBlock.id)

  if (journalSectionBlockId == null) {
    return {
      mirrorBlockId: null,
      journalSectionBlockId: null,
    }
  }

  await cleanupMyDayTokenArtifactsInJournal(journalSectionBlockId)

  const mirrorBlockId = await insertMyDayMirrorBlock(
    journalSectionBlockId,
    normalizedTaskId,
    options.dayKey,
  )

  return {
    mirrorBlockId,
    journalSectionBlockId,
  }
}

async function cleanupMyDayTokenArtifactsInJournal(
  sectionBlockId: DbId,
): Promise<void> {
  const sectionBlock = await getBlockById(sectionBlockId)
  if (sectionBlock == null) {
    return
  }

  const journalBlockId = normalizeRawDbId(sectionBlock.id)
  const candidateIds = new Set<DbId>()
  const pushCandidate = (id: DbId | null | undefined) => {
    if (isValidDbId(id)) {
      candidateIds.add(id)
    }
  }

  for (const childId of sectionBlock.children) {
    pushCandidate(childId)
  }

  if (journalBlockId != null) {
    for (const childId of sectionBlock.children) {
      const childBlock = await getBlockById(childId)
      if (childBlock == null) {
        continue
      }

      if (!isMyDaySectionBlockForJournal(childBlock, journalBlockId, null)) {
        continue
      }

      for (const nestedChildId of childBlock.children) {
        pushCandidate(nestedChildId)
      }
    }
  }

  for (const candidateId of candidateIds) {
    const candidateBlock = await getBlockById(candidateId)
    if (candidateBlock == null) {
      continue
    }

    const hasMyDayMarker = candidateBlock.properties.some((property) => {
      return (
        property.name === MY_DAY_ENTRY_TASK_ID_PROPERTY ||
        property.name === MY_DAY_ENTRY_DAY_KEY_PROPERTY
      )
    })
    if (!hasMyDayMarker) {
      continue
    }

    await sanitizeMyDayInsertTokenOnBlock(candidateBlock.id, candidateBlock)
  }
}

export async function removeMyDayMirrorBlock(
  mirrorBlockId: DbId | null | undefined,
): Promise<void> {
  const normalizedMirrorId = normalizeRawDbId(mirrorBlockId)
  if (normalizedMirrorId == null) {
    return
  }

  const existingId = await resolveExistingBlockId([normalizedMirrorId])
  if (existingId == null) {
    return
  }

  const block = await getBlockById(existingId)
  if (block == null) {
    return
  }

  const hasMyDayMarker = block.properties.some((property) => {
    return (
      property.name === MY_DAY_ENTRY_TASK_ID_PROPERTY ||
      property.name === MY_DAY_ENTRY_DAY_KEY_PROPERTY
    )
  })
  if (!hasMyDayMarker) {
    return
  }

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.deleteBlocks",
      null,
      [existingId],
    )
  } catch (error) {
    console.error(error)
  }
}

function normalizeMyDayState(raw: unknown, currentDayKey: string): NormalizeResult {
  const fallback = createDefaultMyDayState(currentDayKey)
  if (!isRecord(raw)) {
    return {
      state: fallback,
      changed: true,
    }
  }

  let changed = false
  const schema = normalizePositiveInt(raw.schema, MY_DAY_SCHEMA_VERSION)
  if (schema !== (raw.schema as number | undefined)) {
    changed = true
  }

  const storedDayKey = typeof raw.dayKey === "string" ? raw.dayKey.trim() : ""
  const effectiveDayKey = storedDayKey === "" ? currentDayKey : storedDayKey
  if (effectiveDayKey !== storedDayKey) {
    changed = true
  }

  const displayMode: MyDayDisplayMode = raw.displayMode === "schedule" ? "schedule" : "list"
  if (displayMode !== raw.displayMode) {
    changed = true
  }

  const journalSectionBlockId = normalizeRawDbId(raw.journalSectionBlockId)
  if (journalSectionBlockId !== raw.journalSectionBlockId) {
    changed = true
  }

  const normalizedTasksResult = normalizeMyDayTasks(raw.tasks)
  if (normalizedTasksResult.changed) {
    changed = true
  }

  let normalizedState: MyDayState = {
    schema,
    dayKey: effectiveDayKey,
    displayMode,
    journalSectionBlockId,
    tasks: normalizedTasksResult.tasks,
    updatedAt: normalizeTimestamp(raw.updatedAt) ?? Date.now(),
  }

  if (effectiveDayKey !== currentDayKey) {
    normalizedState = {
      ...normalizedState,
      dayKey: currentDayKey,
      journalSectionBlockId: null,
      tasks: [],
      updatedAt: Date.now(),
    }
    changed = true
  }

  return {
    state: normalizedState,
    changed,
  }
}

function normalizeMyDayTasks(raw: unknown): {
  tasks: MyDayTaskEntry[]
  changed: boolean
} {
  if (!Array.isArray(raw)) {
    return {
      tasks: [],
      changed: true,
    }
  }

  const normalized: MyDayTaskEntry[] = []
  const seenTaskIds = new Set<DbId>()
  let changed = false

  for (const item of raw) {
    const normalizedEntry = normalizeMyDayTaskEntry(item)
    if (normalizedEntry == null) {
      changed = true
      continue
    }

    if (seenTaskIds.has(normalizedEntry.taskId)) {
      changed = true
      continue
    }

    seenTaskIds.add(normalizedEntry.taskId)
    normalized.push(normalizedEntry)
  }

  normalized.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order
    }
    if (left.addedAt !== right.addedAt) {
      return left.addedAt - right.addedAt
    }
    return left.taskId - right.taskId
  })

  const resequenced = normalized.map((item: MyDayTaskEntry, index: number) => {
    if (item.order === index) {
      return item
    }

    changed = true
    return {
      ...item,
      order: index,
    }
  })

  return {
    tasks: resequenced,
    changed,
  }
}

function normalizeMyDayTaskEntry(raw: unknown): MyDayTaskEntry | null {
  if (!isRecord(raw)) {
    return null
  }

  const taskId = normalizeTaskDbId(raw.taskId)
  if (taskId == null) {
    return null
  }

  const sourceBlockId = normalizeTaskDbId(raw.sourceBlockId)
  const addedAt = normalizeTimestamp(raw.addedAt) ?? Date.now()
  const order = normalizePositiveInt(raw.order, 0)
  const [scheduleStartMinute, scheduleEndMinute] = normalizeScheduleRange(
    normalizeMinute(raw.scheduleStartMinute),
    normalizeMinute(raw.scheduleEndMinute),
  )
  const mirrorBlockId = normalizeRawDbId(raw.mirrorBlockId)

  return {
    taskId,
    sourceBlockId,
    addedAt,
    scheduleStartMinute,
    scheduleEndMinute,
    order,
    mirrorBlockId,
  }
}

function normalizeScheduleRange(
  startMinute: number | null,
  endMinute: number | null,
): [number | null, number | null] {
  if (startMinute == null || endMinute == null) {
    return [null, null]
  }

  const normalizedDuration = resolveScheduleDurationMinutes(startMinute, endMinute)
  if (normalizedDuration != null) {
    return [
      startMinute,
      normalizeScheduleEndMinute(startMinute, normalizedDuration),
    ]
  }

  const fallbackDuration = clampNumber(
    DEFAULT_SCHEDULE_DURATION_MINUTES,
    MIN_SCHEDULE_DURATION_MINUTES,
    MAX_SCHEDULE_DURATION_MINUTES,
  )
  const fallbackEndMinute = normalizeScheduleEndMinute(startMinute, fallbackDuration)
  if (resolveScheduleDurationMinutes(startMinute, fallbackEndMinute) == null) {
    return [null, null]
  }

  return [startMinute, fallbackEndMinute]
}

function resolveScheduleDurationMinutes(startMinute: number, endMinute: number): number | null {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return null
  }

  const normalizedStartMinute = clampNumber(Math.round(startMinute), 0, MINUTE_PER_DAY)
  const normalizedEndMinute = clampNumber(Math.round(endMinute), 0, MINUTE_PER_DAY)
  let duration = normalizedEndMinute - normalizedStartMinute
  if (duration <= 0) {
    duration += MINUTE_PER_DAY
  }

  if (duration < MIN_SCHEDULE_DURATION_MINUTES || duration > MAX_SCHEDULE_DURATION_MINUTES) {
    return null
  }

  return duration
}

function normalizeScheduleEndMinute(startMinute: number, durationMinutes: number): number {
  const normalizedStartMinute = clampNumber(Math.round(startMinute), 0, MINUTE_PER_DAY)
  const normalizedDuration = clampNumber(
    Math.round(durationMinutes),
    MIN_SCHEDULE_DURATION_MINUTES,
    MAX_SCHEDULE_DURATION_MINUTES,
  )
  const rawEndMinute = normalizedStartMinute + normalizedDuration
  if (rawEndMinute > MINUTE_PER_DAY) {
    return rawEndMinute - MINUTE_PER_DAY
  }

  return rawEndMinute
}

function normalizeMinute(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }

  const minute = Math.round(value)
  if (minute < 0 || minute > MINUTE_PER_DAY) {
    return null
  }

  return minute
}

function normalizeTaskDbId(value: unknown): DbId | null {
  if (!isValidDbId(value)) {
    return null
  }

  return getMirrorId(value)
}

function normalizeRawDbId(value: unknown): DbId | null {
  if (!isValidDbId(value)) {
    return null
  }

  return value
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  return normalized < 0 ? fallback : normalized
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }

  return value
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value))
}

async function persistMyDayState(pluginName: string, state: MyDayState): Promise<void> {
  await orca.plugins.setData(
    pluginName,
    MY_DAY_DATA_KEY,
    JSON.stringify(state),
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value != null
}

async function resolveJournalBlockByDayKey(dayKey: string): Promise<Block | null> {
  const dayKeyDate = parseDayKeyToDate(dayKey)
  try {
    return (await orca.invokeBackend(
      "get-journal-block",
      dayKeyDate ?? new Date(),
    )) as Block | null
  } catch (error) {
    console.error(error)
    return null
  }
}

async function resolveTodayJournalBlock(): Promise<Block | null> {
  try {
    return (await orca.invokeBackend(
      "get-journal-block",
      new Date(),
    )) as Block | null
  } catch (error) {
    console.error(error)
    return null
  }
}

function parseDayKeyToDate(dayKey: string): Date | null {
  if (typeof dayKey !== "string") {
    return null
  }

  const match = dayKey.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match == null) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null
  }

  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

async function ensureMyDaySectionBlockId(
  journalBlock: Block,
  dayKey: string,
  sectionTitle: string,
  existingSectionBlockId?: DbId | null,
): Promise<DbId | null> {
  const journalBlockId = normalizeRawDbId(journalBlock.id)
  if (journalBlockId == null) {
    return null
  }

  const candidateSectionIds = dedupeDbIds([normalizeRawDbId(existingSectionBlockId)])
  for (const candidateId of candidateSectionIds) {
    const existingId = await resolveExistingBlockId([candidateId])
    if (existingId == null) {
      continue
    }

    const existingBlock = await getBlockById(existingId)
    if (
      existingBlock != null &&
      isMyDaySectionBlockForJournal(existingBlock, journalBlockId, dayKey)
    ) {
      return existingId
    }
  }

  const discoveredSectionId = await findMyDaySectionInJournal(journalBlock)
  if (discoveredSectionId != null) {
    return discoveredSectionId
  }

  const insertedId = await insertTextChildBlock(
    journalBlockId,
    journalBlock,
    sectionTitle,
  )
  if (insertedId == null) {
    return null
  }

  try {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [insertedId],
        [
          {
            name: MY_DAY_SECTION_MARKER_PROPERTY,
            type: PROP_TYPE_BOOLEAN,
            value: true,
          },
          {
            name: MY_DAY_ENTRY_DAY_KEY_PROPERTY,
            type: PROP_TYPE_TEXT,
            value: dayKey,
          },
        ],
      )
    } catch (error) {
      console.error(error)
    }

    return insertedId
  } catch (error) {
    console.error(error)
    return null
  }
}

async function findMyDaySectionInJournal(
  journalBlock: Block,
): Promise<DbId | null> {
  const journalBlockId = normalizeRawDbId(journalBlock.id)
  if (journalBlockId == null) {
    return null
  }

  for (const childId of journalBlock.children) {
    const resolvedId = await resolveExistingBlockId([childId])
    if (resolvedId == null) {
      continue
    }

    const childBlock = await getBlockById(resolvedId)
    if (childBlock == null) {
      continue
    }

    if (isMyDaySectionBlockForJournal(childBlock, journalBlockId, null)) {
      return resolvedId
    }
  }

  return null
}

async function insertMyDayMirrorBlock(
  sectionBlockId: DbId,
  taskId: DbId,
  dayKey: string,
): Promise<DbId | null> {
  const existingSectionId = await resolveExistingBlockId([sectionBlockId])
  if (existingSectionId == null) {
    return null
  }
  const sectionBlock = await getBlockById(existingSectionId)
  if (sectionBlock == null) {
    return null
  }

  const existingEntryId = await findMyDayJournalEntryBlockId(
    existingSectionId,
    taskId,
    dayKey,
  )
  if (existingEntryId != null) {
    const normalizedExistingEntryId = await ensureMyDayEntryUnderParent(
      existingEntryId,
      existingSectionId,
    )
    const existingEntryBlock = await getBlockById(normalizedExistingEntryId)
    if (existingEntryBlock != null && isMirrorBlockForTask(existingEntryBlock, taskId)) {
      await cleanupDuplicateMyDayJournalEntries(
        existingSectionId,
        taskId,
        dayKey,
        normalizedExistingEntryId,
      )
      return normalizedExistingEntryId
    }

    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.deleteBlocks",
        null,
        [normalizedExistingEntryId],
      )
    } catch (error) {
      console.error(error)
    }
  }

  let createdBlockId = await insertMirrorChildBlock(
    existingSectionId,
    sectionBlock,
    taskId,
  )
  if (createdBlockId == null) {
    await delayMs(80)
    const refreshedSectionBlock = await getBlockById(existingSectionId)
    if (refreshedSectionBlock != null) {
      createdBlockId = await insertMirrorChildBlock(
        existingSectionId,
        refreshedSectionBlock,
        taskId,
      )
    }
  }

  if (createdBlockId == null) {
    return null
  }

  createdBlockId = await unwrapMyDayEntryWrapperBlock(
    existingSectionId,
    createdBlockId,
    taskId,
  )

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [createdBlockId],
      [
        {
          name: MY_DAY_ENTRY_TASK_ID_PROPERTY,
          type: PROP_TYPE_NUMBER,
          value: taskId,
        },
        {
          name: MY_DAY_ENTRY_DAY_KEY_PROPERTY,
          type: PROP_TYPE_TEXT,
          value: dayKey,
        },
      ],
    )
  } catch (error) {
    console.error(error)
  }

  await cleanupDuplicateMyDayJournalEntries(
    existingSectionId,
    taskId,
    dayKey,
    createdBlockId,
  )

  return createdBlockId
}

async function normalizeMyDayJournalEntryReference(
  entryBlockId: DbId,
  entryBlock: Block,
  taskId: DbId,
): Promise<boolean> {
  const sanitizedEntryBlock = await sanitizeMyDayInsertTokenOnBlock(
    entryBlockId,
    entryBlock,
  )
  const effectiveEntryBlock = sanitizedEntryBlock ?? entryBlock

  if (isMirrorBlockForTask(effectiveEntryBlock, taskId)) {
    return true
  }

  if (blockHasTaskReferenceFragment(effectiveEntryBlock, taskId)) {
    await ensureInlineTaskRef(entryBlockId, taskId)
    return true
  }

  const taskLabel = await resolveTaskReferenceLabel(taskId)
  const setAsReference = await setBlockTaskReferenceContent(
    entryBlockId,
    taskId,
    taskLabel,
  )
  if (!setAsReference) {
    return false
  }

  const normalizedBlock = await getBlockById(entryBlockId)
  if (normalizedBlock == null) {
    return false
  }

  return blockHasTaskReferenceFragment(normalizedBlock, taskId)
}

async function ensureMyDayEntryUnderParent(
  entryBlockId: DbId,
  parentBlockId: DbId,
): Promise<DbId> {
  const entryBlock = await getBlockById(entryBlockId)
  if (entryBlock == null) {
    return entryBlockId
  }

  if (isSameParentBlock(entryBlock.parent, parentBlockId)) {
    return entryBlock.id
  }

  const previousParentId = normalizeRawDbId(entryBlock.parent)
  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.moveBlocks",
      null,
      [entryBlock.id],
      parentBlockId,
      "lastChild",
    )
  } catch (error) {
    console.error(error)
    return entryBlock.id
  }

  const movedEntryId = (await resolveExistingBlockId([entryBlock.id])) ?? entryBlock.id
  if (previousParentId != null && previousParentId !== parentBlockId) {
    await cleanupLegacyMyDaySectionIfEmpty(previousParentId, parentBlockId)
  }

  return movedEntryId
}

function isSameParentBlock(
  parentId: DbId | undefined,
  expectedParentId: DbId,
): boolean {
  if (!isValidDbId(parentId)) {
    return false
  }

  if (parentId === expectedParentId) {
    return true
  }

  return getMirrorId(parentId) === getMirrorId(expectedParentId)
}

async function cleanupLegacyMyDaySectionIfEmpty(
  sectionBlockId: DbId,
  journalBlockId: DbId,
): Promise<void> {
  const sectionBlock = await getBlockById(sectionBlockId)
  if (sectionBlock == null) {
    return
  }

  if (!isMyDaySectionBlockForJournal(sectionBlock, journalBlockId, null)) {
    return
  }

  if (sectionBlock.children.length > 0 || !isBlockContentEmpty(sectionBlock)) {
    return
  }

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.deleteBlocks",
      null,
      [sectionBlock.id],
    )
  } catch (error) {
    console.error(error)
  }
}

async function isLegacyMyDayMirrorEntryBlock(
  entryBlock: Block,
  taskId: DbId,
): Promise<boolean> {
  if (isMirrorBlockForTask(entryBlock, taskId)) {
    return true
  }

  const hasSingleChild = Array.isArray(entryBlock.children) && entryBlock.children.length === 1
  if (!hasSingleChild || !isBlockContentEmpty(entryBlock)) {
    return false
  }

  const childId = entryBlock.children[0]
  if (!isValidDbId(childId)) {
    return false
  }

  const childBlock = await getBlockById(childId)
  if (childBlock == null) {
    return false
  }

  return isMirrorBlockForTask(childBlock, taskId)
}

async function unwrapMyDayEntryWrapperBlock(
  sectionBlockId: DbId,
  entryBlockId: DbId,
  taskId: DbId,
): Promise<DbId> {
  const entryBlock = await getBlockById(entryBlockId)
  if (entryBlock == null) {
    return entryBlockId
  }

  const hasSingleChild = Array.isArray(entryBlock.children) && entryBlock.children.length === 1
  if (!hasSingleChild || !isBlockContentEmpty(entryBlock)) {
    return entryBlockId
  }

  const childId = entryBlock.children[0]
  if (!isValidDbId(childId)) {
    return entryBlockId
  }

  const childBlock = await getBlockById(childId)
  if (childBlock == null) {
    return entryBlockId
  }

  const childRepresentsTask =
    isMirrorBlockForTask(childBlock, taskId) ||
    blockContainsInlineTaskReference(childBlock, taskId)
  if (!childRepresentsTask) {
    return entryBlockId
  }

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.moveBlocks",
      null,
      [childBlock.id],
      entryBlock.id,
      "after",
    )
    await orca.commands.invokeEditorCommand(
      "core.editor.deleteBlocks",
      null,
      [entryBlock.id],
    )
    const movedChild = await resolveExistingBlockId([childBlock.id])
    if (movedChild != null) {
      return movedChild
    }
  } catch (error) {
    console.error(error)
    return entryBlockId
  }

  const sectionBlock = await getBlockById(sectionBlockId)
  if (sectionBlock != null) {
    const siblingId = sectionBlock.children.find((id) => id === childBlock.id)
    if (isValidDbId(siblingId)) {
      return siblingId
    }
  }

  return childBlock.id
}

function isBlockContentEmpty(block: Block): boolean {
  const text = typeof block.text === "string" ? block.text.trim() : ""
  if (text !== "") {
    return false
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return true
  }

  return block.content.every((fragment) => {
    return typeof fragment?.v !== "string" || fragment.v.trim() === ""
  })
}

function isMirrorBlockForTask(
  block: Block,
  taskId: DbId,
): boolean {
  const repr = block.properties.find((item) => item.name === "_repr")?.value as
    | { type?: string; mirroredId?: DbId }
    | undefined

  if (repr?.type === "mirror" && normalizeTaskDbId(repr.mirroredId) === taskId) {
    return true
  }

  return getMirrorId(block.id) === taskId
}

async function insertTaskReferenceChildBlock(
  parentBlockId: DbId,
  parentBlock: Block,
  taskId: DbId,
): Promise<DbId | null> {
  const taskLabel = await resolveTaskReferenceLabel(taskId)
  const referenceContentVariants = createTaskReferenceContentVariants(taskId, taskLabel)
  const parentCandidates: Array<Block | DbId> = [parentBlock, parentBlockId]

  for (const parent of parentCandidates) {
    for (const referenceContent of referenceContentVariants) {
      const childIdsBeforeInsert = await readChildBlockIdSet(parentBlockId)
      try {
        const insertedResult = await orca.commands.invokeEditorCommand(
          "core.editor.insertBlock",
          null,
          parent,
          "lastChild",
          referenceContent,
        )

        const insertedId = await resolveInsertedChildBlockId(
          parentBlockId,
          childIdsBeforeInsert,
          pickDbIdFromResult(insertedResult),
        )
        if (insertedId == null) {
          continue
        }

        const normalized = await setBlockTaskReferenceContent(
          insertedId,
          taskId,
          taskLabel,
        )
        if (normalized) {
          return insertedId
        }
      } catch (error) {
        console.error(error)
      }
    }
  }

  return null
}

async function insertMirrorChildBlock(
  parentBlockId: DbId,
  parentBlock: Block,
  taskId: DbId,
): Promise<DbId | null> {
  const childIdsBeforeInsert = await readChildBlockIdSet(parentBlockId)
  const parentCandidates: Array<Block | DbId> = [parentBlock, parentBlockId]

  for (const parent of parentCandidates) {
    try {
      const insertedResult = await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        parent,
        "lastChild",
        undefined,
        {
          type: "mirror",
          mirroredId: taskId,
        },
      )

      const insertedId = await resolveInsertedChildBlockId(
        parentBlockId,
        childIdsBeforeInsert,
        pickDbIdFromResult(insertedResult),
      )
      if (insertedId == null) {
        continue
      }

      const insertedBlock = await getBlockById(insertedId)
      if (insertedBlock == null) {
        continue
      }

      const repr = insertedBlock.properties.find((item) => item.name === "_repr")?.value as
        | { type?: string; mirroredId?: DbId }
        | undefined
      if (
        repr?.type === "mirror" &&
        normalizeTaskDbId(repr.mirroredId) === taskId
      ) {
        return insertedId
      }

      if (insertedBlock.id === taskId || getMirrorId(insertedBlock.id) === taskId) {
        return insertedId
      }
    } catch (error) {
      console.error(error)
    }
  }

  return null
}

async function ensureInlineTaskRef(
  sourceBlockId: DbId,
  taskId: DbId,
): Promise<void> {
  const sourceBlock = await getBlockById(sourceBlockId)
  if (sourceBlock == null) {
    return
  }

  const hasInlineRef = sourceBlock.refs.some((ref) => {
    return ref.type === INLINE_REF_TYPE && normalizeTaskDbId(ref.to) === taskId
  })
  if (hasInlineRef) {
    return
  }

  const resolvedTaskId =
    (await resolveExistingBlockId([taskId, getMirrorId(taskId)])) ?? taskId

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.createRef",
      null,
      sourceBlockId,
      resolvedTaskId,
      INLINE_REF_TYPE,
    )
  } catch (error) {
    console.error(error)
  }
}

function createTaskReferenceContent(taskId: DbId, taskLabel: string): Array<Record<string, unknown>> {
  const normalizedLabel = taskLabel.trim() === "" ? `#${taskId}` : taskLabel
  return [
    {
      t: CONTENT_TYPE_LINK,
      v: normalizedLabel,
      u: taskId,
    },
  ]
}

function createTaskReferenceContentVariants(
  taskId: DbId,
  taskLabel: string,
): Array<Array<Record<string, unknown>>> {
  const normalizedLabel = taskLabel.trim() === "" ? `#${taskId}` : taskLabel
  return [
    createTaskReferenceContent(taskId, normalizedLabel),
    [{ t: CONTENT_TYPE_LINK, v: normalizedLabel, u: String(taskId) }],
    [{ t: CONTENT_TYPE_LINK, v: normalizedLabel, u: `((${taskId}))` }],
  ]
}

async function resolveTaskReferenceLabel(taskId: DbId): Promise<string> {
  const taskBlock = await getBlockById(taskId)
  const blockText = typeof taskBlock?.text === "string" ? taskBlock.text.trim() : ""
  if (blockText !== "") {
    return blockText
  }

  return `#${taskId}`
}

async function setBlockTaskReferenceContent(
  blockId: DbId,
  taskId: DbId,
  taskLabel: string,
): Promise<boolean> {
  const contentVariants = createTaskReferenceContentVariants(taskId, taskLabel)

  for (const content of contentVariants) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setBlocksContent",
        null,
        [
          {
            id: blockId,
            content,
          },
        ],
        false,
      )
    } catch (error) {
      console.error(error)
    }

    const updatedBlock = await getBlockById(blockId)
    if (updatedBlock != null && blockHasTaskReferenceFragment(updatedBlock, taskId)) {
      await ensureInlineTaskRef(blockId, taskId)
      return true
    }
  }

  await ensureInlineTaskRef(blockId, taskId)
  return false
}

async function resolveExistingBlockId(
  candidateIds: DbId[],
): Promise<DbId | null> {
  const normalizedIds = dedupeDbIds(candidateIds)
  for (const candidateId of normalizedIds) {
    if (orca.state.blocks[candidateId] != null) {
      return candidateId
    }

    const fetchedBlock = await getBlockById(candidateId)
    if (fetchedBlock != null) {
      return normalizeRawDbId(fetchedBlock.id)
    }
  }

  return null
}

async function getBlockById(blockId: DbId): Promise<Block | null> {
  const stateBlock = orca.state.blocks[blockId] ?? null
  if (stateBlock != null) {
    return stateBlock
  }

  const mirrorId = getMirrorId(blockId)
  if (mirrorId !== blockId && orca.state.blocks[mirrorId] != null) {
    return orca.state.blocks[mirrorId]
  }

  try {
    const fetchedBlock = (await orca.invokeBackend("get-block", blockId)) as Block | null
    if (fetchedBlock != null) {
      return fetchedBlock
    }

    if (mirrorId !== blockId) {
      return (await orca.invokeBackend("get-block", mirrorId)) as Block | null
    }

    return null
  } catch (error) {
    console.error(error)
    return null
  }
}

async function insertTextChildBlock(
  parentBlockId: DbId,
  parentBlock: Block,
  text: string,
): Promise<DbId | null> {
  const safeText = normalizeMyDayInsertedText(text)
  const parentCandidates: Array<Block | DbId> = [parentBlock, parentBlockId]

  for (const parent of parentCandidates) {
    const childIdsBeforeInsert = await readChildBlockIdSet(parentBlockId)
    let insertedResult: unknown = null
    try {
      insertedResult = await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        parent,
        "lastChild",
        [{ t: "t", v: safeText }],
      )
    } catch (error) {
      console.error(error)
    }

    const insertedId = await resolveInsertedChildBlockId(
      parentBlockId,
      childIdsBeforeInsert,
      pickDbIdFromResult(insertedResult),
    )
    if (insertedId != null) {
      await sanitizeMyDayInsertTokenOnBlock(insertedId, null)
      return insertedId
    }
  }

  for (const parent of parentCandidates) {
    const childIdsBeforeInsert = await readChildBlockIdSet(parentBlockId)
    let insertedResult: unknown = null
    try {
      insertedResult = await orca.commands.invokeEditorCommand(
        "core.editor.batchInsertText",
        null,
        parent,
        "lastChild",
        safeText,
        false,
        true,
      )
    } catch (error) {
      console.error(error)
    }

    const insertedId = await resolveInsertedChildBlockId(
      parentBlockId,
      childIdsBeforeInsert,
      pickDbIdFromResult(insertedResult),
    )
    if (insertedId != null) {
      await sanitizeMyDayInsertTokenOnBlock(insertedId, null)
      return insertedId
    }
  }

  const detachedInsertedId = await createDetachedTextBlock(safeText)
  if (detachedInsertedId != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.moveBlocks",
        null,
        [detachedInsertedId],
        parentBlockId,
        "lastChild",
      )
      const insertedId =
        (await resolveExistingBlockId([detachedInsertedId])) ?? detachedInsertedId
      await sanitizeMyDayInsertTokenOnBlock(insertedId, null)
      return insertedId
    } catch (error) {
      console.error(error)
    }
  }

  return null
}

async function createDetachedTextBlock(text: string): Promise<DbId | null> {
  try {
    const result = await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      null,
      null,
      [{ t: "t", v: text }],
    )
    return pickDbIdFromResult(result)
  } catch (error) {
    console.error(error)
    return null
  }
}

async function setBlockTextContent(
  blockId: DbId,
  text: string,
): Promise<void> {
  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.setBlocksContent",
      null,
      [
        {
          id: blockId,
          content: [{ t: "t", v: text }],
        },
      ],
      false,
    )
  } catch (error) {
    console.error(error)
  }
}

async function sanitizeMyDayInsertTokenOnBlock(
  blockId: DbId,
  block: Block | null,
): Promise<Block | null> {
  const currentBlock = block ?? (await getBlockById(blockId))
  if (currentBlock == null) {
    return null
  }

  const currentText = resolveBlockTextForTokenCleanup(currentBlock)
  const tokenStrippedText = stripMyDayInsertToken(currentText)
  const hadToken = tokenStrippedText !== currentText
  const cleanedText = hadToken
    ? removeTrailingHashWords(tokenStrippedText).trim()
    : tokenStrippedText
  if (cleanedText === currentText) {
    return currentBlock
  }

  await setBlockTextContent(blockId, cleanedText)
  return await getBlockById(blockId)
}

function resolveBlockTextForTokenCleanup(block: Block): string {
  if (typeof block.text === "string" && block.text.trim() !== "") {
    return block.text
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return ""
  }

  return block.content
    .map((fragment) => {
      return typeof fragment?.v === "string" ? fragment.v : ""
    })
    .join("")
}

function normalizeMyDayInsertedText(text: string): string {
  const stripped = stripMyDayInsertToken(text)
  const normalized = removeTrailingHashWords(stripped).trim()
  if (normalized !== "") {
    return normalized
  }

  return text.trim()
}

function stripMyDayInsertToken(text: string): string {
  return text.replace(MY_DAY_INSERT_TOKEN_PATTERN, "")
}

function removeTrailingHashWords(text: string): string {
  return text.replace(/(?:\s+#\S+)+\s*$/g, "")
}

async function readChildBlockIdSet(blockId: DbId): Promise<Set<DbId>> {
  const block = await getBlockById(blockId)
  if (block == null) {
    return new Set<DbId>()
  }

  return new Set<DbId>(dedupeDbIds(block.children))
}

async function resolveInsertedChildBlockId(
  parentBlockId: DbId,
  childIdsBeforeInsert: Set<DbId>,
  insertedCandidateId: DbId | null,
): Promise<DbId | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parentBlock = await getBlockById(parentBlockId)
    if (parentBlock != null) {
      const childIdsAfterInsert = dedupeDbIds(parentBlock.children)
      if (
        insertedCandidateId != null &&
        !childIdsBeforeInsert.has(insertedCandidateId) &&
        childIdsAfterInsert.includes(insertedCandidateId)
      ) {
        return insertedCandidateId
      }

      for (let index = childIdsAfterInsert.length - 1; index >= 0; index -= 1) {
        const childId = childIdsAfterInsert[index]
        if (!childIdsBeforeInsert.has(childId)) {
          return childId
        }
      }
    }

    await delayMs(40)
  }

  return null
}

function pickDbIdFromResult(result: unknown): DbId | null {
  if (isValidDbId(result)) {
    return result
  }

  if (isRecord(result)) {
    const idValue = (result as { id?: unknown }).id
    if (isValidDbId(idValue)) {
      return idValue
    }
  }

  if (!Array.isArray(result)) {
    return null
  }

  for (const value of result) {
    const nested = pickDbIdFromResult(value)
    if (nested != null) {
      return nested
    }
  }

  return null
}

function isMyDaySectionBlockForJournal(
  block: Block,
  journalBlockId: DbId,
  expectedDayKey: string | null,
): boolean {
  const marker = block.properties.find((item) => item.name === MY_DAY_SECTION_MARKER_PROPERTY)
  if (marker?.value !== true) {
    return false
  }

  if (!isSectionParentJournal(block.parent, journalBlockId)) {
    return false
  }

  if (expectedDayKey == null) {
    return true
  }

  const dayKeyValue = block.properties.find((item) => {
    return item.name === MY_DAY_ENTRY_DAY_KEY_PROPERTY
  })?.value

  return typeof dayKeyValue !== "string" || dayKeyValue === expectedDayKey
}

function isSectionParentJournal(
  parentId: DbId | undefined,
  journalBlockId: DbId,
): boolean {
  if (!isValidDbId(parentId)) {
    return false
  }

  if (parentId === journalBlockId) {
    return true
  }

  return getMirrorId(parentId) === getMirrorId(journalBlockId)
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function findMyDayJournalEntryBlockId(
  sectionBlockId: DbId,
  taskId: DbId,
  dayKey: string,
): Promise<DbId | null> {
  const entryIds = await listMyDayJournalEntryBlockIds(sectionBlockId, taskId, dayKey)
  return entryIds[0] ?? null
}

async function listMyDayJournalEntryBlockIds(
  sectionBlockId: DbId,
  taskId: DbId,
  dayKey: string,
): Promise<DbId[]> {
  const sectionBlock = await getBlockById(sectionBlockId)
  if (sectionBlock == null) {
    return []
  }

  const matches: DbId[] = []

  for (const childId of sectionBlock.children) {
    const childBlock = await getBlockById(childId)
    if (childBlock == null) {
      continue
    }

    if (isMyDayJournalEntryBlock(childBlock, taskId, dayKey)) {
      matches.push(childBlock.id)
    }
  }

  const journalBlockId = normalizeRawDbId(sectionBlock.id)
  if (journalBlockId == null) {
    return dedupeDbIds(matches)
  }

  for (const childId of sectionBlock.children) {
    const childBlock = await getBlockById(childId)
    if (childBlock == null) {
      continue
    }

    if (!isMyDaySectionBlockForJournal(childBlock, journalBlockId, null)) {
      continue
    }

    for (const nestedChildId of childBlock.children) {
      const nestedChildBlock = await getBlockById(nestedChildId)
      if (nestedChildBlock == null) {
        continue
      }

      if (isMyDayJournalEntryBlock(nestedChildBlock, taskId, dayKey)) {
        matches.push(nestedChildBlock.id)
      }
    }
  }

  return dedupeDbIds(matches)
}

async function cleanupDuplicateMyDayJournalEntries(
  sectionBlockId: DbId,
  taskId: DbId,
  dayKey: string,
  keepEntryId: DbId,
): Promise<void> {
  const entryIds = await listMyDayJournalEntryBlockIds(sectionBlockId, taskId, dayKey)
  const duplicateIds = entryIds.filter((item) => item !== keepEntryId)
  if (duplicateIds.length === 0) {
    return
  }

  const removableIds: DbId[] = []
  for (const candidateId of duplicateIds) {
    const candidateBlock = await getBlockById(candidateId)
    if (candidateBlock == null) {
      continue
    }

    const hasMyDayMarker = candidateBlock.properties.some((property) => {
      return (
        property.name === MY_DAY_ENTRY_TASK_ID_PROPERTY ||
        property.name === MY_DAY_ENTRY_DAY_KEY_PROPERTY
      )
    })
    if (hasMyDayMarker) {
      removableIds.push(candidateId)
    }
  }

  if (removableIds.length === 0) {
    return
  }

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.deleteBlocks",
      null,
      removableIds,
    )
  } catch (error) {
    console.error(error)
  }
}

function isMyDayJournalEntryBlock(
  block: Block,
  taskId: DbId,
  dayKey: string,
): boolean {
  const markedTaskId = normalizeTaskDbId(
    block.properties.find((item) => item.name === MY_DAY_ENTRY_TASK_ID_PROPERTY)?.value,
  )
  const markedDayKey = block.properties.find((item) => {
    return item.name === MY_DAY_ENTRY_DAY_KEY_PROPERTY
  })?.value

  if (
    markedTaskId != null &&
    markedTaskId === taskId &&
    (typeof markedDayKey !== "string" || markedDayKey === dayKey)
  ) {
    return true
  }

  const repr = block.properties.find((item) => item.name === "_repr")?.value as
    | { type?: string; mirroredId?: DbId }
    | undefined
  if (
    markedTaskId == null &&
    repr?.type === "mirror" &&
    normalizeTaskDbId(repr.mirroredId) === taskId
  ) {
    return true
  }

  if (
    markedTaskId == null &&
    blockContainsInlineTaskReference(block, taskId)
  ) {
    return true
  }

  return false
}

function blockContainsInlineTaskReference(block: Block, taskId: DbId): boolean {
  if (blockHasTaskReferenceFragment(block, taskId)) {
    return true
  }

  const hasInlineRef = block.refs.some((ref) => {
    return ref.type === INLINE_REF_TYPE && normalizeTaskDbId(ref.to) === taskId
  })
  if (hasInlineRef) {
    return true
  }

  const pattern = `((${taskId}))`
  if (typeof block.text === "string" && block.text.includes(pattern)) {
    return true
  }

  if (!Array.isArray(block.content) || block.content.length === 0) {
    return false
  }

  return block.content.some((fragment) => {
    return typeof fragment?.v === "string" && fragment.v.includes(pattern)
  })
}

function blockHasTaskReferenceFragment(block: Block, taskId: DbId): boolean {
  if (!Array.isArray(block.content) || block.content.length === 0) {
    return false
  }

  return block.content.some((fragment) => {
    if (!isRecord(fragment)) {
      return false
    }

    if ((fragment as { t?: unknown }).t !== CONTENT_TYPE_LINK) {
      return false
    }

    const fragmentTargetTaskId = normalizeTaskDbId(
      parseTaskReferenceTarget((fragment as { u?: unknown }).u),
    )
    return fragmentTargetTaskId != null && fragmentTargetTaskId === taskId
  })
}

function parseTaskReferenceTarget(rawTarget: unknown): DbId | null {
  if (isValidDbId(rawTarget)) {
    return rawTarget
  }

  if (!isRecord(rawTarget)) {
    return parseTaskReferenceTargetString(rawTarget)
  }

  const nestedId = (rawTarget as { id?: unknown }).id
  if (nestedId != null) {
    return parseTaskReferenceTarget(nestedId)
  }

  return null
}

function parseTaskReferenceTargetString(rawTarget: unknown): DbId | null {
  if (typeof rawTarget !== "string") {
    return null
  }

  const trimmed = rawTarget.trim()
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed)
    return isValidDbId(numeric) ? numeric : null
  }

  const wrappedMatch = trimmed.match(/^\(\((\d+)\)\)$/)
  if (wrappedMatch == null) {
    return null
  }

  const numeric = Number(wrappedMatch[1])
  return isValidDbId(numeric) ? numeric : null
}
