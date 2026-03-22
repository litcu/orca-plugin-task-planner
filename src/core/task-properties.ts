import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import {
  getDefaultTaskStatus,
  isTaskDoneStatus,
  type TaskSchemaDefinition,
} from "./task-schema"
import {
  type TaskReviewType,
} from "./task-review"
import {
  TASK_META_PROPERTY_NAME,
  TASK_META_SCHEMA_VERSION,
  readTaskMetaFromBlock,
  toTaskMetaProperty,
} from "./task-meta"
import { t } from "../libs/l10n"

export const TASK_PROP_TYPE = {
  TEXT: 1,
  BLOCK_REFS: 2,
  NUMBER: 3,
  BOOLEAN: 4,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

const TASK_RESERVED_CUSTOM_PROPERTY_NAMES = [
  "task name",
  "任务名称",
  "review",
  "回顾",
  "review every",
  "回顾周期",
  "review type",
  "回顾类型",
  "enable review",
  "启用回顾",
  "next review",
  "下次回顾",
  "last reviewed",
  "上次回顾",
  "importance",
  "重要性",
  "urgency",
  "紧急度",
  "effort",
  "工作量",
  "repeat rule",
  "重复规则",
] as const

export type TaskCustomPropertyValue =
  | string
  | number
  | boolean
  | Date
  | string[]
  | DbId[]
  | null

export interface TaskCustomPropertyDescriptor {
  name: string
  type: number
  typeArgs?: any
  pos?: number
  supported: boolean
  initialValue: TaskCustomPropertyValue
  initialPresent: boolean
  rawInitialValue?: unknown
}

export interface TaskCustomPropertyState {
  value: TaskCustomPropertyValue
  present: boolean
}

export type TaskCustomPropertyStateMap = Record<string, TaskCustomPropertyState>

interface ResolveTaskCustomPropertyDescriptorsOptions {
  refData?: BlockProperty[]
  includeSchemaDefaults?: boolean
}

interface BuildTaskRefDataOptions {
  existingRefData?: BlockProperty[]
  customProperties?: BlockProperty[]
}

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

export function normalizeTaskValuesForStatus(
  values: TaskPropertyValues,
  schema: TaskSchemaDefinition,
): TaskPropertyValues {
  if (!isTaskDoneStatus(values.status, schema)) {
    return values
  }

  return {
    ...values,
    reviewEnabled: false,
    reviewType: "single",
    nextReview: null,
    reviewEvery: "",
    lastReviewed: null,
  }
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
  taskBlock?: Block | null,
): TaskPropertyValues {
  const names = schema.propertyNames
  const labelsFromChoices = getStringArray(refData, names.labels)
  const meta = readTaskMetaFromBlock(taskBlock)

  return {
    status: getString(refData, names.status) ?? getDefaultTaskStatus(schema),
    startTime: getDate(refData, names.startTime),
    endTime: getDate(refData, names.endTime),
    reviewEnabled: meta.review.enabled,
    reviewType: meta.review.type,
    nextReview: toDate(meta.review.nextReviewAt),
    reviewEvery: meta.review.reviewEvery,
    lastReviewed: toDate(meta.review.lastReviewedAt),
    importance: meta.priority.importance,
    urgency: meta.priority.urgency,
    effort: meta.priority.effort,
    star: getBoolean(refData, names.star),
    repeatRule: meta.recurrence.repeatRule,
    labels: labelsFromChoices ?? parseTaskLabels(getString(refData, names.labels) ?? ""),
    remark: getString(refData, names.remark) ?? "",
    dependsOn: getDbIdArray(refData, names.dependsOn),
    dependsMode: getString(refData, names.dependsMode) ?? schema.dependencyModeChoices[0],
    dependencyDelay: getNumber(refData, names.dependencyDelay),
  }
}

export function buildTaskCoreRefData(
  values: TaskPropertyValues,
  schema: TaskSchemaDefinition,
): BlockProperty[] {
  const names = schema.propertyNames

  return [
    {
      name: names.status,
      type: TASK_PROP_TYPE.TEXT_CHOICES,
      value: values.status,
    },
    {
      name: names.startTime,
      type: TASK_PROP_TYPE.DATE_TIME,
      value: values.startTime,
    },
    {
      name: names.endTime,
      type: TASK_PROP_TYPE.DATE_TIME,
      value: values.endTime,
    },
    {
      name: names.star,
      type: TASK_PROP_TYPE.BOOLEAN,
      value: values.star,
    },
    {
      name: names.labels,
      type: TASK_PROP_TYPE.TEXT_CHOICES,
      value: normalizeTaskLabels(values.labels),
    },
    {
      name: names.remark,
      type: TASK_PROP_TYPE.TEXT,
      value: values.remark.trim() === "" ? null : values.remark,
    },
    {
      name: names.dependsOn,
      type: TASK_PROP_TYPE.BLOCK_REFS,
      value: values.dependsOn,
    },
    {
      name: names.dependsMode,
      type: TASK_PROP_TYPE.TEXT_CHOICES,
      value: values.dependsMode,
    },
    {
      name: names.dependencyDelay,
      type: TASK_PROP_TYPE.NUMBER,
      value: values.dependencyDelay,
    },
  ]
}

export function toRefDataForSave(
  values: TaskPropertyValues,
  schema: TaskSchemaDefinition,
  options?: BuildTaskRefDataOptions,
): BlockProperty[] {
  const payload = [
    ...buildTaskCoreRefData(values, schema),
    ...(options?.customProperties ?? []),
  ]

  return mergeTaskRefData(options?.existingRefData, payload)
}

export function toTaskMetaPropertyForSave(
  values: TaskPropertyValues,
  taskBlock?: Block | null,
): BlockProperty {
  const existingMeta = readTaskMetaFromBlock(taskBlock)
  const reviewType = values.reviewType === "cycle" ? "cycle" : "single"
  const reviewEnabled = values.reviewEnabled === true
  const existingProperty = taskBlock?.properties?.find((item) => {
    return item.name === TASK_META_PROPERTY_NAME
  })

  return toTaskMetaProperty({
    schema: TASK_META_SCHEMA_VERSION,
    priority: {
      importance: toFiniteNumber(values.importance),
      urgency: toFiniteNumber(values.urgency),
      effort: toFiniteNumber(values.effort),
    },
    review: {
      enabled: reviewEnabled,
      type: reviewEnabled ? reviewType : "single",
      nextReviewAt:
        reviewEnabled && reviewType === "single"
          ? toTimestamp(values.nextReview)
          : null,
      reviewEvery:
        reviewEnabled && reviewType === "cycle"
          ? values.reviewEvery.trim()
          : "",
      lastReviewedAt: reviewEnabled ? toTimestamp(values.lastReviewed) : null,
    },
    recurrence: {
      repeatRule: values.repeatRule.trim(),
    },
    subtasks: {
      sequential: existingMeta.subtasks.sequential,
    },
  }, existingProperty)
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

export function collectTaskCustomPropertyDescriptors(
  schemaProperties: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
  options?: ResolveTaskCustomPropertyDescriptorsOptions,
): TaskCustomPropertyDescriptor[] {
  if (!Array.isArray(schemaProperties) || schemaProperties.length === 0) {
    return []
  }

  const descriptors: TaskCustomPropertyDescriptor[] = []
  const reservedNames = getReservedTaskPropertyNameSet(schema)
  const seen = new Set<string>()

  for (const property of schemaProperties) {
    const name = normalizeTaskPropertyName(property.name)
    if (name === "" || name.startsWith("_")) {
      continue
    }

    const dedupKey = name.toLowerCase()
    if (reservedNames.has(dedupKey) || seen.has(dedupKey)) {
      continue
    }

    seen.add(dedupKey)
    const initialState = resolveTaskCustomPropertyInitialState(property, options)
    descriptors.push({
      name,
      type: typeof property.type === "number" ? property.type : TASK_PROP_TYPE.TEXT,
      typeArgs: property.typeArgs,
      pos: property.pos,
      supported: isSupportedTaskCustomProperty(property),
      initialValue: initialState.value,
      initialPresent: initialState.present,
      rawInitialValue: initialState.rawValue,
    })
  }

  return descriptors.sort((left, right) => {
    const leftPos = typeof left.pos === "number" ? left.pos : Number.MAX_SAFE_INTEGER
    const rightPos = typeof right.pos === "number" ? right.pos : Number.MAX_SAFE_INTEGER
    if (leftPos !== rightPos) {
      return leftPos - rightPos
    }
    return left.name.localeCompare(right.name)
  })
}

export function createTaskCustomPropertyStateMap(
  descriptors: TaskCustomPropertyDescriptor[],
): TaskCustomPropertyStateMap {
  const map: TaskCustomPropertyStateMap = {}

  for (const descriptor of descriptors) {
    map[descriptor.name] = {
      value: cloneTaskCustomPropertyValue(descriptor.initialValue),
      present: descriptor.initialPresent,
    }
  }

  return map
}

export function buildTaskCustomRefData(
  descriptors: TaskCustomPropertyDescriptor[],
  states: TaskCustomPropertyStateMap,
): BlockProperty[] {
  const payload: BlockProperty[] = []

  for (const descriptor of descriptors) {
    if (!descriptor.supported) {
      continue
    }

    const state = states[descriptor.name] ?? {
      value: descriptor.initialValue,
      present: descriptor.initialPresent,
    }
    const shouldPersist = state.present || descriptor.initialPresent
    if (!shouldPersist) {
      continue
    }

    payload.push({
      name: descriptor.name,
      type: descriptor.type,
      value: serializeTaskCustomPropertyValue(
        descriptor,
        state.present ? state.value : getClearedTaskCustomPropertyValue(descriptor),
      ),
    })
  }

  return payload
}

export function mergeTaskRefData(
  existingRefData: BlockProperty[] | undefined,
  updates: BlockProperty[],
): BlockProperty[] {
  const normalizedUpdates = normalizeRefDataProperties(updates)
  if (normalizedUpdates.length === 0) {
    return normalizeRefDataProperties(existingRefData)
  }

  const nextByKey = new Map<string, BlockProperty>()
  const remainingKeys = new Set<string>()
  for (const update of normalizedUpdates) {
    const key = normalizeTaskPropertyName(update.name).toLowerCase()
    nextByKey.set(key, update)
    remainingKeys.add(key)
  }

  const merged: BlockProperty[] = []
  for (const property of normalizeRefDataProperties(existingRefData)) {
    const key = normalizeTaskPropertyName(property.name).toLowerCase()
    const nextProperty = nextByKey.get(key)
    if (nextProperty != null) {
      merged.push(nextProperty)
      remainingKeys.delete(key)
      continue
    }

    merged.push(property)
  }

  for (const update of normalizedUpdates) {
    const key = normalizeTaskPropertyName(update.name).toLowerCase()
    if (remainingKeys.has(key)) {
      merged.push(update)
      remainingKeys.delete(key)
    }
  }

  return merged
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

function getString(
  refData: BlockProperty[] | undefined,
  name: string,
): string | null {
  const property = findTaskProperty(refData, name)
  return typeof property?.value === "string" ? property.value : null
}

function getStringArray(
  refData: BlockProperty[] | undefined,
  name: string,
): string[] | null {
  const property = findTaskProperty(refData, name)
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
  const property = findTaskProperty(refData, name)
  return typeof property?.value === "number" ? property.value : null
}

function getDate(
  refData: BlockProperty[] | undefined,
  name: string,
): Date | null {
  const property = findTaskProperty(refData, name)
  if (property?.value == null) {
    return null
  }

  const date = property.value instanceof Date
    ? property.value
    : new Date(property.value)

  return Number.isNaN(date.getTime()) ? null : date
}

function getBoolean(
  refData: BlockProperty[] | undefined,
  name: string,
): boolean {
  const property = findTaskProperty(refData, name)
  return property?.value === true
}

function getDbIdArray(
  refData: BlockProperty[] | undefined,
  name: string,
): DbId[] {
  const property = findTaskProperty(refData, name)
  if (!Array.isArray(property?.value)) {
    return []
  }

  return property.value
    .map((item) => Number(item))
    .filter((item) => !Number.isNaN(item))
}

function toDate(value: number | null): Date | null {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toTimestamp(value: Date | null): number | null {
  if (value == null || Number.isNaN(value.getTime())) {
    return null
  }

  return value.getTime()
}

function toFiniteNumber(value: number | null): number | null {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    return null
  }

  return value
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

function getReservedTaskPropertyNameSet(schema: TaskSchemaDefinition): Set<string> {
  const names = new Set<string>()

  for (const name of Object.values(schema.propertyNames)) {
    names.add(normalizeTaskPropertyName(name).toLowerCase())
  }
  for (const name of TASK_RESERVED_CUSTOM_PROPERTY_NAMES) {
    names.add(normalizeTaskPropertyName(name).toLowerCase())
  }

  return names
}

function resolveTaskCustomPropertyInitialState(
  property: BlockProperty,
  options?: ResolveTaskCustomPropertyDescriptorsOptions,
): {
  value: TaskCustomPropertyValue
  present: boolean
  rawValue?: unknown
} {
  const refProperty = findTaskProperty(options?.refData, property.name)
  if (refProperty != null) {
    return parseTaskCustomPropertyState(property, refProperty.value, true)
  }

  if (options?.includeSchemaDefaults === true) {
    const defaultState = resolveTaskCustomPropertyDefaultState(property)
    if (defaultState.present) {
      return defaultState
    }
  }

  return {
    value: getEmptyTaskCustomPropertyValue(property),
    present: false,
    rawValue: undefined,
  }
}

function resolveTaskCustomPropertyDefaultState(
  property: BlockProperty,
): {
  value: TaskCustomPropertyValue
  present: boolean
  rawValue?: unknown
} {
  const typeArgs = isRecord(property.typeArgs) ? property.typeArgs : null
  if (typeArgs?.defaultEnabled !== true || !("default" in typeArgs)) {
    return {
      value: getEmptyTaskCustomPropertyValue(property),
      present: false,
      rawValue: undefined,
    }
  }

  return parseTaskCustomPropertyState(property, typeArgs.default, true)
}

function parseTaskCustomPropertyState(
  property: BlockProperty,
  rawValue: unknown,
  present: boolean,
): {
  value: TaskCustomPropertyValue
  present: boolean
  rawValue?: unknown
} {
  const type = typeof property.type === "number" ? property.type : TASK_PROP_TYPE.TEXT
  if (type === TASK_PROP_TYPE.TEXT) {
    return {
      value: typeof rawValue === "string" ? rawValue : "",
      present,
      rawValue,
    }
  }
  if (type === TASK_PROP_TYPE.NUMBER) {
    return {
      value: typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null,
      present,
      rawValue,
    }
  }
  if (type === TASK_PROP_TYPE.BOOLEAN) {
    return {
      value: rawValue === true,
      present,
      rawValue,
    }
  }
  if (type === TASK_PROP_TYPE.DATE_TIME) {
    return {
      value: toTaskCustomDateValue(rawValue),
      present,
      rawValue,
    }
  }
  if (type === TASK_PROP_TYPE.TEXT_CHOICES) {
    if (getTaskTextChoicesSubType(property) === "multi") {
      return {
        value: normalizeStringValues(rawValue),
        present,
        rawValue,
      }
    }

    return {
      value: typeof rawValue === "string" ? rawValue : "",
      present,
      rawValue,
    }
  }
  if (type === TASK_PROP_TYPE.BLOCK_REFS) {
    return {
      value: normalizeDbIdValues(rawValue),
      present,
      rawValue,
    }
  }

  return {
    value: null,
    present,
    rawValue,
  }
}

function isSupportedTaskCustomProperty(property: BlockProperty): boolean {
  if (
    property.type === TASK_PROP_TYPE.TEXT ||
    property.type === TASK_PROP_TYPE.NUMBER ||
    property.type === TASK_PROP_TYPE.BOOLEAN ||
    property.type === TASK_PROP_TYPE.DATE_TIME ||
    property.type === TASK_PROP_TYPE.BLOCK_REFS
  ) {
    return true
  }

  if (property.type !== TASK_PROP_TYPE.TEXT_CHOICES) {
    return false
  }

  const subType = getTaskTextChoicesSubType(property)
  return subType === "single" || subType === "multi"
}

function serializeTaskCustomPropertyValue(
  descriptor: TaskCustomPropertyDescriptor,
  value: TaskCustomPropertyValue,
): TaskCustomPropertyValue {
  if (descriptor.type === TASK_PROP_TYPE.TEXT) {
    if (typeof value !== "string") {
      return null
    }
    const normalized = value.trim()
    return normalized === "" ? null : value
  }
  if (descriptor.type === TASK_PROP_TYPE.NUMBER) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
  }
  if (descriptor.type === TASK_PROP_TYPE.BOOLEAN) {
    return value === true
  }
  if (descriptor.type === TASK_PROP_TYPE.DATE_TIME) {
    return toTaskCustomDateValue(value)
  }
  if (descriptor.type === TASK_PROP_TYPE.TEXT_CHOICES) {
    if (getTaskTextChoicesSubType(descriptor) === "multi") {
      return normalizeStringValues(value)
    }

    if (typeof value !== "string") {
      return null
    }
    const normalized = value.trim()
    return normalized === "" ? null : normalized
  }
  if (descriptor.type === TASK_PROP_TYPE.BLOCK_REFS) {
    return normalizeDbIdValues(value)
  }

  return null
}

function getClearedTaskCustomPropertyValue(
  descriptor: TaskCustomPropertyDescriptor,
): TaskCustomPropertyValue {
  if (
    descriptor.type === TASK_PROP_TYPE.TEXT_CHOICES &&
    getTaskTextChoicesSubType(descriptor) === "multi"
  ) {
    return []
  }
  if (descriptor.type === TASK_PROP_TYPE.BLOCK_REFS) {
    return []
  }
  if (descriptor.type === TASK_PROP_TYPE.BOOLEAN) {
    return false
  }

  return null
}

function getEmptyTaskCustomPropertyValue(
  property: Pick<BlockProperty, "type" | "typeArgs">,
): TaskCustomPropertyValue {
  if (
    property.type === TASK_PROP_TYPE.TEXT_CHOICES &&
    getTaskTextChoicesSubType(property) === "multi"
  ) {
    return []
  }
  if (property.type === TASK_PROP_TYPE.BLOCK_REFS) {
    return []
  }
  if (property.type === TASK_PROP_TYPE.BOOLEAN) {
    return false
  }
  if (property.type === TASK_PROP_TYPE.TEXT) {
    return ""
  }

  return null
}

function getTaskTextChoicesSubType(
  property: Pick<BlockProperty, "typeArgs"> | Pick<TaskCustomPropertyDescriptor, "typeArgs">,
): "single" | "multi" {
  return typeof property.typeArgs?.subType === "string" && property.typeArgs.subType === "multi"
    ? "multi"
    : "single"
}

function cloneTaskCustomPropertyValue(
  value: TaskCustomPropertyValue,
): TaskCustomPropertyValue {
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  if (Array.isArray(value)) {
    return [...value] as string[] | DbId[]
  }

  return value
}

function normalizeRefDataProperties(
  refData: BlockProperty[] | undefined,
): BlockProperty[] {
  if (!Array.isArray(refData)) {
    return []
  }

  const normalized: BlockProperty[] = []
  const seen = new Set<string>()
  for (const property of refData) {
    const name = normalizeTaskPropertyName(property.name)
    if (name === "") {
      continue
    }

    const key = name.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push({
      ...property,
      name,
    })
  }

  return normalized
}

function findTaskProperty(
  refData: BlockProperty[] | undefined,
  name: string,
): BlockProperty | undefined {
  const normalizedName = normalizeTaskPropertyName(name).toLowerCase()
  return normalizeRefDataProperties(refData).find((property) => {
    return normalizeTaskPropertyName(property.name).toLowerCase() === normalizedName
  })
}

function normalizeTaskPropertyName(name: unknown): string {
  return typeof name === "string"
    ? name.replace(/\s+/g, " ").trim()
    : ""
}

function normalizeStringValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedValues: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") {
      continue
    }

    const normalized = item.replace(/\s+/g, " ").trim()
    if (normalized === "") {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalizedValues.push(normalized)
  }

  return normalizedValues
}

function normalizeDbIdValues(value: unknown): DbId[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedValues: DbId[] = []
  const seen = new Set<DbId>()
  for (const item of value) {
    const parsed = Number(item)
    if (!Number.isInteger(parsed) || seen.has(parsed)) {
      continue
    }

    seen.add(parsed)
    normalizedValues.push(parsed)
  }

  return normalizedValues
}

function toTaskCustomDateValue(value: unknown): Date | null {
  if (value == null) {
    return null
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}
