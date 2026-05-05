import type { Block, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId, isValidDbId } from "./block-utils"
import { getPluginSettings } from "./plugin-settings"
import {
  type TaskSchemaDefinition,
} from "./task-schema"
import { collectNextActions, type NextActionItem } from "./dependency-engine"
import {
  completeTaskTimerPomodoroPhase,
  formatTaskTimerDuration,
  finalizeStaleRunningTaskTimer,
  isTaskTimerPomodoroPhaseComplete,
  pauseTaskTimer,
  checkpointRunningTaskTimer,
  readTaskTimerFromBlock,
  resolveNextPomodoroBreakPhase,
  resolveTaskTimerElapsedMs,
  resolveTaskTimerPhaseRemainingMs,
  startTaskTimer,
  stopTaskTimer,
  switchTaskTimerPhase,
  TASK_TIMER_EVENT_NAME,
  type TaskTimerChangeEventDetail,
  type TaskTimerData,
  type TaskTimerPhase,
} from "./task-timer"

const COMMAND_PREFIX = "task-planner"
const HEADBAR_BUTTON_ID = `${COMMAND_PREFIX}.taskTimerHeadbarButton`
const STYLE_ROLE = "mlo-task-timer-runtime-style"
const TICK_INTERVAL_MS = 1000
const TAG_REF_TYPE = 2
const TIMER_SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
const TIMER_CLOSE_STORAGE_KEY = `${COMMAND_PREFIX}.taskTimerLastClose`

interface RuntimeSnapshot {
  timer: TaskTimerData | null
  taskId: DbId | null
  sourceBlockId: DbId | null
  taskText: string
  nowMs: number
}

interface TimerTaskOption {
  blockId: DbId
  sourceBlockId: DbId | null
  text: string
}

export interface TaskTimerRuntimeHandle {
  dispose: () => void
}

export function setupTaskTimerRuntime(
  pluginName: string,
  schema: TaskSchemaDefinition,
): TaskTimerRuntimeHandle {
  const React = window.React
  const { subscribe } = window.Valtio
  const Button = orca.components.Button
  const Popup = orca.components.Popup
  const Select = orca.components.Select

  let disposed = false
  let activeTaskId: DbId | null = null
  let activeSourceBlockId: DbId | null = null
  let lastTaskId: DbId | null = null
  let tickTimerId: number | null = null
  let settingsUnsubscribe: (() => void) | null = null
  let mutationChain: Promise<void> = Promise.resolve()
  let lastPhaseCompleteNoticeKey = ""
  const listeners = new Set<() => void>()

  injectRuntimeStyles(pluginName)

  if (orca.state.headbarButtons[HEADBAR_BUTTON_ID] != null) {
    orca.headbar.unregisterHeadbarButton(HEADBAR_BUTTON_ID)
  }
  orca.headbar.registerHeadbarButton(HEADBAR_BUTTON_ID, () => {
    return React.createElement(TaskTimerHeadbarButton, {
      pluginName,
      schema,
    })
  })

  const pluginState = orca.state.plugins[pluginName]
  if (pluginState != null) {
    settingsUnsubscribe = subscribe(pluginState, () => {
      const settings = getPluginSettings(pluginName)
      if (!settings.taskTimerEnabled) {
        void stopActiveTimer()
      }
      notifyRuntimeChanged()
    })
  }

  document.addEventListener("visibilitychange", handleVisibilityChange)
  window.addEventListener("beforeunload", handleBeforeUnload)
  window.addEventListener(TASK_TIMER_EVENT_NAME, handleTimerChangeEvent)
  startTicking()
  recoverActiveFromLoadedBlocksOnce()

  return {
    dispose: () => {
      disposed = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener(TASK_TIMER_EVENT_NAME, handleTimerChangeEvent)
      settingsUnsubscribe?.()
      settingsUnsubscribe = null
      stopTicking()
      if (orca.state.headbarButtons[HEADBAR_BUTTON_ID] != null) {
        orca.headbar.unregisterHeadbarButton(HEADBAR_BUTTON_ID)
      }
      removeRuntimeStyles(pluginName)
      listeners.clear()
      void stopActiveTimer()
    },
  }

  function TaskTimerHeadbarButton(props: {
    pluginName: string
    schema: TaskSchemaDefinition
  }) {
    const anchorRef = React.useRef<HTMLButtonElement | null>(null)
    const [visible, setVisible] = React.useState(false)
    const [snapshot, setSnapshot] = React.useState<RuntimeSnapshot>(() => getSnapshot())

    React.useEffect(() => {
      return subscribeRuntime(() => {
        setSnapshot(getSnapshot())
      })
    }, [])

    const timer = snapshot.timer
    const settings = getPluginSettings(props.pluginName)
    if (!settings.taskTimerEnabled) {
      return React.createElement(React.Fragment)
    }

    const phase = timer?.activePhase ?? "idle"
    const toneClass = timer?.running
      ? phase === "focus"
        ? "is-focus"
        : "is-break"
      : phase === "paused"
        ? "is-paused"
        : "is-idle"
    const compactText = formatHeadbarTimerText(timer, snapshot.nowMs)

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Button,
        {
          ref: anchorRef,
          variant: "plain",
          title: t("Task timer"),
          className: `mlo-task-timer-headbar ${toneClass}`,
          onClick: () => setVisible((prev: boolean) => !prev),
        },
        React.createElement("i", {
          className: "ti ti-alarm",
          style: { fontSize: "16px", lineHeight: 1 },
        }),
        compactText !== ""
          ? React.createElement(
            "span",
            {
              className: "mlo-task-timer-headbar-text",
            },
            compactText,
          )
          : null,
      ),
      React.createElement(
        Popup,
        {
          refElement: anchorRef,
          visible,
          onClose: () => setVisible(false),
          defaultPlacement: "bottom",
          alignment: "end",
          offset: 8,
          container: { current: document.body },
          className: "mlo-task-timer-popup-shell",
        },
        React.createElement(TaskTimerPopup, {
          snapshot,
          onClose: () => setVisible(false),
        }),
      ),
    )
  }

  function TaskTimerPopup(props: {
    snapshot: RuntimeSnapshot
    onClose: () => void
  }) {
    const [taskOptions, setTaskOptions] = React.useState<TimerTaskOption[]>([])
    const [selectedTaskOptionId, setSelectedTaskOptionId] = React.useState<string>("")
    const [taskOptionsLoading, setTaskOptionsLoading] = React.useState(false)
    const [taskOptionsError, setTaskOptionsError] = React.useState("")
    const snapshot = props.snapshot
    const timer = snapshot.timer
    const settings = getPluginSettings(pluginName)
    const effectiveMode = timer?.activeMode ?? settings.taskTimerMode
    const isPomodoroMode = effectiveMode === "pomodoro"
    const running = timer?.running === true
    const paused = timer?.activePhase === "paused"
    const phase = timer?.activePhase ?? "idle"
    const remainingMs = timer == null
      ? null
      : resolveTaskTimerPhaseRemainingMs(timer, snapshot.nowMs)
    const elapsedMs = timer == null ? 0 : resolveTaskTimerElapsedMs(timer, snapshot.nowMs)
    const completedPomodoros = timer?.completedPomodoros ?? 0
    const canStartLastTask = lastTaskId != null && snapshot.taskId == null

    React.useEffect(() => {
      if (snapshot.taskId != null) {
        return
      }

      let canceled = false
      setTaskOptionsLoading(true)
      setTaskOptionsError("")
      void loadTimerTaskOptions()
        .then((options) => {
          if (!canceled) {
            setTaskOptions(options)
            setSelectedTaskOptionId((prev: string) => {
              if (options.some((option: TimerTaskOption) => String(option.blockId) === prev)) {
                return prev
              }
              return options[0] == null ? "" : String(options[0].blockId)
            })
          }
        })
        .catch((error: unknown) => {
          console.error(error)
          if (!canceled) {
            setTaskOptionsError(t("Failed to load timer tasks"))
          }
        })
        .finally(() => {
          if (!canceled) {
            setTaskOptionsLoading(false)
          }
        })

      return () => {
        canceled = true
      }
    }, [snapshot.taskId])

    const selectedTaskOption =
      taskOptions.find((option: TimerTaskOption) => String(option.blockId) === selectedTaskOptionId) ?? null

    return React.createElement(
      "div",
      {
        className: "mlo-task-timer-popup",
      },
      React.createElement(
        "div",
        {
          className: "mlo-task-timer-popup-header",
        },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            {
              className: "mlo-task-timer-popup-kicker",
            },
            resolvePhaseLabel(phase),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "mlo-task-timer-popup-title",
              disabled: snapshot.taskId == null,
              onClick: () => {
                if (snapshot.taskId == null) {
                  return
                }
                orca.nav.openInLastPanel("block", { blockId: snapshot.taskId })
                props.onClose()
              },
            },
            snapshot.taskText || t("No active task"),
          ),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-task-timer-popup-time",
          },
          formatPopupTimerText(timer, snapshot.nowMs),
        ),
      ),
      React.createElement(
        "div",
        {
          className: "mlo-task-timer-popup-meta",
        },
        React.createElement("span", null, t("Focus ${time}", {
          time: formatTaskTimerDuration(elapsedMs),
        })),
        isPomodoroMode
          ? React.createElement("span", null, t("Pomodoros ${count}", {
            count: String(completedPomodoros),
          }))
          : null,
      ),
      React.createElement(
        "div",
        {
          className: "mlo-task-timer-popup-actions",
        },
        running
          ? React.createElement(ActionButton, {
            icon: "ti ti-player-pause-filled",
            label: t("Pause"),
            onClick: () => void pauseActiveTimer(),
          })
          : paused
            ? React.createElement(ActionButton, {
              icon: "ti ti-player-play-filled",
              label: t("Resume"),
              onClick: () => void resumeActiveTimer(),
            })
            : canStartLastTask
              ? React.createElement(ActionButton, {
                icon: "ti ti-player-play-filled",
                label: t("Continue last task"),
                onClick: () => void startLastTask(),
              })
              : React.createElement(ActionButton, {
                icon: "ti ti-player-play-filled",
                label: t("Start from task"),
                disabled: true,
                onClick: () => undefined,
              }),
        running || paused
          ? React.createElement(ActionButton, {
            icon: "ti ti-player-stop-filled",
            label: t("Stop"),
            onClick: () => void stopActiveTimer(),
          })
          : null,
        isPomodoroMode && running && phase === "focus"
          ? React.createElement(ActionButton, {
            icon: "ti ti-cup",
            label: t("Enter break"),
            onClick: () => void enterBreak(),
          })
          : null,
        isPomodoroMode && running && (phase === "short-break" || phase === "long-break")
          ? React.createElement(ActionButton, {
            icon: "ti ti-player-skip-forward-filled",
            label: t("Start focus"),
            onClick: () => void startFocusPhase(),
          })
          : null,
        isPomodoroMode && timer != null && isTaskTimerPomodoroPhaseComplete(timer, snapshot.nowMs)
          ? React.createElement(ActionButton, {
            icon: "ti ti-check",
            label: phase === "focus" ? t("Finish focus") : t("Finish break"),
            onClick: () => void finishCompletedPhase(),
          })
          : null,
      ),
      !running && !paused
        ? React.createElement(
          "div",
          {
            className: "mlo-task-timer-popup-task-picker",
          },
          React.createElement(
            "div",
            {
              className: "mlo-task-timer-popup-section-title",
            },
            t("Choose a task to time"),
          ),
          taskOptionsLoading || taskOptionsError !== "" || taskOptions.length === 0
            ? React.createElement(
              "div",
              { className: "mlo-task-timer-popup-empty" },
              taskOptionsLoading
                ? t("Loading tasks")
                : taskOptionsError !== ""
                  ? taskOptionsError
                  : t("No active task available"),
            )
            : React.createElement(
              React.Fragment,
              null,
              React.createElement(Select, {
                selected: [selectedTaskOptionId],
                options: taskOptions.map((option: TimerTaskOption) => ({
                  label: option.text || t("(Untitled task)"),
                  value: String(option.blockId),
                })),
                onChange: (selected: string[]) => {
                  setSelectedTaskOptionId(selected[0] ?? "")
                },
                width: "100%",
                menuContainer: { current: document.body },
              }),
              React.createElement(ActionButton, {
                icon: "ti ti-player-play-filled",
                label: t("Start selected task"),
                disabled: selectedTaskOption == null,
                onClick: () => {
                  if (selectedTaskOption == null) {
                    return
                  }
                  enqueueMutation(async () => {
                    await startTimerForTask(
                      selectedTaskOption.blockId,
                      selectedTaskOption.sourceBlockId,
                      settings.taskTimerMode,
                    )
                  })
                },
              }),
            ),
        )
        : null,
      isPomodoroMode && remainingMs != null && timer?.activeMode === "pomodoro"
        ? React.createElement(
          "div",
          {
            className: "mlo-task-timer-popup-progress",
          },
          React.createElement("div", {
            style: {
              width: `${resolvePhaseProgress(timer, snapshot.nowMs)}%`,
            },
          }),
        )
        : null,
    )
  }

  function ActionButton(props: {
    icon: string
    label: string
    disabled?: boolean
    onClick: () => void
  }) {
    return React.createElement(
      "button",
      {
        type: "button",
        className: "mlo-task-timer-popup-action",
        disabled: props.disabled === true,
        onClick: props.onClick,
      },
      React.createElement("i", { className: props.icon }),
      React.createElement("span", null, props.label),
    )
  }

  function subscribeRuntime(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function notifyRuntimeChanged() {
    for (const listener of listeners) {
      listener()
    }
  }

  function getSnapshot(): RuntimeSnapshot {
    const taskId = activeTaskId
    const block = taskId == null ? null : resolveLoadedTaskBlock(taskId)
    const timer = block == null ? null : readTaskTimerFromBlock(block)
    if (timer != null && !timer.running && timer.activePhase === "idle" && taskId != null) {
      lastTaskId = taskId
    }

    return {
      timer,
      taskId,
      sourceBlockId: activeSourceBlockId,
      taskText: block?.text ?? "",
      nowMs: Date.now(),
    }
  }

  function recoverActiveFromLoadedBlocksOnce() {
    if (disposed) {
      return
    }

    for (const blockId of Object.keys(orca.state.blocks)) {
      const parsed = Number(blockId)
      if (!isValidDbId(parsed)) {
        continue
      }

      const block = orca.state.blocks[parsed]
      if (block == null || !hasTaskTimerSignal(block)) {
        continue
      }

      const timer = readTaskTimerFromBlock(block)
      if (timer.running && timer.sessionId !== TIMER_SESSION_ID) {
        const taskId = getMirrorId(parsed)
        void stopStaleTimer(taskId, block.id, timer)
        continue
      }
      activeTaskId = getMirrorId(parsed)
      activeSourceBlockId = block.id
      lastTaskId = activeTaskId
      if (timer.running || timer.activePhase === "paused") {
        startTicking()
        break
      }
    }

    notifyRuntimeChanged()
  }

  function refreshActiveFromCurrentTask() {
    if (activeTaskId == null) {
      notifyRuntimeChanged()
      return
    }

    const block = resolveLoadedTaskBlock(activeTaskId)
    const timer = block == null ? null : readTaskTimerFromBlock(block)
    if (timer == null || (!timer.running && timer.activePhase !== "paused")) {
      lastTaskId = activeTaskId
      activeTaskId = null
      activeSourceBlockId = null
    }

    notifyRuntimeChanged()
  }

  function handleTimerChangeEvent(event: Event) {
    const detail = (event as CustomEvent<TaskTimerChangeEventDetail>).detail
    if (detail == null || !isValidDbId(detail.taskId)) {
      return
    }

    const taskId = getMirrorId(detail.taskId)
    if (detail.running || detail.activePhase === "paused") {
      activeTaskId = taskId
      activeSourceBlockId = detail.sourceBlockId
      lastTaskId = taskId
      startTicking()
    } else if (activeTaskId === taskId) {
      lastTaskId = taskId
      activeTaskId = null
      activeSourceBlockId = null
    }
    notifyRuntimeChanged()
  }

  function hasTaskTimerSignal(block: Block): boolean {
    if (!hasTaskTagRef(block)) {
      return false
    }
    const timer = readTaskTimerFromBlock(block)
    return timer.running || timer.activePhase === "paused"
  }

  async function stopStaleTimer(taskId: DbId, sourceBlockId: DbId | null, timer: TaskTimerData) {
    const nextTimer = finalizeStaleRunningTaskTimer(timer)
    if (nextTimer === timer) {
      return
    }
    const closeRecord = readLastCloseRecord()
    const stoppedAt =
      closeRecord != null &&
        closeRecord.sessionId === timer.sessionId &&
        closeRecord.taskId === taskId
        ? closeRecord.closedAt
        : timer.startedAt ?? Date.now()

    await stopTaskTimer({
      blockId: taskId,
      sourceBlockId,
      schema,
      nowMs: stoppedAt,
    }).catch((error: unknown) => {
      console.error(error)
    })
    clearLastCloseRecord()
  }

  function resolveLoadedTaskBlock(taskId: DbId): Block | null {
    const mirrorId = getMirrorId(taskId)
    return orca.state.blocks[mirrorId] ?? orca.state.blocks[taskId] ?? null
  }

  function hasTaskTagRef(block: Block): boolean {
    const liveBlock = orca.state.blocks[getMirrorId(block.id)] ?? block
    return liveBlock.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === schema.tagAlias)
  }

  function enqueueMutation(action: () => Promise<void>) {
    mutationChain = mutationChain
      .then(action)
      .catch((error: unknown) => {
        console.error(error)
        orca.notify("error", error instanceof Error ? error.message : t("Failed to update timer"))
      })
      .finally(() => {
        refreshActiveFromCurrentTask()
      })
  }

  async function startTimerForTask(taskId: DbId, sourceBlockId: DbId | null, mode = getPluginSettings(pluginName).taskTimerMode) {
    const timer = await startTaskTimer({
      blockId: taskId,
      sourceBlockId,
      schema,
      mode,
      sessionId: TIMER_SESSION_ID,
    })
    clearLastCloseRecord()
    activeTaskId = taskId
    activeSourceBlockId = sourceBlockId
    lastTaskId = taskId
    if (timer.activeMode === "pomodoro") {
      startTicking()
    }
  }

  async function loadTimerTaskOptions(): Promise<TimerTaskOption[]> {
    const nextActions = await collectNextActions(schema)
    return nextActions
      .filter((item: NextActionItem) => {
        const timer = readTaskTimerFromBlock({
          id: item.blockId,
          properties: item.blockProperties,
        } as Block)
        return !timer.running && timer.activePhase !== "paused"
      })
      .slice(0, 20)
      .map((item: NextActionItem) => ({
        blockId: item.blockId,
        sourceBlockId: item.sourceBlockId,
        text: item.text,
      }))
  }

  function pauseActiveTimer() {
    const taskId = activeTaskId
    if (taskId == null) {
      return
    }
    enqueueMutation(async () => {
      await pauseTaskTimer({
        blockId: taskId,
        sourceBlockId: activeSourceBlockId,
        schema,
      })
    })
  }

  function resumeActiveTimer() {
    const taskId = activeTaskId
    if (taskId == null) {
      return
    }
    enqueueMutation(async () => {
      const snapshot = getSnapshot()
      await startTimerForTask(
        taskId,
        activeSourceBlockId,
        snapshot.timer?.activeMode ?? getPluginSettings(pluginName).taskTimerMode,
      )
    })
  }

  function stopActiveTimer(nowMs?: number) {
    const taskId = activeTaskId
    if (taskId == null) {
      return Promise.resolve()
    }
    return stopActiveTimerForTask(taskId, activeSourceBlockId, nowMs)
  }

  function stopActiveTimerForTask(taskId: DbId, sourceBlockId: DbId | null, nowMs?: number) {
    return new Promise<void>((resolve) => {
      enqueueMutation(async () => {
        await stopTaskTimer({
          blockId: taskId,
          sourceBlockId,
          schema,
          nowMs,
        })
        if (activeTaskId === taskId) {
          lastTaskId = taskId
          activeTaskId = null
          activeSourceBlockId = null
        }
        resolve()
      })
    })
  }

  function enterBreak() {
    const taskId = activeTaskId
    if (taskId == null) {
      return
    }
    enqueueMutation(async () => {
      const snapshot = getSnapshot()
      const completedPomodoros = snapshot.timer?.completedPomodoros ?? 0
      const breakPhase = resolveNextPomodoroBreakPhase(completedPomodoros + 1)
      if (snapshot.timer != null && isTaskTimerPomodoroPhaseComplete(snapshot.timer, snapshot.nowMs)) {
        await completeTaskTimerPomodoroPhase({
          blockId: taskId,
          sourceBlockId: activeSourceBlockId,
          schema,
          continueTo: breakPhase,
        })
      } else {
        await switchTaskTimerPhase({
          blockId: taskId,
          sourceBlockId: activeSourceBlockId,
          schema,
          phase: breakPhase,
        })
      }
    })
  }

  function startFocusPhase() {
    const taskId = activeTaskId
    if (taskId == null) {
      return
    }
    enqueueMutation(async () => {
      await switchTaskTimerPhase({
        blockId: taskId,
        sourceBlockId: activeSourceBlockId,
        schema,
        phase: "focus",
      })
    })
  }

  function finishCompletedPhase() {
    const taskId = activeTaskId
    if (taskId == null) {
      return
    }
    enqueueMutation(async () => {
      const snapshot = getSnapshot()
      const phase = snapshot.timer?.activePhase
      const continueTo =
        phase === "focus"
          ? resolveNextPomodoroBreakPhase((snapshot.timer?.completedPomodoros ?? 0) + 1)
          : "focus"
      await completeTaskTimerPomodoroPhase({
        blockId: taskId,
        sourceBlockId: activeSourceBlockId,
        schema,
        continueTo,
      })
    })
  }

  function startLastTask() {
    if (lastTaskId == null) {
      return
    }
    enqueueMutation(async () => {
      await startTimerForTask(lastTaskId as DbId, null)
    })
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "hidden") {
      return
    }
    void checkpointActiveTimer()
  }

  function handleBeforeUnload() {
    const closedAt = Date.now()
    persistLastCloseRecord(closedAt)
    void stopActiveTimer(closedAt)
  }

  function checkpointActiveTimer() {
    const taskId = activeTaskId
    if (taskId == null) {
      return Promise.resolve()
    }

    return checkpointRunningTaskTimer({
      blockId: taskId,
      sourceBlockId: activeSourceBlockId,
      schema,
    }).catch((error: unknown) => {
      console.error(error)
    })
  }

  function persistLastCloseRecord(closedAt: number) {
    const snapshot = getSnapshot()
    if (snapshot.taskId == null || snapshot.timer == null || !snapshot.timer.running) {
      return
    }

    try {
      window.localStorage.setItem(
        TIMER_CLOSE_STORAGE_KEY,
        JSON.stringify({
          sessionId: snapshot.timer.sessionId,
          taskId: snapshot.taskId,
          closedAt,
        }),
      )
    } catch (error) {
      console.error(error)
    }
  }

  function startTicking() {
    if (tickTimerId != null) {
      return
    }
    tickTimerId = window.setInterval(() => {
      if (disposed) {
        return
      }

      const snapshot = getSnapshot()
      const timer = snapshot.timer
      const noticeKey = timer == null
        ? ""
        : `${snapshot.taskId ?? ""}:${timer.startedAt ?? ""}:${timer.activePhase}`
      if (
        timer != null &&
        isTaskTimerPomodoroPhaseComplete(timer, snapshot.nowMs) &&
        noticeKey !== lastPhaseCompleteNoticeKey
      ) {
        lastPhaseCompleteNoticeKey = noticeKey
        orca.notify("info", resolvePhaseCompleteMessage(timer.activePhase), {
          title: t("Task timer"),
          action: () => finishCompletedPhase(),
        })
      }
      notifyRuntimeChanged()
    }, TICK_INTERVAL_MS)
  }

  function stopTicking() {
    if (tickTimerId != null) {
      window.clearInterval(tickTimerId)
      tickTimerId = null
    }
  }
}

function formatHeadbarTimerText(timer: TaskTimerData | null, nowMs: number): string {
  if (timer == null || (!timer.running && timer.activePhase !== "paused")) {
    return ""
  }

  const remainingMs = resolveTaskTimerPhaseRemainingMs(timer, nowMs)
  if (remainingMs != null) {
    return formatCompactDuration(remainingMs)
  }

  return formatCompactDuration(resolveTaskTimerElapsedMs(timer, nowMs))
}

function formatPopupTimerText(timer: TaskTimerData | null, nowMs: number): string {
  if (timer == null) {
    return "--:--"
  }

  if (timer.activeMode === "direct") {
    return formatTaskTimerDuration(resolveTaskTimerElapsedMs(timer, nowMs))
  }

  const remainingMs = resolveTaskTimerPhaseRemainingMs(timer, nowMs)
  if (remainingMs != null) {
    return formatCompactDuration(remainingMs)
  }

  return formatTaskTimerDuration(resolveTaskTimerElapsedMs(timer, nowMs))
}

function formatCompactDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const restMinutes = minutes % 60
    return `${hours}:${String(restMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function resolvePhaseLabel(phase: TaskTimerPhase): string {
  switch (phase) {
    case "focus":
      return t("Focus")
    case "short-break":
      return t("Short break")
    case "long-break":
      return t("Long break")
    case "paused":
      return t("Paused")
    case "idle":
      return t("Timer idle")
  }
}

function resolvePhaseCompleteMessage(phase: TaskTimerPhase): string {
  return phase === "focus"
    ? t("Focus finished")
    : t("Break finished")
}

function resolvePhaseProgress(timer: TaskTimerData, nowMs: number): number {
  if (timer.phaseDurationMs == null || timer.phaseDurationMs <= 0) {
    return 0
  }
  const remainingMs = resolveTaskTimerPhaseRemainingMs(timer, nowMs)
  if (remainingMs == null) {
    return 0
  }
  return Math.max(0, Math.min(100, ((timer.phaseDurationMs - remainingMs) / timer.phaseDurationMs) * 100))
}

function readLastCloseRecord(): {
  sessionId: string | null
  taskId: DbId
  closedAt: number
} | null {
  try {
    const raw = window.localStorage.getItem(TIMER_CLOSE_STORAGE_KEY)
    if (raw == null) {
      return null
    }

    const parsed = JSON.parse(raw) as unknown
    if (parsed == null || typeof parsed !== "object") {
      return null
    }

    const record = parsed as Record<string, unknown>
    const taskId = typeof record.taskId === "number" ? record.taskId : Number(record.taskId)
    const closedAt = typeof record.closedAt === "number" ? record.closedAt : Number(record.closedAt)
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : null
    if (!isValidDbId(taskId) || !Number.isFinite(closedAt) || Number.isNaN(closedAt) || closedAt <= 0) {
      return null
    }

    return {
      sessionId,
      taskId,
      closedAt: Math.floor(closedAt),
    }
  } catch (error) {
    console.error(error)
    return null
  }
}

function clearLastCloseRecord() {
  try {
    window.localStorage.removeItem(TIMER_CLOSE_STORAGE_KEY)
  } catch (error) {
    console.error(error)
  }
}

function injectRuntimeStyles(pluginName: string) {
  removeRuntimeStyles(pluginName)
  const styleEl = document.createElement("style")
  styleEl.dataset.role = `${pluginName}-${STYLE_ROLE}`
  styleEl.textContent = `
    .mlo-task-timer-headbar {
      gap: 5px;
      font-variant-numeric: tabular-nums;
    }
    .mlo-task-timer-headbar.is-focus {
      color: var(--orca-color-text);
    }
    .mlo-task-timer-headbar.is-break {
      color: var(--orca-color-text-1, var(--orca-color-text));
    }
    .mlo-task-timer-headbar.is-paused {
      color: var(--orca-color-text-2);
    }
    .mlo-task-timer-headbar-text {
      font-size: 11px;
      line-height: 1;
    }
    .mlo-task-timer-popup {
      width: 286px;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid var(--orca-color-border);
      border-radius: 8px;
      background: var(--orca-color-bg-1);
      color: var(--orca-color-text);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.18);
      font-family: "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .mlo-task-timer-popup-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .mlo-task-timer-popup-kicker {
      font-size: 11px;
      color: var(--orca-color-text-2);
      margin-bottom: 4px;
    }
    .mlo-task-timer-popup-title {
      max-width: 168px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--orca-color-text);
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .mlo-task-timer-popup-title:disabled {
      cursor: default;
      color: var(--orca-color-text-2);
    }
    .mlo-task-timer-popup-time {
      font-size: 24px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1;
      white-space: nowrap;
    }
    .mlo-task-timer-popup-meta {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      color: var(--orca-color-text-2);
      font-size: 11px;
    }
    .mlo-task-timer-popup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }
    .mlo-task-timer-popup-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 0 9px;
      border: 1px solid rgba(148, 163, 184, 0.32);
      border-radius: 6px;
      background: rgba(148, 163, 184, 0.1);
      color: var(--orca-color-text);
      font-size: 12px;
      cursor: pointer;
    }
    .mlo-task-timer-popup-action:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }
    .mlo-task-timer-popup-task-picker {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--orca-color-border);
    }
    .mlo-task-timer-popup-section-title {
      font-size: 11px;
      color: var(--orca-color-text-2);
    }
    .mlo-task-timer-popup-empty {
      padding: 8px;
      border-radius: 6px;
      background: var(--orca-color-bg-2);
      color: var(--orca-color-text-2);
      font-size: 12px;
    }
    .mlo-task-timer-popup-progress {
      height: 4px;
      margin-top: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(148, 163, 184, 0.16);
    }
    .mlo-task-timer-popup-progress > div {
      height: 100%;
      border-radius: inherit;
      background: var(--orca-color-text-blue, #2563eb);
      transition: width 160ms ease;
    }
  `
  document.head.appendChild(styleEl)
}

function removeRuntimeStyles(pluginName: string) {
  const styleEls = document.querySelectorAll(`style[data-role="${pluginName}-${STYLE_ROLE}"]`)
  styleEls.forEach((item) => item.remove())
}
