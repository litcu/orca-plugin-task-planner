import type { Block, BlockRef, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { dedupeDbIds, getMirrorId, isValidDbId } from "./block-utils"
import { invalidateNextActionEvaluationCache } from "./dependency-engine"
import { moveTaskInView } from "./all-tasks-engine"
import { type TaskSchemaDefinition } from "./task-schema"
import { initializeTaskTagForBlock } from "./task-service"
import {
  TASK_META_PROPERTY_NAME,
  readTaskMetaFromBlock,
  toTaskMetaProperty,
} from "./task-meta"

const TAG_REF_TYPE = 2
const COMMAND_PREFIX = "task-planner"

type ReactRootLike = {
  render: (node: unknown) => void
  unmount: () => void
}

interface TaskBlockMenuHandle {
  dispose: () => void
}

interface ParentTaskLinkPopupOptions {
  sourceBlockId: DbId
  schema: TaskSchemaDefinition
}

interface ParentTaskLinkPopupState {
  root: ReactRootLike | null
  containerEl: HTMLDivElement | null
  options: ParentTaskLinkPopupOptions | null
  visible: boolean
}

const popupState: ParentTaskLinkPopupState = {
  root: null,
  containerEl: null,
  options: null,
  visible: false,
}

export function setupTaskBlockMenu(
  pluginName: string,
  schema: TaskSchemaDefinition,
): TaskBlockMenuHandle {
  const commandId = `${COMMAND_PREFIX}.linkParentTask`
  const sequentialCommandId = `${COMMAND_PREFIX}.toggleSequentialSubtasks`
  const legacyCommandIds = [
    `${pluginName}.linkParentTask`,
    `${pluginName}.toggleSequentialSubtasks`,
    "orca-task-planner.linkParentTask",
    "orca-task-planner.toggleSequentialSubtasks",
  ].filter((id, index, list) => {
    return id !== commandId &&
      id !== sequentialCommandId &&
      list.indexOf(id) === index
  })

  for (const legacyCommandId of legacyCommandIds) {
    if (orca.state.blockMenuCommands[legacyCommandId] != null) {
      orca.blockMenuCommands.unregisterBlockMenuCommand(legacyCommandId)
    }
  }

  if (orca.state.blockMenuCommands[commandId] != null) {
    orca.blockMenuCommands.unregisterBlockMenuCommand(commandId)
  }
  if (orca.state.blockMenuCommands[sequentialCommandId] != null) {
    orca.blockMenuCommands.unregisterBlockMenuCommand(sequentialCommandId)
  }

  orca.blockMenuCommands.registerBlockMenuCommand(commandId, {
    worksOnMultipleBlocks: false,
    render: (blockId, _rootBlockId, close) => {
      const MenuText = orca.components.MenuText
      const normalizedBlockId = getMirrorId(blockId)

      return window.React.createElement(MenuText, {
        title: t("Link to parent task"),
        preIcon: "ti ti-git-merge",
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
          close()
          openParentTaskLinkPopup({
            sourceBlockId: normalizedBlockId,
            schema,
          })
        },
      })
    },
  })

  orca.blockMenuCommands.registerBlockMenuCommand(sequentialCommandId, {
    worksOnMultipleBlocks: false,
    render: (blockId, _rootBlockId, close) => {
      const MenuText = orca.components.MenuText
      const normalizedBlockId = getMirrorId(blockId)
      const block = orca.state.blocks[normalizedBlockId] ?? orca.state.blocks[blockId] ?? null
      if (block == null || findTaskTagRef(block, schema.tagAlias) == null) {
        return null
      }

      const sequentialEnabled = readTaskMetaFromBlock(block).subtasks.sequential
      return window.React.createElement(MenuText, {
        title: t("Sequential subtasks"),
        subtitle: sequentialEnabled
          ? t("Enabled: subtasks appear one by one in Active Tasks")
          : t("Disabled: subtasks can appear together in Active Tasks"),
        preIcon: "ti ti-list-numbers",
        postIcon: sequentialEnabled ? "ti ti-check" : undefined,
        onClick: async (event: MouseEvent) => {
          event.stopPropagation()
          close()
          try {
            await toggleSequentialSubtasks(normalizedBlockId, schema.tagAlias, !sequentialEnabled)
            orca.notify(
              "info",
              !sequentialEnabled
                ? t("Sequential subtasks enabled")
                : t("Sequential subtasks disabled"),
            )
          } catch (error) {
            console.error(error)
            const message = error instanceof Error
              ? error.message
              : t("Failed to toggle sequential subtasks")
            orca.notify("error", message)
          }
        },
      })
    },
  })

  return {
    dispose: () => {
      if (orca.state.blockMenuCommands[commandId] != null) {
        orca.blockMenuCommands.unregisterBlockMenuCommand(commandId)
      }
      if (orca.state.blockMenuCommands[sequentialCommandId] != null) {
        orca.blockMenuCommands.unregisterBlockMenuCommand(sequentialCommandId)
      }

      for (const legacyCommandId of legacyCommandIds) {
        if (orca.state.blockMenuCommands[legacyCommandId] != null) {
          orca.blockMenuCommands.unregisterBlockMenuCommand(legacyCommandId)
        }
      }

      disposeParentTaskLinkPopup()
    },
  }
}

function openParentTaskLinkPopup(options: ParentTaskLinkPopupOptions) {
  ensurePopupRoot()
  popupState.options = options
  popupState.visible = true
  renderPopup()
}

function closeParentTaskLinkPopup() {
  if (popupState.root == null || popupState.options == null) {
    return
  }

  popupState.visible = false
  renderPopup()
}

function disposeParentTaskLinkPopup() {
  popupState.root?.unmount()
  popupState.containerEl?.remove()
  popupState.root = null
  popupState.containerEl = null
  popupState.options = null
  popupState.visible = false
}

function ensurePopupRoot() {
  if (popupState.root != null && popupState.containerEl?.isConnected) {
    return
  }

  popupState.root?.unmount()
  popupState.containerEl?.remove()

  const containerEl = document.createElement("div")
  containerEl.dataset.role = "mlo-parent-task-link-popup-root"
  document.body.appendChild(containerEl)

  popupState.containerEl = containerEl
  popupState.root = window.createRoot(containerEl) as ReactRootLike
}

function renderPopup() {
  if (popupState.root == null || popupState.options == null) {
    return
  }

  const React = window.React
  popupState.root.render(
    React.createElement(ParentTaskLinkPopupView, {
      ...popupState.options,
      visible: popupState.visible,
      onClose: () => closeParentTaskLinkPopup(),
      onDispose: () => disposeParentTaskLinkPopup(),
    }),
  )
}

function ParentTaskLinkPopupView(props: ParentTaskLinkPopupOptions & {
  visible: boolean
  onClose: () => void
  onDispose: () => void
}) {
  const React = window.React
  const BlockSelect = orca.components.BlockSelect
  const ModalOverlay = orca.components.ModalOverlay
  const sourceBlock = React.useMemo(() => {
    return orca.state.blocks[getMirrorId(props.sourceBlockId)] ??
      orca.state.blocks[props.sourceBlockId] ??
      null
  }, [props.sourceBlockId])
  const sourceBlockLabel = React.useMemo(() => {
    return resolveBlockLabel(sourceBlock)
  }, [sourceBlock])
  const popupMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (popupMenuContainerRef.current == null) {
    popupMenuContainerRef.current = document.body
  }

  const [selectedParentIds, setSelectedParentIds] = React.useState<DbId[]>([])
  const [saving, setSaving] = React.useState(false)
  const [errorText, setErrorText] = React.useState("")

  React.useEffect(() => {
    setSelectedParentIds([])
    setSaving(false)
    setErrorText("")
  }, [props.sourceBlockId, props.visible])

  const handleConfirm = React.useCallback(async () => {
    const parentTaskId = selectedParentIds[0] ?? null
    if (!isValidDbId(parentTaskId)) {
      setErrorText(t("Please select a parent task"))
      return
    }

    const sourceBlockId = getMirrorId(props.sourceBlockId)
    const targetTaskId = getMirrorId(parentTaskId)
    if (sourceBlockId === targetTaskId) {
      setErrorText(t("Cannot set current block as its own parent task"))
      return
    }

    if (await isBlockInsideSubtree(sourceBlockId, targetTaskId)) {
      setErrorText(t("Cannot move block under itself or its descendants"))
      return
    }

    setSaving(true)
    setErrorText("")

    try {
      const liveSourceBlock = orca.state.blocks[sourceBlockId] ?? sourceBlock
      if (liveSourceBlock == null) {
        throw new Error(t("Current block is unavailable"))
      }

      if (findTaskTagRef(liveSourceBlock, props.schema.tagAlias) == null) {
        await initializeTaskTagForBlock(sourceBlockId, props.schema)
      }

      await moveTaskInView(sourceBlockId, targetTaskId, {
        position: "child",
      })

      props.onClose()
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : t("Failed to link parent task")
      setErrorText(message)
      orca.notify("error", message)
    } finally {
      setSaving(false)
    }
  }, [props, selectedParentIds, sourceBlock])

  return React.createElement(
    ModalOverlay,
    {
      visible: props.visible,
      blurred: false,
      canClose: !saving,
      onClose: () => {
        if (!saving) {
          props.onClose()
        }
      },
      onClosed: () => {
        if (!props.visible) {
          props.onDispose()
        }
      },
    },
    React.createElement(
      "div",
      {
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
        },
        style: {
          width: "min(520px, calc(100vw - 28px))",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          padding: "16px",
          borderRadius: "16px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background:
            "linear-gradient(145deg, var(--orca-color-bg-1), var(--orca-color-bg-2) 88%)",
          boxShadow: "0 24px 52px rgba(15, 23, 42, 0.28)",
        },
      },
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
              fontSize: "16px",
              fontWeight: 650,
              color: "var(--orca-color-text)",
            },
          },
          t("Link to parent task"),
        ),
        React.createElement(
          "div",
          {
            style: {
              fontSize: "12px",
              lineHeight: 1.5,
              color: "var(--orca-color-text-2)",
            },
          },
          t("Choose a parent task. The current block will become a task automatically if needed, then move under that parent."),
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
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--orca-color-text-2)",
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            },
          },
          t("Current block"),
        ),
        React.createElement(
          "div",
          {
            title: sourceBlockLabel,
            style: {
              minHeight: "38px",
              padding: "10px 12px",
              borderRadius: "12px",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              background: "rgba(148, 163, 184, 0.08)",
              color: "var(--orca-color-text)",
              fontSize: "12px",
              lineHeight: 1.45,
              wordBreak: "break-word",
            },
          },
          sourceBlockLabel,
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
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--orca-color-text-2)",
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            },
          },
          t("Parent task"),
        ),
        React.createElement(BlockSelect, {
          mode: "block",
          scope: props.schema.tagAlias,
          selected: selectedParentIds,
          multiSelection: false,
          width: "100%",
          menuContainer: popupMenuContainerRef,
          onChange: (selected: string[]) => {
            const normalized = dedupeDbIds(
              selected
                .map((item) => Number(item))
                .filter((item): item is DbId => isValidDbId(item))
                .map((item) => getMirrorId(item)),
            )
            setSelectedParentIds(normalized.slice(0, 1))
            setErrorText("")
          },
        }),
      ),
      errorText.trim() !== ""
        ? React.createElement(
            "div",
            {
              style: {
                padding: "9px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(220, 38, 38, 0.24)",
                background: "rgba(220, 38, 38, 0.08)",
                color: "var(--orca-color-text-red, #dc2626)",
                fontSize: "12px",
                lineHeight: 1.45,
              },
            },
            errorText,
          )
        : null,
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
          },
        },
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.onClose(),
            disabled: saving,
            style: {
              minWidth: "86px",
              height: "34px",
              padding: "0 14px",
              borderRadius: "10px",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              background: "rgba(148, 163, 184, 0.08)",
              color: "var(--orca-color-text)",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.62 : 1,
            },
          },
          t("Cancel"),
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              void handleConfirm()
            },
            disabled: saving,
            style: {
              minWidth: "106px",
              height: "34px",
              padding: "0 14px",
              borderRadius: "10px",
              border: "1px solid rgba(15, 118, 110, 0.28)",
              background: "linear-gradient(135deg, rgba(15, 118, 110, 0.16), rgba(14, 165, 165, 0.14))",
              color: "var(--orca-color-text-teal, #0f766e)",
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.62 : 1,
            },
          },
          saving ? t("Saving...") : t("Confirm"),
        ),
      ),
    ),
  )
}

async function isBlockInsideSubtree(
  sourceBlockId: DbId,
  candidateBlockId: DbId,
): Promise<boolean> {
  const queue = dedupeDbIds([getMirrorId(sourceBlockId)])
  const visited = new Set<DbId>()

  while (queue.length > 0) {
    const currentId = queue.shift() as DbId
    if (visited.has(currentId)) {
      continue
    }

    visited.add(currentId)
    if (currentId === candidateBlockId) {
      return true
    }

    const block = await getBlockById(currentId)
    if (block == null) {
      continue
    }

    for (const childId of block.children) {
      const normalizedChildId = getMirrorId(childId)
      if (!visited.has(normalizedChildId)) {
        queue.push(normalizedChildId)
      }
    }
  }

  return false
}

async function getBlockById(blockId: DbId): Promise<Block | null> {
  const stateBlock = orca.state.blocks[blockId]
  if (stateBlock != null) {
    return stateBlock
  }

  try {
    return (await orca.invokeBackend("get-block", blockId)) as Block | null
  } catch (error) {
    console.error(error)
    return null
  }
}

async function toggleSequentialSubtasks(
  blockId: DbId,
  taskTagAlias: string,
  enabled: boolean,
): Promise<void> {
  const targetBlock = await getBlockById(getMirrorId(blockId))
  if (targetBlock == null) {
    throw new Error(t("Current block is unavailable"))
  }

  if (findTaskTagRef(targetBlock, taskTagAlias) == null) {
    throw new Error(t("Sequential subtasks can only be enabled on task blocks"))
  }

  const existingProperty = targetBlock.properties?.find((item) => {
    return item.name === TASK_META_PROPERTY_NAME
  })
  const nextMeta = readTaskMetaFromBlock(targetBlock)
  nextMeta.subtasks.sequential = enabled

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [targetBlock.id],
    [toTaskMetaProperty(nextMeta, existingProperty)],
  )
  invalidateNextActionEvaluationCache()
}

function resolveBlockLabel(block: Block | null): string {
  if (block == null) {
    return t("(Untitled task)")
  }

  const content = Array.isArray(block.content) ? block.content : []
  const text = content
    .map((item) => {
      return typeof item?.v === "string" ? item.v : ""
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()

  return text === "" ? t("(Untitled task)") : text
}

function findTaskTagRef(block: Block, taskTagAlias: string): BlockRef | null {
  return block.refs.find((ref) => {
    return ref.type === TAG_REF_TYPE && ref.alias === taskTagAlias
  }) ?? null
}
