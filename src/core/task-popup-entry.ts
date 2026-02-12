import type { Block, DbId, TagMenuCommand } from "../orca.d.ts"
import { TASK_TAG_ALIAS } from "./task-schema"
import {
  closeTaskPropertyPopup,
  disposeTaskPropertyPopup,
  openTaskPropertyPopup,
} from "../ui/task-property-panel"

const TAG_REF_TYPE = 2

export interface TaskPopupEntryHandle {
  dispose: () => void
}

export function setupTaskPopupEntry(pluginName: string): TaskPopupEntryHandle {
  const tagAlias = TASK_TAG_ALIAS
  const tagName = tagAlias.toLowerCase()
  const menuCommandId = `${pluginName}.openTaskPropertyPopupFromTagMenu`
  const openCommandId = `${pluginName}.openTaskPropertyPopup`

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
    if (Number.isNaN(blockId)) {
      return
    }

    // 仅拦截任务标签，避免影响其它标签点击行为。
    if (!hasTaskTagRef(blockId, tagAlias)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    openTaskPropertyPopup({
      blockId,
      triggerSource: "tag-click",
    })
  }

  document.body.addEventListener("click", clickListener, true)

  if (orca.state.commands[openCommandId] == null) {
    orca.commands.registerCommand(
      openCommandId,
      async (blockId?: DbId) => {
        if (blockId == null) {
          return
        }

        openTaskPropertyPopup({
          blockId,
          triggerSource: "tag-menu",
        })
      },
      "打开任务属性弹窗",
    )
  }

  const MenuText = orca.components.MenuText
  const menuCommand: TagMenuCommand = {
    render: (tagBlock: Block, close, tagRef) => {
      const matchedTaskTag = tagBlock.aliases.includes(tagAlias)
      if (!matchedTaskTag || tagRef?.from == null) {
        return window.React.createElement(window.React.Fragment)
      }

      return window.React.createElement(MenuText, {
        preIcon: "ti ti-edit",
        title: "打开任务属性",
        onClick: () => {
          close()

          void orca.commands.invokeCommand(openCommandId, tagRef.from)
        },
      })
    },
  }

  if (orca.state.tagMenuCommands[menuCommandId] == null) {
    orca.tagMenuCommands.registerTagMenuCommand(menuCommandId, menuCommand)
  }

  return {
    dispose: () => {
      document.body.removeEventListener("click", clickListener, true)

      if (orca.state.tagMenuCommands[menuCommandId] != null) {
        orca.tagMenuCommands.unregisterTagMenuCommand(menuCommandId)
      }
      if (orca.state.commands[openCommandId] != null) {
        orca.commands.unregisterCommand(openCommandId)
      }

      closeTaskPropertyPopup()
      disposeTaskPropertyPopup()
    },
  }
}

function hasTaskTagRef(blockId: DbId, tagAlias: string): boolean {
  const block = orca.state.blocks[blockId]
  if (block == null) {
    return false
  }

  return block.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias)
}
