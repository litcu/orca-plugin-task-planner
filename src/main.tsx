import type { Block } from "./orca.d.ts"
import { invalidateNextActionEvaluationCache } from "./core/dependency-engine"
import { setupTaskBlockMenu } from "./core/task-block-menu"
import {
  ensureTaskTagSchema,
  TASK_TAG_ALIAS,
  type TaskSchemaDefinition,
} from "./core/task-schema"
import { setupTaskQuickActions } from "./core/task-service"
import { setupTaskPopupEntry } from "./core/task-popup-entry"
import { setupTaskTimerRuntime, type TaskTimerRuntimeHandle } from "./core/task-timer-runtime"
import { setupNextActionsEntry } from "./core/next-actions-entry"
import { ensureProjectTagSchema, PROJECT_TAG_ALIAS, type ProjectSchemaDefinition } from "./core/project-schema"
import { setActiveTaskRuntimeSchema } from "./core/task-runtime-schema"
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
let taskBlockMenuDisposer: (() => void) | null = null
let taskPopupEntryDisposer: (() => void) | null = null
let taskTimerRuntimeHandle: TaskTimerRuntimeHandle | null = null
let nextActionsEntryDisposer: (() => void) | null = null
let settingsUnsubscribe: (() => void) | null = null
let settingsUpdateChain: Promise<void> = Promise.resolve()
let appliedTaskTagName = TASK_TAG_ALIAS
let appliedProjectTagName = PROJECT_TAG_ALIAS
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
  const projectSchemaResult = await ensureProjectTagSchema(orca.state.locale, settings.projectTagName)
  appliedProjectTagName = projectSchemaResult.schema.tagAlias
  const schemaResult = await ensureTaskTagSchema(
    orca.state.locale,
    settings.taskTagName,
    projectSchemaResult.schema.tagAlias,
  )
  appliedTaskTagName = schemaResult.schema.tagAlias
  await setupRuntimeWithSchema(schemaResult.schema, projectSchemaResult.schema)

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

        if (
          areTaskTagNamesEquivalent(settings.taskTagName, appliedTaskTagName) &&
          areTaskTagNamesEquivalent(settings.projectTagName, appliedProjectTagName)
        ) {
          return
        }

        await applyTaskTagNameChanges(settings.taskTagName, settings.projectTagName)
      })
      .catch((error: unknown) => {
        if (unloaded) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)
        orca.notify("error", message)
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

async function applyTaskTagNameChanges(
  nextTaskTagName: string,
  nextProjectTagName: string,
): Promise<void> {
  const previousTaskTagName = appliedTaskTagName
  const previousProjectTagName = appliedProjectTagName
  const taskTagChanged = !areTaskTagNamesEquivalent(nextTaskTagName, previousTaskTagName)
  const projectTagChanged = !areTaskTagNamesEquivalent(nextProjectTagName, previousProjectTagName)

  if (!taskTagChanged && !projectTagChanged) {
    return
  }

  let projectTagRenamed = false
  let tagRenamed = false
  try {
    if (projectTagChanged) {
      await renameProjectTagAlias(previousProjectTagName, nextProjectTagName)
      projectTagRenamed = true
    }
    if (taskTagChanged) {
      await renameTaskTagAlias(previousTaskTagName, nextTaskTagName)
      tagRenamed = true
    }

    const projectSchemaResult = await ensureProjectTagSchema(orca.state.locale, nextProjectTagName)
    const schemaResult = await ensureTaskTagSchema(
      orca.state.locale,
      nextTaskTagName,
      projectSchemaResult.schema.tagAlias,
    )
    await setupRuntimeWithSchema(schemaResult.schema, projectSchemaResult.schema)
    appliedProjectTagName = projectSchemaResult.schema.tagAlias
    appliedTaskTagName = schemaResult.schema.tagAlias
    invalidateNextActionEvaluationCache()
  } catch (error) {
    if (!tagRenamed) {
      await restoreTaskTagNameSetting(previousTaskTagName)
    }
    if (!projectTagRenamed) {
      await restoreProjectTagNameSetting(previousProjectTagName)
    }
    throw error
  }
}

async function renameTaskTagAlias(
  oldTaskTagName: string,
  newTaskTagName: string,
): Promise<void> {
  if (areTaskTagNamesEquivalent(oldTaskTagName, newTaskTagName)) {
    return
  }

  const oldTaskTag = await getTaskTagByAlias(oldTaskTagName)
  if (oldTaskTag == null) {
    return
  }

  const newTaskTag = await getTaskTagByAlias(newTaskTagName)

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

async function getTaskTagByAlias(taskTagName: string): Promise<Block | null> {
  return (await orca.invokeBackend(
    "get-block-by-alias",
    taskTagName,
  )) as Block | null
}

async function restoreTaskTagNameSetting(taskTagName: string): Promise<void> {
  const pluginState = orca.state.plugins[pluginName]
  if (pluginState == null) {
    return
  }

  const currentSettings =
    pluginState.settings != null && typeof pluginState.settings === "object"
      ? pluginState.settings
      : {}
  const currentTaskTagName =
    typeof currentSettings.taskTagName === "string"
      ? currentSettings.taskTagName
      : TASK_TAG_ALIAS
  if (areTaskTagNamesEquivalent(currentTaskTagName, taskTagName)) {
    return
  }

  const nextSettings = {
    ...currentSettings,
    taskTagName,
  }

  try {
    await orca.plugins.setSettings("repo", pluginName, nextSettings)
  } catch (error) {
    console.error(error)
    pluginState.settings = nextSettings
  }
}

async function renameProjectTagAlias(
  oldProjectTagName: string,
  newProjectTagName: string,
): Promise<void> {
  if (areTaskTagNamesEquivalent(oldProjectTagName, newProjectTagName)) {
    return
  }

  const oldProjectTag = await getProjectTagByAlias(oldProjectTagName)
  if (oldProjectTag == null) {
    return
  }

  const newProjectTag = await getProjectTagByAlias(newProjectTagName)

  if (newProjectTag != null && newProjectTag.id !== oldProjectTag.id) {
    throw new Error(
      t("Project tag name already exists: ${name}", { name: newProjectTagName }),
    )
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.renameAlias",
    null,
    oldProjectTagName,
    newProjectTagName,
  )
}

async function getProjectTagByAlias(projectTagName: string): Promise<Block | null> {
  return (await orca.invokeBackend(
    "get-block-by-alias",
    projectTagName,
  )) as Block | null
}

async function restoreProjectTagNameSetting(projectTagName: string): Promise<void> {
  const pluginState = orca.state.plugins[pluginName]
  if (pluginState == null) {
    return
  }

  const currentSettings =
    pluginState.settings != null && typeof pluginState.settings === "object"
      ? pluginState.settings
      : {}
  const currentProjectTagName =
    typeof currentSettings.projectTagName === "string"
      ? currentSettings.projectTagName
      : PROJECT_TAG_ALIAS
  if (areTaskTagNamesEquivalent(currentProjectTagName, projectTagName)) {
    return
  }

  const nextSettings = {
    ...currentSettings,
    projectTagName,
  }

  try {
    await orca.plugins.setSettings("repo", pluginName, nextSettings)
  } catch (error) {
    console.error(error)
    pluginState.settings = nextSettings
  }
}

function areTaskTagNamesEquivalent(left: string, right: string): boolean {
  return toTaskTagNameKey(left) === toTaskTagNameKey(right)
}

function toTaskTagNameKey(value: string): string {
  return value.trim().replace(/^#+/, "").toLowerCase()
}

async function setupRuntimeWithSchema(
  schema: TaskSchemaDefinition,
  projectSchema: ProjectSchemaDefinition,
): Promise<void> {
  await disposeRuntime()

  const taskQuickActions = await setupTaskQuickActions(pluginName, schema)
  const taskBlockMenu = setupTaskBlockMenu(pluginName, schema)
  const taskPopupEntry = setupTaskPopupEntry(pluginName, schema)
  const nextActionsEntry = setupNextActionsEntry(pluginName, schema, projectSchema)
  const taskTimerRuntime = setupTaskTimerRuntime(pluginName, schema)

  taskQuickActionsDisposer = taskQuickActions.dispose
  taskBlockMenuDisposer = taskBlockMenu.dispose
  taskPopupEntryDisposer = taskPopupEntry.dispose
  taskTimerRuntimeHandle = taskTimerRuntime
  nextActionsEntryDisposer = nextActionsEntry.dispose
  setActiveTaskRuntimeSchema(schema)
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
  if (taskBlockMenuDisposer != null) {
    taskBlockMenuDisposer()
    taskBlockMenuDisposer = null
  }

  if (taskPopupEntryDisposer != null) {
    taskPopupEntryDisposer()
    taskPopupEntryDisposer = null
  }

  if (nextActionsEntryDisposer != null) {
    nextActionsEntryDisposer()
    nextActionsEntryDisposer = null
  }

  if (taskTimerRuntimeHandle != null) {
    taskTimerRuntimeHandle.dispose()
    taskTimerRuntimeHandle = null
  }

  if (taskQuickActionsDisposer != null) {
    await taskQuickActionsDisposer()
    taskQuickActionsDisposer = null
  }
}
