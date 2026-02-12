import type { PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "./task-schema"
import { NextActionsPanel } from "../ui/next-actions-panel"

export interface NextActionsEntryHandle {
  panelType: string
  openCommandIds: string[]
  dispose: () => void
}

export function setupNextActionsEntry(
  pluginName: string,
  schema: TaskSchemaDefinition,
): NextActionsEntryHandle {
  const panelType = `${pluginName}.nextActionsPanel`
  const dynamicOpenCommandId = `${pluginName}.openNextActionsPanel`
  const fixedOpenCommandId = "mylifeorganized.openNextActionsPanel"
  const openCommandIds = [dynamicOpenCommandId, fixedOpenCommandId].filter(
    (id, index, list) => list.indexOf(id) === index,
  )

  // 通过闭包注入 schema，保证面板渲染时始终使用当前任务字段定义。
  const panelRenderer = (panelProps: PanelProps) => {
    const React = window.React
    return React.createElement(NextActionsPanel, {
      ...panelProps,
      schema,
    })
  }

  if (orca.state.panelRenderers[panelType] == null) {
    orca.panels.registerPanel(panelType, panelRenderer)
  }

  for (const commandId of openCommandIds) {
    if (orca.state.commands[commandId] != null) {
      continue
    }

    orca.commands.registerCommand(
      commandId,
      async () => {
        const panelId = orca.state.activePanel
        orca.nav.goTo(panelType, {}, panelId)
      },
      "打开 Next Actions 视图（Open Next Actions）",
    )
  }

  return {
    panelType,
    openCommandIds,
    dispose: () => {
      for (const commandId of openCommandIds) {
        if (orca.state.commands[commandId] == null) {
          continue
        }

        orca.commands.unregisterCommand(commandId)
      }

      if (orca.state.panelRenderers[panelType] != null) {
        orca.panels.unregisterPanel(panelType)
      }
    },
  }
}
