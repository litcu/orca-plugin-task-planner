import type { BlockProperty } from "../orca.d.ts"
import {
  getDefaultProjectStatus,
  type ProjectSchemaDefinition,
} from "./project-schema"

export const PROJECT_PROP_TYPE = {
  TEXT: 1,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

export interface ProjectPropertyValues {
  status: string
  startTime: Date | null
  dueTime: Date | null
  labels: string[]
  note: string
}

export function getProjectPropertiesFromRef(
  refData: BlockProperty[] | undefined,
  schema: ProjectSchemaDefinition,
): ProjectPropertyValues {
  const names = schema.propertyNames
  return {
    status: getString(refData, names.status) ?? getDefaultProjectStatus(schema),
    startTime: getDate(refData, names.startTime),
    dueTime: getDate(refData, names.dueTime),
    labels: getStringArray(refData, names.labels),
    note: getString(refData, names.note) ?? "",
  }
}

export function buildProjectCoreRefData(
  values: ProjectPropertyValues,
  schema: ProjectSchemaDefinition,
): BlockProperty[] {
  const names = schema.propertyNames
  return [
    {
      name: names.status,
      type: PROJECT_PROP_TYPE.TEXT_CHOICES,
      value: values.status,
    },
    {
      name: names.startTime,
      type: PROJECT_PROP_TYPE.DATE_TIME,
      value: values.startTime,
    },
    {
      name: names.dueTime,
      type: PROJECT_PROP_TYPE.DATE_TIME,
      value: values.dueTime,
    },
    {
      name: names.labels,
      type: PROJECT_PROP_TYPE.TEXT_CHOICES,
      value: normalizeProjectLabels(values.labels),
    },
    {
      name: names.note,
      type: PROJECT_PROP_TYPE.TEXT,
      value: values.note.trim() === "" ? null : values.note,
    },
  ]
}

export function toProjectRefDataForSave(
  values: ProjectPropertyValues,
  schema: ProjectSchemaDefinition,
  existingRefData?: BlockProperty[],
): BlockProperty[] {
  return mergeProjectRefData(
    existingRefData,
    buildProjectCoreRefData(values, schema),
  )
}

export function normalizeProjectLabels(labels: string[]): string[] {
  const normalizedLabels: string[] = []
  const seen = new Set<string>()

  for (const rawLabel of labels) {
    const label = rawLabel.replace(/\s+/g, " ").trim()
    if (label === "") {
      continue
    }

    const key = label.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalizedLabels.push(label)
  }

  return normalizedLabels
}

export function mergeProjectLabelValues(...sources: (string[] | undefined)[]): string[] {
  const merged: string[] = []
  for (const source of sources) {
    if (source == null) {
      continue
    }
    merged.push(...source)
  }

  return normalizeProjectLabels(merged)
}

export function readProjectLabelChoiceValues(
  property: BlockProperty | undefined,
): string[] {
  const rawChoices = property?.typeArgs?.choices
  if (!Array.isArray(rawChoices)) {
    return []
  }

  return normalizeProjectLabels(
    rawChoices.map((item) => {
      if (typeof item === "string") {
        return item
      }
      if (isRecord(item) && typeof item.n === "string") {
        return item.n
      }
      if (isRecord(item) && typeof item.value === "string") {
        return item.value
      }
      return ""
    }),
  )
}

function mergeProjectRefData(
  existingRefData: BlockProperty[] | undefined,
  payload: BlockProperty[],
): BlockProperty[] {
  const result = normalizeRefDataProperties(existingRefData)
  const indexByName = new Map<string, number>()

  result.forEach((property, index) => {
    indexByName.set(normalizeProjectPropertyName(property.name).toLowerCase(), index)
  })

  for (const property of payload) {
    const name = normalizeProjectPropertyName(property.name)
    if (name === "") {
      continue
    }

    const normalizedProperty = {
      ...property,
      name,
    }
    const key = name.toLowerCase()
    const existingIndex = indexByName.get(key)
    if (existingIndex == null) {
      indexByName.set(key, result.length)
      result.push(normalizedProperty)
      continue
    }

    result[existingIndex] = {
      ...result[existingIndex],
      ...normalizedProperty,
    }
  }

  return result
}

function getString(
  refData: BlockProperty[] | undefined,
  name: string,
): string | null {
  const property = findProjectProperty(refData, name)
  return typeof property?.value === "string" ? property.value : null
}

function getStringArray(
  refData: BlockProperty[] | undefined,
  name: string,
): string[] {
  const property = findProjectProperty(refData, name)
  if (!Array.isArray(property?.value)) {
    return []
  }

  return normalizeProjectLabels(
    property.value.filter((item): item is string => typeof item === "string"),
  )
}

function getDate(
  refData: BlockProperty[] | undefined,
  name: string,
): Date | null {
  const property = findProjectProperty(refData, name)
  if (property?.value == null) {
    return null
  }

  const date = property.value instanceof Date
    ? property.value
    : new Date(property.value)

  return Number.isNaN(date.getTime()) ? null : date
}

function findProjectProperty(
  refData: BlockProperty[] | undefined,
  name: string,
): BlockProperty | undefined {
  const normalizedName = normalizeProjectPropertyName(name).toLowerCase()
  return normalizeRefDataProperties(refData).find((property) => {
    return normalizeProjectPropertyName(property.name).toLowerCase() === normalizedName
  })
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
    const name = normalizeProjectPropertyName(property.name)
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

function normalizeProjectPropertyName(name: unknown): string {
  return typeof name === "string"
    ? name.replace(/\s+/g, " ").trim()
    : ""
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}
