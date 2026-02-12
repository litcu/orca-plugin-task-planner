import type { DbId, PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  getPreferredTaskViewsTab,
  setPreferredTaskViewsTab,
  subscribePreferredTaskViewsTab,
  type TaskViewsTab,
} from "../core/task-views-state"
import { collectNextActions, type NextActionItem } from "../core/dependency-engine"
import {
  collectAllTasks,
  cycleTaskStatusInView,
  type AllTaskItem,
} from "../core/all-tasks-engine"
import { openTaskPropertyPopup } from "./task-property-panel"
import { TaskListRow } from "./task-list-row"

interface TaskViewsPanelProps extends PanelProps {
  schema: TaskSchemaDefinition
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

export function TaskViewsPanel(props: TaskViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Select = orca.components.Select
  const Segmented = orca.components.Segmented

  const isChinese = orca.state.locale === "zh-CN"
  const [tab, setTab] = React.useState<TaskViewsTab>(() => {
    return getPreferredTaskViewsTab()
  })
  const [loading, setLoading] = React.useState(true)
  const [errorText, setErrorText] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [keyword, setKeyword] = React.useState("")
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())
  const [collapsedIds, setCollapsedIds] = React.useState<Set<DbId>>(new Set())
  const [nextActionItems, setNextActionItems] = React.useState<NextActionItem[]>([])
  const [allTaskItems, setAllTaskItems] = React.useState<AllTaskItem[]>([])

  const loadByTab = React.useCallback(
    async (targetTab: TaskViewsTab) => {
      setLoading(true)

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
        setErrorText(
          isChinese
            ? "加载任务视图失败"
            : "Failed to load task view",
        )
      } finally {
        setLoading(false)
      }
    },
    [isChinese, props.schema],
  )

  React.useEffect(() => {
    return subscribePreferredTaskViewsTab((nextTab) => {
      setTab(nextTab)
    })
  }, [])

  React.useEffect(() => {
    void loadByTab(tab)
  }, [loadByTab, tab])

  React.useEffect(() => {
    // 监听任务变更并轻量刷新，保证状态切换后视图及时更新。
    const { subscribe } = window.Valtio
    let refreshTimer: number | null = null
    const unsubscribe = subscribe(orca.state.blocks, () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(() => {
        void loadByTab(tab)
      }, 120)
    })

    return () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }
      unsubscribe()
    }
  }, [loadByTab, tab])

  const toggleTaskStatus = React.useCallback(
    async (blockId: DbId) => {
      setUpdatingIds((prev: Set<DbId>) => {
        const next = new Set(prev)
        next.add(blockId)
        return next
      })

      try {
        await cycleTaskStatusInView(blockId, props.schema)
        setErrorText("")
        await loadByTab(tab)
      } catch (error) {
        console.error(error)
        setErrorText(isChinese ? "切换任务状态失败" : "Failed to toggle task status")
      } finally {
        setUpdatingIds((prev: Set<DbId>) => {
          const next = new Set(prev)
          next.delete(blockId)
          return next
        })
      }
    },
    [isChinese, loadByTab, props.schema, tab],
  )

  const openTaskProperty = React.useCallback(
    (blockId: DbId) => {
      openTaskPropertyPopup({
        blockId,
        schema: props.schema,
        triggerSource: "panel-view",
      })
    },
    [props.schema],
  )

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
        label: isChinese ? "全部状态" : "All statuses",
      },
      ...props.schema.statusChoices.map((status) => ({
        value: status,
        label: status,
      })),
    ]
  }, [isChinese, props.schema])

  const normalizedKeyword = React.useMemo(() => keyword.trim().toLowerCase(), [keyword])
  const matchesItem = React.useCallback(
    (item: { status: string; text: string }) => {
      const statusMatched = statusFilter === "all" || item.status === statusFilter
      if (!statusMatched) {
        return false
      }

      if (normalizedKeyword === "") {
        return true
      }

      return item.text.toLowerCase().includes(normalizedKeyword)
    },
    [normalizedKeyword, statusFilter],
  )

  const filteredNextActionItems = React.useMemo(() => {
    return nextActionItems.filter(matchesItem)
  }, [matchesItem, nextActionItems])

  const allTaskTree = React.useMemo(() => buildTaskTree(allTaskItems), [allTaskItems])
  const filteredAllTaskTree = React.useMemo(() => {
    return filterTreeWithContext(allTaskTree, matchesItem)
  }, [allTaskTree, matchesItem])
  const visibleAllTaskRows = React.useMemo(() => {
    return flattenVisibleTree(filteredAllTaskTree, collapsedIds)
  }, [collapsedIds, filteredAllTaskTree])

  const viewName = tab === "next-actions"
    ? "Next Actions"
    : (isChinese ? "全量任务列表" : "All Tasks")

  const visibleCount = tab === "next-actions"
    ? filteredNextActionItems.length
    : visibleAllTaskRows.length

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        padding: "12px",
        boxSizing: "border-box",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
          gap: "8px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontSize: "16px",
            fontWeight: 600,
          },
        },
        viewName,
      ),
      React.createElement(
        Button,
        {
          variant: "outline",
          onClick: () => void loadByTab(tab),
          disabled: loading,
        },
        isChinese ? "刷新" : "Refresh",
      ),
    ),
    React.createElement(Segmented, {
      selected: tab,
      options: [
        {
          value: "next-actions",
          label: isChinese ? "Next Actions" : "Next Actions",
        },
        {
          value: "all-tasks",
          label: isChinese ? "全量任务" : "All Tasks",
        },
      ],
      onChange: (value: string) => {
        if (value === "next-actions" || value === "all-tasks") {
          setPreferredTaskViewsTab(value)
        }
      },
      style: {
        marginBottom: "8px",
      },
    }),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "8px",
          alignItems: "center",
        },
      },
      React.createElement(Select, {
        selected: [statusFilter],
        options: statusOptions,
        onChange: (selected: string[]) => setStatusFilter(selected[0] ?? "all"),
        width: 150,
      }),
      React.createElement(Input, {
        value: keyword,
        placeholder: isChinese ? "按关键字筛选" : "Filter by keyword",
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement | null
          setKeyword(target?.value ?? "")
        },
        style: {
          minWidth: "220px",
          flex: 1,
        },
      }),
      React.createElement(
        "div",
        {
          style: {
            fontSize: "12px",
            color: "var(--orca-color-text-2)",
            marginLeft: "auto",
          },
        },
        isChinese ? `显示 ${visibleCount} 项` : `${visibleCount} items`,
      ),
    ),
    errorText !== ""
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-red)",
              fontSize: "12px",
              marginBottom: "8px",
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
              padding: "4px 0",
            },
          },
          isChinese ? "加载中..." : "Loading...",
        )
      : null,
    !loading && visibleCount === 0
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-2)",
              fontSize: "13px",
              padding: "4px 0",
            },
          },
          tab === "next-actions"
            ? (isChinese ? "当前没有可执行任务" : "No actionable tasks")
            : (isChinese ? "没有匹配的任务" : "No matched tasks"),
        )
      : null,
    !loading && visibleCount > 0
      ? React.createElement(
          "div",
          {
            style: {
              overflow: "auto",
              width: "100%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "6px",
            },
          },
          tab === "next-actions"
            ? filteredNextActionItems.map((item: NextActionItem) => {
                return React.createElement(TaskListRow, {
                  key: item.blockId,
                  item,
                  schema: props.schema,
                  isChinese,
                  depth: 0,
                  contextOnly: false,
                  loading,
                  updating: updatingIds.has(item.blockId),
                  showCollapseToggle: false,
                  collapsed: false,
                  onToggleStatus: () => toggleTaskStatus(item.blockId),
                  onOpen: () => openTaskProperty(item.blockId),
                })
              })
            : visibleAllTaskRows.map((row: VisibleTreeRow) => {
                return React.createElement(TaskListRow, {
                  key: row.node.item.blockId,
                  item: row.node.item,
                  schema: props.schema,
                  isChinese,
                  depth: row.depth,
                  contextOnly: row.node.contextOnly,
                  loading,
                  updating: updatingIds.has(row.node.item.blockId),
                  showCollapseToggle: row.hasChildren,
                  collapsed: row.collapsed,
                  onToggleCollapse: row.hasChildren
                    ? () => toggleCollapsed(row.node.item.blockId)
                    : undefined,
                  onToggleStatus: () => toggleTaskStatus(row.node.item.blockId),
                  onOpen: () => openTaskProperty(row.node.item.blockId),
                })
              }),
        )
      : null,
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
