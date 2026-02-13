import type { DbId, PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  getPreferredTaskViewsTab,
  isTaskViewsTab,
  setPreferredTaskViewsTab,
  subscribePreferredTaskViewsTab,
  type TaskViewsTab,
} from "../core/task-views-state"
import { collectNextActions, type NextActionItem } from "../core/dependency-engine"
import {
  collectAllTasks,
  cycleTaskStatusInView,
  toggleTaskStarInView,
  type AllTaskItem,
} from "../core/all-tasks-engine"
import {
  getPluginSettings,
  type MyLifeOrganizedSettings,
} from "../core/plugin-settings"
import { t } from "../libs/l10n"
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

const DAY_MS = 24 * 60 * 60 * 1000

export function TaskViewsPanel(props: TaskViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Select = orca.components.Select
  const Segmented = orca.components.Segmented
  const Switch = orca.components.Switch

  const isChinese = orca.state.locale === "zh-CN"
  const [tab, setTab] = React.useState<TaskViewsTab>(() => {
    return getPreferredTaskViewsTab()
  })
  const [loading, setLoading] = React.useState(true)
  const [errorText, setErrorText] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [showCompletedInAllTasks, setShowCompletedInAllTasks] = React.useState(true)
  const [keyword, setKeyword] = React.useState("")
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())
  const [starringIds, setStarringIds] = React.useState<Set<DbId>>(new Set())
  const [collapsedIds, setCollapsedIds] = React.useState<Set<DbId>>(new Set())
  const [nextActionItems, setNextActionItems] = React.useState<NextActionItem[]>([])
  const [allTaskItems, setAllTaskItems] = React.useState<AllTaskItem[]>([])
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
        if (targetTab === "next-actions") {
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

  const navigateToTaskParent = React.useCallback((item: TaskListRowItem) => {
    const targetId = item.parentBlockId ?? item.blockId
    orca.nav.openInLastPanel("block", { blockId: targetId })
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

  const statusOptions = React.useMemo(() => {
    return [
      {
        value: "all",
        label: t("All statuses"),
      },
      ...props.schema.statusChoices.map((status) => ({
        value: status,
        label: status,
      })),
    ]
  }, [props.schema])

  const normalizedKeyword = React.useMemo(() => keyword.trim().toLowerCase(), [keyword])
  const matchesItem = React.useCallback(
    (item: { status: string; text: string; labels?: string[] }) => {
      const statusMatched = statusFilter === "all" || item.status === statusFilter
      if (!statusMatched) {
        return false
      }

      if (normalizedKeyword === "") {
        return true
      }

      if (item.text.toLowerCase().includes(normalizedKeyword)) {
        return true
      }

      return (item.labels ?? []).some((label) => {
        return label.toLowerCase().includes(normalizedKeyword)
      })
    },
    [normalizedKeyword, statusFilter],
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

    return []
  }, [filteredDueSoonTaskItems, filteredNextActionItems, filteredStarredTaskItems, tab])

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

  const viewName = tab === "next-actions"
    ? t("Active Tasks")
    : tab === "all-tasks"
      ? t("All Tasks")
      : tab === "starred-tasks"
        ? t("Starred Tasks")
        : t("Due Soon")
  const visibleCount = isAllTasksTab
    ? visibleAllTaskRows.length
    : flatVisibleItems.length
  const emptyText = tab === "next-actions"
    ? t("No actionable tasks")
    : tab === "all-tasks"
      ? t("No matched tasks")
      : tab === "starred-tasks"
        ? t("No starred tasks")
        : t("No due soon tasks")
  const panelAccentGlow = tab === "next-actions"
    ? "rgba(37, 99, 235, 0.18)"
    : tab === "all-tasks"
      ? "rgba(183, 121, 31, 0.2)"
      : tab === "starred-tasks"
        ? "rgba(214, 158, 46, 0.18)"
        : "rgba(221, 107, 32, 0.18)"
  const countText = t("Showing ${count} items", { count: String(visibleCount) })

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
      React.createElement(Select, {
        selected: [statusFilter],
        options: statusOptions,
        onChange: (selected: string[]) => setStatusFilter(selected[0] ?? "all"),
        width: 170,
      }),
      React.createElement(Input, {
        value: keyword,
        placeholder: t("Filter by keyword"),
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement | null
          setKeyword(target?.value ?? "")
        },
        style: {
          minWidth: "180px",
          flex: 1,
        },
      }),
      React.createElement(
        Button,
        {
          variant: "outline",
          onClick: () => {
            addTask()
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
              t("Loading..."),
            )
          : null,
        !loading && visibleCount === 0
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
        !loading && visibleCount > 0
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
                ? visibleAllTaskRows.map((row: VisibleTreeRow, index: number) => {
                    return React.createElement(TaskListRow, {
                      key: row.node.item.blockId,
                      item: row.node.item,
                      schema: props.schema,
                      isChinese,
                      rowIndex: index,
                      depth: row.depth,
                      contextOnly: row.node.contextOnly,
                      loading,
                      updating: updatingIds.has(row.node.item.blockId),
                      showCollapseToggle: row.hasChildren,
                      collapsed: row.collapsed,
                      showParentTaskContext: false,
                      starUpdating: starringIds.has(row.node.item.blockId),
                      onToggleCollapse: row.hasChildren
                        ? () => toggleCollapsed(row.node.item.blockId)
                        : undefined,
                      onToggleStatus: () => toggleTaskStatus(row.node.item),
                      onNavigate: () => navigateToTaskParent(row.node.item),
                      onToggleStar: () => toggleTaskStar(row.node.item),
                      onOpen: () => openTaskProperty(row.node.item.blockId),
                    })
                  })
                : flatVisibleItems.map((item: TaskListRowItem, index: number) => {
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
                      starUpdating: starringIds.has(item.blockId),
                      onToggleStatus: () => toggleTaskStatus(item),
                      onNavigate: () => navigateToTaskParent(item),
                      onToggleStar: () => toggleTaskStar(item),
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
  predicate: (item: { status: string; text: string }) => boolean,
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

function compareDueSoonItems(left: AllTaskItem, right: AllTaskItem): number {
  const leftDue = left.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER
  const rightDue = right.endTime?.getTime() ?? Number.MAX_SAFE_INTEGER
  if (leftDue !== rightDue) {
    return leftDue - rightDue
  }

  return left.blockId - right.blockId
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
