import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

const DAY_MINUTES = 24 * 60
const TIMELINE_SLOT_MINUTES = 30
const DRAG_SNAP_MINUTES = 15
const DEFAULT_SCHEDULE_DURATION_MINUTES = 60
const MIN_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 12 * 60
const DEFAULT_TIMELINE_START_MINUTE = 0
const DEFAULT_TIMELINE_END_MINUTE = DAY_MINUTES
const PIXELS_PER_MINUTE = 1.04
const TIMELINE_AUTO_SCROLL_EDGE_PX = 52
const TIMELINE_AUTO_SCROLL_MAX_STEP_PX = 22
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
  dayStartHour: number
  disabled: boolean
  updatingTaskIds: Set<DbId>
  onOpenTask: (blockId: DbId) => void
  onNavigateTask: (blockId: DbId) => void | Promise<void>
  onToggleTaskStar: (blockId: DbId) => void | Promise<void>
  onAddSubtask: (blockId: DbId) => void | Promise<void>
  onDeleteTaskTag: (blockId: DbId) => void | Promise<void>
  onDeleteTaskBlock: (blockId: DbId) => void | Promise<void>
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
  dropToUnscheduled: boolean
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
  const timelineScrollRef = React.useRef<HTMLDivElement | null>(null)
  const unscheduledPanelRef = React.useRef<HTMLDivElement | null>(null)
  const [draggingTaskId, setDraggingTaskId] = React.useState<DbId | null>(null)
  const [dropMinute, setDropMinute] = React.useState<number | null>(null)
  const [timelinePointerDragState, setTimelinePointerDragState] =
    React.useState<TimelinePointerDragState | null>(null)
  const timelinePointerDragStateRef = React.useRef<TimelinePointerDragState | null>(null)
  const timelineDragOverClientYRef = React.useRef<number | null>(null)
  const timelineBoundsRef = React.useRef<{
    startMinute: number
    endMinute: number
  }>({
    startMinute: DEFAULT_TIMELINE_START_MINUTE,
    endMinute: DEFAULT_TIMELINE_END_MINUTE,
  })
  const disabledRef = React.useRef(props.disabled)
  const onApplyScheduleRef = React.useRef(props.onApplySchedule)
  const onClearScheduleRef = React.useRef(props.onClearSchedule)
  const timelineStartHour = normalizeTimelineStartHour(props.dayStartHour)
  const timelineStartOffsetMinute = timelineStartHour * 60
  const timelinePointerDropToUnscheduled =
    timelinePointerDragState?.mode === "move" && timelinePointerDragState.dropToUnscheduled

  const maybeAutoScrollTimeline = React.useCallback((pointerClientY: number) => {
    const scrollElement = timelineScrollRef.current
    if (scrollElement == null) {
      return
    }

    const rect = scrollElement.getBoundingClientRect()
    const threshold = Math.max(
      1,
      Math.min(TIMELINE_AUTO_SCROLL_EDGE_PX, Math.floor(rect.height / 2)),
    )

    if (pointerClientY < rect.top + threshold) {
      const distance = rect.top + threshold - pointerClientY
      const ratio = clampNumber(distance / threshold, 0, 1)
      const delta = Math.max(4, Math.round(ratio * TIMELINE_AUTO_SCROLL_MAX_STEP_PX))
      scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop - delta)
      return
    }

    if (pointerClientY > rect.bottom - threshold) {
      const distance = pointerClientY - (rect.bottom - threshold)
      const ratio = clampNumber(distance / threshold, 0, 1)
      const delta = Math.max(4, Math.round(ratio * TIMELINE_AUTO_SCROLL_MAX_STEP_PX))
      const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      scrollElement.scrollTop = Math.min(maxScrollTop, scrollElement.scrollTop + delta)
    }
  }, [])

  React.useEffect(() => {
    ensureMyDayScheduleStyles()
  }, [])

  const scheduledItems = React.useMemo((): MyDayScheduleTaskItem[] => {
    return props.items
      .filter(isScheduledTaskItem)
      .slice()
      .sort((left, right) => {
        const leftStart = scheduleMinuteToTimelineMinute(
          left.scheduleStartMinute ?? 0,
          timelineStartOffsetMinute,
        )
        const rightStart = scheduleMinuteToTimelineMinute(
          right.scheduleStartMinute ?? 0,
          timelineStartOffsetMinute,
        )
        if (leftStart !== rightStart) {
          return leftStart - rightStart
        }

        const leftDuration =
          resolveScheduleDurationMinutes(
            left.scheduleStartMinute ?? 0,
            left.scheduleEndMinute ?? (left.scheduleStartMinute ?? 0) + DEFAULT_SCHEDULE_DURATION_MINUTES,
          ) ?? DEFAULT_SCHEDULE_DURATION_MINUTES
        const rightDuration =
          resolveScheduleDurationMinutes(
            right.scheduleStartMinute ?? 0,
            right.scheduleEndMinute ?? (right.scheduleStartMinute ?? 0) + DEFAULT_SCHEDULE_DURATION_MINUTES,
          ) ?? DEFAULT_SCHEDULE_DURATION_MINUTES
        const leftEnd = leftStart + leftDuration
        const rightEnd = rightStart + rightDuration
        if (leftEnd !== rightEnd) {
          return leftEnd - rightEnd
        }

        return left.blockId - right.blockId
      })
  }, [props.items, timelineStartOffsetMinute])

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

  const timelineStartMinute = DEFAULT_TIMELINE_START_MINUTE
  const timelineEndMinute = DEFAULT_TIMELINE_END_MINUTE

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
      const scheduleStartMinute = clampNumber(item.scheduleStartMinute ?? 0, 0, DAY_MINUTES)
      const fallbackEndMinute = normalizeScheduleEndMinute(
        scheduleStartMinute,
        DEFAULT_SCHEDULE_DURATION_MINUTES,
      )
      const scheduleEndMinute = clampNumber(
        item.scheduleEndMinute ?? fallbackEndMinute,
        0,
        DAY_MINUTES,
      )
      const normalizedDuration =
        resolveScheduleDurationMinutes(scheduleStartMinute, scheduleEndMinute) ??
        DEFAULT_SCHEDULE_DURATION_MINUTES
      const normalizedScheduleEndMinute = normalizeScheduleEndMinute(
        scheduleStartMinute,
        normalizedDuration,
      )
      const baseStartMinute = scheduleMinuteToTimelineMinute(
        scheduleStartMinute,
        timelineStartOffsetMinute,
      )
      const baseEndMinute = Math.min(
        timelineEndMinute,
        baseStartMinute + (resolveScheduleDurationMinutes(
          scheduleStartMinute,
          normalizedScheduleEndMinute,
        ) ?? normalizedDuration),
      )
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
    timelineEndMinute,
    timelineStartOffsetMinute,
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
    onClearScheduleRef.current = props.onClearSchedule
  }, [props.onClearSchedule])

  React.useEffect(() => {
    timelinePointerDragStateRef.current = timelinePointerDragState
  }, [timelinePointerDragState])

  const isPointerOverUnscheduledPanel = React.useCallback((clientX: number, clientY: number) => {
    const panelElement = unscheduledPanelRef.current
    if (panelElement == null) {
      return false
    }

    const rect = panelElement.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  }, [])

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

      if (dragging.mode === "move" && dragging.dropToUnscheduled) {
        void onClearScheduleRef.current(dragging.taskId)
        return
      }

      if (
        dragging.previewStartMinute === dragging.originStartMinute &&
        dragging.previewEndMinute === dragging.originEndMinute
      ) {
        return
      }

      const scheduleRange = resolveScheduleRangeFromTimelineRange(
        dragging.previewStartMinute,
        dragging.previewEndMinute,
        timelineStartOffsetMinute,
      )
      if (scheduleRange == null) {
        return
      }

      void onApplyScheduleRef.current(
        dragging.taskId,
        scheduleRange.startMinute,
        scheduleRange.endMinute,
      )
    }

    const onPointerMove = (event: PointerEvent) => {
      const dragging = timelinePointerDragStateRef.current
      if (dragging == null || event.pointerId !== dragging.pointerId) {
        return
      }

      event.preventDefault()
      const dropToUnscheduled =
        dragging.mode === "move" && isPointerOverUnscheduledPanel(event.clientX, event.clientY)

      if (!dropToUnscheduled) {
        maybeAutoScrollTimeline(event.clientY)
      }

      const preview = dropToUnscheduled
        ? {
            startMinute: dragging.previewStartMinute,
            endMinute: dragging.previewEndMinute,
          }
        : resolvePointerInteractionPreviewMinutes(
            dragging,
            event.clientY,
            timelineBoundsRef.current.startMinute,
            timelineBoundsRef.current.endMinute,
            timelineStartOffsetMinute,
          )
      if (preview == null) {
        return
      }

      const previewUnchanged =
        preview.startMinute === dragging.previewStartMinute &&
        preview.endMinute === dragging.previewEndMinute
      if (previewUnchanged && dropToUnscheduled === dragging.dropToUnscheduled) {
        return
      }

      const nextState: TimelinePointerDragState = {
        ...dragging,
        previewStartMinute: preview.startMinute,
        previewEndMinute: preview.endMinute,
        dropToUnscheduled,
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
  }, [isPointerOverUnscheduledPanel, maybeAutoScrollTimeline, timelineStartOffsetMinute])

  const beginTimelinePointerDrag = React.useCallback(
    (
      event: PointerEvent,
      taskId: DbId,
      startMinute: number,
      endMinute: number,
    ) => {
      if (props.disabled || event.button !== 0 || isPointerDragIgnoredTarget(event.target)) {
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
        dropToUnscheduled: false,
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
      if (props.disabled || event.button !== 0) {
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
        dropToUnscheduled: false,
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
    timelineDragOverClientYRef.current = null
    setDraggingTaskId(null)
    setDropMinute(null)
  }, [])

  const resolveDropMinuteFromEvent = React.useCallback(
    (
      event: DragEvent,
      durationMinutes: number,
      preferredDirection: -1 | 0 | 1 = 0,
    ): number | null => {
      const timelineElement = timelineRef.current
      if (timelineElement == null) {
        return null
      }

      const rect = timelineElement.getBoundingClientRect()
      const relativeY = event.clientY - rect.top
      const clampedY = clampNumber(relativeY, 0, rect.height)
      const minuteOffset = clampedY / PIXELS_PER_MINUTE
      const rawMinute = timelineStartMinute + minuteOffset
      const slotMinute = roundToSlot(rawMinute, DRAG_SNAP_MINUTES)
      const safeDuration = Number.isFinite(durationMinutes)
        ? durationMinutes
        : DEFAULT_SCHEDULE_DURATION_MINUTES
      const normalizedDuration = clampNumber(
        Math.round(safeDuration),
        MIN_DURATION_MINUTES,
        MAX_DURATION_MINUTES,
      )

      const maxStartMinute = Math.max(
        timelineStartMinute,
        timelineEndMinute - normalizedDuration,
      )

      const clampedMinute = clampNumber(slotMinute, timelineStartMinute, maxStartMinute)
      return resolveNearestValidTimelineStartMinute(
        clampedMinute,
        normalizedDuration,
        timelineStartMinute,
        timelineEndMinute,
        timelineStartOffsetMinute,
        preferredDirection,
      )
    },
    [timelineEndMinute, timelineStartMinute, timelineStartOffsetMinute],
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

      maybeAutoScrollTimeline(event.clientY)
      const payload = parseDropPayload(event)
      const durationMinutes = payload?.durationMinutes ?? DEFAULT_SCHEDULE_DURATION_MINUTES
      const lastClientY = timelineDragOverClientYRef.current
      const preferredDirection: -1 | 0 | 1 = lastClientY == null
        ? 0
        : event.clientY > lastClientY
          ? 1
          : event.clientY < lastClientY
            ? -1
            : 0
      timelineDragOverClientYRef.current = event.clientY
      const minute = resolveDropMinuteFromEvent(event, durationMinutes, preferredDirection)
      setDropMinute(minute)
    },
    [
      draggingTaskId,
      maybeAutoScrollTimeline,
      parseDropPayload,
      props.disabled,
      resolveDropMinuteFromEvent,
    ],
  )

  const onTimelineDrop = React.useCallback(
    (event: DragEvent) => {
      if (props.disabled) {
        return
      }

      event.preventDefault()
      timelineDragOverClientYRef.current = null
      const payload = parseDropPayload(event)
      if (payload == null) {
        setDropMinute(null)
        return
      }

      const nextStart = resolveDropMinuteFromEvent(event, payload.durationMinutes)
      if (nextStart == null) {
        setDropMinute(null)
        return
      }

      const nextEnd = nextStart + payload.durationMinutes
      const scheduleRange = resolveScheduleRangeFromTimelineRange(
        nextStart,
        nextEnd,
        timelineStartOffsetMinute,
      )
      if (scheduleRange == null) {
        setDropMinute(null)
        return
      }

      setDropMinute(null)
      void props.onApplySchedule(
        payload.taskId,
        scheduleRange.startMinute,
        scheduleRange.endMinute,
      )
    },
    [parseDropPayload, props, resolveDropMinuteFromEvent, timelineStartOffsetMinute],
  )

  const onTimelineDragLeave = React.useCallback((event: DragEvent) => {
    const target = event.currentTarget as HTMLElement | null
    if (target != null) {
      const rect = target.getBoundingClientRect()
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return
      }
    }

    timelineDragOverClientYRef.current = null
    setDropMinute(null)
  }, [])

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
          ref: unscheduledPanelRef,
          className: timelinePointerDropToUnscheduled
            ? "mlo-my-day-unscheduled-panel mlo-my-day-unscheduled-panel-drop-target"
            : "mlo-my-day-unscheduled-panel",
        },
        React.createElement(
          "div",
          {
            className: "mlo-my-day-panel-title",
          },
          `${t("Unscheduled")} · ${unscheduledItems.length}`,
        ),
        timelinePointerDropToUnscheduled
          ? React.createElement(
              "div",
              {
                className: "mlo-my-day-unscheduled-drop-cta",
              },
              t("Release to move to Unscheduled"),
            )
          : null,
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
                  onNavigateTask: props.onNavigateTask,
                  onToggleTaskStar: props.onToggleTaskStar,
                  onAddSubtask: props.onAddSubtask,
                  onDeleteTaskTag: props.onDeleteTaskTag,
                  onDeleteTaskBlock: props.onDeleteTaskBlock,
                  onRemoveTask: props.onRemoveTask,
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
            ref: timelineScrollRef,
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
              onDragLeave: onTimelineDragLeave,
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
                      minuteToTimeLabel(
                        timelineMinuteToLabelMinute(minute, timelineStartOffsetMinute),
                      ),
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
                timelineStartOffsetMinute,
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
                onNavigateTask: props.onNavigateTask,
                onToggleTaskStar: props.onToggleTaskStar,
                onAddSubtask: props.onAddSubtask,
                onDeleteTaskTag: props.onDeleteTaskTag,
                onDeleteTaskBlock: props.onDeleteTaskBlock,
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
  onNavigateTask: (blockId: DbId) => void | Promise<void>
  onToggleTaskStar: (blockId: DbId) => void | Promise<void>
  onAddSubtask: (blockId: DbId) => void | Promise<void>
  onDeleteTaskTag: (blockId: DbId) => void | Promise<void>
  onDeleteTaskBlock: (blockId: DbId) => void | Promise<void>
  onRemoveTask: (blockId: DbId) => void | Promise<void>
}

function MyDayScheduleCard(props: MyDayScheduleCardProps) {
  const React = window.React
  const [contextMenuVisible, setContextMenuVisible] = React.useState(false)
  const [contextMenuRect, setContextMenuRect] = React.useState<DOMRect | null>(null)
  const contextMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (contextMenuContainerRef.current == null) {
    contextMenuContainerRef.current = document.body
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      {
        className: `mlo-my-day-card${props.item.star ? " mlo-my-day-card-starred" : ""}${props.disabled ? " mlo-my-day-card-disabled" : ""}`,
        draggable: props.draggable,
        onDragStart: props.onDragStart,
        onDragEnd: props.onDragEnd,
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
        style: {
          opacity: props.dragging ? 0.5 : 1,
          animationDelay: `${Math.min(props.rowIndex, 8) * 36}ms`,
          "--mlo-myday-card-hue": computeCardHue(props.item.blockId, props.item.star),
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
      React.createElement(
        "div",
        {
          className: "mlo-my-day-card-foot",
        },
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
    ),
    React.createElement(MyDayTaskContextMenu, {
      blockId: props.item.blockId,
      starred: props.item.star,
      disabled: props.disabled,
      visible: contextMenuVisible,
      rect: contextMenuRect,
      containerRef: contextMenuContainerRef,
      showClearScheduleAction: false,
      onClose: () => setContextMenuVisible(false),
      onClosed: () => setContextMenuRect(null),
      onOpenTask: props.onOpenTask,
      onNavigateTask: props.onNavigateTask,
      onToggleTaskStar: props.onToggleTaskStar,
      onAddSubtask: props.onAddSubtask,
      onRemoveTask: props.onRemoveTask,
      onDeleteTaskTag: props.onDeleteTaskTag,
      onDeleteTaskBlock: props.onDeleteTaskBlock,
      onClearSchedule: undefined,
    }),
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
  timelineStartOffsetMinute: number
  dragging: boolean
  pointerDragging: boolean
  disabled: boolean
  onPointerDown: (event: PointerEvent) => void
  onResizeStartPointerDown: (event: PointerEvent) => void
  onResizeEndPointerDown: (event: PointerEvent) => void
  onOpenTask: (blockId: DbId) => void
  onNavigateTask: (blockId: DbId) => void | Promise<void>
  onToggleTaskStar: (blockId: DbId) => void | Promise<void>
  onAddSubtask: (blockId: DbId) => void | Promise<void>
  onDeleteTaskTag: (blockId: DbId) => void | Promise<void>
  onDeleteTaskBlock: (blockId: DbId) => void | Promise<void>
  onRemoveTask: (blockId: DbId) => void | Promise<void>
  onClearSchedule: (blockId: DbId) => void | Promise<void>
}

function MyDayTimelineCard(props: MyDayTimelineCardProps) {
  const React = window.React
  const [contextMenuVisible, setContextMenuVisible] = React.useState(false)
  const [contextMenuRect, setContextMenuRect] = React.useState<DOMRect | null>(null)
  const contextMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (contextMenuContainerRef.current == null) {
    contextMenuContainerRef.current = document.body
  }
  const startMinute = props.startMinute
  const endMinute = props.endMinute
  const laneCount = Math.max(1, props.laneCount)
  const laneIndex = clampNumber(props.laneIndex, 0, laneCount - 1)
  const laneGapPx = laneCount > 1 ? TIMELINE_LANE_GAP_PX : 0

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      {
        className: `mlo-my-day-timeline-card${props.item.star ? " mlo-my-day-timeline-card-starred" : ""}${props.disabled ? " mlo-my-day-timeline-card-disabled" : ""}`,
        draggable: false,
        onPointerDown: props.onPointerDown,
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
          "--mlo-myday-card-hue": computeCardHue(props.item.blockId, props.item.star),
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
          `${minuteToTimeLabel(
            timelineMinuteToLabelMinute(startMinute, props.timelineStartOffsetMinute),
          )} - ${minuteToTimeLabel(
            timelineMinuteToLabelMinute(endMinute, props.timelineStartOffsetMinute),
          )}`,
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
      React.createElement("div", {
        className: "mlo-my-day-timeline-resize-handle mlo-my-day-timeline-resize-handle-end",
        onPointerDown: (event: PointerEvent) => {
          props.onResizeEndPointerDown(event)
        },
      }),
    ),
    React.createElement(MyDayTaskContextMenu, {
      blockId: props.item.blockId,
      starred: props.item.star,
      disabled: props.disabled,
      visible: contextMenuVisible,
      rect: contextMenuRect,
      containerRef: contextMenuContainerRef,
      showClearScheduleAction: true,
      onClose: () => setContextMenuVisible(false),
      onClosed: () => setContextMenuRect(null),
      onOpenTask: props.onOpenTask,
      onNavigateTask: props.onNavigateTask,
      onToggleTaskStar: props.onToggleTaskStar,
      onAddSubtask: props.onAddSubtask,
      onRemoveTask: props.onRemoveTask,
      onDeleteTaskTag: props.onDeleteTaskTag,
      onDeleteTaskBlock: props.onDeleteTaskBlock,
      onClearSchedule: props.onClearSchedule,
    }),
  )
}

interface MyDayTaskContextMenuProps {
  blockId: DbId
  starred: boolean
  disabled: boolean
  visible: boolean
  rect: DOMRect | null
  containerRef: { current: HTMLElement | null }
  showClearScheduleAction: boolean
  onClose: () => void
  onClosed: () => void
  onOpenTask: (blockId: DbId) => void
  onNavigateTask: (blockId: DbId) => void | Promise<void>
  onToggleTaskStar: (blockId: DbId) => void | Promise<void>
  onAddSubtask: (blockId: DbId) => void | Promise<void>
  onRemoveTask: (blockId: DbId) => void | Promise<void>
  onDeleteTaskTag: (blockId: DbId) => void | Promise<void>
  onDeleteTaskBlock: (blockId: DbId) => void | Promise<void>
  onClearSchedule?: (blockId: DbId) => void | Promise<void>
}

function MyDayTaskContextMenu(props: MyDayTaskContextMenuProps) {
  const React = window.React
  const ConfirmBox = orca.components.ConfirmBox
  const Popup = orca.components.Popup
  const Menu = orca.components.Menu
  const MenuSeparator = orca.components.MenuSeparator
  const MenuText = orca.components.MenuText

  if (props.rect == null) {
    return null
  }

  return React.createElement(
    Popup,
    {
      container: props.containerRef,
      rect: props.rect,
      visible: props.visible,
      onClose: props.onClose,
      onClosed: props.onClosed,
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
        className: "mlo-my-day-context-menu-content",
      },
      React.createElement(MenuText, {
        title: t("Add subtask"),
        preIcon: "ti ti-list-tree",
        disabled: props.disabled,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onClose()
          if (props.disabled) {
            return
          }
          void props.onAddSubtask(props.blockId)
        },
      }),
      React.createElement(MenuText, {
        title: props.starred ? t("Unstar task") : t("Star task"),
        preIcon: props.starred ? "ti ti-star-off" : "ti ti-star",
        disabled: props.disabled,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onClose()
          if (props.disabled) {
            return
          }
          void props.onToggleTaskStar(props.blockId)
        },
      }),
      React.createElement(MenuText, {
        title: t("Open task properties"),
        preIcon: "ti ti-edit",
        disabled: props.disabled,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onClose()
          if (props.disabled) {
            return
          }
          props.onOpenTask(props.blockId)
        },
      }),
      React.createElement(MenuText, {
        title: t("Jump to task location"),
        preIcon: "ti ti-arrow-up-right",
        disabled: props.disabled,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onClose()
          if (props.disabled) {
            return
          }
          void props.onNavigateTask(props.blockId)
        },
      }),
      props.showClearScheduleAction && props.onClearSchedule != null
        ? React.createElement(MenuText, {
            title: t("Unscheduled"),
            preIcon: "ti ti-calendar-off",
            disabled: props.disabled,
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              props.onClose()
              if (props.disabled) {
                return
              }
              void props.onClearSchedule?.(props.blockId)
            },
          })
        : null,
      React.createElement(MenuText, {
        title: t("Remove from My Day"),
        preIcon: "ti ti-calendar-minus",
        disabled: props.disabled,
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          props.onClose()
          if (props.disabled) {
            return
          }
          void props.onRemoveTask(props.blockId)
        },
      }),
      React.createElement(MenuSeparator, {}),
      React.createElement(
        ConfirmBox,
        {
          text: t("Remove task tag from this block?"),
          onConfirm: async (_event: unknown, close: () => void) => {
            close()
            props.onClose()
            if (props.disabled) {
              return
            }
            await props.onDeleteTaskTag(props.blockId)
          },
        },
        (openConfirm: (event: MouseEvent) => void) =>
          React.createElement(MenuText, {
            title: t("Delete task tag"),
            preIcon: "ti ti-tag-off",
            dangerous: true,
            disabled: props.disabled,
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              if (props.disabled) {
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
            props.onClose()
            if (props.disabled) {
              return
            }
            await props.onDeleteTaskBlock(props.blockId)
          },
        },
        (openConfirm: (event: MouseEvent) => void) =>
          React.createElement(MenuText, {
            title: t("Delete task block"),
            preIcon: "ti ti-trash",
            dangerous: true,
            disabled: props.disabled,
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              if (props.disabled) {
                return
              }
              openConfirm(event)
            },
          }),
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
  timelineStartOffsetMinute: number,
): {
  startMinute: number
  endMinute: number
} | null {
  const minuteOffset = (pointerClientY - dragState.originClientY) / PIXELS_PER_MINUTE
  const snappedOffset = Math.round(minuteOffset / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES

  let nextStartMinute = dragState.originStartMinute
  let nextEndMinute = dragState.originEndMinute

  if (dragState.mode === "move") {
    const duration = dragState.originEndMinute - dragState.originStartMinute
    if (duration <= 0) {
      return null
    }

    const maxStartMinute = Math.max(timelineStartMinute, timelineEndMinute - duration)
    const clampedStartMinute = clampNumber(
      dragState.originStartMinute + snappedOffset,
      timelineStartMinute,
      maxStartMinute,
    )
    nextStartMinute = resolveNearestValidTimelineStartMinute(
      clampedStartMinute,
      duration,
      timelineStartMinute,
      timelineEndMinute,
      timelineStartOffsetMinute,
      snappedOffset > 0 ? 1 : snappedOffset < 0 ? -1 : 0,
    )
    nextEndMinute = Math.min(timelineEndMinute, nextStartMinute + duration)
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

  if (
    resolveScheduleRangeFromTimelineRange(
      nextStartMinute,
      nextEndMinute,
      timelineStartOffsetMinute,
    ) == null
  ) {
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

  return resolveScheduleDurationMinutes(item.scheduleStartMinute, item.scheduleEndMinute) != null
}

function normalizeTimelineStartHour(rawValue: unknown): number {
  if (typeof rawValue !== "number" || Number.isNaN(rawValue) || !Number.isFinite(rawValue)) {
    return 0
  }

  const rounded = Math.round(rawValue)
  if (rounded < 0) {
    return 0
  }

  if (rounded > 23) {
    return 23
  }

  return rounded
}

function scheduleMinuteToTimelineMinute(
  scheduleMinute: number,
  timelineStartOffsetMinute: number,
): number {
  const normalizedScheduleMinute = clampNumber(Math.round(scheduleMinute), 0, DAY_MINUTES)
  const normalizedOffsetMinute = clampNumber(
    Math.round(timelineStartOffsetMinute),
    0,
    DAY_MINUTES - 1,
  )
  const rawTimelineMinute = normalizedScheduleMinute - normalizedOffsetMinute
  if (rawTimelineMinute < 0) {
    return rawTimelineMinute + DAY_MINUTES
  }

  return rawTimelineMinute
}

function timelineMinuteToScheduleMinute(
  timelineMinute: number,
  timelineStartOffsetMinute: number,
): number {
  const normalizedTimelineMinute = clampNumber(Math.round(timelineMinute), 0, DAY_MINUTES)
  const normalizedOffsetMinute = clampNumber(
    Math.round(timelineStartOffsetMinute),
    0,
    DAY_MINUTES - 1,
  )
  const rawScheduleMinute = normalizedTimelineMinute + normalizedOffsetMinute
  if (rawScheduleMinute >= DAY_MINUTES) {
    return rawScheduleMinute - DAY_MINUTES
  }

  return rawScheduleMinute
}

function timelineMinuteToLabelMinute(
  timelineMinute: number,
  timelineStartOffsetMinute: number,
): number {
  const normalizedTimelineMinute = clampNumber(Math.round(timelineMinute), 0, DAY_MINUTES)
  const normalizedOffsetMinute = clampNumber(
    Math.round(timelineStartOffsetMinute),
    0,
    DAY_MINUTES - 1,
  )
  if (normalizedTimelineMinute === DAY_MINUTES && normalizedOffsetMinute === 0) {
    return DAY_MINUTES
  }

  return timelineMinuteToScheduleMinute(normalizedTimelineMinute, normalizedOffsetMinute)
}

function resolveScheduleRangeFromTimelineRange(
  timelineStartMinute: number,
  timelineEndMinute: number,
  timelineStartOffsetMinute: number,
): {
  startMinute: number
  endMinute: number
} | null {
  const normalizedTimelineStartMinute = clampNumber(Math.round(timelineStartMinute), 0, DAY_MINUTES)
  const normalizedTimelineEndMinute = clampNumber(Math.round(timelineEndMinute), 0, DAY_MINUTES)
  if (normalizedTimelineEndMinute <= normalizedTimelineStartMinute) {
    return null
  }

  const duration = normalizedTimelineEndMinute - normalizedTimelineStartMinute
  if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    return null
  }

  const scheduleStartMinute = timelineMinuteToScheduleMinute(
    normalizedTimelineStartMinute,
    timelineStartOffsetMinute,
  )
  const scheduleEndMinute = timelineMinuteToScheduleMinute(
    normalizedTimelineEndMinute,
    timelineStartOffsetMinute,
  )
  if (resolveScheduleDurationMinutes(scheduleStartMinute, scheduleEndMinute) !== duration) {
    return null
  }

  return {
    startMinute: scheduleStartMinute,
    endMinute: scheduleEndMinute,
  }
}

function resolveNearestValidTimelineStartMinute(
  rawStartMinute: number,
  durationMinutes: number,
  timelineStartMinute: number,
  timelineEndMinute: number,
  timelineStartOffsetMinute: number,
  preferredDirection: -1 | 0 | 1 = 0,
): number {
  const normalizedDuration = clampNumber(
    Math.round(durationMinutes),
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
  )
  const minStartMinute = timelineStartMinute
  const maxStartMinute = Math.max(minStartMinute, timelineEndMinute - normalizedDuration)
  const snappedStartMinute = roundToSlot(rawStartMinute, DRAG_SNAP_MINUTES)
  const clampedStartMinute = clampNumber(snappedStartMinute, minStartMinute, maxStartMinute)

  const isValidStartMinute = (candidateStartMinute: number): boolean => {
    return (
      resolveScheduleRangeFromTimelineRange(
        candidateStartMinute,
        candidateStartMinute + normalizedDuration,
        timelineStartOffsetMinute,
      ) != null
    )
  }

  if (isValidStartMinute(clampedStartMinute)) {
    return clampedStartMinute
  }

  const searchLimit = timelineEndMinute - timelineStartMinute
  const searchInDirection = (direction: -1 | 1): number | null => {
    for (let delta = DRAG_SNAP_MINUTES; delta <= searchLimit; delta += DRAG_SNAP_MINUTES) {
      const candidateStartMinute = clampedStartMinute + direction * delta
      if (candidateStartMinute < minStartMinute || candidateStartMinute > maxStartMinute) {
        continue
      }

      if (isValidStartMinute(candidateStartMinute)) {
        return candidateStartMinute
      }
    }

    return null
  }

  if (preferredDirection !== 0) {
    const preferredCandidate = searchInDirection(preferredDirection)
    if (preferredCandidate != null) {
      return preferredCandidate
    }

    const fallbackDirection: -1 | 1 = preferredDirection === 1 ? -1 : 1
    const fallbackCandidate = searchInDirection(fallbackDirection)
    if (fallbackCandidate != null) {
      return fallbackCandidate
    }

    return clampedStartMinute
  }

  for (let delta = DRAG_SNAP_MINUTES; delta <= searchLimit; delta += DRAG_SNAP_MINUTES) {
    const leftStartMinute = clampedStartMinute - delta
    if (leftStartMinute >= minStartMinute && isValidStartMinute(leftStartMinute)) {
      return leftStartMinute
    }

    const rightStartMinute = clampedStartMinute + delta
    if (rightStartMinute <= maxStartMinute && isValidStartMinute(rightStartMinute)) {
      return rightStartMinute
    }
  }

  return clampedStartMinute
}

function resolveScheduleDurationMinutes(startMinute: number, endMinute: number): number | null {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return null
  }

  const normalizedStartMinute = clampNumber(Math.round(startMinute), 0, DAY_MINUTES)
  const normalizedEndMinute = clampNumber(Math.round(endMinute), 0, DAY_MINUTES)
  let duration = normalizedEndMinute - normalizedStartMinute
  if (duration <= 0) {
    duration += DAY_MINUTES
  }

  if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    return null
  }

  return duration
}

function normalizeScheduleEndMinute(startMinute: number, durationMinutes: number): number {
  const normalizedStartMinute = clampNumber(Math.round(startMinute), 0, DAY_MINUTES)
  const normalizedDuration = clampNumber(
    Math.round(durationMinutes),
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
  )
  const rawEndMinute = normalizedStartMinute + normalizedDuration
  if (rawEndMinute > DAY_MINUTES) {
    return rawEndMinute - DAY_MINUTES
  }

  return rawEndMinute
}

function roundToSlot(minute: number, slotMinutes: number): number {
  if (!Number.isFinite(minute) || !Number.isFinite(slotMinutes) || slotMinutes <= 0) {
    return 0
  }

  return Math.round(minute / slotMinutes) * slotMinutes
}

function minuteToTimeLabel(minute: number): string {
  const safeMinute = clampNumber(Math.round(minute), 0, DAY_MINUTES)
  const hour = Math.floor(safeMinute / 60)
  const minutePart = safeMinute % 60
  return `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value))
}

function computeCardHue(blockId: DbId, starred: boolean): number {
  if (starred) {
    return 34
  }

  const numericId = Number(blockId)
  if (!Number.isFinite(numericId)) {
    return 214
  }

  const normalizedId = Math.abs(Math.round(numericId))
  return 202 + (normalizedId % 6) * 9
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

@keyframes mloMyDayDropPulse {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(11, 95, 255, 0.14);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(11, 95, 255, 0.24);
  }
}

@keyframes mloMyDayDropTargetGlow {
  0%,
  100% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.84),
      0 0 0 3px rgba(11, 95, 255, 0.2),
      0 14px 28px rgba(15, 23, 42, 0.1);
  }
  50% {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.9),
      0 0 0 6px rgba(11, 95, 255, 0.26),
      0 16px 32px rgba(15, 23, 42, 0.13);
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
  border-radius: 14px;
  border: 1px solid rgba(16, 44, 84, 0.18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.76),
    0 12px 26px rgba(15, 23, 42, 0.08);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.mlo-my-day-unscheduled-panel::before,
.mlo-my-day-timeline-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.mlo-my-day-unscheduled-panel {
  background:
    radial-gradient(circle at 12% 0%, rgba(0, 123, 255, 0.2), transparent 52%),
    linear-gradient(176deg, rgba(255, 255, 255, 0.92), rgba(240, 247, 255, 0.9));
}

.mlo-my-day-unscheduled-panel::before {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, transparent 45%),
    radial-gradient(circle at 100% 100%, rgba(0, 123, 255, 0.11), transparent 42%);
}

.mlo-my-day-unscheduled-panel-drop-target {
  border-color: rgba(11, 95, 255, 0.44);
  animation: mloMyDayDropTargetGlow 940ms ease-in-out infinite;
}

.mlo-my-day-unscheduled-panel-drop-target .mlo-my-day-card-stack {
  border-color: rgba(11, 95, 255, 0.36);
  background:
    linear-gradient(180deg, rgba(11, 95, 255, 0.12), rgba(255, 255, 255, 0.24)),
    repeating-linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.018) 0px,
      rgba(15, 23, 42, 0.018) 1px,
      transparent 1px,
      transparent 12px
    );
  opacity: 0.26;
}

.mlo-my-day-unscheduled-panel-drop-target .mlo-my-day-empty-hint {
  opacity: 0.24;
}

.mlo-my-day-unscheduled-drop-cta {
  position: absolute;
  top: 44px;
  left: 10px;
  right: 10px;
  bottom: 10px;
  z-index: 4;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 14px;
  border-radius: 12px;
  border: 2px dashed rgba(11, 95, 255, 0.46);
  background:
    linear-gradient(180deg, rgba(11, 95, 255, 0.18), rgba(11, 95, 255, 0.09)),
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.72), transparent 58%);
  color: #0f4fb5;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  animation: mloMyDayDropPulse 880ms ease-in-out infinite;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-timeline-panel {
  background:
    radial-gradient(circle at 0% 100%, rgba(28, 125, 255, 0.17), transparent 45%),
    linear-gradient(176deg, rgba(252, 254, 255, 0.94), rgba(237, 245, 255, 0.9));
}

.mlo-my-day-timeline-panel::before {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.48), transparent 44%),
    radial-gradient(circle at 100% 0%, rgba(88, 28, 255, 0.08), transparent 46%);
}

.mlo-my-day-panel-title {
  position: relative;
  z-index: 1;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  min-height: 23px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(16, 44, 84, 0.16);
  background: linear-gradient(150deg, rgba(255, 255, 255, 0.82), rgba(245, 250, 255, 0.86));
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #21425d;
  box-shadow: 0 5px 12px rgba(15, 23, 42, 0.08);
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-empty-hint {
  position: relative;
  z-index: 1;
  font-size: 12px;
  color: var(--mlo-myday-muted);
  background: linear-gradient(150deg, rgba(11, 95, 255, 0.09), rgba(11, 95, 255, 0.03));
  border: 1px dashed rgba(11, 95, 255, 0.28);
  border-radius: 10px;
  padding: 10px 11px;
}

.mlo-my-day-card-stack {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 6px 4px 6px 2px;
  border-radius: 12px;
  border: 1px dashed rgba(16, 44, 84, 0.18);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.14)),
    repeating-linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.018) 0px,
      rgba(15, 23, 42, 0.018) 1px,
      transparent 1px,
      transparent 12px
    );
}

.mlo-my-day-card-stack::-webkit-scrollbar,
.mlo-my-day-timeline-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.mlo-my-day-card-stack::-webkit-scrollbar-thumb,
.mlo-my-day-timeline-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
  background: rgba(36, 84, 148, 0.34);
}

.mlo-my-day-card {
  --mlo-myday-card-hue: 214;
  border-radius: 10px;
  border: 1px solid hsla(var(--mlo-myday-card-hue), 54%, 40%, 0.2);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  animation: mloMyDayCardIn 280ms cubic-bezier(.2,.8,.2,1) backwards;
  cursor: grab;
  transition: box-shadow 120ms ease, border-color 120ms ease;
}

.mlo-my-day-card-starred {
  --mlo-myday-card-hue: 34;
}

.mlo-my-day-card-disabled {
  cursor: default;
  filter: saturate(0.86);
}

.mlo-my-day-card:hover {
  border-color: hsla(var(--mlo-myday-card-hue), 70%, 44%, 0.34);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.1);
}

.mlo-my-day-card:active {
  cursor: grabbing;
}

.mlo-my-day-card-disabled:active {
  cursor: default;
}

.mlo-my-day-card-title,
.mlo-my-day-timeline-title {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--mlo-myday-ink);
  text-align: left;
  cursor: pointer;
  font-size: 13px;
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
  border: 1px solid hsla(var(--mlo-myday-card-hue), 52%, 46%, 0.22);
  background: hsla(var(--mlo-myday-card-hue), 72%, 54%, 0.09);
  color: hsl(var(--mlo-myday-card-hue), 50%, 34%);
  font-size: 10px;
  white-space: nowrap;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mlo-my-day-card-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 1px;
}

.mlo-my-day-action-danger {
  border: 1px solid rgba(16, 44, 84, 0.18);
  background: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  line-height: 1.4;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
  transition: background 120ms ease, border-color 120ms ease;
}

.mlo-my-day-action-danger {
  color: var(--mlo-myday-danger);
}

.mlo-my-day-action-danger:hover:not(:disabled) {
  background: #fff;
  border-color: rgba(180, 35, 24, 0.36);
}

.mlo-my-day-action-danger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mlo-my-day-timeline-scroll {
  flex: 1;
  min-height: 220px;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid rgba(16, 44, 84, 0.2);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(244, 248, 255, 0.9)),
    repeating-linear-gradient(
      180deg,
      rgba(15, 23, 42, 0.015) 0px,
      rgba(15, 23, 42, 0.015) 1px,
      transparent 1px,
      transparent 12px
    );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.mlo-my-day-timeline {
  position: relative;
  min-height: 220px;
  padding-left: 68px;
  overflow: hidden;
}

.mlo-my-day-timeline::before {
  content: "";
  position: absolute;
  left: 57px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(
    180deg,
    rgba(16, 44, 84, 0.36),
    rgba(16, 44, 84, 0.12)
  );
}

.mlo-my-day-slot {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed rgba(16, 44, 84, 0.14);
}

.mlo-my-day-slot-major {
  border-top-style: solid;
  border-top-color: rgba(16, 44, 84, 0.3);
}

.mlo-my-day-slot-label {
  position: absolute;
  left: 8px;
  top: -10px;
  width: 48px;
  text-align: right;
  font-size: 10px;
  color: #35506f;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-family: "Avenir Next", "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.mlo-my-day-drop-line {
  position: absolute;
  left: 56px;
  right: 10px;
  height: 0;
  border-top: 2px solid var(--mlo-myday-accent);
  box-shadow: 0 0 0 4px var(--mlo-myday-accent-soft);
  animation: mloMyDayDropPulse 880ms ease-in-out infinite;
  z-index: 6;
}

.mlo-my-day-timeline-card {
  --mlo-myday-card-hue: 214;
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
  border-radius: 10px;
  border: 1px solid hsla(var(--mlo-myday-card-hue), 54%, 42%, 0.25);
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 5px 14px rgba(15, 23, 42, 0.1);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 6px;
  animation: mloMyDayCardIn 260ms cubic-bezier(.2,.8,.2,1) backwards;
  cursor: grab;
  z-index: 5;
  user-select: none;
  touch-action: none;
  overflow: hidden;
  transition: box-shadow 120ms ease, border-color 120ms ease;
}

.mlo-my-day-timeline-card::before {
  content: none;
}

.mlo-my-day-timeline-card::after {
  content: none;
}

.mlo-my-day-timeline-card-starred {
  --mlo-myday-card-hue: 34;
}

.mlo-my-day-timeline-card-disabled {
  cursor: default;
  filter: saturate(0.84);
}

.mlo-my-day-timeline-card:active {
  cursor: grabbing;
}

.mlo-my-day-timeline-card:hover {
  border-color: hsla(var(--mlo-myday-card-hue), 70%, 44%, 0.35);
  box-shadow: 0 7px 16px rgba(15, 23, 42, 0.12);
}

.mlo-my-day-timeline-card-disabled:active {
  cursor: default;
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
  color: hsl(var(--mlo-myday-card-hue), 36%, 23%);
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
  border: 1px solid hsla(var(--mlo-myday-card-hue), 52%, 46%, 0.22);
  background: hsla(var(--mlo-myday-card-hue), 72%, 54%, 0.09);
  color: hsl(var(--mlo-myday-card-hue), 50%, 34%);
  font-size: 10px;
  padding: 0 6px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlo-my-day-timeline-star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  min-width: 18px;
  border-radius: 999px;
  border: 1px solid rgba(212, 162, 18, 0.34);
  background: linear-gradient(145deg, rgba(248, 219, 145, 0.26), rgba(212, 162, 18, 0.16));
  color: #8f6200;
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
  background: transparent;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}

.mlo-my-day-timeline-resize-handle::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 2px;
  border-radius: 999px;
  background: hsla(var(--mlo-myday-card-hue), 48%, 38%, 0.38);
  opacity: 0;
  transition: opacity 120ms ease;
}

.mlo-my-day-timeline-card:hover .mlo-my-day-timeline-resize-handle,
.mlo-my-day-timeline-card:hover .mlo-my-day-timeline-resize-handle::before,
.mlo-my-day-timeline-resize-handle:hover,
.mlo-my-day-timeline-resize-handle:hover::before {
  opacity: 1;
}

.mlo-my-day-timeline-resize-handle:hover {
  background: hsla(var(--mlo-myday-card-hue), 58%, 44%, 0.1);
}

@media (hover: none) {
  .mlo-my-day-timeline-resize-handle,
  .mlo-my-day-timeline-resize-handle::before {
    opacity: 1;
  }
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
  padding: 0 7px;
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid hsla(var(--mlo-myday-card-hue), 60%, 44%, 0.3);
  color: hsl(var(--mlo-myday-card-hue), 50%, 31%);
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

  .mlo-my-day-timeline::before {
    left: 49px;
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
