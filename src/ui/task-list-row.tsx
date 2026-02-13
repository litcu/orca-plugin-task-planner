import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "../core/task-schema"

export interface TaskListRowItem {
  blockId: DbId
  text: string
  status: string
  endTime: Date | null
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
  const dueInfo = resolveDueInfo(props.item.endTime, props.isChinese)

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
            title: props.collapsed ? t("Expand subtasks") : t("Collapse subtasks"),
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
          props.collapsed ? "\u25B8" : "\u25BE",
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
        title: t("Toggle task status"),
        style: {
          width: "22px",
          height: "22px",
          borderRadius: "4px",
          border: "none",
          background: "transparent",
          color: resolveStatusColor(props.item.status, props.schema),
          cursor: props.loading || props.updating ? "not-allowed" : "pointer",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "15px",
          lineHeight: 1,
          padding: 0,
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
          color: dueInfo.color,
          fontWeight: dueInfo.strong ? 600 : 400,
          whiteSpace: "nowrap",
        },
      },
      dueInfo.text,
    ),
  )
}

function resolveStatusGlyph(status: string, schema: TaskSchemaDefinition): string {
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices
  if (status === doneStatus) {
    return "\u2713"
  }
  if (status === doingStatus) {
    return "\u25D0"
  }
  if (status === todoStatus) {
    return "\u25EF"
  }

  return "\u25EF"
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

function resolveDueInfo(
  endTime: Date | null,
  isChinese: boolean,
): { text: string; color: string; strong: boolean } {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return {
      text: t("No due"),
      color: "var(--orca-color-text-2)",
      strong: false,
    }
  }

  const now = new Date()
  const nowTime = now.getTime()
  const dueTime = endTime.getTime()

  if (dueTime < nowTime) {
    const diffMs = nowTime - dueTime
    const overdueDays = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
    return {
      text: t("Overdue ${days}d", { days: String(overdueDays) }),
      color: "var(--orca-color-text-red, #c53030)",
      strong: true,
    }
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  )
  const startOfAfterTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 2,
  )

  if (dueTime >= startOfToday.getTime() && dueTime < startOfTomorrow.getTime()) {
    return {
      text: t("Today"),
      color: "var(--orca-color-text-yellow, #b7791f)",
      strong: true,
    }
  }

  if (dueTime >= startOfTomorrow.getTime() && dueTime < startOfAfterTomorrow.getTime()) {
    return {
      text: t("Tomorrow"),
      color: "var(--orca-color-text-yellow, #b7791f)",
      strong: true,
    }
  }

  return {
    text: endTime.toLocaleDateString(isChinese ? "zh-CN" : undefined),
    color: "var(--orca-color-text-2)",
    strong: false,
  }
}
