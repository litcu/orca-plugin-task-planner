import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"

let pluginName: string

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  console.log(t("插件已加载，开发脚手架可用"))
  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  console.log(`${pluginName} unloaded.`)
}
