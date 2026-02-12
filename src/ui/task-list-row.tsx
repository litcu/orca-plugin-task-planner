import type { DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"

export interface TaskListRowItem {
  blockId: DbId
  text: string
  status: string
}

interface TaskListRowProps {
  item: TaskListRowItem
  schema: TaskSchemaDefinition
  isChinese: boolean
  depth: number
  contextOnly: boolean
  loading: boolean
  updating: boolean
  showCollapseToggle: boolean
  collapsed: boolean
  onToggleCollapse?: () => void
  onToggleStatus: () => void | Promise<void>
  onOpen: () => void
}

export function TaskListRow(props: TaskListRowProps) {
  const React = window.React

  return React.createElement(
    "div",
    {
      key: props.item.blockId,
      style: {
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        paddingLeft: `${8 + props.depth * 18}px`,
        border: "1px solid var(--orca-color-border)",
        borderRadius: "6px",
        background: "var(--orca-color-bg-2)",
        opacity: props.contextOnly ? 0.72 : 1,
      },
    },
    props.showCollapseToggle
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              props.onToggleCollapse?.()
            },
            title: props.collapsed
              ? (props.isChinese ? "展开子任务" : "Expand subtasks")
              : (props.isChinese ? "折叠子任务" : "Collapse subtasks"),
            style: {
              width: "18px",
              height: "18px",
              border: "none",
              borderRadius: "4px",
              background: "transparent",
              color: "var(--orca-color-text-2)",
              cursor: "pointer",
              flexShrink: 0,
              fontSize: "12px",
              lineHeight: 1,
              padding: 0,
            },
          },
          props.collapsed ? "▸" : "▾",
        )
      : React.createElement("div", {
          style: {
            width: "18px",
            height: "18px",
            flexShrink: 0,
          },
        }),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          void props.onToggleStatus()
        },
        disabled: props.loading || props.updating,
        title: props.isChinese ? "切换任务状态" : "Toggle task status",
        style: {
          width: "22px",
          height: "22px",
          borderRadius: "999px",
          border: "1px solid var(--orca-color-border)",
          background: "var(--orca-color-bg)",
          color: resolveStatusColor(props.item.status, props.schema),
          cursor: props.loading || props.updating ? "not-allowed" : "pointer",
          flexShrink: 0,
        },
      },
      resolveStatusGlyph(props.item.status, props.schema),
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onOpen(),
        style: {
          border: "none",
          background: "transparent",
          color: "var(--orca-color-text)",
          textAlign: "left",
          cursor: "pointer",
          padding: 0,
          flex: 1,
          minWidth: 0,
          fontSize: "13px",
        },
      },
      props.item.text,
    ),
    React.createElement(
      "div",
      {
        style: {
          fontSize: "11px",
          color: "var(--orca-color-text-2)",
          whiteSpace: "nowrap",
        },
      },
      props.item.status,
    ),
  )
}

function resolveStatusGlyph(status: string, schema: TaskSchemaDefinition): string {
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices
  if (status === doneStatus) {
    return "✓"
  }
  if (status === doingStatus) {
    return "◐"
  }
  if (status === todoStatus) {
    return "○"
  }

  return "○"
}

function resolveStatusColor(status: string, schema: TaskSchemaDefinition): string {
  const [, doingStatus, doneStatus] = schema.statusChoices
  if (status === doneStatus) {
    return "var(--orca-color-text-green)"
  }
  if (status === doingStatus) {
    return "var(--orca-color-text-yellow)"
  }

  return "var(--orca-color-text-2)"
}
