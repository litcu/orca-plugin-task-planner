import type { Block, DbId } from "../orca.d.ts"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { getMirrorId } from "../core/block-utils"
import {
  buildTaskFieldLabels,
  getTaskPropertiesFromRef,
  toRefDataForSave,
  validateNumericField,
} from "../core/task-properties"

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
  const [importanceValue, setImportanceValue] = React.useState(
    clampScore(initialValues.importance),
  )
  const [urgencyValue, setUrgencyValue] = React.useState(
    clampScore(initialValues.urgency),
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
    "start" | "end" | null
  >(null)
  const [errorText, setErrorText] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const dateAnchorRef = React.useRef<HTMLButtonElement | null>(null)
  // 下拉与日期弹层统一挂到 body，避免被弹窗滚动容器裁剪后“不可见但已打开”。
  const popupMenuContainerRef = React.useRef<HTMLElement | null>(null)
  if (popupMenuContainerRef.current == null) {
    popupMenuContainerRef.current = document.body
  }

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
    setDependsOnValues(initialDependsOnForEditor)
    setDependsModeValue(initialValues.dependsMode)
    setDependencyDelayText(
      initialValues.dependencyDelay == null
        ? ""
        : String(initialValues.dependencyDelay),
    )
    setEditingDateField(null)
    setErrorText("")
  }, [props.blockId, initialValues, initialDependsOnForEditor])

  const hasDependencies = dependsOnValues.length > 0
  const selectedDateValue =
    editingDateField === "start"
      ? startTimeValue
      : editingDateField === "end"
        ? endTimeValue
        : null

  const statusOptions = props.schema.statusChoices.map((item) => ({
    value: item,
    label: item,
  }))

  const dependsModeOptions = isChinese
    ? [
        { value: "ALL", label: "所有依赖任务完成" },
        { value: "ANY", label: "任一依赖任务完成" },
      ]
    : [
        { value: "ALL", label: "ALL" },
        { value: "ANY", label: "ANY" },
      ]

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

  // 统一“属性名 + 控件”同一行布局，保证视觉对齐与阅读顺序。
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
          value == null
            ? (isChinese ? "未设置" : "Not set")
            : value.toLocaleString(),
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
          isChinese ? "选择" : "Pick",
        ),
        React.createElement(
          Button,
          {
            variant: "plain",
            style: { minWidth: "60px" },
            onClick: () => setValue(null),
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
      canClose: false,
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
      // 只有存在依赖任务时才展示依赖模式与依赖延迟，避免无效配置。
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
                placeholder: isChinese ? "例如：24" : "e.g. 24",
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
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            marginTop: "10px",
          },
        },
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
