export type ReviewUnit = "day" | "week" | "month"
export type ReviewMode = ReviewUnit | "none"
export type TaskReviewType = "single" | "cycle"

export interface ReviewRuleConfig {
  unit: ReviewUnit
  interval: number
}

export interface ReviewEditorState {
  mode: ReviewMode
  intervalText: string
}

export interface TaskReviewState {
  enabled: boolean
  type: TaskReviewType
  nextReview: Date | null
  reviewEvery: string
  lastReviewed: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function createEmptyTaskReviewState(): TaskReviewState {
  return {
    enabled: false,
    type: "single",
    nextReview: null,
    reviewEvery: "",
    lastReviewed: null,
  }
}

export function parseTaskReviewState(rawReview: string | null | undefined): TaskReviewState {
  if (typeof rawReview !== "string") {
    return createEmptyTaskReviewState()
  }

  const normalized = rawReview.trim()
  if (normalized === "") {
    return createEmptyTaskReviewState()
  }

  if (normalized.startsWith("{")) {
    try {
      const parsed = JSON.parse(normalized) as unknown
      const rule = parseReviewRuleFromUnknown(parsed)
      if (rule != null) {
        return {
          enabled: true,
          type: "cycle",
          nextReview: null,
          reviewEvery: stringifyReviewRule(rule),
          lastReviewed: null,
        }
      }

      if (isRecord(parsed)) {
        return normalizeTaskReviewRecord(parsed)
      }
    } catch {
      // Fallback to legacy plain rule parser below.
    }
  }

  const legacyRule = parseReviewRule(normalized)
  if (legacyRule != null) {
    return {
      enabled: true,
      type: "cycle",
      nextReview: null,
      reviewEvery: stringifyReviewRule(legacyRule),
      lastReviewed: null,
    }
  }

  return createEmptyTaskReviewState()
}

export function buildTaskReviewStateFromLegacyFields(
  nextReview: Date | null,
  reviewEvery: string,
  lastReviewed: Date | null,
): TaskReviewState {
  const hasData =
    nextReview != null ||
    lastReviewed != null ||
    reviewEvery.trim() !== ""

  if (!hasData) {
    return createEmptyTaskReviewState()
  }

  const type: TaskReviewType = reviewEvery.trim() === "" ? "single" : "cycle"
  return {
    enabled: true,
    type,
    nextReview: isValidDate(nextReview) ? nextReview : null,
    reviewEvery: type === "cycle" ? normalizeReviewRuleString(reviewEvery) : "",
    lastReviewed: isValidDate(lastReviewed) ? lastReviewed : null,
  }
}

export function stringifyTaskReviewState(state: TaskReviewState): string | null {
  if (!state.enabled) {
    return null
  }

  const payload: {
    enabled: boolean
    type: TaskReviewType
    nextReview: number | null
    reviewEvery?: string
    lastReviewed: number | null
  } = {
    enabled: true,
    type: state.type,
    nextReview: toTimestamp(state.nextReview),
    lastReviewed: toTimestamp(state.lastReviewed),
  }

  if (state.type === "cycle") {
    payload.reviewEvery = normalizeReviewRuleString(state.reviewEvery)
  }

  return JSON.stringify(payload)
}

export function parseReviewRule(rawRule: string): ReviewRuleConfig | null {
  const normalized = rawRule.trim()
  if (normalized === "") {
    return null
  }

  return parseJsonRule(normalized) ?? parseLegacyTextRule(normalized)
}

export function stringifyReviewRule(rule: ReviewRuleConfig): string {
  return JSON.stringify({
    unit: rule.unit,
    interval: normalizePositiveInt(rule.interval, 1),
  })
}

export function parseReviewRuleToEditorState(rawRule: string): ReviewEditorState {
  const parsed = parseReviewRule(rawRule)
  if (parsed == null) {
    return {
      mode: "none",
      intervalText: "1",
    }
  }

  return {
    mode: parsed.unit,
    intervalText: String(parsed.interval),
  }
}

export function buildReviewRuleFromEditorState(input: ReviewEditorState): string {
  if (input.mode === "none") {
    return ""
  }

  return stringifyReviewRule({
    unit: input.mode,
    interval: normalizePositiveInt(input.intervalText, 1),
  })
}

export function resolveNextReviewAfterMarkReviewed(
  review: TaskReviewState,
  now: Date = new Date(),
): Date | null {
  if (!review.enabled) {
    return null
  }

  if (review.type === "single") {
    return null
  }

  const parsedRule = parseReviewRule(review.reviewEvery)
  if (parsedRule == null) {
    return null
  }

  return addReviewInterval(now, parsedRule)
}

export function resolveEffectiveNextReview(
  review: TaskReviewState,
): Date | null {
  if (!review.enabled) {
    return null
  }

  if (isValidDate(review.nextReview)) {
    return review.nextReview
  }

  if (review.type !== "cycle") {
    return null
  }

  if (!isValidDate(review.lastReviewed)) {
    return null
  }

  const parsedRule = parseReviewRule(review.reviewEvery)
  if (parsedRule == null) {
    return null
  }

  return addReviewInterval(review.lastReviewed, parsedRule)
}

export function hasReviewConfiguration(review: TaskReviewState): boolean {
  return review.enabled
}

function normalizeTaskReviewRecord(record: Record<string, unknown>): TaskReviewState {
  const reviewEvery = normalizeReviewRuleString(toString(record.reviewEvery))
  const nextReview = toDate(record.nextReview)
  const lastReviewed = toDate(record.lastReviewed)

  let type = normalizeTaskReviewType(record.type)
  if (type == null) {
    type = reviewEvery !== "" ? "cycle" : "single"
  }

  const hasData = reviewEvery !== "" || nextReview != null || lastReviewed != null
  const enabledRaw = toBoolean(record.enabled)
  const enabled = enabledRaw == null ? hasData : enabledRaw

  if (!enabled) {
    return createEmptyTaskReviewState()
  }

  return {
    enabled: true,
    type,
    nextReview,
    reviewEvery: type === "cycle" ? reviewEvery : "",
    lastReviewed,
  }
}

function parseReviewRuleFromUnknown(value: unknown): ReviewRuleConfig | null {
  if (!isRecord(value)) {
    return null
  }

  const unit = normalizeUnit(
    toString(value.unit) ??
      toString(value.freq) ??
      toString(value.frequency),
  )
  if (unit == null) {
    return null
  }

  return {
    unit,
    interval: normalizePositiveInt(value.interval ?? value.every, 1),
  }
}

function normalizeReviewRuleString(raw: string | null): string {
  if (raw == null) {
    return ""
  }

  const normalized = raw.trim()
  if (normalized === "") {
    return ""
  }

  const parsed = parseReviewRule(normalized)
  return parsed == null ? normalized : stringifyReviewRule(parsed)
}

function parseJsonRule(rawRule: string): ReviewRuleConfig | null {
  if (!rawRule.startsWith("{")) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawRule)
  } catch {
    return null
  }

  return parseReviewRuleFromUnknown(parsed)
}

function parseLegacyTextRule(rawRule: string): ReviewRuleConfig | null {
  const normalized = rawRule
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")

  if (normalized === "daily") {
    return { unit: "day", interval: 1 }
  }
  if (normalized === "weekly") {
    return { unit: "week", interval: 1 }
  }
  if (normalized === "monthly") {
    return { unit: "month", interval: 1 }
  }

  const everyMatch = normalized.match(
    /^every\s+(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/,
  )
  if (everyMatch != null) {
    const unit = normalizeUnit(everyMatch[2])
    if (unit == null) {
      return null
    }

    return {
      unit,
      interval: normalizePositiveInt(everyMatch[1], 1),
    }
  }

  const shortMatch = normalized.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/)
  if (shortMatch != null) {
    const unit = normalizeUnit(shortMatch[2])
    if (unit == null) {
      return null
    }

    return {
      unit,
      interval: normalizePositiveInt(shortMatch[1], 1),
    }
  }

  return null
}

function addReviewInterval(anchor: Date, rule: ReviewRuleConfig): Date {
  const base = new Date(anchor.getTime())

  if (rule.unit === "day") {
    return new Date(base.getTime() + rule.interval * DAY_MS)
  }

  if (rule.unit === "week") {
    return new Date(base.getTime() + rule.interval * 7 * DAY_MS)
  }

  const next = new Date(base.getTime())
  next.setMonth(next.getMonth() + rule.interval)
  return next
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : fallback
}

function normalizeUnit(token: string | null): ReviewUnit | null {
  if (token == null) {
    return null
  }

  const normalized = token.trim().toLowerCase()
  if (normalized === "d" || normalized === "day" || normalized === "days") {
    return "day"
  }
  if (normalized === "w" || normalized === "week" || normalized === "weeks") {
    return "week"
  }
  if (normalized === "m" || normalized === "month" || normalized === "months") {
    return "month"
  }

  return null
}

function normalizeTaskReviewType(value: unknown): TaskReviewType | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === "single") {
    return "single"
  }
  if (normalized === "cycle" || normalized === "cyclic" || normalized === "recurring") {
    return "cycle"
  }

  return null
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value
  }

  return null
}

function toDate(value: unknown): Date | null {
  if (value == null) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

function isValidDate(value: Date | null): value is Date {
  return value != null && !Number.isNaN(value.getTime())
}

function toTimestamp(value: Date | null): number | null {
  if (!isValidDate(value)) {
    return null
  }

  return value.getTime()
}

function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}