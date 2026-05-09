import type { Block, DbId, TagMenuCommand } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId, isValidDbId } from "./block-utils"
import type { ProjectSchemaDefinition } from "./project-schema"
import { hasProjectTagRef } from "./project-schema"
import type { TaskSchemaDefinition } from "./task-schema"
import {
  closeProjectPropertyPopup,
  disposeProjectPropertyPopup,
  openProjectPropertyPopup,
} from "../ui/project-property-popup"

const COMMAND_PREFIX = "task-planner"

export interface ProjectPopupEntryHandle {
  dispose: () => void
}

export function setupProjectPopupEntry(
  pluginName: string,
  schema: TaskSchemaDefinition,
  projectSchema: ProjectSchemaDefinition,
): ProjectPopupEntryHandle {
  const tagAlias = projectSchema.tagAlias
  const tagName = tagAlias.toLowerCase()
  const menuCommandId = `${COMMAND_PREFIX}.openProjectPropertyPopupFromTagMenu`
  const openCommandId = `${COMMAND_PREFIX}.openProjectPropertyPopup`
  const legacyMenuCommandIds = [
    `${pluginName}.openProjectPropertyPopupFromTagMenu`,
    "orca-task-planner.openProjectPropertyPopupFromTagMenu",
  ].filter((id, index, list) => id !== menuCommandId && list.indexOf(id) === index)
  const legacyOpenCommandIds = [
    `${pluginName}.openProjectPropertyPopup`,
    "orca-task-planner.openProjectPropertyPopup",
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
    if (!isValidDbId(blockId) || !hasProjectTagRefById(blockId, tagAlias)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    openProjectPropertyPopup({
      blockId,
      schema,
      projectSchema,
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
        orca.notify("warn", t("No project block found. Put cursor inside a project block first"))
        return
      }

      if (!hasProjectTagRefById(targetBlockId, tagAlias)) {
        orca.notify("warn", t("Current block is not a project"))
        return
      }

      openProjectPropertyPopup({
        blockId: targetBlockId,
        schema,
        projectSchema,
      })
    },
    t("Open project property popup"),
  )

  const MenuText = orca.components.MenuText
  const menuCommand: TagMenuCommand = {
    render: (tagBlock: Block, close, tagRef) => {
      const matchedProjectTag = tagBlock.aliases.includes(tagAlias)
      if (!matchedProjectTag || tagRef?.from == null) {
        return window.React.createElement(window.React.Fragment)
      }

      return window.React.createElement(
        window.React.Fragment,
        null,
        window.React.createElement(MenuText, {
          preIcon: "ti ti-folder-cog",
          title: t("Open project property popup"),
          onClick: () => {
            close()
            void orca.commands.invokeCommand(openCommandId, tagRef.from)
          },
        }),
      )
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

      closeProjectPropertyPopup()
      disposeProjectPropertyPopup()
    },
  }
}

function resolveCommandTargetBlockId(explicitBlockId?: DbId): DbId | null {
  if (explicitBlockId != null) {
    const normalized = getMirrorId(explicitBlockId)
    return isValidDbId(normalized) ? normalized : null
  }

  const cursor = orca.utils.getCursorDataFromSelection(window.getSelection())
  if (cursor == null) {
    return null
  }

  const normalized = getMirrorId(cursor.anchor.blockId)
  return isValidDbId(normalized) ? normalized : null
}

function hasProjectTagRefById(blockId: DbId, tagAlias: string): boolean {
  const block = orca.state.blocks[blockId]
  if (block == null) {
    return false
  }

  return hasProjectTagRef(block, tagAlias)
}
