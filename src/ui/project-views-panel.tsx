import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId } from "../core/block-utils"
import { getPluginSettings } from "../core/plugin-settings"
import {
  addTaskToProjectInView,
  type ProjectItem,
  type ProjectStructureNode,
} from "../core/project-engine"
import { type TaskSchemaDefinition } from "../core/task-schema"
import { openTaskPropertyPopup } from "./task-property-panel"
import { TaskListRow, type TaskListRowItem } from "./task-list-row"
import type { AllTaskItem } from "../core/all-tasks-engine"

interface ProjectViewsPanelProps {
  pluginName: string
  schema: TaskSchemaDefinition
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
}

export function ProjectViewsPanel(props: ProjectViewsPanelProps) {
  const React = window.React
  const Button = orca.components.Button
  const Select = orca.components.Select
  const isChinese = orca.state.locale === "zh-CN"
  const settings = getPluginSettings(props.pluginName)
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
  const selectedProject = selectedProjectId == null
    ? null
    : projectItemById.get(selectedProjectId) ?? null
  const selectedProjectTaskOptions = React.useMemo(() => {
    const options = props.allTaskItems
      .filter((item) =>
        !selectedProject?.structuralTaskIds.includes(item.blockId) &&
        !selectedProject?.manualTaskIds.includes(item.blockId))
      .map((item) => ({
        value: String(item.blockId),
        label: item.text || t("(Untitled task)"),
      }))

    return options.sort((left, right) => left.label.localeCompare(right.label))
  }, [props.allTaskItems, selectedProject?.structuralTaskIds])

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
  const manualTaskCount = selectedProject?.externalManualTaskIds.length ?? 0
  const totalTaskCount = selectedProject?.totalTaskCount ?? 0
  const completedTaskCount = selectedProject?.completedTaskCount ?? 0
  const progressPercent = selectedProject == null || selectedProject.totalTaskCount === 0
    ? 0
    : Math.round(selectedProject.progress * 100)

  return React.createElement(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "minmax(240px, 320px) minmax(0, 1fr)",
        gap: "12px",
        minHeight: 0,
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minHeight: 0,
        },
      },
      ...props.projectItems.map((item: ProjectItem) =>
        React.createElement(ProjectListCard, {
          key: item.blockId,
          item,
          selected: item.blockId === selectedProjectId,
          onClick: () => setSelectedProjectId(item.blockId),
        }),
      ),
    ),
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          minHeight: 0,
          overflow: "auto",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            padding: "12px",
            borderRadius: "12px",
            border: "1px solid var(--orca-color-border-1, var(--orca-color-border))",
            background: "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: "17px",
                fontWeight: 700,
                color: "var(--orca-color-text-1, var(--orca-color-text))",
              },
            },
            selectedProjectTitle,
          ),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                color: "var(--orca-color-text-2)",
                fontSize: "12px",
              },
            },
            React.createElement("span", null, t("Total ${count} tasks", { count: String(totalTaskCount) })),
            React.createElement("span", null, t("Completed ${done}", { done: String(completedTaskCount) })),
            React.createElement("span", null, t("Manual ${count}", { count: String(manualTaskCount) })),
          ),
          React.createElement(
            "div",
            {
              style: {
                height: "6px",
                borderRadius: "999px",
                background: "rgba(148, 163, 184, 0.16)",
                overflow: "hidden",
                width: "min(420px, 100%)",
              },
            },
            React.createElement("div", {
              style: {
                width: `${progressPercent}%`,
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
              alignItems: "center",
              justifyContent: "flex-end",
            },
          },
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
              },
            },
            t("Add task"),
          ),
          React.createElement(
            Button,
            {
              variant: "outline",
              disabled: props.disabled || selectedProject == null || selectedTaskIds.length === 0,
              onClick: () => {
                if (selectedProject == null || selectedTaskIds.length === 0) {
                  return
                }

                void Promise.all(
                  selectedTaskIds.map((taskId: DbId) =>
                    addTaskToProjectInView({
                      blockId: taskId,
                      schema: props.schema,
                      projectIds: [selectedProject.blockId],
                    }),
                  ),
                ).then(() => {
                  setSelectedTaskIds([])
                  void props.onRefresh()
                }).catch((error) => {
                  console.error(error)
                  orca.notify("error", error instanceof Error ? error.message : t("Failed to add task"))
                })
              },
              style: {
                borderRadius: "8px",
              },
            },
            t("Manual add task"),
          ),
          React.createElement(
            "div",
            {
              style: {
                minWidth: "260px",
                maxWidth: "420px",
                flex: "1 1 280px",
              },
            },
            React.createElement(Select, {
              selected: selectedTaskIds.map((item: DbId) => String(item)),
              options: selectedProjectTaskOptions,
              multiSelection: true,
              filter: true,
              placeholder: t("Select tasks"),
              onChange: (selected: string[]) => {
                const normalized = selected
                  .map((item) => Number(item))
                  .filter((item): item is DbId => Number.isInteger(item) && item > 0)
                  .map((item) => getMirrorId(item))
                setSelectedTaskIds(Array.from(new Set(normalized)))
              },
              menuContainer: { current: document.body },
              width: "100%",
            }),
          ),
        ),
      ),
      selectedProject == null
        ? null
        : React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                minHeight: 0,
              },
            },
            renderStructureSection({
              title: t("Project structure"),
              tree: selectedProject.structuralTree,
              taskItemById: props.taskItemById,
              schema: props.schema,
              pluginName: props.pluginName,
              isChinese,
              loading: props.loading,
              disabled: props.disabled,
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
            renderManualSection({
              title: t("Manually added tasks"),
              taskIds: selectedProject.externalManualTaskIds,
              taskItemById: props.taskItemById,
              schema: props.schema,
              pluginName: props.pluginName,
              isChinese,
              loading: props.loading,
              disabled: props.disabled,
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
    ),
  )
}

function ProjectListCard(props: {
  item: ProjectItem
  selected: boolean
  onClick: () => void
}): React.ReactNode {
  const React = window.React
  return React.createElement(
    "button",
    {
      type: "button",
      onClick: props.onClick,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        minWidth: 0,
        padding: "11px 12px",
        borderRadius: "12px",
        border: props.selected
          ? "1px solid var(--orca-color-text-blue, #2563eb)"
          : "1px solid var(--orca-color-border-1, var(--orca-color-border))",
        background: props.selected
          ? "linear-gradient(150deg, rgba(37, 99, 235, 0.12), var(--orca-color-bg-1))"
          : "linear-gradient(150deg, var(--orca-color-bg-1), var(--orca-color-bg-2))",
        textAlign: "left",
        cursor: "pointer",
        color: "var(--orca-color-text-1, var(--orca-color-text))",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "8px",
        },
      },
      React.createElement(
        "div",
        {
          style: {
            minWidth: 0,
            fontSize: "13px",
            fontWeight: 650,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        },
        props.item.text,
      ),
      React.createElement(
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
    React.createElement(
      "div",
      {
        style: {
          height: "5px",
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
      React.createElement("span", null, t("Total ${count} tasks", { count: String(props.item.totalTaskCount) })),
      React.createElement("span", null, t("Manual ${count}", { count: String(props.item.externalManualTaskIds.length) })),
    ),
  )
}

function renderStructureSection(options: {
  title: string
  tree: ProjectStructureNode[]
  taskItemById: Map<DbId, AllTaskItem>
  schema: TaskSchemaDefinition
  pluginName: string
  isChinese: boolean
  loading: boolean
  disabled: boolean
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
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--orca-color-text-2)",
        },
      },
      options.title,
    ),
    options.tree.length === 0
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
          ...options.tree.map((node) => renderProjectStructureNode(node, 0, options)),
        ),
  )
}

function renderManualSection(options: {
  title: string
  taskIds: DbId[]
  taskItemById: Map<DbId, AllTaskItem>
  schema: TaskSchemaDefinition
  pluginName: string
  isChinese: boolean
  loading: boolean
  disabled: boolean
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
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--orca-color-text-2)",
        },
      },
      options.title,
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
          t("No manually added tasks"),
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

function renderProjectStructureNode(
  node: ProjectStructureNode,
  depth: number,
  options: {
    taskItemById: Map<DbId, AllTaskItem>
    schema: TaskSchemaDefinition
    pluginName: string
    isChinese: boolean
    loading: boolean
    disabled: boolean
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
  if (node.kind === "project") {
    return React.createElement(
      "div",
      {
        key: `project-${node.blockId}`,
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          marginLeft: `${depth * 16}px`,
          paddingLeft: depth > 0 ? "12px" : "0",
          borderLeft: depth > 0 ? "1px solid rgba(148, 163, 184, 0.18)" : "none",
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
          },
        },
        React.createElement(
          "div",
          {
            style: {
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            },
          },
          React.createElement("i", {
            className: "ti ti-folder",
            style: { fontSize: "14px", lineHeight: 1, color: "var(--orca-color-text-blue, #2563eb)" },
          }),
          React.createElement(
            "span",
            {
              style: {
                minWidth: 0,
                fontSize: "13px",
                fontWeight: 650,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            },
            node.text,
          ),
        ),
        React.createElement(
          "span",
          {
            style: {
              fontSize: "11px",
              color: "var(--orca-color-text-2)",
              whiteSpace: "nowrap",
            },
          },
          t("Project"),
        ),
      ),
      ...node.children.map((child) => renderProjectStructureNode(child, depth + 1, options)),
    )
  }

  const taskItem = options.taskItemById.get(node.blockId)
  if (taskItem == null) {
    return null
  }

  const rowItem: TaskListRowItem = taskItem
  const childNodes = node.children

  return React.createElement(
    "div",
    {
      key: `task-${node.blockId}`,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginLeft: `${depth * 16}px`,
      },
    },
    React.createElement(TaskListRow, {
      item: rowItem,
      schema: options.schema,
      isChinese: options.isChinese,
      rowIndex: depth,
      depth: 0,
      contextOnly: false,
      loading: options.loading,
      updating: options.disabled,
      showCollapseToggle: false,
      collapsed: false,
      showParentTaskContext: false,
      showReviewAction: false,
      showReviewSelection: false,
      reviewSelected: false,
      showSubtaskProgressBar: false,
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
    ...childNodes.map((child) => renderProjectStructureNode(child, depth + 1, options)),
  )
}

function renderTaskTreeNode(
  taskId: DbId,
  depth: number,
  options: {
    taskItemById: Map<DbId, AllTaskItem>
    schema: TaskSchemaDefinition
    pluginName: string
    isChinese: boolean
    loading: boolean
    disabled: boolean
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
      showSubtaskProgressBar: false,
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
    ...(taskItem.children ?? []).map((childTaskId) => renderTaskTreeNode(childTaskId, depth + 1, options)),
  )
}
