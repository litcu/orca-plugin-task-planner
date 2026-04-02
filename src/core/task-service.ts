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
import {
  setupTaskTimerInlineWidgets,
  type TaskTimerInlineHandle,
} from "./task-timer-inline"
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

const pendingTaskTagInsertStates = new Map<string, PendingTaskTagInsertState[]>()
let suppressedTaskTagInsertHookDepth = 0

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

  // 命令用于 Alt+Enter 和左侧状态图标点击，共享同一条状态流转逻辑。
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
  const clickListener = createStatusIconClickListener(commandId, schema)
  document.body.addEventListener("click", clickListener)
  const { subscribe } = window.Valtio
  let disposed = false
  let timerInlineHandle: TaskTimerInlineHandle | null = null
  let timerInlineEnabled = getPluginSettings(pluginName).taskTimerEnabled
  let settingsUnsubscribe: (() => void) | null = null

  const mountTimerInlineWidgets = () => {
    if (disposed || !timerInlineEnabled || timerInlineHandle != null) {
      return
    }

    timerInlineHandle = setupTaskTimerInlineWidgets(pluginName, schema)
  }

  const unmountTimerInlineWidgets = () => {
    if (timerInlineHandle == null) {
      return
    }

    timerInlineHandle.dispose()
    timerInlineHandle = null
  }

  mountTimerInlineWidgets()

  const pluginState = orca.state.plugins[pluginName]
  if (pluginState != null) {
    settingsUnsubscribe = subscribe(pluginState, () => {
      if (disposed) {
        return
      }

      const nextTimerInlineEnabled = getPluginSettings(pluginName).taskTimerEnabled
      if (nextTimerInlineEnabled === timerInlineEnabled) {
        return
      }

      timerInlineEnabled = nextTimerInlineEnabled
      if (timerInlineEnabled) {
        mountTimerInlineWidgets()
      } else {
        unmountTimerInlineWidgets()
      }
    })
  }

  return {
    commandId,
    dispose: async () => {
      disposed = true
      settingsUnsubscribe?.()
      settingsUnsubscribe = null
      unmountTimerInlineWidgets()
      document.body.removeEventListener("click", clickListener)
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
  const propertyNames = schema.propertyNames
  const currentValues = getTaskPropertiesFromRef(taskTagRef.data, schema, block)
  const nextStatus = getNextTaskStatusInMainCycle(currentValues.status, schema)
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
  const { todo: todoStatus, doing: doingStatus, waiting: waitingStatus, done: doneStatus } =
    getTaskStatusValues(schema)

  const styles = `
    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
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

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${todoStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\ea6b";
      color: var(--orca-color-text-2);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doingStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\fedd";
      color: var(--orca-color-text-yellow);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${waitingStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\ea6b";
      color: var(--orca-color-text-blue, #2563eb);
    }

    .orca-repr-main-content:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])::before,
    .orca-repr:has(>.orca-repr-card-title>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"])>.orca-repr-main>.orca-repr-main-content::before,
    .orca-query-card-title:has(>.orca-tags>.orca-tag[data-name="${taskTagName}"][data-${statusPropertyDataName}="${doneStatus}"]) ~ .orca-block>.orca-repr>.orca-repr-main>.orca-repr-main-content::before {
      content: "\\f704";
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
