import type { Block, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { getMirrorId } from "../core/block-utils"
import {
  buildTaskFieldLabels,
  getTaskPropertiesFromRef,
  toRefDataForSave,
  validateNumericField,
} from "../core/task-properties"

import { t } from "../libs/l10n"
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

const TAG_REF_TYPE = 2
const REF_DATA_TYPE = 3

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
  const Checkbox = orca.components.Checkbox
  const Input = orca.components.Input
  const Select = orca.components.Select
  const DatePicker = orca.components.DatePicker
  const BlockSelect = orca.components.BlockSelect
  const ModalOverlay = orca.components.ModalOverlay

  const labels = buildTaskFieldLabels(orca.state.locale)
  const isChinese = orca.state.locale === "zh-CN"

  const block = orca.state.blocks[props.blockId]
  const taskRef = block?.refs.find(
    (ref) => ref.type === TAG_REF_TYPE && ref.alias === props.schema.tagAlias,
  )
  const initialValues = React.useMemo(() => {
    return getTaskPropertiesFromRef(taskRef?.data, props.schema)
  }, [block, taskRef, props.schema])

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
    "start" | "end" | null
  >(null)
  const [errorText, setErrorText] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [lastSavedSnapshot, setLastSavedSnapshot] = React.useState("")
  const [lastFailedSnapshot, setLastFailedSnapshot] = React.useState<string | null>(null)

  const dateAnchorRef = React.useRef<HTMLButtonElement | null>(null)
  // Mount dropdown and date picker overlays to body to avoid clipping by modal scroll.
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
  }, [props.blockId, initialDependsOnForEditor, initialSnapshot, initialValues])

  const statusOptions = props.schema.statusChoices.map((item) => ({
    value: item,
    label: item,
  }))

  const dependsModeOptions = [
    { value: "ALL", label: t("All dependency tasks completed") },
    { value: "ANY", label: t("Any dependency task completed") },
  ]

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
      const dependencyRefIds = await ensureDependencyRefIds(
        sourceBlockId,
        dependsOnValues,
      )

      const payload = toRefDataForSave(
        {
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
        },
        props.schema,
      )

      await orca.commands.invokeEditorCommand(
        "core.editor.insertTag",
        null,
        sourceBlockId,
        props.schema.tagAlias,
        payload,
      )
      setLastSavedSnapshot(snapshot)
      setLastFailedSnapshot(null)
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : t("Save failed"),
      )
      orca.notify(
        "error",
        error instanceof Error
          ? error.message
          : t("Save failed"),
      )
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
    if (unchanged || failedAndUnchanged) {
      return
    }

    const timer = window.setTimeout(() => {
      void handleSave(currentSnapshot)
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [currentSnapshot, handleSave, lastFailedSnapshot, lastSavedSnapshot, taskRef])

  // Use a consistent 2-column row layout: label + control.
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
    key: "start" | "end",
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

  return React.createElement(
    ModalOverlay,
    {
      visible: props.visible,
      blurred: false,
      style: {
        background: "rgba(0, 0, 0, 0.30)",
        backdropFilter: "none",
      },
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
        style: {
          width: "calc(100vw - 40px)",
          maxWidth: "520px",
          minWidth: 0,
          maxHeight: "calc(100vh - 56px)",
          overflow: "auto",
          padding: "16px",
          boxSizing: "border-box",
          background: "var(--orca-color-bg-1)",
          border: "1px solid var(--orca-color-border-1)",
          borderRadius: "10px",
        },
        onClick: (event: MouseEvent) => event.stopPropagation(),
      },
      React.createElement(
        "div",
        {
          style: {
            fontSize: "17px",
            fontWeight: 600,
            marginBottom: "10px",
          },
        },
        labels.title,
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
        t("Status / Star"),
        React.createElement(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: "10px",
              alignItems: "center",
            },
          },
          React.createElement(Select, {
            selected: [statusValue],
            options: statusOptions,
            onChange: (selected: string[]) => {
              setStatusValue(selected[0] ?? props.schema.statusChoices[0])
            },
            menuContainer: popupMenuContainerRef,
            width: "100%",
          }),
          React.createElement(
            "div",
            {
              style: {
                minHeight: "30px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              },
            },
            React.createElement(Checkbox, {
              checked: starValue,
              onChange: (event: { checked: boolean }) => {
                setStarValue(event.checked === true)
              },
            }),
            React.createElement(
              "span",
              {
                style: {
                  fontSize: "12px",
                  color: "var(--orca-color-text-2)",
                },
              },
              starValue
                ? (t("Starred"))
                : (t("Not starred")),
            ),
          ),
        ),
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
        React.createElement(Input, {
          value: repeatRuleText,
          placeholder: t("e.g. Every Monday 09:00"),
          onChange: (event: Event) => {
            setRepeatRuleText((event.target as HTMLInputElement).value)
          },
        }),
      ),
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
      // Show dependency mode/delay only when dependency targets exist.
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
              React.createElement(Input, {
                value: dependencyDelayText,
                placeholder: t("e.g. 24"),
                onChange: (event: Event) => {
                  setDependencyDelayText((event.target as HTMLInputElement).value)
                },
              }),
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
              } else {
                setEndTimeValue(next)
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
                marginBottom: "10px",
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



