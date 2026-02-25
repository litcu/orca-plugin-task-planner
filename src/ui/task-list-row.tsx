import type { BlockProperty, BlockRef, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  formatTaskTimerDuration,
  hasTaskTimerRecord,
  readTaskTimerFromProperties,
  resolveTaskPomodoroProgress,
  resolveTaskTimerElapsedMs,
  type TaskTimerMode,
} from "../core/task-timer"

const POMODORO_DURATION_MS = 25 * 60 * 1000

export interface TaskListRowItem {
  blockId: DbId
  sourceBlockId: DbId
  parentBlockId: DbId | null
  text: string
  status: string
  endTime: Date | null
  nextReview: Date | null
  reviewEvery: string
  lastReviewed: Date | null
  labels: string[]
  star: boolean
  blockProperties?: BlockProperty[]
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
  showReviewAction: boolean
  showReviewSelection?: boolean
  reviewSelected?: boolean
  starUpdating: boolean
  timerEnabled: boolean
  timerMode: TaskTimerMode
  timerNowMs: number
  timerUpdating: boolean
  reviewUpdating: boolean
  onToggleCollapse?: () => void
  onToggleReviewSelected?: () => void
  onToggleStatus: () => void | Promise<void>
  onNavigate: () => void
  onToggleStar: () => void | Promise<void>
  onToggleTimer: () => void | Promise<void>
  onMarkReviewed: () => void | Promise<void>
  onAddSubtask: () => void | Promise<void>
  onDeleteTaskTag: () => void | Promise<void>
  onDeleteTaskBlock: () => void | Promise<void>
  showMyDayAction?: boolean
  myDaySelected?: boolean
  myDayUpdating?: boolean
  onAddToMyDay?: () => void | Promise<void>
  onRemoveFromMyDay?: () => void | Promise<void>
  onOpen: () => void
}

export function TaskListRow(props: TaskListRowProps) {
  const React = window.React
  const ConfirmBox = orca.components.ConfirmBox
  const Popup = orca.components.Popup
  const Menu = orca.components.Menu
  const MenuSeparator = orca.components.MenuSeparator
  const MenuText = orca.components.MenuText
  const rowIndex = props.rowIndex ?? 0
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const pointerInteractingRef = React.useRef(false)
  const [contextMenuVisible, setContextMenuVisible] = React.useState(false)
  const [contextMenuRect, setContextMenuRect] = React.useState<DOMRect | null>(null)
  const contextMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (contextMenuContainerRef.current == null) {
    contextMenuContainerRef.current = document.body
  }
  const statusColor = resolveStatusColor(props.item.status, props.schema)
  const statusVisualState = resolveStatusVisualState(props.item.status, props.schema)
  const isCompleted = props.item.status === props.schema.statusChoices[2]
  const dueInfo = resolveDueInfo(props.item.endTime, props.isChinese)
  const dueBadgeStyle = resolveDueBadgeStyle(dueInfo.tone)
  const reviewInfo = resolveReviewInfo(props.item.nextReview, props.isChinese)
  const reviewBadgeStyle = resolveReviewBadgeStyle(reviewInfo.tone)
  const hasReviewConfiguration =
    props.item.nextReview != null || props.item.reviewEvery.trim() !== ""
  const canShowReviewAction = props.showReviewAction && hasReviewConfiguration
  const taskLabels = Array.isArray(props.item.labels) ? props.item.labels : []
  const parentTaskName = props.item.parentTaskName ?? ""
  const hasParentContext = props.showParentTaskContext && props.item.parentTaskName != null
  const visibleLabels = taskLabels.slice(0, hasParentContext ? 2 : 3)
  const hiddenLabelCount = Math.max(0, taskLabels.length - visibleLabels.length)
  const timerData = readTaskTimerFromProperties(props.item.blockProperties)
  const timerElapsedMs = resolveTaskTimerElapsedMs(timerData, props.timerNowMs)
  const hasTimerRecord = hasTaskTimerRecord(timerData)
  const timerDurationText = formatTaskTimerDuration(timerElapsedMs)
  const timerProgress = resolveTaskPomodoroProgress(timerElapsedMs)
  const timerButtonDisabled =
    props.loading ||
    props.updating ||
    props.timerUpdating ||
    (!timerData.running && isCompleted)
  const timerButtonTitle =
    !timerData.running && isCompleted
      ? t("Completed task cannot start timer")
      : timerData.running
        ? t("Stop timer")
        : t("Start timer")
  const timerDisplayText =
    hasTimerRecord && props.timerMode === "pomodoro"
      ? t("Pomodoro ${cycle} ${elapsed}/${duration}", {
          cycle: String(timerProgress.cycle),
          elapsed: formatTaskTimerDuration(timerProgress.cycleElapsedMs),
          duration: formatTaskTimerDuration(POMODORO_DURATION_MS),
        })
      : hasTimerRecord
        ? t("Elapsed ${time}", { time: timerDurationText })
        : t("Start timer")
  const timerButtonTone =
    timerData.running
      ? "running"
      : props.timerMode === "pomodoro"
        ? "pomodoro"
        : hasTimerRecord
          ? "direct"
          : "idle"
  const mutationDisabled =
    props.loading ||
    props.updating ||
    props.starUpdating ||
    props.timerUpdating ||
    props.reviewUpdating
  const canShowMyDayAction =
    props.showMyDayAction === true &&
    ((props.myDaySelected === true && props.onRemoveFromMyDay != null) ||
      (props.myDaySelected !== true && props.onAddToMyDay != null))
  const myDayMutationDisabled = mutationDisabled || props.myDayUpdating === true

  React.useEffect(() => {
    ensureTaskRowStyles()
  }, [])

  const rowContent = React.createElement(
    "div",
    {
      key: props.item.blockId,
      onPointerDownCapture: () => {
        pointerInteractingRef.current = true
      },
      onPointerUpCapture: () => {
        pointerInteractingRef.current = false
      },
      onPointerCancelCapture: () => {
        pointerInteractingRef.current = false
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        pointerInteractingRef.current = false
        setHovered(false)
      },
      onFocusCapture: () => {
        setFocused(!pointerInteractingRef.current)
      },
      onBlurCapture: (event: FocusEvent) => {
        const currentTarget =
          (event as unknown as { currentTarget?: EventTarget | null }).currentTarget ?? null
        const relatedTarget =
          (event as unknown as { relatedTarget?: EventTarget | null }).relatedTarget ?? null

        if (
          currentTarget instanceof HTMLElement &&
          relatedTarget instanceof Node &&
          currentTarget.contains(relatedTarget)
        ) {
          return
        }

        setFocused(false)
      },
      style: {
        position: "relative",
        width: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 9px",
        paddingLeft: `${9 + props.depth * 16}px`,
        border: "1px solid var(--orca-color-border)",
        borderRadius: "9px",
        background: props.contextOnly
          ? "linear-gradient(120deg, rgba(148, 163, 184, 0.04), rgba(148, 163, 184, 0.01))"
          : isCompleted
            ? hovered || focused
              ? "linear-gradient(120deg, rgba(148, 163, 184, 0.2), var(--orca-color-bg-1) 58%, rgba(148, 163, 184, 0.1))"
              : "linear-gradient(120deg, rgba(148, 163, 184, 0.16), var(--orca-color-bg-1) 58%, rgba(148, 163, 184, 0.08))"
          : hovered || focused
            ? "linear-gradient(120deg, rgba(37, 99, 235, 0.12), var(--orca-color-bg-1) 58%, rgba(37, 99, 235, 0.04))"
            : "linear-gradient(120deg, var(--orca-color-bg-2), var(--orca-color-bg-1) 58%, rgba(148, 163, 184, 0.06))",
        borderColor: props.contextOnly
          ? "rgba(148, 163, 184, 0.24)"
          : isCompleted
          ? hovered || focused
            ? "rgba(148, 163, 184, 0.65)"
            : "rgba(148, 163, 184, 0.4)"
          : hovered || focused
            ? "var(--orca-color-text-blue, #2563eb)"
            : "var(--orca-color-border)",
        boxShadow: props.contextOnly
          ? "none"
          : isCompleted
          ? "0 1px 3px rgba(15, 23, 42, 0.06)"
          : hovered || focused
            ? "0 6px 14px rgba(15, 23, 42, 0.13)"
            : "0 1px 3px rgba(15, 23, 42, 0.08)",
        transform: hovered && !props.contextOnly ? "translateY(-1px)" : "translateY(0)",
        transition:
          "transform 170ms ease, box-shadow 170ms ease, background 170ms ease, border-color 170ms ease, filter 170ms ease, opacity 170ms ease",
        opacity: props.contextOnly ? (hovered || focused ? 0.68 : 0.58) : isCompleted ? 0.86 : 1,
        filter: props.contextOnly ? "saturate(0.38) brightness(0.94)" : "none",
        animationName: "mloTaskRowEnter",
        animationDuration: "260ms",
        animationTimingFunction: "cubic-bezier(.2,.8,.2,1)",
        animationDelay: `${Math.min(rowIndex, 8) * 30}ms`,
        animationFillMode: "backwards",
      },
    },
    props.showReviewSelection
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              props.onToggleReviewSelected?.()
            },
            title: props.reviewSelected ? t("Selected") : t("Select"),
            style: {
              width: "16px",
              height: "16px",
              border: props.reviewSelected
                ? "1px solid rgba(56, 161, 105, 0.55)"
                : "1px solid rgba(148, 163, 184, 0.35)",
              borderRadius: "4px",
              background: props.reviewSelected
                ? "rgba(56, 161, 105, 0.18)"
                : "rgba(148, 163, 184, 0.08)",
              color: props.reviewSelected
                ? "var(--orca-color-text-green, #2f855a)"
                : "var(--orca-color-text-2)",
              cursor: "pointer",
              flexShrink: 0,
              fontSize: "11px",
              lineHeight: 1,
              padding: 0,
            },
          },
          props.reviewSelected
            ? React.createElement("i", {
                className: "ti ti-check",
                style: { fontSize: "11px", lineHeight: 1 },
              })
            : null,
        )
      : null,
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
              width: "16px",
              height: "16px",
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
              fontSize: "11px",
              lineHeight: 1,
              padding: 0,
            },
          },
          props.collapsed ? "\u25B8" : "\u25BE",
        )
      : React.createElement("div", {
          style: {
            width: "16px",
            height: "16px",
            flexShrink: 0,
          },
        }),
    React.createElement("div", {
      style: {
        width: "2px",
        height: "24px",
        borderRadius: "99px",
        background: statusColor,
        opacity: props.contextOnly ? 0.38 : 0.95,
        flexShrink: 0,
      },
    }),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          if (props.loading || props.updating) {
            return
          }
          void props.onToggleStatus()
        },
        "aria-disabled": props.loading || props.updating,
        title: t("Toggle task status"),
        style: {
          width: "18px",
          height: "18px",
          border: "none",
          background: "transparent",
          color: statusColor,
          cursor: "pointer",
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
          color: props.contextOnly
            ? "var(--orca-color-text-2)"
            : isCompleted
              ? "var(--orca-color-text-2)"
              : "var(--orca-color-text)",
          textAlign: "left",
          cursor: "pointer",
          padding: 0,
          flex: 1,
          minWidth: 0,
          fontSize: "12.5px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "2px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            width: "100%",
            minWidth: 0,
            flexWrap: "nowrap",
          },
        },
        React.createElement(
          "span",
          {
            style: {
              display: "block",
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              lineHeight: 1.25,
              fontWeight: props.contextOnly ? 470 : 560,
              letterSpacing: "0.01em",
              color: props.contextOnly
                ? "var(--orca-color-text-2)"
                : isCompleted
                  ? "var(--orca-color-text-2)"
                  : "var(--orca-color-text)",
              textDecoration: isCompleted ? "line-through" : "none",
            },
          },
          props.item.text,
        ),
        ...visibleLabels.map((label: string) =>
          React.createElement(
            "span",
            {
              key: `${props.item.blockId}-${label}`,
              style: {
                display: "inline-flex",
                alignItems: "center",
                maxWidth: "86px",
                padding: "0 6px",
                height: "16px",
                borderRadius: "999px",
                border: isCompleted
                  ? "1px solid rgba(148, 163, 184, 0.3)"
                  : "1px solid rgba(37, 99, 235, 0.24)",
                background: isCompleted
                  ? "rgba(148, 163, 184, 0.09)"
                  : "rgba(37, 99, 235, 0.12)",
                color: isCompleted
                  ? "var(--orca-color-text-2)"
                  : "var(--orca-color-text-blue, #2563eb)",
                fontSize: "10px",
                lineHeight: 1,
                flexShrink: 0,
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
                  padding: "0 6px",
                  height: "16px",
                  borderRadius: "999px",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  background: "rgba(148, 163, 184, 0.08)",
                  color: "var(--orca-color-text-2)",
                  fontSize: "10px",
                  lineHeight: 1,
                  flexShrink: 0,
                },
              },
              `+${hiddenLabelCount}`,
            )
          : null,
      ),
      hasParentContext
        ? React.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                width: "100%",
                minWidth: 0,
              },
            },
            React.createElement(
              "span",
              {
                key: `${props.item.blockId}-parent`,
                title: t("Parent: ${name}", { name: parentTaskName }),
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  minWidth: 0,
                  maxWidth: "100%",
                  flex: "1 1 auto",
                  padding: "0 6px",
                  height: "16px",
                  borderRadius: "999px",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  background: "rgba(148, 163, 184, 0.08)",
                  color: "var(--orca-color-text-2)",
                  fontSize: "10px",
                  lineHeight: 1,
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    fontSize: "9px",
                    opacity: 0.75,
                    lineHeight: 1,
                    flexShrink: 0,
                  },
                },
                "\u21B3",
              ),
              React.createElement(
                "span",
                {
                  style: {
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                parentTaskName,
              ),
            ),
          )
        : null,
    ),
    reviewInfo.text !== ""
      ? React.createElement(
          "div",
          {
            style: {
              fontSize: "9.5px",
              color: reviewBadgeStyle.color,
              fontWeight: reviewInfo.strong ? 600 : 400,
              whiteSpace: "nowrap",
              padding: "1px 7px",
              borderRadius: "999px",
              border: reviewBadgeStyle.border,
              background: reviewBadgeStyle.background,
              letterSpacing: "0.02em",
            },
          },
          reviewInfo.text,
        )
      : null,
    dueInfo.text !== ""
      ? React.createElement(
          "div",
          {
            style: {
              fontSize: "9.5px",
              color: dueBadgeStyle.color,
              fontWeight: dueInfo.strong ? 600 : 400,
              whiteSpace: "nowrap",
              padding: "1px 7px",
              borderRadius: "999px",
              border: dueBadgeStyle.border,
              background: dueBadgeStyle.background,
              letterSpacing: "0.02em",
            },
          },
          dueInfo.text,
        )
      : null,
    canShowReviewAction
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              if (props.loading || props.reviewUpdating) {
                return
              }
              void props.onMarkReviewed()
            },
            disabled: props.loading || props.reviewUpdating,
            title: t("Mark reviewed"),
            style: {
              width: "22px",
              height: "22px",
              padding: 0,
              border: "1px solid rgba(56, 161, 105, 0.35)",
              borderRadius: "6px",
              background: reviewInfo.tone === "overdue"
                ? "rgba(56, 161, 105, 0.16)"
                : "rgba(56, 161, 105, 0.08)",
              color: "var(--orca-color-text-green, #2f855a)",
              cursor: props.loading || props.reviewUpdating ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              opacity: props.loading || props.reviewUpdating ? 0.62 : 1,
            },
          },
          React.createElement("i", {
            className: "ti ti-checks",
            style: { fontSize: "14px", lineHeight: 1 },
          }),
        )
      : null,
    props.timerEnabled
      ? React.createElement(
          "button",
          {
            type: "button",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              if (timerButtonDisabled) {
                return
              }
              void props.onToggleTimer()
            },
            disabled: timerButtonDisabled,
            title: timerButtonTitle,
            style: {
              maxWidth: "180px",
              height: "22px",
              padding: "0 8px",
              border: timerButtonTone === "running"
                ? "1px solid rgba(197, 48, 48, 0.35)"
                : timerButtonTone === "pomodoro"
                  ? "1px solid rgba(183, 121, 31, 0.34)"
                  : timerButtonTone === "direct"
                    ? "1px solid rgba(37, 99, 235, 0.34)"
                    : "1px solid rgba(148, 163, 184, 0.34)",
              borderRadius: "999px",
              background: timerButtonTone === "running"
                ? "rgba(197, 48, 48, 0.1)"
                : timerButtonTone === "pomodoro"
                  ? hovered || focused
                    ? "rgba(183, 121, 31, 0.17)"
                    : "rgba(183, 121, 31, 0.1)"
                  : timerButtonTone === "direct"
                    ? hovered || focused
                      ? "rgba(37, 99, 235, 0.14)"
                      : "rgba(37, 99, 235, 0.08)"
                    : hovered || focused
                      ? "rgba(148, 163, 184, 0.2)"
                      : "rgba(148, 163, 184, 0.12)",
              color: timerButtonTone === "running"
                ? "var(--orca-color-text-red, #c53030)"
                : timerButtonTone === "pomodoro"
                  ? "var(--orca-color-text-yellow, #b7791f)"
                  : timerButtonTone === "idle"
                    ? "var(--orca-color-text-2)"
                    : "var(--orca-color-text-blue, #2563eb)",
              cursor: timerButtonDisabled ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              flexShrink: 0,
              fontSize: "9.5px",
              fontWeight: timerData.running ? 600 : 500,
              letterSpacing: "0.02em",
              fontVariantNumeric: "tabular-nums",
              opacity: timerButtonDisabled ? 0.56 : 1,
            },
          },
          React.createElement("i", {
            className: timerData.running ? "ti ti-player-stop-filled" : "ti ti-player-play-filled",
            style: { fontSize: "12px", lineHeight: 1, flexShrink: 0 },
          }),
          React.createElement(
            "span",
            {
              style: {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              },
            },
            timerDisplayText,
          ),
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
          width: "22px",
          height: "22px",
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
          width: "22px",
          height: "22px",
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

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          minWidth: 0,
        },
        onContextMenu: (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const nativeEvent =
            (event as unknown as { nativeEvent?: MouseEvent }).nativeEvent ?? event
          setContextMenuRect(
            new DOMRect(
              nativeEvent.clientX,
              nativeEvent.clientY,
              0,
              0,
            ),
          )
          setContextMenuVisible(true)
        },
      },
      rowContent,
    ),
    contextMenuRect == null
      ? null
      : React.createElement(
          Popup,
          {
            container: contextMenuContainerRef,
            rect: contextMenuRect,
            visible: contextMenuVisible,
            onClose: () => setContextMenuVisible(false),
            onClosed: () => setContextMenuRect(null),
            defaultPlacement: "bottom",
            alignment: "left",
            offset: 6,
            allowBeyondContainer: true,
            noPointerLogic: true,
            escapeToClose: true,
          },
          React.createElement(
            Menu,
            {
              keyboardNav: true,
              className: "mlo-task-row-context-menu-content",
            },
            React.createElement(MenuText, {
              title: t("Add subtask"),
              preIcon: "ti ti-list-tree",
              disabled: mutationDisabled,
              onClick: (event: MouseEvent) => {
                event.stopPropagation()
                setContextMenuVisible(false)
                if (mutationDisabled) {
                  return
                }
                void props.onAddSubtask()
              },
            }),
            React.createElement(MenuText, {
              title: props.item.star ? t("Unstar task") : t("Star task"),
              preIcon: props.item.star ? "ti ti-star-off" : "ti ti-star",
              disabled: mutationDisabled,
              onClick: (event: MouseEvent) => {
                event.stopPropagation()
                setContextMenuVisible(false)
                if (mutationDisabled) {
                  return
                }
                void props.onToggleStar()
              },
            }),
            React.createElement(MenuText, {
              title: t("Open task properties"),
              preIcon: "ti ti-edit",
              disabled: props.loading,
              onClick: (event: MouseEvent) => {
                event.stopPropagation()
                setContextMenuVisible(false)
                if (props.loading) {
                  return
                }
                props.onOpen()
              },
            }),
            React.createElement(MenuText, {
              title: t("Jump to task location"),
              preIcon: "ti ti-arrow-up-right",
              disabled: props.loading,
              onClick: (event: MouseEvent) => {
                event.stopPropagation()
                setContextMenuVisible(false)
                if (props.loading) {
                  return
                }
                props.onNavigate()
              },
            }),
            canShowMyDayAction
              ? React.createElement(MenuText, {
                  title: props.myDaySelected
                    ? t("Remove from My Day")
                    : t("Add to My Day"),
                  preIcon: props.myDaySelected
                    ? "ti ti-calendar-minus"
                    : "ti ti-calendar-plus",
                  disabled: myDayMutationDisabled,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation()
                    setContextMenuVisible(false)
                    if (myDayMutationDisabled) {
                      return
                    }

                    if (props.myDaySelected) {
                      void props.onRemoveFromMyDay?.()
                      return
                    }
                    void props.onAddToMyDay?.()
                  },
                })
              : null,
            React.createElement(MenuSeparator, {}),
            React.createElement(
              ConfirmBox,
              {
                text: t("Remove task tag from this block?"),
                onConfirm: async (_event: unknown, close: () => void) => {
                  close()
                  setContextMenuVisible(false)
                  if (mutationDisabled) {
                    return
                  }
                  await props.onDeleteTaskTag()
                },
              },
              (openConfirm: (event: MouseEvent) => void) =>
                React.createElement(MenuText, {
                  title: t("Delete task tag"),
                  preIcon: "ti ti-tag-off",
                  dangerous: true,
                  disabled: mutationDisabled,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation()
                    if (mutationDisabled) {
                      return
                    }
                    openConfirm(event)
                  },
                }),
            ),
            React.createElement(
              ConfirmBox,
              {
                text: t("Delete task block and its subtasks?"),
                onConfirm: async (_event: unknown, close: () => void) => {
                  close()
                  setContextMenuVisible(false)
                  if (mutationDisabled) {
                    return
                  }
                  await props.onDeleteTaskBlock()
                },
              },
              (openConfirm: (event: MouseEvent) => void) =>
                React.createElement(MenuText, {
                  title: t("Delete task block"),
                  preIcon: "ti ti-trash",
                  dangerous: true,
                  disabled: mutationDisabled,
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation()
                    if (mutationDisabled) {
                      return
                    }
                    openConfirm(event)
                  },
                }),
            ),
          ),
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

.mlo-task-row-context-menu-content {
  min-width: 186px;
  border-radius: 10px;
  border: 1px solid var(--orca-color-border);
  background: var(--orca-color-bg-1);
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
      width: 16,
      height: 16,
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
    return "var(--orca-color-text-2)"
  }
  if (status === doingStatus) {
    return "var(--orca-color-text-yellow)"
  }

  return "var(--orca-color-text-2)"
}

type DueInfoTone = "none" | "normal" | "soon" | "overdue"
type ReviewInfoTone = "none" | "normal" | "soon" | "overdue"

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

function resolveReviewBadgeStyle(tone: ReviewInfoTone): {
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
      color: "var(--orca-color-text-green, #2f855a)",
      border: "1px solid rgba(56, 161, 105, 0.3)",
      background: "rgba(56, 161, 105, 0.12)",
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

function resolveReviewInfo(
  nextReview: Date | null,
  isChinese: boolean,
): { text: string; strong: boolean; tone: ReviewInfoTone } {
  if (nextReview == null || Number.isNaN(nextReview.getTime())) {
    return {
      text: "",
      strong: false,
      tone: "none",
    }
  }

  const now = new Date()
  const nowTime = now.getTime()
  const reviewTime = nextReview.getTime()

  if (reviewTime < nowTime) {
    const diffMs = nowTime - reviewTime
    const overdueDays = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
    return {
      text: t("Review overdue ${days}d", { days: String(overdueDays) }),
      strong: true,
      tone: "overdue",
    }
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const startOfAfterTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 2,
  )

  if (reviewTime >= startOfToday.getTime() && reviewTime < startOfTomorrow.getTime()) {
    return {
      text: t("Review today"),
      strong: true,
      tone: "soon",
    }
  }

  if (reviewTime >= startOfTomorrow.getTime() && reviewTime < startOfAfterTomorrow.getTime()) {
    return {
      text: t("Review tomorrow"),
      strong: true,
      tone: "soon",
    }
  }

  return {
    text: t("Review ${date}", {
      date: nextReview.toLocaleDateString(isChinese ? "zh-CN" : undefined),
    }),
    strong: false,
    tone: "normal",
  }
}
