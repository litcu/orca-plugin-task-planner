import { describe, expect, it } from "vitest"
import {
  TASK_TIMER_PROPERTY_NAME,
  createDefaultTaskTimerData,
  finalizeTaskTimerState,
  getDefaultTaskTimerPomodoroSettings,
  readTaskTimerFromProperties,
  resolveTaskPomodoroPhaseDurationMs,
  startTaskTimerState,
} from "../src/core/task-timer"

describe("task-timer pomodoro state", () => {
  it("兼容 schema 1 计时数据迁移", () => {
    const timer = readTaskTimerFromProperties([
      {
        name: TASK_TIMER_PROPERTY_NAME,
        type: 0,
        value: {
          schema: 1,
          elapsedMs: 60_000,
          running: true,
          startedAt: 1_000,
        },
      },
    ] as any)

    expect(timer.elapsedMs).toBe(60_000)
    expect(timer.running).toBe(true)
    expect(timer.startedAt).toBe(1_000)
    expect(timer.sessionKind).toBeNull()
    expect(timer.phase).toBeNull()
    expect(timer.completedPomodoros).toBe(0)
    expect(timer.focusStreakCount).toBe(0)
  })

  it("开始番茄时会进入专注阶段", () => {
    const settings = getDefaultTaskTimerPomodoroSettings()
    const timer = startTaskTimerState(
      createDefaultTaskTimerData(),
      "pomodoro",
      1_000,
      settings,
    )

    expect(timer.running).toBe(true)
    expect(timer.sessionKind).toBe("pomodoro")
    expect(timer.phase).toBe("focus")
    expect(timer.phaseElapsedMs).toBe(0)
    expect(timer.phaseDurationMs).toBe(resolveTaskPomodoroPhaseDurationMs("focus", settings))
  })

  it("暂停后再次开始会继续当前专注阶段", () => {
    const settings = getDefaultTaskTimerPomodoroSettings()
    const runningFocus = startTaskTimerState(
      createDefaultTaskTimerData(),
      "pomodoro",
      1_000,
      settings,
    )
    const pausedFocus = finalizeTaskTimerState(runningFocus, 1_000 + 5 * 60 * 1_000)
    const resumedFocus = startTaskTimerState(
      pausedFocus,
      "pomodoro",
      1_000 + 6 * 60 * 1_000,
      settings,
    )

    expect(pausedFocus.running).toBe(false)
    expect(pausedFocus.phase).toBe("focus")
    expect(pausedFocus.phaseElapsedMs).toBe(5 * 60 * 1_000)
    expect(pausedFocus.elapsedMs).toBe(5 * 60 * 1_000)
    expect(resumedFocus.running).toBe(true)
    expect(resumedFocus.phase).toBe("focus")
    expect(resumedFocus.phaseElapsedMs).toBe(5 * 60 * 1_000)
  })

  it("完成一个专注阶段后会累计番茄数，并在下一次开始进入短休", () => {
    const settings = getDefaultTaskTimerPomodoroSettings()
    const focusDuration = resolveTaskPomodoroPhaseDurationMs("focus", settings)
    const runningFocus = startTaskTimerState(
      createDefaultTaskTimerData(),
      "pomodoro",
      1_000,
      settings,
    )
    const completedFocus = finalizeTaskTimerState(runningFocus, 1_000 + focusDuration)
    const nextPhase = startTaskTimerState(completedFocus, "pomodoro", 2_000 + focusDuration, settings)

    expect(completedFocus.running).toBe(false)
    expect(completedFocus.phase).toBe("focus")
    expect(completedFocus.phaseElapsedMs).toBe(focusDuration)
    expect(completedFocus.elapsedMs).toBe(focusDuration)
    expect(completedFocus.completedPomodoros).toBe(1)
    expect(completedFocus.focusStreakCount).toBe(1)
    expect(nextPhase.phase).toBe("short-break")
    expect(nextPhase.phaseDurationMs).toBe(resolveTaskPomodoroPhaseDurationMs("short-break", settings))
  })

  it("达到长休阈值后下一段会进入长休", () => {
    const settings = getDefaultTaskTimerPomodoroSettings()
    const focusDuration = resolveTaskPomodoroPhaseDurationMs("focus", settings)
    const completedFocus = {
      ...createDefaultTaskTimerData(),
      sessionKind: "pomodoro" as const,
      phase: "focus" as const,
      phaseElapsedMs: focusDuration,
      phaseDurationMs: focusDuration,
      completedPomodoros: settings.longBreakEvery,
      focusStreakCount: settings.longBreakEvery,
    }

    const nextPhase = startTaskTimerState(completedFocus, "pomodoro", 10_000, settings)

    expect(nextPhase.phase).toBe("long-break")
    expect(nextPhase.phaseDurationMs).toBe(resolveTaskPomodoroPhaseDurationMs("long-break", settings))
  })

  it("长休结束后会重置 streak，且休息不会计入任务投入", () => {
    const settings = getDefaultTaskTimerPomodoroSettings()
    const longBreakDuration = resolveTaskPomodoroPhaseDurationMs("long-break", settings)
    const runningLongBreak = {
      ...createDefaultTaskTimerData(),
      elapsedMs: 25 * 60 * 1_000,
      running: true,
      startedAt: 1_000,
      sessionKind: "pomodoro" as const,
      phase: "long-break" as const,
      phaseElapsedMs: 0,
      phaseDurationMs: longBreakDuration,
      completedPomodoros: 4,
      focusStreakCount: 4,
    }

    const completedLongBreak = finalizeTaskTimerState(
      runningLongBreak,
      1_000 + longBreakDuration,
    )
    const cleared = finalizeTaskTimerState(completedLongBreak, 1_000 + longBreakDuration, true)

    expect(completedLongBreak.elapsedMs).toBe(25 * 60 * 1_000)
    expect(completedLongBreak.focusStreakCount).toBe(0)
    expect(cleared.phase).toBeNull()
    expect(cleared.focusStreakCount).toBe(0)
    expect(cleared.elapsedMs).toBe(25 * 60 * 1_000)
  })
})
