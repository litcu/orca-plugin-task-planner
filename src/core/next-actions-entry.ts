import type { PanelProps } from "../orca.d.ts"
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
  const dynamicOpenTaskViewsCommandId = `${pluginName}.openTaskViewsPanel`
  const dynamicOpenNextActionsCommandId = `${pluginName}.openNextActionsPanel`
  const dynamicOpenAllTasksCommandId = `${pluginName}.openAllTasksPanel`
  const fixedOpenTaskViewsCommandId = "mylifeorganized.openTaskViewsPanel"
  const fixedOpenNextActionsCommandId = "mylifeorganized.openNextActionsPanel"
  const fixedOpenAllTasksCommandId = "mylifeorganized.openAllTasksPanel"
  const openCommandIds = [
    dynamicOpenTaskViewsCommandId,
    dynamicOpenNextActionsCommandId,
    dynamicOpenAllTasksCommandId,
    fixedOpenTaskViewsCommandId,
    fixedOpenNextActionsCommandId,
    fixedOpenAllTasksCommandId,
  ].filter((id, index, list) => list.indexOf(id) === index)

  // 通过闭包注入 schema，保证面板渲染时始终使用当前任务字段定义。
  const panelRenderer = (panelProps: PanelProps) => {
    const React = window.React
    return React.createElement(TaskViewsPanel, {
      ...panelProps,
      schema,
    })
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
  registerOpenCommand(
    dynamicOpenNextActionsCommandId,
    "next-actions",
    "打开 Next Actions 视图（Open Next Actions）",
  )
  registerOpenCommand(
    fixedOpenNextActionsCommandId,
    "next-actions",
    "打开 Next Actions 视图（Open Next Actions）",
  )
  registerOpenCommand(
    dynamicOpenAllTasksCommandId,
    "all-tasks",
    "打开全量任务列表视图（Open All Tasks）",
  )
  registerOpenCommand(
    fixedOpenAllTasksCommandId,
    "all-tasks",
    "打开全量任务列表视图（Open All Tasks）",
  )

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

  function registerOpenCommand(
    commandId: string,
    tab: "next-actions" | "all-tasks",
    label: string,
  ) {
    if (orca.state.commands[commandId] != null) {
      return
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
}
