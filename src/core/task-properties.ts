import type { BlockProperty, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "./task-schema"
import {
  buildTaskReviewStateFromLegacyFields,
  parseTaskReviewState,
  stringifyTaskReviewState,
  type TaskReviewType,
} from "./task-review"
import { t } from "../libs/l10n"

const PROP_TYPE = {
  TEXT: 1,
  BLOCK_REFS: 2,
  NUMBER: 3,
  BOOLEAN: 4,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

const LEGACY_NEXT_REVIEW_NAMES = ["Next review", "\u4e0b\u6b21\u56de\u987e"]
const LEGACY_REVIEW_EVERY_NAMES = ["Review every", "\u56de\u987e\u5468\u671f"]
const LEGACY_LAST_REVIEWED_NAMES = ["Last reviewed", "\u4e0a\u6b21\u56de\u987e"]

export interface TaskPropertyValues {
  status: string
  startTime: Date | null
  endTime: Date | null
  reviewEnabled: boolean
  reviewType: TaskReviewType
  nextReview: Date | null
  reviewEvery: string
  lastReviewed: Date | null
  importance: number | null
  urgency: number | null
  effort: number | null
  star: boolean
  repeatRule: string
  labels: string[]
  remark: string
  dependsOn: DbId[]
  dependsMode: string
  dependencyDelay: number | null
}

export interface TaskFieldLabels {
  title: string
  status: string
  startTime: string
  endTime: string
  review: string
  reviewEnabled: string
  reviewType: string
  singleReview: string
  cycleReview: string
  nextReview: string
  reviewEvery: string
  lastReviewed: string
  neverReviewed: string
  importance: string
  urgency: string
  effort: string
  star: string
  repeatRule: string
  labels: string
  remark: string
  dependsOn: string
  dependsMode: string
  dependencyDelay: string
  save: string
  cancel: string
}

export function buildTaskFieldLabels(_locale: string): TaskFieldLabels {
  return {
    title: t("Task Properties"),
    status: t("Status"),
    startTime: t("Start time"),
    endTime: t("End time"),
    review: t("Review"),
    reviewEnabled: t("Enable review"),
    reviewType: t("Review type"),
    singleReview: t("Single review"),
    cycleReview: t("Cyclic review"),
    nextReview: t("Next review"),
    reviewEvery: t("Review every"),
    lastReviewed: t("Last reviewed"),
    neverReviewed: t("Never reviewed"),
    importance: t("Importance"),
    urgency: t("Urgency"),
    effort: t("Effort"),
    star: t("Star"),
    repeatRule: t("Repeat rule"),
    labels: t("Labels"),
    remark: t("Remark"),
    dependsOn: t("Depends on"),
    dependsMode: t("Depends mode"),
    dependencyDelay: t("Dependency delay"),
    save: t("Save"),
    cancel: t("Cancel"),
  }
}

export function getTaskPropertiesFromRef(
  refData: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
): TaskPropertyValues {
  const names = schema.propertyNames
  const labelsFromChoices = getStringArray(refData, names.labels)

  const hasReviewProperty = hasProperty(refData, names.review)
  const reviewFromJson = parseTaskReviewState(getString(refData, names.review))
  const reviewFromLegacy = readLegacyReviewState(refData)
  const review = hasReviewProperty ? reviewFromJson : (reviewFromLegacy.enabled
    ? reviewFromLegacy
    : reviewFromJson)

  return {
    status: getString(refData, names.status) ?? schema.statusChoices[0],
    startTime: getDate(refData, names.startTime),
    endTime: getDate(refData, names.endTime),
    reviewEnabled: review.enabled,
    reviewType: review.type,
    nextReview: review.nextReview,
    reviewEvery: review.reviewEvery,
    lastReviewed: review.lastReviewed,
    importance: getNumber(refData, names.importance),
    urgency: getNumber(refData, names.urgency),
    effort: getNumber(refData, names.effort),
    star: getBoolean(refData, names.star),
    repeatRule: getString(refData, names.repeatRule) ?? "",
    labels: labelsFromChoices ?? parseTaskLabels(getString(refData, names.labels) ?? ""),
    remark: getString(refData, names.remark) ?? "",
    dependsOn: getDbIdArray(refData, names.dependsOn),
    dependsMode: getString(refData, names.dependsMode) ?? schema.dependencyModeChoices[0],
    dependencyDelay: getNumber(refData, names.dependencyDelay),
  }
}

export function toRefDataForSave(
  values: TaskPropertyValues,
  schema: TaskSchemaDefinition,
): BlockProperty[] {
  const names = schema.propertyNames

  const reviewValue = stringifyTaskReviewState({
    enabled: values.reviewEnabled,
    type: values.reviewType,
    nextReview: values.nextReview,
    reviewEvery: values.reviewEvery,
    lastReviewed: values.lastReviewed,
  })

  return [
    {
      name: names.status,
      type: PROP_TYPE.TEXT_CHOICES,
      value: values.status,
    },
    {
      name: names.startTime,
      type: PROP_TYPE.DATE_TIME,
      value: values.startTime,
    },
    {
      name: names.endTime,
      type: PROP_TYPE.DATE_TIME,
      value: values.endTime,
    },
    {
      name: names.review,
      type: PROP_TYPE.TEXT,
      value: reviewValue,
    },
    {
      name: names.importance,
      type: PROP_TYPE.NUMBER,
      value: values.importance,
    },
    {
      name: names.urgency,
      type: PROP_TYPE.NUMBER,
      value: values.urgency,
    },
    {
      name: names.effort,
      type: PROP_TYPE.NUMBER,
      value: values.effort,
    },
    {
      name: names.star,
      type: PROP_TYPE.BOOLEAN,
      value: values.star,
    },
    {
      name: names.repeatRule,
      type: PROP_TYPE.TEXT,
      value: values.repeatRule.trim() === "" ? null : values.repeatRule.trim(),
    },
    {
      name: names.labels,
      type: PROP_TYPE.TEXT_CHOICES,
      value: normalizeTaskLabels(values.labels),
    },
    {
      name: names.remark,
      type: PROP_TYPE.TEXT,
      value: values.remark.trim() === "" ? null : values.remark,
    },
    {
      name: names.dependsOn,
      type: PROP_TYPE.BLOCK_REFS,
      value: values.dependsOn,
    },
    {
      name: names.dependsMode,
      type: PROP_TYPE.TEXT_CHOICES,
      value: values.dependsMode,
    },
    {
      name: names.dependencyDelay,
      type: PROP_TYPE.NUMBER,
      value: values.dependencyDelay,
    },
  ]
}

export function parseTaskLabels(rawValue: string): string[] {
  const normalized = rawValue.trim()
  if (normalized === "") {
    return []
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    try {
      const parsed = JSON.parse(normalized) as unknown
      if (Array.isArray(parsed)) {
        const labels = parsed.filter((item): item is string => typeof item === "string")
        return normalizeTaskLabels(labels)
      }
    } catch {
      // Ignore JSON parse errors and fallback to separator parsing.
    }
  }

  return normalizeTaskLabels(
    normalized.split(/[\n,\uFF0C;\uFF1B]+/g),
  )
}

export function formatTaskLabels(labels: string[]): string {
  return normalizeTaskLabels(labels).join(", ")
}

export function validateNumericField(
  label: string,
  rawValue: string,
): { value: number | null; error: string | null } {
  const normalized = rawValue.trim()
  if (normalized === "") {
    return { value: null, error: null }
  }

  const parsed = Number(normalized)
  if (Number.isNaN(parsed)) {
    return {
      value: null,
      error: t("${field} must be a number", { field: label }),
    }
  }

  return { value: parsed, error: null }
}

function readLegacyReviewState(
  refData: BlockProperty[] | undefined,
) {
  const nextReview = getDateByNames(refData, LEGACY_NEXT_REVIEW_NAMES)
  const reviewEvery = getStringByNames(refData, LEGACY_REVIEW_EVERY_NAMES) ?? ""
  const lastReviewed = getDateByNames(refData, LEGACY_LAST_REVIEWED_NAMES)

  return buildTaskReviewStateFromLegacyFields(
    nextReview,
    reviewEvery,
    lastReviewed,
  )
}

function hasProperty(
  refData: BlockProperty[] | undefined,
  name: string,
): boolean {
  return refData?.some((item) => item.name === name) === true
}

function getString(
  refData: BlockProperty[] | undefined,
  name: string,
): string | null {
  const property = refData?.find((item) => item.name === name)
  return typeof property?.value === "string" ? property.value : null
}

function getStringByNames(
  refData: BlockProperty[] | undefined,
  names: string[],
): string | null {
  for (const name of names) {
    const value = getString(refData, name)
    if (value != null) {
      return value
    }
  }

  return null
}

function getStringArray(
  refData: BlockProperty[] | undefined,
  name: string,
): string[] | null {
  const property = refData?.find((item) => item.name === name)
  if (!Array.isArray(property?.value)) {
    return null
  }

  const values = property.value.filter((item): item is string => typeof item === "string")
  return normalizeTaskLabels(values)
}

function getNumber(
  refData: BlockProperty[] | undefined,
  name: string,
): number | null {
  const property = refData?.find((item) => item.name === name)
  return typeof property?.value === "number" ? property.value : null
}

function getDate(
  refData: BlockProperty[] | undefined,
  name: string,
): Date | null {
  const property = refData?.find((item) => item.name === name)
  if (property?.value == null) {
    return null
  }

  const date = property.value instanceof Date
    ? property.value
    : new Date(property.value)

  return Number.isNaN(date.getTime()) ? null : date
}

function getDateByNames(
  refData: BlockProperty[] | undefined,
  names: string[],
): Date | null {
  for (const name of names) {
    const value = getDate(refData, name)
    if (value != null) {
      return value
    }
  }

  return null
}

function getBoolean(
  refData: BlockProperty[] | undefined,
  name: string,
): boolean {
  const property = refData?.find((item) => item.name === name)
  return property?.value === true
}

function getDbIdArray(
  refData: BlockProperty[] | undefined,
  name: string,
): DbId[] {
  const property = refData?.find((item) => item.name === name)
  if (!Array.isArray(property?.value)) {
    return []
  }

  return property.value
    .map((item) => Number(item))
    .filter((item) => !Number.isNaN(item))
}

function normalizeTaskLabels(labels: string[]): string[] {
  const normalizedLabels: string[] = []
  const seen = new Set<string>()

  for (const rawLabel of labels) {
    const label = rawLabel.replace(/\s+/g, " ").trim()
    if (label === "") {
      continue
    }

    const dedupKey = label.toLowerCase()
    if (seen.has(dedupKey)) {
      continue
    }

    seen.add(dedupKey)
    normalizedLabels.push(label)
  }

  return normalizedLabels
}