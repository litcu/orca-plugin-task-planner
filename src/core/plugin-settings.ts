import { t } from "../libs/l10n"
import { TASK_TAG_ALIAS } from "./task-schema"
import type { TaskTimerMode } from "./task-timer"
import type { BuiltinTaskViewsTab } from "./task-views-state"

export interface TaskPlannerSettings {
  taskTagName: string
  dueSoonDays: number
  dueSoonIncludeOverdue: boolean
  defaultTaskViewsTab: BuiltinTaskViewsTab
  showTaskPanelIcon: boolean
  taskTimerEnabled: boolean
  taskTimerAutoStartOnDoing: boolean
  taskTimerMode: TaskTimerMode
}

const TASK_TAG_NAME_SETTING = "taskTagName"
const DUE_SOON_DAYS_SETTING = "dueSoonDays"
const DUE_SOON_INCLUDE_OVERDUE_SETTING = "dueSoonIncludeOverdue"
const DEFAULT_TASK_VIEWS_TAB_SETTING = "defaultTaskViewsTab"
const SHOW_TASK_PANEL_ICON_SETTING = "showTaskPanelIcon"
const TASK_TIMER_ENABLED_SETTING = "taskTimerEnabled"
const TASK_TIMER_AUTO_START_ON_DOING_SETTING = "taskTimerAutoStartOnDoing"
const TASK_TIMER_MODE_SETTING = "taskTimerMode"
const DEFAULT_DUE_SOON_DAYS = 7
const DEFAULT_TASK_VIEWS_TAB: BuiltinTaskViewsTab = "next-actions"
const DEFAULT_TASK_TIMER_MODE: TaskTimerMode = "direct"

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
    [DEFAULT_TASK_VIEWS_TAB_SETTING]: {
      label: t("Default task panel view"),
      description: t("The view shown when opening task panel for the first time."),
      type: "singleChoice",
      choices: [
        {
          label: t("Dashboard"),
          value: "dashboard",
        },
        {
          label: t("Active Tasks"),
          value: "next-actions",
        },
        {
          label: t("All Tasks"),
          value: "all-tasks",
        },
        {
          label: t("Starred Tasks"),
          value: "starred-tasks",
        },
        {
          label: t("Due Soon"),
          value: "due-soon",
        },
        {
          label: t("Review"),
          value: "review-due",
        },
      ],
      defaultValue: DEFAULT_TASK_VIEWS_TAB,
    },
    [SHOW_TASK_PANEL_ICON_SETTING]: {
      label: t("Show task panel icon"),
      description: t("Show task panel icon in the top bar."),
      type: "boolean",
      defaultValue: true,
    },
    [TASK_TIMER_ENABLED_SETTING]: {
      label: t("Enable task timer"),
      description: t("Show timer controls for tasks and persist elapsed time."),
      type: "boolean",
      defaultValue: false,
    },
    [TASK_TIMER_AUTO_START_ON_DOING_SETTING]: {
      label: t("Auto start timer when status becomes Doing"),
      description: t("Automatically start timer when task status changes to Doing."),
      type: "boolean",
      defaultValue: false,
    },
    [TASK_TIMER_MODE_SETTING]: {
      label: t("Task timer mode"),
      description: t("Choose how task timer is displayed."),
      type: "singleChoice",
      choices: [
        {
          label: t("Direct timer"),
          value: "direct",
        },
        {
          label: t("Pomodoro timer"),
          value: "pomodoro",
        },
      ],
      defaultValue: DEFAULT_TASK_TIMER_MODE,
    },
  })
}

export function getPluginSettings(pluginName: string): TaskPlannerSettings {
  const pluginSettings = orca.state.plugins[pluginName]?.settings
  const taskTagName = normalizeTaskTagName(
    pluginSettings?.[TASK_TAG_NAME_SETTING],
  )
  const dueSoonDays = normalizeDueSoonDays(pluginSettings?.[DUE_SOON_DAYS_SETTING])
  const dueSoonIncludeOverdue = normalizeDueSoonIncludeOverdue(
    pluginSettings?.[DUE_SOON_INCLUDE_OVERDUE_SETTING],
  )
  const defaultTaskViewsTab = normalizeDefaultTaskViewsTab(
    pluginSettings?.[DEFAULT_TASK_VIEWS_TAB_SETTING],
  )
  const showTaskPanelIcon = normalizeShowTaskPanelIcon(
    pluginSettings?.[SHOW_TASK_PANEL_ICON_SETTING],
  )
  const taskTimerEnabled = normalizeTaskTimerEnabled(
    pluginSettings?.[TASK_TIMER_ENABLED_SETTING],
  )
  const taskTimerAutoStartOnDoing = normalizeTaskTimerAutoStartOnDoing(
    pluginSettings?.[TASK_TIMER_AUTO_START_ON_DOING_SETTING],
  )
  const taskTimerMode = normalizeTaskTimerMode(
    pluginSettings?.[TASK_TIMER_MODE_SETTING],
  )

  return {
    taskTagName,
    dueSoonDays,
    dueSoonIncludeOverdue,
    defaultTaskViewsTab,
    showTaskPanelIcon,
    taskTimerEnabled,
    taskTimerAutoStartOnDoing,
    taskTimerMode,
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

function normalizeDefaultTaskViewsTab(rawValue: unknown): BuiltinTaskViewsTab {
  switch (rawValue) {
    case "dashboard":
    case "next-actions":
    case "all-tasks":
    case "starred-tasks":
    case "due-soon":
    case "review-due":
      return rawValue
    default:
      return DEFAULT_TASK_VIEWS_TAB
  }
}

function normalizeShowTaskPanelIcon(rawValue: unknown): boolean {
  return rawValue !== false
}

function normalizeTaskTimerEnabled(rawValue: unknown): boolean {
  return rawValue === true
}

function normalizeTaskTimerAutoStartOnDoing(rawValue: unknown): boolean {
  return rawValue === true
}

function normalizeTaskTimerMode(rawValue: unknown): TaskTimerMode {
  return rawValue === "pomodoro" ? "pomodoro" : DEFAULT_TASK_TIMER_MODE
}
