import { ensureTaskTagSchema } from "./core/task-schema"
import { setupTaskQuickActions } from "./core/task-service"
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

let pluginName: string
let taskQuickActionsDisposer: (() => Promise<void>) | null = null

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  const schemaResult = await ensureTaskTagSchema(orca.state.locale)
  const taskQuickActions = await setupTaskQuickActions(
    pluginName,
    schemaResult.schema,
  )

  taskQuickActionsDisposer = taskQuickActions.dispose

  console.log(
    t("任务 schema 已初始化", {
      locale: schemaResult.schemaLocale,
      mode: "ALL",
    }),
  )
  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  if (taskQuickActionsDisposer != null) {
    await taskQuickActionsDisposer()
    taskQuickActionsDisposer = null
  }

  console.log(`${pluginName} unloaded.`)
}
