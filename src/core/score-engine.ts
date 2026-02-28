import type { TaskPropertyValues } from "./task-properties"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const START_HORIZON_DAYS = 14
const OVERDUE_HORIZON_DAYS = 7
const START_BY_HORIZON_DAYS = 7
const AGING_HORIZON_DAYS = 14

const DEFAULT_NEUTRAL_FACTOR = 50
const DEFAULT_DUE_FACTOR = 45
const MIN_DUE_FACTOR_WITH_DATE = 35
const DUE_DECAY_DAYS = 4
const MIN_START_FACTOR = 10
const DEFAULT_CONTEXT_FACTOR = 50
const STAR_CONTEXT_FACTOR = 80
const MAX_EFFORT_HOURS_FOR_START_BY = 24
const DEFAULT_DAILY_FOCUS_HOURS = 3
const DEFAULT_START_BY_BUFFER_DAYS = 1

const BASE_SCORE_WEIGHTS = {
  importance: 0.4,
  urgency: 0.22,
  due: 0.2,
  start: 0.1,
  context: 0.08,
} as const
const TIME_PENALTY_WEIGHT = 0.9
const CRITICALITY_BOOST_WEIGHT = 0.3
const OVERDUE_BOOST_WEIGHT = 0.25
const START_BY_BOOST_WEIGHT = 0.22
const AGING_BOOST_WEIGHT = 0.12
export const WAITING_STATUS_MULTIPLIER = 0.6

export interface TaskScoreInput {
  importance: number | null
  urgency: number | null
  effort?: number | null
  star?: boolean
  startTime: Date | null
  endTime: Date | null
}

export interface TaskScoreContext {
  dependencyDescendants?: number | null
  dependencyDemand?: number | null
  waitingDays?: number | null
}

export interface TaskScoreOptions {
  statusMultiplier?: number
}

export function calculateTaskScore(
  input: TaskScoreInput,
  now: Date = new Date(),
  context: TaskScoreContext = {},
): number {
  const importance = resolvePreferenceFactor(input.importance, 1.25)
  const urgency = resolvePreferenceFactor(input.urgency, 1.15)
  const effortNormalized = resolveEffortNormalized(input.effort)
  const dueFactor = resolveDueFactor(input.endTime, now)
  const startFactor = resolveStartFactor(input.startTime, now)
  const contextFactor = resolveContextFactor(input.star)
  const criticality = resolveCriticality(context)
  const overdueNormalized = resolveOverdueNormalized(input.endTime, now)
  const startByPressure = resolveStartByPressure(input.endTime, input.effort, now)
  const agingNormalized = resolveAgingNormalized(context.waitingDays)

  const baseScore =
    BASE_SCORE_WEIGHTS.importance * importance +
    BASE_SCORE_WEIGHTS.urgency * urgency +
    BASE_SCORE_WEIGHTS.due * dueFactor +
    BASE_SCORE_WEIGHTS.start * startFactor +
    BASE_SCORE_WEIGHTS.context * contextFactor
  const timePenalty = 1 + TIME_PENALTY_WEIGHT * effortNormalized
  const criticalBoost = 1 + CRITICALITY_BOOST_WEIGHT * criticality
  const deadlineBoost = 1 + OVERDUE_BOOST_WEIGHT * overdueNormalized
  const startByBoost = 1 + START_BY_BOOST_WEIGHT * startByPressure
  const agingBoost = 1 + AGING_BOOST_WEIGHT * agingNormalized

  const score =
    (baseScore * criticalBoost * deadlineBoost * startByBoost * agingBoost) /
    timePenalty
  return roundScore(clampToPercent(score))
}

export function calculateTaskScoreFromValues(
  values: TaskPropertyValues,
  now: Date = new Date(),
  context: TaskScoreContext = {},
  options: TaskScoreOptions = {},
): number {
  const baseScore = calculateTaskScore(
    {
      importance: values.importance,
      urgency: values.urgency,
      effort: values.effort,
      star: values.star,
      startTime: values.startTime,
      endTime: values.endTime,
    },
    now,
    context,
  )

  const statusMultiplier = resolveScoreMultiplier(options.statusMultiplier)
  return roundScore(clampToPercent(baseScore * statusMultiplier))
}

function resolveDueFactor(
  endTime: Date | null,
  now: Date,
): number {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return DEFAULT_DUE_FACTOR
  }

  const dueDeltaMs = endTime.getTime() - now.getTime()
  if (dueDeltaMs <= 0) {
    return 100
  }

  const dueDeltaDays = dueDeltaMs / ONE_DAY_MS

  return (
    MIN_DUE_FACTOR_WITH_DATE +
    (100 - MIN_DUE_FACTOR_WITH_DATE) *
      Math.exp(-dueDeltaDays / DUE_DECAY_DAYS)
  )
}

function resolveStartFactor(
  startTime: Date | null,
  now: Date,
): number {
  if (startTime == null || Number.isNaN(startTime.getTime())) {
    return 100
  }

  const startDeltaMs = startTime.getTime() - now.getTime()
  if (startDeltaMs <= 0) {
    return 100
  }

  const startDeltaDays = startDeltaMs / ONE_DAY_MS
  if (startDeltaDays >= START_HORIZON_DAYS) {
    return MIN_START_FACTOR
  }

  const distanceRatio = 1 - startDeltaDays / START_HORIZON_DAYS
  return (
    MIN_START_FACTOR +
    (100 - MIN_START_FACTOR) * distanceRatio * distanceRatio
  )
}

function resolvePreferenceFactor(value: number | null | undefined, exponent: number): number {
  const normalized = normalizeNeutralPercent(value)
  return applyCenteredCurve(normalized, exponent)
}

function resolveEffortNormalized(value: number | null | undefined): number {
  const effortScore = normalizeNeutralPercent(value)
  return effortScore / 100
}

function resolveContextFactor(star: boolean | undefined): number {
  return star === true ? STAR_CONTEXT_FACTOR : DEFAULT_CONTEXT_FACTOR
}

function resolveCriticality(context: TaskScoreContext): number {
  const descendants = clampRatio(context.dependencyDescendants)
  const dependencyDemand = clampRatio(context.dependencyDemand)
  return clampRatio(descendants * 0.6 + dependencyDemand * 0.4)
}

function resolveOverdueNormalized(endTime: Date | null, now: Date): number {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return 0
  }

  const overdueMs = now.getTime() - endTime.getTime()
  if (overdueMs <= 0) {
    return 0
  }

  const overdueDays = overdueMs / ONE_DAY_MS
  return clampRatio(overdueDays / OVERDUE_HORIZON_DAYS)
}

function resolveStartByPressure(
  endTime: Date | null,
  effortValue: number | null | undefined,
  now: Date,
): number {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return 0
  }

  const dueDeltaDays = (endTime.getTime() - now.getTime()) / ONE_DAY_MS
  const effortHours = resolveEffortHoursForStartBy(effortValue)
  const requiredDays = effortHours / DEFAULT_DAILY_FOCUS_HOURS
  const slackDays = dueDeltaDays - requiredDays - DEFAULT_START_BY_BUFFER_DAYS

  return clampRatio(1 - slackDays / START_BY_HORIZON_DAYS)
}

function resolveEffortHoursForStartBy(value: number | null | undefined): number {
  const effortNormalized = resolveEffortNormalized(value)
  return effortNormalized * MAX_EFFORT_HOURS_FOR_START_BY
}

function resolveAgingNormalized(waitingDays: number | null | undefined): number {
  if (waitingDays == null || Number.isNaN(waitingDays)) {
    return 0
  }

  return clampRatio(waitingDays / AGING_HORIZON_DAYS)
}

function normalizeNeutralPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return DEFAULT_NEUTRAL_FACTOR
  }

  return clampToPercent(value)
}

function applyCenteredCurve(value: number, exponent: number): number {
  const centeredValue = value - DEFAULT_NEUTRAL_FACTOR
  if (centeredValue === 0) {
    return DEFAULT_NEUTRAL_FACTOR
  }

  const normalizedDistance = Math.abs(centeredValue) / DEFAULT_NEUTRAL_FACTOR
  const curvedDistance = Math.pow(normalizedDistance, exponent) * DEFAULT_NEUTRAL_FACTOR

  return DEFAULT_NEUTRAL_FACTOR + Math.sign(centeredValue) * curvedDistance
}

function clampToPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }
  if (value > 100) {
    return 100
  }

  return value
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

function clampRatio(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }

  return value
}

function resolveScoreMultiplier(value: number | undefined): number {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
    return 1
  }

  return value
}
