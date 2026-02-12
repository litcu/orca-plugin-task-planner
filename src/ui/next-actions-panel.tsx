import type { DbId, PanelProps } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { collectNextActions, type NextActionItem } from "../core/dependency-engine"

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

  const openTaskBlock = React.useCallback((blockId: DbId) => {
    orca.nav.goTo("block", { blockId }, props.panelId)
  }, [props.panelId])

  return React.createElement(
    "div",
    {
      style: {
        height: "100%",
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
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            },
          },
          items.map((item: NextActionItem) => {
            return React.createElement(
              "button",
              {
                type: "button",
                key: item.blockId,
                onClick: () => openTaskBlock(item.blockId),
                style: {
                  textAlign: "left",
                  border: "1px solid var(--orca-color-border)",
                  background: "var(--orca-color-bg-2)",
                  color: "var(--orca-color-text)",
                  borderRadius: "6px",
                  padding: "8px",
                  cursor: "pointer",
                },
              },
              React.createElement(
                "div",
                {
                  style: {
                    fontSize: "13px",
                    fontWeight: 500,
                    marginBottom: "2px",
                  },
                },
                item.text,
              ),
              React.createElement(
                "div",
                {
                  style: {
                    fontSize: "11px",
                    color: "var(--orca-color-text-2)",
                  },
                },
                `#${item.blockId} · ${item.status}`,
              ),
            )
          }),
        )
      : null,
  )
}
