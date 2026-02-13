import { t } from "../libs/l10n"
import { TASK_TAG_ALIAS } from "./task-schema"

export interface MyLifeOrganizedSettings {
  taskTagName: string
  dueSoonDays: number
  dueSoonIncludeOverdue: boolean
}

const TASK_TAG_NAME_SETTING = "taskTagName"
const DUE_SOON_DAYS_SETTING = "dueSoonDays"
const DUE_SOON_INCLUDE_OVERDUE_SETTING = "dueSoonIncludeOverdue"
const DEFAULT_DUE_SOON_DAYS = 7

export async function ensurePluginSettingsSchema(pluginName: string): Promise<void> {
  await orca.plugins.setSettingsSchema(pluginName, {
    [TASK_TAG_NAME_SETTING]: {
      label: t("Task tag name"),
      description: t("Name of the tag used to identify tasks. Changes apply after clicking Save."),
      type: "string",
      defaultValue: TASK_TAG_ALIAS,
    },
    [DUE_SOON_DAYS_SETTING]: {
      label: t("Due soon days"),
      description: t("Number of days used by the Due Soon view."),
      type: "number",
      defaultValue: DEFAULT_DUE_SOON_DAYS,
    },
    [DUE_SOON_INCLUDE_OVERDUE_SETTING]: {
      label: t("Include overdue in Due Soon"),
      description: t("Whether the Due Soon view should include overdue tasks."),
      type: "boolean",
      defaultValue: false,
    },
  })
}

export function getPluginSettings(pluginName: string): MyLifeOrganizedSettings {
  const pluginSettings = orca.state.plugins[pluginName]?.settings
  const taskTagName = normalizeTaskTagName(
    pluginSettings?.[TASK_TAG_NAME_SETTING],
  )
  const dueSoonDays = normalizeDueSoonDays(pluginSettings?.[DUE_SOON_DAYS_SETTING])
  const dueSoonIncludeOverdue = normalizeDueSoonIncludeOverdue(
    pluginSettings?.[DUE_SOON_INCLUDE_OVERDUE_SETTING],
  )

  return {
    taskTagName,
    dueSoonDays,
    dueSoonIncludeOverdue,
  }
}

function normalizeTaskTagName(rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    return TASK_TAG_ALIAS
  }

  const normalized = rawValue.trim().replace(/^#+/, "")
  return normalized === "" ? TASK_TAG_ALIAS : normalized
}

function normalizeDueSoonDays(rawValue: unknown): number {
  if (typeof rawValue !== "number" || Number.isNaN(rawValue) || !Number.isFinite(rawValue)) {
    return DEFAULT_DUE_SOON_DAYS
  }

  const rounded = Math.round(rawValue)
  if (rounded < 1) {
    return 1
  }

  return Math.min(rounded, 3650)
}

function normalizeDueSoonIncludeOverdue(rawValue: unknown): boolean {
  return rawValue === true
}
