export type TaskViewsTab =
  | "next-actions"
  | "all-tasks"
  | "starred-tasks"
  | "due-soon"

const TASK_VIEWS_TAB_EVENT = "mlo:task-views-tab-change"

let preferredTaskViewsTab: TaskViewsTab = "next-actions"

export function isTaskViewsTab(tab: unknown): tab is TaskViewsTab {
  return tab === "next-actions" ||
    tab === "all-tasks" ||
    tab === "starred-tasks" ||
    tab === "due-soon"
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
