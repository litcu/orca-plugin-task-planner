export type TaskViewsTab = "next-actions" | "all-tasks"

const TASK_VIEWS_TAB_EVENT = "mlo:task-views-tab-change"

let preferredTaskViewsTab: TaskViewsTab = "next-actions"

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
    if (detail === "next-actions" || detail === "all-tasks") {
      onChange(detail)
    }
  }

  window.addEventListener(TASK_VIEWS_TAB_EVENT, listener)
  return () => {
    window.removeEventListener(TASK_VIEWS_TAB_EVENT, listener)
  }
}
