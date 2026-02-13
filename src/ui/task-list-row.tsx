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
  labels: string[]
  star: boolean
  parentTaskName?: string | null
  taskTagRef?: BlockRef | null
}

interface TaskListRowProps {
  item: TaskListRowItem
  schema: TaskSchemaDefinition
  isChinese: boolean
  rowIndex?: number
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
  const rowIndex = props.rowIndex ?? 0
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const statusColor = resolveStatusColor(props.item.status, props.schema)
  const statusVisualState = resolveStatusVisualState(props.item.status, props.schema)
  const dueInfo = resolveDueInfo(props.item.endTime, props.isChinese)
  const dueBadgeStyle = resolveDueBadgeStyle(dueInfo.tone)
  const taskLabels = Array.isArray(props.item.labels) ? props.item.labels : []
  const visibleLabels = taskLabels.slice(0, 4)
  const hiddenLabelCount = Math.max(0, taskLabels.length - visibleLabels.length)

  React.useEffect(() => {
    ensureTaskRowStyles()
  }, [])

  return React.createElement(
    "div",
    {
      key: props.item.blockId,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocusCapture: () => setFocused(true),
      onBlurCapture: () => setFocused(false),
      style: {
        position: "relative",
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px 10px",
        paddingLeft: `${10 + props.depth * 18}px`,
        border: "1px solid var(--orca-color-border)",
        borderRadius: "10px",
        background: props.contextOnly
          ? "linear-gradient(120deg, rgba(148, 163, 184, 0.08), var(--orca-color-bg-2))"
          : hovered || focused
            ? "linear-gradient(120deg, rgba(37, 99, 235, 0.12), var(--orca-color-bg-1) 58%, rgba(37, 99, 235, 0.04))"
            : "linear-gradient(120deg, var(--orca-color-bg-2), var(--orca-color-bg-1) 58%, rgba(148, 163, 184, 0.06))",
        borderColor: hovered || focused
          ? "var(--orca-color-text-blue, #2563eb)"
          : "var(--orca-color-border)",
        boxShadow: hovered || focused
          ? "0 8px 18px rgba(15, 23, 42, 0.14)"
          : "0 1px 3px rgba(15, 23, 42, 0.08)",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition:
          "transform 170ms ease, box-shadow 170ms ease, background 170ms ease, border-color 170ms ease",
        opacity: props.contextOnly ? 0.78 : 1,
        animationName: "mloTaskRowEnter",
        animationDuration: "260ms",
        animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
        animationDelay: `${Math.min(rowIndex, 8) * 30}ms`,
        animationFillMode: "backwards",
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
              border: "1px solid rgba(148, 163, 184, 0.3)",
              borderRadius: "4px",
              background: props.collapsed
                ? "rgba(148, 163, 184, 0.08)"
                : "rgba(37, 99, 235, 0.12)",
              color: props.collapsed
                ? "var(--orca-color-text-2)"
                : "var(--orca-color-text-blue, #2563eb)",
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
    React.createElement("div", {
      style: {
        width: "3px",
        height: "28px",
        borderRadius: "99px",
        background: statusColor,
        opacity: props.contextOnly ? 0.62 : 0.95,
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
          width: "20px",
          height: "20px",
          border: "none",
          background: "transparent",
          color: statusColor,
          cursor: props.loading || props.updating ? "not-allowed" : "pointer",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          padding: 0,
          opacity: props.loading || props.updating ? 0.6 : 1,
        },
      },
      React.createElement(StatusIcon, { state: statusVisualState }),
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
          gap: "3px",
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
            fontWeight: props.contextOnly ? 500 : 560,
            letterSpacing: "0.01em",
          },
        },
        props.item.text,
      ),
      taskLabels.length > 0
        ? React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
                width: "100%",
                marginTop: "1px",
              },
            },
            ...visibleLabels.map((label: string) =>
              React.createElement(
                "span",
                {
                  key: `${props.item.blockId}-${label}`,
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    maxWidth: "100%",
                    padding: "1px 7px",
                    borderRadius: "999px",
                    border: "1px solid rgba(37, 99, 235, 0.24)",
                    background: "rgba(37, 99, 235, 0.12)",
                    color: "var(--orca-color-text-blue, #2563eb)",
                    fontSize: "10px",
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                },
                label,
              )),
            hiddenLabelCount > 0
              ? React.createElement(
                  "span",
                  {
                    key: `${props.item.blockId}-more-labels`,
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "1px 7px",
                      borderRadius: "999px",
                      border: "1px solid rgba(148, 163, 184, 0.3)",
                      background: "rgba(148, 163, 184, 0.08)",
                      color: "var(--orca-color-text-2)",
                      fontSize: "10px",
                      lineHeight: 1.3,
                    },
                  },
                  `+${hiddenLabelCount}`,
                )
              : null,
          )
        : null,
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
                letterSpacing: "0.01em",
              },
            },
            t("Parent: ${name}", { name: props.item.parentTaskName }),
          )
        : null,
    ),
    dueInfo.text !== ""
      ? React.createElement(
          "div",
          {
            style: {
              fontSize: "10px",
              color: dueBadgeStyle.color,
              fontWeight: dueInfo.strong ? 600 : 400,
              whiteSpace: "nowrap",
              padding: "2px 8px",
              borderRadius: "999px",
              border: dueBadgeStyle.border,
              background: dueBadgeStyle.background,
              letterSpacing: "0.02em",
            },
          },
          dueInfo.text,
        )
      : null,
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
          border: "1px solid rgba(148, 163, 184, 0.3)",
          borderRadius: "6px",
          background: hovered || focused
            ? "rgba(37, 99, 235, 0.08)"
            : "rgba(15, 23, 42, 0.03)",
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
          border: "1px solid rgba(148, 163, 184, 0.3)",
          borderRadius: "6px",
          background: props.item.star
            ? "rgba(214, 158, 46, 0.14)"
            : hovered || focused
              ? "rgba(37, 99, 235, 0.08)"
              : "rgba(15, 23, 42, 0.03)",
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

function ensureTaskRowStyles() {
  const styleId = "mlo-task-row-style"
  if (document.getElementById(styleId) != null) {
    return
  }

  const styleEl = document.createElement("style")
  styleEl.id = styleId
  styleEl.textContent = `
@keyframes mloTaskRowEnter {
  0% {
    opacity: 0;
    transform: translateY(6px) scale(0.996);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
`

  document.head.appendChild(styleEl)
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

type StatusVisualState = "todo" | "doing" | "done"

function resolveStatusVisualState(
  status: string,
  schema: TaskSchemaDefinition,
): StatusVisualState {
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices
  if (status === doneStatus) {
    return "done"
  }
  if (status === doingStatus) {
    return "doing"
  }
  if (status === todoStatus) {
    return "todo"
  }

  return "todo"
}

function StatusIcon(props: { state: StatusVisualState }) {
  const React = window.React
  return React.createElement(
    "svg",
    {
      width: 18,
      height: 18,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.9,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
    },
    React.createElement("circle", {
      cx: 12,
      cy: 12,
      r: 8,
    }),
    props.state === "done"
      ? React.createElement("path", {
          d: "M8.4 12.3l2.1 2.2 5-5.2",
        })
      : props.state === "doing"
        ? React.createElement("circle", {
            cx: 12,
            cy: 12,
            r: 3.1,
            fill: "currentColor",
            stroke: "none",
          })
        : null,
  )
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

type DueInfoTone = "none" | "normal" | "soon" | "overdue"

function resolveDueBadgeStyle(tone: DueInfoTone): {
  color: string
  border: string
  background: string
} {
  if (tone === "overdue") {
    return {
      color: "var(--orca-color-text-red, #c53030)",
      border: "1px solid rgba(197, 48, 48, 0.3)",
      background: "rgba(197, 48, 48, 0.12)",
    }
  }

  if (tone === "soon") {
    return {
      color: "var(--orca-color-text-yellow, #b7791f)",
      border: "1px solid rgba(183, 121, 31, 0.3)",
      background: "rgba(183, 121, 31, 0.12)",
    }
  }

  return {
    color: "var(--orca-color-text-2)",
    border: "1px solid rgba(148, 163, 184, 0.3)",
    background: "rgba(148, 163, 184, 0.08)",
  }
}

function resolveDueInfo(
  endTime: Date | null,
  isChinese: boolean,
): { text: string; color: string; strong: boolean; tone: DueInfoTone } {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return {
      text: "",
      color: "var(--orca-color-text-2)",
      strong: false,
      tone: "none",
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
      tone: "overdue",
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
      tone: "soon",
    }
  }

  if (dueTime >= startOfTomorrow.getTime() && dueTime < startOfAfterTomorrow.getTime()) {
    return {
      text: t("Tomorrow"),
      color: "var(--orca-color-text-yellow, #b7791f)",
      strong: true,
      tone: "soon",
    }
  }

  return {
    text: endTime.toLocaleDateString(isChinese ? "zh-CN" : undefined),
    color: "var(--orca-color-text-2)",
    strong: false,
    tone: "normal",
  }
}
