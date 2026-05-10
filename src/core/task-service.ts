import type { Block, BlockProperty, BlockRef, CursorData, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import {
  DEFAULT_TASK_SCORE,
  getDefaultTaskStatus,
  getNextTaskStatusInMainCycle,
  getTaskStatusValues,
  isTaskDoingStatus,
  type TaskSchemaDefinition,
} from "./task-schema"
import { getMirrorId, isValidDbId } from "./block-utils"
import { invalidateNextActionEvaluationCache } from "./dependency-engine"
import { getPluginSettings } from "./plugin-settings"
import {
  buildTaskCustomRefData,
  collectTaskCustomPropertyDescriptors,
  createTaskCustomPropertyStateMap,
  getTaskPropertiesFromRef,
  mergeTaskRefData,
  normalizeTaskValuesForStatus,
  toTaskMetaPropertyForSave,
  type TaskPropertyValues,
} from "./task-properties"
import { TASK_META_PROPERTY_NAME } from "./task-meta"
import { createRecurringTaskInTodayJournal } from "./task-recurrence"
import { applyTaskTimerForStatusChange } from "./task-timer"

const TAG_REF_TYPE = 2
const DATE_TIME_PROP_TYPE = 5
const TEXT_CHOICES_PROP_TYPE = 6
const TASK_STATUS_SHORTCUT = "alt+enter"
const COMMAND_PREFIX = "task-planner"
const TASK_TAG_INSERT_PENDING_TTL_MS = 10_000

type PendingTaskTagInsertState = {
  createdAt: number
  hadTaskTag: boolean
}

type ReactRootLike = {
  render: (node: unknown) => void
  unmount: () => void
}

interface TaskStatusMenuState {
  root: ReactRootLike | null
  containerEl: HTMLDivElement | null
  visible: boolean
  rect: DOMRect | null
  blockId: DbId | null
  block: Block | null
  taskTagRef: BlockRef | null
  schema: TaskSchemaDefinition | null
  pluginName: string
}

const pendingTaskTagInsertStates = new Map<string, PendingTaskTagInsertState[]>()
let suppressedTaskTagInsertHookDepth = 0
const taskStatusMenuState: TaskStatusMenuState = {
  root: null,
  containerEl: null,
  visible: false,
  rect: null,
  blockId: null,
  block: null,
  taskTagRef: null,
  schema: null,
  pluginName: "",
}

export interface TaskQuickActionsHandle {
  commandId: string
  dispose: () => Promise<void>
}

export async function setupTaskQuickActions(
  pluginName: string,
  schema: TaskSchemaDefinition,
): Promise<TaskQuickActionsHandle> {
  const commandId = `${COMMAND_PREFIX}.cycleTaskStatus`
  const legacyCommandIds = [
    `${pluginName}.cycleTaskStatus`,
    "orca-task-planner.cycleTaskStatus",
  ].filter((id, index, list) => id !== commandId && list.indexOf(id) === index)

  for (const legacyCommandId of legacyCommandIds) {
    if (orca.state.commands[legacyCommandId] != null) {
      orca.commands.unregisterEditorCommand(legacyCommandId)
    }
  }

  // 命令用于 Alt+Enter 和命令面板，左侧状态图标单独打开状态选择菜单。
  registerCycleTaskStatusCommand(commandId, schema, pluginName)

  pendingTaskTagInsertStates.clear()
  const beforeInsertTagHook = createTaskTagInsertBeforeHook(schema)
  const afterInsertTagHook = createTaskTagInsertAfterHook(schema)
  orca.commands.registerBeforeCommand("core.editor.insertTag", beforeInsertTagHook)
  orca.commands.registerAfterCommand("core.editor.insertTag", afterInsertTagHook)

  // 统一将 Alt+Enter 绑定到任务状态循环。
  if (orca.state.shortcuts[TASK_STATUS_SHORTCUT] !== commandId) {
    await orca.shortcuts.assign(TASK_STATUS_SHORTCUT, commandId)
  }

  // 注入状态图标样式，并绑定左侧图标点击交互。
  injectTaskStatusStyles(pluginName, schema)
  const clickListener = createStatusIconClickListener(schema, pluginName)
  document.body.addEventListener("click", clickListener)
  let disposed = false

  return {
    commandId,
    dispose: async () => {
      disposed = true
      document.body.removeEventListener("click", clickListener)
      disposeTaskStatusMenu()
      removeTaskStatusStyles(pluginName)
      pendingTaskTagInsertStates.clear()
      orca.commands.unregisterBeforeCommand("core.editor.insertTag", beforeInsertTagHook)
      orca.commands.unregisterAfterCommand("core.editor.insertTag", afterInsertTagHook)
      await orca.shortcuts.reset(commandId)
      orca.commands.unregisterEditorCommand(commandId)

      for (const legacyCommandId of legacyCommandIds) {
        if (orca.state.commands[legacyCommandId] != null) {
          orca.commands.unregisterEditorCommand(legacyCommandId)
        }
      }
    },
  }
}

function registerCycleTaskStatusCommand(
  commandId: string,
  schema: TaskSchemaDefinition,
  pluginName: string,
) {
  if (orca.state.commands[commandId] != null) {
    orca.commands.unregisterEditorCommand(commandId)
  }

  orca.commands.registerEditorCommand(
    commandId,
    async ([, , cursor], explicitBlockId?: DbId) => {
      const rawBlockId = resolveTargetBlockId(cursor, explicitBlockId)
      if (rawBlockId == null) {
        return null
      }

      const blockId = getMirrorId(rawBlockId)
      if (!isValidDbId(blockId)) {
        return null
      }

      const block = orca.state.blocks[blockId]
      if (block == null) {
        return null
      }

      const taskTagRef = findTaskTagRef(block, schema.tagAlias)

      if (taskTagRef == null) {
        await initializeTaskTagForBlock(blockId, schema, cursor)
        return null
      }

      await cycleTaskTagStatus(blockId, cursor, block, taskTagRef, schema, pluginName)
      return null
    },
    () => {},
    { label: t("Toggle task status") },
  )
}

function resolveTargetBlockId(
  cursor: CursorData | null,
  explicitBlockId?: DbId,
): DbId | null {
  if (explicitBlockId != null) {
    return isValidDbId(explicitBlockId) ? explicitBlockId : null
  }

  if (cursor == null || !isCollapsedCursor(cursor)) {
    return null
  }

  return isValidDbId(cursor.anchor.blockId) ? cursor.anchor.blockId : null
}

function isCollapsedCursor(cursor: CursorData): boolean {
  return (
    cursor.anchor.blockId === cursor.focus.blockId &&
    cursor.anchor.isInline === cursor.focus.isInline &&
    cursor.anchor.index === cursor.focus.index &&
    cursor.anchor.offset === cursor.focus.offset
  )
}

export async function initializeTaskTagForBlock(
  blockId: DbId,
  schema: TaskSchemaDefinition,
  cursor: CursorData | null = null,
) {
  await ensureTaskTagDefaultsForBlock(blockId, schema, {
    cursor,
    createTagWhenMissing: true,
  })
}

async function cycleTaskTagStatus(
  blockId: DbId,
  cursor: CursorData | null,
  block: Block,
  taskTagRef: BlockRef,
  schema: TaskSchemaDefinition,
  pluginName: string,
) {
  const currentValues = getTaskPropertiesFromRef(taskTagRef.data, schema, block)
  await setTaskTagStatus(
    blockId,
    cursor,
    block,
    taskTagRef,
    schema,
    pluginName,
    getNextTaskStatusInMainCycle(currentValues.status, schema),
  )
}

export async function setTaskTagStatus(
  blockId: DbId,
  cursor: CursorData | null,
  block: Block,
  taskTagRef: BlockRef,
  schema: TaskSchemaDefinition,
  pluginName: string,
  nextStatus: string,
) {
  const propertyNames = schema.propertyNames
  const currentValues = getTaskPropertiesFromRef(taskTagRef.data, schema, block)
  const dependsModeValue = getDependencyModeValue(taskTagRef.data, schema)
  const nextValues = normalizeTaskValuesForStatus({
    ...currentValues,
    status: nextStatus,
    startTime:
      isTaskDoingStatus(nextStatus, schema) && currentValues.startTime == null
        ? new Date()
        : currentValues.startTime,
    endTime: currentValues.endTime,
  }, schema)

  const payload: BlockProperty[] = [
    {
      name: propertyNames.status,
      type: TEXT_CHOICES_PROP_TYPE,
      value: nextValues.status,
    },
    {
      name: propertyNames.startTime,
      type: DATE_TIME_PROP_TYPE,
      value: nextValues.startTime,
    },
    {
      name: propertyNames.endTime,
      type: DATE_TIME_PROP_TYPE,
      value: nextValues.endTime,
    },
    {
      name: propertyNames.dependsMode,
      type: TEXT_CHOICES_PROP_TYPE,
      value: dependsModeValue,
    },
  ]

  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.setRefData",
      cursor,
      taskTagRef,
      payload,
    )
  } catch (error) {
    console.error(error)
    await orca.commands.invokeEditorCommand(
      "core.editor.insertTag",
      cursor,
      blockId,
      schema.tagAlias,
      mergeTaskRefData(taskTagRef.data, payload),
    )
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [blockId],
    [toTaskMetaPropertyForSave(nextValues, block)],
  )

  const settings = getPluginSettings(pluginName)
  try {
    await applyTaskTimerForStatusChange({
      blockId,
      sourceBlockId: block.id,
      schema,
      previousStatus: currentValues.status,
      nextStatus: nextValues.status,
      autoStartOnDoing: settings.taskTimerEnabled && settings.taskTimerAutoStartOnDoing,
    })
  } catch (error) {
    console.error(error)
  }

  await createRecurringTaskInTodayJournal(
    currentValues.status,
    nextValues,
    blockId,
    schema,
  )
  invalidateNextActionEvaluationCache()
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

function createTaskTagInsertBeforeHook(schema: TaskSchemaDefinition) {
  return (
    _commandId: string,
    rawBlockId?: DbId,
    rawTagAlias?: string,
    refData?: BlockProperty[],
  ) => {
    if (
      suppressedTaskTagInsertHookDepth > 0 ||
      !isValidDbId(rawBlockId) ||
      !isTaskTagAliasMatch(rawTagAlias, schema.tagAlias)
    ) {
      return true
    }

    const tagAlias = rawTagAlias as string
    const pendingKey = buildPendingTaskTagInsertKey(rawBlockId, tagAlias, refData)
    const pendingList = pendingTaskTagInsertStates.get(pendingKey) ?? []
    pruneExpiredPendingTaskTagInsertStates(pendingList)
    pendingList.push({
      createdAt: Date.now(),
      hadTaskTag: resolveTaskTagRefFromState(rawBlockId, schema.tagAlias) != null,
    })
    pendingTaskTagInsertStates.set(pendingKey, pendingList)
    return true
  }
}

function createTaskTagInsertAfterHook(schema: TaskSchemaDefinition) {
  return async (
    _commandId: string,
    rawBlockId?: DbId,
    rawTagAlias?: string,
    refData?: BlockProperty[],
  ) => {
    if (
      suppressedTaskTagInsertHookDepth > 0 ||
      !isValidDbId(rawBlockId) ||
      !isTaskTagAliasMatch(rawTagAlias, schema.tagAlias)
    ) {
      return
    }

    const tagAlias = rawTagAlias as string
    const pendingKey = buildPendingTaskTagInsertKey(rawBlockId, tagAlias, refData)
    const pending = shiftPendingTaskTagInsertState(pendingKey)
    if (pending?.hadTaskTag !== false) {
      return
    }

    try {
      await ensureTaskTagDefaultsForBlock(rawBlockId, schema)
    } catch (error) {
      console.error(error)
    }
  }
}

async function ensureTaskTagDefaultsForBlock(
  blockId: DbId,
  schema: TaskSchemaDefinition,
  options?: {
    cursor?: CursorData | null
    createTagWhenMissing?: boolean
  },
): Promise<void> {
  const schemaProperties = await getTaskTagSchemaProperties(schema)
  let taskTarget = await resolveTaskTagTarget(blockId, schema.tagAlias)
  let updated = false

  if (taskTarget == null) {
    return
  }

  if (taskTarget.taskRef == null) {
    if (options?.createTagWhenMissing !== true) {
      return
    }

    const initialRefData = buildMissingTaskDefaultRefData(
      undefined,
      schema,
      schemaProperties,
    )
    await invokeInsertTaskTagWithSuppressedHook(
      options?.cursor ?? null,
      taskTarget.block.id,
      schema.tagAlias,
      initialRefData,
    )
    updated = true
    taskTarget = await resolveTaskTagTarget(taskTarget.block.id, schema.tagAlias)
    if (taskTarget == null || taskTarget.taskRef == null) {
      return
    }
  }

  const missingRefData = buildMissingTaskDefaultRefData(
    taskTarget.taskRef.data,
    schema,
    schemaProperties,
  )
  if (missingRefData.length > 0) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        taskTarget.taskRef,
        missingRefData,
      )
    } catch (error) {
      console.error(error)
      await invokeInsertTaskTagWithSuppressedHook(
        null,
        taskTarget.taskRef.from,
        schema.tagAlias,
        mergeTaskRefData(taskTarget.taskRef.data, missingRefData),
      )
    }
    updated = true
  }

  const metaProperty = buildMissingDefaultTaskMetaProperty(taskTarget.block, schema)
  if (metaProperty != null) {
    await orca.commands.invokeEditorCommand(
      "core.editor.setProperties",
      null,
      [taskTarget.block.id],
      [metaProperty],
    )
    updated = true
  }

  if (updated) {
    invalidateNextActionEvaluationCache()
  }
}

async function resolveTaskTagTarget(
  blockId: DbId,
  tagAlias: string,
): Promise<{
  block: Block
  taskRef: BlockRef | null
} | null> {
  const candidateBlocks = await loadCandidateBlocks(blockId)
  if (candidateBlocks.length === 0) {
    return null
  }

  for (const block of candidateBlocks) {
    const taskRef = findTaskTagRef(block, tagAlias)
    if (taskRef != null) {
      return {
        block,
        taskRef,
      }
    }
  }

  return {
    block: candidateBlocks[0],
    taskRef: null,
  }
}

async function loadCandidateBlocks(blockId: DbId): Promise<Block[]> {
  const blocks: Block[] = []
  const seen = new Set<DbId>()
  for (const candidateId of collectCandidateBlockIds(blockId)) {
    const stateBlock = orca.state.blocks[candidateId]
    if (stateBlock != null && !seen.has(stateBlock.id)) {
      seen.add(stateBlock.id)
      blocks.push(stateBlock)
      continue
    }

    try {
      const backendBlock = (await orca.invokeBackend("get-block", candidateId)) as Block | null
      if (backendBlock != null && !seen.has(backendBlock.id)) {
        seen.add(backendBlock.id)
        blocks.push(backendBlock)
      }
    } catch (error) {
      console.error(error)
    }
  }

  return blocks
}

function collectCandidateBlockIds(blockId: DbId): DbId[] {
  const candidateIds = [getMirrorId(blockId), blockId]
  const seen = new Set<DbId>()
  const normalized: DbId[] = []

  for (const candidateId of candidateIds) {
    if (!isValidDbId(candidateId) || seen.has(candidateId)) {
      continue
    }

    seen.add(candidateId)
    normalized.push(candidateId)
  }

  return normalized
}

async function getTaskTagSchemaProperties(
  schema: TaskSchemaDefinition,
): Promise<BlockProperty[]> {
  try {
    const tagBlock = (await orca.invokeBackend(
      "get-block-by-alias",
      schema.tagAlias,
    )) as Block | null
    return Array.isArray(tagBlock?.properties) ? tagBlock.properties : []
  } catch (error) {
    console.error(error)
    return []
  }
}

function buildMissingTaskDefaultRefData(
  existingRefData: BlockProperty[] | undefined,
  schema: TaskSchemaDefinition,
  schemaProperties: BlockProperty[],
): BlockProperty[] {
  const defaultTaskValues = createDefaultTaskValues(schema)
  const coreDefaults: BlockProperty[] = [
    {
      name: schema.propertyNames.status,
      type: TEXT_CHOICES_PROP_TYPE,
      value: defaultTaskValues.status,
    },
    {
      name: schema.propertyNames.startTime,
      type: DATE_TIME_PROP_TYPE,
      value: defaultTaskValues.startTime,
    },
    {
      name: schema.propertyNames.endTime,
      type: DATE_TIME_PROP_TYPE,
      value: defaultTaskValues.endTime,
    },
    {
      name: schema.propertyNames.dependsMode,
      type: TEXT_CHOICES_PROP_TYPE,
      value: defaultTaskValues.dependsMode,
    },
  ]

  const customPropertyDescriptors = collectTaskCustomPropertyDescriptors(
    schemaProperties,
    schema,
    {
      refData: existingRefData,
      includeSchemaDefaults: true,
    },
  )
  const customDefaults = buildTaskCustomRefData(
    customPropertyDescriptors,
    createTaskCustomPropertyStateMap(customPropertyDescriptors),
  )

  return filterMissingTaskProperties(existingRefData, [
    ...coreDefaults,
    ...customDefaults,
  ])
}

function filterMissingTaskProperties(
  existingRefData: BlockProperty[] | undefined,
  defaults: BlockProperty[],
): BlockProperty[] {
  const existingKeys = new Set(
    (existingRefData ?? [])
      .map((property) => normalizeTaskPropertyKey(property.name))
      .filter((key) => key !== ""),
  )

  return defaults.filter((property) => {
    return !existingKeys.has(normalizeTaskPropertyKey(property.name))
  })
}

function buildMissingDefaultTaskMetaProperty(
  block: Block,
  schema: TaskSchemaDefinition,
): BlockProperty | null {
  const hasTaskMeta = block.properties.some((property) => {
    return normalizeTaskPropertyKey(property.name) === normalizeTaskPropertyKey(TASK_META_PROPERTY_NAME)
  })
  if (hasTaskMeta) {
    return null
  }

  return toTaskMetaPropertyForSave(createDefaultTaskValues(schema), block)
}

function createDefaultTaskValues(schema: TaskSchemaDefinition): TaskPropertyValues {
  const todoStatus = getDefaultTaskStatus(schema)
  const [defaultDependsMode] = schema.dependencyModeChoices

  return {
    status: todoStatus,
    startTime: null,
    endTime: null,
    projects: [],
    reviewEnabled: false,
    reviewType: "single",
    nextReview: null,
    reviewEvery: "",
    lastReviewed: null,
    importance: DEFAULT_TASK_SCORE,
    urgency: DEFAULT_TASK_SCORE,
    effort: DEFAULT_TASK_SCORE,
    star: false,
    repeatRule: "",
    labels: [],
    remark: "",
    dependsOn: [],
    dependsMode: defaultDependsMode,
    dependencyDelay: null,
  }
}

async function invokeInsertTaskTagWithSuppressedHook(
  cursor: CursorData | null,
  blockId: DbId,
  tagAlias: string,
  refData: BlockProperty[],
): Promise<void> {
  suppressedTaskTagInsertHookDepth += 1
  try {
    await orca.commands.invokeEditorCommand(
      "core.editor.insertTag",
      cursor,
      blockId,
      tagAlias,
      refData,
    )
  } finally {
    suppressedTaskTagInsertHookDepth = Math.max(0, suppressedTaskTagInsertHookDepth - 1)
  }
}

function resolveTaskTagRefFromState(
  blockId: DbId,
  tagAlias: string,
): BlockRef | null {
  for (const candidateId of collectCandidateBlockIds(blockId)) {
    const block = orca.state.blocks[candidateId]
    if (block == null) {
      continue
    }

    const taskRef = findTaskTagRef(block, tagAlias)
    if (taskRef != null) {
      return taskRef
    }
  }

  return null
}

function buildPendingTaskTagInsertKey(
  blockId: DbId,
  tagAlias: string,
  refData: BlockProperty[] | undefined,
): string {
  return `${blockId}|${normalizeTaskPropertyKey(tagAlias)}|${serializeRefDataSignature(refData)}`
}

function serializeRefDataSignature(refData: BlockProperty[] | undefined): string {
  if (!Array.isArray(refData)) {
    return "null"
  }

  return JSON.stringify(refData, (_key, value) => {
    if (value instanceof Date) {
      return {
        __type: "date",
        value: value.getTime(),
      }
    }
    return value
  })
}

function shiftPendingTaskTagInsertState(
  pendingKey: string,
): PendingTaskTagInsertState | null {
  const pendingList = pendingTaskTagInsertStates.get(pendingKey)
  if (pendingList == null || pendingList.length === 0) {
    return null
  }

  pruneExpiredPendingTaskTagInsertStates(pendingList)
  const next = pendingList.shift() ?? null
  if (pendingList.length === 0) {
    pendingTaskTagInsertStates.delete(pendingKey)
  }

  return next
}

function pruneExpiredPendingTaskTagInsertStates(
  pendingList: PendingTaskTagInsertState[],
): void {
  const threshold = Date.now() - TASK_TAG_INSERT_PENDING_TTL_MS
  while (pendingList.length > 0 && pendingList[0].createdAt < threshold) {
    pendingList.shift()
  }
}

function isTaskTagAliasMatch(left: unknown, right: string): boolean {
  return typeof left === "string" && normalizeTaskPropertyKey(left) === normalizeTaskPropertyKey(right)
}

function normalizeTaskPropertyKey(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : ""
}

function createStatusIconClickListener(
  schema: TaskSchemaDefinition,
  pluginName: string,
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
    if (!isValidDbId(blockId)) {
      return
    }

    const rawBlock = orca.state.blocks[blockId] ?? null
    const liveBlock = orca.state.blocks[getMirrorId(blockId)] ?? rawBlock
    const taskRef =
      (liveBlock != null ? findTaskTagRef(liveBlock, schema.tagAlias) : null) ??
      (rawBlock != null ? findTaskTagRef(rawBlock, schema.tagAlias) : null)
    if (taskRef == null) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    openTaskStatusMenu({
      blockId,
      block: liveBlock ?? rawBlock,
      taskTagRef: taskRef,
      schema,
      pluginName,
      rect: new DOMRect(event.clientX, event.clientY, 0, 0),
    })
  }
}

function openTaskStatusMenu(options: {
  blockId: DbId
  block: Block | null
  taskTagRef: BlockRef
  schema: TaskSchemaDefinition
  pluginName: string
  rect: DOMRect
}) {
  if (options.block == null) {
    return
  }

  ensureTaskStatusMenuRoot()
  taskStatusMenuState.visible = true
  taskStatusMenuState.rect = options.rect
  taskStatusMenuState.blockId = options.blockId
  taskStatusMenuState.block = options.block
  taskStatusMenuState.taskTagRef = options.taskTagRef
  taskStatusMenuState.schema = options.schema
  taskStatusMenuState.pluginName = options.pluginName
  renderTaskStatusMenu()
}

function closeTaskStatusMenu() {
  if (taskStatusMenuState.root == null) {
    return
  }

  taskStatusMenuState.visible = false
  renderTaskStatusMenu()
}

function disposeTaskStatusMenu() {
  taskStatusMenuState.root?.unmount()
  taskStatusMenuState.containerEl?.remove()
  taskStatusMenuState.root = null
  taskStatusMenuState.containerEl = null
  taskStatusMenuState.visible = false
  taskStatusMenuState.rect = null
  taskStatusMenuState.blockId = null
  taskStatusMenuState.block = null
  taskStatusMenuState.taskTagRef = null
  taskStatusMenuState.schema = null
  taskStatusMenuState.pluginName = ""
}

function ensureTaskStatusMenuRoot() {
  if (taskStatusMenuState.root != null && taskStatusMenuState.containerEl?.isConnected === true) {
    return
  }

  taskStatusMenuState.root?.unmount()
  taskStatusMenuState.containerEl?.remove()

  const containerEl = document.createElement("div")
  containerEl.dataset.role = "mlo-task-status-menu-root"
  document.body.appendChild(containerEl)
  taskStatusMenuState.containerEl = containerEl
  taskStatusMenuState.root = window.createRoot(containerEl) as ReactRootLike
}

function renderTaskStatusMenu() {
  if (taskStatusMenuState.root == null) {
    return
  }

  const React = window.React
  taskStatusMenuState.root.render(
    React.createElement(TaskStatusPopupMenu, {
      visible: taskStatusMenuState.visible,
      rect: taskStatusMenuState.rect,
      blockId: taskStatusMenuState.blockId,
      block: taskStatusMenuState.block,
      taskTagRef: taskStatusMenuState.taskTagRef,
      schema: taskStatusMenuState.schema,
      pluginName: taskStatusMenuState.pluginName,
      onClose: () => closeTaskStatusMenu(),
      onClosed: () => {
        taskStatusMenuState.rect = null
        taskStatusMenuState.blockId = null
        taskStatusMenuState.block = null
        taskStatusMenuState.taskTagRef = null
      },
    }),
  )
}

function TaskStatusPopupMenu(props: {
  visible: boolean
  rect: DOMRect | null
  blockId: DbId | null
  block: Block | null
  taskTagRef: BlockRef | null
  schema: TaskSchemaDefinition | null
  pluginName: string
  onClose: () => void
  onClosed: () => void
}) {
  const React = window.React
  const Popup = orca.components.Popup
  const Menu = orca.components.Menu
  const MenuText = orca.components.MenuText

  if (
    props.rect == null ||
    props.blockId == null ||
    props.block == null ||
    props.taskTagRef == null ||
    props.schema == null
  ) {
    return null
  }

  const currentValues = getTaskPropertiesFromRef(props.taskTagRef.data, props.schema, props.block)
  return React.createElement(
    Popup,
    {
      container: { current: document.body },
      rect: props.rect,
      visible: props.visible,
      onClose: props.onClose,
      onClosed: props.onClosed,
      defaultPlacement: "bottom",
      alignment: "left",
      offset: 6,
      allowBeyondContainer: true,
      noPointerLogic: true,
      escapeToClose: true,
    },
    React.createElement(
      Menu,
      {
        keyboardNav: true,
        className: "mlo-task-status-menu-content",
      },
      ...props.schema.statusChoices.map((status) =>
        React.createElement(MenuText, {
          key: status,
          title: status,
          preIcon: currentValues.status === status ? "ti ti-check" : "ti ti-circle",
          disabled: currentValues.status === status,
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            props.onClose()
            if (currentValues.status === status) {
              return
            }
            void setTaskTagStatus(
              props.blockId as DbId,
              null,
              props.block as Block,
              props.taskTagRef as BlockRef,
              props.schema as TaskSchemaDefinition,
              props.pluginName,
              status,
            ).catch((error) => {
              console.error(error)
              orca.notify("error", t("Failed to set task status"))
            })
          },
        }),
      ),
    ),
  )
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
  const projectTagName = schema.projectTagAlias.toLowerCase()
  const statusPropertyDataName = toDataAttributeName(schema.propertyNames.status)
  const { todo: todoStatus, doing: doingStatus, waiting: waitingStatus, done: doneStatus } =
    getTaskStatusValues(schema)
  const mainTaskSelector = `.orca-tags>.orca-tag[data-name="${taskTagName}"]`
  const projectSelector = `.orca-tags>.orca-tag[data-name="${projectTagName}"]`
  const cardTaskSelector = `.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"]`
  const cardProjectSelector = `.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${projectTagName}"]`
  const taskSelector = `.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"]`
  const projectFilter = `:not(:has(${projectSelector}))`
  const cardProjectFilter = `:not(:has(${cardProjectSelector}))`

  const styles = `
    .orca-repr-main-content:has(>${mainTaskSelector})${projectFilter}::before,
    .orca-repr:has(>${cardTaskSelector})${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>${mainTaskSelector})${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      font-family: "tabler-icons";
      speak: none;
      font-style: normal;
      font-weight: normal;
      font-variant: normal;
      text-transform: none;
      -webkit-font-smoothing: antialiased;
      margin-right: var(--orca-spacing-md);
      cursor: pointer;
      font-size: calc(.25rem + var(--orca-block-line-height) / var(--orca-lineheight-md));
      display: inline-block;
      line-height: 1;
      translate: 0 .125rem;
    }

    .orca-repr-main-content:has(>${taskSelector})${projectFilter}::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\ea6b";
      color: var(--orca-color-text-2);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])${projectFilter}::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\fedd";
      color: var(--orca-color-text-yellow);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"])${projectFilter}::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"])${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"])${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\f319";
      color: var(--orca-color-text-blue, #2563eb);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${projectFilter}::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\f704";
      color: var(--orca-color-text-green);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${projectFilter} .orca-inline,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${cardProjectFilter} > .orca-repr-main>.orca-repr-main-content .orca-inline,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])${projectFilter} ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content .orca-inline {
      opacity: 0.75;
    }

    .mlo-task-status-menu-content {
      min-width: 156px;
      border-radius: 10px;
      border: 1px solid var(--orca-color-border);
      background: var(--orca-color-bg-1);
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
