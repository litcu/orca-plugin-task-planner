import type { DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  buildTaskFieldLabels,
  getTaskPropertiesFromRef,
  toRefDataForSave,
  validateNumericField,
} from "../core/task-properties"

type PopupTriggerSource = "tag-click" | "tag-menu"

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
  blockId: DbId
  schema: TaskSchemaDefinition
  triggerSource: PopupTriggerSource
}

const popupState: PopupState = {
  root: null,
  containerEl: null,
  options: null,
  visible: false,
}

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
  blockId: DbId
  schema: TaskSchemaDefinition
  visible: boolean
  onClose: () => void
  onDispose: () => void
}) {
  const React = window.React
  const Button = orca.components.Button
  const Input = orca.components.Input
  const Select = orca.components.Select
  const DatePicker = orca.components.DatePicker
  const BlockSelect = orca.components.BlockSelect
  const ModalOverlay = orca.components.ModalOverlay

  const labels = buildTaskFieldLabels(orca.state.locale)
  const isChinese = orca.state.locale === "zh-CN"

  const block = orca.state.blocks[props.blockId]
  const taskRef = block?.refs.find(
    (ref) => ref.type === 2 && ref.alias === props.schema.tagAlias,
  )
  const initialValues = React.useMemo(() => {
    return getTaskPropertiesFromRef(taskRef?.data, props.schema)
  }, [taskRef, props.schema])

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
  const [dependsOnValues, setDependsOnValues] = React.useState<DbId[]>(
    initialValues.dependsOn,
  )
  const [dependsModeValue, setDependsModeValue] = React.useState(
    initialValues.dependsMode,
  )
  const [dependencyDelayText, setDependencyDelayText] = React.useState(
    initialValues.dependencyDelay == null
      ? ""
      : String(initialValues.dependencyDelay),
  )
  const [errorText, setErrorText] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const [importanceValue, setImportanceValue] = React.useState(
    clampScore(initialValues.importance),
  )
  const [urgencyValue, setUrgencyValue] = React.useState(
    clampScore(initialValues.urgency),
  )

  const [editingDateField, setEditingDateField] = React.useState<
    "start" | "end" | null
  >(null)
  const dateAnchorRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    setStatusValue(initialValues.status)
    setStartTimeValue(initialValues.startTime)
    setEndTimeValue(initialValues.endTime)
    setImportanceText(
      initialValues.importance == null ? "" : String(initialValues.importance),
    )
    setUrgencyText(initialValues.urgency == null ? "" : String(initialValues.urgency))
    setImportanceValue(clampScore(initialValues.importance))
    setUrgencyValue(clampScore(initialValues.urgency))
    setDependsOnValues(initialValues.dependsOn)
    setDependsModeValue(initialValues.dependsMode)
    setDependencyDelayText(
      initialValues.dependencyDelay == null
        ? ""
        : String(initialValues.dependencyDelay),
    )
    setErrorText("")
    setEditingDateField(null)
  }, [props.blockId, initialValues])

  const statusOptions = props.schema.statusChoices.map((item) => ({
    value: item,
    label: item,
  }))
  const dependsModeOptions = props.schema.dependencyModeChoices.map((item) => ({
    value: item,
    label: item,
  }))

  const handleSave = async () => {
    if (taskRef == null) {
      setErrorText(isChinese ? "未找到任务标签引用，无法保存" : "Task ref not found")
      return
    }

    const importance = validateNumericField(labels.importance, importanceText, isChinese)
    if (importance.error != null) {
      setErrorText(importance.error)
      return
    }

    const urgency = validateNumericField(labels.urgency, urgencyText, isChinese)
    if (urgency.error != null) {
      setErrorText(urgency.error)
      return
    }

    const dependencyDelay = validateNumericField(
      labels.dependencyDelay,
      dependencyDelayText,
      isChinese,
    )
    if (dependencyDelay.error != null) {
      setErrorText(dependencyDelay.error)
      return
    }

    const importanceInRange = toScoreInRange(importance.value)
    if (importanceInRange == null && importance.value != null) {
      setErrorText(isChinese ? "重要性必须在 0-100 之间" : "Importance must be 0-100")
      return
    }

    const urgencyInRange = toScoreInRange(urgency.value)
    if (urgencyInRange == null && urgency.value != null) {
      setErrorText(isChinese ? "紧急度必须在 0-100 之间" : "Urgency must be 0-100")
      return
    }

    setSaving(true)
    setErrorText("")

    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        taskRef,
        toRefDataForSave(
          {
            status: statusValue,
            startTime: startTimeValue,
            endTime: endTimeValue,
            importance: importanceInRange,
            urgency: urgencyInRange,
            dependsOn: dependsOnValues,
            dependsMode: dependsModeValue,
            dependencyDelay: dependencyDelay.value,
          },
          props.schema,
        ),
      )

      props.onClose()
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : isChinese
            ? "保存失败，请稍后重试"
            : "Save failed",
      )
    } finally {
      setSaving(false)
    }
  }

  const selectedDateValue =
    editingDateField === "start"
      ? startTimeValue
      : editingDateField === "end"
        ? endTimeValue
        : null

  const hasFloatingPicker = editingDateField != null && props.visible

  const renderDateFieldRow = (
    key: "start" | "end",
    label: string,
    value: Date | null,
    setValue: (next: Date | null) => void,
  ) => {
    return React.createElement(
      "div",
      {
        style: { marginBottom: "12px" },
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
        },
      },
      React.createElement(
        "div",
        {
          style: {
            marginBottom: "6px",
            fontSize: "13px",
            color: "var(--orca-color-text-2)",
          },
        },
        label,
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "8px",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              flex: 1,
              minHeight: "32px",
              display: "flex",
              alignItems: "center",
              padding: "0 10px",
              border: "1px solid var(--orca-color-border-1)",
              borderRadius: "6px",
              color: "var(--orca-color-text-1)",
              background: "var(--orca-color-bg-2)",
            },
          },
          value == null
            ? (isChinese ? "未设置" : "Not set")
            : value.toLocaleString(),
        ),
        React.createElement(
          Button,
          {
            variant: "outline",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              dateAnchorRef.current = event.currentTarget as HTMLButtonElement
              setEditingDateField(key)
            },
          },
          isChinese ? "选择" : "Pick",
        ),
        React.createElement(
          Button,
          {
            variant: "plain",
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              setValue(null)
            },
          },
          isChinese ? "清空" : "Clear",
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
    return React.createElement(
      "div",
      { style: { marginBottom: "12px" } },
      React.createElement(
        "div",
        {
          style: {
            marginBottom: "6px",
            fontSize: "13px",
            color: "var(--orca-color-text-2)",
          },
        },
        label,
      ),
      React.createElement("input", {
        type: "range",
        min: 0,
        max: 100,
        step: 1,
        value,
        style: {
          width: "100%",
          marginBottom: "8px",
        },
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement
          const next = Number(target.value)
          if (Number.isNaN(next)) {
            return
          }
          setValue(next)
          setText(String(next))
        },
      }),
      React.createElement(Input, {
        value: text,
        placeholder: isChinese ? "0-100" : "0-100",
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement
          const nextText = target.value
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
    )
  }

  return React.createElement(
    ModalOverlay,
    {
      visible: props.visible,
      blurred: false,
      style: {
        background: "rgba(0, 0, 0, 0.35)",
        backdropFilter: "none",
      },
      canClose: false,
      onClose: () => {
        if (hasFloatingPicker) {
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
        style: {
          width: "min(560px, calc(100vw - 48px))",
          maxHeight: "calc(100vh - 64px)",
          overflow: "auto",
          padding: "20px",
          background: "var(--orca-color-bg-1)",
          border: "1px solid var(--orca-color-border-1)",
          borderRadius: "8px",
          boxShadow: "none",
        },
        onClick: (event: MouseEvent) => {
          event.stopPropagation()
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontSize: "18px",
            fontWeight: 600,
            marginBottom: "16px",
          },
        },
        labels.title,
      ),
      React.createElement(
        "div",
        { style: { marginBottom: "12px" } },
        React.createElement(
          "div",
          {
            style: {
              marginBottom: "6px",
              fontSize: "13px",
              color: "var(--orca-color-text-2)",
            },
          },
          labels.status,
        ),
        React.createElement(Select, {
          selected: [statusValue],
          options: statusOptions,
          onChange: (selected: string[]) => {
            setStatusValue(selected[0] ?? props.schema.statusChoices[0])
          },
          width: "100%",
        }),
      ),
      renderDateFieldRow("start", labels.startTime, startTimeValue, setStartTimeValue),
      renderDateFieldRow("end", labels.endTime, endTimeValue, setEndTimeValue),
      hasFloatingPicker
        ? React.createElement(DatePicker, {
            mode: "datetime",
            visible: true,
            value: selectedDateValue ?? new Date(),
            refElement: { current: dateAnchorRef.current },
            onChange: (next: Date | [Date, Date]) => {
              if (!(next instanceof Date)) {
                return
              }

              if (editingDateField === "start") {
                setStartTimeValue(next)
              } else {
                setEndTimeValue(next)
              }
            },
            onClose: () => setEditingDateField(null),
          })
        : null,
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
      React.createElement(
        "div",
        { style: { marginBottom: "12px" } },
        React.createElement(
          "div",
          {
            style: {
              marginBottom: "6px",
              fontSize: "13px",
              color: "var(--orca-color-text-2)",
            },
          },
          labels.dependsOn,
        ),
        React.createElement(BlockSelect, {
          mode: "ref",
          selected: dependsOnValues,
          onChange: (selected: string[]) => {
            setDependsOnValues(
              selected
                .map((item) => Number(item))
                .filter((item) => !Number.isNaN(item)),
            )
          },
        }),
      ),
      React.createElement(
        "div",
        { style: { marginBottom: "12px" } },
        React.createElement(
          "div",
          {
            style: {
              marginBottom: "6px",
              fontSize: "13px",
              color: "var(--orca-color-text-2)",
            },
          },
          labels.dependsMode,
        ),
        React.createElement(Select, {
          selected: [dependsModeValue],
          options: dependsModeOptions,
          onChange: (selected: string[]) => {
            setDependsModeValue(selected[0] ?? props.schema.dependencyModeChoices[0])
          },
          width: "100%",
        }),
      ),
      React.createElement(
        "div",
        { style: { marginBottom: "12px" } },
        React.createElement(
          "div",
          {
            style: {
              marginBottom: "6px",
              fontSize: "13px",
              color: "var(--orca-color-text-2)",
            },
          },
          labels.dependencyDelay,
        ),
        React.createElement(Input, {
          value: dependencyDelayText,
          placeholder: isChinese ? "例如：24" : "e.g. 24",
          onChange: (event: Event) => {
            const target = event.target as HTMLInputElement
            setDependencyDelayText(target.value)
          },
        }),
      ),
      errorText.trim() !== ""
        ? React.createElement(
            "div",
            {
              style: {
                color: "var(--orca-color-text-red)",
                marginBottom: "12px",
                fontSize: "13px",
              },
            },
            errorText,
          )
        : null,
      React.createElement(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
        React.createElement(
          Button,
          {
            variant: "outline",
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
            onClick: () => void handleSave(),
          },
          saving ? (isChinese ? "保存中..." : "Saving...") : labels.save,
        ),
      ),
    ),
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

function toScoreInRange(value: number | null): number | null {
  if (value == null) {
    return null
  }

  if (value < 0 || value > 100) {
    return null
  }

  return Math.round(value)
}
