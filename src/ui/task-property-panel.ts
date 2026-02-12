import type { DbId } from "../orca.d.ts"

type PopupTriggerSource = "tag-click" | "tag-menu"

type ReactRootLike = {
  render: (node: unknown) => void
  unmount: () => void
}

interface PopupState {
  root: ReactRootLike | null
  containerEl: HTMLDivElement | null
  blockId: DbId | null
  triggerSource: PopupTriggerSource | null
}

const popupState: PopupState = {
  root: null,
  containerEl: null,
  blockId: null,
  triggerSource: null,
}

export interface OpenTaskPropertyPopupOptions {
  blockId: DbId
  triggerSource: PopupTriggerSource
}

export function openTaskPropertyPopup(options: OpenTaskPropertyPopupOptions) {
  const { blockId, triggerSource } = options

  popupState.blockId = blockId
  popupState.triggerSource = triggerSource
  ensurePopupRoot()
  renderPopup(true)
}

export function closeTaskPropertyPopup() {
  if (popupState.root == null) {
    return
  }

  renderPopup(false)
}

export function disposeTaskPropertyPopup() {
  popupState.root?.unmount()
  popupState.containerEl?.remove()

  popupState.root = null
  popupState.containerEl = null
  popupState.blockId = null
  popupState.triggerSource = null
}

function ensurePopupRoot() {
  if (popupState.root != null) {
    return
  }

  const containerEl = document.createElement("div")
  containerEl.dataset.role = "mlo-task-property-popup-root"
  document.body.appendChild(containerEl)

  popupState.containerEl = containerEl
  popupState.root = window.createRoot(containerEl) as ReactRootLike
}

function renderPopup(visible: boolean) {
  if (popupState.root == null) {
    return
  }

  const React = window.React
  const Button = orca.components.Button
  const ModalOverlay = orca.components.ModalOverlay

  // A-03 只负责弹窗入口连通；字段编辑在 A-04 完整实现。
  const contentEl = React.createElement(
    "div",
    {
      style: {
        width: "min(560px, calc(100vw - 48px))",
        maxHeight: "calc(100vh - 64px)",
        overflow: "auto",
        padding: "20px",
        background: "var(--orca-color-bg-1)",
        border: "1px solid var(--orca-color-border-1)",
        borderRadius: "8px",
        boxShadow: "none",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          fontSize: "18px",
          fontWeight: 600,
          marginBottom: "12px",
        },
      },
      "任务属性",
    ),
    React.createElement(
      "div",
      {
        style: {
          color: "var(--orca-color-text-2)",
          marginBottom: "8px",
        },
      },
      `目标块 ID：${popupState.blockId ?? "-"}`,
    ),
    React.createElement(
      "div",
      {
        style: {
          color: "var(--orca-color-text-2)",
          marginBottom: "20px",
        },
      },
      `打开来源：${popupState.triggerSource ?? "-"}`,
    ),
    React.createElement(
      "div",
      {
        style: {
          color: "var(--orca-color-text-2)",
          marginBottom: "20px",
          lineHeight: 1.6,
        },
      },
      "A-03 已接入任务属性弹窗入口。A-04 将在此处实现任务字段编辑表单。",
    ),
    React.createElement(
      "div",
      {
        style: { display: "flex", justifyContent: "flex-end" },
      },
      React.createElement(
        Button,
        {
          variant: "outline",
          onClick: () => closeTaskPropertyPopup(),
        },
        "关闭",
      ),
    ),
  )

  popupState.root.render(
    React.createElement(
      ModalOverlay,
      {
        visible,
        blurred: false,
        style: {
          background: "rgba(0, 0, 0, 0.35)",
          backdropFilter: "none",
        },
        canClose: true,
        onClose: () => closeTaskPropertyPopup(),
        onClosed: () => {
          if (!visible) {
            disposeTaskPropertyPopup()
          }
        },
      },
      contentEl,
    ),
  )
}
