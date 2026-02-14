export type BuiltinTaskViewsTab =
  | "dashboard"
  | "next-actions"
  | "all-tasks"
  | "starred-tasks"
  | "due-soon"
  | "review-due"

export type CustomTaskViewsTab = `custom:${string}`
export type TaskViewsTab = BuiltinTaskViewsTab | CustomTaskViewsTab

const CUSTOM_TASK_VIEWS_TAB_PREFIX = "custom:"

const TASK_VIEWS_TAB_EVENT = "mlo:task-views-tab-change"

let preferredTaskViewsTab: TaskViewsTab = "next-actions"

export function isTaskViewsTab(tab: unknown): tab is TaskViewsTab {
  return tab === "dashboard" ||
    tab === "next-actions" ||
    tab === "all-tasks" ||
    tab === "starred-tasks" ||
    tab === "due-soon" ||
    tab === "review-due" ||
    isCustomTaskViewsTab(tab)
}

export function isCustomTaskViewsTab(tab: unknown): tab is CustomTaskViewsTab {
  return typeof tab === "string" &&
    tab.startsWith(CUSTOM_TASK_VIEWS_TAB_PREFIX) &&
    tab.length > CUSTOM_TASK_VIEWS_TAB_PREFIX.length
}

export function toCustomTaskViewsTab(viewId: string): CustomTaskViewsTab {
  return `${CUSTOM_TASK_VIEWS_TAB_PREFIX}${viewId}`
}

export function getCustomTaskViewIdFromTab(tab: TaskViewsTab): string | null {
  if (!isCustomTaskViewsTab(tab)) {
    return null
  }

  return tab.slice(CUSTOM_TASK_VIEWS_TAB_PREFIX.length)
}

export function getPreferredTaskViewsTab(): TaskViewsTab {
  return preferredTaskViewsTab
}

export function setPreferredTaskViewsTab(tab: TaskViewsTab) {
  preferredTaskViewsTab = tab
  window.dispatchEvent(
    new CustomEvent<TaskViewsTab>(TASK_VIEWS_TAB_EVENT, {
      detail: tab,
    }),
  )
}

export function subscribePreferredTaskViewsTab(
  onChange: (tab: TaskViewsTab) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TaskViewsTab>).detail
    if (isTaskViewsTab(detail)) {
      onChange(detail)
    }
  }

  window.addEventListener(TASK_VIEWS_TAB_EVENT, listener)
  return () => {
    window.removeEventListener(TASK_VIEWS_TAB_EVENT, listener)
  }
}
