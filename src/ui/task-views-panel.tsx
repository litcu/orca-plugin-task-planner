import type {
  Block,
  BlockProperty,
  BlockRef,
  DbId,
  PanelProps,
} from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  getCustomTaskViewIdFromTab,
  getPreferredTaskViewsTab,
  isCustomTaskViewsTab,
  isTaskViewsTab,
  setPreferredTaskViewsTab,
  subscribePreferredTaskViewsTab,
  toCustomTaskViewsTab,
  type TaskViewsTab,
} from "../core/task-views-state"
import {
  collectNextActionEvaluations,
  collectNextActions,
  selectNextActionsFromEvaluations,
  type NextActionBlockedReason,
  type NextActionEvaluation,
  type NextActionItem,
} from "../core/dependency-engine"
import {
  collectAllTasks,
  countTaskDependentsForDeleteInView,
  cycleTaskStatusInView,
  deleteTaskBlockInView,
  markTaskReviewedInView,
  moveTaskInView,
  removeTaskTagInView,
  toggleTaskStarInView,
  type AllTaskItem,
} from "../core/all-tasks-engine"
import {
  getPluginSettings,
  type TaskPlannerSettings,
} from "../core/plugin-settings"
import {
  addTaskToMyDayState,
  ensureMyDayMirrorInTodayJournal,
  loadMyDayState,
  pruneMissingMyDayTasks,
  removeMyDayMirrorBlock,
  removeTaskFromMyDayState,
  resolveMyDayKey,
  saveMyDayState,
  setMyDayDisplayMode,
  setMyDayJournalSectionBlockId,
  setMyDayTaskMirrorBlockId,
  updateMyDayTaskSchedule,
  type MyDayDisplayMode,
  type MyDayState,
  type MyDayTaskEntry,
} from "../core/my-day-state"
import {
  cloneCustomTaskViewFilterGroup,
  createCustomTaskViewId,
  createDefaultCustomTaskViewFilterGroup,
  loadCustomTaskViews,
  normalizeCustomTaskViewFilterGroup,
  normalizeCustomTaskViewName,
  saveCustomTaskViews,
  type CustomTaskViewFilterFieldType,
  type CustomTaskViewFilterGroupLogic,
  type CustomTaskViewFilterGroupNode,
  type CustomTaskViewFilterNode,
  type CustomTaskViewFilterOperator,
  type CustomTaskViewFilterRuleNode,
  type CustomTaskView,
} from "../core/custom-task-views"
import { getMirrorId } from "../core/block-utils"
import { TASK_META_PROPERTY_NAME } from "../core/task-meta"
import { parseReviewRule, type ReviewUnit } from "../core/task-review"
import {
  readTaskTimerFromProperties,
  startTaskTimer,
  stopTaskTimer,
} from "../core/task-timer"
import { t } from "../libs/l10n"
import {
  TaskDashboard,
  type TaskDashboardData,
  type TaskDashboardQuickFilter,
} from "./task-dashboard"
import {
  MyDayScheduleBoard,
  type MyDayScheduleTaskItem,
} from "./my-day-schedule-board"
import { TaskListRow, type TaskListRowItem } from "./task-list-row"
import { openTaskPropertyPopup } from "./task-property-panel"

interface TaskViewsPanelProps extends PanelProps {
  schema: TaskSchemaDefinition
  pluginName: string
}

interface TaskTreeNode {
  item: AllTaskItem
  children: TaskTreeNode[]
  contextOnly: boolean
}

interface VisibleTreeRow {
  node: TaskTreeNode
  depth: number
  hasChildren: boolean
  collapsed: boolean
}

type TaskDropPosition = "before" | "child" | "after"

interface TaskDropTarget {
  targetTaskId: DbId
  position: TaskDropPosition
}

type TaskFilterGroupLogic = CustomTaskViewFilterGroupLogic
type TaskFilterFieldType = CustomTaskViewFilterFieldType | "review-rule"
type TaskFilterOperator = CustomTaskViewFilterOperator
type TaskFilterRuleNode = CustomTaskViewFilterRuleNode
type TaskFilterGroupNode = CustomTaskViewFilterGroupNode
type TaskFilterNode = CustomTaskViewFilterNode

interface TaskFilterField {
  key: string
  aliasKeys?: string[]
  label: string
  type: TaskFilterFieldType
  options: TaskFilterFieldOption[]
  operatorOptions?: TaskFilterOperator[]
  resolveOptionLabel?: (value: string) => string
  defaultValue?: string | string[]
  extractValue: (item: FilterableTaskItem) => unknown
}

interface TaskFilterFieldOption {
  value: string
  label: string
}

interface FilterableTaskItem {
  blockId?: DbId
  sourceBlockId?: DbId
  status: string
  text: string
  endTime?: Date | null
  reviewEnabled?: boolean
  reviewType?: string
  reviewEvery?: string
  labels?: string[]
  taskTagRef?: BlockRef | null
  blockProperties?: BlockProperty[]
}

const PROP_TYPE_TEXT = 1
const PROP_TYPE_BLOCK_REFS = 2
const PROP_TYPE_NUMBER = 3
const PROP_TYPE_BOOLEAN = 4
const PROP_TYPE_DATE_TIME = 5
const PROP_TYPE_TEXT_CHOICES = 6
const FILTER_TASK_NAME_FIELD_KEY = "__task_name__"
const FILTER_GROUP_ROOT_ID = "__root__"
const TASK_FILTER_SELECT_MENU_CLASS_NAME = "mlo-task-filter-select-menu"
const TASK_FILTER_PROPERTY_UNRESOLVED = Symbol("task-filter-property-unresolved")
const DAY_MS = 24 * 60 * 60 * 1000
const DASHBOARD_DUE_DAYS = 7

type BlockedReasonCountMap = Partial<Record<NextActionBlockedReason, number>>
type DashboardListQuickFilter = TaskDashboardQuickFilter | null

const DASHBOARD_ACTIONABLE_BLOCKED_REASON_SET = new Set<NextActionBlockedReason>([
  "dependency-unmet",
  "has-open-children",
  "not-started",
  "dependency-delayed",
  "ancestor-dependency-unmet",
])

export function TaskViewsPanel(props: TaskViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const ConfirmBox = orca.components.ConfirmBox
  const DatePicker = orca.components.DatePicker
  const Input = orca.components.Input
  const ModalOverlay = orca.components.ModalOverlay
  const Popup = orca.components.Popup
  const Select = orca.components.Select
  const Segmented = orca.components.Segmented
  const Switch = orca.components.Switch

  const isChinese = orca.state.locale === "zh-CN"
  const [tab, setTab] = React.useState<TaskViewsTab>(() => {
    return getPreferredTaskViewsTab()
  })
  const customViewsButtonAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const filterButtonAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const viewSwitcherContainerRef = React.useRef<HTMLDivElement | null>(null)
  const panelRootRef = React.useRef<HTMLDivElement | null>(null)
  const filterPopupContainerRef = React.useRef<HTMLDivElement | null>(null)
  const customViewFilterPopupContainerRef = React.useRef<HTMLDivElement | null>(null)
  const filterMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (filterMenuContainerRef.current == null) {
    filterMenuContainerRef.current = document.body
  }
  const [loading, setLoading] = React.useState(true)
  const [errorText, setErrorText] = React.useState("")
  const [customViews, setCustomViews] = React.useState<CustomTaskView[]>([])
  const [customViewsLoaded, setCustomViewsLoaded] = React.useState(false)
  const [customViewsPanelVisible, setCustomViewsPanelVisible] = React.useState(false)
  const [customViewEditorVisible, setCustomViewEditorVisible] = React.useState(false)
  const [editingCustomViewId, setEditingCustomViewId] = React.useState<string | null>(null)
  const [customViewNameDraft, setCustomViewNameDraft] = React.useState("")
  const [customViewNameError, setCustomViewNameError] = React.useState("")
  const [customViewFilterDraft, setCustomViewFilterDraft] = React.useState<TaskFilterGroupNode>(() =>
    createDefaultCustomTaskViewFilterGroup()
  )
  const [savingCustomView, setSavingCustomView] = React.useState(false)
  const [filterPanelVisible, setFilterPanelVisible] = React.useState(false)
  const [quickSearchKeyword, setQuickSearchKeyword] = React.useState("")
  const [viewSwitcherWidth, setViewSwitcherWidth] = React.useState(0)
  const [taskTagProperties, setTaskTagProperties] = React.useState<BlockProperty[]>([])
  const [filterRoot, setFilterRoot] = React.useState<TaskFilterGroupNode>(() =>
    createTaskFilterGroup(FILTER_GROUP_ROOT_ID, "and")
  )
  const [showCompletedInAllTasks, setShowCompletedInAllTasks] = React.useState(true)
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())
  const [timingIds, setTimingIds] = React.useState<Set<DbId>>(new Set())
  const [starringIds, setStarringIds] = React.useState<Set<DbId>>(new Set())
  const [reviewingIds, setReviewingIds] = React.useState<Set<DbId>>(new Set())
  const [selectedReviewIds, setSelectedReviewIds] = React.useState<Set<DbId>>(new Set())
  const [movingIds, setMovingIds] = React.useState<Set<DbId>>(new Set())
  const [collapsedIds, setCollapsedIds] = React.useState<Set<DbId>>(new Set())
  const [draggingTaskId, setDraggingTaskId] = React.useState<DbId | null>(null)
  const [dropTarget, setDropTarget] = React.useState<TaskDropTarget | null>(null)
  const [nextActionItems, setNextActionItems] = React.useState<NextActionItem[]>([])
  const [allTaskItems, setAllTaskItems] = React.useState<AllTaskItem[]>([])
  const [allTaskItemsLoaded, setAllTaskItemsLoaded] = React.useState(false)
  const [dashboardBlockedCounts, setDashboardBlockedCounts] = React.useState<BlockedReasonCountMap>(
    {},
  )
  const [dashboardBlockedTaskIds, setDashboardBlockedTaskIds] = React.useState<Set<DbId>>(
    () => new Set(),
  )
  const [dashboardQuickFilter, setDashboardQuickFilter] = React.useState<DashboardListQuickFilter>(
    null,
  )
  const [dashboardGeneratedAt, setDashboardGeneratedAt] = React.useState<Date>(() => new Date())
  const [timerNowMs, setTimerNowMs] = React.useState<number>(() => Date.now())
  const [panelSettings, setPanelSettings] = React.useState<TaskPlannerSettings>(() =>
    getPluginSettings(props.pluginName)
  )
  const [myDayState, setMyDayState] = React.useState<MyDayState | null>(null)
  const [myDayLoaded, setMyDayLoaded] = React.useState(false)
  const [myDaySaving, setMyDaySaving] = React.useState(false)
  const [myDayUpdatingIds, setMyDayUpdatingIds] = React.useState<Set<DbId>>(
    () => new Set(),
  )
  const myDayStateRef = React.useRef<MyDayState | null>(null)
  if (myDayStateRef.current !== myDayState) {
    myDayStateRef.current = myDayState
  }
  const myDayMutationChainRef = React.useRef<Promise<void>>(Promise.resolve())
  const activeCustomViewId = React.useMemo(() => {
    return getCustomTaskViewIdFromTab(tab)
  }, [tab])
  const activeCustomView = React.useMemo(() => {
    if (activeCustomViewId == null) {
      return null
    }

    return customViews.find((view: CustomTaskView) => view.id === activeCustomViewId) ?? null
  }, [activeCustomViewId, customViews])

  React.useEffect(() => {
    const styleRole = getTaskFilterSelectMenuStyleRole(props.pluginName)
    const existing = document.querySelector(`style[data-role="${styleRole}"]`)
    if (existing != null) {
      return
    }

    const styleEl = document.createElement("style")
    styleEl.dataset.role = styleRole
    styleEl.innerHTML = `
      .${TASK_FILTER_SELECT_MENU_CLASS_NAME} {
        max-height: min(320px, calc(100vh - 28px));
        overflow: hidden;
        overscroll-behavior: contain;
      }
    `
    document.head.appendChild(styleEl)
    return () => {
      styleEl.remove()
    }
  }, [props.pluginName])

  React.useEffect(() => {
    const container = viewSwitcherContainerRef.current
    if (container == null) {
      return
    }

    const updateWidth = () => {
      const nextWidth = container.getBoundingClientRect().width
      setViewSwitcherWidth((prev: number) => {
        if (Math.abs(prev - nextWidth) < 1) {
          return prev
        }
        return nextWidth
      })
    }

    updateWidth()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth)
      return () => {
        window.removeEventListener("resize", updateWidth)
      }
    }

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [])

  const loadByTab = React.useCallback(
    async (
      targetTab: TaskViewsTab,
      options?: { silent?: boolean },
    ) => {
      const silent = options?.silent === true
      if (!silent) {
        setLoading(true)
      }

      try {
        if (targetTab === "dashboard") {
          const [allTasks, evaluations] = await Promise.all([
            collectAllTasks(props.schema),
            collectNextActionEvaluations(props.schema),
          ])
          setAllTaskItems(allTasks)
          setAllTaskItemsLoaded(true)
          setNextActionItems(selectNextActionsFromEvaluations(evaluations))
          setDashboardBlockedCounts(countBlockedReasons(evaluations))
          setDashboardBlockedTaskIds(collectDashboardBlockedTaskIds(evaluations))
          setDashboardGeneratedAt(new Date())
        } else if (targetTab === "next-actions") {
          const nextActions = await collectNextActions(props.schema)
          setNextActionItems(nextActions)
        } else if (targetTab === "my-day") {
          const allTasks = await collectAllTasks(props.schema)
          setAllTaskItems(allTasks)
          setAllTaskItemsLoaded(true)
        } else if (isCustomTaskViewsTab(targetTab)) {
          const allTasks = await collectAllTasks(props.schema)
          setAllTaskItems(allTasks)
          setAllTaskItemsLoaded(true)
        } else {
          const allTasks = await collectAllTasks(props.schema)
          setAllTaskItems(allTasks)
          setAllTaskItemsLoaded(true)
        }

        setErrorText("")
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to load task view"))
      } finally {
        if (!silent) {
          setLoading(false)
        }
      }
    },
    [customViews, props.schema],
  )

  const loadTaskTagProperties = React.useCallback(async () => {
    try {
      const tagBlock = (await orca.invokeBackend(
        "get-block-by-alias",
        props.schema.tagAlias,
      )) as Block | null
      setTaskTagProperties(Array.isArray(tagBlock?.properties) ? tagBlock.properties : [])
    } catch (error) {
      console.error(error)
      setTaskTagProperties([])
    }
  }, [props.schema.tagAlias])

  React.useEffect(() => {
    return subscribePreferredTaskViewsTab((nextTab) => {
      setTab(nextTab)
    })
  }, [])

  React.useEffect(() => {
    const pluginState = orca.state.plugins[props.pluginName]
    if (pluginState == null) {
      setPanelSettings(getPluginSettings(props.pluginName))
      return
    }

    const { subscribe } = window.Valtio
    setPanelSettings(getPluginSettings(props.pluginName))
    return subscribe(pluginState, () => {
      setPanelSettings(getPluginSettings(props.pluginName))
    })
  }, [props.pluginName])

  const runMyDayStateMutation = React.useCallback(
    async (
      mutate: (baseState: MyDayState) => Promise<MyDayState | null> | MyDayState | null,
      options?: {
        silentError?: boolean
      },
    ): Promise<MyDayState | null> => {
      let result: MyDayState | null = null

      myDayMutationChainRef.current = myDayMutationChainRef.current.then(async () => {
        setMyDaySaving(true)
        try {
          const baseState =
            myDayStateRef.current ??
            await loadMyDayState(props.pluginName, panelSettings.myDayResetHour)
          if (myDayStateRef.current == null) {
            setMyDayState(baseState)
            myDayStateRef.current = baseState
          }

          const nextState = await mutate(baseState)
          if (nextState == null || nextState === baseState) {
            result = baseState
            return
          }

          const savedState = await saveMyDayState(props.pluginName, nextState)
          setMyDayState(savedState)
          myDayStateRef.current = savedState
          result = savedState
        } catch (error) {
          console.error(error)
          if (options?.silentError !== true) {
            setErrorText(t("Failed to update My Day"))
          }
          result = null
        } finally {
          setMyDaySaving(false)
        }
      })

      await myDayMutationChainRef.current
      return result
    },
    [panelSettings.myDayResetHour, props.pluginName],
  )

  React.useEffect(() => {
    let cancelled = false
    setMyDayLoaded(false)

    const run = async () => {
      try {
        const loadedState = await loadMyDayState(
          props.pluginName,
          panelSettings.myDayResetHour,
        )
        if (cancelled) {
          return
        }

        setMyDayState(loadedState)
        myDayStateRef.current = loadedState
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setErrorText(t("Failed to load My Day"))
        }
      } finally {
        if (!cancelled) {
          setMyDayLoaded(true)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [panelSettings.myDayResetHour, props.pluginName])

  React.useEffect(() => {
    const timerId = window.setInterval(() => {
      const currentState = myDayStateRef.current
      if (currentState == null) {
        return
      }

      const currentDayKey = resolveMyDayKey(new Date(), panelSettings.myDayResetHour)
      if (currentState.dayKey === currentDayKey) {
        return
      }

      void (async () => {
        try {
          const refreshedState = await loadMyDayState(
            props.pluginName,
            panelSettings.myDayResetHour,
          )
          setMyDayState(refreshedState)
          myDayStateRef.current = refreshedState
        } catch (error) {
          console.error(error)
        }
      })()
    }, 60 * 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [panelSettings.myDayResetHour, props.pluginName])

  React.useEffect(() => {
    if (tab !== "my-day") {
      return
    }
    if (panelSettings.myDayEnabled) {
      return
    }

    setPreferredTaskViewsTab("next-actions")
  }, [panelSettings.myDayEnabled, tab])

  const myDayJournalSyncKey = React.useMemo(() => {
    if (myDayState == null) {
      return ""
    }
    const taskIdSignature = myDayState.tasks
      .map((item: MyDayTaskEntry) => Number(item.taskId))
      .filter((taskId: number) => Number.isFinite(taskId))
      .sort((left: number, right: number) => left - right)
      .join(",")
    return `${myDayState.dayKey}:${taskIdSignature}`
  }, [myDayState])
  const myDayJournalSyncKeyRef = React.useRef<string>("")

  React.useEffect(() => {
    if (!panelSettings.myDayEnabled || !myDayLoaded || myDayState == null) {
      return
    }
    if (myDayState.tasks.length === 0) {
      return
    }
    if (myDayJournalSyncKeyRef.current === myDayJournalSyncKey) {
      return
    }

    myDayJournalSyncKeyRef.current = myDayJournalSyncKey
    let cancelled = false
    const run = async () => {
      try {
        const savedState = await runMyDayStateMutation(
          async (baseState: MyDayState) => {
            if (baseState.tasks.length === 0) {
              return baseState
            }

            let nextState = baseState
            let changed = false
            for (const entry of baseState.tasks) {
              if (cancelled) {
                return baseState
              }

              const mirrorResult = await ensureMyDayMirrorInTodayJournal({
                taskId: entry.taskId,
                dayKey: nextState.dayKey,
                sectionTitle: t("My Day"),
                existingSectionBlockId: nextState.journalSectionBlockId,
              })

              if (
                mirrorResult.journalSectionBlockId != null &&
                mirrorResult.journalSectionBlockId !== nextState.journalSectionBlockId
              ) {
                nextState = setMyDayJournalSectionBlockId(
                  nextState,
                  mirrorResult.journalSectionBlockId,
                )
                changed = true
              }

              const currentEntry = nextState.tasks.find((item: MyDayTaskEntry) => {
                return item.taskId === getMirrorId(entry.taskId)
              }) ?? null
              if (
                mirrorResult.mirrorBlockId != null &&
                mirrorResult.mirrorBlockId !== currentEntry?.mirrorBlockId
              ) {
                nextState = setMyDayTaskMirrorBlockId(
                  nextState,
                  entry.taskId,
                  mirrorResult.mirrorBlockId,
                )
                changed = true
              }
            }

            return changed ? nextState : baseState
          },
          { silentError: true },
        )
        if (savedState != null && !cancelled) {
          setErrorText("")
        }
      } catch (error) {
        console.error(error)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [
    myDayJournalSyncKey,
    myDayLoaded,
    myDayState,
    panelSettings.myDayEnabled,
    runMyDayStateMutation,
  ])

  React.useEffect(() => {
    if (!panelSettings.taskTimerEnabled) {
      return
    }

    setTimerNowMs(Date.now())
    const timerId = window.setInterval(() => {
      setTimerNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [panelSettings.taskTimerEnabled])

  React.useEffect(() => {
    let cancelled = false
    setCustomViewsLoaded(false)

    const run = async () => {
      try {
        const views = await loadCustomTaskViews(props.pluginName)
        if (cancelled) {
          return
        }

        setCustomViews(views)
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setErrorText(t("Failed to load custom views"))
        }
      } finally {
        if (!cancelled) {
          setCustomViewsLoaded(true)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [props.pluginName])

  React.useEffect(() => {
    if (!isCustomTaskViewsTab(tab) || !customViewsLoaded) {
      return
    }

    const customViewId = getCustomTaskViewIdFromTab(tab)
    const exists = customViews.some((view: CustomTaskView) => view.id === customViewId)
    if (!exists) {
      setPreferredTaskViewsTab("next-actions")
    }
  }, [customViews, customViewsLoaded, tab])

  React.useEffect(() => {
    void loadByTab(tab)
  }, [loadByTab, tab])

  React.useEffect(() => {
    void loadTaskTagProperties()
  }, [loadTaskTagProperties])

  React.useEffect(() => {
    if (!filterPanelVisible) {
      return
    }
    void loadTaskTagProperties()
    void loadByTab("all-tasks", { silent: true })
  }, [filterPanelVisible, loadByTab, loadTaskTagProperties])

  React.useEffect(() => {
    if (!customViewEditorVisible) {
      return
    }
    void loadTaskTagProperties()
    void loadByTab("all-tasks", { silent: true })
  }, [customViewEditorVisible, loadByTab, loadTaskTagProperties])

  React.useEffect(() => {
    setFilterPanelVisible(false)
    setCustomViewsPanelVisible(false)
  }, [tab])

  React.useEffect(() => {
    if (tab === "all-tasks" || dashboardQuickFilter == null) {
      return
    }

    setDashboardQuickFilter(null)
  }, [dashboardQuickFilter, tab])

  React.useEffect(() => {
    // Listen for block changes and do lightweight refresh.
    const { subscribe } = window.Valtio
    let refreshTimer: number | null = null
    const unsubscribe = subscribe(orca.state.blocks, () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(() => {
        void loadByTab(tab, { silent: true })
      }, 180)
    })

    return () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }
      unsubscribe()
    }
  }, [loadByTab, tab])

  const openCustomViewTab = React.useCallback((viewId: string) => {
    setPreferredTaskViewsTab(toCustomTaskViewsTab(viewId))
    setCustomViewsPanelVisible(false)
  }, [])

  const openCreateCustomViewEditor = React.useCallback(() => {
    setEditingCustomViewId(null)
    setCustomViewNameDraft("")
    setCustomViewNameError("")
    setCustomViewFilterDraft(createDefaultCustomTaskViewFilterGroup())
    setCustomViewsPanelVisible(false)
    setCustomViewEditorVisible(true)
  }, [])

  const openEditCustomViewEditor = React.useCallback((view: CustomTaskView) => {
    setEditingCustomViewId(view.id)
    setCustomViewNameDraft(view.name)
    setCustomViewNameError("")
    setCustomViewFilterDraft(
      ensureUniqueTaskFilterNodeIds(cloneCustomTaskViewFilterGroup(view.filter)),
    )
    setCustomViewsPanelVisible(false)
    setCustomViewEditorVisible(true)
  }, [])

  const closeCustomViewEditor = React.useCallback(() => {
    if (savingCustomView) {
      return
    }

    setCustomViewNameError("")
    setCustomViewEditorVisible(false)
  }, [savingCustomView])

  const saveCustomView = React.useCallback(async () => {
    const name = normalizeCustomTaskViewName(customViewNameDraft)
    if (name === "") {
      setCustomViewNameError(t("Custom view name is required"))
      return
    }
    setCustomViewNameError("")

    const filter = ensureUniqueTaskFilterNodeIds(
      normalizeCustomTaskViewFilterGroup(customViewFilterDraft),
    )
    const now = Date.now()
    let savedViewId = editingCustomViewId
    let nextViews: CustomTaskView[] = []

    if (editingCustomViewId != null) {
      const existingView = customViews.find((view: CustomTaskView) => {
        return view.id === editingCustomViewId
      })
      if (existingView == null) {
        setErrorText(t("Custom view no longer exists"))
        return
      }

      nextViews = customViews.map((view: CustomTaskView) => {
        if (view.id !== editingCustomViewId) {
          return view
        }

        return {
          ...view,
          name,
          filter,
          updatedAt: now,
        }
      })
    } else {
      savedViewId = createCustomTaskViewId()
      nextViews = [
        ...customViews,
        {
          id: savedViewId,
          name,
          filter,
          createdAt: now,
          updatedAt: now,
        },
      ]
    }

    setSavingCustomView(true)
    try {
      await saveCustomTaskViews(props.pluginName, nextViews)
      setCustomViews(nextViews)
      setCustomViewNameError("")
      setCustomViewEditorVisible(false)
      setCustomViewsPanelVisible(false)
      setErrorText("")

      if (savedViewId != null) {
        setPreferredTaskViewsTab(toCustomTaskViewsTab(savedViewId))
      }
    } catch (error) {
      console.error(error)
      setErrorText(t("Failed to save custom view"))
    } finally {
      setSavingCustomView(false)
    }
  }, [
    customViewFilterDraft,
    customViewNameDraft,
    customViews,
    editingCustomViewId,
    props.pluginName,
  ])

  const deleteCustomView = React.useCallback(
    async (view: CustomTaskView) => {
      const nextViews = customViews.filter((item: CustomTaskView) => item.id !== view.id)
      try {
        await saveCustomTaskViews(props.pluginName, nextViews)
        setCustomViews(nextViews)
        setErrorText("")

        if (editingCustomViewId === view.id) {
          setCustomViewEditorVisible(false)
          setEditingCustomViewId(null)
        }

        if (activeCustomViewId === view.id) {
          setPreferredTaskViewsTab("next-actions")
        }
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to delete custom view"))
      }
    },
    [activeCustomViewId, customViews, editingCustomViewId, props.pluginName],
  )

  const toggleTaskStatus = React.useCallback(
    async (item: TaskListRowItem) => {
      setUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        await cycleTaskStatusInView(
          item.blockId,
          props.schema,
          item.taskTagRef ?? null,
          item.sourceBlockId,
          {
            timerAutoStartOnDoing:
              panelSettings.taskTimerEnabled && panelSettings.taskTimerAutoStartOnDoing,
          },
        )
        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to toggle task status"))
      } finally {
        setUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [
      loadByTab,
      panelSettings.taskTimerAutoStartOnDoing,
      panelSettings.taskTimerEnabled,
      props.schema,
      tab,
    ],
  )

  const toggleTaskTimer = React.useCallback(
    async (item: TaskListRowItem) => {
      setTimingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      const currentTimer = readTaskTimerFromProperties(item.blockProperties)
      const action = currentTimer.running ? "stop" : "start"

      try {
        if (action === "stop") {
          await stopTaskTimer({
            blockId: item.blockId,
            sourceBlockId: item.sourceBlockId,
            schema: props.schema,
          })
        } else {
          await startTaskTimer({
            blockId: item.blockId,
            sourceBlockId: item.sourceBlockId,
            schema: props.schema,
          })
        }

        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        const fallbackMessage = action === "stop"
          ? t("Failed to stop timer")
          : t("Failed to start timer")
        setErrorText(error instanceof Error ? error.message : fallbackMessage)
      } finally {
        setTimingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [loadByTab, props.schema, tab],
  )

  const openTaskProperty = React.useCallback(
    (blockId: DbId) => {
      openTaskPropertyPopup({
        pluginName: props.pluginName,
        blockId,
        schema: props.schema,
        triggerSource: "panel-view",
        mountContainer: panelRootRef.current,
      })
    },
    [props.pluginName, props.schema],
  )

  const addSubtask = React.useCallback(
    (item: TaskListRowItem) => {
      openTaskPropertyPopup({
        pluginName: props.pluginName,
        schema: props.schema,
        triggerSource: "panel-view",
        mountContainer: panelRootRef.current,
        mode: "create",
        parentBlockId: item.blockId,
        parentSourceBlockId: item.sourceBlockId,
        onTaskCreated: () => {
          setErrorText("")
          void loadByTab(tab, { silent: true })
        },
      })
    },
    [loadByTab, props.pluginName, props.schema, tab],
  )

  const toggleTaskStar = React.useCallback(
    async (item: TaskListRowItem) => {
      setStarringIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        await toggleTaskStarInView(
          item.blockId,
          !item.star,
          props.schema,
          item.taskTagRef ?? null,
          item.sourceBlockId,
        )
        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to toggle task star"))
      } finally {
        setStarringIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [loadByTab, props.schema, tab],
  )

  const removeTaskTag = React.useCallback(
    async (item: TaskListRowItem) => {
      setUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        await removeTaskTagInView(
          item.blockId,
          props.schema,
          item.sourceBlockId,
        )
        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to remove task tag"))
      } finally {
        setUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [loadByTab, props.schema, tab],
  )

  const deleteTaskBlock = React.useCallback(
    async (item: TaskListRowItem) => {
      setUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        const dependentCount = await countTaskDependentsForDeleteInView(
          item.blockId,
          props.schema,
          item.sourceBlockId,
        )
        if (dependentCount > 0) {
          const confirmed = window.confirm(
            t("This task is depended on by ${count} tasks. Delete anyway? Dependencies will be removed automatically.", {
              count: String(dependentCount),
            }),
          )
          if (!confirmed) {
            return
          }
        }

        await deleteTaskBlockInView(
          item.blockId,
          props.schema,
          item.sourceBlockId,
        )
        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to delete task block"))
      } finally {
        setUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [loadByTab, props.schema, tab],
  )

  const markTaskItemsReviewed = React.useCallback(
    async (items: TaskListRowItem[]): Promise<boolean> => {
      if (items.length === 0) {
        return true
      }

      const itemIds = items.map((item) => item.blockId)
      setReviewingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        for (const itemId of itemIds) {
          next.add(itemId)
        }
        return next
      })

      try {
        for (const item of items) {
          await markTaskReviewedInView(
            item.blockId,
            props.schema,
            item.taskTagRef ?? null,
            item.sourceBlockId,
          )
        }

        setErrorText("")
        await loadByTab(tab, { silent: true })
        return true
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to mark reviewed"))
        return false
      } finally {
        setReviewingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          for (const itemId of itemIds) {
            next.delete(itemId)
          }
          return next
        })
      }
    },
    [loadByTab, props.schema, tab],
  )

  const markTaskReviewed = React.useCallback(
    async (item: TaskListRowItem) => {
      await markTaskItemsReviewed([item])
    },
    [markTaskItemsReviewed],
  )

  const addTaskToMyDay = React.useCallback(
    async (item: TaskListRowItem) => {
      if (!panelSettings.myDayEnabled) {
        return
      }

      setMyDayUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        const savedState = await runMyDayStateMutation(async (baseState: MyDayState) => {
          let nextState = addTaskToMyDayState(baseState, {
            taskId: item.blockId,
            sourceBlockId: item.sourceBlockId,
          }).state
          const mirrorResult = await ensureMyDayMirrorInTodayJournal({
            taskId: item.blockId,
            dayKey: nextState.dayKey,
            sectionTitle: t("My Day"),
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
              item.blockId,
              mirrorResult.mirrorBlockId,
            )
          } else {
            orca.notify("warn", t("Failed to sync My Day journal"))
          }

          return nextState
        })
        if (savedState != null) {
          setErrorText("")
        }
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to update My Day"))
      } finally {
        setMyDayUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [
      panelSettings.myDayEnabled,
      runMyDayStateMutation,
    ],
  )

  const removeTaskFromMyDay = React.useCallback(
    async (item: TaskListRowItem) => {
      setMyDayUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(item.blockId)
        return next
      })

      try {
        const savedState = await runMyDayStateMutation(async (baseState: MyDayState) => {
          const removeResult = removeTaskFromMyDayState(baseState, item.blockId)
          if (!removeResult.removed) {
            return baseState
          }

          await removeMyDayMirrorBlock(removeResult.removedEntry?.mirrorBlockId)
          return removeResult.state
        })
        if (savedState != null) {
          setErrorText("")
        }
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to update My Day"))
      } finally {
        setMyDayUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(item.blockId)
          return next
        })
      }
    },
    [runMyDayStateMutation],
  )

  const applyMyDaySchedule = React.useCallback(
    async (taskId: DbId, startMinute: number, endMinute: number) => {
      setMyDayUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(taskId)
        return next
      })

      try {
        const savedState = await runMyDayStateMutation((baseState: MyDayState) => {
          return updateMyDayTaskSchedule(
            baseState,
            taskId,
            startMinute,
            endMinute,
          )
        })
        if (savedState != null) {
          setErrorText("")
        }
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to update My Day"))
      } finally {
        setMyDayUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    },
    [runMyDayStateMutation],
  )

  const clearMyDaySchedule = React.useCallback(
    async (taskId: DbId) => {
      setMyDayUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(taskId)
        return next
      })

      try {
        const savedState = await runMyDayStateMutation((baseState: MyDayState) => {
          return updateMyDayTaskSchedule(baseState, taskId, null, null)
        })
        if (savedState != null) {
          setErrorText("")
        }
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to update My Day"))
      } finally {
        setMyDayUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    },
    [runMyDayStateMutation],
  )

  const updateMyDayDisplayMode = React.useCallback(
    async (mode: MyDayDisplayMode) => {
      await runMyDayStateMutation((baseState: MyDayState) => {
        return setMyDayDisplayMode(baseState, mode)
      })
    },
    [runMyDayStateMutation],
  )

  const addTask = React.useCallback(() => {
    openTaskPropertyPopup({
      pluginName: props.pluginName,
      schema: props.schema,
      triggerSource: "panel-view",
      mountContainer: panelRootRef.current,
      mode: "create",
      onTaskCreated: () => {
        setErrorText("")
        void loadByTab(tab, { silent: true })
      },
    })
  }, [loadByTab, props.schema, tab])

  const navigateToTask = React.useCallback((item: TaskListRowItem) => {
    orca.nav.openInLastPanel("block", { blockId: item.blockId })
  }, [])

  const applyDashboardQuickFilter = React.useCallback((filter: TaskDashboardQuickFilter) => {
    setDashboardQuickFilter(filter)
    setPreferredTaskViewsTab("all-tasks")
  }, [])

  const clearDashboardQuickFilter = React.useCallback(() => {
    setDashboardQuickFilter(null)
  }, [])

  const toggleCollapsed = React.useCallback((blockId: DbId) => {
    setCollapsedIds((prev: Set<DbId>) => {
      const next = new Set(prev)
      if (next.has(blockId)) {
        next.delete(blockId)
      } else {
        next.add(blockId)
      }
      return next
    })
  }, [])

  const knownLabelValues = React.useMemo(() => {
    return normalizeTaskFilterTextValues([
      ...allTaskItems.flatMap((item: AllTaskItem) => item.labels ?? []),
      ...nextActionItems.flatMap((item: NextActionItem) => item.labels ?? []),
    ])
  }, [allTaskItems, nextActionItems])
  const knownTaskNameById = React.useMemo(() => {
    const map = new Map<string, string>()

    const appendName = (taskName: string, rawIds: Array<DbId | null | undefined>) => {
      const normalizedName = taskName.replace(/\s+/g, " ").trim()
      if (normalizedName === "") {
        return
      }

      for (const rawId of rawIds) {
        if (rawId == null) {
          continue
        }

        const aliasIds = [rawId, getMirrorId(rawId)]
        for (const aliasId of aliasIds) {
          const key = String(aliasId)
          if (!map.has(key)) {
            map.set(key, normalizedName)
          }
        }
      }
    }

    for (const item of allTaskItems) {
      appendName(item.text, [item.blockId, item.sourceBlockId, item.taskTagRef?.from])
    }
    for (const item of nextActionItems) {
      appendName(item.text, [item.blockId, item.sourceBlockId, item.taskTagRef?.from])
    }

    return map
  }, [allTaskItems, nextActionItems])
  const knownBlockRefOptionLabels = React.useMemo(() => {
    return collectKnownTaskFilterBlockRefOptionLabels(
      [...allTaskItems, ...nextActionItems],
      knownTaskNameById,
    )
  }, [allTaskItems, knownTaskNameById, nextActionItems])
  const knownPropertyValueOptions = React.useMemo(() => {
    return collectKnownTaskFilterPropertyOptions(
      [...allTaskItems, ...nextActionItems],
      knownBlockRefOptionLabels,
    )
  }, [allTaskItems, knownBlockRefOptionLabels, nextActionItems])
  const taskFilterProperties = React.useMemo(() => {
    return mergeTaskFilterProperties(
      taskTagProperties,
      collectKnownTaskFilterProperties([...allTaskItems, ...nextActionItems]),
    )
  }, [allTaskItems, nextActionItems, taskTagProperties])
  const filterFields = React.useMemo(() => {
    return buildTaskFilterFields(
      props.schema,
      taskFilterProperties,
      knownLabelValues,
      knownPropertyValueOptions,
      knownBlockRefOptionLabels,
    )
  }, [
    knownBlockRefOptionLabels,
    knownLabelValues,
    knownPropertyValueOptions,
    props.schema,
    taskFilterProperties,
  ])
  const filterFieldByKey = React.useMemo(() => {
    const map = new Map<string, TaskFilterField>()
    for (const field of filterFields) {
      map.set(field.key, field)
      if (Array.isArray(field.aliasKeys)) {
        for (const aliasKey of field.aliasKeys) {
          if (!map.has(aliasKey)) {
            map.set(aliasKey, field)
          }
        }
      }
    }
    return map
  }, [filterFields])
  const filterFieldOptions = React.useMemo(() => {
    return filterFields.map((field: TaskFilterField) => ({
      value: field.key,
      label: field.label,
    }))
  }, [filterFields])
  const hasActiveFilters = React.useMemo(() => {
    return countEffectiveTaskFilterRules(filterRoot, filterFieldByKey) > 0
  }, [filterFieldByKey, filterRoot])
  const activeFilterCount = React.useMemo(() => {
    return countEffectiveTaskFilterRules(filterRoot, filterFieldByKey)
  }, [filterFieldByKey, filterRoot])
  const customViewFilterRuleCount = React.useMemo(() => {
    return countEffectiveTaskFilterRules(customViewFilterDraft, filterFieldByKey)
  }, [customViewFilterDraft, filterFieldByKey])
  const normalizedQuickSearch = React.useMemo(() => {
    return quickSearchKeyword.trim().toLowerCase()
  }, [quickSearchKeyword])

  const clearFilters = React.useCallback(() => {
    setFilterRoot(createTaskFilterGroup(FILTER_GROUP_ROOT_ID, "and"))
  }, [])

  const addFilterRule = React.useCallback(
    (groupId: string) => {
      const defaultField = filterFields[0] ?? createTaskNameFilterField()
      const nextRule = createTaskFilterRule(defaultField)
      setFilterRoot((prev: TaskFilterGroupNode) => {
        return appendRuleToTaskFilterGroup(prev, groupId, nextRule)
      })
    },
    [filterFields],
  )

  const addFilterGroup = React.useCallback((groupId: string) => {
    setFilterRoot((prev: TaskFilterGroupNode) => {
      const nextGroup = createTaskFilterGroup(createTaskFilterNodeId("group"), "and")
      return appendGroupToTaskFilterGroup(prev, groupId, nextGroup)
    })
  }, [])

  const removeFilterNode = React.useCallback((nodeId: string) => {
    if (nodeId === FILTER_GROUP_ROOT_ID) {
      return
    }

    setFilterRoot((prev: TaskFilterGroupNode) => {
      return removeTaskFilterNode(prev, nodeId)
    })
  }, [])

  const updateFilterGroupLogic = React.useCallback((groupId: string, logic: TaskFilterGroupLogic) => {
    setFilterRoot((prev: TaskFilterGroupNode) => {
      return updateTaskFilterGroupLogic(prev, groupId, logic)
    })
  }, [])

  const updateFilterRuleField = React.useCallback(
    (ruleId: string, fieldKey: string) => {
      const field = filterFieldByKey.get(fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
      setFilterRoot((prev: TaskFilterGroupNode) => {
        return updateTaskFilterRule(prev, ruleId, (rule) => ({
          ...rule,
          fieldKey: field.key,
          operator: getDefaultTaskFilterOperatorForField(field),
          value: getDefaultTaskFilterValueForField(field),
        }))
      })
    },
    [filterFieldByKey, filterFields],
  )

  const updateFilterRuleOperator = React.useCallback(
    (ruleId: string, operator: TaskFilterOperator) => {
      setFilterRoot((prev: TaskFilterGroupNode) => {
        return updateTaskFilterRule(prev, ruleId, (rule) => {
          const field = filterFieldByKey.get(rule.fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
          const normalizedOperator = normalizeTaskFilterOperatorForField(field, operator)
          return {
            ...rule,
            operator: normalizedOperator,
            value: normalizeTaskFilterRuleValueForOperator(field, normalizedOperator, rule.value),
          }
        })
      })
    },
    [filterFieldByKey, filterFields],
  )

  const updateFilterRuleValue = React.useCallback((ruleId: string, value: string | string[]) => {
    setFilterRoot((prev: TaskFilterGroupNode) => {
      return updateTaskFilterRule(prev, ruleId, (rule) => {
        const field = filterFieldByKey.get(rule.fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
        const operator = normalizeTaskFilterOperatorForField(field, rule.operator)
        return {
          ...rule,
          operator,
          value: normalizeTaskFilterRuleValueForOperator(field, operator, value),
        }
      })
    })
  }, [filterFieldByKey, filterFields])

  const clearCustomViewFilters = React.useCallback(() => {
    setCustomViewFilterDraft(createDefaultCustomTaskViewFilterGroup())
  }, [])

  const addCustomViewFilterRule = React.useCallback(
    (groupId: string) => {
      const defaultField = filterFields[0] ?? createTaskNameFilterField()
      const nextRule = createTaskFilterRule(defaultField)
      setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
        return appendRuleToTaskFilterGroup(prev, groupId, nextRule)
      })
    },
    [filterFields],
  )

  const addCustomViewFilterGroup = React.useCallback((groupId: string) => {
    setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
      const nextGroup = createTaskFilterGroup(createTaskFilterNodeId("group"), "and")
      return appendGroupToTaskFilterGroup(prev, groupId, nextGroup)
    })
  }, [])

  const removeCustomViewFilterNode = React.useCallback((nodeId: string) => {
    if (nodeId === FILTER_GROUP_ROOT_ID) {
      return
    }

    setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
      return removeTaskFilterNode(prev, nodeId)
    })
  }, [])

  const updateCustomViewFilterGroupLogic = React.useCallback(
    (groupId: string, logic: TaskFilterGroupLogic) => {
      setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
        return updateTaskFilterGroupLogic(prev, groupId, logic)
      })
    },
    [],
  )

  const updateCustomViewFilterRuleField = React.useCallback(
    (ruleId: string, fieldKey: string) => {
      const field = filterFieldByKey.get(fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
      setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
        return updateTaskFilterRule(prev, ruleId, (rule) => ({
          ...rule,
          fieldKey: field.key,
          operator: getDefaultTaskFilterOperatorForField(field),
          value: getDefaultTaskFilterValueForField(field),
        }))
      })
    },
    [filterFieldByKey, filterFields],
  )

  const updateCustomViewFilterRuleOperator = React.useCallback(
    (ruleId: string, operator: TaskFilterOperator) => {
      setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
        return updateTaskFilterRule(prev, ruleId, (rule) => {
          const field = filterFieldByKey.get(rule.fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
          const normalizedOperator = normalizeTaskFilterOperatorForField(field, operator)
          return {
            ...rule,
            operator: normalizedOperator,
            value: normalizeTaskFilterRuleValueForOperator(field, normalizedOperator, rule.value),
          }
        })
      })
    },
    [filterFieldByKey, filterFields],
  )

  const updateCustomViewFilterRuleValue = React.useCallback((ruleId: string, value: string | string[]) => {
    setCustomViewFilterDraft((prev: TaskFilterGroupNode) => {
      return updateTaskFilterRule(prev, ruleId, (rule) => {
        const field = filterFieldByKey.get(rule.fieldKey) ?? filterFields[0] ?? createTaskNameFilterField()
        const operator = normalizeTaskFilterOperatorForField(field, rule.operator)
        return {
          ...rule,
          operator,
          value: normalizeTaskFilterRuleValueForOperator(field, operator, value),
        }
      })
    })
  }, [filterFieldByKey, filterFields])

  const doneStatus = props.schema.statusChoices[2]
  const dashboardQuickFilterContext = React.useMemo(() => {
    if (dashboardQuickFilter == null || tab !== "all-tasks") {
      return null
    }

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return {
      filter: dashboardQuickFilter,
      nowMs: now.getTime(),
      startOfTodayMs: startOfToday.getTime(),
      endOfTodayMs: startOfToday.getTime() + DAY_MS,
      doneStatus,
      blockedTaskIds: dashboardBlockedTaskIds,
    }
  }, [dashboardBlockedTaskIds, dashboardQuickFilter, doneStatus, tab])

  const matchesItem = React.useCallback(
    (item: FilterableTaskItem) => {
      if (normalizedQuickSearch !== "" && !item.text.toLowerCase().includes(normalizedQuickSearch)) {
        return false
      }

      if (!hasActiveFilters) {
        if (dashboardQuickFilterContext == null) {
          return true
        }
      } else if (!evaluateTaskFilterGroup(filterRoot, item, filterFieldByKey)) {
        return false
      }

      return matchesDashboardQuickFilter(item, dashboardQuickFilterContext)
    },
    [dashboardQuickFilterContext, filterFieldByKey, filterRoot, hasActiveFilters, normalizedQuickSearch],
  )

  const filteredNextActionItems = React.useMemo(() => {
    return nextActionItems.filter(matchesItem)
  }, [matchesItem, nextActionItems])
  const filteredStarredTaskItems = React.useMemo(() => {
    return allTaskItems
      .filter((item: AllTaskItem) => item.star)
      .filter(matchesItem)
  }, [allTaskItems, matchesItem])
  const filteredDueSoonTaskItems = React.useMemo(() => {
    const nowMs = Date.now()
    const endMs = nowMs + panelSettings.dueSoonDays * DAY_MS
    return allTaskItems
      .filter((item: AllTaskItem) =>
        isDueSoon(
          item.endTime,
          nowMs,
          endMs,
          panelSettings.dueSoonIncludeOverdue,
        ))
      .filter(matchesItem)
      .sort(compareDueSoonItems)
  }, [allTaskItems, matchesItem, panelSettings.dueSoonDays, panelSettings.dueSoonIncludeOverdue])
  const filteredReviewDueTaskItems = React.useMemo(() => {
    const nowMs = Date.now()
    return allTaskItems
      .filter((item: AllTaskItem) => item.status !== doneStatus)
      .filter((item: AllTaskItem) => isTaskDueForReview(item, nowMs))
      .filter(matchesItem)
      .sort(compareReviewDueItems)
  }, [allTaskItems, doneStatus, matchesItem])
  const filteredCustomViewTaskItems = React.useMemo(() => {
    if (!isCustomTaskViewsTab(tab) || activeCustomView == null) {
      return []
    }

    return allTaskItems
      .filter((item: AllTaskItem) =>
        evaluateTaskFilterGroup(activeCustomView.filter, item, filterFieldByKey)
      )
      .filter(matchesItem)
  }, [
    activeCustomView,
    allTaskItems,
    filterFieldByKey,
    matchesItem,
    tab,
  ])
  const myDayTaskIdSet = React.useMemo((): Set<DbId> => {
    return new Set<DbId>((myDayState?.tasks ?? []).map((item: MyDayTaskEntry) => item.taskId))
  }, [myDayState])
  const filteredMyDayTaskItems = React.useMemo((): AllTaskItem[] => {
    if (myDayState == null) {
      return []
    }

    const itemById = new Map<DbId, AllTaskItem>()
    for (const item of allTaskItems) {
      itemById.set(item.blockId, item)
    }

    return myDayState.tasks
      .map((entry: MyDayTaskEntry) => itemById.get(entry.taskId))
      .filter((item: AllTaskItem | undefined): item is AllTaskItem => item != null)
      .filter(matchesItem)
  }, [allTaskItems, matchesItem, myDayState])
  const myDayScheduleItems = React.useMemo((): MyDayScheduleTaskItem[] => {
    if (myDayState == null) {
      return []
    }

    const itemById = new Map<DbId, AllTaskItem>()
    for (const item of allTaskItems) {
      itemById.set(item.blockId, item)
    }

    const result: MyDayScheduleTaskItem[] = []
    for (const entry of myDayState.tasks) {
      const taskItem = itemById.get(entry.taskId)
      if (taskItem == null || !matchesItem(taskItem)) {
        continue
      }

      result.push({
        blockId: taskItem.blockId,
        text: taskItem.text,
        status: taskItem.status,
        labels: taskItem.labels,
        star: taskItem.star,
        scheduleStartMinute: entry.scheduleStartMinute,
        scheduleEndMinute: entry.scheduleEndMinute,
      })
    }

    return result
  }, [allTaskItems, matchesItem, myDayState])
  const isDashboardTab = tab === "dashboard"
  const isMyDayTab = tab === "my-day"
  const myDayDisplayMode: MyDayDisplayMode = myDayState?.displayMode === "schedule"
    ? "schedule"
    : "list"
  const isMyDayScheduleMode = isMyDayTab && myDayDisplayMode === "schedule"
  const isReviewDueTab = tab === "review-due"
  const isAllTasksTab = tab === "all-tasks"
  const isCustomViewTab = isCustomTaskViewsTab(tab)
  const showParentTaskContext = tab === "next-actions"
  const flatVisibleItems = React.useMemo((): TaskListRowItem[] => {
    if (tab === "my-day") {
      return filteredMyDayTaskItems
    }

    if (tab === "next-actions") {
      return filteredNextActionItems
    }

    if (tab === "starred-tasks") {
      return filteredStarredTaskItems
    }

    if (tab === "due-soon") {
      return filteredDueSoonTaskItems
    }

    if (tab === "review-due") {
      return filteredReviewDueTaskItems
    }

    if (isCustomTaskViewsTab(tab)) {
      return filteredCustomViewTaskItems
    }

    return []
  }, [
    filteredCustomViewTaskItems,
    filteredDueSoonTaskItems,
    filteredMyDayTaskItems,
    filteredNextActionItems,
    filteredReviewDueTaskItems,
    filteredStarredTaskItems,
    tab,
  ])
  const selectedReviewItems = React.useMemo(() => {
    if (!isReviewDueTab || selectedReviewIds.size === 0) {
      return []
    }

    return filteredReviewDueTaskItems.filter((item: AllTaskItem) => {
      return selectedReviewIds.has(item.blockId)
    })
  }, [filteredReviewDueTaskItems, isReviewDueTab, selectedReviewIds])
  const selectedReviewCount = selectedReviewItems.length
  const allReviewItemsSelected =
    isReviewDueTab &&
    filteredReviewDueTaskItems.length > 0 &&
    selectedReviewCount === filteredReviewDueTaskItems.length

  React.useEffect(() => {
    if (isReviewDueTab) {
      return
    }

    setSelectedReviewIds((prev: Set<DbId>) => {
      return prev.size === 0 ? prev : new Set()
    })
  }, [isReviewDueTab])

  React.useEffect(() => {
    if (!isReviewDueTab) {
      return
    }

    const visibleIds = new Set(
      filteredReviewDueTaskItems.map((item: AllTaskItem) => item.blockId),
    )
    setSelectedReviewIds((prev: Set<DbId>) => {
      if (prev.size === 0) {
        return prev
      }

      let changed = false
      const next = new Set<DbId>()
      for (const blockId of prev) {
        if (visibleIds.has(blockId)) {
          next.add(blockId)
        } else {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [filteredReviewDueTaskItems, isReviewDueTab])

  const toggleReviewSelection = React.useCallback((blockId: DbId) => {
    setSelectedReviewIds((prev: Set<DbId>) => {
      const next = new Set(prev)
      if (next.has(blockId)) {
        next.delete(blockId)
      } else {
        next.add(blockId)
      }
      return next
    })
  }, [])

  const selectAllReviewItems = React.useCallback(() => {
    setSelectedReviewIds(
      new Set(filteredReviewDueTaskItems.map((item: AllTaskItem) => item.blockId)),
    )
  }, [filteredReviewDueTaskItems])

  const clearReviewSelection = React.useCallback(() => {
    setSelectedReviewIds((prev: Set<DbId>) => {
      return prev.size === 0 ? prev : new Set()
    })
  }, [])

  const markSelectedReviewed = React.useCallback(async () => {
    if (selectedReviewItems.length === 0) {
      return
    }

    const success = await markTaskItemsReviewed(selectedReviewItems)
    if (success) {
      setSelectedReviewIds(new Set())
    }
  }, [markTaskItemsReviewed, selectedReviewItems])

  const allTaskItemsForTree = React.useMemo(() => {
    if (showCompletedInAllTasks) {
      return allTaskItems
    }

    return allTaskItems.filter((item: AllTaskItem) => item.status !== doneStatus)
  }, [allTaskItems, doneStatus, showCompletedInAllTasks])
  const allTaskTree = React.useMemo(() => buildTaskTree(allTaskItemsForTree), [allTaskItemsForTree])
  const filteredAllTaskTree = React.useMemo(() => {
    return filterTreeWithContext(allTaskTree, matchesItem)
  }, [allTaskTree, matchesItem])
  const visibleAllTaskRows = React.useMemo(() => {
    return flattenVisibleTree(filteredAllTaskTree, collapsedIds)
  }, [collapsedIds, filteredAllTaskTree])
  const collapsibleVisibleTaskIds = React.useMemo(() => {
    return collectCollapsibleNodeIds(filteredAllTaskTree)
  }, [filteredAllTaskTree])
  const canToggleAllCollapsed = collapsibleVisibleTaskIds.length > 0
  const allVisibleCollapsed = canToggleAllCollapsed &&
    collapsibleVisibleTaskIds.every((blockId: DbId) => collapsedIds.has(blockId))

  const toggleAllCollapsed = React.useCallback(() => {
    if (collapsibleVisibleTaskIds.length === 0) {
      return
    }

    setCollapsedIds((prev: Set<DbId>) => {
      const next = new Set(prev)
      if (allVisibleCollapsed) {
        for (const blockId of collapsibleVisibleTaskIds) {
          next.delete(blockId)
        }
      } else {
        for (const blockId of collapsibleVisibleTaskIds) {
          next.add(blockId)
        }
      }

      return next
    })
  }, [allVisibleCollapsed, collapsibleVisibleTaskIds])

  const taskItemById = React.useMemo(() => {
    const map = new Map<DbId, AllTaskItem>()
    for (const item of allTaskItems) {
      map.set(item.blockId, item)
    }
    return map
  }, [allTaskItems])

  React.useEffect(() => {
    if (!allTaskItemsLoaded || !myDayLoaded || myDayState == null) {
      return
    }

    let cancelled = false
    const run = async () => {
      const validTaskIds = new Set<DbId>(allTaskItems.map((item: AllTaskItem) => item.blockId))
      const savedState = await runMyDayStateMutation(
        async (baseState: MyDayState) => {
          const pruneResult = pruneMissingMyDayTasks(baseState, validTaskIds)
          if (pruneResult.removedEntries.length === 0) {
            return baseState
          }

          for (const removedEntry of pruneResult.removedEntries) {
            await removeMyDayMirrorBlock(removedEntry.mirrorBlockId)
          }
          return pruneResult.state
        },
        { silentError: true },
      )
      if (cancelled || savedState == null) {
        return
      }

      myDayStateRef.current = savedState
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [allTaskItems, allTaskItemsLoaded, myDayLoaded, myDayState, runMyDayStateMutation])

  const isDescendantTask = React.useCallback(
    (taskId: DbId, ancestorTaskId: DbId): boolean => {
      const visited = new Set<DbId>()
      let currentParentId = taskItemById.get(taskId)?.parentId ?? null

      while (currentParentId != null) {
        if (currentParentId === ancestorTaskId) {
          return true
        }

        if (visited.has(currentParentId)) {
          return false
        }

        visited.add(currentParentId)
        currentParentId = taskItemById.get(currentParentId)?.parentId ?? null
      }

      return false
    },
    [taskItemById],
  )

  const resolveDropPosition = React.useCallback(
    (event: DragEvent, targetDepth: number): TaskDropPosition => {
      const target = event.currentTarget as HTMLDivElement | null
      if (target == null) {
        return "after"
      }

      const rect = target.getBoundingClientRect()
      const offsetY = event.clientY - rect.top
      if (offsetY < rect.height * 0.25) {
        return "before"
      }
      if (offsetY > rect.height * 0.75) {
        return "after"
      }

      // Only treat middle-zone drop as "child" when pointer is visually in the indented area.
      const childThresholdX = rect.left + 56 + targetDepth * 14
      return event.clientX >= childThresholdX ? "child" : "after"
    },
    [],
  )

  const handleTaskDragStart = React.useCallback(
    (event: DragEvent, taskId: DbId) => {
      if (!isAllTasksTab) {
        return
      }

      const transfer = event.dataTransfer
      transfer?.setData("text/plain", String(taskId))
      transfer?.setData("application/x-mlo-task-id", String(taskId))
      if (transfer != null) {
        transfer.effectAllowed = "move"
      }

      setDraggingTaskId(taskId)
      setDropTarget(null)
      setErrorText("")
    },
    [isAllTasksTab],
  )

  const handleTaskDragEnd = React.useCallback(() => {
    setDraggingTaskId(null)
    setDropTarget(null)
  }, [])

  React.useEffect(() => {
    if (!isAllTasksTab) {
      setDraggingTaskId(null)
      setDropTarget(null)
    }
  }, [isAllTasksTab])

  const moveTaskFromDrop = React.useCallback(
    async (sourceTaskId: DbId, targetTaskId: DbId, position: TaskDropPosition) => {
      if (sourceTaskId === targetTaskId) {
        if (position === "child") {
          setErrorText(t("Cannot move task into itself or its subtasks"))
        }
        return
      }

      const source = taskItemById.get(sourceTaskId)
      const target = taskItemById.get(targetTaskId)
      if (source == null || target == null) {
        return
      }

      if (isDescendantTask(targetTaskId, sourceTaskId)) {
        setErrorText(t("Cannot move task into itself or its subtasks"))
        return
      }

      setMovingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(sourceTaskId)
        return next
      })

      try {
        await moveTaskInView(
          source.blockId,
          target.blockId,
          {
            sourceSourceBlockId: source.sourceBlockId,
            targetSourceBlockId: target.sourceBlockId,
            position,
          },
        )
        setErrorText("")
        await loadByTab(tab, { silent: true })
      } catch (error) {
        console.error(error)
        setErrorText(t("Failed to move task"))
      } finally {
        setMovingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(sourceTaskId)
          return next
        })
      }
    },
    [isDescendantTask, loadByTab, tab, taskItemById],
  )

  const handleTaskRowDragOver = React.useCallback(
    (event: DragEvent, targetTaskId: DbId, targetDepth: number) => {
      const sourceTaskId = draggingTaskId
      if (sourceTaskId == null || movingIds.size > 0) {
        return
      }

      event.preventDefault()
      if (event.dataTransfer != null) {
        event.dataTransfer.dropEffect = "move"
      }

      if (sourceTaskId === targetTaskId || isDescendantTask(targetTaskId, sourceTaskId)) {
        setDropTarget(null)
        return
      }

      const position = resolveDropPosition(event, targetDepth)
      setDropTarget((prev: TaskDropTarget | null) => {
        if (prev?.targetTaskId === targetTaskId && prev.position === position) {
          return prev
        }
        return {
          targetTaskId,
          position,
        }
      })
    },
    [draggingTaskId, isDescendantTask, movingIds.size, resolveDropPosition],
  )

  const handleTaskRowDrop = React.useCallback(
    (event: DragEvent, targetTaskId: DbId, targetDepth: number) => {
      event.preventDefault()

      const sourceTaskId = draggingTaskId
      if (sourceTaskId == null || movingIds.size > 0) {
        return
      }

      if (sourceTaskId === targetTaskId || isDescendantTask(targetTaskId, sourceTaskId)) {
        setErrorText(t("Cannot move task into itself or its subtasks"))
        setDraggingTaskId(null)
        setDropTarget(null)
        return
      }

      const position = resolveDropPosition(event, targetDepth)
      setDraggingTaskId(null)
      setDropTarget(null)
      void moveTaskFromDrop(sourceTaskId, targetTaskId, position)
    },
    [draggingTaskId, isDescendantTask, moveTaskFromDrop, movingIds.size, resolveDropPosition],
  )

  const dashboardData = React.useMemo((): TaskDashboardData => {
    return buildTaskDashboardData({
      allTaskItems,
      nextActionItems,
      blockedCounts: dashboardBlockedCounts,
      blockedTaskIds: dashboardBlockedTaskIds,
      schema: props.schema,
    })
  }, [
    allTaskItems,
    dashboardBlockedCounts,
    dashboardBlockedTaskIds,
    nextActionItems,
    props.schema,
  ])
  const taskViewSegmentedOptions = React.useMemo(() => {
    const baseOptions: Array<{ value: TaskViewsTab; label: string }> = [
      {
        value: "dashboard",
        label: t("Dashboard"),
      },
    ]
    if (panelSettings.myDayEnabled) {
      baseOptions.push({
        value: "my-day",
        label: t("My Day"),
      })
    }
    baseOptions.push(
      {
        value: "next-actions",
        label: t("Active Tasks"),
      },
      {
        value: "all-tasks",
        label: t("All Tasks"),
      },
      {
        value: "starred-tasks",
        label: t("Starred Tasks"),
      },
      {
        value: "due-soon",
        label: t("Due Soon"),
      },
      {
        value: "review-due",
        label: t("Review"),
      },
    )

    const customOptions = customViews.map((view: CustomTaskView) => ({
      value: toCustomTaskViewsTab(view.id),
      label: view.name,
    }))
    return [...baseOptions, ...customOptions]
  }, [customViews, panelSettings.myDayEnabled])
  const estimatedSegmentedWidth = React.useMemo(() => {
    return taskViewSegmentedOptions.reduce((total: number, option: { value: string; label: string }) => {
      const baseLabelWidth = isChinese
        ? option.label.length * 18
        : option.label.length * 10
      const optionWidth = Math.max(82, baseLabelWidth + 32)
      return total + optionWidth
    }, 0)
  }, [isChinese, taskViewSegmentedOptions])
  const useCompactViewSwitcher =
    viewSwitcherWidth > 0 &&
    estimatedSegmentedWidth > Math.max(180, viewSwitcherWidth - 12)
  const useCompactSingleSwitcherLayout = useCompactViewSwitcher && isDashboardTab

  const viewName = tab === "dashboard"
    ? t("Dashboard")
    : tab === "my-day"
      ? t("My Day")
    : tab === "next-actions"
      ? t("Active Tasks")
      : tab === "all-tasks"
        ? t("All Tasks")
      : tab === "starred-tasks"
        ? t("Starred Tasks")
        : tab === "due-soon"
          ? t("Due Soon")
          : tab === "review-due"
            ? t("Review")
            : activeCustomView?.name ?? t("Custom View")
  const visibleCount = isAllTasksTab
    ? visibleAllTaskRows.length
    : isDashboardTab
      ? allTaskItems.length
      : isMyDayTab
        ? filteredMyDayTaskItems.length
      : flatVisibleItems.length
  const emptyText = tab === "next-actions"
    ? t("No actionable tasks")
    : tab === "my-day"
      ? t("No tasks in My Day")
    : tab === "all-tasks"
      ? t("No matched tasks")
      : tab === "starred-tasks"
        ? t("No starred tasks")
        : tab === "due-soon"
          ? t("No due soon tasks")
          : isCustomViewTab
            ? t("No tasks in custom view")
          : tab === "dashboard"
            ? t("No task data yet")
            : t("No tasks to review")
  const panelAccentGlow = tab === "dashboard"
    ? "rgba(13, 148, 136, 0.2)"
    : tab === "my-day"
      ? "rgba(11, 95, 255, 0.22)"
    : tab === "next-actions"
      ? "rgba(37, 99, 235, 0.18)"
      : tab === "all-tasks"
        ? "rgba(183, 121, 31, 0.2)"
        : tab === "starred-tasks"
          ? "rgba(214, 158, 46, 0.18)"
          : tab === "due-soon"
            ? "rgba(221, 107, 32, 0.18)"
            : isCustomViewTab
              ? "rgba(12, 74, 110, 0.18)"
            : "rgba(56, 161, 105, 0.2)"
  const countText = isDashboardTab
    ? t("Total ${count} tasks", { count: String(visibleCount) })
    : t("Showing ${count} items", { count: String(visibleCount) })
  const groupLogicOptions = [
    { value: "and", label: t("AND") },
    { value: "or", label: t("OR") },
  ]

  interface TaskFilterEditorBindings {
    menuContainerRef: React.MutableRefObject<HTMLElement | null>
    addRule: (groupId: string) => void
    addGroup: (groupId: string) => void
    removeNode: (nodeId: string) => void
    updateGroupLogic: (groupId: string, logic: TaskFilterGroupLogic) => void
    updateRuleField: (ruleId: string, fieldKey: string) => void
    updateRuleOperator: (ruleId: string, operator: TaskFilterOperator) => void
    updateRuleValue: (ruleId: string, value: string | string[]) => void
  }

  const quickFilterEditorBindings: TaskFilterEditorBindings = {
    menuContainerRef: filterMenuContainerRef,
    addRule: addFilterRule,
    addGroup: addFilterGroup,
    removeNode: removeFilterNode,
    updateGroupLogic: updateFilterGroupLogic,
    updateRuleField: updateFilterRuleField,
    updateRuleOperator: updateFilterRuleOperator,
    updateRuleValue: updateFilterRuleValue,
  }

  const customViewFilterEditorBindings: TaskFilterEditorBindings = {
    menuContainerRef: filterMenuContainerRef,
    addRule: addCustomViewFilterRule,
    addGroup: addCustomViewFilterGroup,
    removeNode: removeCustomViewFilterNode,
    updateGroupLogic: updateCustomViewFilterGroupLogic,
    updateRuleField: updateCustomViewFilterRuleField,
    updateRuleOperator: updateCustomViewFilterRuleOperator,
    updateRuleValue: updateCustomViewFilterRuleValue,
  }

  interface TaskFilterDateValueEditorProps {
    value: string
    placeholder: string
    menuContainerRef: React.MutableRefObject<HTMLElement | null>
    onChange: (nextValue: string) => void
  }

  const TaskFilterDateValueEditor = (
    editorProps: TaskFilterDateValueEditorProps,
  ): React.ReactElement => {
    const anchorRef = React.useRef<HTMLDivElement | null>(null)
    const [pickerVisible, setPickerVisible] = React.useState(false)
    const selectedDate = React.useMemo(() => {
      return parseTaskFilterEditorDateValue(editorProps.value)
    }, [editorProps.value])
    const hasValue = editorProps.value.trim() !== ""
    const displayText = selectedDate == null ? "" : formatTaskFilterDateDisplayText(selectedDate)

    return React.createElement(
      "div",
      {
        ref: anchorRef,
        style: {
          minWidth: 0,
          width: "100%",
        },
      },
      React.createElement(Input, {
        value: displayText,
        placeholder: editorProps.placeholder,
        readOnly: true,
        onClick: () => setPickerVisible(true),
        post: React.createElement(
          Button,
          {
            variant: "plain",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              if (hasValue) {
                editorProps.onChange("")
                return
              }
              setPickerVisible(true)
            },
            title: hasValue ? t("Clear") : t("Pick"),
            style: {
              borderRadius: "6px",
              width: "24px",
              minWidth: "24px",
              height: "24px",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          React.createElement("i", {
            className: hasValue ? "ti ti-x" : "ti ti-calendar-event",
            style: {
              fontSize: "13px",
              lineHeight: 1,
            },
          }),
        ),
        width: "100%",
      }),
      pickerVisible
        ? React.createElement(DatePicker, {
            mode: "datetime",
            visible: true,
            value: selectedDate ?? new Date(),
            refElement: anchorRef,
            menuContainer: editorProps.menuContainerRef,
            onChange: (next: Date | [Date, Date]) => {
              if (next instanceof Date) {
                editorProps.onChange(formatTaskFilterDateEditorValue(next))
              }
              setPickerVisible(false)
            },
            onClose: () => setPickerVisible(false),
          })
        : null,
    )
  }

  const renderFilterRuleNode = (
    rule: TaskFilterRuleNode,
    depth: number,
    bindings: TaskFilterEditorBindings,
  ) => {
    const fallbackField = filterFields[0] ?? createTaskNameFilterField()
    const field = filterFieldByKey.get(rule.fieldKey) ?? fallbackField
    const operatorOptions = getTaskFilterOperatorOptionsForField(field)
    const selectedOperator = normalizeTaskFilterOperatorForField(field, rule.operator)
    const showOperatorSelector = operatorOptions.length > 1
    const needsValue = doesTaskFilterOperatorNeedValue(selectedOperator)
    const ruleValueList = toTaskFilterRuleValues(rule.value)
    const selectedSingleValue = ruleValueList[0] ?? ""
    const [selectedRangeStartValue, selectedRangeEndValue] = toTaskFilterRuleEditorRangeValues(
      rule.value,
    )
    const rangeValueEnabled = isTaskFilterRangeOperator(field.type, selectedOperator)
    const multiValueEnabled = isTaskFilterMultiValueOperator(field.type, selectedOperator)
    const operatorSelectOptions = operatorOptions.map((item) => ({
      value: item.value,
      label: item.label,
    }))
    const reviewRuleUnitOptions = [
      { value: "day", label: t("By day") },
      { value: "week", label: t("By week") },
      { value: "month", label: t("By month") },
    ]

    let valueEditor: React.ReactNode = null
    if (needsValue) {
      if (field.type === "single-select" || field.type === "multi-select" || field.type === "block-refs") {
        const options = extendTaskFilterOptionsWithValues(
          field.options,
          ruleValueList,
          field.resolveOptionLabel,
        )
        valueEditor = options.length > 0
          ? React.createElement(Select, {
              selected: multiValueEnabled
                ? ruleValueList
                : (selectedSingleValue === "" ? [] : [selectedSingleValue]),
              options,
              multiSelection: multiValueEnabled,
              filter: true,
              onChange: (selected: string[]) =>
                bindings.updateRuleValue(rule.id, multiValueEnabled ? selected : (selected[0] ?? "")),
              width: "100%",
              menuContainer: bindings.menuContainerRef,
              menuClassName: TASK_FILTER_SELECT_MENU_CLASS_NAME,
            })
          : React.createElement(Input, {
              value: multiValueEnabled ? ruleValueList.join(", ") : selectedSingleValue,
              placeholder: multiValueEnabled ? t("Use comma to separate multiple values") : t("Value"),
              onChange: (event: Event) => {
                const target = event.target as HTMLInputElement | null
                bindings.updateRuleValue(
                  rule.id,
                  multiValueEnabled
                    ? splitTaskFilterInputValues(target?.value ?? "")
                    : (target?.value ?? ""),
                )
              },
              width: "100%",
            })
      } else if (field.type === "boolean") {
        const options = field.options.length > 0
          ? field.options
          : [
              { value: "true", label: t("True") },
              { value: "false", label: t("False") },
            ]
        valueEditor = React.createElement(Select, {
          selected: selectedSingleValue === "" ? [] : [selectedSingleValue],
          options,
          onChange: (selected: string[]) => bindings.updateRuleValue(rule.id, selected[0] ?? ""),
          width: "100%",
          menuContainer: bindings.menuContainerRef,
          menuClassName: TASK_FILTER_SELECT_MENU_CLASS_NAME,
        })
      } else if (field.type === "review-rule") {
        const parsed = parseTaskFilterReviewRuleEditorValue(selectedSingleValue)
        valueEditor = React.createElement(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 72px",
              gap: "6px",
            },
          },
          React.createElement(Select, {
            selected: [parsed.unit],
            options: reviewRuleUnitOptions,
            onChange: (selected: string[]) => {
              const nextUnit = selected[0]
              if (nextUnit === "day" || nextUnit === "week" || nextUnit === "month") {
                bindings.updateRuleValue(
                  rule.id,
                  serializeTaskFilterReviewRuleEditorValue(nextUnit, parsed.intervalText),
                )
              }
            },
            width: "100%",
            menuContainer: bindings.menuContainerRef,
            menuClassName: TASK_FILTER_SELECT_MENU_CLASS_NAME,
          }),
          React.createElement(Input, {
            value: parsed.intervalText,
            type: "number",
            min: 1,
            step: 1,
            placeholder: "1",
            onChange: (event: Event) => {
              const rawValue = (event.target as HTMLInputElement | null)?.value ?? ""
              bindings.updateRuleValue(
                rule.id,
                serializeTaskFilterReviewRuleEditorValue(parsed.unit, rawValue),
              )
            },
            onBlur: () => {
              const parsedNumber = Number(parsed.intervalText)
              if (parsed.intervalText.trim() === "" || Number.isNaN(parsedNumber) || parsedNumber < 1) {
                bindings.updateRuleValue(
                  rule.id,
                  serializeTaskFilterReviewRuleEditorValue(parsed.unit, "1"),
                )
              }
            },
            width: "100%",
          }),
        )
      } else if (rangeValueEnabled) {
        valueEditor = React.createElement(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: "6px",
            },
          },
          field.type === "datetime"
            ? React.createElement(TaskFilterDateValueEditor, {
                value: selectedRangeStartValue,
                placeholder: t("Start value"),
                menuContainerRef: bindings.menuContainerRef,
                onChange: (nextValue: string) => {
                  bindings.updateRuleValue(rule.id, [nextValue, selectedRangeEndValue])
                },
              })
            : React.createElement(Input, {
                value: selectedRangeStartValue,
                type: "number",
                placeholder: t("Start value"),
                onChange: (event: Event) => {
                  const target = event.target as HTMLInputElement | null
                  bindings.updateRuleValue(rule.id, [target?.value ?? "", selectedRangeEndValue])
                },
                width: "100%",
              }),
          field.type === "datetime"
            ? React.createElement(TaskFilterDateValueEditor, {
                value: selectedRangeEndValue,
                placeholder: t("End value"),
                menuContainerRef: bindings.menuContainerRef,
                onChange: (nextValue: string) => {
                  bindings.updateRuleValue(rule.id, [selectedRangeStartValue, nextValue])
                },
              })
            : React.createElement(Input, {
                value: selectedRangeEndValue,
                type: "number",
                placeholder: t("End value"),
                onChange: (event: Event) => {
                  const target = event.target as HTMLInputElement | null
                  bindings.updateRuleValue(rule.id, [selectedRangeStartValue, target?.value ?? ""])
                },
                width: "100%",
              }),
        )
      } else if (field.type === "datetime") {
        valueEditor = React.createElement(TaskFilterDateValueEditor, {
          value: selectedSingleValue,
          placeholder: t("Value"),
          menuContainerRef: bindings.menuContainerRef,
          onChange: (nextValue: string) => {
            bindings.updateRuleValue(rule.id, nextValue)
          },
        })
      } else {
        valueEditor = React.createElement(Input, {
          value: selectedSingleValue,
          type: field.type === "number" ? "number" : "text",
          placeholder: t("Value"),
          onChange: (event: Event) => {
            const target = event.target as HTMLInputElement | null
            bindings.updateRuleValue(rule.id, target?.value ?? "")
          },
          width: "100%",
        })
      }
    }

    return React.createElement(
      "div",
      {
        key: rule.id,
        style: {
          marginLeft: `${depth * 8}px`,
          display: "flex",
          flexWrap: "nowrap",
          gap: "4px",
          alignItems: "center",
          padding: "8px",
          borderRadius: "8px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: "rgba(148, 163, 184, 0.08)",
          overflow: "hidden",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            flex: "0 0 124px",
            minWidth: "124px",
          },
        },
        React.createElement(Select, {
          selected: [field.key],
          options: filterFieldOptions,
          filter: true,
          onChange: (selected: string[]) => {
            bindings.updateRuleField(rule.id, selected[0] ?? fallbackField.key)
          },
          width: "100%",
          menuContainer: bindings.menuContainerRef,
          menuClassName: TASK_FILTER_SELECT_MENU_CLASS_NAME,
        }),
      ),
      showOperatorSelector
        ? React.createElement(
            "div",
            {
              style: {
                flex: "0 0 124px",
                minWidth: "124px",
              },
            },
            React.createElement(Select, {
              selected: [selectedOperator],
              options: operatorSelectOptions,
              onChange: (selected: string[]) => {
                const nextOperator = selected[0]
                if (isTaskFilterOperator(nextOperator)) {
                  bindings.updateRuleOperator(rule.id, nextOperator)
                }
              },
              width: "100%",
              menuContainer: bindings.menuContainerRef,
              menuClassName: TASK_FILTER_SELECT_MENU_CLASS_NAME,
            }),
          )
        : null,
      React.createElement(
        "div",
        {
          style: {
            flex: "1 1 auto",
            minWidth: "130px",
            overflow: "hidden",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              width: "100%",
            },
          },
          valueEditor,
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            flex: "0 0 30px",
            minWidth: 0,
          },
        },
        React.createElement(
          Button,
          {
            variant: "outline",
            onClick: () => bindings.removeNode(rule.id),
            title: t("Delete"),
            style: {
              borderRadius: "8px",
              width: "30px",
              height: "30px",
              minWidth: "30px",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--orca-color-text-red, #c53030)",
              borderColor: "rgba(197, 48, 48, 0.35)",
              background: "rgba(197, 48, 48, 0.08)",
            },
          },
          React.createElement("i", {
            className: "ti ti-trash",
            style: {
              fontSize: "14px",
              lineHeight: 1,
            },
          }),
        ),
      ),
    )
  }

  const renderFilterGroupNode = (
    group: TaskFilterGroupNode,
    depth: number,
    bindings: TaskFilterEditorBindings,
    isRoot: boolean = false,
  ): React.ReactElement => {
    return React.createElement(
      "div",
      {
        key: group.id,
        style: {
          marginLeft: isRoot ? 0 : `${depth * 8}px`,
          padding: "8px",
          borderRadius: "10px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: isRoot ? "rgba(148, 163, 184, 0.06)" : "rgba(148, 163, 184, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
          },
        },
        React.createElement(Segmented, {
          selected: group.logic,
          options: groupLogicOptions,
          onChange: (value: string) => {
            bindings.updateGroupLogic(group.id, value === "or" ? "or" : "and")
          },
          style: {
            minWidth: "112px",
          },
        }),
        React.createElement(
          Button,
          {
            variant: "outline",
            onClick: () => bindings.addRule(group.id),
            style: {
              borderRadius: "8px",
            },
          },
          t("Add condition"),
        ),
        React.createElement(
          Button,
          {
            variant: "outline",
            onClick: () => bindings.addGroup(group.id),
            style: {
              borderRadius: "8px",
            },
          },
          t("Add group"),
        ),
        !isRoot
          ? React.createElement(
              Button,
              {
                variant: "outline",
                onClick: () => bindings.removeNode(group.id),
                style: {
                  borderRadius: "8px",
                },
              },
              t("Delete"),
            )
          : null,
      ),
      group.children.length === 0
        ? React.createElement(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "var(--orca-color-text-2)",
                padding: "2px 4px",
              },
            },
            t("No conditions yet"),
          )
        : group.children.map((child) => {
            if (child.kind === "group") {
              return renderFilterGroupNode(child, depth + 1, bindings)
            }
            return renderFilterRuleNode(child, depth + 1, bindings)
          }),
    )
  }

  return React.createElement(
    "div",
    {
      ref: panelRootRef,
      "data-role": "mlo-task-views-panel-root",
      style: {
        height: "100%",
        width: "100%",
        minWidth: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px",
        boxSizing: "border-box",
        background:
          "radial-gradient(circle at 10% 0%, rgba(15, 23, 42, 0.05), transparent 46%), var(--orca-color-bg-1)",
        fontFamily: "\"Avenir Next\", \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          borderRadius: "14px",
          padding: "10px 12px",
          background:
            `radial-gradient(circle at 82% 20%, ${panelAccentGlow}, transparent 48%), ` +
            "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.1)",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: "100%",
            display: useCompactSingleSwitcherLayout ? "grid" : "flex",
            gridTemplateColumns: useCompactSingleSwitcherLayout
              ? "minmax(0, 1fr) minmax(160px, 220px)"
              : undefined,
            alignItems: "center",
            justifyContent: useCompactSingleSwitcherLayout ? undefined : "space-between",
            gap: "10px",
            flexWrap: useCompactSingleSwitcherLayout ? undefined : "wrap",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              display: "flex",
              alignItems: "baseline",
              gap: "8px",
              flexWrap: "wrap",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: "17px",
                fontWeight: 700,
                letterSpacing: "0.01em",
                color: "var(--orca-color-text-1, var(--orca-color-text))",
              },
            },
            viewName,
          ),
          React.createElement(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "var(--orca-color-text-2)",
              },
            },
            countText,
          ),
        ),
        React.createElement(
          "div",
          {
            ref: viewSwitcherContainerRef,
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: useCompactSingleSwitcherLayout ? "stretch" : "flex-end",
              gap: "8px",
              flexWrap: "nowrap",
              flex: useCompactSingleSwitcherLayout ? undefined : "1 1 320px",
              width: useCompactSingleSwitcherLayout ? "100%" : undefined,
              minWidth: 0,
            },
          },
          useCompactViewSwitcher
            ? React.createElement(
                "div",
                {
                  style: {
                    flex: useCompactSingleSwitcherLayout ? "1 1 auto" : "1 1 220px",
                    minWidth: 0,
                    maxWidth: useCompactSingleSwitcherLayout ? "100%" : "340px",
                  },
                },
                React.createElement(Select, {
                  selected: [tab],
                  options: taskViewSegmentedOptions,
                  onChange: (selected: string[]) => {
                    const value = selected[0]
                    if (value != null && isTaskViewsTab(value)) {
                      setPreferredTaskViewsTab(value)
                    }
                  },
                  width: "100%",
                  filter: taskViewSegmentedOptions.length > 8,
                  menuContainer: filterMenuContainerRef,
                }),
              )
            : React.createElement(
                "div",
                {
                  style: {
                    flex: "1 1 320px",
                    minWidth: 0,
                    maxWidth: "620px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                  },
                },
                React.createElement(Segmented, {
                  selected: tab,
                  options: taskViewSegmentedOptions,
                  onChange: (value: string) => {
                    if (isTaskViewsTab(value)) {
                      setPreferredTaskViewsTab(value)
                    }
                  },
                  style: {
                    width: "100%",
                  },
                }),
              ),
          React.createElement(
            "div",
            {
              ref: customViewsButtonAnchorRef,
              style: {
                display: "inline-flex",
                alignItems: "center",
              },
            },
            React.createElement(
              Button,
              {
                variant: isCustomViewTab ? "soft" : "outline",
                onClick: () => {
                  setCustomViewsPanelVisible((prev: boolean) => !prev)
                },
                title: t("Custom views"),
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  whiteSpace: "nowrap",
                  borderRadius: "8px",
                },
              },
              React.createElement("i", {
                className: "ti ti-layout-grid-add",
                style: {
                  fontSize: "14px",
                  lineHeight: 1,
                },
              }),
              React.createElement(
                "span",
                null,
                t("Custom views"),
              ),
            ),
          ),
        ),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          borderRadius: "12px",
          padding: "8px 10px",
          background:
            "linear-gradient(145deg, rgba(15, 23, 42, 0.03), var(--orca-color-bg-1) 45%, rgba(148, 163, 184, 0.1))",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            flex: isDashboardTab ? "0 0 auto" : "1 1 420px",
          },
        },
        React.createElement(
          Popup,
          {
            refElement: customViewsButtonAnchorRef,
            visible: customViewsPanelVisible,
            onClose: () => setCustomViewsPanelVisible(false),
            defaultPlacement: "bottom",
            alignment: "left",
            offset: 6,
          },
          React.createElement(
            "div",
            {
              style: {
                width: "min(440px, calc(100vw - 24px))",
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "10px",
                borderRadius: "12px",
                border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
                background:
                  "linear-gradient(160deg, var(--orca-color-bg-1), var(--orca-color-bg-2) 82%)",
                boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                },
              },
              React.createElement(
                "div",
                {
                  style: {
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--orca-color-text-1, var(--orca-color-text))",
                  },
                },
                t("Custom views"),
              ),
              React.createElement(
                Button,
                {
                  variant: "outline",
                  onClick: () => {
                    openCreateCustomViewEditor()
                  },
                  style: {
                    borderRadius: "8px",
                  },
                },
                t("New view"),
              ),
            ),
            !customViewsLoaded
              ? React.createElement(
                  "div",
                  {
                    style: {
                      fontSize: "12px",
                      color: "var(--orca-color-text-2)",
                    },
                  },
                  t("Loading..."),
                )
              : customViews.length === 0
                ? React.createElement(
                    "div",
                    {
                      style: {
                        fontSize: "12px",
                        color: "var(--orca-color-text-2)",
                      },
                    },
                    t("No custom views yet"),
                  )
                : React.createElement(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        maxHeight: "320px",
                        overflow: "auto",
                      },
                    },
                    customViews.map((view: CustomTaskView) => {
                      const selected = tab === toCustomTaskViewsTab(view.id)
                      return React.createElement(
                        "div",
                        {
                          key: view.id,
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "2px 0",
                          },
                        },
                        React.createElement(
                          Button,
                          {
                            variant: selected ? "soft" : "outline",
                            onClick: () => {
                              openCustomViewTab(view.id)
                            },
                            style: {
                              borderRadius: "8px",
                              flex: "1 1 auto",
                              justifyContent: "flex-start",
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            },
                            title: view.name,
                          },
                          view.name,
                        ),
                        React.createElement(
                          Button,
                          {
                            variant: "outline",
                            onClick: () => {
                              openEditCustomViewEditor(view)
                            },
                            title: t("Edit custom view"),
                            style: {
                              borderRadius: "8px",
                              width: "30px",
                              minWidth: "30px",
                              height: "30px",
                              padding: 0,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                          },
                          React.createElement("i", {
                            className: "ti ti-pencil",
                            style: {
                              fontSize: "13px",
                              lineHeight: 1,
                            },
                          }),
                        ),
                        React.createElement(
                          ConfirmBox,
                          {
                            text: t("Delete custom view: ${name}?", {
                              name: view.name,
                            }),
                            onConfirm: async (_event: unknown, close: () => void) => {
                              close()
                              await deleteCustomView(view)
                            },
                          },
                          (openConfirm: (event: MouseEvent) => void) =>
                            React.createElement(
                              Button,
                              {
                                variant: "outline",
                                onClick: (event: MouseEvent) => {
                                  openConfirm(event)
                                },
                                title: t("Delete custom view"),
                                style: {
                                  borderRadius: "8px",
                                  width: "30px",
                                  minWidth: "30px",
                                  height: "30px",
                                  padding: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "var(--orca-color-text-red, #c53030)",
                                  borderColor: "rgba(197, 48, 48, 0.35)",
                                  background: "rgba(197, 48, 48, 0.08)",
                                },
                              },
                              React.createElement("i", {
                                className: "ti ti-trash",
                                style: {
                                  fontSize: "13px",
                                  lineHeight: 1,
                                },
                              }),
                            ),
                        ),
                      )
                    }),
                  ),
          ),
        ),
        React.createElement(
          "div",
          {
            ref: filterButtonAnchorRef,
            style: {
              display: isDashboardTab ? "none" : "inline-flex",
              alignItems: "center",
            },
          },
          React.createElement(
            Button,
            {
              variant: hasActiveFilters ? "soft" : "outline",
              onClick: () => {
                setFilterPanelVisible((prev: boolean) => !prev)
              },
              title: t("Filter"),
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                whiteSpace: "nowrap",
                borderRadius: "8px",
              },
            },
            React.createElement("i", {
              className: "ti ti-adjustments-horizontal",
              style: {
                fontSize: "14px",
                lineHeight: 1,
              },
            }),
            React.createElement(
              "span",
              null,
              t("Filter"),
            ),
            activeFilterCount > 0
              ? React.createElement(
                  "span",
                  {
                    style: {
                      minWidth: "18px",
                      height: "18px",
                      borderRadius: "999px",
                      padding: "0 5px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(37, 99, 235, 0.16)",
                      color: "var(--orca-color-text-blue, #2563eb)",
                      fontSize: "11px",
                      fontWeight: 600,
                      lineHeight: 1,
                    },
                  },
                  String(activeFilterCount),
                )
              : null,
          ),
        ),
        React.createElement(
          Popup,
          {
            refElement: filterButtonAnchorRef,
            visible: filterPanelVisible,
            onClose: () => setFilterPanelVisible(false),
            defaultPlacement: "bottom",
            alignment: "left",
            offset: 6,
          },
          React.createElement(
            "div",
            {
              ref: filterPopupContainerRef,
              style: {
                width: "min(520px, calc(100vw - 24px))",
                maxWidth: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                padding: "10px",
                borderRadius: "12px",
                border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
                background:
                  "linear-gradient(160deg, var(--orca-color-bg-1), var(--orca-color-bg-2) 82%)",
                boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                },
              },
            React.createElement(
              "div",
              {
                style: {
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--orca-color-text-1, var(--orca-color-text))",
                },
              },
              t("Filter"),
            ),
              React.createElement(
                Button,
                {
                  variant: "outline",
                  disabled: !hasActiveFilters,
                  onClick: () => clearFilters(),
                  style: {
                    whiteSpace: "nowrap",
                    borderRadius: "8px",
                  },
                },
                t("Clear filters"),
              ),
            ),
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                },
              },
              React.createElement(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    color: "var(--orca-color-text-2)",
                  },
                },
                t("Build expression with AND/OR groups"),
              ),
              renderFilterGroupNode(filterRoot, 0, quickFilterEditorBindings, true),
            ),
          ),
        ),
        React.createElement(Input, {
          value: quickSearchKeyword,
          placeholder: t("Search task name"),
          onChange: (event: Event) => {
            const target = event.target as HTMLInputElement | null
            setQuickSearchKeyword(target?.value ?? "")
          },
          style: {
            width: "220px",
            minWidth: "160px",
          },
        }),
        isMyDayTab
          ? React.createElement(Segmented, {
              selected: myDayDisplayMode,
              options: [
                {
                  value: "list",
                  label: t("List"),
                },
                {
                  value: "schedule",
                  label: t("Schedule"),
                },
              ],
              onChange: (value: string) => {
                const mode = value === "schedule" ? "schedule" : "list"
                void updateMyDayDisplayMode(mode)
              },
              style: {
                minWidth: "200px",
              },
            })
          : null,
        isAllTasksTab && dashboardQuickFilter != null
          ? React.createElement(
              "div",
              {
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  border: "1px solid rgba(13, 148, 136, 0.36)",
                  background: "rgba(13, 148, 136, 0.1)",
                  color: "var(--orca-color-text-teal, #0f766e)",
                  fontSize: "11px",
                },
              },
              t("Quick filter: ${name}", {
                name: resolveDashboardQuickFilterLabel(dashboardQuickFilter),
              }),
              React.createElement(
                "button",
                {
                  type: "button",
                  onClick: () => clearDashboardQuickFilter(),
                  style: {
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "inherit",
                    fontSize: "11px",
                    padding: 0,
                  },
                },
                t("Clear quick filter"),
              ),
            )
          : null,
        isAllTasksTab
          ? React.createElement(
              "label",
              {
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  color: "var(--orca-color-text)",
                  whiteSpace: "nowrap",
                  padding: "0 4px",
                },
              },
              React.createElement(Switch, {
                on: showCompletedInAllTasks,
                onChange: (nextOn: boolean) => {
                  setShowCompletedInAllTasks(nextOn)
                },
              }),
              t("Show completed tasks"),
            )
          : null,
        isAllTasksTab
          ? React.createElement(
              Button,
              {
                variant: "outline",
                disabled: !canToggleAllCollapsed,
                onClick: () => toggleAllCollapsed(),
                title: allVisibleCollapsed ? t("Expand all") : t("Collapse all"),
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                  borderRadius: "8px",
                },
              },
              React.createElement("i", {
                className: allVisibleCollapsed ? "ti ti-chevrons-down" : "ti ti-chevrons-up",
                style: {
                  fontSize: "14px",
                  lineHeight: 1,
                },
              }),
              React.createElement(
                "span",
                null,
                allVisibleCollapsed ? t("Expand all") : t("Collapse all"),
              ),
            )
          : null,
      ),
      isDashboardTab
        ? React.createElement(
            "div",
            {
              style: {
                flex: "1 1 auto",
                minWidth: 0,
                fontSize: "12px",
                color: "var(--orca-color-text-2)",
              },
            },
            t("Live metrics across your tasks"),
          )
        : isMyDayTab
          ? React.createElement(
              "div",
              {
                style: {
                  flex: "1 1 auto",
                  minWidth: 0,
                  fontSize: "12px",
                  color: "var(--orca-color-text-2)",
                },
              },
              t("Plan your day with list and schedule"),
            )
        : null,
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "flex-end",
            flex: "0 0 auto",
          },
        },
        isDashboardTab
          ? React.createElement(
              Button,
              {
                variant: "outline",
                onClick: () => {
                  void loadByTab(tab, { silent: true })
                },
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  whiteSpace: "nowrap",
                  borderRadius: "8px",
                },
              },
              React.createElement("i", {
                className: "ti ti-refresh",
                style: {
                  fontSize: "14px",
                  lineHeight: 1,
                },
              }),
              React.createElement(
                "span",
                null,
                t("Refresh"),
              ),
            )
          : null,
        React.createElement(
          Button,
          {
            variant: "solid",
            onClick: () => {
              addTask()
            },
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
              borderRadius: "8px",
              background: "var(--orca-color-text-blue, #2563eb)",
              borderColor: "var(--orca-color-text-blue, #2563eb)",
              color: "#fff",
            },
          },
          React.createElement("i", {
            className: "ti ti-plus",
            style: {
              fontSize: "14px",
              lineHeight: 1,
            },
          }),
          React.createElement(
            "span",
            null,
            t("Add task"),
          ),
        ),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: "10px",
          alignItems: "stretch",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
            borderRadius: "12px",
            background:
              "radial-gradient(circle at 86% 8%, rgba(37, 99, 235, 0.08), transparent 45%), var(--orca-color-bg-1)",
            padding: "8px",
            boxSizing: "border-box",
            overflow: "hidden",
          },
        },
        errorText !== ""
          ? React.createElement(
              "div",
              {
                style: {
                  color: "var(--orca-color-text-red)",
                  border: "1px solid rgba(197, 48, 48, 0.25)",
                  background: "rgba(197, 48, 48, 0.08)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  marginBottom: "8px",
                  padding: "7px 10px",
                },
              },
              errorText,
            )
          : null,
        !loading && !isDashboardTab && isReviewDueTab && visibleCount > 0
          ? React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  flexWrap: "wrap",
                  marginBottom: "8px",
                  border: "1px solid rgba(56, 161, 105, 0.3)",
                  borderRadius: "10px",
                  background: "rgba(56, 161, 105, 0.08)",
                  padding: "7px 9px",
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    color: "var(--orca-color-text-2)",
                    fontSize: "12px",
                    whiteSpace: "nowrap",
                  },
                },
                `${t("Selected")}: ${selectedReviewCount}`,
              ),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexWrap: "wrap",
                  },
                },
                React.createElement(
                  Button,
                  {
                    variant: "outline",
                    disabled: filteredReviewDueTaskItems.length === 0 || allReviewItemsSelected,
                    onClick: () => {
                      selectAllReviewItems()
                    },
                    style: {
                      borderRadius: "8px",
                    },
                  },
                  t("Select all"),
                ),
                React.createElement(
                  Button,
                  {
                    variant: "outline",
                    disabled: selectedReviewCount === 0,
                    onClick: () => {
                      clearReviewSelection()
                    },
                    style: {
                      borderRadius: "8px",
                    },
                  },
                  t("Clear selection"),
                ),
                React.createElement(
                  Button,
                  {
                    variant: "solid",
                    disabled: selectedReviewCount === 0 || reviewingIds.size > 0,
                    onClick: () => {
                      void markSelectedReviewed()
                    },
                    style: {
                      borderRadius: "8px",
                      whiteSpace: "nowrap",
                      background: "var(--orca-color-text-green, #2f855a)",
                      borderColor: "var(--orca-color-text-green, #2f855a)",
                      color: "#fff",
                    },
                  },
                  t("Mark selected reviewed"),
                ),
              ),
            )
          : null,
        loading
          ? React.createElement(
              "div",
              {
                style: {
                  color: "var(--orca-color-text-2)",
                  fontSize: "13px",
                  padding: "10px",
                  borderRadius: "10px",
                  background: "rgba(148, 163, 184, 0.08)",
                },
              },
              isDashboardTab ? t("Loading dashboard...") : t("Loading..."),
            )
          : null,
        !loading && !isDashboardTab && visibleCount === 0
          ? React.createElement(
              "div",
              {
                style: {
                  color: "var(--orca-color-text-2)",
                  fontSize: "13px",
                  padding: "10px",
                  borderRadius: "10px",
                  background: "rgba(148, 163, 184, 0.08)",
                },
              },
              emptyText,
            )
          : null,
        !loading && isDashboardTab
          ? React.createElement(
              "div",
              {
                style: {
                  flex: 1,
                  minHeight: 0,
                  overflow: "auto",
                  width: "100%",
                  minWidth: 0,
                },
              },
              React.createElement(TaskDashboard, {
                data: dashboardData,
                generatedAt: dashboardGeneratedAt,
                onOpenTask: (blockId: DbId) => {
                  openTaskProperty(blockId)
                },
                onApplyQuickFilter: (filter: TaskDashboardQuickFilter) => {
                  applyDashboardQuickFilter(filter)
                },
              }),
            )
          : null,
        !loading && isMyDayTab && isMyDayScheduleMode && visibleCount > 0
          ? React.createElement(
              "div",
              {
                style: {
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  minWidth: 0,
                },
              },
              React.createElement(MyDayScheduleBoard, {
                items: myDayScheduleItems,
                dayStartHour: panelSettings.myDayResetHour,
                disabled: loading || myDaySaving,
                updatingTaskIds: myDayUpdatingIds,
                onOpenTask: (blockId: DbId) => {
                  openTaskProperty(blockId)
                },
                onNavigateTask: (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }
                  navigateToTask(matched)
                },
                onToggleTaskStar: async (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }
                  await toggleTaskStar(matched)
                },
                onAddSubtask: async (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }
                  await addSubtask(matched)
                },
                onDeleteTaskTag: async (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }
                  await removeTaskTag(matched)
                },
                onDeleteTaskBlock: async (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }
                  await deleteTaskBlock(matched)
                },
                onRemoveTask: async (blockId: DbId) => {
                  const matched = taskItemById.get(blockId)
                  if (matched == null) {
                    return
                  }

                  await removeTaskFromMyDay(matched)
                },
                onApplySchedule: async (blockId: DbId, startMinute: number, endMinute: number) => {
                  await applyMyDaySchedule(blockId, startMinute, endMinute)
                },
                onClearSchedule: async (blockId: DbId) => {
                  await clearMyDaySchedule(blockId)
                },
              }),
            )
          : null,
        !loading && !isDashboardTab && (!isMyDayTab || !isMyDayScheduleMode) && visibleCount > 0
          ? React.createElement(
              "div",
              {
                style: {
                  flex: 1,
                  overflow: "auto",
                  width: "100%",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: "6px",
                  paddingTop: "2px",
                  paddingBottom: "2px",
                },
              },
              isAllTasksTab
                ? [
                    ...visibleAllTaskRows.map((row: VisibleTreeRow, index: number) => {
                      const isDragging = draggingTaskId === row.node.item.blockId
                      const moving = movingIds.has(row.node.item.blockId)
                      const activeDropPosition =
                        dropTarget?.targetTaskId === row.node.item.blockId
                          ? dropTarget.position
                          : null

                      return React.createElement(
                        "div",
                        {
                        key: row.node.item.blockId,
                        draggable: !loading && !moving,
                          onDragStart: (event: DragEvent) => {
                            handleTaskDragStart(event, row.node.item.blockId)
                          },
                          onDragEnd: () => handleTaskDragEnd(),
                          onDragOver: (event: DragEvent) => {
                            handleTaskRowDragOver(event, row.node.item.blockId, row.depth)
                          },
                          onDrop: (event: DragEvent) => {
                            handleTaskRowDrop(event, row.node.item.blockId, row.depth)
                          },
                          style: {
                            position: "relative",
                            borderTop: activeDropPosition === "before"
                              ? "2px solid var(--orca-color-text-blue, #2563eb)"
                              : "2px solid transparent",
                            borderBottom: activeDropPosition === "after"
                              ? "2px solid var(--orca-color-text-blue, #2563eb)"
                              : "2px solid transparent",
                            borderRadius: "10px",
                            background: activeDropPosition === "child"
                              ? "rgba(37, 99, 235, 0.1)"
                              : "transparent",
                            opacity: isDragging ? 0.42 : 1,
                            transition: "background 120ms ease, opacity 120ms ease",
                          },
                        },
                        React.createElement(TaskListRow, {
                          item: row.node.item,
                          schema: props.schema,
                          isChinese,
                          rowIndex: index,
                          depth: row.depth,
                          contextOnly: row.node.contextOnly,
                          loading,
                          updating: updatingIds.has(row.node.item.blockId) || moving,
                          showCollapseToggle: row.hasChildren,
                          collapsed: row.collapsed,
                          showParentTaskContext: false,
                          showReviewAction: false,
                          showReviewSelection: false,
                          reviewSelected: false,
                          starUpdating: starringIds.has(row.node.item.blockId),
                          timerEnabled: panelSettings.taskTimerEnabled,
                          timerMode: panelSettings.taskTimerMode,
                          timerNowMs,
                          timerUpdating: timingIds.has(row.node.item.blockId),
                          reviewUpdating: reviewingIds.has(row.node.item.blockId),
                          onToggleCollapse: row.hasChildren
                            ? () => toggleCollapsed(row.node.item.blockId)
                            : undefined,
                          onToggleReviewSelected: undefined,
                          onToggleStatus: () => toggleTaskStatus(row.node.item),
                          onNavigate: () => navigateToTask(row.node.item),
                          onToggleStar: () => toggleTaskStar(row.node.item),
                          onToggleTimer: () => toggleTaskTimer(row.node.item),
                          onMarkReviewed: () => markTaskReviewed(row.node.item),
                          onAddSubtask: () => addSubtask(row.node.item),
                          onDeleteTaskTag: () => removeTaskTag(row.node.item),
                          onDeleteTaskBlock: () => deleteTaskBlock(row.node.item),
                          showMyDayAction: panelSettings.myDayEnabled,
                          myDaySelected: myDayTaskIdSet.has(row.node.item.blockId),
                          myDayUpdating: myDayUpdatingIds.has(row.node.item.blockId),
                          onAddToMyDay: () => addTaskToMyDay(row.node.item),
                          onRemoveFromMyDay: () => removeTaskFromMyDay(row.node.item),
                          onOpen: () => openTaskProperty(row.node.item.blockId),
                        }),
                      )
                    }),
                  ]
                : flatVisibleItems.map((item: TaskListRowItem, index: number) => {
                    const reviewSelectionEnabled = isReviewDueTab
                    return React.createElement(TaskListRow, {
                      key: item.blockId,
                      item,
                      schema: props.schema,
                      isChinese,
                      rowIndex: index,
                      depth: 0,
                      contextOnly: false,
                      loading,
                      updating: updatingIds.has(item.blockId),
                      showCollapseToggle: false,
                      collapsed: false,
                      showParentTaskContext,
                      showReviewAction: reviewSelectionEnabled,
                      showReviewSelection: reviewSelectionEnabled,
                      reviewSelected: reviewSelectionEnabled && selectedReviewIds.has(item.blockId),
                      starUpdating: starringIds.has(item.blockId),
                      timerEnabled: panelSettings.taskTimerEnabled,
                      timerMode: panelSettings.taskTimerMode,
                      timerNowMs,
                      timerUpdating: timingIds.has(item.blockId),
                      reviewUpdating: reviewingIds.has(item.blockId),
                      onToggleReviewSelected: reviewSelectionEnabled
                        ? () => toggleReviewSelection(item.blockId)
                        : undefined,
                      onToggleStatus: () => toggleTaskStatus(item),
                      onNavigate: () => navigateToTask(item),
                      onToggleStar: () => toggleTaskStar(item),
                      onToggleTimer: () => toggleTaskTimer(item),
                      onMarkReviewed: () => markTaskReviewed(item),
                      onAddSubtask: () => addSubtask(item),
                      onDeleteTaskTag: () => removeTaskTag(item),
                      onDeleteTaskBlock: () => deleteTaskBlock(item),
                      showMyDayAction: panelSettings.myDayEnabled,
                      myDaySelected: myDayTaskIdSet.has(item.blockId),
                      myDayUpdating: myDayUpdatingIds.has(item.blockId),
                      onAddToMyDay: () => addTaskToMyDay(item),
                      onRemoveFromMyDay: () => removeTaskFromMyDay(item),
                      onOpen: () => openTaskProperty(item.blockId),
                    })
                  }),
            )
          : null,
      ),
    ),
    React.createElement(
      ModalOverlay,
      {
        visible: customViewEditorVisible,
        canClose: false,
        blurred: true,
        onClose: () => {
          closeCustomViewEditor()
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: "min(860px, calc(100vw - 28px))",
            maxHeight: "calc(100vh - 40px)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            padding: "14px",
            borderRadius: "14px",
            border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
            background:
              "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2) 82%)",
            boxShadow: "0 24px 52px rgba(15, 23, 42, 0.32)",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              flexWrap: "wrap",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: "16px",
                fontWeight: 700,
              },
            },
            editingCustomViewId == null ? t("Create custom view") : t("Edit custom view"),
          ),
          React.createElement(
            Button,
            {
              variant: "outline",
              disabled: savingCustomView,
              onClick: () => {
                closeCustomViewEditor()
              },
              style: {
                borderRadius: "8px",
              },
            },
            t("Cancel"),
          ),
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "var(--orca-color-text-2)",
                fontWeight: 600,
              },
            },
            t("View name"),
          ),
          React.createElement(Input, {
            value: customViewNameDraft,
            placeholder: t("View name"),
            onChange: (event: Event) => {
              const target = event.target as HTMLInputElement | null
              setCustomViewNameDraft(target?.value ?? "")
              if (customViewNameError !== "") {
                setCustomViewNameError("")
              }
            },
            disabled: savingCustomView,
            width: "100%",
          }),
          customViewNameError !== ""
            ? React.createElement(
                "div",
                {
                  style: {
                    color: "var(--orca-color-text-red, #c53030)",
                    fontSize: "12px",
                  },
                },
                customViewNameError,
              )
            : null,
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: "12px",
              color: "var(--orca-color-text-2)",
              fontWeight: 600,
            },
          },
          t("Custom view rules"),
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              flexWrap: "wrap",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: "12px",
                color: "var(--orca-color-text-2)",
              },
            },
            t("Rule count: ${count}", { count: String(customViewFilterRuleCount) }),
          ),
          React.createElement(
            Button,
            {
              variant: "outline",
              disabled: customViewFilterRuleCount === 0,
              onClick: () => clearCustomViewFilters(),
              style: {
                borderRadius: "8px",
              },
            },
            t("Clear rules"),
          ),
        ),
        React.createElement(
          "div",
          {
            ref: customViewFilterPopupContainerRef,
            style: {
              flex: "1 1 auto",
              minHeight: "300px",
              maxHeight: "calc(100vh - 250px)",
              overflow: "auto",
              border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
              borderRadius: "10px",
              padding: "10px",
              background: "rgba(148, 163, 184, 0.06)",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  fontSize: "12px",
                  color: "var(--orca-color-text-2)",
                },
              },
              t("Build expression with AND/OR groups"),
            ),
            renderFilterGroupNode(customViewFilterDraft, 0, customViewFilterEditorBindings, true),
          ),
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "8px",
            },
          },
          React.createElement(
            Button,
            {
              variant: "outline",
              disabled: savingCustomView,
              onClick: () => {
                closeCustomViewEditor()
              },
              style: {
                borderRadius: "8px",
              },
            },
            t("Cancel"),
          ),
          React.createElement(
            Button,
            {
              variant: "solid",
              disabled: savingCustomView,
              onClick: () => {
                void saveCustomView()
              },
              style: {
                borderRadius: "8px",
                background: "var(--orca-color-text-blue, #2563eb)",
                borderColor: "var(--orca-color-text-blue, #2563eb)",
                color: "#fff",
              },
            },
            savingCustomView ? t("Saving...") : t("Save view"),
          ),
        ),
      ),
    ),
  )
}

interface BuildTaskDashboardDataParams {
  allTaskItems: AllTaskItem[]
  nextActionItems: NextActionItem[]
  blockedCounts: BlockedReasonCountMap
  blockedTaskIds: Set<DbId>
  schema: TaskSchemaDefinition
}

interface DashboardQuickFilterContext {
  filter: TaskDashboardQuickFilter
  nowMs: number
  startOfTodayMs: number
  endOfTodayMs: number
  doneStatus: string
  blockedTaskIds: Set<DbId>
}

function countBlockedReasons(
  evaluations: Array<{ blockedReason: NextActionBlockedReason[] }>,
): BlockedReasonCountMap {
  const counts: BlockedReasonCountMap = {}

  for (const evaluation of evaluations) {
    for (const reason of evaluation.blockedReason) {
      counts[reason] = (counts[reason] ?? 0) + 1
    }
  }

  return counts
}

function collectDashboardBlockedTaskIds(
  evaluations: NextActionEvaluation[],
): Set<DbId> {
  const blockedTaskIds = new Set<DbId>()

  for (const evaluation of evaluations) {
    if (evaluation.isNextAction) {
      continue
    }

    const blocked = evaluation.blockedReason.some((reason) =>
      DASHBOARD_ACTIONABLE_BLOCKED_REASON_SET.has(reason)
    )
    if (!blocked) {
      continue
    }

    blockedTaskIds.add(evaluation.item.blockId)
  }

  return blockedTaskIds
}

function matchesDashboardQuickFilter(
  item: FilterableTaskItem,
  context: DashboardQuickFilterContext | null,
): boolean {
  if (context == null) {
    return true
  }

  if (item.status === context.doneStatus) {
    return false
  }

  const dueMs = item.endTime?.getTime()
  if (context.filter === "overdue") {
    return typeof dueMs === "number" && !Number.isNaN(dueMs) && dueMs < context.nowMs
  }

  if (context.filter === "due-today") {
    return typeof dueMs === "number" &&
      !Number.isNaN(dueMs) &&
      dueMs >= context.startOfTodayMs &&
      dueMs < context.endOfTodayMs
  }

  return item.blockId != null && context.blockedTaskIds.has(item.blockId)
}

function resolveDashboardQuickFilterLabel(
  filter: TaskDashboardQuickFilter,
): string {
  if (filter === "overdue") {
    return t("Only overdue")
  }
  if (filter === "due-today") {
    return t("Only due today")
  }
  return t("Only blocked")
}

function buildTaskDashboardData(
  params: BuildTaskDashboardDataParams,
): TaskDashboardData {
  const {
    allTaskItems,
    nextActionItems,
    blockedCounts,
    blockedTaskIds,
    schema,
  } = params
  const now = new Date()
  const nowMs = now.getTime()
  const doneStatus = schema.statusChoices[2]
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTodayMs = startOfToday.getTime()
  const endOfTodayMs = startOfTodayMs + DAY_MS
  const endOf48HoursMs = nowMs + 2 * DAY_MS
  const openItems = allTaskItems.filter((item: AllTaskItem) => item.status !== doneStatus)
  const overdueTasks = openItems.filter((item: AllTaskItem) => {
    const dueMs = resolveTaskDueTimeMs(item)
    return dueMs != null && dueMs < nowMs
  }).length
  const dueTodayTasks = openItems.filter((item: AllTaskItem) => {
    const dueMs = resolveTaskDueTimeMs(item)
    return dueMs != null && dueMs >= startOfTodayMs && dueMs < endOfTodayMs
  }).length
  const mustDoTodayTasks = openItems.filter((item: AllTaskItem) => {
    const dueMs = resolveTaskDueTimeMs(item)
    return dueMs != null && dueMs < endOfTodayMs
  }).length
  const actionableDue48hTasks = nextActionItems.filter((item: NextActionItem) => {
    const dueMs = resolveTaskDueTimeMs(item)
    return dueMs != null && dueMs >= nowMs && dueMs < endOf48HoursMs
  }).length
  const doneTodayTasks = allTaskItems.filter((item: AllTaskItem) => {
    if (item.status !== doneStatus || item.completedAt == null) {
      return false
    }

    const completedMs = item.completedAt.getTime()
    return !Number.isNaN(completedMs) && completedMs >= startOfTodayMs && completedMs < endOfTodayMs
  }).length

  return {
    actionableTasks: nextActionItems.length,
    dueTodayTasks,
    mustDoTodayTasks,
    overdueTasks,
    actionableDue48hTasks,
    doneTodayTasks,
    blockedTasks: blockedTaskIds.size,
    dueBuckets: buildDashboardDueBuckets(openItems, now),
    blockerItems: buildDashboardBlockerItems(blockedCounts),
    topActions: nextActionItems.slice(0, 6).map((item: NextActionItem) => ({
      blockId: item.blockId,
      text: item.text,
      score: item.score,
      endTime: item.endTime,
    })),
  }
}

function buildDashboardDueBuckets(
  openItems: AllTaskItem[],
  now: Date,
): TaskDashboardData["dueBuckets"] {
  const buckets: TaskDashboardData["dueBuckets"] = []
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTodayMs = startOfToday.getTime()
  const locale = orca.state.locale === "zh-CN" ? "zh-CN" : undefined
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: "short" })

  const overdueCount = openItems.filter((item: AllTaskItem) => {
    const dueMs = item.endTime?.getTime()
    return typeof dueMs === "number" && !Number.isNaN(dueMs) && dueMs < startOfTodayMs
  }).length
  buckets.push({
    key: "overdue",
    label: t("Overdue"),
    count: overdueCount,
    isPast: true,
  })

  for (let offset = 0; offset < DASHBOARD_DUE_DAYS; offset += 1) {
    const dayStartMs = startOfTodayMs + offset * DAY_MS
    const dayEndMs = dayStartMs + DAY_MS
    const dayStart = new Date(dayStartMs)
    const count = openItems.filter((item: AllTaskItem) => {
      const dueMs = item.endTime?.getTime()
      return typeof dueMs === "number" &&
        !Number.isNaN(dueMs) &&
        dueMs >= dayStartMs &&
        dueMs < dayEndMs
    }).length

    buckets.push({
      key: `day-${offset}`,
      label: offset === 0 ? t("Today") : weekdayFormatter.format(dayStart),
      count,
      isPast: false,
    })
  }

  return buckets
}

function buildDashboardBlockerItems(
  blockedCounts: BlockedReasonCountMap,
): TaskDashboardData["blockerItems"] {
  const reasonOrder: NextActionBlockedReason[] = [
    "dependency-unmet",
    "has-open-children",
    "not-started",
    "dependency-delayed",
    "ancestor-dependency-unmet",
    "completed",
    "canceled",
  ]

  return reasonOrder
    .map((reason) => ({
      key: reason,
      label: resolveBlockedReasonLabel(reason),
      count: blockedCounts[reason] ?? 0,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
}

function resolveBlockedReasonLabel(reason: NextActionBlockedReason): string {
  if (reason === "completed") {
    return t("Blocked by completion")
  }
  if (reason === "canceled") {
    return t("Blocked by cancellation")
  }
  if (reason === "not-started") {
    return t("Blocked by start time")
  }
  if (reason === "dependency-unmet") {
    return t("Blocked by dependencies")
  }
  if (reason === "dependency-delayed") {
    return t("Blocked by dependency delay")
  }
  if (reason === "has-open-children") {
    return t("Blocked by open subtasks")
  }

  return t("Blocked by ancestor dependencies")
}

let taskFilterNodeSeed = 0

function createTaskFilterNodeId(prefix: string): string {
  taskFilterNodeSeed += 1
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${taskFilterNodeSeed.toString(36)}-${randomPart}`
}

function ensureUniqueTaskFilterNodeIds(
  root: TaskFilterGroupNode,
): TaskFilterGroupNode {
  const usedIds = new Set<string>()

  const cloneNode = (
    node: TaskFilterNode,
    isRoot: boolean,
  ): TaskFilterNode => {
    const preferredId = typeof node.id === "string" ? node.id.trim() : ""
    let id = preferredId
    if (id === "" || usedIds.has(id)) {
      id = isRoot
        ? FILTER_GROUP_ROOT_ID
        : createTaskFilterNodeId(node.kind === "group" ? "group" : "rule")
    }
    usedIds.add(id)

    if (node.kind === "rule") {
      return {
        ...node,
        id,
      }
    }

    return {
      ...node,
      id,
      children: node.children.map((child) => cloneNode(child, false)),
    }
  }

  return cloneNode(root, true) as TaskFilterGroupNode
}

function createTaskFilterGroup(
  id: string = createTaskFilterNodeId("group"),
  logic: TaskFilterGroupLogic = "and",
): TaskFilterGroupNode {
  return {
    id,
    kind: "group",
    logic,
    children: [],
  }
}

function createTaskNameFilterField(): TaskFilterField {
  return {
    key: FILTER_TASK_NAME_FIELD_KEY,
    label: t("Task name"),
    type: "text",
    options: [],
    extractValue: (item: FilterableTaskItem) => item.text,
  }
}

function createTaskFilterRule(field: TaskFilterField): TaskFilterRuleNode {
  return {
    id: createTaskFilterNodeId("rule"),
    kind: "rule",
    fieldKey: field.key,
    operator: getDefaultTaskFilterOperatorForField(field),
    value: getDefaultTaskFilterValueForField(field),
  }
}

function toTaskFilterFieldKey(propertyName: string): string {
  return `prop:${propertyName}`
}

function normalizeTaskFilterTextValues(values: string[]): string[] {
  const normalizedValues: string[] = []
  const seen = new Set<string>()

  for (const rawValue of values) {
    const value = rawValue.replace(/\s+/g, " ").trim()
    if (value === "") {
      continue
    }

    const dedupKey = value.toLowerCase()
    if (seen.has(dedupKey)) {
      continue
    }

    seen.add(dedupKey)
    normalizedValues.push(value)
  }

  return normalizedValues
}

function mergeTaskFilterProperties(
  schemaProperties: BlockProperty[],
  knownProperties: BlockProperty[],
): BlockProperty[] {
  const merged = new Map<string, BlockProperty>()
  const appendProperty = (property: BlockProperty) => {
    if (typeof property.name !== "string") {
      return
    }

    const normalizedName = property.name.replace(/\s+/g, " ").trim()
    if (normalizedName === "" || normalizedName.startsWith("_")) {
      return
    }

    const key = toTaskFilterFieldKey(normalizedName)
    if (merged.has(key)) {
      return
    }

    merged.set(key, {
      ...property,
      name: normalizedName,
    })
  }

  for (const property of schemaProperties) {
    appendProperty(property)
  }
  for (const property of knownProperties) {
    appendProperty(property)
  }

  return Array.from(merged.values())
}

function collectKnownTaskFilterProperties(
  items: FilterableTaskItem[],
): BlockProperty[] {
  const propertiesByKey = new Map<string, BlockProperty>()
  const appendProperty = (property: BlockProperty) => {
    if (typeof property.name !== "string") {
      return
    }

    const normalizedName = property.name.replace(/\s+/g, " ").trim()
    if (normalizedName === "" || normalizedName.startsWith("_")) {
      return
    }

    const key = toTaskFilterFieldKey(normalizedName)
    if (propertiesByKey.has(key)) {
      return
    }

    propertiesByKey.set(key, {
      ...property,
      name: normalizedName,
    })
  }

  for (const item of items) {
    const propertySources = [
      item.taskTagRef?.data,
      ...collectTaskFilterItemBlockPropertySources(item),
    ]
    for (const properties of propertySources) {
      if (!Array.isArray(properties)) {
        continue
      }

      for (const property of properties) {
        appendProperty(property)
      }
    }
  }

  return Array.from(propertiesByKey.values())
}

function collectTaskFilterItemBlockPropertySources(
  item: FilterableTaskItem,
): BlockProperty[][] {
  const sources: BlockProperty[][] = []
  if (Array.isArray(item.blockProperties) && item.blockProperties.length > 0) {
    sources.push(item.blockProperties)
  }

  const visited = new Set<DbId>()
  const appendSource = (rawId: DbId | null | undefined) => {
    if (rawId == null) {
      return
    }

    const candidateIds = [rawId, getMirrorId(rawId)]
    for (const candidateId of candidateIds) {
      if (visited.has(candidateId)) {
        continue
      }
      visited.add(candidateId)

      const properties = orca.state.blocks[candidateId]?.properties
      if (Array.isArray(properties) && properties.length > 0) {
        sources.push(properties)
      }
    }
  }

  appendSource(item.sourceBlockId)
  appendSource(item.blockId)
  appendSource(item.taskTagRef?.from)

  return sources
}

function collectKnownTaskFilterBlockRefOptionLabels(
  items: FilterableTaskItem[],
  taskNameById: Map<string, string>,
): Map<string, string> {
  const result = new Map<string, string>()
  for (const [id, taskName] of taskNameById.entries()) {
    const normalizedTaskName = taskName.replace(/\s+/g, " ").trim()
    if (normalizedTaskName !== "" && !result.has(id)) {
      result.set(id, normalizedTaskName)
    }
  }

  const sourceBlockIds = new Set<DbId>()
  for (const item of items) {
    if (item.sourceBlockId != null) {
      sourceBlockIds.add(item.sourceBlockId)
    }
    if (item.blockId != null) {
      sourceBlockIds.add(item.blockId)
    }

    if (item.taskTagRef?.from != null) {
      sourceBlockIds.add(item.taskTagRef.from)
    }
  }

  for (const sourceBlockId of sourceBlockIds) {
    const sourceBlock = orca.state.blocks[sourceBlockId]
    if (sourceBlock == null || !Array.isArray(sourceBlock.refs)) {
      continue
    }

    for (const ref of sourceBlock.refs) {
      const refKey = String(ref.id)
      if (result.has(refKey)) {
        continue
      }

      const targetCandidates = [String(ref.to), String(getMirrorId(ref.to))]
      const targetName = targetCandidates
        .map((candidate) => taskNameById.get(candidate))
        .find((candidate) => typeof candidate === "string" && candidate.trim() !== "")

      if (typeof targetName === "string" && targetName.trim() !== "") {
        result.set(refKey, targetName.trim())
      }
    }
  }

  return result
}

function collectKnownTaskFilterPropertyOptions(
  items: FilterableTaskItem[],
  knownBlockRefOptionLabels: Map<string, string>,
): Map<string, TaskFilterFieldOption[]> {
  const optionsByProperty = new Map<string, Map<string, TaskFilterFieldOption>>()
  const appendOption = (
    propertyName: string,
    rawValue: unknown,
    propertyType: number | undefined,
  ) => {
    const value = toTaskFilterKnownOptionValue(rawValue)
    if (value === "") {
      return
    }

    let propertyOptions = optionsByProperty.get(propertyName)
    if (propertyOptions == null) {
      propertyOptions = new Map<string, TaskFilterFieldOption>()
      optionsByProperty.set(propertyName, propertyOptions)
    }

    const dedupKey = value.toLowerCase()
    if (propertyOptions.has(dedupKey)) {
      return
    }

    const label = propertyType === PROP_TYPE_BLOCK_REFS
      ? formatTaskFilterBlockRefOptionLabel(value, knownBlockRefOptionLabels)
      : value
    propertyOptions.set(dedupKey, toTaskFilterOption(value, label))
  }

  for (const item of items) {
    const propertySources = [
      item.taskTagRef?.data,
      ...collectTaskFilterItemBlockPropertySources(item),
    ]
    for (const properties of propertySources) {
      if (!Array.isArray(properties)) {
        continue
      }

      for (const property of properties) {
        if (typeof property.name !== "string" || property.name.trim() === "") {
          continue
        }
        if (property.name.startsWith("_")) {
          continue
        }

        if (Array.isArray(property.value)) {
          for (const rawValue of property.value) {
            appendOption(property.name, rawValue, property.type)
          }
          continue
        }

        appendOption(property.name, property.value, property.type)
      }
    }
  }

  const result = new Map<string, TaskFilterFieldOption[]>()
  for (const [propertyName, propertyOptions] of optionsByProperty.entries()) {
    result.set(
      propertyName,
      Array.from(propertyOptions.values())
        .sort((left, right) => left.label.localeCompare(right.label)),
    )
  }
  return result
}

function formatTaskFilterBlockRefOptionLabel(
  value: string,
  knownBlockRefOptionLabels: Map<string, string>,
): string {
  const knownLabel = knownBlockRefOptionLabels.get(value)
  if (knownLabel != null && knownLabel.trim() !== "") {
    return knownLabel
  }

  const parsed = Number(value)
  if (!Number.isNaN(parsed)) {
    const candidateIds = [parsed, getMirrorId(parsed)]
    for (const candidateId of candidateIds) {
      const blockText = orca.state.blocks[candidateId]?.text
      if (typeof blockText === "string" && blockText.trim() !== "") {
        return blockText.replace(/\s+/g, " ").trim()
      }
    }
  }

  return value
}

function toTaskFilterKnownOptionValue(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim()
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  return ""
}

function extendTaskFilterOptionsWithValues(
  options: TaskFilterFieldOption[],
  values: string[],
  resolveLabel?: (value: string) => string,
): TaskFilterFieldOption[] {
  if (values.length === 0) {
    return options
  }

  const optionMap = new Map<string, TaskFilterFieldOption>()
  for (const option of options) {
    optionMap.set(option.value.toLowerCase(), option)
  }

  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized === "") {
      continue
    }

    const key = normalized.toLowerCase()
    if (!optionMap.has(key)) {
      optionMap.set(
        key,
        toTaskFilterOption(
          normalized,
          resolveLabel?.(normalized),
        ),
      )
    }
  }

  return Array.from(optionMap.values())
}

function readTaskFilterChoiceValues(property: BlockProperty): TaskFilterFieldOption[] {
  const rawChoices = property.typeArgs?.choices
  if (!Array.isArray(rawChoices)) {
    return []
  }

  const choices = rawChoices.map((item) => {
    if (typeof item === "string") {
      return item
    }
    if (isRecord(item) && typeof item.n === "string") {
      return item.n
    }
    if (isRecord(item) && typeof item.value === "string") {
      return item.value
    }
    return ""
  })
  return normalizeTaskFilterTextValues(choices).map((value) => toTaskFilterOption(value))
}

function buildTaskFilterFields(
  schema: TaskSchemaDefinition,
  properties: BlockProperty[],
  knownLabelValues: string[],
  knownPropertyValueOptions: Map<string, TaskFilterFieldOption[]>,
  knownBlockRefOptionLabels: Map<string, string>,
): TaskFilterField[] {
  const fields: TaskFilterField[] = [createTaskNameFilterField()]
  const seenKeys = new Set<string>([FILTER_TASK_NAME_FIELD_KEY])
  const sortedProperties = [...properties].sort((left, right) => {
    const leftPos = typeof left.pos === "number" ? left.pos : Number.MAX_SAFE_INTEGER
    const rightPos = typeof right.pos === "number" ? right.pos : Number.MAX_SAFE_INTEGER
    if (leftPos !== rightPos) {
      return leftPos - rightPos
    }
    return left.name.localeCompare(right.name)
  })

  for (const property of sortedProperties) {
    if (typeof property.name !== "string" || property.name.trim() === "") {
      continue
    }
    if (property.name.startsWith("_")) {
      continue
    }

    const key = toTaskFilterFieldKey(property.name)
    if (seenKeys.has(key)) {
      continue
    }

    const field = buildTaskFilterFieldFromProperty(
      schema,
      property,
      knownLabelValues,
      knownPropertyValueOptions,
      knownBlockRefOptionLabels,
    )
    fields.push(field)
    seenKeys.add(key)
  }

  const statusKey = toTaskFilterFieldKey(schema.propertyNames.status)
  if (!seenKeys.has(statusKey)) {
    fields.push({
      key: statusKey,
      label: schema.propertyNames.status,
      type: "single-select",
      options: schema.statusChoices.map((status) => toTaskFilterOption(status)),
      extractValue: (item: FilterableTaskItem) => item.status,
    })
    seenKeys.add(statusKey)
  }

  const labelsKey = toTaskFilterFieldKey(schema.propertyNames.labels)
  if (!seenKeys.has(labelsKey)) {
    fields.push({
      key: labelsKey,
      label: schema.propertyNames.labels,
      type: "multi-select",
      options: knownLabelValues.map((label) => toTaskFilterOption(label)),
      extractValue: (item: FilterableTaskItem) => item.labels ?? [],
    })
  }

  for (const field of createTaskFilterMetaFields()) {
    if (seenKeys.has(field.key)) {
      continue
    }
    fields.push(field)
    seenKeys.add(field.key)
  }

  return fields
}

function createTaskFilterMetaFields(): TaskFilterField[] {
  const importanceLabel = t("Importance")
  const urgencyLabel = t("Urgency")
  const effortLabel = t("Effort")
  const repeatRuleLabel = t("Repeat rule")
  const reviewEveryLabel = t("Review every")
  const reviewLegacyLabel = t("Review")

  return [
    {
      key: toTaskFilterFieldKey(importanceLabel),
      aliasKeys: [toTaskFilterFieldKey("Importance"), toTaskFilterFieldKey("重要性")],
      label: importanceLabel,
      type: "number",
      options: [],
      extractValue: (item: FilterableTaskItem) => {
        return readTaskFilterVirtualMetaPropertyValue(item, importanceLabel)
      },
    },
    {
      key: toTaskFilterFieldKey(urgencyLabel),
      aliasKeys: [toTaskFilterFieldKey("Urgency"), toTaskFilterFieldKey("紧急度")],
      label: urgencyLabel,
      type: "number",
      options: [],
      extractValue: (item: FilterableTaskItem) => {
        return readTaskFilterVirtualMetaPropertyValue(item, urgencyLabel)
      },
    },
    {
      key: toTaskFilterFieldKey(effortLabel),
      aliasKeys: [toTaskFilterFieldKey("Effort"), toTaskFilterFieldKey("工作量")],
      label: effortLabel,
      type: "number",
      options: [],
      extractValue: (item: FilterableTaskItem) => {
        return readTaskFilterVirtualMetaPropertyValue(item, effortLabel)
      },
    },
    {
      key: toTaskFilterFieldKey(repeatRuleLabel),
      aliasKeys: [toTaskFilterFieldKey("Repeat rule"), toTaskFilterFieldKey("重复规则")],
      label: repeatRuleLabel,
      type: "text",
      options: [],
      extractValue: (item: FilterableTaskItem) => {
        return readTaskFilterVirtualMetaPropertyValue(item, repeatRuleLabel)
      },
    },
    {
      key: toTaskFilterFieldKey(reviewEveryLabel),
      aliasKeys: [
        toTaskFilterFieldKey("Review every"),
        toTaskFilterFieldKey("回顾周期"),
        toTaskFilterFieldKey("Review"),
        toTaskFilterFieldKey("回顾"),
        toTaskFilterFieldKey(reviewLegacyLabel),
      ],
      label: reviewEveryLabel,
      type: "review-rule",
      options: [],
      operatorOptions: ["eq", "neq", "empty", "not-empty"],
      defaultValue: "day:1",
      extractValue: (item: FilterableTaskItem) => {
        const rawValue = typeof item.reviewEvery === "string" && item.reviewEvery.trim() !== ""
          ? item.reviewEvery
          : readTaskFilterVirtualMetaPropertyValue(item, reviewEveryLabel)
        return toTaskFilterReviewRuleValue(rawValue)
      },
    },
  ]
}

function buildTaskFilterFieldFromProperty(
  schema: TaskSchemaDefinition,
  property: BlockProperty,
  knownLabelValues: string[],
  knownPropertyValueOptions: Map<string, TaskFilterFieldOption[]>,
  knownBlockRefOptionLabels: Map<string, string>,
): TaskFilterField {
  const propertyName = property.name
  const isReviewEveryProperty = isTaskFilterReviewEveryPropertyName(propertyName)
  const key = toTaskFilterFieldKey(propertyName)
  let fieldType: TaskFilterFieldType = "text"
  let options: TaskFilterFieldOption[] = []
  let operatorOptions: TaskFilterOperator[] | undefined
  let resolveOptionLabel: ((value: string) => string) | undefined
  let defaultValue: string | string[] | undefined

  if (property.type === PROP_TYPE_TEXT_CHOICES) {
    const subType = typeof property.typeArgs?.subType === "string"
      ? property.typeArgs.subType
      : "single"
    fieldType = subType === "multi" ? "multi-select" : "single-select"
    options = readTaskFilterChoiceValues(property)
  } else if (property.type === PROP_TYPE_NUMBER) {
    fieldType = "number"
  } else if (property.type === PROP_TYPE_BOOLEAN) {
    fieldType = "boolean"
    options = [
      toTaskFilterOption("true", t("True")),
      toTaskFilterOption("false", t("False")),
    ]
  } else if (property.type === PROP_TYPE_DATE_TIME) {
    fieldType = "datetime"
  } else if (property.type === PROP_TYPE_BLOCK_REFS) {
    fieldType = "block-refs"
    resolveOptionLabel = (value: string) => {
      return formatTaskFilterBlockRefOptionLabel(value, knownBlockRefOptionLabels)
    }
  } else if (property.type === PROP_TYPE_TEXT) {
    fieldType = "text"
  }

  if (isReviewEveryProperty) {
    fieldType = "review-rule"
    operatorOptions = ["eq", "neq", "empty", "not-empty"]
    defaultValue = "day:1"
  }

  if (propertyName === schema.propertyNames.status) {
    fieldType = "single-select"
    options = options.length > 0
      ? options
      : schema.statusChoices.map((status) => toTaskFilterOption(status))
  } else if (propertyName === schema.propertyNames.labels) {
    fieldType = "multi-select"
    options = options.length > 0
      ? options
      : knownLabelValues.map((label) => toTaskFilterOption(label))
  } else if (propertyName === schema.propertyNames.star) {
    fieldType = "boolean"
    operatorOptions = ["eq"]
    options = [
      toTaskFilterOption("true", t("Starred")),
      toTaskFilterOption("false", t("Not starred")),
    ]
  } else if (propertyName === schema.propertyNames.dependsMode) {
    fieldType = "single-select"
    const rawModeValues = options.length > 0
      ? options.map((item) => item.value)
      : []
    options = mapTaskFilterDependencyModeOptions(rawModeValues)
  }

  if (
    options.length === 0 &&
    (fieldType === "single-select" || fieldType === "multi-select" || fieldType === "block-refs")
  ) {
    options = knownPropertyValueOptions.get(propertyName) ?? []
  }

  return {
    key,
    label: propertyName,
    type: fieldType,
    options,
    operatorOptions,
    resolveOptionLabel,
    defaultValue,
    extractValue: (item: FilterableTaskItem) => {
      if (propertyName === schema.propertyNames.status) {
        return item.status
      }
      if (isReviewEveryProperty) {
        const rawValue = typeof item.reviewEvery === "string" && item.reviewEvery.trim() !== ""
          ? item.reviewEvery
          : readTaskFilterItemPropertyValue(item, propertyName)
        return toTaskFilterReviewRuleValue(rawValue)
      }
      if (propertyName === schema.propertyNames.labels) {
        return item.labels ?? []
      }
      return readTaskFilterItemPropertyValue(item, propertyName)
    },
  }
}

function readTaskFilterItemPropertyValue(
  item: FilterableTaskItem,
  propertyName: string,
): unknown {
  const refValue = readTaskFilterPropertyValue(item.taskTagRef?.data, propertyName)
  if (refValue !== undefined) {
    return refValue
  }

  const virtualValue = readTaskFilterVirtualMetaPropertyValue(item, propertyName)
  if (virtualValue !== TASK_FILTER_PROPERTY_UNRESOLVED) {
    return virtualValue
  }

  for (const properties of collectTaskFilterItemBlockPropertySources(item)) {
    const blockValue = readTaskFilterPropertyValue(properties, propertyName)
    if (blockValue !== undefined) {
      return blockValue
    }
  }

  return undefined
}

function readTaskFilterVirtualMetaPropertyValue(
  item: FilterableTaskItem,
  propertyName: string,
): unknown | typeof TASK_FILTER_PROPERTY_UNRESOLVED {
  const normalized = propertyName.replace(/\s+/g, " ").trim().toLowerCase()
  const meta = readTaskFilterItemMetaData(item)

  if (normalized === "importance" || normalized === "重要性") {
    return readTaskFilterMetaPriorityValue(meta, "importance")
  }
  if (normalized === "urgency" || normalized === "紧急度") {
    return readTaskFilterMetaPriorityValue(meta, "urgency")
  }
  if (normalized === "effort" || normalized === "工作量") {
    return readTaskFilterMetaPriorityValue(meta, "effort")
  }
  if (normalized === "repeat rule" || normalized === "重复规则") {
    return readTaskFilterMetaRepeatRuleValue(meta)
  }
  if (
    normalized === "review every" ||
    normalized === "回顾周期" ||
    normalized === "review" ||
    normalized === "回顾"
  ) {
    if (typeof item.reviewEvery === "string" && item.reviewEvery.trim() !== "") {
      return item.reviewEvery
    }
    return readTaskFilterMetaReviewEveryValue(meta)
  }

  return TASK_FILTER_PROPERTY_UNRESOLVED
}

function readTaskFilterItemMetaData(
  item: FilterableTaskItem,
): Record<string, unknown> | null {
  for (const properties of collectTaskFilterItemBlockPropertySources(item)) {
    const rawValue = readTaskFilterPropertyValue(properties, TASK_META_PROPERTY_NAME)
    if (isRecord(rawValue)) {
      return rawValue
    }

    if (typeof rawValue === "string") {
      try {
        const parsed = JSON.parse(rawValue) as unknown
        if (isRecord(parsed)) {
          return parsed
        }
      } catch {
        continue
      }
    }
  }

  return null
}

function readTaskFilterMetaPriorityValue(
  meta: Record<string, unknown> | null,
  key: "importance" | "urgency" | "effort",
): number | null {
  const priorityRaw = meta?.priority
  if (!isRecord(priorityRaw)) {
    return null
  }

  return toTaskFilterMetaNumber(priorityRaw[key])
}

function readTaskFilterMetaReviewEveryValue(
  meta: Record<string, unknown> | null,
): string {
  const reviewRaw = meta?.review
  if (!isRecord(reviewRaw)) {
    return ""
  }

  return typeof reviewRaw.reviewEvery === "string"
    ? reviewRaw.reviewEvery
    : ""
}

function readTaskFilterMetaRepeatRuleValue(
  meta: Record<string, unknown> | null,
): string {
  const recurrenceRaw = meta?.recurrence
  if (!isRecord(recurrenceRaw)) {
    return ""
  }

  if (typeof recurrenceRaw.repeatRule === "string") {
    return recurrenceRaw.repeatRule
  }
  if (typeof recurrenceRaw.rule === "string") {
    return recurrenceRaw.rule
  }
  return ""
}

function toTaskFilterMetaNumber(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null
  }

  return Number.isFinite(value) ? value : null
}

function readTaskFilterPropertyValue(
  refData: BlockProperty[] | undefined,
  propertyName: string,
): unknown {
  const property = refData?.find((item) => item.name === propertyName)
  return property?.value
}

function isTaskFilterReviewEveryPropertyName(propertyName: string): boolean {
  const normalized = propertyName.replace(/\s+/g, " ").trim().toLowerCase()
  return normalized === "review every" || normalized === "回顾周期"
}

function toTaskFilterReviewRuleValue(value: unknown): string {
  const parsed = toTaskFilterReviewRuleConfig(value)
  if (parsed == null) {
    return ""
  }

  return `${parsed.unit}:${parsed.interval}`
}

function toTaskFilterReviewRuleConfig(
  value: unknown,
): { unit: ReviewUnit; interval: number } | null {
  if (typeof value === "string") {
    const normalized = value.trim()
    if (normalized === "") {
      return null
    }

    const shorthandMatch = normalized.match(/^(day|week|month):(\d+)$/)
    if (shorthandMatch != null) {
      const interval = Number(shorthandMatch[2])
      if (Number.isInteger(interval) && interval >= 1) {
        return {
          unit: shorthandMatch[1] as ReviewUnit,
          interval,
        }
      }
      return null
    }
  }

  const parsedRule = parseReviewRule(typeof value === "string" ? value : "")
  if (parsedRule == null) {
    return null
  }

  return {
    unit: parsedRule.unit,
    interval: parsedRule.interval,
  }
}

function parseTaskFilterReviewRuleEditorValue(
  value: string,
): { unit: ReviewUnit; intervalText: string } {
  const parsed = toTaskFilterReviewRuleConfig(value)
  if (parsed == null) {
    return {
      unit: "day",
      intervalText: "1",
    }
  }

  return {
    unit: parsed.unit,
    intervalText: String(parsed.interval),
  }
}

function serializeTaskFilterReviewRuleEditorValue(
  unit: ReviewUnit,
  intervalText: string,
): string {
  const digitsOnly = intervalText.replace(/[^\d]/g, "")
  if (digitsOnly === "") {
    return ""
  }

  return `${unit}:${digitsOnly}`
}

function isTaskFilterOperator(value: string): value is TaskFilterOperator {
  return value === "eq" ||
    value === "neq" ||
    value === "contains" ||
    value === "contains-any" ||
    value === "contains-all" ||
    value === "not-contains" ||
    value === "gt" ||
    value === "gte" ||
    value === "lt" ||
    value === "lte" ||
    value === "between" ||
    value === "before" ||
    value === "after" ||
    value === "empty" ||
    value === "not-empty"
}

function toTaskFilterOption(value: string, label?: string): TaskFilterFieldOption {
  return {
    value,
    label: label ?? value,
  }
}

function mapTaskFilterDependencyModeOptions(rawValues: string[]): TaskFilterFieldOption[] {
  const normalizedValues = normalizeTaskFilterTextValues(rawValues)
  if (normalizedValues.length === 0) {
    return [
      toTaskFilterOption("ALL", t("All dependency tasks completed")),
      toTaskFilterOption("ANY", t("Any dependency task completed")),
    ]
  }

  return normalizedValues.map((value) => {
    const normalized = value.replace(/\s+/g, "").toUpperCase()
    if (normalized === "ALL") {
      return toTaskFilterOption(value, t("All dependency tasks completed"))
    }
    if (normalized === "ANY") {
      return toTaskFilterOption(value, t("Any dependency task completed"))
    }
    return toTaskFilterOption(value)
  })
}

function getTaskFilterSelectMenuStyleRole(pluginName: string): string {
  return `${pluginName}-task-filter-select-menu`
}

function doesTaskFilterOperatorNeedValue(operator: TaskFilterOperator): boolean {
  return operator !== "empty" && operator !== "not-empty"
}

function getTaskFilterOperatorOptions(
  fieldType: TaskFilterFieldType,
): Array<{ value: TaskFilterOperator; label: string }> {
  if (fieldType === "review-rule") {
    return [
      { value: "eq", label: t("Equals") },
      { value: "neq", label: t("Not equals") },
      { value: "empty", label: t("Is empty") },
      { value: "not-empty", label: t("Is not empty") },
    ]
  }

  if (fieldType === "number") {
    return [
      { value: "eq", label: t("Equals") },
      { value: "neq", label: t("Not equals") },
      { value: "gt", label: t("Greater than") },
      { value: "gte", label: t("Greater or equal") },
      { value: "lt", label: t("Less than") },
      { value: "lte", label: t("Less or equal") },
      { value: "between", label: t("Between") },
      { value: "empty", label: t("Is empty") },
      { value: "not-empty", label: t("Is not empty") },
    ]
  }

  if (fieldType === "datetime") {
    return [
      { value: "eq", label: t("Equals") },
      { value: "before", label: t("Before") },
      { value: "after", label: t("After") },
      { value: "lte", label: t("On or before") },
      { value: "gte", label: t("On or after") },
      { value: "between", label: t("Between") },
      { value: "empty", label: t("Is empty") },
      { value: "not-empty", label: t("Is not empty") },
    ]
  }

  if (fieldType === "single-select" || fieldType === "boolean") {
    return [
      { value: "eq", label: t("Equals") },
      { value: "neq", label: t("Not equals") },
      { value: "empty", label: t("Is empty") },
      { value: "not-empty", label: t("Is not empty") },
    ]
  }

  if (fieldType === "multi-select" || fieldType === "block-refs") {
    return [
      { value: "contains-any", label: t("Contains any") },
      { value: "contains-all", label: t("Contains all") },
      { value: "not-contains", label: t("Does not contain") },
      { value: "eq", label: t("Equals") },
      { value: "neq", label: t("Not equals") },
      { value: "empty", label: t("Is empty") },
      { value: "not-empty", label: t("Is not empty") },
    ]
  }

  return [
    { value: "contains", label: t("Contains") },
    { value: "not-contains", label: t("Does not contain") },
    { value: "eq", label: t("Equals") },
    { value: "neq", label: t("Not equals") },
    { value: "empty", label: t("Is empty") },
    { value: "not-empty", label: t("Is not empty") },
  ]
}

function getTaskFilterOperatorOptionsForField(
  field: TaskFilterField,
): Array<{ value: TaskFilterOperator; label: string }> {
  const baseOptions = getTaskFilterOperatorOptions(field.type)
  if (field.operatorOptions == null || field.operatorOptions.length === 0) {
    return baseOptions
  }

  const allowedSet = new Set<TaskFilterOperator>(field.operatorOptions)
  const filteredOptions = baseOptions.filter((item) => allowedSet.has(item.value))
  return filteredOptions.length > 0 ? filteredOptions : baseOptions
}

function getDefaultTaskFilterOperator(fieldType: TaskFilterFieldType): TaskFilterOperator {
  if (
    fieldType === "single-select" ||
    fieldType === "number" ||
    fieldType === "boolean" ||
    fieldType === "review-rule"
  ) {
    return "eq"
  }
  if (fieldType === "datetime") {
    return "after"
  }
  if (fieldType === "multi-select" || fieldType === "block-refs") {
    return "contains-any"
  }
  return "contains"
}

function getDefaultTaskFilterOperatorForField(field: TaskFilterField): TaskFilterOperator {
  return getTaskFilterOperatorOptionsForField(field)[0]?.value ??
    getDefaultTaskFilterOperator(field.type)
}

function getDefaultTaskFilterValue(fieldType: TaskFilterFieldType): string | string[] {
  if (fieldType === "multi-select" || fieldType === "block-refs") {
    return []
  }
  if (fieldType === "review-rule") {
    return "day:1"
  }
  return ""
}

function getDefaultTaskFilterValueForField(field: TaskFilterField): string | string[] {
  if (field.defaultValue != null) {
    return Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue
  }

  return getDefaultTaskFilterValue(field.type)
}

function isTaskFilterRangeOperator(
  fieldType: TaskFilterFieldType,
  operator: TaskFilterOperator,
): boolean {
  return (fieldType === "number" || fieldType === "datetime") && operator === "between"
}

function isTaskFilterMultiValueOperator(
  fieldType: TaskFilterFieldType,
  operator: TaskFilterOperator,
): boolean {
  if (fieldType !== "multi-select" && fieldType !== "block-refs") {
    return false
  }

  return operator === "contains" ||
    operator === "contains-any" ||
    operator === "contains-all" ||
    operator === "not-contains" ||
    operator === "eq" ||
    operator === "neq"
}

function normalizeTaskFilterRuleValueForOperator(
  field: TaskFilterField,
  operator: TaskFilterOperator,
  value: string | string[],
): string | string[] {
  if (!doesTaskFilterOperatorNeedValue(operator)) {
    return getDefaultTaskFilterValue(field.type)
  }

  if (isTaskFilterRangeOperator(field.type, operator)) {
    const [startValue, endValue] = toTaskFilterRuleEditorRangeValues(value)
    return [startValue, endValue]
  }

  if (isTaskFilterMultiValueOperator(field.type, operator)) {
    return toTaskFilterRuleValues(value)
  }

  return toTaskFilterRuleValues(value)[0] ?? ""
}

function normalizeTaskFilterOperatorForField(
  field: TaskFilterField,
  operator: TaskFilterOperator,
): TaskFilterOperator {
  const operatorOptions = getTaskFilterOperatorOptionsForField(field)
  if (operatorOptions.some((item) => item.value === operator)) {
    return operator
  }

  return getDefaultTaskFilterOperatorForField(field)
}

function countEffectiveTaskFilterRules(
  group: TaskFilterGroupNode,
  fields: Map<string, TaskFilterField>,
): number {
  return group.children.reduce((total, child) => {
    if (child.kind === "group") {
      return total + countEffectiveTaskFilterRules(child, fields)
    }
    return total + (isTaskFilterRuleEffective(child, fields) ? 1 : 0)
  }, 0)
}

function isTaskFilterRuleEffective(
  rule: TaskFilterRuleNode,
  fields: Map<string, TaskFilterField>,
): boolean {
  const field = fields.get(rule.fieldKey)
  if (field == null) {
    return false
  }
  const operator = normalizeTaskFilterOperatorForField(field, rule.operator)
  if (!doesTaskFilterOperatorNeedValue(operator)) {
    return true
  }
  const values = toTaskFilterRuleValues(rule.value)
  if (operator === "between") {
    return values.length >= 2
  }
  return values.length > 0
}

function appendRuleToTaskFilterGroup(
  group: TaskFilterGroupNode,
  targetGroupId: string,
  rule: TaskFilterRuleNode,
): TaskFilterGroupNode {
  if (group.id === targetGroupId) {
    return {
      ...group,
      children: [...group.children, rule],
    }
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.kind !== "group") {
        return child
      }
      return appendRuleToTaskFilterGroup(child, targetGroupId, rule)
    }),
  }
}

function appendGroupToTaskFilterGroup(
  group: TaskFilterGroupNode,
  targetGroupId: string,
  nextGroup: TaskFilterGroupNode,
): TaskFilterGroupNode {
  if (group.id === targetGroupId) {
    return {
      ...group,
      children: [...group.children, nextGroup],
    }
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.kind !== "group") {
        return child
      }
      return appendGroupToTaskFilterGroup(child, targetGroupId, nextGroup)
    }),
  }
}

function removeTaskFilterNode(
  group: TaskFilterGroupNode,
  targetNodeId: string,
): TaskFilterGroupNode {
  const nextChildren = group.children
    .filter((child) => child.id !== targetNodeId)
    .map((child) => {
      if (child.kind !== "group") {
        return child
      }
      return removeTaskFilterNode(child, targetNodeId)
    })

  return {
    ...group,
    children: nextChildren,
  }
}

function updateTaskFilterGroupLogic(
  group: TaskFilterGroupNode,
  targetGroupId: string,
  logic: TaskFilterGroupLogic,
): TaskFilterGroupNode {
  if (group.id === targetGroupId) {
    return {
      ...group,
      logic,
    }
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.kind !== "group") {
        return child
      }
      return updateTaskFilterGroupLogic(child, targetGroupId, logic)
    }),
  }
}

function updateTaskFilterRule(
  group: TaskFilterGroupNode,
  targetRuleId: string,
  updater: (rule: TaskFilterRuleNode) => TaskFilterRuleNode,
): TaskFilterGroupNode {
  return {
    ...group,
    children: group.children.map((child) => {
      if (child.kind === "rule" && child.id === targetRuleId) {
        return updater(child)
      }

      if (child.kind === "group") {
        return updateTaskFilterRule(child, targetRuleId, updater)
      }

      return child
    }),
  }
}

function evaluateTaskFilterGroup(
  group: TaskFilterGroupNode,
  item: FilterableTaskItem,
  fields: Map<string, TaskFilterField>,
): boolean {
  const effectiveChildren = group.children.filter((child) => {
    if (child.kind === "group") {
      return countEffectiveTaskFilterRules(child, fields) > 0
    }
    return isTaskFilterRuleEffective(child, fields)
  })

  if (effectiveChildren.length === 0) {
    return true
  }

  if (group.logic === "and") {
    return effectiveChildren.every((child) => {
      if (child.kind === "group") {
        return evaluateTaskFilterGroup(child, item, fields)
      }
      return evaluateTaskFilterRule(child, item, fields)
    })
  }

  return effectiveChildren.some((child) => {
    if (child.kind === "group") {
      return evaluateTaskFilterGroup(child, item, fields)
    }
    return evaluateTaskFilterRule(child, item, fields)
  })
}

function evaluateTaskFilterRule(
  rule: TaskFilterRuleNode,
  item: FilterableTaskItem,
  fields: Map<string, TaskFilterField>,
): boolean {
  const field = fields.get(rule.fieldKey)
  if (field == null) {
    return true
  }
  const operator = normalizeTaskFilterOperatorForField(field, rule.operator)

  const rawValue = field.extractValue(item)
  if (operator === "empty") {
    return isTaskFilterEmptyValue(rawValue, field.type)
  }
  if (operator === "not-empty") {
    return !isTaskFilterEmptyValue(rawValue, field.type)
  }

  const targets = toTaskFilterRuleValues(rule.value)
  if (targets.length === 0) {
    return true
  }
  const rawTarget = targets[0] ?? ""

  if (field.type === "number") {
    if (operator === "between") {
      const [startValue, endValue] = toTaskFilterRuleRangeValues(rule.value) ?? []
      const currentNumber = toTaskFilterNumber(rawValue)
      const startNumber = toTaskFilterNumber(startValue)
      const endNumber = toTaskFilterNumber(endValue)
      if (currentNumber == null || startNumber == null || endNumber == null) {
        return false
      }

      const minValue = Math.min(startNumber, endNumber)
      const maxValue = Math.max(startNumber, endNumber)
      return currentNumber >= minValue && currentNumber <= maxValue
    }

    const currentNumber = toTaskFilterNumber(rawValue)
    const targetNumber = Number(rawTarget)
    if (currentNumber == null || Number.isNaN(targetNumber)) {
      return false
    }

    if (operator === "eq") {
      return currentNumber === targetNumber
    }
    if (operator === "neq") {
      return currentNumber !== targetNumber
    }
    if (operator === "gt") {
      return currentNumber > targetNumber
    }
    if (operator === "gte") {
      return currentNumber >= targetNumber
    }
    if (operator === "lt") {
      return currentNumber < targetNumber
    }
    if (operator === "lte") {
      return currentNumber <= targetNumber
    }
    return false
  }

  if (field.type === "datetime") {
    if (operator === "between") {
      const [startValue, endValue] = toTaskFilterRuleRangeValues(rule.value) ?? []
      const currentMs = toTaskFilterDateMs(rawValue)
      const startMs = toTaskFilterDateMs(startValue)
      const endMs = toTaskFilterDateMs(endValue)
      if (currentMs == null || startMs == null || endMs == null) {
        return false
      }

      const minValue = Math.min(startMs, endMs)
      const maxValue = Math.max(startMs, endMs)
      return currentMs >= minValue && currentMs <= maxValue
    }

    const currentMs = toTaskFilterDateMs(rawValue)
    const targetMs = toTaskFilterDateMs(rawTarget)
    if (currentMs == null || targetMs == null) {
      return false
    }

    if (operator === "eq") {
      return currentMs === targetMs
    }
    if (operator === "before") {
      return currentMs < targetMs
    }
    if (operator === "after") {
      return currentMs > targetMs
    }
    if (operator === "gte") {
      return currentMs >= targetMs
    }
    if (operator === "lte") {
      return currentMs <= targetMs
    }
    return false
  }

  if (field.type === "boolean") {
    const currentValue = toTaskFilterBoolean(rawValue)
    const targetValue = toTaskFilterBoolean(rawTarget)
    if (currentValue == null || targetValue == null) {
      return false
    }

    if (operator === "eq") {
      return currentValue === targetValue
    }
    if (operator === "neq") {
      return currentValue !== targetValue
    }
    return false
  }

  if (field.type === "review-rule") {
    const currentRule = toTaskFilterReviewRuleValue(rawValue)
    const targetRule = toTaskFilterReviewRuleValue(rawTarget)
    if (targetRule === "") {
      return false
    }

    if (operator === "eq") {
      return currentRule === targetRule
    }
    if (operator === "neq") {
      return currentRule !== targetRule
    }
    return false
  }

  if (field.type === "multi-select" || field.type === "block-refs") {
    const values = toTaskFilterStringArray(rawValue).map((value) => value.toLowerCase())
    const targetSet = normalizeTaskFilterTextValues(targets).map((target) => target.toLowerCase())
    const valueSet = normalizeTaskFilterTextValues(values).map((value) => value.toLowerCase())

    if (operator === "contains" || operator === "contains-any") {
      return targetSet.some((target) => valueSet.includes(target))
    }
    if (operator === "contains-all") {
      return targetSet.every((target) => valueSet.includes(target))
    }
    if (operator === "not-contains") {
      return targetSet.every((target) => !valueSet.includes(target))
    }
    if (operator === "eq") {
      if (valueSet.length !== targetSet.length) {
        return false
      }
      return targetSet.every((target) => valueSet.includes(target))
    }
    if (operator === "neq") {
      if (valueSet.length !== targetSet.length) {
        return true
      }
      return !targetSet.every((target) => valueSet.includes(target))
    }
    return false
  }

  const textValue = toTaskFilterText(rawValue)
  const targetText = rawTarget.toLowerCase()

  if (operator === "contains") {
    return textValue.includes(targetText)
  }
  if (operator === "not-contains") {
    return !textValue.includes(targetText)
  }
  if (operator === "eq") {
    return textValue === targetText
  }
  if (operator === "neq") {
    return textValue !== targetText
  }

  return false
}

function isTaskFilterEmptyValue(value: unknown, fieldType: TaskFilterFieldType): boolean {
  if (value == null) {
    return true
  }

  if (fieldType === "boolean") {
    return false
  }

  if (Array.isArray(value)) {
    return value.length === 0
  }

  if (fieldType === "number") {
    return toTaskFilterNumber(value) == null
  }
  if (fieldType === "datetime") {
    return toTaskFilterDateMs(value) == null
  }
  if (fieldType === "review-rule") {
    return toTaskFilterReviewRuleConfig(value) == null
  }

  return toTaskFilterText(value) === ""
}

function toTaskFilterRuleValues(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value
      .map((rawValue) => rawValue.replace(/\s+/g, " ").trim())
      .filter((normalizedValue) => normalizedValue !== "")
  }

  if (typeof value === "string") {
    const normalizedValue = value.replace(/\s+/g, " ").trim()
    return normalizedValue === "" ? [] : [normalizedValue]
  }

  return []
}

function toTaskFilterRuleEditorRangeValues(
  value: string | string[],
): [string, string] {
  if (Array.isArray(value)) {
    return [
      toTaskFilterEditorValue(value[0]),
      toTaskFilterEditorValue(value[1]),
    ]
  }

  if (typeof value === "string") {
    return [toTaskFilterEditorValue(value), ""]
  }

  return ["", ""]
}

function toTaskFilterRuleRangeValues(
  value: string | string[],
): [string, string] | null {
  const values = toTaskFilterRuleValues(value)
  if (values.length < 2) {
    return null
  }
  return [values[0] ?? "", values[1] ?? ""]
}

function parseTaskFilterEditorDateValue(value: string): Date | null {
  const ms = toTaskFilterDateMs(value)
  if (ms == null) {
    return null
  }

  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatTaskFilterDateEditorValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  const hour = String(value.getHours()).padStart(2, "0")
  const minute = String(value.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function formatTaskFilterDateDisplayText(value: Date): string {
  const locale = orca.state.locale === "zh-CN" ? "zh-CN" : undefined
  return value.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function toTaskFilterEditorValue(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }
  return value.replace(/\s+/g, " ").trim()
}

function splitTaskFilterInputValues(rawValue: string): string[] {
  return normalizeTaskFilterTextValues(
    rawValue.split(/[\n,\uFF0C\u3001;\uFF1B]+/g),
  )
}

function toTaskFilterStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTaskFilterTextValues(
      value
        .map((item) => {
          if (typeof item === "string") {
            return item
          }
          if (typeof item === "number") {
            return String(item)
          }
          return ""
        }),
    )
  }

  if (typeof value === "string") {
    return normalizeTaskFilterTextValues([value])
  }

  if (typeof value === "number") {
    return [String(value)]
  }

  return []
}

function toTaskFilterText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase()
  }
  if (typeof value === "number") {
    return String(value).toLowerCase()
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().toLowerCase()
  }
  return ""
}

function toTaskFilterNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function toTaskFilterBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (normalized === "true") {
      return true
    }
    if (normalized === "false") {
      return false
    }
  }
  return null
}

function toTaskFilterDateMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  if (typeof value === "number") {
    return Number.isNaN(value) ? null : value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null
}

function buildTaskTree(items: AllTaskItem[]): TaskTreeNode[] {
  const nodeById = new Map<DbId, TaskTreeNode>()

  for (const item of items) {
    nodeById.set(item.blockId, {
      item,
      children: [],
      contextOnly: false,
    })
  }

  const childrenByParentId = new Map<DbId | null, TaskTreeNode[]>()
  const appendChild = (parentId: DbId | null, node: TaskTreeNode) => {
    const list = childrenByParentId.get(parentId) ?? []
    list.push(node)
    childrenByParentId.set(parentId, list)
  }

  for (const node of nodeById.values()) {
    const { parentId, blockId } = node.item
    const hasTaskParent = parentId != null && nodeById.has(parentId)
    if (hasTaskParent && parentId !== blockId) {
      appendChild(parentId, node)
      continue
    }

    appendChild(null, node)
  }

  for (const [parentId, children] of childrenByParentId.entries()) {
    const orderMap =
      parentId != null
        ? new Map<number, number>(
            (nodeById.get(parentId)?.item.children ?? []).map((id, index) => [id, index]),
          )
        : null

    children.sort((left, right) => {
      const leftOrder = orderMap?.get(left.item.blockId) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = orderMap?.get(right.item.blockId) ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.item.blockId - right.item.blockId
    })
  }

  for (const [parentId, children] of childrenByParentId.entries()) {
    if (parentId == null) {
      continue
    }

    const parent = nodeById.get(parentId)
    if (parent != null) {
      parent.children = children
    }
  }

  const roots = childrenByParentId.get(null) ?? []
  const visited = new Set<DbId>()
  visitTree(roots, visited)

  const detached = Array.from(nodeById.values())
    .filter((node) => !visited.has(node.item.blockId))
    .sort((left, right) => left.item.blockId - right.item.blockId)

  return roots.concat(detached)
}

function filterTreeWithContext(
  nodes: TaskTreeNode[],
  predicate: (item: { status: string; text: string; labels?: string[] }) => boolean,
): TaskTreeNode[] {
  const filterNode = (node: TaskTreeNode): TaskTreeNode | null => {
    const matchedChildren = node.children
      .map(filterNode)
      .filter((item): item is TaskTreeNode => item != null)
    const matchedSelf = predicate(node.item)

    if (!matchedSelf && matchedChildren.length === 0) {
      return null
    }

    return {
      item: node.item,
      children: matchedChildren,
      contextOnly: !matchedSelf,
    }
  }

  return nodes
    .map(filterNode)
    .filter((item): item is TaskTreeNode => item != null)
}

function resolveTaskDueTimeMs(
  item: { endTime?: Date | null },
): number | null {
  const dueMs = item.endTime?.getTime()
  if (typeof dueMs !== "number" || Number.isNaN(dueMs)) {
    return null
  }

  return dueMs
}

function isDueSoon(
  endTime: Date | null,
  startMs: number,
  endMs: number,
  includeOverdue: boolean,
): boolean {
  if (endTime == null) {
    return false
  }

  const dueMs = endTime.getTime()
  if (Number.isNaN(dueMs)) {
    return false
  }

  if (dueMs < startMs) {
    return includeOverdue
  }

  return dueMs <= endMs
}

function isReviewDue(
  nextReview: Date | null,
  nowMs: number,
): boolean {
  if (nextReview == null) {
    return false
  }

  const reviewMs = nextReview.getTime()
  if (Number.isNaN(reviewMs)) {
    return false
  }

  return reviewMs <= nowMs
}

function isTaskDueForReview(item: AllTaskItem, nowMs: number): boolean {
  if (!item.reviewEnabled) {
    return false
  }

  if (isReviewDue(item.nextReview, nowMs)) {
    return true
  }

  return isNeverReviewedCycleTask(item)
}

function compareDueSoonItems(left: AllTaskItem, right: AllTaskItem): number {
  const leftDue = left.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rightDue = right.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER
  if (leftDue !== rightDue) {
    return leftDue - rightDue
  }

  return left.blockId - right.blockId
}

function compareReviewDueItems(left: AllTaskItem, right: AllTaskItem): number {
  const leftReview = resolveReviewSortTime(left)
  const rightReview = resolveReviewSortTime(right)
  if (leftReview !== rightReview) {
    return leftReview - rightReview
  }

  return left.blockId - right.blockId
}

function resolveReviewSortTime(item: AllTaskItem): number {
  const reviewMs = item.nextReview?.getTime()
  if (typeof reviewMs === "number" && !Number.isNaN(reviewMs)) {
    return reviewMs
  }

  if (isNeverReviewedCycleTask(item)) {
    return Number.MIN_SAFE_INTEGER
  }

  return Number.MAX_SAFE_INTEGER
}

function isNeverReviewedCycleTask(item: AllTaskItem): boolean {
  return item.reviewEnabled &&
    item.reviewType === "cycle" &&
    item.reviewEvery.trim() !== "" &&
    item.lastReviewed == null &&
    item.nextReview == null
}

function flattenVisibleTree(
  nodes: TaskTreeNode[],
  collapsedIds: Set<DbId>,
): VisibleTreeRow[] {
  const result: VisibleTreeRow[] = []
  const walk = (node: TaskTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0
    const collapsed = hasChildren && collapsedIds.has(node.item.blockId)

    result.push({
      node,
      depth,
      hasChildren,
      collapsed,
    })

    if (hasChildren && !collapsed) {
      node.children.forEach((child) => walk(child, depth + 1))
    }
  }

  nodes.forEach((node) => walk(node, 0))
  return result
}

function visitTree(nodes: TaskTreeNode[], visited: Set<DbId>) {
  for (const node of nodes) {
    if (visited.has(node.item.blockId)) {
      continue
    }

    visited.add(node.item.blockId)
    visitTree(node.children, visited)
  }
}

function collectCollapsibleNodeIds(nodes: TaskTreeNode[]): DbId[] {
  const ids: DbId[] = []
  const walk = (node: TaskTreeNode) => {
    if (node.children.length > 0) {
      ids.push(node.item.blockId)
    }
    node.children.forEach(walk)
  }

  nodes.forEach(walk)
  return ids
}


