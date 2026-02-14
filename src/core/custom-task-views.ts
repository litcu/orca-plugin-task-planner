export type CustomTaskViewFilterGroupLogic = "and" | "or"
export type CustomTaskViewFilterFieldType =
  | "text"
  | "single-select"
  | "multi-select"
  | "number"
  | "boolean"
  | "datetime"
  | "block-refs"
export type CustomTaskViewFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "contains-any"
  | "contains-all"
  | "not-contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "before"
  | "after"
  | "empty"
  | "not-empty"

export interface CustomTaskViewFilterRuleNode {
  id: string
  kind: "rule"
  fieldKey: string
  operator: CustomTaskViewFilterOperator
  value: string | string[]
}

export interface CustomTaskViewFilterGroupNode {
  id: string
  kind: "group"
  logic: CustomTaskViewFilterGroupLogic
  children: CustomTaskViewFilterNode[]
}

export type CustomTaskViewFilterNode =
  | CustomTaskViewFilterRuleNode
  | CustomTaskViewFilterGroupNode

export interface CustomTaskView {
  id: string
  name: string
  filter: CustomTaskViewFilterGroupNode
  createdAt: number
  updatedAt: number
}

const CUSTOM_TASK_VIEWS_DATA_KEY = "taskCustomViews.v1"
const CUSTOM_TASK_VIEW_FILTER_OPERATOR_SET = new Set<CustomTaskViewFilterOperator>([
  "eq",
  "neq",
  "contains",
  "contains-any",
  "contains-all",
  "not-contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "before",
  "after",
  "empty",
  "not-empty",
])
const CUSTOM_TASK_VIEW_FILTER_ROOT_ID = "__root__"
const CUSTOM_TASK_VIEW_DEFAULT_FIELD_KEY = "__task_name__"

let customTaskViewFilterNodeSeed = 0

export function createCustomTaskViewId(): string {
  const randomPart = Math.random().toString(36).slice(2, 10)
  return `view-${Date.now().toString(36)}-${randomPart}`
}

export function createDefaultCustomTaskViewFilterGroup(
  id: string = CUSTOM_TASK_VIEW_FILTER_ROOT_ID,
  logic: CustomTaskViewFilterGroupLogic = "and",
): CustomTaskViewFilterGroupNode {
  return {
    id,
    kind: "group",
    logic,
    children: [],
  }
}

export function cloneCustomTaskViewFilterGroup(
  value: CustomTaskViewFilterGroupNode,
): CustomTaskViewFilterGroupNode {
  return normalizeCustomTaskViewFilterGroup(value)
}

export function normalizeCustomTaskViewName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeCustomTaskViewFilterGroup(
  value: unknown,
): CustomTaskViewFilterGroupNode {
  const normalized = normalizeCustomTaskViewFilterGroupInternal(value, true)
  return normalized ?? createDefaultCustomTaskViewFilterGroup()
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
  if (!isRecord(value.filter)) {
    return null
  }

  const filter = normalizeCustomTaskViewFilterGroup(value.filter)
  const createdAt = toUnixTimestamp(value.createdAt) ?? Date.now()
  const updatedAt = toUnixTimestamp(value.updatedAt) ?? createdAt

  return {
    id,
    name,
    filter,
    createdAt,
    updatedAt,
  }
}

function normalizeCustomTaskViewFilterGroupInternal(
  value: unknown,
  isRoot: boolean,
): CustomTaskViewFilterGroupNode | null {
  if (!isRecord(value)) {
    return null
  }

  const logic: CustomTaskViewFilterGroupLogic = value.logic === "or" ? "or" : "and"
  const id = normalizeCustomTaskViewFilterNodeId(value.id, isRoot ? "root" : "group")
  const rawChildren = Array.isArray(value.children) ? value.children : []
  const children = rawChildren
    .map((item: unknown) => normalizeCustomTaskViewFilterNode(item))
    .filter((item): item is CustomTaskViewFilterNode => item != null)

  return {
    id,
    kind: "group",
    logic,
    children,
  }
}

function normalizeCustomTaskViewFilterNode(
  value: unknown,
): CustomTaskViewFilterNode | null {
  if (!isRecord(value)) {
    return null
  }

  if (value.kind === "group") {
    return normalizeCustomTaskViewFilterGroupInternal(value, false)
  }
  if (value.kind === "rule") {
    return normalizeCustomTaskViewFilterRuleNode(value)
  }

  if (Array.isArray(value.children)) {
    return normalizeCustomTaskViewFilterGroupInternal(value, false)
  }

  return normalizeCustomTaskViewFilterRuleNode(value)
}

function normalizeCustomTaskViewFilterRuleNode(
  value: Record<string, unknown>,
): CustomTaskViewFilterRuleNode | null {
  const fieldKey = typeof value.fieldKey === "string" && value.fieldKey.trim() !== ""
    ? value.fieldKey.trim()
    : CUSTOM_TASK_VIEW_DEFAULT_FIELD_KEY
  const operator = normalizeCustomTaskViewFilterOperator(value.operator)

  return {
    id: normalizeCustomTaskViewFilterNodeId(value.id, "rule"),
    kind: "rule",
    fieldKey,
    operator,
    value: normalizeCustomTaskViewFilterRuleValue(value.value, operator),
  }
}

function normalizeCustomTaskViewFilterOperator(
  value: unknown,
): CustomTaskViewFilterOperator {
  if (typeof value === "string" && CUSTOM_TASK_VIEW_FILTER_OPERATOR_SET.has(value as any)) {
    return value as CustomTaskViewFilterOperator
  }

  return "contains"
}

function normalizeCustomTaskViewFilterRuleValue(
  value: unknown,
  operator: CustomTaskViewFilterOperator,
): string | string[] {
  if (operator === "between") {
    return normalizeCustomTaskViewFilterRangeValueList(value)
  }

  if (Array.isArray(value)) {
    return normalizeCustomTaskViewFilterValueList(
      value.map((item) => toStringValue(item)),
    )
  }

  return toStringValue(value)
}

function normalizeCustomTaskViewFilterValueList(values: string[]): string[] {
  const normalizedValues: string[] = []

  for (const rawValue of values) {
    const value = rawValue.replace(/\s+/g, " ").trim()
    if (value !== "") {
      normalizedValues.push(value)
    }
  }

  return normalizedValues
}

function normalizeCustomTaskViewFilterRangeValueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [
      normalizeCustomTaskViewFilterEditorValue(toStringValue(value[0])),
      normalizeCustomTaskViewFilterEditorValue(toStringValue(value[1])),
    ]
  }

  const normalized = normalizeCustomTaskViewFilterEditorValue(toStringValue(value))
  return [normalized, ""]
}

function normalizeCustomTaskViewFilterEditorValue(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCustomTaskViewFilterNodeId(
  value: unknown,
  kind: "root" | "group" | "rule",
): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim()
  }

  if (kind === "root") {
    return CUSTOM_TASK_VIEW_FILTER_ROOT_ID
  }

  customTaskViewFilterNodeSeed += 1
  return `${kind}-${customTaskViewFilterNodeSeed}`
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  return ""
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
