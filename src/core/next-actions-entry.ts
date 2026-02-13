import type { ColumnPanel, PanelProps, RowPanel, ViewPanel } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "./task-schema"
import { TaskViewsPanel } from "../ui/task-views-panel"
import { setPreferredTaskViewsTab } from "./task-views-state"

export interface NextActionsEntryHandle {
  panelType: string
  openCommandIds: string[]
  dispose: () => void
}

export function setupNextActionsEntry(
  pluginName: string,
  schema: TaskSchemaDefinition,
): NextActionsEntryHandle {
  const panelType = `${pluginName}.taskViewsPanel`
  const legacyPanelTypes = [`${pluginName}.nextActionsPanel`, `${pluginName}.allTasksPanel`]
  const dynamicOpenTaskViewsCommandId = `${pluginName}.openTaskViewsPanel`
  const fixedOpenTaskViewsCommandId = "mylifeorganized.openTaskViewsPanel"
  const dynamicToggleTaskViewsCommandId = `${pluginName}.toggleTaskViewsPanel`
  const fixedToggleTaskViewsCommandId = "mylifeorganized.toggleTaskViewsPanel"
  const headbarButtonId = `${pluginName}.toggleTaskViewsPanel`
  const legacyOpenCommandIds = [
    `${pluginName}.openNextActionsPanel`,
    `${pluginName}.openAllTasksPanel`,
    "mylifeorganized.openNextActionsPanel",
    "mylifeorganized.openAllTasksPanel",
  ]
  const openCommandIds = [
    dynamicOpenTaskViewsCommandId,
    fixedOpenTaskViewsCommandId,
  ].filter((id, index, list) => list.indexOf(id) === index)
  const toggleCommandIds = [
    dynamicToggleTaskViewsCommandId,
    fixedToggleTaskViewsCommandId,
  ].filter((id, index, list) => list.indexOf(id) === index)

  // 通过闭包注入 schema，保证面板渲染时始终使用当前任务字段定义。
  const panelRenderer = (panelProps: PanelProps) => {
    const React = window.React
    return React.createElement(TaskViewsPanel, {
      ...panelProps,
      schema,
    })
  }

  for (const legacyPanelType of legacyPanelTypes) {
    if (legacyPanelType !== panelType && orca.state.panelRenderers[legacyPanelType] != null) {
      orca.panels.unregisterPanel(legacyPanelType)
    }
  }

  if (orca.state.panelRenderers[panelType] == null) {
    orca.panels.registerPanel(panelType, panelRenderer)
  }

  registerOpenCommand(
    dynamicOpenTaskViewsCommandId,
    "next-actions",
    "打开任务视图面板（Open Task Views）",
  )
  registerOpenCommand(
    fixedOpenTaskViewsCommandId,
    "next-actions",
    "打开任务视图面板（Open Task Views）",
  )
  registerToggleCommand(
    dynamicToggleTaskViewsCommandId,
    "切换任务视图面板（Toggle Task Views）",
  )
  registerToggleCommand(
    fixedToggleTaskViewsCommandId,
    "切换任务视图面板（Toggle Task Views）",
  )
  registerHeadbarButton()

  for (const legacyCommandId of legacyOpenCommandIds) {
    if (orca.state.commands[legacyCommandId] != null) {
      orca.commands.unregisterCommand(legacyCommandId)
    }
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
      for (const commandId of toggleCommandIds) {
        if (orca.state.commands[commandId] == null) {
          continue
        }

        orca.commands.unregisterCommand(commandId)
      }

      for (const legacyCommandId of legacyOpenCommandIds) {
        if (orca.state.commands[legacyCommandId] == null) {
          continue
        }

        orca.commands.unregisterCommand(legacyCommandId)
      }

      if (orca.state.panelRenderers[panelType] != null) {
        orca.panels.unregisterPanel(panelType)
      }

      for (const legacyPanelType of legacyPanelTypes) {
        if (legacyPanelType !== panelType && orca.state.panelRenderers[legacyPanelType] != null) {
          orca.panels.unregisterPanel(legacyPanelType)
        }
      }

      if (orca.state.headbarButtons[headbarButtonId] != null) {
        orca.headbar.unregisterHeadbarButton(headbarButtonId)
      }
    },
  }

  function registerOpenCommand(
    commandId: string,
    tab: "next-actions" | "all-tasks",
    label: string,
  ) {
    if (orca.state.commands[commandId] != null) {
      orca.commands.unregisterCommand(commandId)
    }

    orca.commands.registerCommand(
      commandId,
      async () => {
        setPreferredTaskViewsTab(tab)
        const panelId = orca.state.activePanel
        orca.nav.goTo(panelType, {}, panelId)
      },
      label,
    )
  }

  function registerToggleCommand(commandId: string, label: string) {
    if (orca.state.commands[commandId] != null) {
      orca.commands.unregisterCommand(commandId)
    }

    orca.commands.registerCommand(
      commandId,
      async () => {
        const openedPanelId = findPanelIdByViewType(panelType, orca.state.panels)
        if (openedPanelId != null) {
          orca.nav.close(openedPanelId)
          return
        }

        setPreferredTaskViewsTab("next-actions")
        const panelId = orca.state.activePanel
        orca.nav.goTo(panelType, {}, panelId)
      },
      label,
    )
  }

  function registerHeadbarButton() {
    if (orca.state.headbarButtons[headbarButtonId] != null) {
      orca.headbar.unregisterHeadbarButton(headbarButtonId)
    }

    orca.headbar.registerHeadbarButton(headbarButtonId, () => {
      const React = window.React
      const Button = orca.components.Button
      const isChinese = orca.state.locale === "zh-CN"

      return React.createElement(
        Button,
        {
          variant: "plain",
          title: isChinese ? "切换任务面板" : "Toggle task panel",
          onClick: () => {
            void orca.commands.invokeCommand(fixedToggleTaskViewsCommandId)
          },
        },
        React.createElement("i", {
          className: "ti ti-list-check",
          style: { fontSize: "16px" },
        }),
      )
    })
  }
}

function findPanelIdByViewType(
  panelViewType: string,
  rootPanel: RowPanel,
): string | null {
  return findPanelByView(panelViewType, rootPanel)?.id ?? null
}

function findPanelByView(
  panelViewType: string,
  panelNode: RowPanel | ColumnPanel | ViewPanel,
): ViewPanel | null {
  if (isViewPanel(panelNode)) {
    return panelNode.view === panelViewType ? panelNode : null
  }

  for (const child of panelNode.children) {
    const matched = findPanelByView(panelViewType, child)
    if (matched != null) {
      return matched
    }
  }

  return null
}

function isViewPanel(node: RowPanel | ColumnPanel | ViewPanel): node is ViewPanel {
  return "view" in node
}
