import type { PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  getPreferredTaskViewsTab,
  setPreferredTaskViewsTab,
  subscribePreferredTaskViewsTab,
  type TaskViewsTab,
} from "../core/task-views-state"
import { NextActionsPanel } from "./next-actions-panel"
import { AllTasksPanel } from "./all-tasks-panel"

interface TaskViewsPanelProps extends PanelProps {
  schema: TaskSchemaDefinition
}

const TASK_VIEWS_CONTENT_WIDTH = "min(760px, 100%)"

export function TaskViewsPanel(props: TaskViewsPanelProps) {
  const React = window.React
  const Segmented = orca.components.Segmented

  const isChinese = orca.state.locale === "zh-CN"
  const [tab, setTab] = React.useState<TaskViewsTab>(() => {
    return getPreferredTaskViewsTab()
  })

  React.useEffect(() => {
    return subscribePreferredTaskViewsTab((nextTab) => {
      setTab(nextTab)
    })
  }, [])

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          padding: "12px 12px 8px 12px",
          boxSizing: "border-box",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: TASK_VIEWS_CONTENT_WIDTH,
            margin: "0 auto",
          },
        },
        React.createElement(Segmented, {
          selected: tab,
          options: [
            {
              value: "next-actions",
              label: isChinese ? "Next Actions" : "Next Actions",
            },
            {
              value: "all-tasks",
              label: isChinese ? "全量任务" : "All Tasks",
            },
          ],
          onChange: (value: string) => {
            if (value === "next-actions" || value === "all-tasks") {
              setPreferredTaskViewsTab(value)
            }
          },
        }),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          flex: 1,
          minHeight: 0,
          padding: "0 12px 12px 12px",
          boxSizing: "border-box",
          display: "flex",
          justifyContent: "center",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: TASK_VIEWS_CONTENT_WIDTH,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
          },
        },
        tab === "next-actions"
          ? React.createElement(NextActionsPanel, {
              ...props,
              schema: props.schema,
            })
          : React.createElement(AllTasksPanel, {
              ...props,
              schema: props.schema,
            }),
      ),
    ),
  )
}
