import type { Block } from "./orca.d.ts"
import { ensureTaskTagSchema, TASK_TAG_ALIAS, type TaskSchemaDefinition } from "./core/task-schema"
import { setupTaskQuickActions } from "./core/task-service"
import { setupTaskPopupEntry } from "./core/task-popup-entry"
import { setupNextActionsEntry } from "./core/next-actions-entry"
import { ensurePluginSettingsSchema, getPluginSettings } from "./core/plugin-settings"
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

let pluginName: string
let taskQuickActionsDisposer: (() => Promise<void>) | null = null
let taskPopupEntryDisposer: (() => void) | null = null
let nextActionsEntryDisposer: (() => void) | null = null
let settingsUnsubscribe: (() => void) | null = null
let settingsUpdateChain: Promise<void> = Promise.resolve()
let appliedTaskTagName = TASK_TAG_ALIAS
let unloaded = false

export async function load(_name: string) {
  pluginName = _name
  unloaded = false
  settingsUpdateChain = Promise.resolve()

  setupL10N(orca.state.locale, { "zh-CN": zhCN })
  await ensurePluginSettingsSchema(pluginName)

  const settings = getPluginSettings(pluginName)
  const schemaResult = await ensureTaskTagSchema(orca.state.locale, settings.taskTagName)
  appliedTaskTagName = schemaResult.schema.tagAlias
  await setupRuntimeWithSchema(schemaResult.schema)

  if (settingsUnsubscribe != null) {
    settingsUnsubscribe()
    settingsUnsubscribe = null
  }
  subscribeSettingsChanges()

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

