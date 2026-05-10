import type { Block, DbId, TagMenuCommand } from "../orca.d.ts"
import { t } from "../libs/l10n"
import type { TaskSchemaDefinition } from "./task-schema"
import { getTaskStatusValues, isTaskDoneStatus } from "./task-schema"
import { getMirrorId, isValidDbId } from "./block-utils"
import { getTaskPropertiesFromRef } from "./task-properties"
import { hasProjectTagRef } from "./project-schema"
import { setTaskTagStatus } from "./task-service"
import {
  getMyDayMutationSuccessMessage,
  peekMyDayTaskState,
  toggleTaskInMyDay,
} from "./my-day-actions"
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

export interface TaskPopupActionContext {
  pluginName: string
  myDayEnabled: boolean
  myDayResetHour: number
}

export function setupTaskPopupEntry(
  pluginName: string,
  schema: TaskSchemaDefinition,
  actionContext?: TaskPopupActionContext,
): TaskPopupEntryHandle {
  const tagAlias = schema.tagAlias
  const tagName = tagAlias.toLowerCase()
  const menuCommandId = `${COMMAND_PREFIX}.openTaskPropertyPopupFromTagMenu`
  const toggleMyDayCommandId = `${COMMAND_PREFIX}.toggleMyDay`
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
    if (!hasTaskTagRef(blockId, tagAlias, schema.projectTagAlias)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    openTaskPropertyPopup({
      pluginName,
      blockId,
      schema,
      triggerSource: "tag-click",
      myDayEnabled: actionContext?.myDayEnabled,
      myDayResetHour: actionContext?.myDayResetHour,
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
  if (orca.state.commands[toggleMyDayCommandId] != null) {
    orca.commands.unregisterCommand(toggleMyDayCommandId)
  }
  orca.commands.registerCommand(
    openCommandId,
    async (blockId?: DbId) => {
      const targetBlockId = resolveCommandTargetBlockId(blockId)
      if (targetBlockId == null) {
        orca.notify("warn", t("No task block found. Put cursor inside a task block first"))
        return
      }

      if (!hasTaskTagRef(targetBlockId, tagAlias, schema.projectTagAlias)) {
        orca.notify("warn", t("Current block is not a task"))
        return
      }

      openTaskPropertyPopup({
        pluginName,
        blockId: targetBlockId,
        schema,
        triggerSource: "tag-menu",
        myDayEnabled: actionContext?.myDayEnabled,
        myDayResetHour: actionContext?.myDayResetHour,
      })
    },
    t("Open task property popup"),
  )

  if (actionContext?.myDayEnabled === true) {
    orca.commands.registerCommand(
      toggleMyDayCommandId,
      async (blockId?: DbId) => {
        const targetBlockId = resolveCommandTargetBlockId(blockId)
        if (targetBlockId == null) {
          orca.notify("warn", t("No task block found. Put cursor inside a task block first"))
          return
        }

        if (!hasTaskTagRef(targetBlockId, tagAlias, schema.projectTagAlias)) {
          orca.notify("warn", t("Current block is not a task"))
          return
        }

        const sourceBlock = orca.state.blocks[targetBlockId] ?? null
        if (sourceBlock == null) {
          orca.notify("warn", t("No task block found. Put cursor inside a task block first"))
          return
        }

        const result = await toggleTaskInMyDay(actionContext.pluginName, actionContext.myDayResetHour, {
          taskId: targetBlockId,
          sourceBlockId: sourceBlock.id,
        })

        if (result.state == null || result.action == null) {
          orca.notify("error", t("Failed to update My Day"))
          return
        }

        orca.notify("success", getMyDayMutationSuccessMessage(result.action))
      },
      t("Toggle My Day"),
    )
  }

  const MenuText = orca.components.MenuText
  const menuCommand: TagMenuCommand = {
    render: (tagBlock: Block, close, tagRef) => {
      const matchedTaskTag = tagBlock.aliases.includes(tagAlias)
      if (!matchedTaskTag || tagRef?.from == null) {
        return window.React.createElement(window.React.Fragment)
      }

      const sourceBlock = orca.state.blocks[getMirrorId(tagRef.from)] ?? orca.state.blocks[tagRef.from] ?? null
      const currentValues =
        sourceBlock != null
          ? getTaskPropertiesFromRef(tagRef.data, schema, sourceBlock)
          : null
      const doneStatus = getTaskStatusValues(schema).done
      const myDaySelected = actionContext?.myDayEnabled === true
        ? peekMyDayTaskState(actionContext.pluginName, getMirrorId(tagRef.from)) === true
        : false

      return window.React.createElement(
        window.React.Fragment,
        null,
        window.React.createElement(MenuText, {
          preIcon: "ti ti-edit",
          title: t("Open task property popup"),
          onClick: () => {
            close()
            void orca.commands.invokeCommand(openCommandId, tagRef.from)
          },
        }),
        window.React.createElement(MenuText, {
          preIcon: "ti ti-circle-check",
          title: t("Set as completed"),
          disabled: sourceBlock == null || (currentValues != null && isTaskDoneStatus(currentValues.status, schema)),
          onClick: () => {
            close()
            if (sourceBlock == null) {
              return
            }
            void setTaskTagStatus(
              getMirrorId(tagRef.from),
              null,
              sourceBlock,
              tagRef,
              schema,
              pluginName,
              doneStatus,
            ).catch((error) => {
              console.error(error)
              orca.notify("error", t("Failed to set task status"))
            })
          },
        }),
        actionContext?.myDayEnabled === true
          ? window.React.createElement(MenuText, {
              preIcon: myDaySelected ? "ti ti-calendar-minus" : "ti ti-calendar-plus",
              title: myDaySelected ? t("Remove from My Day") : t("Add to My Day"),
              disabled: sourceBlock == null,
              onClick: async () => {
                close()
                if (sourceBlock == null) {
                  return
                }

                const result = await toggleTaskInMyDay(actionContext.pluginName, actionContext.myDayResetHour, {
                  taskId: getMirrorId(tagRef.from),
                  sourceBlockId: sourceBlock.id,
                })

                if (result.state == null || result.action == null) {
                  orca.notify("error", t("Failed to update My Day"))
                  return
                }

                orca.notify("success", getMyDayMutationSuccessMessage(result.action))
              },
            })
          : null,
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
      if (orca.state.commands[toggleMyDayCommandId] != null) {
        orca.commands.unregisterCommand(toggleMyDayCommandId)
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

function hasTaskTagRef(
  blockId: DbId,
  tagAlias: string,
  projectTagAlias: string,
): boolean {
  const block = orca.state.blocks[blockId]
  if (block == null) {
    return false
  }

  return block.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) &&
    !hasProjectTagRef(block, projectTagAlias)
}
