import type { Block } from "./orca.d.ts"
import { ensureTaskTagSchema, TASK_TAG_ALIAS, type TaskSchemaDefinition } from "./core/task-schema"
import { setupTaskQuickActions } from "./core/task-service"
import { setupTaskPopupEntry } from "./core/task-popup-entry"
import { setupNextActionsEntry } from "./core/next-actions-entry"
import {
  ensurePluginSettingsSchema,
  getPluginSettings,
  type TaskPlannerSettings,
} from "./core/plugin-settings"
import { collectNextActionEvaluations } from "./core/dependency-engine"
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

const DAY_MS = 24 * 60 * 60 * 1000

let pluginName: string
let taskQuickActionsDisposer: (() => Promise<void>) | null = null
let taskPopupEntryDisposer: (() => void) | null = null
let nextActionsEntryDisposer: (() => void) | null = null
let settingsUnsubscribe: (() => void) | null = null
let settingsUpdateChain: Promise<void> = Promise.resolve()
let appliedTaskTagName = TASK_TAG_ALIAS
let appliedSettingsVisibilityKey = ""
let unloaded = false

export async function load(_name: string) {
  pluginName = _name
  unloaded = false
  settingsUpdateChain = Promise.resolve()
  appliedSettingsVisibilityKey = ""

  setupL10N(orca.state.locale, { "zh-CN": zhCN })
  const settings = getPluginSettings(pluginName)
  await syncSettingsSchemaVisibility(settings)
  const schemaResult = await ensureTaskTagSchema(orca.state.locale, settings.taskTagName)
  appliedTaskTagName = schemaResult.schema.tagAlias
  await setupRuntimeWithSchema(schemaResult.schema)

  if (settingsUnsubscribe != null) {
    settingsUnsubscribe()
    settingsUnsubscribe = null
  }
  subscribeSettingsChanges()
  await notifyStartupTaskSummary(schemaResult.schema, settings)

  console.log(
    t("Task schema initialized", {
      locale: schemaResult.schemaLocale,
      mode: "ALL",
    }),
  )
  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  unloaded = true

  if (settingsUnsubscribe != null) {
    settingsUnsubscribe()
    settingsUnsubscribe = null
  }

  try {
    await settingsUpdateChain
  } catch {
    // Ignore pending settings sync errors during unload.
  }

  await disposeRuntime()

  console.log(`${pluginName} unloaded.`)
}

function subscribeSettingsChanges() {
  const pluginState = orca.state.plugins[pluginName]
  if (pluginState == null) {
    return
  }

  const { subscribe } = window.Valtio
  settingsUnsubscribe = subscribe(pluginState, () => {
    settingsUpdateChain = settingsUpdateChain
      .then(async () => {
        if (unloaded) {
          return
        }

        const settings = getPluginSettings(pluginName)
        await syncSettingsSchemaVisibility(settings)

        if (settings.taskTagName === appliedTaskTagName) {
          return
        }

        await applyTaskTagNameChange(settings.taskTagName)
      })
      .catch((error: unknown) => {
        if (unloaded) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        console.error(t("Failed to apply task tag name: ${message}", { message }))
      })
  })
}

async function syncSettingsSchemaVisibility(settings: TaskPlannerSettings): Promise<void> {
  const nextVisibilityKey = resolveSettingsVisibilityKey(settings)
  if (nextVisibilityKey === appliedSettingsVisibilityKey) {
    return
  }

  await ensurePluginSettingsSchema(pluginName, {
    myDayEnabled: settings.myDayEnabled,
    taskTimerEnabled: settings.taskTimerEnabled,
  })

  appliedSettingsVisibilityKey = nextVisibilityKey
}

function resolveSettingsVisibilityKey(settings: TaskPlannerSettings): string {
  return `${settings.myDayEnabled ? "1" : "0"}|${settings.taskTimerEnabled ? "1" : "0"}`
}

async function applyTaskTagNameChange(nextTaskTagName: string): Promise<void> {
  const previousTaskTagName = appliedTaskTagName
  if (nextTaskTagName !== previousTaskTagName) {
    await renameTaskTagAlias(previousTaskTagName, nextTaskTagName)
  }

  const schemaResult = await ensureTaskTagSchema(orca.state.locale, nextTaskTagName)
  await setupRuntimeWithSchema(schemaResult.schema)
  appliedTaskTagName = schemaResult.schema.tagAlias
}

async function renameTaskTagAlias(
  oldTaskTagName: string,
  newTaskTagName: string,
): Promise<void> {
  if (oldTaskTagName === newTaskTagName) {
    return
  }

  const oldTaskTag = (await orca.invokeBackend(
    "get-block-by-alias",
    oldTaskTagName,
  )) as Block | null
  if (oldTaskTag == null) {
    return
  }

  const newTaskTag = (await orca.invokeBackend(
    "get-block-by-alias",
    newTaskTagName,
  )) as Block | null

  if (newTaskTag != null && newTaskTag.id !== oldTaskTag.id) {
    throw new Error(
      t("Task tag name already exists: ${name}", { name: newTaskTagName }),
    )
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.renameAlias",
    null,
    oldTaskTagName,
    newTaskTagName,
  )
}

async function setupRuntimeWithSchema(schema: TaskSchemaDefinition): Promise<void> {
  await disposeRuntime()

  const taskQuickActions = await setupTaskQuickActions(pluginName, schema)
  const taskPopupEntry = setupTaskPopupEntry(pluginName, schema)
  const nextActionsEntry = setupNextActionsEntry(pluginName, schema)

  taskQuickActionsDisposer = taskQuickActions.dispose
  taskPopupEntryDisposer = taskPopupEntry.dispose
  nextActionsEntryDisposer = nextActionsEntry.dispose
}

async function notifyStartupTaskSummary(
  schema: TaskSchemaDefinition,
  settings: TaskPlannerSettings,
): Promise<void> {
  if (!settings.startupTaskSummaryNotificationEnabled) {
    return
  }

  try {
    const nowMs = Date.now()
    const dueSoonEndMs = nowMs + settings.dueSoonDays * DAY_MS
    const evaluations = await collectNextActionEvaluations(schema, new Date(nowMs), {
      useCache: false,
    })

    const activeCount = evaluations.filter((item) => item.isNextAction).length
    let overdueCount = 0
    let dueSoonCount = 0

    for (const evaluation of evaluations) {
      const dueMs = evaluation.item.endTime?.getTime()
      if (typeof dueMs !== "number" || Number.isNaN(dueMs)) {
        continue
      }

      if (dueMs < nowMs) {
        overdueCount += 1
        continue
      }

      if (dueMs <= dueSoonEndMs) {
        dueSoonCount += 1
      }
    }

    orca.notify(
      "info",
      t(
        "Active tasks: ${active}, overdue tasks: ${overdue}, tasks due in the next ${days} days: ${dueSoon}",
        {
          active: String(activeCount),
          overdue: String(overdueCount),
          days: String(settings.dueSoonDays),
          dueSoon: String(dueSoonCount),
        },
      ),
      { title: t("Today's task overview") },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(t("Failed to build startup task summary: ${message}", { message }))
  }
}

async function disposeRuntime(): Promise<void> {
  if (taskPopupEntryDisposer != null) {
    taskPopupEntryDisposer()
    taskPopupEntryDisposer = null
  }

  if (nextActionsEntryDisposer != null) {
    nextActionsEntryDisposer()
    nextActionsEntryDisposer = null
  }

  if (taskQuickActionsDisposer != null) {
    await taskQuickActionsDisposer()
    taskQuickActionsDisposer = null
  }
}

