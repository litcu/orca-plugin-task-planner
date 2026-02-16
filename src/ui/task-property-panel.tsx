import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import {
  DEFAULT_TASK_DEPENDENCY_DELAY,
  DEFAULT_TASK_SCORE,
  type TaskSchemaDefinition,
} from "../core/task-schema"
import { getMirrorId } from "../core/block-utils"
import {
  buildTaskFieldLabels,
  getTaskPropertiesFromRef,
  normalizeTaskValuesForStatus,
  toRefDataForSave,
  toTaskMetaPropertyForSave,
  validateNumericField,
} from "../core/task-properties"
import { invalidateNextActionEvaluationCache } from "../core/dependency-engine"
import { createRecurringTaskInTodayJournal } from "../core/task-recurrence"

import { t } from "../libs/l10n"
import {
  loadTaskActivationInfo,
  resolveBlockedReasonTag,
  type TaskActivationInfo,
} from "./task-activation-state"
import {
  buildRepeatRuleFromEditorState,
  parseRepeatRuleToEditorState,
  type RepeatMode,
} from "./repeat-rule-editor"
import {
  buildReviewRuleFromEditorState,
  parseReviewRuleToEditorState,
  type ReviewMode,
  type TaskReviewType,
} from "../core/task-review"
type PopupTriggerSource = "tag-click" | "tag-menu" | "panel-view"

type ReactRootLike = {
  render: (node: unknown) => void
  unmount: () => void
}

interface PopupState {
  root: ReactRootLike | null
  containerEl: HTMLDivElement | null
  options: OpenTaskPropertyPopupOptions | null
  visible: boolean
}

interface OpenTaskPropertyPopupOptions {
  blockId?: DbId
  parentBlockId?: DbId
  parentSourceBlockId?: DbId
  schema: TaskSchemaDefinition
  triggerSource: PopupTriggerSource
  mode?: "edit" | "create"
  onTaskCreated?: (blockId: DbId) => void
  onTaskSaved?: (blockId: DbId) => void
}

const popupState: PopupState = {
  root: null,
  containerEl: null,
  options: null,
  visible: false,
}

const TAG_REF_TYPE = 2
const REF_DATA_TYPE = 3
const TEXT_CHOICES_PROP_TYPE = 6

export type { OpenTaskPropertyPopupOptions }

export function openTaskPropertyPopup(options: OpenTaskPropertyPopupOptions) {
  ensureRoot()
  popupState.options = options
  popupState.visible = true
  renderCurrent()
}

export function closeTaskPropertyPopup() {
  if (popupState.root == null || popupState.options == null) {
    return
  }

  popupState.visible = false
  renderCurrent()
}

export function disposeTaskPropertyPopup() {
  popupState.root?.unmount()
  popupState.containerEl?.remove()

  popupState.root = null
  popupState.containerEl = null
  popupState.options = null
  popupState.visible = false
}

function ensureRoot() {
  if (popupState.root != null) {
    return
  }

  const containerEl = document.createElement("div")
  containerEl.dataset.role = "mlo-task-property-popup-root"
  document.body.appendChild(containerEl)

  popupState.containerEl = containerEl
  popupState.root = window.createRoot(containerEl) as ReactRootLike
}

function renderCurrent() {
  if (popupState.root == null || popupState.options == null) {
    return
  }

  const React = window.React
  popupState.root.render(
    React.createElement(TaskPropertyPopupView, {
      ...popupState.options,
      visible: popupState.visible,
      onClose: () => closeTaskPropertyPopup(),
      onDispose: () => disposeTaskPropertyPopup(),
    }),
  )
}

function TaskPropertyPopupView(props: {
  blockId?: DbId
  parentBlockId?: DbId
  parentSourceBlockId?: DbId
  schema: TaskSchemaDefinition
  mode?: "edit" | "create"
  onTaskCreated?: (blockId: DbId) => void
  onTaskSaved?: (blockId: DbId) => void
  visible: boolean
  onClose: () => void
  onDispose: () => void
}) {
  const React = window.React
  const Button = orca.components.Button
  const Checkbox = orca.components.Checkbox
  const Input = orca.components.Input
  const Select = orca.components.Select
  const DatePicker = orca.components.DatePicker
  const BlockSelect = orca.components.BlockSelect
  const ModalOverlay = orca.components.ModalOverlay

  const labels = buildTaskFieldLabels(orca.state.locale)
  const isChinese = orca.state.locale === "zh-CN"
  const isCreateMode = props.mode === "create"
  const untitledTaskName = t("(Untitled task)")
  const block = props.blockId == null ? undefined : orca.state.blocks[props.blockId]
  const taskRef = block?.refs.find(
    (ref) => ref.type === TAG_REF_TYPE && ref.alias === props.schema.tagAlias,
  )
  const initialValues = React.useMemo(() => {
    return getTaskPropertiesFromRef(taskRef?.data, props.schema, block)
  }, [block, taskRef, props.schema])
  const editorInitialValues = React.useMemo(() => {
    if (!isCreateMode) {
      return initialValues
    }

    return {
      ...initialValues,
      importance: initialValues.importance ?? DEFAULT_TASK_SCORE,
      urgency: initialValues.urgency ?? DEFAULT_TASK_SCORE,
      effort: initialValues.effort ?? DEFAULT_TASK_SCORE,
      dependencyDelay:
        initialValues.dependencyDelay ?? DEFAULT_TASK_DEPENDENCY_DELAY,
    }
  }, [initialValues, isCreateMode])

  const initialDependsOnForEditor = React.useMemo(() => {
    return normalizeDependsOnForSelect(
      block,
      initialValues.dependsOn,
      props.schema.propertyNames.dependsOn,
    )
  }, [block, initialValues.dependsOn, props.schema.propertyNames.dependsOn])
  const blockTagLabels = React.useMemo(() => {
    return collectTaskLabelValuesFromBlockTags(block, props.schema.tagAlias)
  }, [block, props.schema.tagAlias])
  const taskName = React.useMemo(() => {
    if (isCreateMode) {
      return ""
    }
    return resolveTaskName(block, props.schema.tagAlias, isChinese)
  }, [block, isChinese, isCreateMode, props.schema.tagAlias])
  const initialRepeatEditor = React.useMemo(() => {
    return parseRepeatRuleToEditorState(editorInitialValues.repeatRule)
  }, [editorInitialValues.repeatRule])
  const initialReviewEditor = React.useMemo(() => {
    const parsed = parseReviewRuleToEditorState(editorInitialValues.reviewEvery)
    return {
      mode: parsed.mode === "none" ? "day" as ReviewMode : parsed.mode,
      intervalText: parsed.intervalText,
    }
  }, [editorInitialValues.reviewEvery])

  const [taskNameText, setTaskNameText] = React.useState(taskName)
  const [statusValue, setStatusValue] = React.useState(editorInitialValues.status)
  const [startTimeValue, setStartTimeValue] = React.useState<Date | null>(
    editorInitialValues.startTime,
  )
  const [endTimeValue, setEndTimeValue] = React.useState<Date | null>(
    editorInitialValues.endTime,
  )
  const [nextReviewValue, setNextReviewValue] = React.useState<Date | null>(
    editorInitialValues.nextReview,
  )
  const [reviewEnabledValue, setReviewEnabledValue] = React.useState(
    editorInitialValues.reviewEnabled,
  )
  const [reviewTypeValue, setReviewTypeValue] = React.useState<TaskReviewType>(
    editorInitialValues.reviewType,
  )
  const [importanceText, setImportanceText] = React.useState(
    editorInitialValues.importance == null ? "" : String(editorInitialValues.importance),
  )
  const [urgencyText, setUrgencyText] = React.useState(
    editorInitialValues.urgency == null ? "" : String(editorInitialValues.urgency),
  )
  const [effortText, setEffortText] = React.useState(
    editorInitialValues.effort == null ? "" : String(editorInitialValues.effort),
  )
  const [importanceValue, setImportanceValue] = React.useState(
    clampScore(editorInitialValues.importance),
  )
  const [urgencyValue, setUrgencyValue] = React.useState(
    clampScore(editorInitialValues.urgency),
  )
  const [effortValue, setEffortValue] = React.useState(
    clampScore(editorInitialValues.effort),
  )
  const [starValue, setStarValue] = React.useState(editorInitialValues.star)
  const [repeatRuleText, setRepeatRuleText] = React.useState(editorInitialValues.repeatRule)
  const [taskLabelsValue, setTaskLabelsValue] = React.useState<string[]>(
    mergeTaskLabelValues(editorInitialValues.labels, blockTagLabels),
  )
  const [taskLabelOptions, setTaskLabelOptions] = React.useState<string[]>(
    mergeTaskLabelValues(editorInitialValues.labels, blockTagLabels),
  )
  const [remarkText, setRemarkText] = React.useState(editorInitialValues.remark)
  const [repeatModeValue, setRepeatModeValue] = React.useState<RepeatMode>(
    initialRepeatEditor.mode,
  )
  const [repeatIntervalText, setRepeatIntervalText] = React.useState(
    initialRepeatEditor.intervalText,
  )
  const [repeatWeekdayValue, setRepeatWeekdayValue] = React.useState(
    initialRepeatEditor.weekdayValue,
  )
  const [repeatMaxCountText, setRepeatMaxCountText] = React.useState(
    initialRepeatEditor.maxCountText,
  )
  const [repeatEndAtValue, setRepeatEndAtValue] = React.useState<Date | null>(
    initialRepeatEditor.endAtValue,
  )
  const [repeatOccurrence, setRepeatOccurrence] = React.useState(
    initialRepeatEditor.occurrence,
  )
  const [repeatRuleParseable, setRepeatRuleParseable] = React.useState(
    initialRepeatEditor.parseable,
  )
  const [reviewModeValue, setReviewModeValue] = React.useState<ReviewMode>(
    initialReviewEditor.mode,
  )
  const [reviewIntervalText, setReviewIntervalText] = React.useState(
    initialReviewEditor.intervalText,
  )
  const [lastReviewedValue, setLastReviewedValue] = React.useState<Date | null>(
    editorInitialValues.lastReviewed,
  )
  const [dependsOnValues, setDependsOnValues] = React.useState<DbId[]>(
    initialDependsOnForEditor,
  )
  const [dependsModeValue, setDependsModeValue] = React.useState(
    editorInitialValues.dependsMode,
  )
  const [dependencyDelayText, setDependencyDelayText] = React.useState(
    editorInitialValues.dependencyDelay == null
      ? ""
      : String(editorInitialValues.dependencyDelay),
  )
  const [editingDateField, setEditingDateField] = React.useState<
    "start" | "end" | "repeatEnd" | "nextReview" | null
  >(null)
  const [errorText, setErrorText] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [lastSavedSnapshot, setLastSavedSnapshot] = React.useState("")
  const [lastFailedSnapshot, setLastFailedSnapshot] = React.useState<string | null>(null)
  const [activationInfo, setActivationInfo] = React.useState<TaskActivationInfo | null>(
    null,
  )
  const [activationLoading, setActivationLoading] = React.useState(true)

  const dateAnchorRef = React.useRef<HTMLElement | null>(null)
  // Mount dropdown and date picker overlays to body to avoid clipping by modal scroll.
  const popupMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (popupMenuContainerRef.current == null) {
    popupMenuContainerRef.current = document.body
  }

  const hasDependencies = dependsOnValues.length > 0
  const displayTaskName = taskNameText.trim() === ""
    ? untitledTaskName
    : taskNameText.trim()
  const selectedDateValue =
    editingDateField === "start"
      ? startTimeValue
      : editingDateField === "end"
        ? endTimeValue
        : editingDateField === "nextReview"
          ? nextReviewValue
        : editingDateField === "repeatEnd"
          ? repeatEndAtValue
        : null
  const initialSnapshot = React.useMemo(() => {
    return buildEditorSnapshot({
      taskNameText: taskName,
      status: editorInitialValues.status,
      startTime: editorInitialValues.startTime,
      endTime: editorInitialValues.endTime,
      reviewEnabled: editorInitialValues.reviewEnabled,
      reviewType: editorInitialValues.reviewType,
      nextReview: editorInitialValues.nextReview,
      reviewMode: initialReviewEditor.mode,
      reviewIntervalText: initialReviewEditor.intervalText,
      lastReviewed: editorInitialValues.lastReviewed,
      importanceText:
        editorInitialValues.importance == null ? "" : String(editorInitialValues.importance),
      urgencyText:
        editorInitialValues.urgency == null ? "" : String(editorInitialValues.urgency),
      effortText: editorInitialValues.effort == null ? "" : String(editorInitialValues.effort),
      star: editorInitialValues.star,
      repeatRuleText: editorInitialValues.repeatRule,
      taskLabels: editorInitialValues.labels,
      remarkText: editorInitialValues.remark,
      dependsOn: initialDependsOnForEditor,
      dependsMode: editorInitialValues.dependsMode,
      dependencyDelayText:
        editorInitialValues.dependencyDelay == null
          ? ""
          : String(editorInitialValues.dependencyDelay),
      hasDependencies: initialDependsOnForEditor.length > 0,
    })
  }, [
    initialDependsOnForEditor,
    taskName,
    editorInitialValues.dependencyDelay,
    editorInitialValues.dependsMode,
    editorInitialValues.endTime,
    editorInitialValues.effort,
    editorInitialValues.importance,
    editorInitialValues.lastReviewed,
    editorInitialValues.labels,
    editorInitialValues.nextReview,
    editorInitialValues.reviewEnabled,
    editorInitialValues.reviewType,
    editorInitialValues.remark,
    editorInitialValues.repeatRule,
    editorInitialValues.startTime,
    editorInitialValues.star,
    editorInitialValues.status,
    editorInitialValues.urgency,
    initialReviewEditor.intervalText,
    initialReviewEditor.mode,
  ])
  const currentSnapshot = React.useMemo(() => {
    return buildEditorSnapshot({
      taskNameText,
      status: statusValue,
      startTime: startTimeValue,
      endTime: endTimeValue,
      reviewEnabled: reviewEnabledValue,
      reviewType: reviewTypeValue,
      nextReview: nextReviewValue,
      reviewMode: reviewModeValue,
      reviewIntervalText,
      lastReviewed: lastReviewedValue,
      importanceText,
      urgencyText,
      effortText,
      star: starValue,
      repeatRuleText,
      taskLabels: taskLabelsValue,
      remarkText,
      dependsOn: dependsOnValues,
      dependsMode: dependsModeValue,
      dependencyDelayText,
      hasDependencies,
    })
  }, [
    dependencyDelayText,
    dependsModeValue,
    dependsOnValues,
    endTimeValue,
    effortText,
    hasDependencies,
    importanceText,
    lastReviewedValue,
    nextReviewValue,
    reviewEnabledValue,
    remarkText,
    reviewIntervalText,
    reviewModeValue,
    reviewTypeValue,
    repeatRuleText,
    startTimeValue,
    starValue,
    statusValue,
    taskNameText,
    taskLabelsValue,
    urgencyText,
  ])

  React.useEffect(() => {
    setTaskNameText(taskName)
    setStatusValue(editorInitialValues.status)
    setStartTimeValue(editorInitialValues.startTime)
    setEndTimeValue(editorInitialValues.endTime)
    setNextReviewValue(editorInitialValues.nextReview)
    setReviewEnabledValue(editorInitialValues.reviewEnabled)
    setReviewTypeValue(editorInitialValues.reviewType)
    setImportanceText(
      editorInitialValues.importance == null ? "" : String(editorInitialValues.importance),
    )
    setUrgencyText(editorInitialValues.urgency == null ? "" : String(editorInitialValues.urgency))
    setEffortText(editorInitialValues.effort == null ? "" : String(editorInitialValues.effort))
    setImportanceValue(clampScore(editorInitialValues.importance))
    setUrgencyValue(clampScore(editorInitialValues.urgency))
    setEffortValue(clampScore(editorInitialValues.effort))
    setStarValue(editorInitialValues.star)
    setRepeatRuleText(editorInitialValues.repeatRule)
    const mergedLabels = mergeTaskLabelValues(editorInitialValues.labels, blockTagLabels)
    setTaskLabelsValue(mergedLabels)
    setTaskLabelOptions(mergedLabels)
    setRemarkText(editorInitialValues.remark)
    setRepeatModeValue(initialRepeatEditor.mode)
    setRepeatIntervalText(initialRepeatEditor.intervalText)
    setRepeatWeekdayValue(initialRepeatEditor.weekdayValue)
    setRepeatMaxCountText(initialRepeatEditor.maxCountText)
    setRepeatEndAtValue(initialRepeatEditor.endAtValue)
    setRepeatOccurrence(initialRepeatEditor.occurrence)
    setRepeatRuleParseable(initialRepeatEditor.parseable)
    setReviewModeValue(initialReviewEditor.mode)
    setReviewIntervalText(initialReviewEditor.intervalText)
    setLastReviewedValue(editorInitialValues.lastReviewed)
    setDependsOnValues(initialDependsOnForEditor)
    setDependsModeValue(editorInitialValues.dependsMode)
    setDependencyDelayText(
      editorInitialValues.dependencyDelay == null
        ? ""
        : String(editorInitialValues.dependencyDelay),
    )
    setEditingDateField(null)
    setErrorText("")
    setSaving(false)
    setLastSavedSnapshot(initialSnapshot)
    setLastFailedSnapshot(null)
  }, [
    props.blockId,
    initialDependsOnForEditor,
    initialRepeatEditor.intervalText,
    initialRepeatEditor.mode,
    initialRepeatEditor.maxCountText,
    initialRepeatEditor.occurrence,
    initialRepeatEditor.parseable,
    initialRepeatEditor.endAtValue,
    initialRepeatEditor.weekdayValue,
    initialReviewEditor.intervalText,
    initialReviewEditor.mode,
    initialSnapshot,
    taskName,
    blockTagLabels,
    editorInitialValues,
  ])

  const statusOptions = props.schema.statusChoices.map((item) => ({
    value: item,
    label: item,
  }))

  const dependsModeOptions = [
    { value: "ALL", label: t("All dependency tasks completed") },
    { value: "ANY", label: t("Any dependency task completed") },
  ]
  const repeatModeOptions = [
    { value: "none", label: t("No repeat") },
    { value: "day", label: t("By day") },
    { value: "week", label: t("By week") },
    { value: "month", label: t("By month") },
  ]
  const reviewTypeOptions = [
    { value: "single", label: labels.singleReview },
    { value: "cycle", label: labels.cycleReview },
  ]
  const reviewModeOptions = [
    { value: "day", label: t("By day") },
    { value: "week", label: t("By week") },
    { value: "month", label: t("By month") },
  ]
  const repeatWeekdayOptions = [
    { value: "", label: t("Not set") },
    { value: "0", label: t("Sunday") },
    { value: "1", label: t("Monday") },
    { value: "2", label: t("Tuesday") },
    { value: "3", label: t("Wednesday") },
    { value: "4", label: t("Thursday") },
    { value: "5", label: t("Friday") },
    { value: "6", label: t("Saturday") },
  ]
  const taskLabelSelectOptions = React.useMemo(() => {
    return buildTaskLabelSelectOptions(taskLabelOptions, taskLabelsValue)
  }, [taskLabelOptions, taskLabelsValue])

  const updateRepeatEditor = React.useCallback((next: {
    mode?: RepeatMode
    intervalText?: string
    weekdayValue?: string
    maxCountText?: string
    endAtValue?: Date | null
  }) => {
    const mode = next.mode ?? repeatModeValue
    const intervalText = next.intervalText ?? repeatIntervalText
    const weekdayValue = next.weekdayValue ?? repeatWeekdayValue
    const maxCountText = next.maxCountText ?? repeatMaxCountText
    const endAtValue = next.endAtValue !== undefined ? next.endAtValue : repeatEndAtValue
    const nextRule = buildRepeatRuleFromEditorState({
      mode,
      intervalText,
      weekdayValue,
      maxCountText,
      endAtValue,
      occurrence: repeatOccurrence,
    })

    setRepeatModeValue(mode)
    setRepeatIntervalText(intervalText)
    setRepeatWeekdayValue(weekdayValue)
    setRepeatMaxCountText(maxCountText)
    setRepeatEndAtValue(endAtValue)
    setRepeatRuleParseable(true)
    setRepeatRuleText(nextRule)
  }, [
    repeatEndAtValue,
    repeatIntervalText,
    repeatMaxCountText,
    repeatModeValue,
    repeatOccurrence,
    repeatWeekdayValue,
  ])

  const updateReviewEditor = React.useCallback((next: {
    mode?: ReviewMode
    intervalText?: string
  }) => {
    const mode = next.mode ?? reviewModeValue
    const intervalText = next.intervalText ?? reviewIntervalText

    setReviewModeValue(mode)
    setReviewIntervalText(intervalText)
  }, [
    reviewIntervalText,
    reviewModeValue,
  ])

  const refreshActivationInfo = React.useCallback(async () => {
    if (isCreateMode || props.blockId == null) {
      setActivationInfo(null)
      setActivationLoading(false)
      return
    }

    setActivationLoading(true)
    try {
      const next = await loadTaskActivationInfo(props.schema, props.blockId)
      setActivationInfo(next)
    } catch (error) {
      console.error(error)
      setActivationInfo(null)
    } finally {
      setActivationLoading(false)
    }
  }, [isCreateMode, props.blockId, props.schema])

  React.useEffect(() => {
    void refreshActivationInfo()
  }, [refreshActivationInfo])

  React.useEffect(() => {
    let disposed = false

    const loadTaskLabelOptions = async () => {
      const choices = await getTaskLabelChoicesFromSchema(props.schema)
      if (disposed) {
        return
      }

      setTaskLabelOptions((prev: string[]) =>
        mergeTaskLabelValues(prev, choices, editorInitialValues.labels, blockTagLabels))
    }

    void loadTaskLabelOptions()
    return () => {
      disposed = true
    }
  }, [
    editorInitialValues.labels,
    blockTagLabels,
    props.blockId,
    props.schema,
  ])

  const handleSave = async (
    snapshot: string,
    options?: {
      closeOnSuccess?: boolean
    },
  ) => {
    const closeOnSuccess = options?.closeOnSuccess === true

    const importance = validateNumericField(labels.importance, importanceText)
    if (importance.error != null) {
      setErrorText(importance.error)
      setLastFailedSnapshot(snapshot)
      return
    }

    const urgency = validateNumericField(labels.urgency, urgencyText)
    if (urgency.error != null) {
      setErrorText(urgency.error)
      setLastFailedSnapshot(snapshot)
      return
    }
    const effort = validateNumericField(labels.effort, effortText)
    if (effort.error != null) {
      setErrorText(effort.error)
      setLastFailedSnapshot(snapshot)
      return
    }

    const dependencyDelay = validateNumericField(
      labels.dependencyDelay,
      dependencyDelayText,
    )
    if (dependencyDelay.error != null) {
      setErrorText(dependencyDelay.error)
      setLastFailedSnapshot(snapshot)
      return
    }

    const importanceInRange = toScoreInRange(importance.value)
    if (importanceInRange == null && importance.value != null) {
      setErrorText(t("Importance must be 0-100"))
      setLastFailedSnapshot(snapshot)
      return
    }

    const urgencyInRange = toScoreInRange(urgency.value)
    if (urgencyInRange == null && urgency.value != null) {
      setErrorText(t("Urgency must be 0-100"))
      setLastFailedSnapshot(snapshot)
      return
    }
    const effortInRange = toScoreInRange(effort.value)
    if (effortInRange == null && effort.value != null) {
      setErrorText(t("Effort must be 0-100"))
      setLastFailedSnapshot(snapshot)
      return
    }

    setSaving(true)
    setErrorText("")

    try {
      const normalizedTaskName = normalizeTaskName(taskNameText)
      const contentText = normalizedTaskName === "" ? untitledTaskName : normalizedTaskName
      const baseTaskLabels = normalizeTaskLabelValues(taskLabelsValue)
      const reviewEvery = reviewEnabledValue && reviewTypeValue === "cycle"
        ? buildReviewRuleFromEditorState({
            mode: reviewModeValue,
            intervalText: reviewIntervalText,
          })
        : ""

      if (isCreateMode) {
        const insertParentBlockId = await resolveCreateTaskInsertParentId({
          parentBlockId: props.parentBlockId,
          parentSourceBlockId: props.parentSourceBlockId,
        })
        if (insertParentBlockId == null) {
          throw new Error(t("Failed to add task"))
        }

        let createdTaskId: DbId | null = null
        await orca.commands.invokeGroup(async () => {
          const insertedTaskId = (await orca.commands.invokeEditorCommand(
            "core.editor.insertBlock",
            null,
            null,
            null,
            [{ t: "t", v: contentText }],
          )) as DbId
          createdTaskId = insertedTaskId

          try {
            await orca.commands.invokeEditorCommand(
              "core.editor.moveBlocks",
              null,
              [insertedTaskId],
              insertParentBlockId,
              "lastChild",
            )
          } catch (moveError) {
            try {
              await orca.commands.invokeEditorCommand(
                "core.editor.deleteBlocks",
                null,
                [insertedTaskId],
              )
            } catch (cleanupError) {
              console.error(cleanupError)
            }
            throw moveError
          }

          const dependencyRefIds = await ensureDependencyRefIds(
            insertedTaskId,
            dependsOnValues,
          )
          const insertedTaskBlock =
            orca.state.blocks[getMirrorId(insertedTaskId)] ??
            orca.state.blocks[insertedTaskId] ??
            null
          const normalizedTaskLabels = mergeTaskLabelValues(
            baseTaskLabels,
            collectTaskLabelValuesFromBlockTags(
              insertedTaskBlock,
              props.schema.tagAlias,
            ),
          )
          await ensureTaskLabelChoices(props.schema, normalizedTaskLabels)
          const valuesToSave = normalizeTaskValuesForStatus({
            status: statusValue,
            startTime: startTimeValue,
            endTime: endTimeValue,
            reviewEnabled: reviewEnabledValue,
            reviewType: reviewTypeValue,
            nextReview:
              reviewEnabledValue && reviewTypeValue === "single"
                ? nextReviewValue
                : null,
            reviewEvery,
            lastReviewed: reviewEnabledValue ? lastReviewedValue : null,
            importance: importanceInRange,
            urgency: urgencyInRange,
            effort: effortInRange,
            star: starValue,
            repeatRule: repeatRuleText,
            labels: normalizedTaskLabels,
            remark: remarkText,
            dependsOn: dependencyRefIds,
            dependsMode: hasDependencies ? dependsModeValue : "ALL",
            dependencyDelay: hasDependencies ? dependencyDelay.value : null,
          }, props.schema)
          const payload = toRefDataForSave(valuesToSave, props.schema)
          await orca.commands.invokeEditorCommand(
            "core.editor.insertTag",
            null,
            insertedTaskId,
            props.schema.tagAlias,
            payload,
          )
          await orca.commands.invokeEditorCommand(
            "core.editor.setProperties",
            null,
            [insertedTaskId],
            [toTaskMetaPropertyForSave(valuesToSave, insertedTaskBlock)],
          )
        })

        if (createdTaskId == null) {
          throw new Error(t("Failed to add task"))
        }

        invalidateNextActionEvaluationCache()
        setLastSavedSnapshot(snapshot)
        setLastFailedSnapshot(null)
        props.onTaskSaved?.(getMirrorId(createdTaskId))
        props.onTaskCreated?.(createdTaskId)
        if (closeOnSuccess) {
          props.onClose()
        }
        return
      }

      if (taskRef == null || props.blockId == null) {
        const message = t("Task ref not found")
        setErrorText(message)
        orca.notify("error", message)
        setLastFailedSnapshot(snapshot)
        return
      }

      const sourceBlockId = getMirrorId(props.blockId)
      const currentTaskName = normalizeTaskName(taskName)
      if (normalizedTaskName !== currentTaskName) {
        await orca.commands.invokeEditorCommand(
          "core.editor.setBlocksContent",
          null,
          [{
            id: sourceBlockId,
            content: [{ t: "t", v: contentText }],
          }],
          false,
        )
      }

      const dependencyRefIds = await ensureDependencyRefIds(
        sourceBlockId,
        dependsOnValues,
      )
      const sourceTaskBlock = orca.state.blocks[sourceBlockId] ?? block ?? null
      const normalizedTaskLabels = mergeTaskLabelValues(
        baseTaskLabels,
        collectTaskLabelValuesFromBlockTags(sourceTaskBlock, props.schema.tagAlias),
      )
      setTaskLabelsValue(normalizedTaskLabels)
      setTaskLabelOptions((prev: string[]) =>
        mergeTaskLabelValues(prev, normalizedTaskLabels))
      await ensureTaskLabelChoices(props.schema, normalizedTaskLabels)
      const previousValuesWithMeta = getTaskPropertiesFromRef(
        taskRef.data,
        props.schema,
        sourceTaskBlock,
      )
      const valuesToSave = normalizeTaskValuesForStatus({
        status: statusValue,
        startTime: startTimeValue,
        endTime: endTimeValue,
        reviewEnabled: reviewEnabledValue,
        reviewType: reviewTypeValue,
        nextReview:
          reviewEnabledValue && reviewTypeValue === "single"
            ? nextReviewValue
            : null,
        reviewEvery,
        lastReviewed: reviewEnabledValue ? lastReviewedValue : null,
        importance: importanceInRange,
        urgency: urgencyInRange,
        effort: effortInRange,
        star: starValue,
        repeatRule: repeatRuleText,
        labels: normalizedTaskLabels,
        remark: remarkText,
        dependsOn: dependencyRefIds,
        dependsMode: hasDependencies ? dependsModeValue : "ALL",
        dependencyDelay: hasDependencies ? dependencyDelay.value : null,
      }, props.schema)

      const payload = toRefDataForSave(
        valuesToSave,
        props.schema,
      )

      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        sourceBlockId,
        props.schema.tagAlias,
        payload,
      )
      await orca.commands.invokeEditorCommand(
        "core.editor.setProperties",
        null,
        [sourceBlockId],
        [toTaskMetaPropertyForSave(valuesToSave, sourceTaskBlock)],
      )
      await createRecurringTaskInTodayJournal(
        previousValuesWithMeta.status,
        valuesToSave,
        sourceBlockId,
        props.schema,
      )
      invalidateNextActionEvaluationCache()
      setLastSavedSnapshot(snapshot)
      setLastFailedSnapshot(null)
      props.onTaskSaved?.(getMirrorId(sourceBlockId))
      void refreshActivationInfo()
      if (closeOnSuccess) {
        props.onClose()
      }
    } catch (error) {
      const defaultMessage = isCreateMode
        ? props.parentBlockId != null
          ? t("Failed to add subtask")
          : t("Failed to add task")
        : t("Save failed")
      const message = error instanceof Error ? error.message : defaultMessage
      setErrorText(message)
      orca.notify("error", message)
      setLastFailedSnapshot(snapshot)
    } finally {
      setSaving(false)
    }
  }

  React.useEffect(() => {
    if (isCreateMode || taskRef == null) {
      return
    }

    const unchanged = currentSnapshot === lastSavedSnapshot
    const failedAndUnchanged =
      lastFailedSnapshot != null && currentSnapshot === lastFailedSnapshot
    if (unchanged || failedAndUnchanged || saving) {
      return
    }

    const timer = window.setTimeout(() => {
      void handleSave(currentSnapshot)
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [currentSnapshot, isCreateMode, lastFailedSnapshot, lastSavedSnapshot, saving, taskRef])

  // Use a consistent 2-column row layout: label + control.
  const rowLabelWidth = isChinese ? "92px" : "114px"
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: `${rowLabelWidth} minmax(0, 1fr)`,
    columnGap: "12px",
    alignItems: "center",
    marginBottom: "10px",
  }
  const rowLabelStyle = {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--orca-color-text-2)",
    lineHeight: "30px",
    letterSpacing: "0.01em",
  }
  const readOnlyFieldStyle = {
    minHeight: "30px",
    display: "flex",
    alignItems: "center",
    padding: "0 10px",
    border: "1px solid var(--orca-color-border-1)",
    borderRadius: "8px",
    background: "var(--orca-color-bg-1)",
    color: "var(--orca-color-text-1)",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }
  const hintTextStyle = {
    fontSize: "11px",
    color: "var(--orca-color-text-2)",
    whiteSpace: "nowrap",
  }
  const remarkTextareaStyle = {
    width: "100%",
    minHeight: "68px",
    border: "1px solid var(--orca-color-border-1)",
    borderRadius: "8px",
    background: "var(--orca-color-bg-1)",
    color: "var(--orca-color-text-1)",
    fontSize: "12px",
    lineHeight: 1.5,
    padding: "7px 10px",
    resize: "vertical" as const,
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
  }
  const sectionStyle = {
    padding: "12px 12px 2px",
    marginBottom: "10px",
    borderRadius: "10px",
    border: "1px solid var(--orca-color-border-1)",
    background: "var(--orca-color-bg-2)",
  }
  const timeFieldAnchorStyle = {
    width: "100%",
    minWidth: 0,
  }
  const inlineDualControlLayoutStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "8px",
    alignItems: "center",
  }
  const renderSection = (...children: unknown[]) => {
    return React.createElement("div", { style: sectionStyle }, ...children)
  }

  const renderFormRow = (label: string, control: unknown) => {
    return React.createElement(
      "div",
      { style: rowStyle },
      React.createElement("div", { style: rowLabelStyle }, label),
      React.createElement("div", { style: { minWidth: 0 } }, control),
    )
  }

  const renderTimeField = (
    key: "start" | "end" | "repeatEnd" | "nextReview",
    label: string,
    value: Date | null,
    setValue: (next: Date | null) => void,
  ) => {
    const hasValue = value != null
    const displayValue = hasValue ? value.toLocaleString() : ""
    return renderFormRow(
      label,
      React.createElement(
        "div",
        {
          style: timeFieldAnchorStyle,
          onClick: (event: MouseEvent) => {
            dateAnchorRef.current = event.currentTarget as HTMLElement
            setEditingDateField(key)
          },
        },
        React.createElement(Input, {
          value: displayValue,
          placeholder: t("Not set"),
          readOnly: true,
          onClick: (event: Event) => {
            dateAnchorRef.current = event.currentTarget as HTMLElement
            setEditingDateField(key)
          },
          post: React.createElement(
            Button,
            {
              variant: "plain",
              title: hasValue ? t("Clear") : t("Pick"),
              onClick: (event: MouseEvent) => {
                event.stopPropagation()
                if (hasValue) {
                  setValue(null)
                  return
                }

                const anchor = (event.currentTarget as HTMLElement)
                  .closest("[data-role='mlo-time-field-anchor']")
                dateAnchorRef.current = anchor instanceof HTMLElement
                  ? anchor
                  : event.currentTarget as HTMLElement
                setEditingDateField(key)
              },
              style: {
                borderRadius: "6px",
                width: "24px",
                minWidth: "24px",
                height: "24px",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              },
            },
            React.createElement("i", {
              className: hasValue ? "ti ti-x" : "ti ti-calendar-event",
              style: {
                fontSize: "13px",
                lineHeight: 1,
              },
            }),
          ),
          "data-role": "mlo-time-field-anchor",
          width: "100%",
        }),
      ),
    )
  }

  const renderScoreField = (
    label: string,
    value: number,
    text: string,
    setValue: (next: number) => void,
    setText: (next: string) => void,
  ) => {
    return renderFormRow(
      label,
      React.createElement(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 76px",
            gap: "8px",
            alignItems: "center",
          },
        },
        React.createElement("input", {
          type: "range",
          min: 0,
          max: 100,
          step: 1,
          value,
          style: {
            width: "100%",
            margin: 0,
            accentColor: "var(--orca-color-text-blue, #2b6cb0)",
          },
          onChange: (event: Event) => {
            const next = Number((event.target as HTMLInputElement).value)
            if (Number.isNaN(next)) {
              return
            }
            setValue(next)
            setText(String(next))
          },
        }),
        React.createElement(Input, {
          value: text,
          placeholder: "0-100",
          onChange: (event: Event) => {
            const nextText = (event.target as HTMLInputElement).value
            setText(nextText)

            const parsed = Number(nextText)
            if (!Number.isNaN(parsed)) {
              const inRange = toScoreInRange(parsed)
              if (inRange != null) {
                setValue(inRange)
              }
            }
          },
        }),
      ),
    )
  }

  const activationBadgeText = activationLoading
    ? t("Checking activation...")
    : activationInfo == null
      ? t("Activation unknown")
      : activationInfo.isActive
        ? t("Active now")
        : t("Blocked now - ${reason}", {
          reason: resolveBlockedReasonTag(activationInfo.blockedReason),
        })
  const activationBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: "24px",
    padding: "0 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.01em",
    border: "1px solid var(--orca-color-border-1)",
    color:
      activationLoading || activationInfo == null
        ? "var(--orca-color-text-2)"
        : activationInfo.isActive
          ? "var(--orca-color-text-green)"
          : "var(--orca-color-text-yellow)",
    background:
      activationLoading || activationInfo == null
        ? "var(--orca-color-bg-2)"
        : activationInfo.isActive
          ? "rgba(56, 161, 105, 0.12)"
          : "rgba(183, 121, 31, 0.12)",
  }
  const overlayStyle = isCreateMode
    ? {
      background: "rgba(2, 6, 23, 0.32)",
      backdropFilter: "none",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: "16px",
      overflow: "auto",
    }
    : {
      background: "rgba(2, 6, 23, 0.32)",
      backdropFilter: "none",
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "stretch",
      padding: 0,
    }
  const panelStyle = isCreateMode
    ? {
      width: "min(760px, calc(100vw - 20px))",
      minWidth: 0,
      maxWidth: "100%",
      maxHeight: "min(88vh, 980px)",
      overflow: "auto",
      padding: "18px 16px",
      boxSizing: "border-box",
      background: "var(--orca-color-bg-1)",
      border: "1px solid var(--orca-color-border-1)",
      borderRadius: "12px",
      boxShadow: "0 16px 36px rgba(10, 18, 30, 0.28)",
    }
    : {
      width: "min(560px, calc(100vw - 20px))",
      minWidth: 0,
      height: "100vh",
      maxHeight: "100vh",
      overflow: "auto",
      padding: "18px 16px",
      boxSizing: "border-box",
      background: "var(--orca-color-bg-1)",
      borderLeft: "1px solid var(--orca-color-border-1)",
      borderRadius: "12px 0 0 12px",
      boxShadow: "-12px 0 32px rgba(10, 18, 30, 0.24)",
    }
  return React.createElement(
    ModalOverlay,
    {
      visible: props.visible,
      blurred: false,
      style: overlayStyle,
      canClose: true,
      onClose: () => {
        if (editingDateField != null) {
          setEditingDateField(null)
          return
        }
        props.onClose()
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
          style: panelStyle,
          onClick: (event: MouseEvent) => event.stopPropagation(),
        },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "12px",
              paddingBottom: "10px",
              borderBottom: "1px solid var(--orca-color-border-1)",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  fontSize: "17px",
                  fontWeight: 600,
                  lineHeight: 1.2,
                },
              },
              isCreateMode
                ? props.parentBlockId != null
                  ? t("Add subtask")
                  : t("Add task")
                : labels.title,
            ),
            !isCreateMode
              ? React.createElement("span", { style: activationBadgeStyle }, activationBadgeText)
              : null,
            React.createElement(
              "button",
              {
                type: "button",
                onClick: () => setStarValue((prev: boolean) => !prev),
                title: starValue ? t("Starred") : t("Not starred"),
                style: {
                  width: "26px",
                  height: "26px",
                  padding: 0,
                  border: "1px solid var(--orca-color-border-1)",
                  borderRadius: "7px",
                  background: "var(--orca-color-bg-2)",
                  color: starValue
                    ? "var(--orca-color-text-yellow, #d69e2e)"
                    : "var(--orca-color-text-2)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                },
              },
              React.createElement(StarIcon, { filled: starValue }),
            ),
          ),
        ),
        renderSection(
          renderFormRow(
            t("Task name"),
            React.createElement(Input, {
              value: taskNameText,
              placeholder: untitledTaskName,
              onChange: (event: Event) => {
                setTaskNameText((event.target as HTMLInputElement).value)
              },
              width: "100%",
            }),
          ),
          renderFormRow(
            labels.status,
            React.createElement(Select, {
              selected: [statusValue],
              options: statusOptions,
              onChange: (selected: string[]) => {
                setStatusValue(selected[0] ?? props.schema.statusChoices[0])
              },
              menuContainer: popupMenuContainerRef,
              width: "100%",
            }),
          ),
          renderFormRow(
            labels.labels,
            React.createElement(Select, {
              selected: taskLabelsValue,
              options: taskLabelSelectOptions,
              multiSelection: true,
              filter: true,
              placeholder: t("Select labels"),
              filterPlaceholder: t("Filter labels"),
              filterFunction: async (keyword: string) => {
                return buildTaskLabelSelectOptions(
                  taskLabelOptions,
                  taskLabelsValue,
                  keyword,
                )
              },
              onChange: (selected: string[]) => {
                const normalized = normalizeTaskLabelValues(selected)
                setTaskLabelsValue(normalized)
                setTaskLabelOptions((prev: string[]) =>
                  mergeTaskLabelValues(prev, normalized))
              },
              menuContainer: popupMenuContainerRef,
              width: "100%",
            }),
          ),
          renderFormRow(
            labels.remark,
            React.createElement("textarea", {
              value: remarkText,
              placeholder: t("Add notes for this task"),
              style: remarkTextareaStyle,
              onChange: (event: Event) => {
                setRemarkText((event.target as HTMLTextAreaElement).value)
              },
            }),
          ),
        ),
        renderSection(
          renderTimeField("start", labels.startTime, startTimeValue, setStartTimeValue),
          renderTimeField("end", labels.endTime, endTimeValue, setEndTimeValue),
          renderScoreField(
            labels.importance,
            importanceValue,
            importanceText,
            setImportanceValue,
            setImportanceText,
          ),
          renderScoreField(
            labels.urgency,
            urgencyValue,
            urgencyText,
            setUrgencyValue,
            setUrgencyText,
          ),
          renderScoreField(
            labels.effort,
            effortValue,
            effortText,
            setEffortValue,
            setEffortText,
          ),
        ),
        renderSection(
          renderFormRow(
            labels.repeatRule,
            React.createElement(Select, {
              selected: [repeatModeValue],
              options: repeatModeOptions,
              onChange: (selected: string[]) => {
                updateRepeatEditor({
                  mode: (selected[0] ?? "none") as RepeatMode,
                })
              },
              menuContainer: popupMenuContainerRef,
              width: "100%",
            }),
          ),
          repeatModeValue !== "none"
            ? renderFormRow(
                t("Repeat every"),
                React.createElement(
                  "div",
                  {
                    style: inlineDualControlLayoutStyle,
                  },
                  React.createElement(Input, {
                    value: repeatIntervalText,
                    placeholder: "1",
                    onChange: (event: Event) => {
                      updateRepeatEditor({
                        intervalText: (event.target as HTMLInputElement).value,
                      })
                    },
                  }),
                  React.createElement(
                    "span",
                    {
                      style: hintTextStyle,
                    },
                    repeatModeValue === "day"
                      ? t("day(s)")
                      : repeatModeValue === "week"
                        ? t("week(s)")
                        : t("month(s)"),
                  ),
                ),
              )
            : null,
          repeatModeValue === "week"
            ? renderFormRow(
                t("Repeat weekday"),
                React.createElement(Select, {
                  selected: [repeatWeekdayValue],
                  options: repeatWeekdayOptions,
                  onChange: (selected: string[]) => {
                    updateRepeatEditor({
                      weekdayValue: selected[0] ?? "",
                    })
                  },
                  menuContainer: popupMenuContainerRef,
                  width: "100%",
                }),
              )
            : null,
          repeatModeValue !== "none"
            ? renderFormRow(
                t("Repeat max count"),
                React.createElement(Input, {
                  value: repeatMaxCountText,
                  placeholder: t("No limit"),
                  onChange: (event: Event) => {
                    updateRepeatEditor({
                      maxCountText: (event.target as HTMLInputElement).value,
                    })
                  },
                }),
              )
            : null,
          repeatModeValue !== "none"
            ? renderTimeField(
                "repeatEnd",
                t("Repeat ends at"),
                repeatEndAtValue,
                (next: Date | null) => {
                  updateRepeatEditor({
                    endAtValue: next,
                  })
                },
              )
            : null,
          !repeatRuleParseable && repeatRuleText.trim() !== ""
            ? renderFormRow(
                t("Repeat rule (raw)"),
                React.createElement(Input, {
                  value: repeatRuleText,
                  onChange: (event: Event) => {
                    setRepeatRuleText((event.target as HTMLInputElement).value)
                    setRepeatRuleParseable(false)
                  },
                }),
              )
            : null,
          !repeatRuleParseable && repeatRuleText.trim() !== ""
            ? React.createElement(
                "div",
                {
                  style: {
                    ...hintTextStyle,
                    marginBottom: "10px",
                  },
                },
                t("Legacy repeat rule detected. Change options above to replace it."),
              )
            : null,
        ),
        renderSection(
          renderFormRow(
            labels.reviewEnabled,
            React.createElement(
              "label",
              {
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--orca-color-text-1, var(--orca-color-text))",
                },
              },
              React.createElement(Checkbox, {
                checked: reviewEnabledValue,
                onChange: ({ checked }: { checked: boolean }) => {
                  setReviewEnabledValue(checked)
                },
              }),
              t("Enable review"),
            ),
          ),
          reviewEnabledValue
            ? renderFormRow(
                labels.reviewType,
                React.createElement(Select, {
                  selected: [reviewTypeValue],
                  options: reviewTypeOptions,
                  onChange: (selected: string[]) => {
                    const nextType = selected[0] === "cycle" ? "cycle" : "single"
                    setReviewTypeValue(nextType)
                  },
                  menuContainer: popupMenuContainerRef,
                  width: "100%",
                }),
              )
            : null,
          reviewEnabledValue && reviewTypeValue === "single"
            ? renderTimeField(
                "nextReview",
                labels.nextReview,
                nextReviewValue,
                setNextReviewValue,
              )
            : null,
          reviewEnabledValue && reviewTypeValue === "cycle"
            ? renderFormRow(
                labels.reviewEvery,
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
                      style: inlineDualControlLayoutStyle,
                    },
                    React.createElement(Select, {
                      selected: [reviewModeValue],
                      options: reviewModeOptions,
                      onChange: (selected: string[]) => {
                        updateReviewEditor({
                          mode: (selected[0] ?? "day") as ReviewMode,
                        })
                      },
                      menuContainer: popupMenuContainerRef,
                      width: "100%",
                    }),
                    React.createElement(
                      "div",
                      {
                        style: {
                          display: "grid",
                          gridTemplateColumns: "74px auto",
                          alignItems: "center",
                          gap: "8px",
                        },
                      },
                      React.createElement(Input, {
                        value: reviewIntervalText,
                        type: "number",
                        min: 1,
                        step: 1,
                        placeholder: "1",
                        onChange: (event: Event) => {
                          const rawValue = (event.target as HTMLInputElement).value
                          updateReviewEditor({
                            intervalText: rawValue.replace(/[^\d]/g, ""),
                          })
                        },
                        onBlur: () => {
                          const parsed = Number(reviewIntervalText)
                          if (reviewIntervalText.trim() === "" || Number.isNaN(parsed) || parsed < 1) {
                            updateReviewEditor({
                              intervalText: "1",
                            })
                          }
                        },
                      }),
                      React.createElement(
                        "span",
                        { style: hintTextStyle },
                        reviewModeValue === "day"
                          ? t("day(s)")
                          : reviewModeValue === "week"
                            ? t("week(s)")
                            : t("month(s)"),
                      ),
                    ),
                  ),
                  React.createElement(
                    "div",
                    {
                      style: hintTextStyle,
                    },
                    t("Enter a positive integer, e.g. 1"),
                  ),
                ),
              )
            : null,
          reviewEnabledValue
            ? renderFormRow(
                labels.lastReviewed,
                React.createElement(
                  "div",
                  {
                    style: {
                      ...readOnlyFieldStyle,
                      fontVariantNumeric: "tabular-nums",
                    },
                  },
                  lastReviewedValue == null
                    ? labels.neverReviewed
                    : lastReviewedValue.toLocaleString(),
                ),
              )
            : null,
        ),
        renderSection(
          renderFormRow(
            labels.dependsOn,
            React.createElement(BlockSelect, {
              mode: "block",
              scope: props.schema.tagAlias,
              selected: dependsOnValues,
              multiSelection: true,
              width: "100%",
              menuContainer: popupMenuContainerRef,
              onChange: (selected: string[]) => {
                const normalized = selected
                  .map((item) => Number(item))
                  .filter((item) => !Number.isNaN(item))
                  .map((item) => getMirrorId(item))
                  .filter((item, index, all) => all.indexOf(item) === index)

                setDependsOnValues(normalized)
                if (normalized.length === 0) {
                  setDependsModeValue("ALL")
                  setDependencyDelayText("")
                }
              },
            }),
          ),
          hasDependencies
            ? renderFormRow(
                labels.dependsMode,
                React.createElement(Select, {
                  selected: [dependsModeValue],
                  options: dependsModeOptions,
                  onChange: (selected: string[]) => {
                    setDependsModeValue(selected[0] ?? "ALL")
                  },
                  menuContainer: popupMenuContainerRef,
                  width: "100%",
                }),
              )
            : null,
          hasDependencies
            ? renderFormRow(
                labels.dependencyDelay,
                React.createElement(
                  "div",
                  {
                    style: inlineDualControlLayoutStyle,
                  },
                  React.createElement(Input, {
                    value: dependencyDelayText,
                    placeholder: t("e.g. 24 hours"),
                    onChange: (event: Event) => {
                      setDependencyDelayText((event.target as HTMLInputElement).value)
                    },
                  }),
                  React.createElement(
                    "span",
                    {
                      style: hintTextStyle,
                    },
                    t("Hours"),
                  ),
                ),
              )
            : null,
        ),
        editingDateField != null
          ? React.createElement(DatePicker, {
              mode: "datetime",
              visible: true,
              value: selectedDateValue ?? new Date(),
              refElement: dateAnchorRef,
              menuContainer: popupMenuContainerRef,
              onChange: (next: Date | [Date, Date]) => {
                if (!(next instanceof Date)) {
                  return
                }
                if (editingDateField === "start") {
                  setStartTimeValue(next)
                } else if (editingDateField === "end") {
                  setEndTimeValue(next)
                } else if (editingDateField === "nextReview") {
                  setNextReviewValue(next)
                } else {
                  updateRepeatEditor({ endAtValue: next })
                }
                setEditingDateField(null)
              },
              onClose: () => setEditingDateField(null),
            })
          : null,
        isCreateMode
          ? React.createElement(
              "div",
              {
                style: {
                  marginTop: "8px",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "8px",
                },
              },
              React.createElement(
                Button,
                {
                  variant: "plain",
                  disabled: saving,
                  onClick: () => props.onClose(),
                },
                labels.cancel,
              ),
              React.createElement(
                Button,
                {
                  variant: "solid",
                  disabled: saving,
                  onClick: () => {
                    void handleSave(currentSnapshot, { closeOnSuccess: true })
                  },
                },
                saving ? t("Saving...") : labels.save,
              ),
            )
          : null,
        errorText.trim() !== ""
          ? React.createElement(
              "div",
              {
                style: {
                  color: "var(--orca-color-text-red)",
                  marginTop: "8px",
                  fontSize: "12px",
                },
              },
              errorText,
            )
          : null,
      ),
    )
}

interface TaskEditorSnapshotInput {
  taskNameText: string
  status: string
  startTime: Date | null
  endTime: Date | null
  reviewEnabled: boolean
  reviewType: TaskReviewType
  nextReview: Date | null
  reviewMode: ReviewMode
  reviewIntervalText: string
  lastReviewed: Date | null
  importanceText: string
  urgencyText: string
  effortText: string
  star: boolean
  repeatRuleText: string
  taskLabels: string[]
  remarkText: string
  dependsOn: DbId[]
  dependsMode: string
  dependencyDelayText: string
  hasDependencies: boolean
}

async function resolveCreateTaskInsertParentId(options: {
  parentBlockId?: DbId
  parentSourceBlockId?: DbId
}): Promise<DbId | null> {
  const parentCandidates = dedupeBlockIds([
    options.parentSourceBlockId,
    options.parentSourceBlockId == null ? null : getMirrorId(options.parentSourceBlockId),
    options.parentBlockId,
    options.parentBlockId == null ? null : getMirrorId(options.parentBlockId),
  ])

  if (parentCandidates.length > 0) {
    return await resolveExistingBlockId(parentCandidates)
  }

  const journalBlock = (await orca.invokeBackend(
    "get-journal-block",
    new Date(),
  )) as Block | null
  if (journalBlock == null) {
    return null
  }

  const journalCandidates = dedupeBlockIds([
    journalBlock.id,
    getMirrorId(journalBlock.id),
  ])
  return await resolveExistingBlockId(journalCandidates, journalBlock.id)
}

async function resolveExistingBlockId(
  ids: DbId[],
  fallback: DbId | null = null,
): Promise<DbId | null> {
  for (const id of ids) {
    if (id == null || Number.isNaN(id)) {
      continue
    }

    if (orca.state.blocks[id] != null) {
      return id
    }

    try {
      const backendBlock = (await orca.invokeBackend("get-block", id)) as Block | null
      if (backendBlock != null) {
        return id
      }
    } catch (error) {
      console.error(error)
    }
  }

  return fallback
}

function dedupeBlockIds(
  ids: Array<DbId | null | undefined>,
): DbId[] {
  return ids
    .filter((id): id is DbId => id != null && !Number.isNaN(id))
    .filter((id, index, all) => all.indexOf(id) === index)
}

function buildEditorSnapshot(input: TaskEditorSnapshotInput): string {
  return JSON.stringify({
    taskNameText: normalizeTaskName(input.taskNameText),
    status: input.status,
    startTime: input.startTime?.getTime() ?? null,
    endTime: input.endTime?.getTime() ?? null,
    reviewEnabled: input.reviewEnabled,
    reviewType: input.reviewType,
    nextReview:
      input.reviewEnabled && input.reviewType === "single"
        ? input.nextReview?.getTime() ?? null
        : null,
    reviewMode: input.reviewEnabled && input.reviewType === "cycle"
      ? input.reviewMode
      : "none",
    reviewIntervalText:
      !input.reviewEnabled || input.reviewType !== "cycle"
      ? ""
      : input.reviewIntervalText.trim(),
    lastReviewed: input.reviewEnabled ? input.lastReviewed?.getTime() ?? null : null,
    importanceText: input.importanceText.trim(),
    urgencyText: input.urgencyText.trim(),
    effortText: input.effortText.trim(),
    star: input.star,
    repeatRuleText: input.repeatRuleText.trim(),
    taskLabels: [...normalizeTaskLabelValues(input.taskLabels)].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })),
    remarkText: input.remarkText,
    dependsOn: [...input.dependsOn].sort((left, right) => left - right),
    dependsMode: input.hasDependencies ? input.dependsMode : "ALL",
    dependencyDelayText: input.hasDependencies ? input.dependencyDelayText.trim() : "",
  })
}

function normalizeTaskName(value: string): string {
  return value.trim()
}

function resolveTaskName(
  block: Block | undefined,
  tagAlias: string,
  isChinese: boolean,
): string {
  const emptyText = t("(Untitled task)")
  if (block == null) {
    return emptyText
  }

  const source = typeof block.text === "string" ? block.text : ""
  const normalized = stripTaskTagFromText(source, tagAlias)
  if (normalized !== "") {
    return normalized
  }

  if (Array.isArray(block.content) && block.content.length > 0) {
    const contentText = block.content
      .map((fragment) => (typeof fragment.v === "string" ? fragment.v : ""))
      .join("")
    const normalizedContent = stripTaskTagFromText(contentText, tagAlias)
    if (normalizedContent !== "") {
      return normalizedContent
    }
  }

  return emptyText
}

function stripTaskTagFromText(text: string, tagAlias: string): string {
  if (text.trim() === "") {
    return ""
  }

  const escapedAlias = tagAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text
    .replace(
      new RegExp(
        `(^|[\\s,\\uFF0C;\\uFF1B\\u3001])#${escapedAlias}(?=[\\s,\\uFF0C;\\uFF1B\\u3001]|$)`,
        "gi",
      ),
      " ",
    )
    .replace(
      /(^|[\s,\uFF0C;\uFF1B\u3001])#[^\s#,\uFF0C;\uFF1B\u3001]+(?=[\s,\uFF0C;\uFF1B\u3001]|$)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
}

function StarIcon(props: { filled: boolean }) {
  const React = window.React
  return (
    React.createElement(
      "svg",
      {
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: props.filled ? "currentColor" : "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
      },
      React.createElement("path", {
        d: "M12 2.5l2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 17.7 6.2 20.7l1.1-6.6L2.5 9.4l6.6-.9L12 2.5z",
      }),
    )
  )
}

function clampScore(value: number | null): number {
  if (value == null || Number.isNaN(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 100) {
    return 100
  }

  return Math.round(value)
}

function normalizeDependsOnForSelect(
  sourceBlock: Block | undefined,
  dependsOn: DbId[],
  _dependsOnPropertyName: string,
): DbId[] {
  const normalized: DbId[] = []

  for (const value of dependsOn) {
    const matchedRef = sourceBlock?.refs.find((ref) => ref.id === value)
    const targetId = getMirrorId(matchedRef?.to ?? value)
    if (!normalized.includes(targetId)) {
      normalized.push(targetId)
    }
  }

  return normalized
}

async function ensureDependencyRefIds(
  sourceBlockId: DbId,
  targetTaskIds: DbId[],
): Promise<DbId[]> {
  const uniqueTargetIds = targetTaskIds
    .map((item) => getMirrorId(item))
    .filter((item, index, all) => all.indexOf(item) === index)

  const resolvedRefIds: DbId[] = []
  for (const targetTaskId of uniqueTargetIds) {
    const sourceBlock = orca.state.blocks[sourceBlockId]
    const existingRefId = sourceBlock?.refs.find((ref) => {
      return ref.type === REF_DATA_TYPE && getMirrorId(ref.to) === targetTaskId
    })?.id

    if (existingRefId != null) {
      resolvedRefIds.push(existingRefId)
      continue
    }

    const createdRefId = (await orca.commands.invokeEditorCommand(
      "core.editor.createRef",
      null,
      sourceBlockId,
      targetTaskId,
      REF_DATA_TYPE,
    )) as DbId
    resolvedRefIds.push(createdRefId)
  }

  return resolvedRefIds
}

function normalizeTaskLabelValues(labels: string[]): string[] {
  const normalizedLabels: string[] = []
  const seen = new Set<string>()

  for (const rawLabel of labels) {
    const label = rawLabel.replace(/\s+/g, " ").trim()
    if (label === "") {
      continue
    }

    const dedupKey = label.toLowerCase()
    if (seen.has(dedupKey)) {
      continue
    }

    seen.add(dedupKey)
    normalizedLabels.push(label)
  }

  return normalizedLabels
}

function collectTaskLabelValuesFromBlockTags(
  block: Block | null | undefined,
  taskTagAlias: string,
): string[] {
  if (block == null) {
    return []
  }

  const taskTagAliasLower = taskTagAlias.toLowerCase()
  const labels = block.refs
    .filter((ref) => ref.type === TAG_REF_TYPE)
    .map((ref) => (typeof ref.alias === "string" ? ref.alias : ""))
    .filter((alias) => alias.trim() !== "")
    .filter((alias) => alias.toLowerCase() !== taskTagAliasLower)

  return normalizeTaskLabelValues(labels)
}

function buildTaskLabelSelectOptions(
  optionValues: string[],
  selectedValues: string[],
  filterKeyword: string = "",
): { value: string; label: string; group?: string }[] {
  const mergedValues = mergeTaskLabelValues(optionValues, selectedValues)
  const normalizedKeyword = filterKeyword.replace(/\s+/g, " ").trim()
  const keywordLower = normalizedKeyword.toLowerCase()

  const filteredValues = normalizedKeyword === ""
    ? mergedValues
    : mergedValues.filter((value) => value.toLowerCase().includes(keywordLower))

  const options = filteredValues.map((value) => ({
    value,
    label: value,
  }))

  if (
    normalizedKeyword !== "" &&
    !mergedValues.some((value) => value.toLowerCase() === keywordLower)
  ) {
    options.unshift({
      value: normalizedKeyword,
      label: `${normalizedKeyword} (${t("Add")})`,
    })
  }

  return options
}

function mergeTaskLabelValues(...sources: (string[] | undefined)[]): string[] {
  const merged: string[] = []
  for (const source of sources) {
    if (source == null) {
      continue
    }
    merged.push(...source)
  }

  return normalizeTaskLabelValues(merged)
}

function readTaskLabelChoiceValues(property: BlockProperty | undefined): string[] {
  const rawChoices = property?.typeArgs?.choices
  if (!Array.isArray(rawChoices)) {
    return []
  }

  return normalizeTaskLabelValues(
    rawChoices.map((item) => {
      if (typeof item === "string") {
        return item
      }
      if (isRecord(item) && typeof item.n === "string") {
        return item.n
      }
      if (isRecord(item) && typeof item.value === "string") {
        return item.value
      }
      return ""
    }),
  )
}

async function getTaskLabelChoicesFromSchema(
  schema: TaskSchemaDefinition,
): Promise<string[]> {
  try {
    const taskTagBlock = (await orca.invokeBackend(
      "get-block-by-alias",
      schema.tagAlias,
    )) as Block | null
    if (taskTagBlock == null) {
      return []
    }

    const property = taskTagBlock.properties.find((item) => {
      return item.name === schema.propertyNames.labels
    })
    return readTaskLabelChoiceValues(property)
  } catch (error) {
    console.error(error)
    return []
  }
}

async function ensureTaskLabelChoices(
  schema: TaskSchemaDefinition,
  labels: string[],
): Promise<void> {
  const requiredChoices = normalizeTaskLabelValues(labels)
  if (requiredChoices.length === 0) {
    return
  }

  const taskTagBlock = (await orca.invokeBackend(
    "get-block-by-alias",
    schema.tagAlias,
  )) as Block | null
  if (taskTagBlock == null) {
    return
  }

  const properties = taskTagBlock.properties ?? []
  const labelsProperty = properties.find((item) => item.name === schema.propertyNames.labels)
  const existingChoices = readTaskLabelChoiceValues(labelsProperty)
  const mergedChoices = mergeTaskLabelValues(existingChoices, requiredChoices)
  if (mergedChoices.length === existingChoices.length) {
    return
  }

  const nextProperties: BlockProperty[] = properties.map((property) => {
    if (property.name !== schema.propertyNames.labels) {
      return property
    }

    const baseTypeArgs = isRecord(property.typeArgs) ? property.typeArgs : {}
    return {
      ...property,
      type: TEXT_CHOICES_PROP_TYPE,
      typeArgs: {
        ...baseTypeArgs,
        subType: "multi",
        choices: mergedChoices,
      },
    }
  })

  if (labelsProperty == null) {
    nextProperties.push({
      name: schema.propertyNames.labels,
      type: TEXT_CHOICES_PROP_TYPE,
      typeArgs: {
        subType: "multi",
        choices: mergedChoices,
      },
    })
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [taskTagBlock.id],
    nextProperties,
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function toScoreInRange(value: number | null): number | null {
  if (value == null) {
    return null
  }
  if (value < 0 || value > 100) {
    return null
  }

  return Math.round(value)
}



