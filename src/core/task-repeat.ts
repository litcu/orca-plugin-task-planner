import type { TaskPropertyValues } from "./task-properties"
import {
  getDefaultTaskStatus,
  isTaskDoneStatus,
  type TaskSchemaDefinition,
} from "./task-schema"

export type RepeatUnit = "day" | "week" | "month"

export interface RepeatRuleConfig {
  unit: RepeatUnit
  interval: number
  weekday: number | null
  hour: number | null
  minute: number | null
  maxCount: number | null
  endAtMs: number | null
  occurrence: number
}

interface TimeParts {
  hour: number
  minute: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_OCCURRENCE = 1
const CN = {
  everyDay: "\u6bcf\u5929",
  everyDate: "\u6bcf\u65e5",
  everyWeek: "\u6bcf\u5468",
  everyXingQi: "\u6bcf\u661f\u671f",
  everyMonth: "\u6bcf\u6708",
  everyGeMonth: "\u6bcf\u4e2a\u6708",
  day: "\u5929",
  date: "\u65e5",
  week: "\u5468",
  xingQi: "\u661f\u671f",
  month: "\u6708",
  geMonth: "\u4e2a\u6708",
} as const

const WEEKDAY_BY_TOKEN: Record<string, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  "\u5468\u65e5": 0,
  "\u5468\u5929": 0,
  "\u661f\u671f\u65e5": 0,
  "\u661f\u671f\u5929": 0,
  "\u5468\u4e00": 1,
  "\u661f\u671f\u4e00": 1,
  "\u5468\u4e8c": 2,
  "\u661f\u671f\u4e8c": 2,
  "\u5468\u4e09": 3,
  "\u661f\u671f\u4e09": 3,
  "\u5468\u56db": 4,
  "\u661f\u671f\u56db": 4,
  "\u5468\u4e94": 5,
  "\u661f\u671f\u4e94": 5,
  "\u5468\u516d": 6,
  "\u661f\u671f\u516d": 6,
}

export function parseRepeatRuleConfig(rawRule: string): RepeatRuleConfig | null {
  const normalized = rawRule.trim()
  if (normalized === "") {
    return null
  }

  return parseJsonRule(normalized) ?? parseLegacyTextRule(normalized)
}

export function stringifyRepeatRuleConfig(rule: RepeatRuleConfig): string {
  const normalizedWeekday = normalizeWeekdayValue(rule.weekday)
  const normalizedTime = normalizeTimeParts(rule.hour, rule.minute)
  const normalizedInterval = normalizePositiveInt(rule.interval, 1)
  const normalizedOccurrence = normalizePositiveInt(
    rule.occurrence,
    DEFAULT_OCCURRENCE,
  )

  const payload: Record<string, unknown> = {
    unit: rule.unit,
    interval: normalizedInterval,
    occurrence: normalizedOccurrence,
  }

  if (rule.unit === "week" && normalizedWeekday != null) {
    payload.weekday = normalizedWeekday
  }
  if (normalizedTime != null) {
    payload.time = toTimeToken(normalizedTime.hour, normalizedTime.minute)
  }
  if (rule.maxCount != null) {
    payload.maxCount = normalizePositiveInt(rule.maxCount, 1)
  }
  if (rule.endAtMs != null && Number.isFinite(rule.endAtMs)) {
    payload.endAt = Math.floor(rule.endAtMs)
  }

  return JSON.stringify(payload)
}

export function buildNextRecurringTaskValues(
  previousStatus: string,
  nextValues: TaskPropertyValues,
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): TaskPropertyValues | null {
  if (
    isTaskDoneStatus(previousStatus, schema) ||
    !isTaskDoneStatus(nextValues.status, schema)
  ) {
    return null
  }

  const rule = parseRepeatRuleConfig(nextValues.repeatRule)
  if (rule == null) {
    return null
  }

  const currentOccurrence = normalizePositiveInt(rule.occurrence, DEFAULT_OCCURRENCE)
  if (
    rule.maxCount != null &&
    currentOccurrence >= normalizePositiveInt(rule.maxCount, 1)
  ) {
    return null
  }

  const nowDate = isValidDate(now) ? now : new Date()
  const nextStartTime = shiftToNextOccurrence(nextValues.startTime, rule, nowDate)
  const nextEndTime = shiftToNextOccurrence(nextValues.endTime, rule, nowDate)

  let plannedStartTime = nextStartTime
  if (plannedStartTime == null && nextEndTime == null) {
    plannedStartTime = shiftToNextOccurrence(nowDate, rule, nowDate)
  }

  if (rule.endAtMs != null) {
    const endAtMs = Math.floor(rule.endAtMs)
    const candidateMs = plannedStartTime?.getTime() ?? nextEndTime?.getTime() ?? null
    if (candidateMs != null && candidateMs > endAtMs) {
      return null
    }
    if (candidateMs == null && nowDate.getTime() > endAtMs) {
      return null
    }
  }

  const nextRule: RepeatRuleConfig = {
    ...rule,
    occurrence: currentOccurrence + 1,
  }

  return {
    ...nextValues,
    status: getDefaultTaskStatus(schema),
    startTime: plannedStartTime,
    endTime: nextEndTime,
    repeatRule: stringifyRepeatRuleConfig(nextRule),
  }
}

function parseJsonRule(rawRule: string): RepeatRuleConfig | null {
  if (!rawRule.startsWith("{")) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawRule)
  } catch {
    return null
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  const rule = parsed as Record<string, unknown>
  const unit = normalizeUnit(
    getString(rule.unit) ?? getString(rule.freq) ?? getString(rule.frequency),
  )
  if (unit == null) {
    return null
  }

  const interval = normalizePositiveInt(rule.interval ?? rule.every, 1)
  const weekday = normalizeWeekdayValue(rule.weekday ?? rule.dayOfWeek)
  if (weekday != null && unit !== "week") {
    return null
  }

  const timeParts = parseTimeToken(getString(rule.time) ?? getString(rule.at))
  const hasRawTime = rule.time != null || rule.at != null
  if (hasRawTime && timeParts == null) {
    return null
  }

  const maxCount = normalizeOptionalPositiveInt(
    rule.maxCount ?? rule.max ?? rule.maxRepeats,
  )
  const endAtMs = parseOptionalEndAtMs(rule.endAt ?? rule.end ?? rule.until)
  const occurrence = normalizePositiveInt(
    rule.occurrence ?? rule.index ?? rule.sequence,
    DEFAULT_OCCURRENCE,
  )

  return {
    unit,
    interval,
    weekday,
    hour: timeParts?.hour ?? null,
    minute: timeParts?.minute ?? null,
    maxCount,
    endAtMs,
    occurrence,
  }
}

function parseLegacyTextRule(rawRule: string): RepeatRuleConfig | null {
  const normalizedText = normalizeText(rawRule)
  const withTime = extractTimeSuffix(normalizedText)
  if (withTime == null) {
    return null
  }

  const baseText = withTime.base.replace(/\bat$/, "").trim()
  const weekday = parseWeekdayText(baseText)
  if (weekday != null) {
    return {
      unit: "week",
      interval: 1,
      weekday,
      hour: withTime.time?.hour ?? null,
      minute: withTime.time?.minute ?? null,
      maxCount: null,
      endAtMs: null,
      occurrence: DEFAULT_OCCURRENCE,
    }
  }

  const intervalMatch = baseText.match(
    /^every\s+(\d+)\s*(day|days|week|weeks|month|months)$/i,
  )
  if (intervalMatch != null) {
    const unit = normalizeUnit(intervalMatch[2])
    if (unit == null) {
      return null
    }

    return {
      unit,
      interval: normalizePositiveInt(intervalMatch[1], 1),
      weekday: null,
      hour: withTime.time?.hour ?? null,
      minute: withTime.time?.minute ?? null,
      maxCount: null,
      endAtMs: null,
      occurrence: DEFAULT_OCCURRENCE,
    }
  }

  const escapedEvery = escapeRegExp("\u6bcf")
  const escapedDay = escapeRegExp(CN.day)
  const escapedDate = escapeRegExp(CN.date)
  const escapedWeek = escapeRegExp(CN.week)
  const escapedXingQi = escapeRegExp(CN.xingQi)
  const escapedMonth = escapeRegExp(CN.month)
  const escapedGeMonth = escapeRegExp(CN.geMonth)
  const cnIntervalMatch = baseText.match(
    new RegExp(
      `^${escapedEvery}\\s*(\\d+)\\s*(${escapedDay}|${escapedDate}|${escapedWeek}|${escapedXingQi}|${escapedMonth}|${escapedGeMonth})$`,
      "u",
    ),
  )
  if (cnIntervalMatch != null) {
    const unit = normalizeUnit(cnIntervalMatch[2])
    if (unit == null) {
      return null
    }

    return {
      unit,
      interval: normalizePositiveInt(cnIntervalMatch[1], 1),
      weekday: null,
      hour: withTime.time?.hour ?? null,
      minute: withTime.time?.minute ?? null,
      maxCount: null,
      endAtMs: null,
      occurrence: DEFAULT_OCCURRENCE,
    }
  }

  const simpleUnit = parseSimpleUnitText(baseText)
  if (simpleUnit == null) {
    return null
  }

  return {
    unit: simpleUnit,
    interval: 1,
    weekday: null,
    hour: withTime.time?.hour ?? null,
    minute: withTime.time?.minute ?? null,
    maxCount: null,
    endAtMs: null,
    occurrence: DEFAULT_OCCURRENCE,
  }
}

function parseWeekdayText(text: string): number | null {
  const english = text.match(
    /^every\s+(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)$/i,
  )
  if (english != null) {
    return normalizeWeekdayToken(english[1])
  }

  const cn = text.match(
    new RegExp(
      `^${escapeRegExp("\u6bcf")}(?:${escapeRegExp(CN.week)}|${escapeRegExp(CN.xingQi)})(\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u65e5|\u5929)$`,
      "u",
    ),
  )
  if (cn != null) {
    return normalizeWeekdayToken(`\u5468${cn[1]}`)
  }

  return null
}

function parseSimpleUnitText(text: string): RepeatUnit | null {
  if (
    text === "daily" ||
    text === "every day" ||
    text === CN.everyDay ||
    text === CN.everyDate
  ) {
    return "day"
  }
  if (
    text === "weekly" ||
    text === "every week" ||
    text === CN.everyWeek ||
    text === CN.everyXingQi
  ) {
    return "week"
  }
  if (
    text === "monthly" ||
    text === "every month" ||
    text === CN.everyMonth ||
    text === CN.everyGeMonth
  ) {
    return "month"
  }

  return null
}

function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/：/g, ":")
    .toLowerCase()
}

function extractTimeSuffix(
  text: string,
): { base: string; time: TimeParts | null } | null {
  const match = text.match(/\s+(\d{1,2})[:：](\d{2})$/)
  if (match == null) {
    return { base: text, time: null }
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!isValidTimeParts(hour, minute)) {
    return null
  }

  return {
    base: text.slice(0, match.index).trim(),
    time: { hour, minute },
  }
}

function parseTimeToken(raw: string | null): TimeParts | null {
  if (raw == null) {
    return null
  }

  const normalized = raw.trim()
  if (normalized === "") {
    return null
  }

  const match = normalized.match(/^(\d{1,2})[:：](\d{2})$/)
  if (match == null) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!isValidTimeParts(hour, minute)) {
    return null
  }

  return { hour, minute }
}

function normalizeUnit(token: unknown): RepeatUnit | null {
  if (typeof token !== "string") {
    return null
  }

  const normalized = token.trim().toLowerCase()
  if (
    normalized === "d" ||
    normalized === "day" ||
    normalized === "days" ||
    normalized === "daily" ||
    normalized === CN.day ||
    normalized === CN.date ||
    normalized === CN.everyDay ||
    normalized === CN.everyDate
  ) {
    return "day"
  }
  if (
    normalized === "w" ||
    normalized === "week" ||
    normalized === "weeks" ||
    normalized === "weekly" ||
    normalized === CN.week ||
    normalized === CN.xingQi ||
    normalized === CN.everyWeek ||
    normalized === CN.everyXingQi
  ) {
    return "week"
  }
  if (
    normalized === "m" ||
    normalized === "month" ||
    normalized === "months" ||
    normalized === "monthly" ||
    normalized === CN.month ||
    normalized === CN.geMonth ||
    normalized === CN.everyMonth ||
    normalized === CN.everyGeMonth
  ) {
    return "month"
  }

  return null
}

function normalizeWeekdayValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6) {
    return raw
  }
  if (typeof raw !== "string") {
    return null
  }
  return normalizeWeekdayToken(raw)
}

function normalizeWeekdayToken(token: string): number | null {
  const normalized = token.trim().toLowerCase()
  return WEEKDAY_BY_TOKEN[normalized] ?? null
}

function parseOptionalEndAtMs(raw: unknown): number | null {
  if (raw == null) {
    return null
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw)
  }

  if (raw instanceof Date && isValidDate(raw)) {
    return raw.getTime()
  }

  if (typeof raw !== "string") {
    return null
  }

  const normalized = raw.trim()
  if (normalized === "") {
    return null
  }

  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly != null) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2]) - 1
    const day = Number(dateOnly[3])
    const end = new Date(year, month, day, 23, 59, 59, 999)
    return isValidDate(end) ? end.getTime() : null
  }

  const parsed = new Date(normalized)
  return isValidDate(parsed) ? parsed.getTime() : null
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : fallback
}

function normalizeOptionalPositiveInt(raw: unknown): number | null {
  if (raw == null) {
    return null
  }

  const parsed = normalizePositiveInt(raw, 0)
  return parsed >= 1 ? parsed : null
}

function normalizeTimeParts(hour: unknown, minute: unknown): TimeParts | null {
  if (typeof hour !== "number" || typeof minute !== "number") {
    return null
  }

  if (!isValidTimeParts(hour, minute)) {
    return null
  }

  return { hour, minute }
}

function toTimeToken(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function isValidTimeParts(hour: number, minute: number): boolean {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  )
}

function getString(raw: unknown): string | null {
  return typeof raw === "string" ? raw : null
}

function shiftToNextOccurrence(
  anchorDate: Date | null,
  rule: RepeatRuleConfig,
  now: Date,
): Date | null {
  if (!isValidDate(anchorDate)) {
    return null
  }

  if (rule.weekday != null) {
    return shiftToNextWeekday(anchorDate, now, rule.weekday, rule)
  }

  const candidate = new Date(anchorDate.getTime())
  const referenceMs = Math.max(candidate.getTime(), now.getTime())
  applyTimeIfNeeded(candidate, rule)

  if (rule.unit === "day" || rule.unit === "week") {
    const stepMs = DAY_MS * (rule.unit === "week" ? 7 * rule.interval : rule.interval)
    if (candidate.getTime() <= referenceMs) {
      const delta = referenceMs - candidate.getTime()
      const steps = Math.floor(delta / stepMs) + 1
      candidate.setTime(candidate.getTime() + steps * stepMs)
    }
    return candidate
  }

  const preferredDay = anchorDate.getDate()
  let guard = 0
  while (candidate.getTime() <= referenceMs && guard < 2400) {
    guard += 1
    const next = addMonths(candidate, rule.interval, preferredDay)
    candidate.setTime(next.getTime())
  }

  return candidate
}

function shiftToNextWeekday(
  anchorDate: Date,
  now: Date,
  weekday: number,
  rule: RepeatRuleConfig,
): Date {
  const referenceMs = Math.max(anchorDate.getTime(), now.getTime())
  const candidate = new Date(referenceMs)
  candidate.setSeconds(anchorDate.getSeconds(), anchorDate.getMilliseconds())

  if (rule.hour != null && rule.minute != null) {
    candidate.setHours(
      rule.hour,
      rule.minute,
      anchorDate.getSeconds(),
      anchorDate.getMilliseconds(),
    )
  }

  const offset = (weekday - candidate.getDay() + 7) % 7
  candidate.setDate(candidate.getDate() + offset)
  while (candidate.getTime() <= referenceMs) {
    candidate.setDate(candidate.getDate() + 7 * rule.interval)
  }

  return candidate
}

function addMonths(date: Date, months: number, preferredDay: number): Date {
  const result = new Date(date.getTime())
  const hour = result.getHours()
  const minute = result.getMinutes()
  const second = result.getSeconds()
  const ms = result.getMilliseconds()

  result.setDate(1)
  result.setMonth(result.getMonth() + months)
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(preferredDay, lastDay))
  result.setHours(hour, minute, second, ms)

  return result
}

function applyTimeIfNeeded(target: Date, rule: RepeatRuleConfig) {
  if (rule.hour == null || rule.minute == null) {
    return
  }
  target.setHours(rule.hour, rule.minute, target.getSeconds(), target.getMilliseconds())
}

function isValidDate(date: Date | null): date is Date {
  return date != null && !Number.isNaN(date.getTime())
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
