import type { DbId, PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { collectNextActions, type NextActionItem } from "../core/dependency-engine"
import { cycleTaskStatusInView } from "../core/all-tasks-engine"
import { openTaskPropertyPopup } from "./task-property-panel"
import { TaskListRow } from "./task-list-row"

interface NextActionsPanelProps extends PanelProps {
  schema: TaskSchemaDefinition
}

export function NextActionsPanel(props: NextActionsPanelProps) {
  const React = window.React
  const Button = orca.components.Button

  const isChinese = orca.state.locale === "zh-CN"
  const [loading, setLoading] = React.useState(true)
  const [items, setItems] = React.useState<NextActionItem[]>([])
  const [errorText, setErrorText] = React.useState("")
  const [updatingIds, setUpdatingIds] = React.useState<Set<DbId>>(new Set())

  const loadItems = React.useCallback(async () => {
    setLoading(true)

    try {
      const nextActions = await collectNextActions(props.schema)
      setItems(nextActions)
      setErrorText("")
    } catch (error) {
      console.error(error)
      setErrorText(isChinese ? "加载 Next Actions 失败" : "Failed to load Next Actions")
    } finally {
      setLoading(false)
    }
  }, [props.schema, isChinese])

  React.useEffect(() => {
    void loadItems()

    // 监听块状态变化并触发轻量刷新，确保任务状态/依赖变更能及时反映到列表。
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
        "Next Actions",
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
          isChinese ? "当前没有可执行任务" : "No actionable tasks",
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
          items.map((item: NextActionItem) => {
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
          }),
        )
      : null,
  )
}
