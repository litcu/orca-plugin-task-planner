import { t } from "../libs/l10n"
import { TASK_TAG_ALIAS } from "./task-schema"

export interface MyLifeOrganizedSettings {
  taskTagName: string
}

const TASK_TAG_NAME_SETTING = "taskTagName"

export async function ensurePluginSettingsSchema(pluginName: string): Promise<void> {
  await orca.plugins.setSettingsSchema(pluginName, {
    [TASK_TAG_NAME_SETTING]: {
      label: t("Task tag name"),
      description: t("Name of the tag used to identify tasks. Changes apply after clicking Save."),
      type: "string",
      defaultValue: TASK_TAG_ALIAS,
    },
  })
}

export function getPluginSettings(pluginName: string): MyLifeOrganizedSettings {
  const taskTagName = normalizeTaskTagName(
    orca.state.plugins[pluginName]?.settings?.[TASK_TAG_NAME_SETTING],
  )

  return {
    taskTagName,
  }
}

function normalizeTaskTagName(rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    return TASK_TAG_ALIAS
  }

  const normalized = rawValue.trim().replace(/^#+/, "")
  return normalized === "" ? TASK_TAG_ALIAS : normalized
}
