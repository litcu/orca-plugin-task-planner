import type { TaskPropertyValues } from "./task-properties"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const DUE_HORIZON_MS = 14 * ONE_DAY_MS
const START_HORIZON_MS = 14 * ONE_DAY_MS

const DEFAULT_DUE_FACTOR = 35
const MIN_DUE_FACTOR_WITH_DATE = 40
const CONTEXT_FACTOR = 100

const SCORE_WEIGHTS = {
  importance: 0.4,
  urgency: 0.25,
  due: 0.2,
  start: 0.1,
  context: 0.05,
} as const

export interface TaskScoreInput {
  importance: number | null
  urgency: number | null
  startTime: Date | null
  endTime: Date | null
}

export function calculateTaskScore(
  input: TaskScoreInput,
  now: Date = new Date(),
): number {
  const importance = clampToPercent(input.importance)
  const urgency = clampToPercent(input.urgency)
  const dueFactor = resolveDueFactor(input.endTime, now)
  const startFactor = resolveStartFactor(input.startTime, now)

  const score =
    SCORE_WEIGHTS.importance * importance +
    SCORE_WEIGHTS.urgency * urgency +
    SCORE_WEIGHTS.due * dueFactor +
    SCORE_WEIGHTS.start * startFactor +
    SCORE_WEIGHTS.context * CONTEXT_FACTOR

  return roundScore(clampToPercent(score))
}

export function calculateTaskScoreFromValues(
  values: TaskPropertyValues,
  now: Date = new Date(),
): number {
  return calculateTaskScore(
    {
      importance: values.importance,
      urgency: values.urgency,
      startTime: values.startTime,
      endTime: values.endTime,
    },
    now,
  )
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

  const normalizedDistance = Math.min(dueDeltaMs, DUE_HORIZON_MS) / DUE_HORIZON_MS
  const proximity = 1 - normalizedDistance

  return (
    MIN_DUE_FACTOR_WITH_DATE +
    proximity * (100 - MIN_DUE_FACTOR_WITH_DATE)
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

  const normalizedDistance = Math.min(startDeltaMs, START_HORIZON_MS) / START_HORIZON_MS
  return 100 - normalizedDistance * 100
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
