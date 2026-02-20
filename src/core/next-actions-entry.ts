import type { ColumnPanel, PanelProps, RowPanel, ViewPanel } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "./task-schema"
import { TaskViewsPanel } from "../ui/task-views-panel"
import { setPreferredTaskViewsTab } from "./task-views-state"

const COMMAND_PREFIX = "task-planner"

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
  const openTaskViewsCommandId = `${COMMAND_PREFIX}.openTaskViewsPanel`
  const headbarButtonId = `${COMMAND_PREFIX}.taskViewsHeadbarButton`
  const legacyCommandIds = [
    `${pluginName}.openTaskViewsPanel`,
    `${pluginName}.toggleTaskViewsPanel`,
    `${pluginName}.openNextActionsPanel`,
    `${pluginName}.openAllTasksPanel`,
    "orca-task-planner.openTaskViewsPanel",
    "orca-task-planner.toggleTaskViewsPanel",
  ].filter((id, index, list) => id !== openTaskViewsCommandId && list.indexOf(id) === index)
  const legacyHeadbarButtonIds = [
    `${pluginName}.toggleTaskViewsPanel`,
    "orca-task-planner.toggleTaskViewsPanel",
  ].filter((id, index, list) => id !== headbarButtonId && list.indexOf(id) === index)
  const openCommandIds = [openTaskViewsCommandId]

  // Inject schema through closure to keep renderer and schema in sync.
  const panelRenderer = (panelProps: PanelProps) => {
    const React = window.React
    return React.createElement(TaskViewsPanel, {
      ...panelProps,
      schema,
      pluginName,
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

  registerOpenCommand(openTaskViewsCommandId, t("Open task management panel"))

  for (const legacyHeadbarButtonId of legacyHeadbarButtonIds) {
    if (orca.state.headbarButtons[legacyHeadbarButtonId] != null) {
      orca.headbar.unregisterHeadbarButton(legacyHeadbarButtonId)
    }
  }

  registerHeadbarButton()

  for (const legacyCommandId of legacyCommandIds) {
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

      for (const legacyCommandId of legacyCommandIds) {
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

      for (const legacyHeadbarButtonId of legacyHeadbarButtonIds) {
        if (orca.state.headbarButtons[legacyHeadbarButtonId] != null) {
          orca.headbar.unregisterHeadbarButton(legacyHeadbarButtonId)
        }
      }
    },
  }

  function registerOpenCommand(commandId: string, label: string) {
    if (orca.state.commands[commandId] != null) {
      orca.commands.unregisterCommand(commandId)
    }

    orca.commands.registerCommand(
      commandId,
      async () => {
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

      return React.createElement(
        Button,
        {
          variant: "plain",
          title: t("Toggle task panel"),
          onClick: () => {
            const openedPanelId = findPanelIdByViewType(panelType, orca.state.panels)
            if (openedPanelId != null) {
              orca.nav.close(openedPanelId)
              return
            }

            void orca.commands.invokeCommand(openTaskViewsCommandId)
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
