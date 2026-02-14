import type {
  Block,
  DbId,
  QueryDescription2,
  QueryGroup2,
  QueryItem2,
} from "../orca.d.ts"
import { getMirrorIdFromBlock } from "./block-utils"

export interface CustomTaskView {
  id: string
  name: string
  query: QueryDescription2
  createdAt: number
  updatedAt: number
}

const CUSTOM_TASK_VIEWS_DATA_KEY = "taskCustomViews.v1"
const CUSTOM_TASK_QUERY_PAGE_SIZE = 5000
const CUSTOM_QUERY_GROUP_KINDS = new Set<number>([100, 101, 102, 103, 104, 105, 106])

export function createCustomTaskViewId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `view-${Date.now().toString(36)}-${randomPart}`
}

export function createDefaultCustomTaskViewQuery(): QueryDescription2 {
  return {
    q: createDefaultCustomTaskViewGroup(),
  }
}

export function cloneCustomTaskViewQuery(
  value: QueryDescription2,
): QueryDescription2 {
  return normalizeCustomTaskViewQuery(value)
}

export function normalizeCustomTaskViewName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeCustomTaskViewQuery(value: unknown): QueryDescription2 {
  const cloned = cloneRecord(value)
  if (cloned == null) {
    return createDefaultCustomTaskViewQuery()
  }

  return {
    ...(cloned as QueryDescription2),
    q: normalizeCustomTaskViewGroup(cloned.q),
  }
}

export async function loadCustomTaskViews(pluginName: string): Promise<CustomTaskView[]> {
  const raw = await orca.plugins.getData(pluginName, CUSTOM_TASK_VIEWS_DATA_KEY)
  if (typeof raw !== "string" || raw.trim() === "") {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return normalizeCustomTaskViews(parsed)
  } catch (error) {
    console.error(error)
    return []
  }
}

export async function saveCustomTaskViews(
  pluginName: string,
  views: CustomTaskView[],
): Promise<void> {
  const normalizedViews = normalizeCustomTaskViews(views)
  await orca.plugins.setData(
    pluginName,
    CUSTOM_TASK_VIEWS_DATA_KEY,
    JSON.stringify(normalizedViews),
  )
}

export async function executeCustomTaskViewQuery(
  view: CustomTaskView,
  taskTagName: string,
): Promise<DbId[]> {
  const description = buildCustomTaskQueryDescription(view.query, taskTagName)
  const legacyDescription = convertQueryDescriptionToLegacy(description)
  const rawResult = await orca.invokeBackend("query", legacyDescription) as unknown
  const result = normalizeQueryResultList(rawResult)

  const matchedIds: DbId[] = []
  const seenIds = new Set<DbId>()

  for (const item of result) {
    const taskId = extractDbIdFromQueryItem(item)
    if (taskId == null) {
      continue
    }

    const normalizedTaskId = isRecord(item) && typeof item.id === "number"
      ? getMirrorIdFromBlock(item as Pick<Block, "id" | "properties">)
      : taskId

    if (seenIds.has(taskId)) {
      continue
    }

    seenIds.add(normalizedTaskId)
    matchedIds.push(normalizedTaskId)
  }

  return matchedIds
}

function buildCustomTaskQueryDescription(
  query: QueryDescription2,
  taskTagName: string,
): QueryDescription2 {
  const normalizedQuery = normalizeCustomTaskViewQuery(query)
  const userGroup = normalizeScopedCustomTaskQueryGroup(normalizedQuery.q)
  const scopedConditions: QueryItem2[] = [{ kind: 4, name: taskTagName }]

  if (userGroup != null) {
    scopedConditions.push(userGroup)
  }

  return {
    ...normalizedQuery,
    page: 1,
    pageSize: CUSTOM_TASK_QUERY_PAGE_SIZE,
    q: {
      kind: 100,
      conditions: scopedConditions,
    },
  }
}

function normalizeScopedCustomTaskQueryGroup(
  value: QueryDescription2["q"],
): QueryDescription2["q"] | null {
  if (!isRecord(value) || !isCustomQueryGroupKind(value.kind)) {
    return null
  }

  const conditions = Array.isArray(value.conditions) ? value.conditions : []
  if (conditions.length === 0) {
    return null
  }

  return value
}

function convertQueryDescriptionToLegacy(
  description: QueryDescription2,
): QueryDescription2 {
  const legacyGroup = convertQueryGroupToLegacy(description.q)
  if (legacyGroup == null) {
    return description
  }

  return {
    ...description,
    q: legacyGroup as unknown as QueryGroup2,
  }
}

function convertQueryGroupToLegacy(
  value: QueryDescription2["q"],
): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.kind !== "number") {
    return null
  }

  const legacyKind = mapLegacyGroupKind(value.kind)
  if (legacyKind == null) {
    return null
  }

  const cloned = cloneRecord(value) ?? {}
  const rawConditions = Array.isArray(cloned.conditions) ? cloned.conditions : []
  const legacyConditions = rawConditions
    .map((item) => convertQueryItemToLegacy(item))
    .filter((item): item is Record<string, unknown> => item != null)

  return {
    ...cloned,
    kind: legacyKind,
    conditions: legacyConditions,
  }
}

function convertQueryItemToLegacy(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.kind === "number" && isCustomQueryGroupKind(value.kind)) {
    return convertQueryGroupToLegacy(value as unknown as QueryDescription2["q"])
  }

  return cloneRecord(value)
}

function mapLegacyGroupKind(kind: number): 1 | 2 | null {
  if (kind === 100 || kind === 102 || kind === 104 || kind === 106) {
    return 1
  }
  if (kind === 101 || kind === 103 || kind === 105) {
    return 2
  }
  return null
}

function normalizeQueryResultList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!isRecord(value)) {
    return []
  }

  if (Array.isArray(value.blocks)) {
    return value.blocks
  }
  if (Array.isArray(value.items)) {
    return value.items
  }
  if (Array.isArray(value.rows)) {
    return value.rows
  }
  if (Array.isArray(value.data)) {
    return value.data
  }

  return []
}

function extractDbIdFromQueryItem(value: unknown): DbId | null {
  if (typeof value === "number") {
    return value
  }

  if (!isRecord(value)) {
    return null
  }

  if (typeof value.id === "number") {
    return value.id
  }
  if (typeof value.blockId === "number") {
    return value.blockId
  }

  return null
}

function normalizeCustomTaskViews(value: unknown): CustomTaskView[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedViews: CustomTaskView[] = []
  const seenIds = new Set<string>()

  for (const item of value) {
    const normalizedView = normalizeCustomTaskView(item)
    if (normalizedView == null || seenIds.has(normalizedView.id)) {
      continue
    }

    seenIds.add(normalizedView.id)
    normalizedViews.push(normalizedView)
  }

  return normalizedViews
}

function normalizeCustomTaskView(value: unknown): CustomTaskView | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (id === "") {
    return null
  }

  const name = normalizeCustomTaskViewName(
    typeof value.name === "string" ? value.name : "",
  )
  if (name === "") {
    return null
  }

  const createdAt = toUnixTimestamp(value.createdAt) ?? Date.now()
  const updatedAt = toUnixTimestamp(value.updatedAt) ?? createdAt

  return {
    id,
    name,
    query: normalizeCustomTaskViewQuery(value.query),
    createdAt,
    updatedAt,
  }
}

function createDefaultCustomTaskViewGroup(): QueryGroup2 {
  return {
    kind: 100,
    conditions: [],
  }
}

function normalizeCustomTaskViewGroup(value: unknown): QueryGroup2 {
  if (!isRecord(value) || !isCustomQueryGroupKind(value.kind)) {
    return createDefaultCustomTaskViewGroup()
  }

  const cloned = cloneRecord(value) ?? {}
  const rawConditions = Array.isArray(cloned.conditions) ? cloned.conditions : []
  const conditions = rawConditions
    .map((item: unknown) => normalizeCustomTaskQueryItem(item))
    .filter((item: QueryItem2 | null): item is QueryItem2 => item != null)

  return {
    ...(cloned as unknown as QueryGroup2),
    kind: value.kind,
    conditions,
  }
}

function normalizeCustomTaskQueryItem(value: unknown): QueryItem2 | null {
  if (!isRecord(value) || typeof value.kind !== "number") {
    return null
  }

  if (isCustomQueryGroupKind(value.kind)) {
    return normalizeCustomTaskViewGroup(value)
  }

  const cloned = cloneRecord(value)
  return cloned == null ? null : (cloned as unknown as QueryItem2)
}

function isCustomQueryGroupKind(value: unknown): value is QueryGroup2["kind"] {
  return typeof value === "number" && CUSTOM_QUERY_GROUP_KINDS.has(value)
}

function cloneRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null
  }

  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== "string") {
      return null
    }
    const parsed = JSON.parse(serialized) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toUnixTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  return null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value != null
}
