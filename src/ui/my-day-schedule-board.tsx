import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

const DAY_MINUTES = 24 * 60
const TIMELINE_SLOT_MINUTES = 30
const DEFAULT_SCHEDULE_DURATION_MINUTES = 60
const MIN_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 12 * 60
const DEFAULT_TIMELINE_START_MINUTE = 6 * 60
const DEFAULT_TIMELINE_END_MINUTE = 22 * 60
const PIXELS_PER_MINUTE = 1.04
const DRAG_DATA_TYPE = "application/x-mlo-my-day-task"

export interface MyDayScheduleTaskItem {
  blockId: DbId
  text: string
  status: string
  labels: string[]
  star: boolean
  scheduleStartMinute: number | null
  scheduleEndMinute: number | null
}

interface MyDayScheduleBoardProps {
  items: MyDayScheduleTaskItem[]
  disabled: boolean
  updatingTaskIds: Set<DbId>
  onOpenTask: (blockId: DbId) => void
  onRemoveTask: (blockId: DbId) => void | Promise<void>
  onApplySchedule: (blockId: DbId, startMinute: number, endMinute: number) => void | Promise<void>
  onClearSchedule: (blockId: DbId) => void | Promise<void>
}

interface DragPayload {
  taskId: DbId
  durationMinutes: number
}

interface TimelinePointerDragState {
  mode: "move" | "resize-start" | "resize-end"
  taskId: DbId
  pointerId: number
  originClientY: number
  originStartMinute: number
  originEndMinute: number
  previewStartMinute: number
  previewEndMinute: number
}

interface TimelineRenderItem {
  item: MyDayScheduleTaskItem
  baseStartMinute: number
  baseEndMinute: number
  startMinute: number
  endMinute: number
  pointerInteracting: boolean
  top: number
  height: number
  updating: boolean
}

interface TimelineLaneLayout {
  laneIndex: number
  laneCount: number
}

const TIMELINE_LANE_GAP_PX = 8

export function MyDayScheduleBoard(props: MyDayScheduleBoardProps) {
  const React = window.React
  const timelineRef = React.useRef<HTMLDivElement | null>(null)
  const [draggingTaskId, setDraggingTaskId] = React.useState<DbId | null>(null)
  const [dropMinute, setDropMinute] = React.useState<number | null>(null)
  const [timelinePointerDragState, setTimelinePointerDragState] =
    React.useState<TimelinePointerDragState | null>(null)
  const timelinePointerDragStateRef = React.useRef<TimelinePointerDragState | null>(null)
  const timelineBoundsRef = React.useRef<{
    startMinute: number
    endMinute: number
  }>({
    startMinute: DEFAULT_TIMELINE_START_MINUTE,
    endMinute: DEFAULT_TIMELINE_END_MINUTE,
  })
  const disabledRef = React.useRef(props.disabled)
  const onApplyScheduleRef = React.useRef(props.onApplySchedule)

  React.useEffect(() => {
    ensureMyDayScheduleStyles()
  }, [])

  const scheduledItems = React.useMemo((): MyDayScheduleTaskItem[] => {
    return props.items
      .filter(isScheduledTaskItem)
      .slice()
      .sort((left, right) => {
        const leftStart = left.scheduleStartMinute ?? 0
        const rightStart = right.scheduleStartMinute ?? 0
        if (leftStart !== rightStart) {
          return leftStart - rightStart
        }

        const leftEnd = left.scheduleEndMinute ?? DAY_MINUTES
        const rightEnd = right.scheduleEndMinute ?? DAY_MINUTES
        if (leftEnd !== rightEnd) {
          return leftEnd - rightEnd
        }

        return left.blockId - right.blockId
      })
  }, [props.items])

  const unscheduledItems = React.useMemo((): MyDayScheduleTaskItem[] => {
    return props.items
      .filter((item: MyDayScheduleTaskItem) => !isScheduledTaskItem(item))
      .slice()
      .sort((left, right) => {
        if (left.star !== right.star) {
          return left.star ? -1 : 1
        }

        return left.blockId - right.blockId
      })
  }, [props.items])

  const [timelineStartMinute, timelineEndMinute] = React.useMemo(() => {
    const starts = scheduledItems
      .map((item: MyDayScheduleTaskItem) => item.scheduleStartMinute)
      .filter((item: number | null): item is number => typeof item === "number")
    const ends = scheduledItems
      .map((item: MyDayScheduleTaskItem) => item.scheduleEndMinute)
      .filter((item: number | null): item is number => typeof item === "number")

    const earliestStart = starts.length > 0 ? Math.min(...starts) : DEFAULT_TIMELINE_START_MINUTE
    const latestEnd = ends.length > 0 ? Math.max(...ends) : DEFAULT_TIMELINE_END_MINUTE
    const paddedStart = Math.max(0, earliestStart - 60)
    const paddedEnd = Math.min(DAY_MINUTES, latestEnd + 60)

    const resolvedStart = Math.max(
      0,
      Math.min(
        floorToSlot(Math.min(DEFAULT_TIMELINE_START_MINUTE, paddedStart)),
        DAY_MINUTES - TIMELINE_SLOT_MINUTES,
      ),
    )
    const resolvedEnd = Math.min(
      DAY_MINUTES,
      Math.max(
        ceilToSlot(Math.max(DEFAULT_TIMELINE_END_MINUTE, paddedEnd)),
        resolvedStart + 8 * 60,
      ),
    )

    return [resolvedStart, resolvedEnd]
  }, [scheduledItems])

  const timelineHeight = Math.max(
    420,
    Math.round((timelineEndMinute - timelineStartMinute) * PIXELS_PER_MINUTE),
  )

  const timelineSlots = React.useMemo(() => {
    const result: number[] = []
    for (let minute = timelineStartMinute; minute <= timelineEndMinute; minute += TIMELINE_SLOT_MINUTES) {
      result.push(minute)
    }
    return result
  }, [timelineEndMinute, timelineStartMinute])

  const timelineRenderItems = React.useMemo((): TimelineRenderItem[] => {
    return scheduledItems.map((item: MyDayScheduleTaskItem) => {
      const baseStartMinute = item.scheduleStartMinute ?? timelineStartMinute
      const baseEndMinute =
        item.scheduleEndMinute ?? (baseStartMinute + DEFAULT_SCHEDULE_DURATION_MINUTES)
      const pointerInteracting = timelinePointerDragState?.taskId === item.blockId
      const startMinute = pointerInteracting
        ? timelinePointerDragState.previewStartMinute
        : baseStartMinute
      const endMinute = pointerInteracting
        ? timelinePointerDragState.previewEndMinute
        : baseEndMinute
      const duration = Math.max(MIN_DURATION_MINUTES, endMinute - startMinute)
      const top = (startMinute - timelineStartMinute) * PIXELS_PER_MINUTE + 2
      const height = Math.max(48, duration * PIXELS_PER_MINUTE - 4)

      return {
        item,
        baseStartMinute,
        baseEndMinute,
        startMinute,
        endMinute,
        pointerInteracting,
        top,
        height,
        updating: props.updatingTaskIds.has(item.blockId),
      }
    })
  }, [
    props.updatingTaskIds,
    scheduledItems,
    timelinePointerDragState,
    timelineStartMinute,
  ])

  const timelineLaneByTaskId = React.useMemo(() => {
    return computeTimelineLaneLayouts(
      timelineRenderItems.map((item: TimelineRenderItem) => {
        return {
          blockId: item.item.blockId,
          startMinute: item.startMinute,
          endMinute: item.endMinute,
        }
      }),
    )
  }, [timelineRenderItems])

  React.useEffect(() => {
    timelineBoundsRef.current = {
      startMinute: timelineStartMinute,
      endMinute: timelineEndMinute,
    }
  }, [timelineEndMinute, timelineStartMinute])

  React.useEffect(() => {
    disabledRef.current = props.disabled
  }, [props.disabled])

  React.useEffect(() => {
    onApplyScheduleRef.current = props.onApplySchedule
  }, [props.onApplySchedule])

  React.useEffect(() => {
    timelinePointerDragStateRef.current = timelinePointerDragState
  }, [timelinePointerDragState])

  React.useEffect(() => {
    const finishPointerDrag = (event: PointerEvent, applySchedule: boolean) => {
      const dragging = timelinePointerDragStateRef.current
      if (dragging == null || event.pointerId !== dragging.pointerId) {
        return
      }

      event.preventDefault()
      timelinePointerDragStateRef.current = null
      setTimelinePointerDragState(null)

      if (!applySchedule || disabledRef.current) {
        return
      }

      if (
        dragging.previewStartMinute === dragging.originStartMinute &&
        dragging.previewEndMinute === dragging.originEndMinute
      ) {
        return
      }

      void onApplyScheduleRef.current(
        dragging.taskId,
        dragging.previewStartMinute,
        dragging.previewEndMinute,
      )
    }

    const onPointerMove = (event: PointerEvent) => {
      const dragging = timelinePointerDragStateRef.current
      if (dragging == null || event.pointerId !== dragging.pointerId) {
        return
      }

      event.preventDefault()
      const preview = resolvePointerInteractionPreviewMinutes(
        dragging,
        event.clientY,
        timelineBoundsRef.current.startMinute,
        timelineBoundsRef.current.endMinute,
      )
      if (preview == null) {
        return
      }

      if (
        preview.startMinute === dragging.previewStartMinute &&
        preview.endMinute === dragging.previewEndMinute
      ) {
        return
      }

      const nextState: TimelinePointerDragState = {
        ...dragging,
        previewStartMinute: preview.startMinute,
        previewEndMinute: preview.endMinute,
      }
      timelinePointerDragStateRef.current = nextState
      setTimelinePointerDragState(nextState)
    }

    const onPointerUp = (event: PointerEvent) => {
      finishPointerDrag(event, true)
    }

    const onPointerCancel = (event: PointerEvent) => {
      finishPointerDrag(event, false)
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false })
    window.addEventListener("pointerup", onPointerUp, { passive: false })
    window.addEventListener("pointercancel", onPointerCancel, { passive: false })
    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
    }
  }, [])

  const beginTimelinePointerDrag = React.useCallback(
    (
      event: PointerEvent,
      taskId: DbId,
      startMinute: number,
      endMinute: number,
    ) => {
      if (props.disabled || isPointerDragIgnoredTarget(event.target)) {
        return
      }

      const duration = Math.max(MIN_DURATION_MINUTES, endMinute - startMinute)
      const maxStartMinute = Math.max(timelineStartMinute, timelineEndMinute - duration)
      const normalizedStartMinute = clampNumber(startMinute, timelineStartMinute, maxStartMinute)
      const normalizedEndMinute = Math.min(DAY_MINUTES, normalizedStartMinute + duration)

      const nextState: TimelinePointerDragState = {
        mode: "move",
        taskId,
        pointerId: event.pointerId,
        originClientY: event.clientY,
        originStartMinute: normalizedStartMinute,
        originEndMinute: normalizedEndMinute,
        previewStartMinute: normalizedStartMinute,
        previewEndMinute: normalizedEndMinute,
      }

      timelinePointerDragStateRef.current = nextState
      setTimelinePointerDragState(nextState)
      setDraggingTaskId(null)
      setDropMinute(null)
      const target = event.currentTarget as HTMLElement | null
      target?.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    },
    [props.disabled, timelineEndMinute, timelineStartMinute],
  )

  const beginTimelinePointerResize = React.useCallback(
    (
      event: PointerEvent,
      taskId: DbId,
      startMinute: number,
      endMinute: number,
      mode: "resize-start" | "resize-end",
    ) => {
      if (props.disabled) {
        return
      }

      const normalizedStartMinute = clampNumber(startMinute, timelineStartMinute, timelineEndMinute)
      const normalizedEndMinute = clampNumber(
        endMinute,
        normalizedStartMinute + MIN_DURATION_MINUTES,
        DAY_MINUTES,
      )
      if (normalizedEndMinute <= normalizedStartMinute) {
        return
      }

      const nextState: TimelinePointerDragState = {
        mode,
        taskId,
        pointerId: event.pointerId,
        originClientY: event.clientY,
        originStartMinute: normalizedStartMinute,
        originEndMinute: normalizedEndMinute,
        previewStartMinute: normalizedStartMinute,
        previewEndMinute: normalizedEndMinute,
      }

      timelinePointerDragStateRef.current = nextState
      setTimelinePointerDragState(nextState)
      setDraggingTaskId(null)
      setDropMinute(null)
      const target = event.currentTarget as HTMLElement | null
      target?.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    },
    [props.disabled, timelineEndMinute, timelineStartMinute],
  )

  const beginDragTask = React.useCallback(
    (event: DragEvent, taskId: DbId, durationMinutes: number) => {
      const transfer = event.dataTransfer
      if (transfer == null) {
        return
      }

      const payload: DragPayload = {
        taskId,
        durationMinutes: clampNumber(
          Math.round(durationMinutes),
          MIN_DURATION_MINUTES,
          MAX_DURATION_MINUTES,
        ),
      }

      transfer.setData(DRAG_DATA_TYPE, JSON.stringify(payload))
      transfer.setData("text/plain", String(taskId))
      transfer.effectAllowed = "move"
      setDraggingTaskId(taskId)
    },
    [],
  )

  const endDragTask = React.useCallback(() => {
    setDraggingTaskId(null)
    setDropMinute(null)
  }, [])

  const resolveDropMinuteFromEvent = React.useCallback(
    (event: DragEvent): number | null => {
      const timelineElement = timelineRef.current
      if (timelineElement == null) {
        return null
      }

      const rect = timelineElement.getBoundingClientRect()
      const relativeY = event.clientY - rect.top
      const clampedY = clampNumber(relativeY, 0, rect.height)
      const minuteOffset = Math.round(clampedY / PIXELS_PER_MINUTE)
      const rawMinute = timelineStartMinute + minuteOffset
      const slotMinute = floorToSlot(rawMinute)

      return clampNumber(
        slotMinute,
        timelineStartMinute,
        Math.max(timelineStartMinute, timelineEndMinute - MIN_DURATION_MINUTES),
      )
    },
    [timelineEndMinute, timelineStartMinute],
  )

  const parseDropPayload = React.useCallback((event: DragEvent): DragPayload | null => {
    const transfer = event.dataTransfer
    if (transfer == null) {
      return null
    }

    const raw = transfer.getData(DRAG_DATA_TYPE)
    if (raw.trim() === "") {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== "object" || parsed == null) {
        return null
      }

      const taskId = (parsed as { taskId?: unknown }).taskId
      const durationMinutes = (parsed as { durationMinutes?: unknown }).durationMinutes
      if (
        typeof taskId !== "number" ||
        Number.isNaN(taskId) ||
        !Number.isFinite(taskId)
      ) {
        return null
      }

      const normalizedDuration =
        typeof durationMinutes === "number" && Number.isFinite(durationMinutes)
          ? durationMinutes
          : DEFAULT_SCHEDULE_DURATION_MINUTES

      return {
        taskId,
        durationMinutes: clampNumber(
          Math.round(normalizedDuration),
          MIN_DURATION_MINUTES,
          MAX_DURATION_MINUTES,
        ),
      }
    } catch {
      return null
    }
  }, [])

  const onTimelineDragOver = React.useCallback(
    (event: DragEvent) => {
      if (props.disabled || draggingTaskId == null) {
        return
      }

      event.preventDefault()
      if (event.dataTransfer != null) {
        event.dataTransfer.dropEffect = "move"
      }

      const minute = resolveDropMinuteFromEvent(event)
      setDropMinute(minute)
    },
    [draggingTaskId, props.disabled, resolveDropMinuteFromEvent],
  )

  const onTimelineDrop = React.useCallback(
    (event: DragEvent) => {
      if (props.disabled) {
        return
      }

      event.preventDefault()
      const payload = parseDropPayload(event)
      const nextStart = resolveDropMinuteFromEvent(event)
      if (payload == null || nextStart == null) {
        setDropMinute(null)
        return
      }

      const nextEnd = Math.min(DAY_MINUTES, nextStart + payload.durationMinutes)
      if (nextEnd <= nextStart) {
        setDropMinute(null)
        return
      }

      setDropMinute(null)
      void props.onApplySchedule(payload.taskId, nextStart, nextEnd)
    },
    [parseDropPayload, props, resolveDropMinuteFromEvent],
  )

  return React.createElement(
    "div",
    {
      className: "mlo-my-day-board",
    },
    React.createElement(
      "div",
      {
        className: "mlo-my-day-board-head",
      },
      React.createElement(
        "div",
        {
          className: "mlo-my-day-board-title",
        },
        t("My Day Schedule"),
      ),
      React.createElement(
        "div",
        {
          className: "mlo-my-day-board-subtitle",
        },
        t("Drag cards into timeline to plan your day"),
      ),
    ),
    React.createElement(
      "div",
      {
        className: "mlo-my-day-board-layout",
      },
      React.createElement(
        "div",
        {
          className: "mlo-my-day-unscheduled-panel",
        },
        React.createElement(
          "div",
          {
            className: "mlo-my-day-panel-title",
          },
          `${t("Unscheduled")} · ${unscheduledItems.length}`,
        ),
        unscheduledItems.length === 0
          ? React.createElement(
              "div",
              {
                className: "mlo-my-day-empty-hint",
              },
              t("All tasks are scheduled"),
            )
          : React.createElement(
              "div",
              {
                className: "mlo-my-day-card-stack",
              },
              unscheduledItems.map((item: MyDayScheduleTaskItem, index: number) => {
                const updating = props.updatingTaskIds.has(item.blockId)
                return React.createElement(MyDayScheduleCard, {
                  key: item.blockId,
                  item,
                  rowIndex: index,
                  draggable: !props.disabled && !updating,
                  disabled: props.disabled || updating,
                  dragging: draggingTaskId === item.blockId,
                  onDragStart: (event: DragEvent) => {
                    beginDragTask(event, item.blockId, DEFAULT_SCHEDULE_DURATION_MINUTES)
                  },
                  onDragEnd: () => endDragTask(),
                  onOpenTask: props.onOpenTask,
                  onRemoveTask: props.onRemoveTask,
                  onApplySchedule: props.onApplySchedule,
                  onClearSchedule: props.onClearSchedule,
                })
              }),
            ),
      ),
      React.createElement(
        "div",
        {
          className: "mlo-my-day-timeline-panel",
        },
        React.createElement(
          "div",
          {
            className: "mlo-my-day-panel-title",
          },
          `${t("Timeline")} · ${scheduledItems.length}`,
        ),
        React.createElement(
          "div",
          {
            className: "mlo-my-day-timeline-scroll",
          },
          React.createElement(
            "div",
            {
              ref: timelineRef,
              className: "mlo-my-day-timeline",
              style: {
                height: `${timelineHeight}px`,
              },
              onDragOver: onTimelineDragOver,
              onDrop: onTimelineDrop,
              onDragLeave: () => {
                setDropMinute(null)
              },
            },
            timelineSlots.map((minute: number) => {
              const major = minute % 60 === 0
              const top = (minute - timelineStartMinute) * PIXELS_PER_MINUTE
              return React.createElement(
                "div",
                {
                  key: minute,
                  className: major
                    ? "mlo-my-day-slot mlo-my-day-slot-major"
                    : "mlo-my-day-slot",
                  style: {
                    top: `${top}px`,
                  },
                },
                major
                  ? React.createElement(
                      "div",
                      {
                        className: "mlo-my-day-slot-label",
                      },
                      minuteToTimeLabel(minute),
                    )
                  : null,
              )
            }),
            dropMinute != null
              ? React.createElement("div", {
                  className: "mlo-my-day-drop-line",
                  style: {
                    top: `${(dropMinute - timelineStartMinute) * PIXELS_PER_MINUTE}px`,
                  },
                })
              : null,
            timelineRenderItems.map((renderItem: TimelineRenderItem, index: number) => {
              const laneLayout = timelineLaneByTaskId.get(renderItem.item.blockId) ?? {
                laneIndex: 0,
                laneCount: 1,
              }
              return React.createElement(MyDayTimelineCard, {
                key: renderItem.item.blockId,
                item: renderItem.item,
                startMinute: renderItem.startMinute,
                endMinute: renderItem.endMinute,
                top: renderItem.top,
                height: renderItem.height,
                index,
                laneIndex: laneLayout.laneIndex,
                laneCount: laneLayout.laneCount,
                dragging: draggingTaskId === renderItem.item.blockId || renderItem.pointerInteracting,
                pointerDragging: renderItem.pointerInteracting,
                disabled: props.disabled || renderItem.updating,
                onPointerDown: (event: PointerEvent) => {
                  if (props.disabled || renderItem.updating) {
                    return
                  }
                  beginTimelinePointerDrag(
                    event,
                    renderItem.item.blockId,
                    renderItem.baseStartMinute,
                    renderItem.baseEndMinute,
                  )
                },
                onResizeStartPointerDown: (event: PointerEvent) => {
                  if (props.disabled || renderItem.updating) {
                    return
                  }

                  beginTimelinePointerResize(
                    event,
                    renderItem.item.blockId,
                    renderItem.baseStartMinute,
                    renderItem.baseEndMinute,
                    "resize-start",
                  )
                },
                onResizeEndPointerDown: (event: PointerEvent) => {
                  if (props.disabled || renderItem.updating) {
                    return
                  }

                  beginTimelinePointerResize(
                    event,
                    renderItem.item.blockId,
                    renderItem.baseStartMinute,
                    renderItem.baseEndMinute,
                    "resize-end",
                  )
                },
                onOpenTask: props.onOpenTask,
                onRemoveTask: props.onRemoveTask,
                onClearSchedule: props.onClearSchedule,
              })
            }),
          ),
        ),
      ),
    ),
  )
}

interface MyDayScheduleCardProps {
  item: MyDayScheduleTaskItem
  rowIndex: number
  dragging: boolean
  draggable: boolean
  disabled: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onOpenTask: (blockId: DbId) => void
  onRemoveTask: (blockId: DbId) => void | Promise<void>
  onApplySchedule: (blockId: DbId, startMinute: number, endMinute: number) => void | Promise<void>
  onClearSchedule: (blockId: DbId) => void | Promise<void>
}

function MyDayScheduleCard(props: MyDayScheduleCardProps) {
  const React = window.React

  return React.createElement(
    "div",
    {
      className: "mlo-my-day-card",
      draggable: props.draggable,
      onDragStart: props.onDragStart,
      onDragEnd: props.onDragEnd,
      style: {
        opacity: props.dragging ? 0.5 : 1,
        animationDelay: `${Math.min(props.rowIndex, 8) * 36}ms`,
      },
    },
    React.createElement(
      "button",
      {
        type: "button",
        className: "mlo-my-day-card-title",
        onClick: () => props.onOpenTask(props.item.blockId),
      },
      props.item.text,
    ),
    props.item.labels.length > 0
      ? React.createElement(
          "div",
          {
            className: "mlo-my-day-card-labels",
          },
          props.item.labels.slice(0, 3).map((label: string) =>
            React.createElement(
              "span",
              {
                key: `${props.item.blockId}-${label}`,
                className: "mlo-my-day-card-label",
              },
              label,
            )),
        )
      : null,
    React.createElement(ScheduleTimeEditor, {
      taskId: props.item.blockId,
      scheduleStartMinute: props.item.scheduleStartMinute,
      scheduleEndMinute: props.item.scheduleEndMinute,
      disabled: props.disabled,
      onApplySchedule: props.onApplySchedule,
      onClearSchedule: props.onClearSchedule,
    }),
    React.createElement(
      "div",
      {
        className: "mlo-my-day-card-actions",
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-link",
          onClick: () => props.onOpenTask(props.item.blockId),
        },
        t("Open task properties"),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-danger",
          disabled: props.disabled,
          onClick: () => {
            void props.onRemoveTask(props.item.blockId)
          },
        },
        t("Remove from My Day"),
      ),
    ),
  )
}

interface MyDayTimelineCardProps {
  item: MyDayScheduleTaskItem
  startMinute: number
  endMinute: number
  top: number
  height: number
  index: number
  laneIndex: number
  laneCount: number
  dragging: boolean
  pointerDragging: boolean
  disabled: boolean
  onPointerDown: (event: PointerEvent) => void
  onResizeStartPointerDown: (event: PointerEvent) => void
  onResizeEndPointerDown: (event: PointerEvent) => void
  onOpenTask: (blockId: DbId) => void
  onRemoveTask: (blockId: DbId) => void | Promise<void>
  onClearSchedule: (blockId: DbId) => void | Promise<void>
}

function MyDayTimelineCard(props: MyDayTimelineCardProps) {
  const React = window.React
  const startMinute = props.startMinute
  const endMinute = props.endMinute
  const laneCount = Math.max(1, props.laneCount)
  const laneIndex = clampNumber(props.laneIndex, 0, laneCount - 1)
  const laneGapPx = laneCount > 1 ? TIMELINE_LANE_GAP_PX : 0

  return React.createElement(
    "div",
    {
      className: "mlo-my-day-timeline-card",
      draggable: false,
      onPointerDown: props.onPointerDown,
      style: {
        top: `${props.top}px`,
        height: `${props.height}px`,
        opacity: props.dragging ? 0.5 : 1,
        cursor: props.pointerDragging ? "grabbing" : "grab",
        zIndex: props.pointerDragging ? 12 : 5 + laneIndex,
        transition: props.pointerDragging ? "none" : undefined,
        animationDelay: `${Math.min(props.index, 8) * 28}ms`,
        "--mlo-timeline-lane-index": laneIndex,
        "--mlo-timeline-lane-count": laneCount,
        "--mlo-timeline-lane-gap": `${laneGapPx}px`,
      },
    },
    React.createElement("div", {
      className: "mlo-my-day-timeline-resize-handle mlo-my-day-timeline-resize-handle-start",
      onPointerDown: (event: PointerEvent) => {
        props.onResizeStartPointerDown(event)
      },
    }),
    React.createElement(
      "div",
      {
        className: "mlo-my-day-timeline-card-head",
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-timeline-title",
          onClick: () => props.onOpenTask(props.item.blockId),
        },
        props.item.text,
      ),
      React.createElement(
        "span",
        {
          className: "mlo-my-day-time-pill",
        },
        `${minuteToTimeLabel(startMinute)} - ${minuteToTimeLabel(endMinute)}`,
      ),
    ),
    props.item.labels.length > 0
      ? React.createElement(
          "div",
          {
            className: "mlo-my-day-timeline-meta",
          },
          props.item.labels.slice(0, 2).map((label: string) =>
            React.createElement(
              "span",
              {
                key: `${props.item.blockId}-${label}`,
                className: "mlo-my-day-timeline-chip",
              },
              label,
            )),
          props.item.star
            ? React.createElement(
                "span",
                {
                  className: "mlo-my-day-timeline-star",
                },
                "★",
              )
            : null,
        )
      : props.item.star
        ? React.createElement(
            "div",
            {
              className: "mlo-my-day-timeline-meta",
            },
            React.createElement(
              "span",
              {
                className: "mlo-my-day-timeline-star",
              },
              "★",
            ),
          )
        : null,
    React.createElement(
      "div",
      {
        className: "mlo-my-day-timeline-actions",
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-link",
          onClick: () => props.onOpenTask(props.item.blockId),
        },
        t("Open"),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-link",
          disabled: props.disabled,
          onClick: () => {
            void props.onClearSchedule(props.item.blockId)
          },
        },
        t("Clear time"),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-danger",
          disabled: props.disabled,
          onClick: () => {
            void props.onRemoveTask(props.item.blockId)
          },
        },
        t("Remove"),
      ),
    ),
    React.createElement("div", {
      className: "mlo-my-day-timeline-resize-handle mlo-my-day-timeline-resize-handle-end",
      onPointerDown: (event: PointerEvent) => {
        props.onResizeEndPointerDown(event)
      },
    }),
  )
}

interface ScheduleTimeEditorProps {
  taskId: DbId
  scheduleStartMinute: number | null
  scheduleEndMinute: number | null
  disabled: boolean
  onApplySchedule: (taskId: DbId, startMinute: number, endMinute: number) => void | Promise<void>
  onClearSchedule: (taskId: DbId) => void | Promise<void>
}

function ScheduleTimeEditor(props: ScheduleTimeEditorProps) {
  const React = window.React
  const [startText, setStartText] = React.useState(() => minuteToInputTime(props.scheduleStartMinute))
  const [endText, setEndText] = React.useState(() => minuteToInputTime(props.scheduleEndMinute))

  React.useEffect(() => {
    setStartText(minuteToInputTime(props.scheduleStartMinute))
    setEndText(minuteToInputTime(props.scheduleEndMinute))
  }, [props.scheduleEndMinute, props.scheduleStartMinute])

  const parsedStart = parseInputTime(startText)
  const parsedEnd = parseInputTime(endText)
  const canApply = parsedStart != null && parsedEnd != null && parsedEnd > parsedStart

  return React.createElement(
    "div",
    {
      className: "mlo-my-day-time-editor",
    },
    React.createElement(
      "label",
      {
        className: "mlo-my-day-time-field",
      },
      React.createElement(
        "span",
        null,
        t("Start"),
      ),
      React.createElement("input", {
        type: "time",
        value: startText,
        disabled: props.disabled,
        step: 300,
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement | null
          setStartText(target?.value ?? "")
        },
      }),
    ),
    React.createElement(
      "label",
      {
        className: "mlo-my-day-time-field",
      },
      React.createElement(
        "span",
        null,
        t("End"),
      ),
      React.createElement("input", {
        type: "time",
        value: endText,
        disabled: props.disabled,
        step: 300,
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement | null
          setEndText(target?.value ?? "")
        },
      }),
    ),
    React.createElement(
      "div",
      {
        className: "mlo-my-day-time-buttons",
      },
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-link",
          disabled: props.disabled || !canApply,
          onClick: () => {
            if (parsedStart == null || parsedEnd == null || parsedEnd <= parsedStart) {
              return
            }
            void props.onApplySchedule(props.taskId, parsedStart, parsedEnd)
          },
        },
        t("Apply"),
      ),
      React.createElement(
        "button",
        {
          type: "button",
          className: "mlo-my-day-action-link",
          disabled: props.disabled,
          onClick: () => {
            void props.onClearSchedule(props.taskId)
          },
        },
        t("Clear time"),
      ),
    ),
  )
}

function isPointerDragIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.closest("button, input, select, textarea, a, [contenteditable='true']") != null
}

function resolvePointerInteractionPreviewMinutes(
  dragState: TimelinePointerDragState,
  pointerClientY: number,
  timelineStartMinute: number,
  timelineEndMinute: number,
): {
  startMinute: number
  endMinute: number
} | null {
  const minuteOffset = (pointerClientY - dragState.originClientY) / PIXELS_PER_MINUTE
  const snappedOffset =
    Math.round(minuteOffset / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES

  let nextStartMinute = dragState.originStartMinute
  let nextEndMinute = dragState.originEndMinute

  if (dragState.mode === "move") {
    const duration = dragState.originEndMinute - dragState.originStartMinute
    if (duration <= 0) {
      return null
    }

    const maxStartMinute = Math.max(timelineStartMinute, timelineEndMinute - duration)
    nextStartMinute = clampNumber(
      dragState.originStartMinute + snappedOffset,
      timelineStartMinute,
      maxStartMinute,
    )
    nextEndMinute = Math.min(DAY_MINUTES, nextStartMinute + duration)
  } else if (dragState.mode === "resize-start") {
    const maxStartMinute = dragState.originEndMinute - MIN_DURATION_MINUTES
    nextStartMinute = clampNumber(
      dragState.originStartMinute + snappedOffset,
      timelineStartMinute,
      maxStartMinute,
    )
    nextEndMinute = dragState.originEndMinute
  } else {
    const minEndMinute = dragState.originStartMinute + MIN_DURATION_MINUTES
    nextStartMinute = dragState.originStartMinute
    nextEndMinute = clampNumber(
      dragState.originEndMinute + snappedOffset,
      minEndMinute,
      Math.min(DAY_MINUTES, timelineEndMinute),
    )
  }

  if (nextEndMinute <= nextStartMinute) {
    return null
  }

  return {
    startMinute: nextStartMinute,
    endMinute: nextEndMinute,
  }
}

function computeTimelineLaneLayouts(
  items: Array<{
    blockId: DbId
    startMinute: number
    endMinute: number
  }>,
): Map<DbId, TimelineLaneLayout> {
  const sortedItems = items
    .filter((item) => item.endMinute > item.startMinute)
    .slice()
    .sort((left, right) => {
      if (left.startMinute !== right.startMinute) {
        return left.startMinute - right.startMinute
      }
      if (left.endMinute !== right.endMinute) {
        return left.endMinute - right.endMinute
      }
      return left.blockId - right.blockId
    })

  const result = new Map<DbId, TimelineLaneLayout>()
  if (sortedItems.length === 0) {
    return result
  }

  let cluster: typeof sortedItems = []
  let clusterMaxEndMinute = -1

  const flushCluster = () => {
    if (cluster.length === 0) {
      return
    }

    const laneEnds: number[] = []
    const laneByTaskId = new Map<DbId, number>()

    for (const item of cluster) {
      let laneIndex = -1
      for (let index = 0; index < laneEnds.length; index += 1) {
        if (laneEnds[index] <= item.startMinute) {
          laneIndex = index
          break
        }
      }

      if (laneIndex < 0) {
        laneIndex = laneEnds.length
        laneEnds.push(item.endMinute)
      } else {
        laneEnds[laneIndex] = item.endMinute
      }

      laneByTaskId.set(item.blockId, laneIndex)
    }

    const laneCount = Math.max(1, laneEnds.length)
    for (const item of cluster) {
      const laneIndex = laneByTaskId.get(item.blockId) ?? 0
      result.set(item.blockId, {
        laneIndex,
        laneCount,
      })
    }

    cluster = []
    clusterMaxEndMinute = -1
  }

  for (const item of sortedItems) {
    if (cluster.length === 0) {
      cluster.push(item)
      clusterMaxEndMinute = item.endMinute
      continue
    }

    if (item.startMinute < clusterMaxEndMinute) {
      cluster.push(item)
      clusterMaxEndMinute = Math.max(clusterMaxEndMinute, item.endMinute)
      continue
    }

    flushCluster()
    cluster.push(item)
    clusterMaxEndMinute = item.endMinute
  }

  flushCluster()
  return result
}

function isScheduledTaskItem(item: MyDayScheduleTaskItem): boolean {
  if (typeof item.scheduleStartMinute !== "number" || typeof item.scheduleEndMinute !== "number") {
    return false
  }

  if (Number.isNaN(item.scheduleStartMinute) || Number.isNaN(item.scheduleEndMinute)) {
    return false
  }

  return item.scheduleEndMinute > item.scheduleStartMinute
}

function floorToSlot(minute: number): number {
  return Math.floor(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES
}

function ceilToSlot(minute: number): number {
  return Math.ceil(minute / TIMELINE_SLOT_MINUTES) * TIMELINE_SLOT_MINUTES
}

function minuteToTimeLabel(minute: number): string {
  const safeMinute = clampNumber(Math.round(minute), 0, DAY_MINUTES)
  const hour = Math.floor(safeMinute / 60)
  const minutePart = safeMinute % 60
  return `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`
}

function minuteToInputTime(minute: number | null): string {
  if (minute == null) {
    return ""
  }

  return minuteToTimeLabel(minute)
}

function parseInputTime(value: string): number | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null
  }

  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (match == null) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null
  }

  return hour * 60 + minute
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value))
}

function ensureMyDayScheduleStyles() {
  const styleId = "mlo-my-day-schedule-style"
  if (document.getElementById(styleId) != null) {
    return
  }

  const styleEl = document.createElement("style")
  styleEl.id = styleId
  styleEl.textContent = `
@keyframes mloMyDayCardIn {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.mlo-my-day-board {
  --mlo-myday-ink: #1f2937;
  --mlo-myday-muted: #556278;
  --mlo-myday-card-bg: linear-gradient(148deg, rgba(255, 255, 255, 0.9), rgba(247, 250, 255, 0.82));
  --mlo-myday-card-border: rgba(16, 44, 84, 0.16);
  --mlo-myday-accent: #0b5fff;
  --mlo-myday-accent-soft: rgba(11, 95, 255, 0.13);
  --mlo-myday-danger: #b42318;
  --mlo-myday-danger-soft: rgba(180, 35, 24, 0.12);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(16, 44, 84, 0.16);
  background:
    radial-gradient(circle at 0% 0%, rgba(11, 95, 255, 0.14), transparent 42%),
    radial-gradient(circle at 100% 100%, rgba(247, 37, 133, 0.12), transparent 40%),
    linear-gradient(162deg, rgba(247, 251, 255, 0.96), rgba(238, 245, 255, 0.9));
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.14);
  overflow: hidden;
}

.mlo-my-day-board-head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-bottom: 1px solid rgba(16, 44, 84, 0.12);
  padding-bottom: 9px;
}

.mlo-my-day-board-title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--mlo-myday-ink);
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-board-subtitle {
  font-size: 12px;
  color: var(--mlo-myday-muted);
  letter-spacing: 0.02em;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-board-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
  gap: 10px;
}

.mlo-my-day-unscheduled-panel,
.mlo-my-day-timeline-panel {
  min-height: 0;
  border-radius: 12px;
  border: 1px solid rgba(16, 44, 84, 0.13);
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.68), rgba(244, 248, 255, 0.6));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mlo-my-day-panel-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #21425d;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-empty-hint {
  font-size: 12px;
  color: var(--mlo-myday-muted);
  background: rgba(11, 95, 255, 0.08);
  border: 1px dashed rgba(11, 95, 255, 0.22);
  border-radius: 9px;
  padding: 8px 9px;
}

.mlo-my-day-card-stack {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.mlo-my-day-card {
  border-radius: 10px;
  border: 1px solid rgba(16, 44, 84, 0.18);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
  padding: 10px 10px 9px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: mloMyDayCardIn 280ms cubic-bezier(.2,.8,.2,1) backwards;
  cursor: grab;
  transition: box-shadow 120ms ease, border-color 120ms ease;
}

.mlo-my-day-card:hover {
  border-color: rgba(11, 95, 255, 0.28);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
}

.mlo-my-day-card:active {
  cursor: grabbing;
}

.mlo-my-day-card-title,
.mlo-my-day-timeline-title {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--mlo-myday-ink);
  text-align: left;
  cursor: pointer;
  font-size: 12.8px;
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: 0.01em;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mlo-my-day-card-labels {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.mlo-my-day-card-label {
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(11, 95, 255, 0.18);
  background: rgba(11, 95, 255, 0.08);
  color: #26538f;
  font-size: 10px;
  white-space: nowrap;
  max-width: 95px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mlo-my-day-time-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.mlo-my-day-time-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  color: #334155;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mlo-my-day-time-field input {
  height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(16, 44, 84, 0.22);
  background: rgba(255, 255, 255, 0.84);
  padding: 0 6px;
  color: #0f172a;
  font-size: 11px;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-time-buttons {
  grid-column: span 2;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mlo-my-day-card-actions,
.mlo-my-day-timeline-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.mlo-my-day-action-link,
.mlo-my-day-action-danger {
  border: 1px solid rgba(16, 44, 84, 0.18);
  background: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  line-height: 1.4;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.mlo-my-day-action-link {
  color: #1a4d95;
}

.mlo-my-day-action-link:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mlo-my-day-action-danger {
  color: var(--mlo-myday-danger);
}

.mlo-my-day-action-link:hover:not(:disabled),
.mlo-my-day-action-danger:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(11, 95, 255, 0.24);
}

.mlo-my-day-action-danger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mlo-my-day-timeline-scroll {
  flex: 1;
  min-height: 220px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid rgba(16, 44, 84, 0.14);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(244, 248, 255, 0.84));
}

.mlo-my-day-timeline {
  position: relative;
  min-height: 220px;
  padding-left: 66px;
  overflow: hidden;
}

.mlo-my-day-slot {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed rgba(16, 44, 84, 0.12);
}

.mlo-my-day-slot-major {
  border-top-style: solid;
  border-top-color: rgba(16, 44, 84, 0.24);
}

.mlo-my-day-slot-label {
  position: absolute;
  left: 8px;
  top: -9px;
  width: 48px;
  text-align: right;
  font-size: 10px;
  color: #4c5f78;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-drop-line {
  position: absolute;
  left: 56px;
  right: 10px;
  height: 0;
  border-top: 2px solid var(--mlo-myday-accent);
  box-shadow: 0 0 0 4px var(--mlo-myday-accent-soft);
  z-index: 6;
}

.mlo-my-day-timeline-card {
  --mlo-timeline-track-left: 70px;
  --mlo-timeline-track-right: 10px;
  --mlo-timeline-lane-count: 1;
  --mlo-timeline-lane-index: 0;
  --mlo-timeline-lane-gap: 0px;
  --mlo-timeline-track-width: calc(100% - var(--mlo-timeline-track-left) - var(--mlo-timeline-track-right));
  --mlo-timeline-gap-total: calc((var(--mlo-timeline-lane-count) - 1) * var(--mlo-timeline-lane-gap));
  --mlo-timeline-column-width: calc((var(--mlo-timeline-track-width) - var(--mlo-timeline-gap-total)) / var(--mlo-timeline-lane-count));
  position: absolute;
  left: calc(var(--mlo-timeline-track-left) + (var(--mlo-timeline-lane-index) * (var(--mlo-timeline-column-width) + var(--mlo-timeline-lane-gap))));
  width: var(--mlo-timeline-column-width);
  border-radius: 12px;
  border: 1px solid rgba(16, 44, 84, 0.22);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.1);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  animation: mloMyDayCardIn 260ms cubic-bezier(.2,.8,.2,1) backwards;
  cursor: grab;
  z-index: 5;
  user-select: none;
  touch-action: none;
  overflow: visible;
  transition: box-shadow 120ms ease, border-color 120ms ease;
}

.mlo-my-day-timeline-card:active {
  cursor: grabbing;
}

.mlo-my-day-timeline-card:hover {
  border-color: rgba(11, 95, 255, 0.32);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
}

.mlo-my-day-timeline-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mlo-my-day-timeline-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mlo-my-day-timeline-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.mlo-my-day-timeline-chip {
  display: inline-flex;
  align-items: center;
  height: 17px;
  border-radius: 999px;
  border: 1px solid rgba(11, 95, 255, 0.2);
  background: rgba(11, 95, 255, 0.08);
  color: #2c568f;
  font-size: 10px;
  padding: 0 6px;
  max-width: 108px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlo-my-day-timeline-star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 17px;
  min-width: 17px;
  border-radius: 999px;
  border: 1px solid rgba(212, 162, 18, 0.28);
  background: rgba(212, 162, 18, 0.1);
  color: #9a6b00;
  font-size: 10px;
}

.mlo-my-day-timeline-resize-handle {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 10px;
  border-radius: 8px;
  cursor: ns-resize;
  z-index: 9;
}

.mlo-my-day-timeline-resize-handle::before {
  content: none;
}

.mlo-my-day-timeline-resize-handle-start {
  top: 0;
}

.mlo-my-day-timeline-resize-handle-end {
  bottom: 0;
}

.mlo-my-day-time-pill {
  flex-shrink: 0;
  height: 19px;
  border-radius: 999px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(11, 95, 255, 0.34);
  color: #134282;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

@media (max-width: 980px) {
  .mlo-my-day-board {
    overflow: auto;
  }

  .mlo-my-day-board-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(190px, auto) minmax(340px, 1fr);
    align-content: start;
  }

  .mlo-my-day-timeline-panel {
    min-height: 360px;
  }

  .mlo-my-day-timeline-scroll {
    min-height: 320px;
  }

  .mlo-my-day-timeline {
    min-height: 320px;
    padding-left: 58px;
  }

  .mlo-my-day-slot-label {
    left: 6px;
    width: 40px;
  }

  .mlo-my-day-timeline-card {
    --mlo-timeline-track-left: 62px;
    --mlo-timeline-track-right: 8px;
    --mlo-timeline-lane-gap: 6px;
  }

  .mlo-my-day-drop-line {
    left: 50px;
  }
}
`

  document.head.appendChild(styleEl)
}
