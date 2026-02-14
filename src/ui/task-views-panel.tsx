import type { Block, BlockProperty, BlockRef, DbId, PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  getPreferredTaskViewsTab,
  isTaskViewsTab,
  setPreferredTaskViewsTab,
  subscribePreferredTaskViewsTab,
  type TaskViewsTab,
} from "../core/task-views-state"
import {
  collectNextActionEvaluations,
  collectNextActions,
  selectNextActionsFromEvaluations,
  type NextActionBlockedReason,
  type NextActionItem,
} from "../core/dependency-engine"
import {
  collectAllTasks,
  cycleTaskStatusInView,
  markTaskReviewedInView,
  moveTaskInView,
  toggleTaskStarInView,
  type AllTaskItem,
} from "../core/all-tasks-engine"
import {
  getPluginSettings,
  type MyLifeOrganizedSettings,
} from "../core/plugin-settings"
import { t } from "../libs/l10n"
import { TaskDashboard, type TaskDashboardData } from "./task-dashboard"
import { TaskPropertyPanelCard } from "./task-property-card"
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

type TaskFilterGroupLogic = "and" | "or"
type TaskFilterFieldType =
  | "text"
  | "single-select"
  | "multi-select"
  | "number"
  | "boolean"
  | "datetime"
  | "block-refs"
type TaskFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "contains-any"
  | "contains-all"
  | "not-contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "empty"
  | "not-empty"

interface TaskFilterRuleNode {
  id: string
  kind: "rule"
  fieldKey: string
  operator: TaskFilterOperator
  value: string | string[]
}

interface TaskFilterGroupNode {
  id: string
  kind: "group"
  logic: TaskFilterGroupLogic
  children: TaskFilterNode[]
}

type TaskFilterNode = TaskFilterRuleNode | TaskFilterGroupNode

interface TaskFilterField {
  key: string
  label: string
  type: TaskFilterFieldType
  options: string[]
  extractValue: (item: FilterableTaskItem) => unknown
}

interface FilterableTaskItem {
  status: string
  text: string
  labels?: string[]
  taskTagRef?: BlockRef | null
}

const PROP_TYPE_TEXT = 1
const PROP_TYPE_BLOCK_REFS = 2
const PROP_TYPE_NUMBER = 3
const PROP_TYPE_BOOLEAN = 4
const PROP_TYPE_DATE_TIME = 5
const PROP_TYPE_TEXT_CHOICES = 6
const FILTER_TASK_NAME_FIELD_KEY = "__task_name__"
const FILTER_GROUP_ROOT_ID = "__root__"
const DAY_MS = 24 * 60 * 60 * 1000
const DASHBOARD_DUE_DAYS = 7

type BlockedReasonCountMap = Partial<Record<NextActionBlockedReason, number>>

export function TaskViewsPanel(props: TaskViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Popup = orca.components.Popup
  const Select = orca.components.Select
  const Segmented = orca.components.Segmented
  const Switch = orca.components.Switch

  const isChinese = orca.state.locale === "zh-CN"
  const [tab, setTab] = React.useState<TaskViewsTab>(() => {
    return getPreferredTaskViewsTab()
  })
  const filterButtonAnchorRef = React.useRef<HTMLDivElement | null>(null)
  const filterPopupContainerRef = React.useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [errorText, setErrorText] = React.useState("")
  const [filterPanelVisible, setFilterPanelVisible] = React.useState(false)
  const [quickSearchKeyword, setQuickSearchKeyword] = React.useState("")
  const [taskTagProperties, setTaskTagProperties] = React.useState<BlockProperty[]>([])
  const [filterRoot, setFilterRoot] = React.useState<TaskFilterGroupNode>(() =>
    createTaskFilterGroup(FILTER_GROUP_ROOT_ID, "and")
  )
  const [showCompletedInAllTasks, setShowCompletedInAllTasks] = React.useState(true)
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())
  const [starringIds, setStarringIds] = React.useState<Set<DbId>>(new Set())
  const [reviewingIds, setReviewingIds] = React.useState<Set<DbId>>(new Set())
  const [selectedReviewIds, setSelectedReviewIds] = React.useState<Set<DbId>>(new Set())
  const [movingIds, setMovingIds] = React.useState<Set<DbId>>(new Set())
  const [collapsedIds, setCollapsedIds] = React.useState<Set<DbId>>(new Set())
  const [draggingTaskId, setDraggingTaskId] = React.useState<DbId | null>(null)
  const [dropTarget, setDropTarget] = React.useState<TaskDropTarget | null>(null)
  const [nextActionItems, setNextActionItems] = React.useState<NextActionItem[]>([])
  const [allTaskItems, setAllTaskItems] = React.useState<AllTaskItem[]>([])
  const [dashboardBlockedCounts, setDashboardBlockedCounts] = React.useState<BlockedReasonCountMap>(
    {},
  )
  const [dashboardGeneratedAt, setDashboardGeneratedAt] = React.useState<Date>(() => new Date())
  const [selectedTaskId, setSelectedTaskId] = React.useState<DbId | null>(null)
  const [panelSettings, setPanelSettings] = React.useState<MyLifeOrganizedSettings>(() =>
    getPluginSettings(props.pluginName)
  )

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
          setNextActionItems(selectNextActionsFromEvaluations(evaluations))
          setDashboardBlockedCounts(countBlockedReasons(evaluations))
          setDashboardGeneratedAt(new Date())
        } else if (targetTab === "next-actions") {
          const nextActions = await collectNextActions(props.schema)
          setNextActionItems(nextActions)
        } else {
          const allTasks = await collectAllTasks(props.schema)
          setAllTaskItems(allTasks)
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
    [props.schema],
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
  }, [filterPanelVisible, loadTaskTagProperties])

  React.useEffect(() => {
    setFilterPanelVisible(false)
  }, [tab])

  React.useEffect(() => {
    // Listen for block changes and do lightweight refresh.
    const { subscribe } = window.Valtio
    let refreshTimer: number | null = null
    const unsubscribe = subscribe(orca.state.blocks, () => {
      if (selectedTaskId != null) {
        return
      }

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
  }, [loadByTab, selectedTaskId, tab])

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
    [loadByTab, props.schema, tab],
  )

  const openTaskProperty = React.useCallback(
    (blockId: DbId) => {
      setSelectedTaskId(blockId)
    },
    [],
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

  const closeTaskProperty = React.useCallback(() => {
    setSelectedTaskId(null)
    void loadByTab(tab, { silent: true })
  }, [loadByTab, tab])

  const addTask = React.useCallback(() => {
    openTaskPropertyPopup({
      schema: props.schema,
      triggerSource: "panel-view",
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
  const filterFields = React.useMemo(() => {
    return buildTaskFilterFields(props.schema, taskTagProperties, knownLabelValues)
  }, [knownLabelValues, props.schema, taskTagProperties])
  const filterFieldByKey = React.useMemo(() => {
    const map = new Map<string, TaskFilterField>()
    for (const field of filterFields) {
      map.set(field.key, field)
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
          operator: getDefaultTaskFilterOperator(field.type),
          value: getDefaultTaskFilterValue(field.type),
        }))
      })
    },
    [filterFieldByKey, filterFields],
  )

  const updateFilterRuleOperator = React.useCallback((ruleId: string, operator: TaskFilterOperator) => {
    setFilterRoot((prev: TaskFilterGroupNode) => {
      return updateTaskFilterRule(prev, ruleId, (rule) => ({
        ...rule,
        operator,
      }))
    })
  }, [])

  const updateFilterRuleValue = React.useCallback((ruleId: string, value: string | string[]) => {
    setFilterRoot((prev: TaskFilterGroupNode) => {
      return updateTaskFilterRule(prev, ruleId, (rule) => ({
        ...rule,
        value,
      }))
    })
  }, [])

  const matchesItem = React.useCallback(
    (item: FilterableTaskItem) => {
      if (normalizedQuickSearch !== "" && !item.text.toLowerCase().includes(normalizedQuickSearch)) {
        return false
      }

      if (!hasActiveFilters) {
        return true
      }

      return evaluateTaskFilterGroup(filterRoot, item, filterFieldByKey)
    },
    [filterFieldByKey, filterRoot, hasActiveFilters, normalizedQuickSearch],
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
      .filter((item: AllTaskItem) => item.status !== props.schema.statusChoices[2])
      .filter((item: AllTaskItem) => isTaskDueForReview(item, nowMs))
      .filter(matchesItem)
      .sort(compareReviewDueItems)
  }, [allTaskItems, matchesItem, props.schema.statusChoices])
  const isDashboardTab = tab === "dashboard"
  const isReviewDueTab = tab === "review-due"
  const isAllTasksTab = tab === "all-tasks"
  const showParentTaskContext = tab === "next-actions"
  const flatVisibleItems = React.useMemo((): TaskListRowItem[] => {
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

    return []
  }, [
    filteredDueSoonTaskItems,
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

  const doneStatus = props.schema.statusChoices[2]
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
      schema: props.schema,
      dueSoonDays: panelSettings.dueSoonDays,
      dueSoonIncludeOverdue: panelSettings.dueSoonIncludeOverdue,
    })
  }, [
    allTaskItems,
    dashboardBlockedCounts,
    nextActionItems,
    panelSettings.dueSoonDays,
    panelSettings.dueSoonIncludeOverdue,
    props.schema,
  ])

  const viewName = tab === "dashboard"
    ? t("Dashboard")
    : tab === "next-actions"
      ? t("Active Tasks")
      : tab === "all-tasks"
        ? t("All Tasks")
        : tab === "starred-tasks"
          ? t("Starred Tasks")
          : tab === "due-soon"
            ? t("Due Soon")
            : t("Review")
  const visibleCount = isAllTasksTab
    ? visibleAllTaskRows.length
    : isDashboardTab
      ? allTaskItems.length
      : flatVisibleItems.length
  const emptyText = tab === "next-actions"
    ? t("No actionable tasks")
    : tab === "all-tasks"
      ? t("No matched tasks")
      : tab === "starred-tasks"
        ? t("No starred tasks")
        : tab === "due-soon"
          ? t("No due soon tasks")
          : tab === "dashboard"
            ? t("No task data yet")
            : t("No tasks to review")
  const panelAccentGlow = tab === "dashboard"
    ? "rgba(13, 148, 136, 0.2)"
    : tab === "next-actions"
      ? "rgba(37, 99, 235, 0.18)"
      : tab === "all-tasks"
        ? "rgba(183, 121, 31, 0.2)"
        : tab === "starred-tasks"
          ? "rgba(214, 158, 46, 0.18)"
          : tab === "due-soon"
            ? "rgba(221, 107, 32, 0.18)"
            : "rgba(56, 161, 105, 0.2)"
  const countText = isDashboardTab
    ? t("Total ${count} tasks", { count: String(visibleCount) })
    : t("Showing ${count} items", { count: String(visibleCount) })
  const groupLogicOptions = [
    { value: "and", label: t("AND") },
    { value: "or", label: t("OR") },
  ]

  const renderFilterRuleNode = (rule: TaskFilterRuleNode, depth: number) => {
    const fallbackField = filterFields[0] ?? createTaskNameFilterField()
    const field = filterFieldByKey.get(rule.fieldKey) ?? fallbackField
    const operatorOptions = getTaskFilterOperatorOptions(field.type)
    const selectedOperator = operatorOptions.some((item) => item.value === rule.operator)
      ? rule.operator
      : getDefaultTaskFilterOperator(field.type)
    const needsValue = doesTaskFilterOperatorNeedValue(selectedOperator)
    const ruleValueList = toTaskFilterRuleValues(rule.value)
    const selectedSingleValue = ruleValueList[0] ?? ""
    const multiValueEnabled = (field.type === "multi-select" || field.type === "block-refs") &&
      (selectedOperator === "contains" ||
        selectedOperator === "contains-any" ||
        selectedOperator === "contains-all" ||
        selectedOperator === "not-contains" ||
        selectedOperator === "eq" ||
        selectedOperator === "neq")
    const operatorSelectOptions = operatorOptions.map((item) => ({
      value: item.value,
      label: item.label,
    }))

    let valueEditor: React.ReactNode = null
    if (needsValue) {
      if (field.type === "single-select" || field.type === "multi-select" || field.type === "block-refs") {
        const options = field.options.map((option: string) => ({
          value: option,
          label: option,
        }))
        valueEditor = options.length > 0
          ? React.createElement(Select, {
              selected: multiValueEnabled
                ? ruleValueList
                : (selectedSingleValue === "" ? [] : [selectedSingleValue]),
              options,
              multiSelection: multiValueEnabled,
              filter: true,
              onChange: (selected: string[]) =>
                updateFilterRuleValue(rule.id, multiValueEnabled ? selected : (selected[0] ?? "")),
              width: "100%",
              menuContainer: filterPopupContainerRef,
            })
          : React.createElement(Input, {
              value: multiValueEnabled ? ruleValueList.join(", ") : selectedSingleValue,
              placeholder: multiValueEnabled ? t("Use comma to separate multiple values") : t("Value"),
              onChange: (event: Event) => {
                const target = event.target as HTMLInputElement | null
                updateFilterRuleValue(
                  rule.id,
                  multiValueEnabled
                    ? splitTaskFilterInputValues(target?.value ?? "")
                    : (target?.value ?? ""),
                )
              },
              width: "100%",
            })
      } else if (field.type === "boolean") {
        valueEditor = React.createElement(Select, {
          selected: selectedSingleValue === "" ? [] : [selectedSingleValue],
          options: [
            { value: "true", label: t("True") },
            { value: "false", label: t("False") },
          ],
          onChange: (selected: string[]) => updateFilterRuleValue(rule.id, selected[0] ?? ""),
          width: "100%",
          menuContainer: filterPopupContainerRef,
        })
      } else {
        valueEditor = React.createElement(Input, {
          value: selectedSingleValue,
          type: field.type === "number"
            ? "number"
            : field.type === "datetime"
              ? "datetime-local"
              : "text",
          placeholder: t("Value"),
          onChange: (event: Event) => {
            const target = event.target as HTMLInputElement | null
            updateFilterRuleValue(rule.id, target?.value ?? "")
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
            updateFilterRuleField(rule.id, selected[0] ?? fallbackField.key)
          },
          width: "100%",
          menuContainer: filterPopupContainerRef,
        }),
      ),
      React.createElement(
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
              updateFilterRuleOperator(rule.id, nextOperator)
            }
          },
          width: "100%",
          menuContainer: filterPopupContainerRef,
        }),
      ),
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
            onClick: () => removeFilterNode(rule.id),
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
            updateFilterGroupLogic(group.id, value === "or" ? "or" : "and")
          },
          style: {
            minWidth: "112px",
          },
        }),
        React.createElement(
          Button,
          {
            variant: "outline",
            onClick: () => addFilterRule(group.id),
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
            onClick: () => addFilterGroup(group.id),
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
                onClick: () => removeFilterNode(group.id),
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
              return renderFilterGroupNode(child, depth + 1)
            }
            return renderFilterRuleNode(child, depth + 1)
          }),
    )
  }

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
        width: "100%",
        minWidth: 0,
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
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
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
        React.createElement(Segmented, {
          selected: tab,
          options: [
            {
              value: "dashboard",
              label: t("Dashboard"),
            },
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
          ],
          onChange: (value: string) => {
            if (isTaskViewsTab(value)) {
              setPreferredTaskViewsTab(value)
            }
          },
          style: {
            minWidth: "280px",
            flex: "1 1 320px",
            maxWidth: "620px",
          },
        }),
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
            display: isDashboardTab ? "none" : "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            flex: "1 1 420px",
          },
        },
        React.createElement(
          "div",
          {
            ref: filterButtonAnchorRef,
            style: {
              display: "inline-flex",
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
              renderFilterGroupNode(filterRoot, 0, true),
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
          gridTemplateColumns:
            selectedTaskId == null
              ? "minmax(0, 1fr)"
              : "minmax(0, 1fr) minmax(360px, 460px)",
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
          ? React.createElement(TaskDashboard, {
              data: dashboardData,
              generatedAt: dashboardGeneratedAt,
              onOpenTask: (blockId: DbId) => {
                openTaskProperty(blockId)
              },
            })
          : null,
        !loading && !isDashboardTab && visibleCount > 0
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
                          reviewUpdating: reviewingIds.has(row.node.item.blockId),
                          onToggleCollapse: row.hasChildren
                            ? () => toggleCollapsed(row.node.item.blockId)
                            : undefined,
                          onToggleReviewSelected: undefined,
                          onToggleStatus: () => toggleTaskStatus(row.node.item),
                          onNavigate: () => navigateToTask(row.node.item),
                          onToggleStar: () => toggleTaskStar(row.node.item),
                          onMarkReviewed: () => markTaskReviewed(row.node.item),
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
                      reviewUpdating: reviewingIds.has(item.blockId),
                      onToggleReviewSelected: reviewSelectionEnabled
                        ? () => toggleReviewSelection(item.blockId)
                        : undefined,
                      onToggleStatus: () => toggleTaskStatus(item),
                      onNavigate: () => navigateToTask(item),
                      onToggleStar: () => toggleTaskStar(item),
                      onMarkReviewed: () => markTaskReviewed(item),
                      onOpen: () => openTaskProperty(item.blockId),
                    })
                  }),
            )
          : null,
      ),
      selectedTaskId != null
        ? React.createElement(TaskPropertyPanelCard, {
            blockId: selectedTaskId,
            schema: props.schema,
            onClose: closeTaskProperty,
          })
        : null,
    ),
  )
}

interface BuildTaskDashboardDataParams {
  allTaskItems: AllTaskItem[]
  nextActionItems: NextActionItem[]
  blockedCounts: BlockedReasonCountMap
  schema: TaskSchemaDefinition
  dueSoonDays: number
  dueSoonIncludeOverdue: boolean
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

function buildTaskDashboardData(
  params: BuildTaskDashboardDataParams,
): TaskDashboardData {
  const {
    allTaskItems,
    nextActionItems,
    blockedCounts,
    schema,
    dueSoonDays,
    dueSoonIncludeOverdue,
  } = params
  const now = new Date()
  const nowMs = now.getTime()
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices

  const doneTasks = allTaskItems.filter((item: AllTaskItem) => item.status === doneStatus).length
  const statusCounts = {
    todo: allTaskItems.filter((item: AllTaskItem) => item.status === todoStatus).length,
    doing: allTaskItems.filter((item: AllTaskItem) => item.status === doingStatus).length,
    done: doneTasks,
  }
  const openItems = allTaskItems.filter((item: AllTaskItem) => item.status !== doneStatus)
  const dueSoonEndMs = nowMs + Math.max(1, dueSoonDays) * DAY_MS
  const dueSoonTasks = openItems.filter((item: AllTaskItem) => {
    return isDueSoon(item.endTime, nowMs, dueSoonEndMs, dueSoonIncludeOverdue)
  }).length
  const overdueTasks = openItems.filter((item: AllTaskItem) => {
    const endMs = item.endTime?.getTime()
    return typeof endMs === "number" && !Number.isNaN(endMs) && endMs < nowMs
  }).length
  const reviewDueTasks = openItems.filter((item: AllTaskItem) => {
    return isTaskDueForReview(item, nowMs)
  }).length
  const starredTasks = allTaskItems.filter((item: AllTaskItem) => item.star).length
  const completionRate = allTaskItems.length === 0 ? 0 : (doneTasks / allTaskItems.length) * 100
  const averageActionScore = nextActionItems.length === 0
    ? null
    : nextActionItems.reduce((total, item) => total + item.score, 0) / nextActionItems.length

  return {
    totalTasks: allTaskItems.length,
    actionableTasks: nextActionItems.length,
    doneTasks,
    completionRate,
    starredTasks,
    dueSoonTasks,
    overdueTasks,
    reviewDueTasks,
    averageActionScore,
    statusSlices: [
      {
        key: "todo",
        label: todoStatus,
        count: statusCounts.todo,
        color: "linear-gradient(90deg, rgba(15, 23, 42, 0.42), rgba(15, 23, 42, 0.7))",
      },
      {
        key: "doing",
        label: doingStatus,
        count: statusCounts.doing,
        color: "linear-gradient(90deg, rgba(217, 119, 6, 0.55), rgba(217, 119, 6, 0.84))",
      },
      {
        key: "done",
        label: doneStatus,
        count: statusCounts.done,
        color: "linear-gradient(90deg, rgba(15, 118, 110, 0.6), rgba(15, 118, 110, 0.88))",
      },
    ],
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
  return `${prefix}-${taskFilterNodeSeed}`
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
    operator: getDefaultTaskFilterOperator(field.type),
    value: getDefaultTaskFilterValue(field.type),
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

function readTaskFilterChoiceValues(property: BlockProperty): string[] {
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
  return normalizeTaskFilterTextValues(choices)
}

function buildTaskFilterFields(
  schema: TaskSchemaDefinition,
  properties: BlockProperty[],
  knownLabelValues: string[],
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

    const field = buildTaskFilterFieldFromProperty(schema, property, knownLabelValues)
    fields.push(field)
    seenKeys.add(key)
  }

  const statusKey = toTaskFilterFieldKey(schema.propertyNames.status)
  if (!seenKeys.has(statusKey)) {
    fields.push({
      key: statusKey,
      label: schema.propertyNames.status,
      type: "single-select",
      options: [...schema.statusChoices],
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
      options: knownLabelValues,
      extractValue: (item: FilterableTaskItem) => item.labels ?? [],
    })
  }

  return fields
}

function buildTaskFilterFieldFromProperty(
  schema: TaskSchemaDefinition,
  property: BlockProperty,
  knownLabelValues: string[],
): TaskFilterField {
  const propertyName = property.name
  const key = toTaskFilterFieldKey(propertyName)
  let fieldType: TaskFilterFieldType = "text"
  let options: string[] = []

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
  } else if (property.type === PROP_TYPE_DATE_TIME) {
    fieldType = "datetime"
  } else if (property.type === PROP_TYPE_BLOCK_REFS) {
    fieldType = "block-refs"
  } else if (property.type === PROP_TYPE_TEXT) {
    fieldType = "text"
  }

  if (propertyName === schema.propertyNames.status) {
    fieldType = "single-select"
    options = options.length > 0 ? options : [...schema.statusChoices]
  } else if (propertyName === schema.propertyNames.labels) {
    fieldType = "multi-select"
    options = options.length > 0 ? options : knownLabelValues
  }

  return {
    key,
    label: propertyName,
    type: fieldType,
    options,
    extractValue: (item: FilterableTaskItem) => {
      if (propertyName === schema.propertyNames.status) {
        return item.status
      }
      if (propertyName === schema.propertyNames.labels) {
        return item.labels ?? []
      }
      return readTaskFilterPropertyValue(item.taskTagRef?.data, propertyName)
    },
  }
}

function readTaskFilterPropertyValue(
  refData: BlockProperty[] | undefined,
  propertyName: string,
): unknown {
  const property = refData?.find((item) => item.name === propertyName)
  return property?.value
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
    value === "before" ||
    value === "after" ||
    value === "empty" ||
    value === "not-empty"
}

function doesTaskFilterOperatorNeedValue(operator: TaskFilterOperator): boolean {
  return operator !== "empty" && operator !== "not-empty"
}

function getTaskFilterOperatorOptions(
  fieldType: TaskFilterFieldType,
): Array<{ value: TaskFilterOperator; label: string }> {
  if (fieldType === "number") {
    return [
      { value: "eq", label: t("Equals") },
      { value: "neq", label: t("Not equals") },
      { value: "gt", label: t("Greater than") },
      { value: "gte", label: t("Greater or equal") },
      { value: "lt", label: t("Less than") },
      { value: "lte", label: t("Less or equal") },
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

function getDefaultTaskFilterOperator(fieldType: TaskFilterFieldType): TaskFilterOperator {
  if (fieldType === "single-select" || fieldType === "number" || fieldType === "boolean") {
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

function getDefaultTaskFilterValue(fieldType: TaskFilterFieldType): string | string[] {
  if (fieldType === "multi-select" || fieldType === "block-refs") {
    return []
  }
  return ""
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
  if (!doesTaskFilterOperatorNeedValue(rule.operator)) {
    return true
  }
  return toTaskFilterRuleValues(rule.value).length > 0
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

  const rawValue = field.extractValue(item)
  if (rule.operator === "empty") {
    return isTaskFilterEmptyValue(rawValue, field.type)
  }
  if (rule.operator === "not-empty") {
    return !isTaskFilterEmptyValue(rawValue, field.type)
  }

  const targets = toTaskFilterRuleValues(rule.value)
  if (targets.length === 0) {
    return true
  }
  const rawTarget = targets[0] ?? ""

  if (field.type === "number") {
    const currentNumber = toTaskFilterNumber(rawValue)
    const targetNumber = Number(rawTarget)
    if (currentNumber == null || Number.isNaN(targetNumber)) {
      return false
    }

    if (rule.operator === "eq") {
      return currentNumber === targetNumber
    }
    if (rule.operator === "neq") {
      return currentNumber !== targetNumber
    }
    if (rule.operator === "gt") {
      return currentNumber > targetNumber
    }
    if (rule.operator === "gte") {
      return currentNumber >= targetNumber
    }
    if (rule.operator === "lt") {
      return currentNumber < targetNumber
    }
    if (rule.operator === "lte") {
      return currentNumber <= targetNumber
    }
    return false
  }

  if (field.type === "datetime") {
    const currentMs = toTaskFilterDateMs(rawValue)
    const targetMs = toTaskFilterDateMs(rawTarget)
    if (currentMs == null || targetMs == null) {
      return false
    }

    if (rule.operator === "eq") {
      return currentMs === targetMs
    }
    if (rule.operator === "before") {
      return currentMs < targetMs
    }
    if (rule.operator === "after") {
      return currentMs > targetMs
    }
    if (rule.operator === "gte") {
      return currentMs >= targetMs
    }
    if (rule.operator === "lte") {
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

    if (rule.operator === "eq") {
      return currentValue === targetValue
    }
    if (rule.operator === "neq") {
      return currentValue !== targetValue
    }
    return false
  }

  if (field.type === "multi-select" || field.type === "block-refs") {
    const values = toTaskFilterStringArray(rawValue).map((value) => value.toLowerCase())
    const targetSet = normalizeTaskFilterTextValues(targets).map((target) => target.toLowerCase())
    const valueSet = normalizeTaskFilterTextValues(values).map((value) => value.toLowerCase())

    if (rule.operator === "contains" || rule.operator === "contains-any") {
      return targetSet.some((target) => valueSet.includes(target))
    }
    if (rule.operator === "contains-all") {
      return targetSet.every((target) => valueSet.includes(target))
    }
    if (rule.operator === "not-contains") {
      return targetSet.every((target) => !valueSet.includes(target))
    }
    if (rule.operator === "eq") {
      if (valueSet.length !== targetSet.length) {
        return false
      }
      return targetSet.every((target) => valueSet.includes(target))
    }
    if (rule.operator === "neq") {
      if (valueSet.length !== targetSet.length) {
        return true
      }
      return !targetSet.every((target) => valueSet.includes(target))
    }
    return false
  }

  const textValue = toTaskFilterText(rawValue)
  const targetText = rawTarget.toLowerCase()

  if (rule.operator === "contains") {
    return textValue.includes(targetText)
  }
  if (rule.operator === "not-contains") {
    return !textValue.includes(targetText)
  }
  if (rule.operator === "eq") {
    return textValue === targetText
  }
  if (rule.operator === "neq") {
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

  return toTaskFilterText(value) === ""
}

function toTaskFilterRuleValues(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return normalizeTaskFilterTextValues(value)
  }

  if (typeof value === "string") {
    return normalizeTaskFilterTextValues([value])
  }

  return []
}

function splitTaskFilterInputValues(rawValue: string): string[] {
  return normalizeTaskFilterTextValues(
    rawValue.split(/[\n,，;；]+/g),
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
