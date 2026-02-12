import type { DbId, PanelProps } from "../orca.d.ts"
import {
  collectAllTasks,
  cycleTaskStatusInView,
  type AllTaskItem,
} from "../core/all-tasks-engine"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { openTaskPropertyPopup } from "./task-property-panel"
import { TaskListRow } from "./task-list-row"

interface AllTasksPanelProps extends PanelProps {
  schema: TaskSchemaDefinition
}

interface TaskTreeNode {
  item: AllTaskItem
  children: TaskTreeNode[]
  contextOnly: boolean
}

export function AllTasksPanel(props: AllTasksPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Select = orca.components.Select

  const isChinese = orca.state.locale === "zh-CN"
  const [loading, setLoading] = React.useState(true)
  const [items, setItems] = React.useState<AllTaskItem[]>([])
  const [errorText, setErrorText] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [keyword, setKeyword] = React.useState("")
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())
  const [collapsedIds, setCollapsedIds] = React.useState<Set<DbId>>(new Set())

  const loadItems = React.useCallback(async () => {
    setLoading(true)

    try {
      const allTasks = await collectAllTasks(props.schema)
      setItems(allTasks)
      setErrorText("")
    } catch (error) {
      console.error(error)
      setErrorText(
        isChinese ? "加载全量任务列表失败" : "Failed to load all task list",
      )
    } finally {
      setLoading(false)
    }
  }, [props.schema, isChinese])

  React.useEffect(() => {
    void loadItems()

    // 监听任务变更并轻量刷新，保证状态切换后列表及时更新。
    const { subscribe } = window.Valtio
    let refreshTimer: number | null = null
    const unsubscribe = subscribe(orca.state.blocks, () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(() => {
        void loadItems()
      }, 120)
    })

    return () => {
      if (refreshTimer != null) {
        window.clearTimeout(refreshTimer)
      }
      unsubscribe()
    }
  }, [loadItems])

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
        await loadItems()
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
    [isChinese, loadItems, props.schema],
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

  const tree = React.useMemo(() => buildTaskTree(items), [items])
  const normalizedKeyword = React.useMemo(() => keyword.trim().toLowerCase(), [keyword])
  const matchesItem = React.useCallback(
    (item: AllTaskItem) => {
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

  const filteredTree = React.useMemo(() => {
    return filterTreeWithContext(tree, matchesItem)
  }, [matchesItem, tree])
  const visibleCount = React.useMemo(() => {
    return countVisibleTreeNodes(filteredTree, collapsedIds)
  }, [collapsedIds, filteredTree])

  const renderTreeRows = React.useCallback(
    (nodes: TaskTreeNode[], depth: number): React.ReactNode[] => {
      return nodes.flatMap((node) => {
        const hasChildren = node.children.length > 0
        const collapsed = hasChildren && collapsedIds.has(node.item.blockId)
        const row = React.createElement(TaskListRow, {
          key: node.item.blockId,
          item: node.item,
          schema: props.schema,
          isChinese,
          depth,
          contextOnly: node.contextOnly,
          loading,
          updating: updatingIds.has(node.item.blockId),
          showCollapseToggle: hasChildren,
          collapsed,
          onToggleCollapse: hasChildren
            ? () => toggleCollapsed(node.item.blockId)
            : undefined,
          onToggleStatus: () => toggleTaskStatus(node.item.blockId),
          onOpen: () => openTaskProperty(node.item.blockId),
        })

        if (!hasChildren || collapsed) {
          return [row]
        }

        return [row, ...renderTreeRows(node.children, depth + 1)]
      })
    },
    [
      collapsedIds,
      isChinese,
      loading,
      openTaskProperty,
      props.schema,
      toggleCollapsed,
      toggleTaskStatus,
      updatingIds,
    ],
  )

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
        isChinese ? "全量任务列表" : "All Tasks",
      ),
      React.createElement(
        Button,
        {
          variant: "outline",
          onClick: () => void loadItems(),
          disabled: loading,
        },
        isChinese ? "刷新" : "Refresh",
      ),
    ),
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
    !loading && items.length === 0
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-2)",
              fontSize: "13px",
              padding: "4px 0",
            },
          },
          isChinese ? "暂无任务" : "No tasks",
        )
      : null,
    !loading && items.length > 0
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
          renderTreeRows(filteredTree, 0),
        )
      : null,
    !loading && items.length > 0 && visibleCount === 0
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-2)",
              fontSize: "13px",
              padding: "4px 0",
            },
          },
          isChinese ? "没有匹配的任务" : "No matched tasks",
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
  predicate: (item: AllTaskItem) => boolean,
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

function countVisibleTreeNodes(nodes: TaskTreeNode[], collapsedIds: Set<DbId>): number {
  return nodes.reduce((total, node) => {
    const childrenCount = collapsedIds.has(node.item.blockId)
      ? 0
      : countVisibleTreeNodes(node.children, collapsedIds)

    return total + 1 + childrenCount
  }, 0)
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
