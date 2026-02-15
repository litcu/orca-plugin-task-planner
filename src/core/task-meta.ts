import type { Block, BlockProperty } from "../orca.d.ts"
import type { TaskReviewType } from "./task-review"

const PROP_TYPE_JSON = 0

export const TASK_META_PROPERTY_NAME = "_mlo_task_meta"
export const TASK_META_SCHEMA_VERSION = 1

export interface TaskMetaPriority {
  importance: number | null
  urgency: number | null
  effort: number | null
}

export interface TaskMetaReview {
  enabled: boolean
  type: TaskReviewType
  nextReviewAt: number | null
  reviewEvery: string
  lastReviewedAt: number | null
}

export interface TaskMetaRecurrence {
  repeatRule: string
}

export interface TaskMetaData {
  schema: number
  priority: TaskMetaPriority
  review: TaskMetaReview
  recurrence: TaskMetaRecurrence
}

export function createDefaultTaskMetaData(): TaskMetaData {
  return {
    schema: TASK_META_SCHEMA_VERSION,
    priority: {
      importance: null,
      urgency: null,
      effort: null,
    },
    review: {
      enabled: false,
      type: "single",
      nextReviewAt: null,
      reviewEvery: "",
      lastReviewedAt: null,
    },
    recurrence: {
      repeatRule: "",
    },
  }
}

export function readTaskMetaFromBlock(
  block: Block | null | undefined,
): TaskMetaData {
  const property = block?.properties?.find((item) => item.name === TASK_META_PROPERTY_NAME)
  return normalizeTaskMetaData(property?.value)
}

export function toTaskMetaProperty(
  meta: TaskMetaData,
  existingProperty?: BlockProperty,
): BlockProperty {
  return {
    name: TASK_META_PROPERTY_NAME,
    type: PROP_TYPE_JSON,
    value: normalizeTaskMetaData(meta),
    pos: existingProperty?.pos,
  }
}

function normalizeTaskMetaData(raw: unknown): TaskMetaData {
  const fallback = createDefaultTaskMetaData()
  if (!isRecord(raw)) {
    return fallback
  }

  const priorityRaw = isRecord(raw.priority) ? raw.priority : {}
  const reviewRaw = isRecord(raw.review) ? raw.review : {}
  const recurrenceRaw = isRecord(raw.recurrence) ? raw.recurrence : {}

  const reviewEnabled = reviewRaw.enabled === true
  const reviewType = normalizeTaskReviewType(reviewRaw.type)

  return {
    schema: normalizePositiveInt(raw.schema, TASK_META_SCHEMA_VERSION),
    priority: {
      importance: toFiniteNumber(priorityRaw.importance),
      urgency: toFiniteNumber(priorityRaw.urgency),
      effort: toFiniteNumber(priorityRaw.effort),
    },
    review: {
      enabled: reviewEnabled,
      type: reviewEnabled ? reviewType : "single",
      nextReviewAt: reviewEnabled ? toFiniteNumber(reviewRaw.nextReviewAt) : null,
      reviewEvery: reviewEnabled && reviewType === "cycle"
        ? normalizeString(reviewRaw.reviewEvery)
        : "",
      lastReviewedAt: reviewEnabled ? toFiniteNumber(reviewRaw.lastReviewedAt) : null,
    },
    recurrence: {
      repeatRule: normalizeString(
        recurrenceRaw.repeatRule ?? recurrenceRaw.rule,
      ),
    },
  }
}

function normalizeTaskReviewType(value: unknown): TaskReviewType {
  if (typeof value !== "string") {
    return "single"
  }

  const normalized = value.trim().toLowerCase()
  if (
    normalized === "cycle" ||
    normalized === "cyclic" ||
    normalized === "recurring"
  ) {
    return "cycle"
  }

  return "single"
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : fallback
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }

  return value
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  return value.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}
