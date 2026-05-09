import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import {
  collectProjectDatasetSnapshot,
  type ProjectItem,
} from "../core/project-engine"
import type { ProjectSchemaDefinition } from "../core/project-schema"
import type { TaskSchemaDefinition } from "../core/task-schema"
import {
  mergeProjectLabelValues,
  normalizeProjectLabels,
  readProjectLabelChoiceValues,
} from "../core/project-properties"
import { getMirrorId } from "../core/block-utils"
import { t } from "../libs/l10n"
import { ProjectPropertyEditorDialog } from "./project-views-panel"

type ReactRootLike = {
  render: (node: unknown) => void
  unmount: () => void
}

interface ProjectPopupState {
  root: ReactRootLike | null
  containerEl: HTMLDivElement | null
  options: OpenProjectPropertyPopupOptions | null
  visible: boolean
  reloadToken: number
}

export interface OpenProjectPropertyPopupOptions {
  blockId: DbId
  schema: TaskSchemaDefinition
  projectSchema: ProjectSchemaDefinition
  onSaved?: (blockId: DbId) => void
}

const popupState: ProjectPopupState = {
  root: null,
  containerEl: null,
  options: null,
  visible: false,
  reloadToken: 0,
}

export function openProjectPropertyPopup(options: OpenProjectPropertyPopupOptions) {
  ensureRoot()
  popupState.options = options
  popupState.visible = true
  popupState.reloadToken += 1
  renderCurrent()
}

export function closeProjectPropertyPopup() {
  if (popupState.root == null || popupState.options == null) {
    return
  }

  popupState.visible = false
  renderCurrent()
}

export function disposeProjectPropertyPopup() {
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
  containerEl.dataset.role = "mlo-project-property-popup-root"
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
    React.createElement(ProjectPropertyPopupView, {
      ...popupState.options,
      visible: popupState.visible,
      reloadToken: popupState.reloadToken,
      onClose: () => closeProjectPropertyPopup(),
    }),
  )
}

function ProjectPropertyPopupView(props: OpenProjectPropertyPopupOptions & {
  visible: boolean
  reloadToken: number
  onClose: () => void
}) {
  const React = window.React
  const ModalOverlay = orca.components.ModalOverlay
  const [projectItem, setProjectItem] = React.useState<ProjectItem | null>(null)
  const [projectItems, setProjectItems] = React.useState<ProjectItem[]>([])
  const [schemaLabelOptions, setSchemaLabelOptions] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  const [errorText, setErrorText] = React.useState("")
  const normalizedBlockId = getMirrorId(props.blockId)

  React.useEffect(() => {
    let disposed = false
    setLoading(true)
    setErrorText("")

    void collectProjectDatasetSnapshot(props.schema, props.projectSchema)
      .then((snapshot) => {
        if (disposed) {
          return
        }

        const items = snapshot.projectItems
        const matched = items.find((item) => {
          return item.blockId === normalizedBlockId ||
            item.sourceBlockId === props.blockId ||
            getMirrorId(item.sourceBlockId) === normalizedBlockId
        }) ?? null

        setProjectItems(items)
        setProjectItem(matched)
        if (matched == null) {
          setErrorText(t("Current block is not a project"))
        }
      })
      .catch((error) => {
        if (disposed) {
          return
        }
        console.error(error)
        setErrorText(error instanceof Error ? error.message : t("Failed to load project"))
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [normalizedBlockId, props.blockId, props.projectSchema, props.reloadToken, props.schema, props.visible])

  React.useEffect(() => {
    let disposed = false

    const loadSchemaLabelChoices = async () => {
      try {
        const projectTagBlock = (await orca.invokeBackend(
          "get-block-by-alias",
          props.projectSchema.tagAlias,
        )) as Block | null
        if (disposed) {
          return
        }

        const properties = Array.isArray(projectTagBlock?.properties)
          ? projectTagBlock.properties
          : []
        const labelsProperty = properties.find((item: BlockProperty) => {
          return item.name === props.projectSchema.propertyNames.labels
        })
        setSchemaLabelOptions(readProjectLabelChoiceValues(labelsProperty))
      } catch (error) {
        console.error(error)
      }
    }

    void loadSchemaLabelChoices()
    return () => {
      disposed = true
    }
  }, [props.projectSchema])

  const labelOptions = React.useMemo(() => {
    const labels: string[] = []
    for (const item of projectItems) {
      labels.push(...item.properties.labels)
    }

    return mergeProjectLabelValues(schemaLabelOptions, normalizeProjectLabels(labels))
      .sort((left, right) => left.localeCompare(right))
      .map((label) => ({
        value: label,
        label,
      }))
  }, [projectItems, schemaLabelOptions])

  if (!props.visible) {
    return null
  }

  if (loading || projectItem == null) {
    return React.createElement(
      ModalOverlay,
      {
        visible: true,
        blurred: false,
        canClose: true,
        onClose: props.onClose,
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "14px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            width: "min(420px, calc(100vw - 28px))",
            borderRadius: "12px",
            border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
            background: "var(--orca-color-bg-1)",
            padding: "14px",
            color: errorText.trim() === ""
              ? "var(--orca-color-text-2)"
              : "var(--orca-color-text-red)",
            fontSize: "13px",
          },
        },
        loading ? t("Loading project...") : errorText,
      ),
    )
  }

  return React.createElement(ProjectPropertyEditorDialog, {
    project: projectItem,
    projectSchema: props.projectSchema,
    labelOptions,
    disabled: false,
    mountContainer: document.body,
    onClose: props.onClose,
    onSaved: () => {
      props.onSaved?.(projectItem.blockId)
      props.onClose()
    },
    onNavigateProject: (project: ProjectItem) => {
      orca.nav.openInLastPanel("block", { blockId: project.blockId })
    },
  })
}
