import type { BlockProperty, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "./task-schema"
import { t } from "../libs/l10n"

const PROP_TYPE = {
  TEXT: 1,
  BLOCK_REFS: 2,
  NUMBER: 3,
  BOOLEAN: 4,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

export interface TaskPropertyValues {
  status: string
  startTime: Date | null
  endTime: Date | null
  importance: number | null
  urgency: number | null
  effort: number | null
  star: boolean
  repeatRule: string
  dependsOn: DbId[]
  dependsMode: string
  dependencyDelay: number | null
}

export interface TaskFieldLabels {
  title: string
  status: string
  startTime: string
  endTime: string
  importance: string
  urgency: string
  effort: string
  star: string
  repeatRule: string
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
    importance: t("Importance"),
    urgency: t("Urgency"),
    effort: t("Effort"),
    star: t("Star"),
    repeatRule: t("Repeat rule"),
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

  return {
    status: getString(refData, names.status) ?? schema.statusChoices[0],
    startTime: getDate(refData, names.startTime),
    endTime: getDate(refData, names.endTime),
    importance: getNumber(refData, names.importance),
    urgency: getNumber(refData, names.urgency),
    effort: getNumber(refData, names.effort),
    star: getBoolean(refData, names.star),
    repeatRule: getString(refData, names.repeatRule) ?? "",
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
  const property = refData?.find((item) => item.name === name)
  return typeof property?.value === "string" ? property.value : null
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
