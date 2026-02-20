import type { Block, DbId, TagMenuCommand } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "./task-schema"
import { getMirrorId, isValidDbId } from "./block-utils"
import {
  closeTaskPropertyPopup,
  disposeTaskPropertyPopup,
  openTaskPropertyPopup,
} from "../ui/task-property-panel"

const TAG_REF_TYPE = 2
const COMMAND_PREFIX = "task-planner"

export interface TaskPopupEntryHandle {
  dispose: () => void
}

export function setupTaskPopupEntry(
  pluginName: string,
  schema: TaskSchemaDefinition,
): TaskPopupEntryHandle {
  const tagAlias = schema.tagAlias
  const tagName = tagAlias.toLowerCase()
  const menuCommandId = `${COMMAND_PREFIX}.openTaskPropertyPopupFromTagMenu`
  const openCommandId = `${COMMAND_PREFIX}.openTaskPropertyPopup`
  const legacyMenuCommandIds = [
    `${pluginName}.openTaskPropertyPopupFromTagMenu`,
    "orca-task-planner.openTaskPropertyPopupFromTagMenu",
  ].filter((id, index, list) => id !== menuCommandId && list.indexOf(id) === index)
  const legacyOpenCommandIds = [
    `${pluginName}.openTaskPropertyPopup`,
    "orca-task-planner.openTaskPropertyPopup",
  ].filter((id, index, list) => id !== openCommandId && list.indexOf(id) === index)

  const clickListener = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const tagEl = target.closest(`.orca-tag[data-name="${tagName}"]`)
    if (!(tagEl instanceof HTMLElement)) {
      return
    }

    const blockEl = tagEl.closest(".orca-block")
    if (!(blockEl instanceof HTMLElement) || blockEl.dataset.id == null) {
      return
    }

    const blockId = Number(blockEl.dataset.id)
    if (!isValidDbId(blockId)) {
      return
    }

    // Only intercept task tag click, do not affect other tags.
    if (!hasTaskTagRef(blockId, tagAlias)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    openTaskPropertyPopup({
      blockId,
      schema,
      triggerSource: "tag-click",
    })
  }

  document.body.addEventListener("click", clickListener, true)

  for (const legacyOpenCommandId of legacyOpenCommandIds) {
    if (orca.state.commands[legacyOpenCommandId] != null) {
      orca.commands.unregisterCommand(legacyOpenCommandId)
    }
  }

  if (orca.state.commands[openCommandId] != null) {
    orca.commands.unregisterCommand(openCommandId)
  }
  orca.commands.registerCommand(
    openCommandId,
    async (blockId?: DbId) => {
      const targetBlockId = resolveCommandTargetBlockId(blockId)
      if (targetBlockId == null) {
        orca.notify("warn", t("No task block found. Put cursor inside a task block first"))
        return
      }

      if (!hasTaskTagRef(targetBlockId, tagAlias)) {
        orca.notify("warn", t("Current block is not a task"))
        return
      }

      openTaskPropertyPopup({
        blockId: targetBlockId,
        schema,
        triggerSource: "tag-menu",
      })
    },
    t("Open task property popup"),
  )

  const MenuText = orca.components.MenuText
  const menuCommand: TagMenuCommand = {
    render: (tagBlock: Block, close, tagRef) => {
      const matchedTaskTag = tagBlock.aliases.includes(tagAlias)
      if (!matchedTaskTag || tagRef?.from == null) {
        return window.React.createElement(window.React.Fragment)
      }

      return window.React.createElement(MenuText, {
        preIcon: "ti ti-edit",
        title: t("Open task property popup"),
        onClick: () => {
          close()
          void orca.commands.invokeCommand(openCommandId, tagRef.from)
        },
      })
    },
  }

  for (const legacyMenuCommandId of legacyMenuCommandIds) {
    if (orca.state.tagMenuCommands[legacyMenuCommandId] != null) {
      orca.tagMenuCommands.unregisterTagMenuCommand(legacyMenuCommandId)
    }
  }

  if (orca.state.tagMenuCommands[menuCommandId] != null) {
    orca.tagMenuCommands.unregisterTagMenuCommand(menuCommandId)
  }
  orca.tagMenuCommands.registerTagMenuCommand(menuCommandId, menuCommand)

  return {
    dispose: () => {
      document.body.removeEventListener("click", clickListener, true)

      if (orca.state.tagMenuCommands[menuCommandId] != null) {
        orca.tagMenuCommands.unregisterTagMenuCommand(menuCommandId)
      }
      if (orca.state.commands[openCommandId] != null) {
        orca.commands.unregisterCommand(openCommandId)
      }
      for (const legacyOpenCommandId of legacyOpenCommandIds) {
        if (orca.state.commands[legacyOpenCommandId] != null) {
          orca.commands.unregisterCommand(legacyOpenCommandId)
        }
      }
      for (const legacyMenuCommandId of legacyMenuCommandIds) {
        if (orca.state.tagMenuCommands[legacyMenuCommandId] != null) {
          orca.tagMenuCommands.unregisterTagMenuCommand(legacyMenuCommandId)
        }
      }

      closeTaskPropertyPopup()
      disposeTaskPropertyPopup()
    },
  }
}

function resolveCommandTargetBlockId(explicitBlockId?: DbId): DbId | null {
  if (explicitBlockId != null) {
    const normalized = getMirrorId(explicitBlockId)
    return isValidDbId(normalized) ? normalized : null
  }

  // If triggered from command panel without args, fallback to current cursor block.
  const cursor = orca.utils.getCursorDataFromSelection(window.getSelection())
  if (cursor == null) {
    return null
  }

  const normalized = getMirrorId(cursor.anchor.blockId)
  return isValidDbId(normalized) ? normalized : null
}

function hasTaskTagRef(blockId: DbId, tagAlias: string): boolean {
  const block = orca.state.blocks[blockId]
  if (block == null) {
    return false
  }

  return block.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias)
}
