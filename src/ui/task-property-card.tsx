import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
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
interface TaskPropertyPanelCardProps {
  blockId: DbId
  schema: TaskSchemaDefinition
  onClose: () => void
}

const TAG_REF_TYPE = 2
const REF_DATA_TYPE = 3
const TEXT_CHOICES_PROP_TYPE = 6

export function TaskPropertyPanelCard(props: TaskPropertyPanelCardProps) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Select = orca.components.Select
  const DatePicker = orca.components.DatePicker
  const BlockSelect = orca.components.BlockSelect

  const labels = buildTaskFieldLabels(orca.state.locale)
  const isChinese = orca.state.locale === "zh-CN"

  const block =
    orca.state.blocks[getMirrorId(props.blockId)] ?? orca.state.blocks[props.blockId]
  const taskRef = block?.refs.find(
    (ref) => ref.type === TAG_REF_TYPE && ref.alias === props.schema.tagAlias,
  )
  const initialValues = React.useMemo(() => {
    return getTaskPropertiesFromRef(taskRef?.data, props.schema, block)
  }, [block, props.schema, taskRef])
  const initialDependsOnForEditor = React.useMemo(() => {
    return normalizeDependsOnForSelect(
      block,
      initialValues.dependsOn,
      props.schema.propertyNames.dependsOn,
    )
  }, [block, initialValues.dependsOn, props.schema.propertyNames.dependsOn])
  const taskName = React.useMemo(() => {
    return resolveTaskName(block, props.schema.tagAlias, isChinese)
  }, [block, isChinese, props.schema.tagAlias])
  const untitledTaskName = t("(Untitled task)")
  const initialRepeatEditor = React.useMemo(() => {
    return parseRepeatRuleToEditorState(initialValues.repeatRule)
  }, [initialValues.repeatRule])
  const initialReviewEditor = React.useMemo(() => {
    const parsed = parseReviewRuleToEditorState(initialValues.reviewEvery)
    return {
      mode: parsed.mode === "none" ? "day" as ReviewMode : parsed.mode,
      intervalText: parsed.intervalText,
    }
  }, [initialValues.reviewEvery])

  const [taskNameText, setTaskNameText] = React.useState(taskName)
  const [statusValue, setStatusValue] = React.useState(initialValues.status)
  const [startTimeValue, setStartTimeValue] = React.useState<Date | null>(
    initialValues.startTime,
  )
  const [endTimeValue, setEndTimeValue] = React.useState<Date | null>(
    initialValues.endTime,
  )
  const [nextReviewValue, setNextReviewValue] = React.useState<Date | null>(
    initialValues.nextReview,
  )
  const [reviewEnabledValue, setReviewEnabledValue] = React.useState(
    initialValues.reviewEnabled,
  )
  const [reviewTypeValue, setReviewTypeValue] = React.useState<TaskReviewType>(
    initialValues.reviewType,
  )
  const [importanceText, setImportanceText] = React.useState(
    initialValues.importance == null ? "" : String(initialValues.importance),
  )
  const [urgencyText, setUrgencyText] = React.useState(
    initialValues.urgency == null ? "" : String(initialValues.urgency),
  )
  const [effortText, setEffortText] = React.useState(
    initialValues.effort == null ? "" : String(initialValues.effort),
  )
  const [importanceValue, setImportanceValue] = React.useState(
    clampScore(initialValues.importance),
  )
  const [urgencyValue, setUrgencyValue] = React.useState(
    clampScore(initialValues.urgency),
  )
  const [effortValue, setEffortValue] = React.useState(
    clampScore(initialValues.effort),
  )
  const [starValue, setStarValue] = React.useState(initialValues.star)
  const [repeatRuleText, setRepeatRuleText] = React.useState(initialValues.repeatRule)
  const [taskLabelsValue, setTaskLabelsValue] = React.useState<string[]>(
    initialValues.labels,
  )
  const [taskLabelOptions, setTaskLabelOptions] = React.useState<string[]>(
    initialValues.labels,
  )
  const [remarkText, setRemarkText] = React.useState(initialValues.remark)
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
    initialValues.lastReviewed,
  )
  const [dependsOnValues, setDependsOnValues] = React.useState<DbId[]>(
    initialDependsOnForEditor,
  )
  const [dependsModeValue, setDependsModeValue] = React.useState(
    initialValues.dependsMode,
  )
  const [dependencyDelayText, setDependencyDelayText] = React.useState(
    initialValues.dependencyDelay == null
      ? ""
      : String(initialValues.dependencyDelay),
  )
  const [editingDateField, setEditingDateField] = React.useState<
    "start" | "end" | "repeatEnd" | "nextReview" | null
  >(null)
  const [errorText, setErrorText] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [lastSavedSnapshot, setLastSavedSnapshot] = React.useState("")
  const [lastFailedSnapshot, setLastFailedSnapshot] = React.useState<string | null>(
    null,
  )
  const [activationInfo, setActivationInfo] = React.useState<TaskActivationInfo | null>(
    null,
  )
  const [activationLoading, setActivationLoading] = React.useState(true)

  const dateAnchorRef = React.useRef<HTMLButtonElement | null>(null)
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
      status: initialValues.status,
      startTime: initialValues.startTime,
      endTime: initialValues.endTime,
      reviewEnabled: initialValues.reviewEnabled,
      reviewType: initialValues.reviewType,
      nextReview: initialValues.nextReview,
      reviewMode: initialReviewEditor.mode,
      reviewIntervalText: initialReviewEditor.intervalText,
      lastReviewed: initialValues.lastReviewed,
      importanceText: initialValues.importance == null ? "" : String(initialValues.importance),
      urgencyText: initialValues.urgency == null ? "" : String(initialValues.urgency),
      effortText: initialValues.effort == null ? "" : String(initialValues.effort),
      star: initialValues.star,
      repeatRuleText: initialValues.repeatRule,
      taskLabels: initialValues.labels,
      remarkText: initialValues.remark,
      dependsOn: initialDependsOnForEditor,
      dependsMode: initialValues.dependsMode,
      dependencyDelayText:
        initialValues.dependencyDelay == null ? "" : String(initialValues.dependencyDelay),
      hasDependencies: initialDependsOnForEditor.length > 0,
    })
  }, [
    initialDependsOnForEditor,
    taskName,
    initialValues.dependencyDelay,
    initialValues.dependsMode,
    initialValues.endTime,
    initialValues.effort,
    initialValues.importance,
    initialValues.lastReviewed,
    initialValues.labels,
    initialValues.nextReview,
    initialValues.reviewEnabled,
    initialValues.reviewType,
    initialValues.remark,
    initialValues.repeatRule,
    initialValues.startTime,
    initialValues.star,
    initialValues.status,
    initialValues.urgency,
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
    setStatusValue(initialValues.status)
    setStartTimeValue(initialValues.startTime)
    setEndTimeValue(initialValues.endTime)
    setNextReviewValue(initialValues.nextReview)
    setReviewEnabledValue(initialValues.reviewEnabled)
    setReviewTypeValue(initialValues.reviewType)
    setImportanceText(
      initialValues.importance == null ? "" : String(initialValues.importance),
    )
    setUrgencyText(initialValues.urgency == null ? "" : String(initialValues.urgency))
    setEffortText(initialValues.effort == null ? "" : String(initialValues.effort))
    setImportanceValue(clampScore(initialValues.importance))
    setUrgencyValue(clampScore(initialValues.urgency))
    setEffortValue(clampScore(initialValues.effort))
    setStarValue(initialValues.star)
    setRepeatRuleText(initialValues.repeatRule)
    setTaskLabelsValue(initialValues.labels)
    setTaskLabelOptions(initialValues.labels)
    setRemarkText(initialValues.remark)
    setRepeatModeValue(initialRepeatEditor.mode)
    setRepeatIntervalText(initialRepeatEditor.intervalText)
    setRepeatWeekdayValue(initialRepeatEditor.weekdayValue)
    setRepeatMaxCountText(initialRepeatEditor.maxCountText)
    setRepeatEndAtValue(initialRepeatEditor.endAtValue)
    setRepeatOccurrence(initialRepeatEditor.occurrence)
    setRepeatRuleParseable(initialRepeatEditor.parseable)
    setReviewModeValue(initialReviewEditor.mode)
    setReviewIntervalText(initialReviewEditor.intervalText)
    setLastReviewedValue(initialValues.lastReviewed)
    setDependsOnValues(initialDependsOnForEditor)
    setDependsModeValue(initialValues.dependsMode)
    setDependencyDelayText(
      initialValues.dependencyDelay == null
        ? ""
        : String(initialValues.dependencyDelay),
    )
    setEditingDateField(null)
    setErrorText("")
    setSaving(false)
    setLastSavedSnapshot(initialSnapshot)
    setLastFailedSnapshot(null)
  }, [
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
    initialValues,
    props.blockId,
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
  }, [props.blockId, props.schema])

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
        mergeTaskLabelValues(prev, choices, initialValues.labels))
    }

    void loadTaskLabelOptions()
    return () => {
      disposed = true
    }
  }, [
    initialValues.labels,
    props.blockId,
    props.schema,
  ])

  const handleSave = async (snapshot: string) => {
    if (taskRef == null) {
      const message = t("Task ref not found")
      setErrorText(message)
      orca.notify("error", message)
      setLastFailedSnapshot(snapshot)
      return
    }

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
      const sourceBlockId = getMirrorId(props.blockId)
      const normalizedTaskName = normalizeTaskName(taskNameText)
      const currentTaskName = normalizeTaskName(taskName)
      if (normalizedTaskName !== currentTaskName) {
        await orca.commands.invokeEditorCommand(
          "core.editor.setBlocksContent",
          null,
          [{
            id: sourceBlockId,
            content: [{
              t: "t",
              v: normalizedTaskName === "" ? untitledTaskName : normalizedTaskName,
            }],
          }],
          false,
        )
      }
      const dependencyRefIds = await ensureDependencyRefIds(sourceBlockId, dependsOnValues)
      const normalizedTaskLabels = normalizeTaskLabelValues(taskLabelsValue)
      await ensureTaskLabelChoices(props.schema, normalizedTaskLabels)
      const sourceTaskBlock = orca.state.blocks[sourceBlockId] ?? block ?? null
      const previousValues = getTaskPropertiesFromRef(
        taskRef.data,
        props.schema,
        sourceTaskBlock,
      )
      const reviewEvery = reviewEnabledValue && reviewTypeValue === "cycle"
        ? buildReviewRuleFromEditorState({
            mode: reviewModeValue,
            intervalText: reviewIntervalText,
          })
        : ""
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
        previousValues.status,
        valuesToSave,
        sourceBlockId,
        props.schema,
      )
      invalidateNextActionEvaluationCache()
      setLastSavedSnapshot(snapshot)
      setLastFailedSnapshot(null)
      void refreshActivationInfo()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("Save failed")
      setErrorText(message)
      orca.notify("error", message)
      setLastFailedSnapshot(snapshot)
    } finally {
      setSaving(false)
    }
  }

  React.useEffect(() => {
    if (taskRef == null) {
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
  }, [currentSnapshot, lastFailedSnapshot, lastSavedSnapshot, saving, taskRef])

  React.useEffect(() => {
    ensureTaskPropertyPanelStyles()
  }, [])

  const rowLabelWidth = isChinese ? "88px" : "110px"
  const panelBorderColor = "var(--orca-color-border-1, var(--orca-color-border))"
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: `${rowLabelWidth} minmax(0, 1fr)`,
    columnGap: "12px",
    alignItems: "start",
    marginBottom: "8px",
  }
  const rowLabelStyle = {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--orca-color-text-2)",
    letterSpacing: "0.01em",
    lineHeight: "32px",
  }
  const controlWrapStyle = {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
  }
  const readOnlyFieldStyle = {
    minHeight: "32px",
    display: "flex",
    alignItems: "center",
    padding: "0 11px",
    border: `1px solid ${panelBorderColor}`,
    borderRadius: "8px",
    background: "var(--orca-color-bg-1)",
    color: "var(--orca-color-text-1, var(--orca-color-text))",
    fontSize: "12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }
  const hintTextStyle = {
    fontSize: "11px",
    color: "var(--orca-color-text-2)",
    whiteSpace: "nowrap" as const,
    letterSpacing: "0.01em",
  }
  const remarkTextareaStyle = {
    width: "100%",
    minHeight: "68px",
    border: `1px solid ${panelBorderColor}`,
    borderRadius: "8px",
    background: "var(--orca-color-bg-1)",
    color: "var(--orca-color-text-1, var(--orca-color-text))",
    fontSize: "12px",
    lineHeight: 1.5,
    padding: "7px 10px",
    resize: "vertical" as const,
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
  }
  const sectionStyle = {
    border: `1px solid ${panelBorderColor}`,
    borderRadius: "10px",
    background: "var(--orca-color-bg-2)",
    padding: "10px 10px 2px",
    boxSizing: "border-box" as const,
  }
  const inlineTimeFieldLayoutStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: "7px",
    alignItems: "center",
    width: "100%",
  }
  const inlineDualControlLayoutStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "8px",
    alignItems: "center",
    width: "100%",
  }
  const renderSection = (...children: unknown[]) => {
    return React.createElement(
      "section",
      {
        style: sectionStyle,
      },
      ...children,
    )
  }
  const renderFormRow = (label: string, control: unknown) => {
    return React.createElement(
      "div",
      { style: rowStyle },
      React.createElement("div", { style: rowLabelStyle }, label),
      React.createElement("div", { style: controlWrapStyle }, control),
    )
  }

  const renderTimeField = (
    key: "start" | "end" | "repeatEnd" | "nextReview",
    label: string,
    value: Date | null,
    setValue: (next: Date | null) => void,
  ) => {
    return renderFormRow(
      label,
      React.createElement(
        "div",
        {
          style: inlineTimeFieldLayoutStyle,
        },
        React.createElement(
          "div",
          {
            style: {
              ...readOnlyFieldStyle,
              fontVariantNumeric: "tabular-nums",
            },
          },
          value == null ? (t("Not set")) : value.toLocaleString(),
        ),
        React.createElement(
          Button,
          {
            variant: "outline",
            style: { minWidth: "64px", height: "32px", borderRadius: "8px" },
            onClick: (event: MouseEvent) => {
              dateAnchorRef.current = event.currentTarget as HTMLButtonElement
              setEditingDateField(key)
            },
          },
          t("Pick"),
        ),
        React.createElement(
          Button,
          {
            variant: "plain",
            style: { minWidth: "64px", height: "32px", borderRadius: "8px" },
            onClick: () => setValue(null),
          },
          t("Clear"),
        ),
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
            width: "100%",
          },
        },
        React.createElement("input", {
          className: "mlo-score-range",
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
    minHeight: "22px",
    padding: "0 9px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.01em",
    border: `1px solid ${panelBorderColor}`,
    color:
      activationLoading || activationInfo == null
        ? "var(--orca-color-text-2)"
        : activationInfo.isActive
          ? "var(--orca-color-text-green)"
          : "var(--orca-color-text-yellow)",
    background:
      activationLoading || activationInfo == null
        ? "rgba(148, 163, 184, 0.14)"
        : activationInfo.isActive
          ? "rgba(56, 161, 105, 0.16)"
          : "rgba(183, 121, 31, 0.16)",
  }
  const outerPanelStyle = {
    minHeight: 0,
    height: "100%",
    overflow: "auto",
    border: `1px solid ${panelBorderColor}`,
    borderRadius: "12px",
    background:
      "radial-gradient(circle at 94% 6%, rgba(37, 99, 235, 0.13), transparent 40%), linear-gradient(165deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
    boxShadow: "0 10px 22px rgba(15, 23, 42, 0.1)",
    padding: "10px",
    boxSizing: "border-box" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    fontFamily: "\"Avenir Next\", \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
  }
  const headerRowStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "0 2px 8px",
    borderBottom: `1px solid ${panelBorderColor}`,
  }
  const titleStyle = {
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: "0.01em",
    color: "var(--orca-color-text-1, var(--orca-color-text))",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  }
  const iconButtonStyle = {
    width: "26px",
    height: "26px",
    padding: 0,
    border: `1px solid ${panelBorderColor}`,
    borderRadius: "7px",
    background: "rgba(15, 23, 42, 0.03)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  }
  return React.createElement(
    "div",
    {
      style: outerPanelStyle,
    },
    React.createElement(
      "div",
      {
        style: headerRowStyle,
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0,
            flex: 1,
            flexWrap: "wrap",
          },
        },
        React.createElement(
          "div",
          { style: titleStyle, title: displayTaskName },
          displayTaskName,
        ),
        React.createElement("span", { style: activationBadgeStyle }, activationBadgeText),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => setStarValue((prev: boolean) => !prev),
            title: starValue ? t("Starred") : t("Not starred"),
            style: {
              ...iconButtonStyle,
              background: starValue
                ? "rgba(214, 158, 46, 0.16)"
                : "rgba(15, 23, 42, 0.03)",
              color: starValue
                ? "var(--orca-color-text-yellow, #d69e2e)"
                : "var(--orca-color-text-2)",
            },
          },
          React.createElement(StarIcon, { filled: starValue }),
        ),
      ),
      React.createElement(Button, {
        variant: "plain",
        title: t("Close property panel"),
        onClick: props.onClose,
        style: {
          ...iconButtonStyle,
          color: "var(--orca-color-text-2)",
        },
      }, React.createElement("i", {
        className: "ti ti-x",
        style: { fontSize: "16px", lineHeight: 1 },
      })),
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
          React.createElement("input", {
            type: "checkbox",
            checked: reviewEnabledValue,
            onChange: (event: Event) => {
              const checked = (event.target as HTMLInputElement).checked
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
              lastReviewedValue == null ? labels.neverReviewed : lastReviewedValue.toLocaleString(),
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
    errorText.trim() !== ""
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-red)",
              border: "1px solid rgba(197, 48, 48, 0.28)",
              background: "rgba(197, 48, 48, 0.1)",
              borderRadius: "10px",
              fontSize: "12px",
              padding: "8px 10px",
            },
          },
          errorText,
        )
      : null,
  )
}

function ensureTaskPropertyPanelStyles() {
  const styleId = "mlo-task-property-panel-style"
  if (document.getElementById(styleId) != null) {
    return
  }

  const styleEl = document.createElement("style")
  styleEl.id = styleId
  styleEl.textContent = `
.mlo-score-range {
  appearance: none;
  height: 3px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.35);
  outline: none;
}

.mlo-score-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.2), 0 2px 5px rgba(15, 23, 42, 0.22);
  background: var(--orca-color-text-blue, #2563eb);
}

.mlo-score-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.2), 0 2px 5px rgba(15, 23, 42, 0.22);
  background: var(--orca-color-text-blue, #2563eb);
}
`

  document.head.appendChild(styleEl)
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

  const taskText = typeof block.text === "string" ? block.text : ""
  const normalized = stripTaskTagFromText(taskText, tagAlias)
  if (normalized !== "") {
    return normalized
  }

  const contentText = block.content
    ?.map((fragment) => (typeof fragment.v === "string" ? fragment.v : ""))
    .join("") ?? ""
  const normalizedContent = stripTaskTagFromText(contentText, tagAlias)
  return normalizedContent === "" ? emptyText : normalizedContent
}

function stripTaskTagFromText(text: string, tagAlias: string): string {
  if (text.trim() === "") {
    return ""
  }

  const escapedAlias = tagAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text
    .replace(
      new RegExp(`(^|[\\s,\\uFF0C;\\uFF1B\\u3001])#${escapedAlias}(?=[\\s,\\uFF0C;\\uFF1B\\u3001]|$)`, "gi"),
      " ",
    )
    .replace(/(^|[\s,\uFF0C;\uFF1B\u3001])#[^\s#,\uFF0C;\uFF1B\u3001]+(?=[\s,\uFF0C;\uFF1B\u3001]|$)/g, " ")
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



