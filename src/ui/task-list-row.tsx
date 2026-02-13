import type { BlockRef, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "../core/task-schema"

export interface TaskListRowItem {
  blockId: DbId
  sourceBlockId: DbId
  parentBlockId: DbId | null
  text: string
  status: string
  endTime: Date | null
  star: boolean
  parentTaskName?: string | null
  taskTagRef?: BlockRef | null
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
  showParentTaskContext: boolean
  starUpdating: boolean
  onToggleCollapse?: () => void
  onToggleStatus: () => void | Promise<void>
  onNavigate: () => void
  onToggleStar: () => void | Promise<void>
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
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "2px",
        },
      },
      React.createElement(
        "span",
        {
          style: {
            display: "block",
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        props.item.text,
      ),
      props.showParentTaskContext && props.item.parentTaskName != null
        ? React.createElement(
            "span",
            {
              style: {
                display: "block",
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "11px",
                color: "var(--orca-color-text-2)",
              },
            },
            t("Parent: ${name}", { name: props.item.parentTaskName }),
          )
        : null,
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
    React.createElement(
      "button",
      {
        type: "button",
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onNavigate()
        },
        title: t("Jump to task location"),
        style: {
          width: "24px",
          height: "24px",
          padding: 0,
          border: "none",
          borderRadius: "4px",
          background: "transparent",
          color: "var(--orca-color-text-2)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        },
      },
      React.createElement("i", {
        className: "ti ti-arrow-up-right",
        style: { fontSize: "14px", lineHeight: 1 },
      }),
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          void props.onToggleStar()
        },
        disabled: props.loading || props.starUpdating,
        title: props.item.star ? t("Starred") : t("Not starred"),
        style: {
          width: "24px",
          height: "24px",
          padding: 0,
          border: "none",
          background: "transparent",
          color: props.item.star
            ? "var(--orca-color-text-yellow, #d69e2e)"
            : "var(--orca-color-text-2)",
          cursor: props.loading || props.starUpdating ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        },
      },
      React.createElement(StarIcon, { filled: props.item.star }),
    ),
  )
}

function StarIcon(props: { filled: boolean }) {
  const React = window.React
  return React.createElement(
    "svg",
    {
      width: 16,
      height: 16,
      viewBox: "0 0 24 24",
      fill: props.filled ? "currentColor" : "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d:
        "M12 3.5l2.77 5.62 6.2.9-4.48 4.36 1.06 6.16L12 17.62 6.45 20.54l1.06-6.16-4.48-4.36 6.2-.9L12 3.5z",
    }),
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
