import { ensureTaskTagSchema } from "./core/task-schema"
import { setupTaskQuickActions } from "./core/task-service"
import { setupTaskPopupEntry } from "./core/task-popup-entry"
import { setupNextActionsEntry } from "./core/next-actions-entry"
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

let pluginName: string
let taskQuickActionsDisposer: (() => Promise<void>) | null = null
let taskPopupEntryDisposer: (() => void) | null = null
let nextActionsEntryDisposer: (() => void) | null = null

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  const schemaResult = await ensureTaskTagSchema(orca.state.locale)
  const taskQuickActions = await setupTaskQuickActions(
    pluginName,
    schemaResult.schema,
  )
  const taskPopupEntry = setupTaskPopupEntry(pluginName)
  const nextActionsEntry = setupNextActionsEntry(pluginName, schemaResult.schema)

  taskQuickActionsDisposer = taskQuickActions.dispose
  taskPopupEntryDisposer = taskPopupEntry.dispose
  nextActionsEntryDisposer = nextActionsEntry.dispose

  console.log(
    t("任务 schema 已初始化", {
      locale: schemaResult.schemaLocale,
      mode: "ALL",
    }),
  )
  console.log(`${pluginName} loaded.`)
}

export async function unload() {
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

  console.log(`${pluginName} unloaded.`)
}
