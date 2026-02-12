import { ensureTaskTagSchema } from "./core/task-schema"
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

let pluginName: string

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  const schemaResult = await ensureTaskTagSchema(orca.state.locale)

  console.log(
    t("任务 schema 已初始化", {
      locale: schemaResult.schemaLocale,
      mode: "ALL",
    }),
  )
  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  console.log(`${pluginName} unloaded.`)
}
