import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId, isValidDbId } from "./block-utils"
import {
  addTaskToMyDayState,
  ensureMyDayMirrorInTodayJournal,
  loadMyDayState,
  removeTaskFromMyDayState,
  saveMyDayState,
  setMyDayJournalSectionBlockId,
  setMyDayTaskMirrorBlockId,
  syncMyDayJournalEntrySchedule,
  type MyDayState,
} from "./my-day-state"

const MY_DAY_STATE_CHANGE_EVENT = "mlo:my-day-state-change"

interface MyDayMutationOptions {
  taskId: DbId
  sourceBlockId?: DbId | null
  sectionTitle?: string
}

export interface MyDayStateChangeEventDetail {
  pluginName: string
  state: MyDayState
}

type MyDayStateMutation = (baseState: MyDayState) => Promise<MyDayState | null> | MyDayState | null

export type MyDayMutationAction = "added" | "removed"

export interface MyDayToggleResult {
  state: MyDayState | null
  action: MyDayMutationAction | null
}

let myDayMutationChain: Promise<void> = Promise.resolve()
const myDayStateCache = new Map<string, MyDayState>()

export async function runMyDayStateMutation(
  pluginName: string,
  resetHour: number,
  mutate: MyDayStateMutation,
): Promise<MyDayState | null> {
  let result: MyDayState | null = null
  myDayMutationChain = myDayMutationChain.then(async () => {
    try {
      const baseState = await loadMyDayState(pluginName, resetHour)
      myDayStateCache.set(pluginName, baseState)
      const nextState = await mutate(baseState)
      if (nextState == null || nextState === baseState) {
        result = baseState
        return
      }

      const savedState = await saveMyDayState(pluginName, nextState)
      myDayStateCache.set(pluginName, savedState)
      result = savedState
      dispatchMyDayStateChange(pluginName, savedState)
    } catch (error) {
      console.error(error)
      result = null
    }
  })

  await myDayMutationChain
  return result
}

export function getCachedMyDayState(pluginName: string): MyDayState | null {
  return myDayStateCache.get(pluginName) ?? null
}

export function peekMyDayTaskState(pluginName: string, taskId: DbId): boolean | null {
  const cachedState = myDayStateCache.get(pluginName)
  if (cachedState == null) {
    return null
  }

  return isTaskInMyDay(cachedState, taskId)
}

export async function primeMyDayStateCache(
  pluginName: string,
  resetHour: number,
): Promise<MyDayState> {
  const state = await loadMyDayState(pluginName, resetHour)
  myDayStateCache.set(pluginName, state)
  return state
}

export async function addTaskToMyDayStateWithSync(
  baseState: MyDayState,
  options: MyDayMutationOptions,
): Promise<MyDayState> {
  const sectionTitle = options.sectionTitle ?? t("My Day")
  let nextState = addTaskToMyDayState(baseState, {
    taskId: options.taskId,
    sourceBlockId: options.sourceBlockId,
  }).state

  const mirrorResult = await ensureMyDayMirrorInTodayJournal({
    taskId: options.taskId,
    dayKey: nextState.dayKey,
    sectionTitle,
    existingSectionBlockId: nextState.journalSectionBlockId,
  })

  if (mirrorResult.journalSectionBlockId != null) {
    nextState = setMyDayJournalSectionBlockId(
      nextState,
      mirrorResult.journalSectionBlockId,
    )
  }

  if (mirrorResult.mirrorBlockId != null) {
    nextState = setMyDayTaskMirrorBlockId(
      nextState,
      options.taskId,
      mirrorResult.mirrorBlockId,
    )
    const entry = nextState.tasks.find((item) => item.taskId === getMirrorId(options.taskId))
    if (entry != null) {
      await syncMyDayJournalEntrySchedule({
        taskId: entry.taskId,
        mirrorBlockId: mirrorResult.mirrorBlockId,
        scheduleStartMinute: entry.scheduleStartMinute,
        scheduleEndMinute: entry.scheduleEndMinute,
      })
    }
  } else {
    orca.notify("warn", t("Failed to sync My Day journal"))
  }

  return nextState
}

export async function removeTaskFromMyDayStateWithSync(
  baseState: MyDayState,
  taskId: DbId,
): Promise<MyDayState> {
  const removeResult = removeTaskFromMyDayState(baseState, taskId)
  if (!removeResult.removed) {
    return baseState
  }

  return removeResult.state
}

export async function toggleTaskInMyDay(
  pluginName: string,
  resetHour: number,
  options: MyDayMutationOptions,
): Promise<MyDayToggleResult> {
  let action: MyDayMutationAction | null = null
  const state = await runMyDayStateMutation(pluginName, resetHour, async (baseState: MyDayState) => {
    if (isTaskInMyDay(baseState, options.taskId)) {
      action = "removed"
      return await removeTaskFromMyDayStateWithSync(baseState, options.taskId)
    }

    action = "added"
    return await addTaskToMyDayStateWithSync(baseState, options)
  })

  return {
    state,
    action: state == null ? null : action,
  }
}

export function getMyDayMutationSuccessMessage(action: MyDayMutationAction): string {
  return action === "removed" ? t("Removed from My Day") : t("Added to My Day")
}

export function isTaskInMyDay(state: MyDayState, taskId: DbId): boolean {
  const normalizedTaskId = getMirrorId(taskId)
  if (!isValidDbId(normalizedTaskId)) {
    return false
  }

  return state.tasks.some((item) => item.taskId === normalizedTaskId)
}

export function subscribeMyDayStateChange(
  onChange: (detail: MyDayStateChangeEventDetail) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<MyDayStateChangeEventDetail>).detail
    if (detail == null || typeof detail.pluginName !== "string" || detail.state == null) {
      return
    }

    onChange(detail)
  }

  window.addEventListener(MY_DAY_STATE_CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener(MY_DAY_STATE_CHANGE_EVENT, listener)
  }
}

function dispatchMyDayStateChange(pluginName: string, state: MyDayState) {
  window.dispatchEvent(
    new CustomEvent<MyDayStateChangeEventDetail>(MY_DAY_STATE_CHANGE_EVENT, {
      detail: {
        pluginName,
        state,
      },
    }),
  )
}
