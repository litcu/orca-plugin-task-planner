import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId } from "../core/block-utils"
import { getPluginSettings } from "../core/plugin-settings"
import {
  addTaskToProjectInView,
  saveProjectPropertiesInView,
  type ProjectItem,
} from "../core/project-engine"
import type { ProjectSchemaDefinition } from "../core/project-schema"
import {
  mergeProjectLabelValues,
  readProjectLabelChoiceValues,
  type ProjectPropertyValues,
} from "../core/project-properties"
import {
  getTaskStatusValues,
  isTaskClosedStatus,
  type TaskSchemaDefinition,
} from "../core/task-schema"
import { openTaskPropertyPopup } from "./task-property-panel"
import { TaskListRow, type TaskListRowItem } from "./task-list-row"
import type { AllTaskItem } from "../core/all-tasks-engine"

interface ProjectViewsPanelProps {
  pluginName: string
  schema: TaskSchemaDefinition
  projectSchema: ProjectSchemaDefinition
  projectItems: ProjectItem[]
  allTaskItems: AllTaskItem[]
  taskItemById: Map<DbId, AllTaskItem>
  loading: boolean
  disabled: boolean
  mountContainer?: HTMLElement | null
  onRefresh: () => void | Promise<void>
  onToggleTaskStatus: (item: AllTaskItem) => void | Promise<void>
  onSetTaskStatus: (item: AllTaskItem, status: string) => void | Promise<void>
  onNavigateTask: (item: AllTaskItem) => void
  onToggleTaskStar: (item: AllTaskItem) => void | Promise<void>
  onClearTimer: (item: AllTaskItem) => void | Promise<void>
  onMarkReviewed: (item: AllTaskItem) => void | Promise<void>
  onAddSubtask: (item: AllTaskItem) => void | Promise<void>
  onDeleteTaskTag: (item: AllTaskItem) => void | Promise<void>
  onDeleteTaskBlock: (item: AllTaskItem) => void | Promise<void>
  onAddToMyDay: (item: AllTaskItem) => void | Promise<void>
  onRemoveFromMyDay: (item: AllTaskItem) => void | Promise<void>
  onOpenTask: (blockId: DbId) => void
  onNavigateProject: (project: ProjectItem) => void
}

interface ProjectStatusCounts {
  total: number
  done: number
  doing: number
  todo: number
  waiting: number
}

export function ProjectViewsPanel(props: ProjectViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Select = orca.components.Select
  const isChinese = orca.state.locale === "zh-CN"
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const projectSelectMenuContainerRef = React.useRef<HTMLElement | null>(props.mountContainer ?? document.body)
  const [panelWidth, setPanelWidth] = React.useState(0)
  const projectItemById = React.useMemo(() => {
    const map = new Map<DbId, ProjectItem>()
    for (const item of props.projectItems) {
      map.set(item.blockId, item)
    }
    return map
  }, [props.projectItems])
  const [selectedProjectId, setSelectedProjectId] = React.useState<DbId | null>(() => {
    return props.projectItems[0]?.blockId ?? null
  })
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<DbId[]>([])
  const [addingExistingTasks, setAddingExistingTasks] = React.useState(false)
  const [closedProjectsCollapsed, setClosedProjectsCollapsed] = React.useState(true)
  const [showClosedProjectTasks, setShowClosedProjectTasks] = React.useState(false)
  const selectedProject = selectedProjectId == null
    ? null
    : projectItemById.get(selectedProjectId) ?? null
  const [editingProject, setEditingProject] = React.useState<ProjectItem | null>(null)
  const projectLabelOptions = React.useMemo(() => {
    const labels: string[] = []
    for (const item of props.projectItems) {
      labels.push(...item.properties.labels)
    }
    return mergeProjectLabelValues(labels)
      .sort((left, right) => left.localeCompare(right))
      .map((label) => ({
        value: label,
        label,
      }))
  }, [props.projectItems])
  const projectSelectOptions = React.useMemo(() => {
    return props.projectItems.map((item: ProjectItem) => ({
      value: String(item.blockId),
      label: isProjectClosed(item, props.projectSchema)
        ? `${item.text || t("(Untitled project)")} · ${t("Closed")}`
        : `${item.text || t("(Untitled project)")} · ${Math.round(item.progress * 100)}%`,
    }))
  }, [props.projectItems, props.projectSchema])
  const openProjectItems = React.useMemo(() => {
    return props.projectItems.filter((item: ProjectItem) => !isProjectClosed(item, props.projectSchema))
  }, [props.projectItems, props.projectSchema])
  const closedProjectItems = React.useMemo(() => {
    return props.projectItems.filter((item: ProjectItem) => isProjectClosed(item, props.projectSchema))
  }, [props.projectItems, props.projectSchema])
  React.useEffect(() => {
    if (props.projectItems.length === 0) {
      setSelectedProjectId(null)
      setSelectedTaskIds([])
      return
    }

    if (selectedProjectId != null && projectItemById.has(selectedProjectId)) {
      return
    }

    setSelectedProjectId(props.projectItems[0]?.blockId ?? null)
    setSelectedTaskIds([])
  }, [projectItemById, props.projectItems, selectedProjectId])

  React.useEffect(() => {
    setSelectedTaskIds([])
  }, [selectedProjectId])

  React.useEffect(() => {
    const element = panelRef.current
    if (element == null) {
      return
    }

    const updateWidth = () => {
      setPanelWidth(Math.round(element.getBoundingClientRect().width))
    }

    updateWidth()
    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (props.projectItems.length === 0) {
    return React.createElement(
      "div",
      {
        style: {
          padding: "12px",
          borderRadius: "12px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: "var(--orca-color-bg-2)",
          color: "var(--orca-color-text-2)",
          fontSize: "13px",
        },
      },
      t("No projects yet"),
    )
  }

  const selectedProjectTitle = selectedProject?.text ?? t("Project")
  const selectedProjectProperties = selectedProject?.properties ?? null
  const projectTaskIds: DbId[] = selectedProject?.taskIds ?? []
  const filteredProjectTaskIds = React.useMemo(() => {
    if (showClosedProjectTasks) {
      return projectTaskIds
    }

    return projectTaskIds.filter((taskId: DbId) => {
      const task = props.taskItemById.get(getMirrorId(taskId)) ?? props.taskItemById.get(taskId)
      return task != null && !isTaskClosedStatus(task.status, props.schema)
    })
  }, [projectTaskIds, props.schema, props.taskItemById, showClosedProjectTasks])
  const closedProjectTaskCount = React.useMemo(() => {
    return projectTaskIds.filter((taskId: DbId) => {
      const task = props.taskItemById.get(getMirrorId(taskId)) ?? props.taskItemById.get(taskId)
      return task != null && isTaskClosedStatus(task.status, props.schema)
    }).length
  }, [projectTaskIds, props.schema, props.taskItemById])
  const projectDisplayTaskIds = React.useMemo(() => {
    return getProjectRootTaskIds(filteredProjectTaskIds, props.taskItemById)
  }, [filteredProjectTaskIds, props.taskItemById])
  const projectTaskIdSet = React.useMemo(() => {
    return new Set<DbId>(filteredProjectTaskIds.map((taskId: DbId) => getMirrorId(taskId)))
  }, [filteredProjectTaskIds])
  const projectStatusCounts = React.useMemo(() => {
    return countProjectTasksByStatus(projectTaskIds, props.taskItemById, props.schema)
  }, [projectTaskIds, props.schema, props.taskItemById])
  const progressPercent = selectedProject == null || selectedProject.totalTaskCount === 0
    ? 0
    : Math.round(selectedProject.progress * 100)
  const useProjectSelectLayout = panelWidth > 0 && panelWidth < 760

  return React.createElement(
    "div",
    {
      ref: panelRef,
      style: {
        display: "grid",
        gridTemplateColumns: useProjectSelectLayout
          ? "minmax(0, 1fr)"
          : "minmax(184px, 228px) minmax(0, 1fr)",
        gap: "10px",
        minHeight: 0,
      },
    },
    useProjectSelectLayout
      ? null
      : React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              minHeight: 0,
            },
          },
          ...openProjectItems.map((item: ProjectItem) =>
            React.createElement(ProjectListCard, {
              key: item.blockId,
              item,
              selected: item.blockId === selectedProjectId,
              onClick: () => setSelectedProjectId(item.blockId),
            }),
          ),
          closedProjectItems.length === 0
            ? null
            : React.createElement(ClosedProjectListSection, {
                collapsed: closedProjectsCollapsed,
                projects: closedProjectItems,
                selectedProjectId,
                onToggle: () => setClosedProjectsCollapsed((prev: boolean) => !prev),
                onSelect: (projectId: DbId) => setSelectedProjectId(projectId),
              }),
        ),
    React.createElement(
      "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            minHeight: 0,
            overflow: "auto",
          },
        },
      useProjectSelectLayout
        ? React.createElement(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: "6px",
                padding: "10px",
                borderRadius: "11px",
                border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
                background: "var(--orca-color-bg-2)",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  color: "var(--orca-color-text-2)",
                  fontSize: "11px",
                  fontWeight: 650,
                },
              },
              t("Project"),
            ),
            React.createElement(Select, {
              selected: selectedProjectId == null ? [] : [String(selectedProjectId)],
              options: projectSelectOptions,
              onChange: (selected: string[]) => {
                const nextProjectId = Number(selected[0])
                if (Number.isInteger(nextProjectId) && projectItemById.has(nextProjectId)) {
                  setSelectedProjectId(getMirrorId(nextProjectId))
                }
              },
              width: "100%",
              filter: projectSelectOptions.length > 8,
              menuContainer: projectSelectMenuContainerRef,
            }),
          )
        : null,
      React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                padding: "12px 12px",
                borderRadius: "11px",
                border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
                background: "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
              },
            },
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  minWidth: 0,
                },
              },
              React.createElement(
                "div",
                {
                  style: {
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "5px",
                    flex: "1 1 auto",
                  },
                },
                React.createElement(
                  "div",
                  {
                    style: {
                      minWidth: 0,
                      fontSize: "16px",
                      fontWeight: 700,
                      color: "var(--orca-color-text-1, var(--orca-color-text))",
                      overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              },
              selectedProjectTitle,
            ),
            selectedProjectProperties == null
              ? null
              : renderProjectPropertySummary(selectedProjectProperties),
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
                justifyContent: "flex-end",
                flex: "0 0 auto",
              },
            },
            React.createElement(
              Button,
              {
                variant: "plain",
                title: t("Jump to project location"),
                disabled: props.disabled || selectedProject == null,
                onClick: () => {
                  if (selectedProject != null) {
                    props.onNavigateProject(selectedProject)
                  }
                },
                style: {
                  borderRadius: "8px",
                  width: "32px",
                  minWidth: "32px",
                  height: "30px",
                  padding: 0,
                },
              },
              React.createElement("i", {
                className: "ti ti-arrow-up-right",
                style: { fontSize: "14px", lineHeight: 1 },
              }),
            ),
            React.createElement(
              Button,
              {
                variant: "outline",
                disabled: props.disabled || selectedProject == null,
                onClick: () => {
                  if (selectedProject != null) {
                    setEditingProject(selectedProject)
                  }
                },
                style: {
                  borderRadius: "8px",
                  height: "30px",
                },
              },
              t("Edit project"),
            ),
            React.createElement(
              Button,
              {
                variant: "soft",
                disabled: props.disabled || selectedProject == null,
                onClick: () => {
                  if (selectedProject == null) {
                    return
                  }

                  openTaskPropertyPopup({
                    pluginName: props.pluginName,
                    parentBlockId: selectedProject.blockId,
                    parentSourceBlockId: selectedProject.sourceBlockId,
                    schema: props.schema,
                    triggerSource: "panel-view",
                    mountContainer: props.mountContainer ?? null,
                    mode: "create",
                    onTaskCreated: () => {
                      void props.onRefresh()
                    },
                  })
                },
                style: {
                  borderRadius: "8px",
                  height: "30px",
                },
              },
              t("Add task"),
            ),
            React.createElement(
              Button,
              {
                variant: "outline",
                disabled: props.disabled || selectedProject == null,
                onClick: () => {
                  setAddingExistingTasks(true)
                },
                style: {
                  borderRadius: "8px",
                  height: "30px",
                },
              },
              t("Add existing tasks"),
            ),
          ),
        ),
        selectedProject == null
          ? null
          : React.createElement(ProjectAttributeOverview, {
              project: selectedProject,
            }),
        React.createElement(ProjectProgressSummary, {
          progressPercent,
          statusCounts: projectStatusCounts,
        }),
      ),
        selectedProject == null
          ? null
          : React.createElement(
              "div",
              {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                minHeight: 0,
              },
            },
              renderProjectTaskListSection({
                title: t("Project tasks"),
                countText: showClosedProjectTasks
                  ? String(projectTaskIds.length)
                  : t("${visible} visible / ${hidden} closed hidden", {
                      visible: String(filteredProjectTaskIds.length),
                      hidden: String(closedProjectTaskCount),
                    }),
                taskIds: projectDisplayTaskIds,
                taskIdSet: projectTaskIdSet,
                taskItemById: props.taskItemById,
                schema: props.schema,
                pluginName: props.pluginName,
                isChinese,
                loading: props.loading,
                disabled: props.disabled,
                showSubtaskProgressBar: getPluginSettings(props.pluginName).showSubtaskProgressBar,
                showClosedTasks: showClosedProjectTasks,
                closedTaskCount: closedProjectTaskCount,
                onToggleShowClosedTasks: () => setShowClosedProjectTasks((prev: boolean) => !prev),
                onToggleTaskStatus: props.onToggleTaskStatus,
                onSetTaskStatus: props.onSetTaskStatus,
                onNavigateTask: props.onNavigateTask,
                onToggleTaskStar: props.onToggleTaskStar,
                onClearTimer: props.onClearTimer,
                onMarkReviewed: props.onMarkReviewed,
                onAddSubtask: props.onAddSubtask,
                onDeleteTaskTag: props.onDeleteTaskTag,
                onDeleteTaskBlock: props.onDeleteTaskBlock,
                onAddToMyDay: props.onAddToMyDay,
                onRemoveFromMyDay: props.onRemoveFromMyDay,
                onOpenTask: props.onOpenTask,
              }),
          ),
      selectedProject == null || !addingExistingTasks
        ? null
        : React.createElement(AddExistingTasksDialog, {
            project: selectedProject,
            allTaskItems: props.allTaskItems,
            disabled: props.disabled,
            schema: props.schema,
            selectedTaskIds,
            onSelectedTaskIdsChange: setSelectedTaskIds,
            onClose: () => {
              setAddingExistingTasks(false)
              setSelectedTaskIds([])
            },
            onSaved: () => {
              setAddingExistingTasks(false)
              setSelectedTaskIds([])
              void props.onRefresh()
            },
          }),
      editingProject == null
        ? null
        : React.createElement(ProjectPropertyEditorDialog, {
            project: editingProject,
            projectSchema: props.projectSchema,
            labelOptions: projectLabelOptions,
            disabled: props.disabled,
            mountContainer: props.mountContainer ?? null,
            onClose: () => setEditingProject(null),
            onSaved: () => {
              setEditingProject(null)
              void props.onRefresh()
            },
            onNavigateProject: props.onNavigateProject,
          }),
    ),
  )
}

function ProjectListCard(props: {
  item: ProjectItem
  selected: boolean
  closed?: boolean
  onClick: () => void
}): React.ReactNode {
  const React = window.React
  const closed = props.closed === true
  return React.createElement(
    "button",
    {
      type: "button",
      onClick: props.onClick,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: closed ? "4px" : "6px",
        width: "100%",
        minWidth: 0,
        padding: closed ? "8px 10px" : "9px 10px",
        borderRadius: "11px",
        border: props.selected
          ? closed
            ? "1px solid rgba(148, 163, 184, 0.58)"
            : "1px solid var(--orca-color-text-blue, #2563eb)"
          : closed
            ? "1px solid rgba(148, 163, 184, 0.22)"
            : "1px solid var(--orca-color-border-1, var(--orca-color-border))",
        background: props.selected
          ? closed
            ? "linear-gradient(150deg, rgba(148, 163, 184, 0.18), var(--orca-color-bg-1))"
            : "linear-gradient(150deg, rgba(37, 99, 235, 0.12), var(--orca-color-bg-1))"
          : closed
            ? "linear-gradient(150deg, rgba(148, 163, 184, 0.08), var(--orca-color-bg-2))"
            : "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
        textAlign: "left",
        cursor: "pointer",
        color: closed
          ? "var(--orca-color-text-2)"
          : "var(--orca-color-text-1, var(--orca-color-text))",
        opacity: closed ? 0.78 : 1,
        filter: closed ? "saturate(0.35)" : "none",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "6px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            fontSize: "12px",
            fontWeight: closed ? 560 : 650,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        props.item.text,
      ),
      closed
        ? null
        : React.createElement(
        "div",
        {
          style: {
            fontSize: "11px",
            color: "var(--orca-color-text-2)",
            whiteSpace: "nowrap",
          },
        },
        `${Math.round(props.item.progress * 100)}%`,
      ),
    ),
    closed
      ? null
      : React.createElement(
      "div",
      {
        style: {
          height: "4px",
          borderRadius: "999px",
          background: "rgba(148, 163, 184, 0.16)",
          overflow: "hidden",
        },
      },
      React.createElement("div", {
        style: {
          width: `${Math.round(props.item.progress * 100)}%`,
          height: "100%",
          borderRadius: "inherit",
          background: "linear-gradient(90deg, var(--orca-color-text-blue, #2563eb), var(--orca-color-text-green, #2f855a))",
        },
      }),
    ),
    closed
      ? null
      : React.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          color: "var(--orca-color-text-2)",
          fontSize: "11px",
        },
      },
      React.createElement("span", null, t("Total ${count} tasks", { count: String(props.item.totalTaskCount) })),
      React.createElement("span", null, t("Completed ${done}", { done: String(props.item.completedTaskCount) })),
    ),
    closed
      ? React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "5px",
              color: "var(--orca-color-text-2)",
              fontSize: "11px",
            },
          },
          React.createElement("i", {
            className: "ti ti-check",
            style: { fontSize: "13px", lineHeight: 1 },
          }),
          t(props.item.properties.status),
        )
      : renderProjectPropertySummary(props.item.properties, { compact: true }),
  )
}

function ClosedProjectListSection(props: {
  collapsed: boolean
  projects: ProjectItem[]
  selectedProjectId: DbId | null
  onToggle: () => void
  onSelect: (projectId: DbId) => void
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        marginTop: "4px",
        paddingTop: "8px",
        borderTop: "1px solid rgba(148, 163, 184, 0.18)",
      },
    },
    React.createElement(
      "button",
      {
        type: "button",
        onClick: props.onToggle,
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          width: "100%",
          border: "none",
          background: "transparent",
          color: "var(--orca-color-text-2)",
          cursor: "pointer",
          padding: "2px 2px",
          fontSize: "11.5px",
          fontWeight: 650,
          textAlign: "left",
        },
      },
      React.createElement(
        "span",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
          },
        },
        React.createElement("i", {
          className: props.collapsed ? "ti ti-chevron-right" : "ti ti-chevron-down",
          style: { fontSize: "14px", lineHeight: 1, flex: "0 0 auto" },
        }),
        React.createElement(
          "span",
          {
            style: {
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            },
          },
          t("Closed project items"),
        ),
      ),
      React.createElement(
        "span",
        {
          style: {
            flex: "0 0 auto",
            color: "var(--orca-color-text-3, var(--orca-color-text-2))",
            fontSize: "10.5px",
            fontWeight: 500,
          },
        },
        String(props.projects.length),
      ),
    ),
    props.collapsed
      ? null
      : React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            },
          },
          ...props.projects.map((item: ProjectItem) =>
            React.createElement(ProjectListCard, {
              key: item.blockId,
              item,
              selected: item.blockId === props.selectedProjectId,
              closed: true,
              onClick: () => props.onSelect(item.blockId),
            }),
          ),
        ),
  )
}

export function ProjectPropertyEditorDialog(props: {
  project: ProjectItem
  projectSchema: ProjectSchemaDefinition
  labelOptions: Array<{ value: string; label: string }>
  disabled: boolean
  mountContainer?: HTMLElement | null
  onClose: () => void
  onSaved: () => void
  onNavigateProject?: (project: ProjectItem) => void
}): React.ReactNode {
  const React = window.React
  const Button = orca.components.Button
  const Select = orca.components.Select
  const DatePicker = orca.components.DatePicker
  const Input = orca.components.Input
  const ModalOverlay = orca.components.ModalOverlay
  const [status, setStatus] = React.useState(props.project.properties.status)
  const [startTime, setStartTime] = React.useState<Date | null>(props.project.properties.startTime)
  const [dueTime, setDueTime] = React.useState<Date | null>(props.project.properties.dueTime)
  const [labels, setLabels] = React.useState<string[]>(props.project.properties.labels)
  const [note, setNote] = React.useState(props.project.properties.note)
  const [saving, setSaving] = React.useState(false)
  const [editingDateField, setEditingDateField] = React.useState<"start" | "due" | null>(null)
  const dateAnchorRef = React.useRef<HTMLElement | null>(null)
  const popupMenuContainerRef = React.useRef<HTMLElement | null>(props.mountContainer ?? document.body)
  const [projectLabelOptions, setProjectLabelOptions] = React.useState<string[]>(() => {
    return mergeProjectLabelValues(
      props.labelOptions.map((item) => item.value),
      props.project.properties.labels,
      collectProjectLabelValuesFromBlockTags(
        getProjectBlockForLabels(props.project),
        props.projectSchema.tagAlias,
      ),
    )
  })
  const statusOptions = props.projectSchema.statusChoices.map((choice) => ({
    value: choice,
    label: t(choice),
  }))
  const labelOptions = React.useMemo(() => {
    const merged = mergeProjectLabelValues(projectLabelOptions, labels)
    return merged.map((label) => ({
      value: label,
      label,
    }))
  }, [labels, projectLabelOptions])
  const handleNavigateProject = () => {
    if (props.onNavigateProject != null) {
      props.onNavigateProject(props.project)
      return
    }

    orca.nav.openInLastPanel("block", { blockId: props.project.blockId })
  }

  React.useEffect(() => {
    let disposed = false

    const loadProjectLabelOptions = async () => {
      const projectTagBlock = await getProjectTagBlockFromSchema(props.projectSchema)
      if (disposed) {
        return
      }

      const labelsProperty = projectTagBlock?.properties?.find((item: BlockProperty) => {
        return item.name === props.projectSchema.propertyNames.labels
      })
      const choiceLabels = readProjectLabelChoiceValues(labelsProperty)
      const blockLabels = collectProjectLabelValuesFromBlockTags(
        await getProjectBlockForLabelsAsync(props.project),
        props.projectSchema.tagAlias,
      )

      setProjectLabelOptions((prev: string[]) =>
        mergeProjectLabelValues(prev, choiceLabels, blockLabels, props.project.properties.labels))
      setLabels((prev: string[]) =>
        mergeProjectLabelValues(prev, blockLabels))
    }

    void loadProjectLabelOptions()
    return () => {
      disposed = true
    }
  }, [props.project, props.projectSchema])

  const save = async () => {
    if (saving) {
      return
    }

    setSaving(true)
    try {
      const values: ProjectPropertyValues = {
        status,
        startTime,
        dueTime,
        labels,
        note,
      }
      await saveProjectPropertiesInView({
        blockId: props.project.blockId,
        sourceBlockId: props.project.sourceBlockId,
        projectSchema: props.projectSchema,
        values,
      })
      orca.notify("success", t("Project saved"))
      props.onSaved()
    } catch (error) {
      console.error(error)
      orca.notify("error", error instanceof Error ? error.message : t("Failed to save project"))
    } finally {
      setSaving(false)
    }
  }

  const renderDateField = (
    field: "start" | "due",
    label: string,
    value: Date | null,
    setValue: (next: Date | null) => void,
  ) => {
    const hasValue = value != null
    return renderProjectFormRow(
      label,
      React.createElement(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 32px",
            gap: "6px",
          },
        },
        React.createElement(Input, {
          value: hasValue ? formatProjectDateInput(value) : "",
          placeholder: t("Not set"),
          readOnly: true,
          onClick: (event: Event) => {
            dateAnchorRef.current = event.currentTarget as HTMLElement
            setEditingDateField(field)
          },
          width: "100%",
        }),
        React.createElement(
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
              dateAnchorRef.current = event.currentTarget as HTMLElement
              setEditingDateField(field)
            },
            style: {
              borderRadius: "6px",
              width: "32px",
              minWidth: "32px",
              height: "32px",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            },
          },
          React.createElement("i", {
            className: hasValue ? "ti ti-x" : "ti ti-calendar-event",
            style: { fontSize: "14px", lineHeight: 1 },
          }),
        ),
      ),
    )
  }

  const dialog = React.createElement(
    "div",
    {
      style: {
        width: "min(520px, calc(100vw - 28px))",
        maxHeight: "min(720px, calc(100vh - 40px))",
        overflow: "auto",
        borderRadius: "12px",
        border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
        background: "var(--orca-color-bg-1)",
        boxShadow: "0 18px 45px rgba(15, 23, 42, 0.24)",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      },
      onClick: (event: MouseEvent) => event.stopPropagation(),
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            fontSize: "16px",
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        t("Project Properties"),
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            flex: "0 0 auto",
          },
        },
        React.createElement(
          Button,
          {
            variant: "plain",
            title: t("Jump to project location"),
            disabled: saving,
            onClick: handleNavigateProject,
            style: {
              borderRadius: "8px",
              width: "30px",
              minWidth: "30px",
              height: "30px",
              padding: 0,
            },
          },
          React.createElement("i", {
            className: "ti ti-arrow-up-right",
            style: { fontSize: "15px", lineHeight: 1 },
          }),
        ),
        React.createElement(
          Button,
          {
            variant: "plain",
            title: t("Close property panel"),
            disabled: saving,
            onClick: () => props.onClose(),
            style: {
              borderRadius: "8px",
              width: "30px",
              minWidth: "30px",
              height: "30px",
              padding: 0,
            },
          },
          React.createElement("i", {
            className: "ti ti-x",
            style: { fontSize: "15px", lineHeight: 1 },
          }),
        ),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          fontSize: "13px",
          color: "var(--orca-color-text-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      props.project.text,
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "7px",
          padding: "10px",
          borderRadius: "10px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: "var(--orca-color-bg-2)",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "10px",
            color: "var(--orca-color-text-2)",
            fontSize: "12px",
          },
        },
        React.createElement(
          "span",
          null,
          t("Completed ${done}", { done: String(props.project.completedTaskCount) }),
        ),
        React.createElement(
          "span",
          {
            style: {
              color: "var(--orca-color-text-1, var(--orca-color-text))",
              fontWeight: 700,
            },
          },
          `${Math.round(props.project.progress * 100)}%`,
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            height: "7px",
            borderRadius: "999px",
            background: "rgba(148, 163, 184, 0.16)",
            overflow: "hidden",
          },
        },
        React.createElement("div", {
          style: {
            width: `${Math.round(props.project.progress * 100)}%`,
            height: "100%",
            borderRadius: "inherit",
            background: "linear-gradient(90deg, var(--orca-color-text-blue, #2563eb), var(--orca-color-text-green, #2f855a))",
          },
        }),
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            color: "var(--orca-color-text-2)",
            fontSize: "11px",
          },
        },
        React.createElement("span", null, t("Total ${count} tasks", { count: String(props.project.totalTaskCount) })),
      ),
    ),
    renderProjectFormRow(
      t("Project status"),
      React.createElement(Select, {
        selected: [status],
        options: statusOptions,
        onChange: (selected: string[]) => {
          setStatus(selected[0] ?? props.projectSchema.statusChoices[0])
        },
        menuContainer: popupMenuContainerRef,
        width: "100%",
      }),
    ),
    renderDateField("start", t("Project start date"), startTime, setStartTime),
    renderDateField("due", t("Project due date"), dueTime, setDueTime),
    renderProjectFormRow(
      t("Project labels"),
      React.createElement(Select, {
        selected: labels,
        options: labelOptions,
        multiSelection: true,
        filter: true,
        placeholder: t("Select project labels"),
        filterPlaceholder: t("Filter labels"),
        filterFunction: async (keyword: string) => {
          return buildProjectLabelSelectOptions(labelOptions, labels, keyword)
        },
        onChange: (selected: string[]) => {
          const normalized = mergeProjectLabelValues(selected)
          setLabels(normalized)
          setProjectLabelOptions((prev: string[]) =>
            mergeProjectLabelValues(prev, normalized))
        },
        menuContainer: popupMenuContainerRef,
        width: "100%",
      }),
    ),
    renderProjectFormRow(
      t("Project note"),
      React.createElement("textarea", {
        value: note,
        placeholder: t("Add project notes"),
        onChange: (event: Event) => {
          setNote((event.target as HTMLTextAreaElement).value)
        },
        style: {
          width: "100%",
          minHeight: "86px",
          resize: "vertical",
          borderRadius: "8px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: "var(--orca-color-bg-2)",
          color: "var(--orca-color-text-1, var(--orca-color-text))",
          padding: "8px",
          font: "inherit",
          fontSize: "13px",
          boxSizing: "border-box",
        },
      }),
    ),
    editingDateField == null
      ? null
      : React.createElement(DatePicker, {
          mode: "date",
          visible: true,
          value: (editingDateField === "start" ? startTime : dueTime) ?? normalizeProjectDateOnly(new Date()) ?? new Date(),
          refElement: dateAnchorRef,
          menuContainer: popupMenuContainerRef,
          onChange: (next: Date | [Date, Date]) => {
            if (!(next instanceof Date)) {
              return
            }
            const normalizedNext = normalizeProjectDateOnly(next) ?? next
            if (editingDateField === "start") {
              setStartTime(normalizedNext)
            } else {
              setDueTime(normalizedNext)
            }
            setEditingDateField(null)
          },
          onClose: () => setEditingDateField(null),
        }),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "flex-end",
          gap: "8px",
          marginTop: "2px",
        },
      },
      React.createElement(
        Button,
        {
          variant: "plain",
          disabled: saving,
          onClick: () => props.onClose(),
        },
        t("Cancel"),
      ),
      React.createElement(
        Button,
        {
          variant: "solid",
          disabled: saving || props.disabled,
          onClick: () => {
            void save()
          },
        },
        saving ? t("Saving...") : t("Save"),
      ),
    ),
  )

  return React.createElement(
    ModalOverlay,
    {
      visible: true,
      blurred: false,
      canClose: true,
      onClose: () => {
        if (!saving) {
          props.onClose()
        }
      },
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "14px",
      },
    },
    dialog,
  )
}

function renderProjectPropertySummary(
  properties: ProjectPropertyValues,
  options?: { compact?: boolean },
): React.ReactNode {
  const React = window.React
  const chips: React.ReactNode[] = [
    React.createElement(ProjectMetaChip, {
      key: "status",
      text: t(properties.status),
      tone: "status",
    }),
  ]

  if (!options?.compact) {
    chips.push(React.createElement(ProjectMetaChip, {
      key: "timeline",
      text: formatProjectDateRange(properties.startTime, properties.dueTime),
      icon: "ti ti-calendar-time",
    }))
    for (const label of properties.labels.slice(0, 4)) {
      chips.push(React.createElement(ProjectMetaChip, {
        key: `label-${label}`,
        text: label,
        icon: "ti ti-tag",
      }))
    }
    if (properties.labels.length === 0) {
      chips.push(React.createElement(ProjectMetaChip, {
        key: "labels-empty",
        text: t("No project labels"),
        icon: "ti ti-tags",
      }))
    }
  }

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minWidth: 0,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          alignItems: "center",
        },
      },
      ...chips,
    ),
  )
}

function ProjectMetaChip(props: {
  text: string
  tone?: "status"
  icon?: string
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        minWidth: 0,
        maxWidth: "100%",
        borderRadius: "999px",
        border: props.tone === "status"
          ? "1px solid rgba(37, 99, 235, 0.24)"
          : "1px solid var(--orca-color-border-1, var(--orca-color-border))",
        background: props.tone === "status"
          ? "rgba(37, 99, 235, 0.10)"
          : "var(--orca-color-bg-2)",
        color: props.tone === "status"
          ? "var(--orca-color-text-blue, #2563eb)"
          : "var(--orca-color-text-2)",
        fontSize: "11px",
        lineHeight: 1.2,
        gap: "4px",
        padding: "3px 7px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
    },
    props.icon == null
      ? null
      : React.createElement("i", {
          className: props.icon,
          style: {
            fontSize: "13px",
            lineHeight: 1,
            flex: "0 0 auto",
          },
        }),
    props.text,
  )
}

function ProjectAttributeOverview(props: {
  project: ProjectItem
}): React.ReactNode {
  const React = window.React
  const properties = props.project.properties
  const noteText = properties.note.trim() === ""
    ? t("No project note")
    : properties.note.trim()

  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "min(760px, 100%)",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          maxWidth: "min(760px, 100%)",
          color: properties.note.trim() === ""
            ? "var(--orca-color-text-3, var(--orca-color-text-2))"
            : "var(--orca-color-text-2)",
          fontSize: "12px",
          lineHeight: 1.45,
        },
      },
      React.createElement("i", {
        className: "ti ti-notes",
        style: {
          fontSize: "14px",
          lineHeight: "18px",
          color: "var(--orca-color-text-2)",
          flex: "0 0 auto",
        },
      }),
      React.createElement(
        "span",
        {
          style: {
            minWidth: 0,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-word",
          },
        },
        noteText,
      ),
    ),
  )
}

function ProjectProgressSummary(props: {
  progressPercent: number
  statusCounts: ProjectStatusCounts
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "9px 10px",
        borderRadius: "9px",
        background: "rgba(148, 163, 184, 0.08)",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          gap: "10px",
          alignItems: "center",
          minWidth: 0,
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "baseline",
            gap: "6px",
            whiteSpace: "nowrap",
          },
        },
        React.createElement(
          "span",
          {
            style: {
              color: "var(--orca-color-text-2)",
              fontSize: "10px",
              lineHeight: 1.2,
            },
          },
          t("Completion rate"),
        ),
        React.createElement(
          "span",
          {
            style: {
              color: "var(--orca-color-text-1, var(--orca-color-text))",
              fontSize: "15px",
              fontWeight: 750,
              lineHeight: 1,
            },
          },
          `${props.progressPercent}%`,
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            height: "7px",
            borderRadius: "999px",
            background: "rgba(148, 163, 184, 0.16)",
            overflow: "hidden",
            minWidth: 0,
          },
        },
        React.createElement("div", {
          style: {
            width: `${props.progressPercent}%`,
            height: "100%",
            borderRadius: "inherit",
            background: "linear-gradient(90deg, var(--orca-color-text-blue, #2563eb), var(--orca-color-text-green, #2f855a))",
          },
        }),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          minWidth: 0,
        },
      },
      React.createElement(ProjectStatCell, {
        label: t("Total tasks"),
        value: String(props.statusCounts.total),
      }),
      React.createElement(ProjectStatCell, {
        label: t("Completed"),
        value: String(props.statusCounts.done),
      }),
      React.createElement(ProjectStatCell, {
        label: t("In Progress"),
        value: String(props.statusCounts.doing),
      }),
      React.createElement(ProjectStatCell, {
        label: t("Not Started"),
        value: String(props.statusCounts.todo),
      }),
      React.createElement(ProjectStatCell, {
        label: t("Waiting"),
        value: String(props.statusCounts.waiting),
      }),
    ),
  )
}

function ProjectStatCell(props: {
  label: string
  value: string
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "div",
    {
      style: {
        minWidth: 0,
        flex: "1 1 92px",
        maxWidth: "132px",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        paddingLeft: "10px",
        borderLeft: "1px solid rgba(148, 163, 184, 0.18)",
      },
    },
    React.createElement(
      "span",
      {
        style: {
          color: "var(--orca-color-text-2)",
          fontSize: "10px",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      },
      props.label,
    ),
    React.createElement(
      "span",
      {
        style: {
          color: "var(--orca-color-text-1, var(--orca-color-text))",
          fontSize: "13px",
          fontWeight: 700,
          lineHeight: 1.2,
        },
      },
      props.value,
    ),
  )
}

function countProjectTasksByStatus(
  taskIds: DbId[],
  taskItemById: Map<DbId, AllTaskItem>,
  schema: TaskSchemaDefinition,
): ProjectStatusCounts {
  const { todo, doing, waiting, done } = getTaskStatusValues(schema)
  const counts: ProjectStatusCounts = {
    total: 0,
    done: 0,
    doing: 0,
    todo: 0,
    waiting: 0,
  }

  for (const taskId of taskIds) {
    const task = taskItemById.get(getMirrorId(taskId)) ?? taskItemById.get(taskId)
    if (task == null) {
      continue
    }

    counts.total += 1
    if (task.status === done) {
      counts.done += 1
    } else if (task.status === doing) {
      counts.doing += 1
    } else if (task.status === todo) {
      counts.todo += 1
    } else if (task.status === waiting) {
      counts.waiting += 1
    }
  }

  return counts
}

function isProjectClosed(
  item: ProjectItem,
  projectSchema: ProjectSchemaDefinition,
): boolean {
  return item.properties.status === projectSchema.statusChoices[3]
}

function getProjectRootTaskIds(
  taskIds: DbId[],
  taskItemById: Map<DbId, AllTaskItem>,
): DbId[] {
  const normalized = new Set(taskIds.map((taskId) => getMirrorId(taskId)))
  const rootTaskIds: DbId[] = []

  for (const taskId of taskIds) {
    const task = taskItemById.get(getMirrorId(taskId)) ?? taskItemById.get(taskId)
    if (task == null) {
      continue
    }

    const parentId = task.parentId != null ? getMirrorId(task.parentId) : null
    if (parentId != null && normalized.has(parentId)) {
      continue
    }

    rootTaskIds.push(task.blockId)
  }

  return Array.from(new Set(rootTaskIds))
}

function ProjectInlineMeta(props: {
  icon: string
  text: string
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        minWidth: 0,
        maxWidth: "100%",
      },
    },
    React.createElement("i", {
      className: props.icon,
      style: {
        fontSize: "14px",
        lineHeight: 1,
        color: "var(--orca-color-text-2)",
        flex: "0 0 auto",
      },
    }),
    React.createElement(
      "span",
      {
        style: {
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      },
      props.text,
    ),
  )
}

function renderProjectFormRow(label: string, control: React.ReactNode): React.ReactNode {
  const React = window.React
  return React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "130px minmax(0, 1fr)",
        gap: "10px",
        alignItems: "center",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          color: "var(--orca-color-text-2)",
          fontSize: "12px",
          fontWeight: 650,
        },
      },
      label,
    ),
    React.createElement("div", { style: { minWidth: 0 } }, control),
  )
}

function buildProjectLabelSelectOptions(
  options: Array<{ value: string; label: string }>,
  selectedLabels: string[],
  keyword: string,
): Array<{ value: string; label: string }> {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const values = mergeProjectLabelValues([
    ...options.map((item) => item.value),
    ...selectedLabels,
    keyword,
  ])

  return values
    .filter((label) => normalizedKeyword === "" || label.toLowerCase().includes(normalizedKeyword))
    .map((label) => ({
      value: label,
      label,
    }))
}

function collectProjectLabelValuesFromBlockTags(
  block: { refs?: Array<{ type: number; alias?: string }> } | null | undefined,
  projectTagAlias: string,
): string[] {
  if (block == null || !Array.isArray(block.refs)) {
    return []
  }

  const projectTagAliasLower = projectTagAlias.toLowerCase()
  const labels = block.refs
    .filter((ref) => ref.type === 2)
    .map((ref) => (typeof ref.alias === "string" ? ref.alias : ""))
    .filter((alias) => alias.trim() !== "")
    .filter((alias) => alias.toLowerCase() !== projectTagAliasLower)

  return mergeProjectLabelValues(labels)
}

function getProjectBlockForLabels(project: ProjectItem) {
  return orca.state.blocks[getMirrorId(project.sourceBlockId)] ??
    orca.state.blocks[project.sourceBlockId] ??
    orca.state.blocks[project.blockId] ??
    null
}

async function getProjectBlockForLabelsAsync(project: ProjectItem): Promise<Block | null> {
  const localBlock = getProjectBlockForLabels(project)
  if (localBlock != null) {
    return localBlock
  }

  try {
    return (await orca.invokeBackend("get-block", project.sourceBlockId)) ??
      (await orca.invokeBackend("get-block", project.blockId))
  } catch (error) {
    console.error(error)
    return null
  }
}

async function getProjectTagBlockFromSchema(
  projectSchema: ProjectSchemaDefinition,
): Promise<Block | null> {
  try {
    return (await orca.invokeBackend("get-block-by-alias", projectSchema.tagAlias)) as Block | null
  } catch (error) {
    console.error(error)
    return null
  }
}

function normalizeProjectDateToMinute(value: Date | null): Date | null {
  if (value == null || Number.isNaN(value.getTime())) {
    return value
  }

  const normalized = new Date(value.getTime())
  normalized.setSeconds(0, 0)
  return normalized
}

function normalizeProjectDateOnly(value: Date | null): Date | null {
  if (value == null || Number.isNaN(value.getTime())) {
    return value
  }

  const normalized = new Date(value.getTime())
  normalized.setHours(0, 0, 0, 0)
  return normalized
}

function formatProjectDate(value: Date): string {
  const locale = orca.state.locale === "zh-CN" ? "zh-CN" : undefined
  return value.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function formatProjectDateRange(startTime: Date | null, dueTime: Date | null): string {
  if (startTime == null && dueTime == null) {
    return t("No project timeline")
  }
  if (startTime != null && dueTime != null) {
    return `${formatProjectDate(startTime)} - ${formatProjectDate(dueTime)}`
  }
  if (startTime != null) {
    return t("Start ${date}", { date: formatProjectDate(startTime) })
  }
  return t("Due ${date}", { date: formatProjectDate(dueTime as Date) })
}

function formatProjectDateTime(value: Date): string {
  const locale = orca.state.locale === "zh-CN" ? "zh-CN" : undefined
  return value.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function formatProjectDateInput(value: Date): string {
  return formatProjectDate(value)
}

function AddExistingTasksDialog(props: {
  project: ProjectItem
  allTaskItems: AllTaskItem[]
  disabled: boolean
  schema: TaskSchemaDefinition
  selectedTaskIds: DbId[]
  onSelectedTaskIdsChange: (ids: DbId[]) => void
  onClose: () => void
  onSaved: () => void
}): React.ReactNode {
  const React = window.React
  const Button = orca.components.Button
  const Select = orca.components.Select
  const ModalOverlay = orca.components.ModalOverlay
  const [saving, setSaving] = React.useState(false)
  const selectedSet = React.useMemo(() => {
    return new Set(props.project.taskIds.map((taskId) => getMirrorId(taskId)))
  }, [props.project.taskIds])
  const taskOptions = React.useMemo(() => {
    const options = props.allTaskItems
      .filter((item) => !selectedSet.has(getMirrorId(item.blockId)))
      .map((item) => ({
        value: String(item.blockId),
        label: item.text || t("(Untitled task)"),
      }))

    return options.sort((left, right) => left.label.localeCompare(right.label))
  }, [props.allTaskItems, selectedSet])

  const handleSave = async () => {
    if (saving || props.selectedTaskIds.length === 0) {
      return
    }

    setSaving(true)
    try {
      await Promise.all(
        props.selectedTaskIds.map((taskId) =>
          addTaskToProjectInView({
            blockId: taskId,
            schema: props.schema,
            projectIds: [props.project.blockId],
          }),
        ),
      )
      props.onSaved()
    } catch (error) {
      console.error(error)
      orca.notify("error", error instanceof Error ? error.message : t("Failed to add task"))
    } finally {
      setSaving(false)
    }
  }

  return React.createElement(
    ModalOverlay,
    {
      visible: true,
      blurred: false,
      canClose: true,
      onClose: () => {
        if (!saving) {
          props.onClose()
        }
      },
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
          width: "min(520px, calc(100vw - 28px))",
          borderRadius: "12px",
          border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
          background: "var(--orca-color-bg-1)",
          boxShadow: "0 18px 45px rgba(15, 23, 42, 0.24)",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        },
        onClick: (event: MouseEvent) => event.stopPropagation(),
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              fontSize: "16px",
              fontWeight: 700,
            },
          },
          t("Add existing tasks"),
        ),
        React.createElement(
          Button,
          {
            variant: "plain",
            title: t("Close property panel"),
            disabled: saving,
            onClick: () => props.onClose(),
            style: {
              borderRadius: "8px",
              width: "30px",
              minWidth: "30px",
              height: "30px",
              padding: 0,
            },
          },
          React.createElement("i", {
            className: "ti ti-x",
            style: { fontSize: "15px", lineHeight: 1 },
          }),
        ),
      ),
      React.createElement(
        "div",
        {
          style: {
            color: "var(--orca-color-text-2)",
            fontSize: "13px",
          },
        },
        props.project.text,
      ),
      taskOptions.length === 0
        ? React.createElement(
            "div",
            {
              style: {
                color: "var(--orca-color-text-2)",
                fontSize: "13px",
                padding: "10px",
                borderRadius: "8px",
                background: "var(--orca-color-bg-2)",
              },
            },
            t("No available task"),
          )
        : React.createElement(Select, {
            selected: props.selectedTaskIds.map((item) => String(item)),
            options: taskOptions,
            multiSelection: true,
            filter: true,
            placeholder: t("Select tasks"),
            onChange: (selected: string[]) => {
              const normalized = selected
                .map((item) => Number(item))
                .filter((item): item is DbId => Number.isInteger(item) && item > 0)
                .map((item) => getMirrorId(item))
              props.onSelectedTaskIdsChange(Array.from(new Set(normalized)))
            },
            menuContainer: { current: document.body },
            width: "100%",
          }),
      React.createElement(
        "div",
        {
          style: {
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
          t("Cancel"),
        ),
        React.createElement(
          Button,
          {
            variant: "solid",
            disabled: saving || props.disabled || props.selectedTaskIds.length === 0,
            onClick: () => {
              void handleSave()
            },
          },
          saving ? t("Saving...") : t("Add"),
        ),
      ),
    ),
  )
}

function renderProjectTaskListSection(options: {
  title: string
  countText: string
  taskIds: DbId[]
  taskIdSet: Set<DbId>
  taskItemById: Map<DbId, AllTaskItem>
  schema: TaskSchemaDefinition
  pluginName: string
  isChinese: boolean
  loading: boolean
  disabled: boolean
  showSubtaskProgressBar: boolean
  showClosedTasks: boolean
  closedTaskCount: number
  onToggleShowClosedTasks: () => void
  onToggleTaskStatus: (item: AllTaskItem) => void | Promise<void>
  onSetTaskStatus: (item: AllTaskItem, status: string) => void | Promise<void>
  onNavigateTask: (item: AllTaskItem) => void
  onToggleTaskStar: (item: AllTaskItem) => void | Promise<void>
  onClearTimer: (item: AllTaskItem) => void | Promise<void>
  onMarkReviewed: (item: AllTaskItem) => void | Promise<void>
  onAddSubtask: (item: AllTaskItem) => void | Promise<void>
  onDeleteTaskTag: (item: AllTaskItem) => void | Promise<void>
  onDeleteTaskBlock: (item: AllTaskItem) => void | Promise<void>
  onAddToMyDay: (item: AllTaskItem) => void | Promise<void>
  onRemoveFromMyDay: (item: AllTaskItem) => void | Promise<void>
  onOpenTask: (blockId: DbId) => void
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px",
        borderRadius: "12px",
        border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
        background: "var(--orca-color-bg-2)",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
          minWidth: 0,
          flexWrap: "wrap",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--orca-color-text-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        options.title,
      ),
      React.createElement(
        "div",
        {
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "6px",
            flex: "0 1 auto",
            minWidth: 0,
            flexWrap: "wrap",
          },
        },
        React.createElement(
          "span",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              padding: "0 8px",
              minHeight: "20px",
              borderRadius: "999px",
              border: "1px solid rgba(148, 163, 184, 0.24)",
              background: "rgba(148, 163, 184, 0.10)",
              color: "var(--orca-color-text-2)",
              fontSize: "10.5px",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          options.countText,
        ),
        React.createElement(
          "button",
          {
            type: "button",
            disabled: options.closedTaskCount === 0,
            onClick: () => options.onToggleShowClosedTasks(),
            title: options.showClosedTasks
              ? t("Hide closed tasks")
              : t("Show closed tasks"),
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              minHeight: "22px",
              borderRadius: "999px",
              border: options.showClosedTasks
                ? "1px solid rgba(37, 99, 235, 0.30)"
                : "1px solid rgba(148, 163, 184, 0.24)",
              background: options.showClosedTasks
                ? "rgba(37, 99, 235, 0.10)"
                : "rgba(148, 163, 184, 0.08)",
              color: options.closedTaskCount === 0
                ? "var(--orca-color-text-3, var(--orca-color-text-2))"
                : options.showClosedTasks
                  ? "var(--orca-color-text-blue, #2563eb)"
                  : "var(--orca-color-text-2)",
              cursor: options.closedTaskCount === 0 ? "default" : "pointer",
              fontSize: "10.5px",
              padding: "0 8px",
              whiteSpace: "nowrap",
              opacity: options.closedTaskCount === 0 ? 0.58 : 1,
            },
          },
          React.createElement("i", {
            className: options.showClosedTasks ? "ti ti-eye-off" : "ti ti-filter",
            style: { fontSize: "13px", lineHeight: 1 },
          }),
          options.showClosedTasks
            ? t("Hide closed")
            : t("Show closed"),
        ),
      ),
    ),
    options.taskIds.length === 0
      ? React.createElement(
          "div",
          {
            style: {
              color: "var(--orca-color-text-2)",
              fontSize: "13px",
            },
          },
          t("No tasks"),
        )
      : React.createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            },
          },
          ...options.taskIds.map((taskId) => renderTaskTreeNode(taskId, 0, options)),
        ),
  )
}

function renderTaskTreeNode(
  taskId: DbId,
  depth: number,
  options: {
    taskItemById: Map<DbId, AllTaskItem>
    taskIdSet: Set<DbId>
    schema: TaskSchemaDefinition
    pluginName: string
    isChinese: boolean
    loading: boolean
    disabled: boolean
    showSubtaskProgressBar: boolean
    onToggleTaskStatus: (item: AllTaskItem) => void | Promise<void>
    onSetTaskStatus: (item: AllTaskItem, status: string) => void | Promise<void>
    onNavigateTask: (item: AllTaskItem) => void
    onToggleTaskStar: (item: AllTaskItem) => void | Promise<void>
    onClearTimer: (item: AllTaskItem) => void | Promise<void>
    onMarkReviewed: (item: AllTaskItem) => void | Promise<void>
    onAddSubtask: (item: AllTaskItem) => void | Promise<void>
    onDeleteTaskTag: (item: AllTaskItem) => void | Promise<void>
    onDeleteTaskBlock: (item: AllTaskItem) => void | Promise<void>
    onAddToMyDay: (item: AllTaskItem) => void | Promise<void>
    onRemoveFromMyDay: (item: AllTaskItem) => void | Promise<void>
    onOpenTask: (blockId: DbId) => void
  },
): React.ReactNode {
  const React = window.React
  const taskItem = options.taskItemById.get(taskId)
  if (taskItem == null) {
    return null
  }

  return React.createElement(
    "div",
    {
      key: `manual-${taskId}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginLeft: `${depth * 16}px`,
      },
    },
    React.createElement(TaskListRow, {
      item: taskItem,
      schema: options.schema,
      isChinese: options.isChinese,
      rowIndex: depth,
      depth,
      contextOnly: false,
      loading: options.loading,
      updating: options.disabled,
      showCollapseToggle: false,
      collapsed: false,
      showParentTaskContext: false,
      showReviewAction: false,
      showReviewSelection: false,
      reviewSelected: false,
      showSubtaskProgressBar: options.showSubtaskProgressBar,
      starUpdating: false,
      timerEnabled: getPluginSettings(options.pluginName).taskTimerEnabled,
      timerMode: getPluginSettings(options.pluginName).taskTimerMode,
      timerNowMs: Date.now(),
      timerUpdating: false,
      reviewUpdating: false,
      onToggleStatus: () => options.onToggleTaskStatus(taskItem),
      onSetStatus: (status: string) => options.onSetTaskStatus(taskItem, status),
      onNavigate: () => options.onNavigateTask(taskItem),
      onToggleStar: () => options.onToggleTaskStar(taskItem),
      onClearTimer: () => options.onClearTimer(taskItem),
      onMarkReviewed: () => options.onMarkReviewed(taskItem),
      onAddSubtask: () => options.onAddSubtask(taskItem),
      onDeleteTaskTag: () => options.onDeleteTaskTag(taskItem),
      onDeleteTaskBlock: () => options.onDeleteTaskBlock(taskItem),
      showMyDayAction: false,
      myDaySelected: false,
      myDayUpdating: false,
      onOpen: () => options.onOpenTask(taskItem.blockId),
    }),
    ...(taskItem.children ?? [])
      .filter((childTaskId) => options.taskIdSet.has(getMirrorId(childTaskId)))
      .map((childTaskId) => renderTaskTreeNode(getMirrorId(childTaskId), depth + 1, options)),
  )
}
