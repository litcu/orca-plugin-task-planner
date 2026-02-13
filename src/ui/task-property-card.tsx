import type { Block, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { getMirrorId } from "../core/block-utils"
import {
  buildTaskFieldLabels,
  getTaskPropertiesFromRef,
  toRefDataForSave,
  validateNumericField,
} from "../core/task-properties"
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
interface TaskPropertyPanelCardProps {
  blockId: DbId
  schema: TaskSchemaDefinition
  onClose: () => void
}

const TAG_REF_TYPE = 2
const REF_DATA_TYPE = 3

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
    return getTaskPropertiesFromRef(taskRef?.data, props.schema)
  }, [props.schema, taskRef])
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
  const initialRepeatEditor = React.useMemo(() => {
    return parseRepeatRuleToEditorState(initialValues.repeatRule)
  }, [initialValues.repeatRule])

  const [statusValue, setStatusValue] = React.useState(initialValues.status)
  const [startTimeValue, setStartTimeValue] = React.useState<Date | null>(
    initialValues.startTime,
  )
  const [endTimeValue, setEndTimeValue] = React.useState<Date | null>(
    initialValues.endTime,
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
    "start" | "end" | "repeatEnd" | null
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
  const selectedDateValue =
    editingDateField === "start"
      ? startTimeValue
      : editingDateField === "end"
        ? endTimeValue
        : editingDateField === "repeatEnd"
          ? repeatEndAtValue
        : null
  const initialSnapshot = React.useMemo(() => {
    return buildEditorSnapshot({
      status: initialValues.status,
      startTime: initialValues.startTime,
      endTime: initialValues.endTime,
      importanceText: initialValues.importance == null ? "" : String(initialValues.importance),
      urgencyText: initialValues.urgency == null ? "" : String(initialValues.urgency),
      effortText: initialValues.effort == null ? "" : String(initialValues.effort),
      star: initialValues.star,
      repeatRuleText: initialValues.repeatRule,
      dependsOn: initialDependsOnForEditor,
      dependsMode: initialValues.dependsMode,
      dependencyDelayText:
        initialValues.dependencyDelay == null ? "" : String(initialValues.dependencyDelay),
      hasDependencies: initialDependsOnForEditor.length > 0,
    })
  }, [
    initialDependsOnForEditor,
    initialValues.dependencyDelay,
    initialValues.dependsMode,
    initialValues.endTime,
    initialValues.effort,
    initialValues.importance,
    initialValues.repeatRule,
    initialValues.startTime,
    initialValues.star,
    initialValues.status,
    initialValues.urgency,
  ])
  const currentSnapshot = React.useMemo(() => {
    return buildEditorSnapshot({
      status: statusValue,
      startTime: startTimeValue,
      endTime: endTimeValue,
      importanceText,
      urgencyText,
      effortText,
      star: starValue,
      repeatRuleText,
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
    repeatRuleText,
    startTimeValue,
    starValue,
    statusValue,
    urgencyText,
  ])

  React.useEffect(() => {
    setStatusValue(initialValues.status)
    setStartTimeValue(initialValues.startTime)
    setEndTimeValue(initialValues.endTime)
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
    setRepeatModeValue(initialRepeatEditor.mode)
    setRepeatIntervalText(initialRepeatEditor.intervalText)
    setRepeatWeekdayValue(initialRepeatEditor.weekdayValue)
    setRepeatMaxCountText(initialRepeatEditor.maxCountText)
    setRepeatEndAtValue(initialRepeatEditor.endAtValue)
    setRepeatOccurrence(initialRepeatEditor.occurrence)
    setRepeatRuleParseable(initialRepeatEditor.parseable)
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
    initialSnapshot,
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
      const dependencyRefIds = await ensureDependencyRefIds(sourceBlockId, dependsOnValues)
      const previousValues = getTaskPropertiesFromRef(taskRef.data, props.schema)
      const valuesToSave = {
        status: statusValue,
        startTime: startTimeValue,
        endTime: endTimeValue,
        importance: importanceInRange,
        urgency: urgencyInRange,
        effort: effortInRange,
        star: starValue,
        repeatRule: repeatRuleText,
        dependsOn: dependencyRefIds,
        dependsMode: hasDependencies ? dependsModeValue : "ALL",
        dependencyDelay: hasDependencies ? dependencyDelay.value : null,
      }
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
      await createRecurringTaskInTodayJournal(
        previousValues.status,
        valuesToSave,
        sourceBlockId,
        props.schema,
      )
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

  const rowLabelWidth = isChinese ? "88px" : "110px"
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: `${rowLabelWidth} minmax(0, 1fr)`,
    columnGap: "10px",
    alignItems: "center",
    marginBottom: "8px",
  }
  const rowLabelStyle = {
    fontSize: "12px",
    color: "var(--orca-color-text-2)",
    lineHeight: "30px",
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
    key: "start" | "end" | "repeatEnd",
    label: string,
    value: Date | null,
    setValue: (next: Date | null) => void,
  ) => {
    return renderFormRow(
      label,
      React.createElement(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto auto",
            gap: "6px",
            alignItems: "center",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minHeight: "30px",
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              border: "1px solid var(--orca-color-border-1)",
              borderRadius: "6px",
              background: "var(--orca-color-bg-2)",
              color: "var(--orca-color-text-1)",
              fontSize: "12px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          value == null ? (t("Not set")) : value.toLocaleString(),
        ),
        React.createElement(
          Button,
          {
            variant: "outline",
            style: { minWidth: "60px" },
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
            style: { minWidth: "60px" },
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
          },
        },
        React.createElement("input", {
          type: "range",
          min: 0,
          max: 100,
          step: 1,
          value,
          style: { width: "100%", margin: 0 },
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
    padding: "0 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
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
  return React.createElement(
    "div",
    {
      style: {
        minHeight: 0,
        height: "100%",
        overflow: "auto",
        border: "1px solid var(--orca-color-border)",
        borderRadius: "8px",
        background: "var(--orca-color-bg-2)",
        padding: "10px",
        boxSizing: "border-box",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "10px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              fontSize: "14px",
              fontWeight: 600,
            },
          },
          labels.title,
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => setStarValue((prev: boolean) => !prev),
            title: starValue ? t("Starred") : t("Not starred"),
            style: {
              width: "24px",
              height: "24px",
              padding: 0,
              border: "none",
              background: "transparent",
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
      React.createElement(
        Button,
        {
          variant: "plain",
          title: t("Close property panel"),
          onClick: props.onClose,
        },
        React.createElement("i", {
          className: "ti ti-x",
          style: { fontSize: "16px" },
        }),
      ),
    ),
    renderFormRow(
      t("Activation"),
      React.createElement("span", { style: activationBadgeStyle }, activationBadgeText),
    ),
    renderFormRow(
      t("Task name"),
      React.createElement(
        "div",
        {
          style: {
            minHeight: "30px",
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            border: "1px solid var(--orca-color-border-1)",
            borderRadius: "6px",
            background: "var(--orca-color-bg-2)",
            color: "var(--orca-color-text-1)",
            fontSize: "12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        taskName,
      ),
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
              style: {
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: "8px",
                alignItems: "center",
              },
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
                style: {
                  fontSize: "11px",
                  color: "var(--orca-color-text-2)",
                  whiteSpace: "nowrap",
                },
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
              color: "var(--orca-color-text-2)",
              marginTop: "2px",
              marginBottom: "8px",
              fontSize: "11px",
            },
          },
          t("Legacy repeat rule detected. Change options above to replace it."),
        )
      : null,
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
      ? React.createElement(
          React.Fragment,
          null,
          renderFormRow(
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
          ),
          renderFormRow(
            labels.dependencyDelay,
            React.createElement(
              "div",
              {
                style: {
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: "8px",
                  alignItems: "center",
                },
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
                  style: {
                    fontSize: "11px",
                    color: "var(--orca-color-text-2)",
                    whiteSpace: "nowrap",
                  },
                },
                t("Hours"),
              ),
            ),
          ),
        )
      : null,
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
              marginTop: "8px",
              fontSize: "12px",
            },
          },
          errorText,
        )
      : null,
  )
}

interface TaskEditorSnapshotInput {
  status: string
  startTime: Date | null
  endTime: Date | null
  importanceText: string
  urgencyText: string
  effortText: string
  star: boolean
  repeatRuleText: string
  dependsOn: DbId[]
  dependsMode: string
  dependencyDelayText: string
  hasDependencies: boolean
}

function buildEditorSnapshot(input: TaskEditorSnapshotInput): string {
  return JSON.stringify({
    status: input.status,
    startTime: input.startTime?.getTime() ?? null,
    endTime: input.endTime?.getTime() ?? null,
    importanceText: input.importanceText.trim(),
    urgencyText: input.urgencyText.trim(),
    effortText: input.effortText.trim(),
    star: input.star,
    repeatRuleText: input.repeatRuleText.trim(),
    dependsOn: [...input.dependsOn].sort((left, right) => left - right),
    dependsMode: input.hasDependencies ? input.dependsMode : "ALL",
    dependencyDelayText: input.hasDependencies ? input.dependencyDelayText.trim() : "",
  })
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

function toScoreInRange(value: number | null): number | null {
  if (value == null) {
    return null
  }
  if (value < 0 || value > 100) {
    return null
  }

  return Math.round(value)
}



