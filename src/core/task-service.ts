import type { Block, BlockProperty, CursorData, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "./task-schema"
import { getMirrorId } from "./block-utils"

const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const TASK_STATUS_SHORTCUT = "alt+enter"

export interface TaskQuickActionsHandle {
  commandId: string
  dispose: () => Promise<void>
}

export async function setupTaskQuickActions(
  pluginName: string,
  schema: TaskSchemaDefinition,
): Promise<TaskQuickActionsHandle> {
  const commandId = `${pluginName}.cycleTaskStatus`

  // 命令用于 Alt+Enter 和左侧状态图标点击，共享同一条状态流转逻辑。
  registerCycleTaskStatusCommand(commandId, schema)

  // 统一将 Alt+Enter 绑定到任务状态循环。
  if (orca.state.shortcuts[TASK_STATUS_SHORTCUT] !== commandId) {
    await orca.shortcuts.assign(TASK_STATUS_SHORTCUT, commandId)
  }

  // 注入状态图标样式，并绑定左侧图标点击交互。
  injectTaskStatusStyles(pluginName, schema)
  const clickListener = createStatusIconClickListener(commandId, schema)
  document.body.addEventListener("click", clickListener)

  return {
    commandId,
    dispose: async () => {
      document.body.removeEventListener("click", clickListener)
      removeTaskStatusStyles(pluginName)
      await orca.shortcuts.reset(commandId)
      orca.commands.unregisterEditorCommand(commandId)
    },
  }
}

function registerCycleTaskStatusCommand(
  commandId: string,
  schema: TaskSchemaDefinition,
) {
  if (orca.state.commands[commandId] != null) {
    return
  }

  orca.commands.registerEditorCommand(
    commandId,
    async ([, , cursor], explicitBlockId?: DbId) => {
      const rawBlockId = resolveTargetBlockId(cursor, explicitBlockId)
      if (rawBlockId == null) {
        return null
      }

      const blockId = getMirrorId(rawBlockId)
      const block = orca.state.blocks[blockId]
      if (block == null) {
        return null
      }

      const taskTagRef = findTaskTagRef(block, schema.tagAlias)

      if (taskTagRef == null) {
        await initializeTaskTag(blockId, cursor, schema)
        return null
      }

      await cycleTaskTagStatus(blockId, cursor, taskTagRef, schema)
      return null
    },
    () => {},
    { label: "切换任务状态" },
  )
}

function resolveTargetBlockId(
  cursor: CursorData | null,
  explicitBlockId?: DbId,
): DbId | null {
  if (explicitBlockId != null) {
    return explicitBlockId
  }

  if (cursor == null || !isCollapsedCursor(cursor)) {
    return null
  }

  return cursor.anchor.blockId
}

function isCollapsedCursor(cursor: CursorData): boolean {
  return (
    cursor.anchor.blockId === cursor.focus.blockId &&
    cursor.anchor.isInline === cursor.focus.isInline &&
    cursor.anchor.index === cursor.focus.index &&
    cursor.anchor.offset === cursor.focus.offset
  )
}

async function initializeTaskTag(
  blockId: DbId,
  cursor: CursorData | null,
  schema: TaskSchemaDefinition,
) {
  const propertyNames = schema.propertyNames
  const [todoStatus] = schema.statusChoices
  const [defaultDependsMode] = schema.dependencyModeChoices

  // 首次转任务时只写入 A-01 约定字段，避免残留旧字段。
  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    cursor,
    blockId,
    schema.tagAlias,
    [
      { name: propertyNames.status, value: todoStatus },
      { name: propertyNames.startTime, value: null },
      { name: propertyNames.endTime, value: null },
      {
        name: propertyNames.dependsMode,
        value: defaultDependsMode,
      },
    ],
  )
}

async function cycleTaskTagStatus(
  blockId: DbId,
  cursor: CursorData | null,
  taskTagRef: { data?: BlockProperty[] },
  schema: TaskSchemaDefinition,
) {
  const propertyNames = schema.propertyNames
  const currentStatus = getRefPropertyString(taskTagRef.data, propertyNames.status)
  const nextStatus = getNextStatus(currentStatus, schema)
  const currentStartTime = getRefPropertyValue(taskTagRef.data, propertyNames.startTime)
  const currentEndTime = getRefPropertyValue(taskTagRef.data, propertyNames.endTime)
  const dependsModeValue = getDependencyModeValue(taskTagRef.data, schema)
  const [, doingStatus] = schema.statusChoices

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    cursor,
    blockId,
    schema.tagAlias,
    [
      { name: propertyNames.status, value: nextStatus },
      {
        name: propertyNames.startTime,
        type: DATE_TIME_PROP_TYPE,
        value:
          nextStatus === doingStatus && currentStartTime == null
            ? new Date()
            : currentStartTime,
      },
      {
        name: propertyNames.endTime,
        type: DATE_TIME_PROP_TYPE,
        value: currentEndTime,
      },
      {
        name: propertyNames.dependsMode,
        value: dependsModeValue,
      },
    ],
  )
}

function getNextStatus(
  currentStatus: string | null,
  schema: TaskSchemaDefinition,
): string {
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices

  if (currentStatus === todoStatus) {
    return doingStatus
  }
  if (currentStatus === doingStatus) {
    return doneStatus
  }
  if (currentStatus === doneStatus) {
    return todoStatus
  }

  return todoStatus
}

function getDependencyModeValue(
  refData: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
): string {
  const currentValue = getRefPropertyString(
    refData,
    schema.propertyNames.dependsMode,
  )

  if (
    currentValue != null &&
    schema.dependencyModeChoices.includes(currentValue as "ALL" | "ANY")
  ) {
    return currentValue
  }

  return schema.dependencyModeChoices[0]
}

function getRefPropertyString(
  refData: BlockProperty[] | undefined,
  name: string,
): string | null {
  const value = getRefPropertyValue(refData, name)

  return typeof value === "string" ? value : null
}

function getRefPropertyValue(
  refData: BlockProperty[] | undefined,
  name: string,
): unknown | null {
  const property = refData?.find((item) => item.name === name)

  return property?.value ?? null
}

function findTaskTagRef(block: Block, taskTagAlias: string) {
  return block.refs.find(
    (ref) => ref.type === TAG_REF_TYPE && ref.alias === taskTagAlias,
  )
}

function createStatusIconClickListener(
  commandId: string,
  schema: TaskSchemaDefinition,
) {
  return (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const contentEl = target.closest(".orca-repr-main-content")
    if (!(contentEl instanceof HTMLElement)) {
      return
    }

    if (!isClickOnStatusIconArea(event, contentEl)) {
      return
    }

    const blockEl = contentEl.closest(".orca-block")
    if (!(blockEl instanceof HTMLElement) || blockEl.dataset.id == null) {
      return
    }

    const blockId = Number(blockEl.dataset.id)
    if (Number.isNaN(blockId)) {
      return
    }

    const block = orca.state.blocks[blockId]
    if (block == null || findTaskTagRef(block, schema.tagAlias) == null) {
      return
    }

    void orca.commands.invokeEditorCommand(commandId, null, blockId)
  }
}

function isClickOnStatusIconArea(event: MouseEvent, contentEl: HTMLElement): boolean {
  const rect = contentEl.getBoundingClientRect()
  const styles = window.getComputedStyle(contentEl)
  const paddingLeft = parseFloat(styles.paddingLeft)
  const iconAreaWidth = parseFloat(styles.fontSize) + (paddingLeft || 0)
  const iconAreaHeight = parseFloat(styles.lineHeight)
  const relativeX = event.clientX - rect.left
  const relativeY = event.clientY - rect.top

  return (
    relativeX >= 0 &&
    relativeX <= iconAreaWidth &&
    relativeY >= 0 &&
    relativeY <= iconAreaHeight
  )
}

function injectTaskStatusStyles(pluginName: string, schema: TaskSchemaDefinition) {
  const styleRole = getStyleRole(pluginName)
  removeTaskStatusStyles(pluginName)

  const taskTagName = schema.tagAlias.toLowerCase()
  const statusPropertyDataName = toDataAttributeName(schema.propertyNames.status)
  const [todoStatus, doingStatus, doneStatus] = schema.statusChoices

  const styles = `
    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      font-family: inherit;
      margin-right: var(--orca-spacing-md);
      cursor: pointer;
      font-size: calc(.25rem + var(--orca-block-line-height) / var(--orca-lineheight-md));
      display: inline-block;
      line-height: 1;
      translate: 0 .125rem;
      content: "◯";
      color: var(--orca-color-text-2);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "◯";
      color: var(--orca-color-text-2);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "◐";
      color: var(--orca-color-text-yellow);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "✓";
      color: var(--orca-color-text-green);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"]) .orca-inline,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])>.orca-repr-main>.orca-repr-main-content .orca-inline,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content .orca-inline {
      opacity: 0.75;
    }
  `

  const styleEl = document.createElement("style")
  styleEl.dataset.role = styleRole
  styleEl.innerHTML = styles
  document.head.appendChild(styleEl)
}

function removeTaskStatusStyles(pluginName: string) {
  const styleRole = getStyleRole(pluginName)
  const styleEls = document.querySelectorAll(`style[data-role="${styleRole}"]`)
  styleEls.forEach((item) => item.remove())
}

function getStyleRole(pluginName: string): string {
  return `${pluginName}-task-quick-actions`
}

function toDataAttributeName(propertyName: string): string {
  return propertyName.trim().replace(/\s+/g, "-").toLowerCase()
}

