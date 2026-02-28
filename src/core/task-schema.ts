import type { Block, BlockProperty, DbId } from "../orca.d.ts"

export const TASK_TAG_ALIAS = "Task"

export type DependencyMode = "ALL" | "ANY"
export type TaskSchemaLocale = "en" | "zh-CN"

const PROP_TYPE = {
  TEXT: 1,
  BLOCK_REFS: 2,
  NUMBER: 3,
  BOOLEAN: 4,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

export const DEFAULT_TASK_SCORE = 50
export const DEFAULT_TASK_DEPENDENCY_DELAY = 0

interface TaskSchemaPropertyNames {
  status: string
  startTime: string
  endTime: string
  dependsOn: string
  dependsMode: string
  dependencyDelay: string
  star: string
  labels: string
  remark: string
}

export interface TaskSchemaDefinition {
  locale: TaskSchemaLocale
  tagAlias: string
  propertyNames: TaskSchemaPropertyNames
  statusChoices: [string, string, string, string]
  dependencyModeChoices: [DependencyMode, DependencyMode]
}

export interface TaskStatusValues {
  todo: string
  doing: string
  waiting: string
  done: string
}

const TASK_SCHEMA_BY_LOCALE: Record<TaskSchemaLocale, TaskSchemaDefinition> = {
  en: {
    locale: "en",
    tagAlias: TASK_TAG_ALIAS,
    propertyNames: {
      status: "Status",
      startTime: "Start time",
      endTime: "End time",
      dependsOn: "Depends on",
      dependsMode: "Depends mode",
      dependencyDelay: "Dependency delay",
      star: "Star",
      labels: "Labels",
      remark: "Remark",
    },
    statusChoices: ["TODO", "Doing", "Waiting", "Done"],
    dependencyModeChoices: ["ALL", "ANY"],
  },
  "zh-CN": {
    locale: "zh-CN",
    tagAlias: TASK_TAG_ALIAS,
    propertyNames: {
      status: "\u72b6\u6001",
      startTime: "\u5f00\u59cb\u65f6\u95f4",
      endTime: "\u7ed3\u675f\u65f6\u95f4",
      dependsOn: "\u4f9d\u8d56\u4efb\u52a1",
      dependsMode: "\u4f9d\u8d56\u6a21\u5f0f",
      dependencyDelay: "\u4f9d\u8d56\u5ef6\u8fdf",
      star: "\u6536\u85cf",
      labels: "\u6807\u7b7e",
      remark: "\u5907\u6ce8",
    },
    statusChoices: ["\u5f85\u5f00\u59cb", "\u8fdb\u884c\u4e2d", "\u7b49\u5f85\u4e2d", "\u5df2\u5b8c\u6210"],
    dependencyModeChoices: ["ALL", "ANY"],
  },
}

const RETIRED_TASK_PROPERTY_NAMES = [
  "Review",
  "\u56de\u987e",
  "Importance",
  "\u91cd\u8981\u6027",
  "Urgency",
  "\u7d27\u6025\u5ea6",
  "Effort",
  "\u5de5\u4f5c\u91cf",
  "Repeat rule",
  "\u91cd\u590d\u89c4\u5219",
]

export interface EnsureTaskSchemaResult {
  taskTagId: DbId
  schemaLocale: TaskSchemaLocale
  schema: TaskSchemaDefinition
  isNewTag: boolean
}

export function getTaskSchemaByLocale(
  locale: string,
  taskTagAlias: string = TASK_TAG_ALIAS,
): TaskSchemaDefinition {
  const schema = locale === "zh-CN"
    ? TASK_SCHEMA_BY_LOCALE["zh-CN"]
    : TASK_SCHEMA_BY_LOCALE.en

  return withTaskTagAlias(schema, taskTagAlias)
}

export async function ensureTaskTagSchema(
  locale: string,
  taskTagAlias: string = TASK_TAG_ALIAS,
): Promise<EnsureTaskSchemaResult> {
  let taskBlock = (await orca.invokeBackend(
    "get-block-by-alias",
    taskTagAlias,
  )) as Block | null

  const isNewTag = taskBlock == null
  if (isNewTag) {
    await orca.commands.invokeGroup(async () => {
      const taskBlockId = (await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        null,
        null,
        [{ t: "t", v: taskTagAlias }],
      )) as DbId

      await orca.commands.invokeEditorCommand(
        "core.editor.createAlias",
        null,
        taskTagAlias,
        taskBlockId,
      )
    })

    taskBlock = (await orca.invokeBackend(
      "get-block-by-alias",
      taskTagAlias,
    )) as Block | null
  }

  if (taskBlock == null) {
    throw new Error(`Failed to initialize task tag: ${taskTagAlias}`)
  }

  const existingSchema = detectSchemaFromProperties(taskBlock.properties)
  const targetSchema = withTaskTagAlias(
    existingSchema ?? getTaskSchemaByLocale(locale),
    taskTagAlias,
  )

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [taskBlock.id],
    buildTaskTagProperties(targetSchema, taskBlock.properties),
  )

  await orca.commands.invokeEditorCommand(
    "core.editor.deleteProperties",
    null,
    [taskBlock.id],
    RETIRED_TASK_PROPERTY_NAMES,
  )

  return {
    taskTagId: taskBlock.id,
    schemaLocale: targetSchema.locale,
    schema: targetSchema,
    isNewTag,
  }
}

function withTaskTagAlias(
  schema: TaskSchemaDefinition,
  taskTagAlias: string,
): TaskSchemaDefinition {
  return {
    ...schema,
    tagAlias: taskTagAlias,
    propertyNames: { ...schema.propertyNames },
    statusChoices: [...schema.statusChoices] as [string, string, string, string],
    dependencyModeChoices: [...schema.dependencyModeChoices] as [
      DependencyMode,
      DependencyMode,
    ],
  }
}

export function getTaskStatusValues(schema: TaskSchemaDefinition): TaskStatusValues {
  const [todo, doing, waiting, done] = schema.statusChoices
  return {
    todo,
    doing,
    waiting,
    done,
  }
}

export function getDefaultTaskStatus(schema: TaskSchemaDefinition): string {
  return schema.statusChoices[0]
}

export function isTaskDoingStatus(
  status: string,
  schema: TaskSchemaDefinition,
): boolean {
  return status === getTaskStatusValues(schema).doing
}

export function isTaskWaitingStatus(
  status: string,
  schema: TaskSchemaDefinition,
): boolean {
  return status === getTaskStatusValues(schema).waiting
}

export function isTaskDoneStatus(
  status: string,
  schema: TaskSchemaDefinition,
): boolean {
  return status === getTaskStatusValues(schema).done
}

export function getNextTaskStatusInMainCycle(
  currentStatus: string | null,
  schema: TaskSchemaDefinition,
): string {
  const { todo, doing, done } = getTaskStatusValues(schema)

  if (currentStatus === todo) {
    return doing
  }
  if (currentStatus === doing) {
    return done
  }
  if (currentStatus === done) {
    return todo
  }

  return todo
}

function detectSchemaFromProperties(
  properties: BlockProperty[] | undefined,
): TaskSchemaDefinition | null {
  if (properties == null || properties.length === 0) {
    return null
  }

  const names = new Set(properties.map((property) => property.name))
  let bestSchema: TaskSchemaDefinition | null = null
  let bestScore = 0

  for (const schema of Object.values(TASK_SCHEMA_BY_LOCALE)) {
    const score = Object.values(schema.propertyNames).reduce((total, name) => {
      return names.has(name) ? total + 1 : total
    }, 0)

    if (score > bestScore) {
      bestSchema = schema
      bestScore = score
    }
  }

  return bestScore > 0 ? bestSchema : null
}

function buildTaskTagProperties(
  schema: TaskSchemaDefinition,
  existingProperties: BlockProperty[] | undefined,
): BlockProperty[] {
  const names = schema.propertyNames
  const [defaultStatus] = schema.statusChoices
  const [defaultDependsMode] = schema.dependencyModeChoices
  const tagScope = schema.tagAlias
  const findProperty = (name: string) => {
    return existingProperties?.find((property) => property.name === name)
  }
  const findPos = (name: string) => {
    return findProperty(name)?.pos
  }
  const findChoiceValues = (name: string): string[] => {
    const property = findProperty(name)
    const rawChoices = property?.typeArgs?.choices
    if (!Array.isArray(rawChoices)) {
      return []
    }

    const normalizedChoices: string[] = []
    const seen = new Set<string>()
    for (const rawChoice of rawChoices) {
      const value = typeof rawChoice === "string"
        ? rawChoice
        : typeof rawChoice?.n === "string"
          ? rawChoice.n
          : ""
      const choice = value.trim()
      if (choice === "") {
        continue
      }

      const dedupKey = choice.toLowerCase()
      if (seen.has(dedupKey)) {
        continue
      }

      seen.add(dedupKey)
      normalizedChoices.push(choice)
    }

    return normalizedChoices
  }

  return [
    {
      name: names.status,
      type: PROP_TYPE.TEXT_CHOICES,
      typeArgs: {
        subType: "single",
        choices: schema.statusChoices,
        defaultEnabled: true,
        default: defaultStatus,
      },
      pos: findPos(names.status),
    },
    {
      name: names.startTime,
      type: PROP_TYPE.DATE_TIME,
      typeArgs: { subType: "datetime" },
      pos: findPos(names.startTime),
    },
    {
      name: names.endTime,
      type: PROP_TYPE.DATE_TIME,
      typeArgs: { subType: "datetime" },
      pos: findPos(names.endTime),
    },
    {
      name: names.dependsOn,
      type: PROP_TYPE.BLOCK_REFS,
      typeArgs: {
        scope: tagScope,
      },
      pos: findPos(names.dependsOn),
    },
    {
      name: names.dependsMode,
      type: PROP_TYPE.TEXT_CHOICES,
      typeArgs: {
        subType: "single",
        choices: schema.dependencyModeChoices,
        defaultEnabled: true,
        default: defaultDependsMode,
      },
      pos: findPos(names.dependsMode),
    },
    {
      name: names.dependencyDelay,
      type: PROP_TYPE.NUMBER,
      typeArgs: {
        defaultEnabled: true,
        default: DEFAULT_TASK_DEPENDENCY_DELAY,
      },
      pos: findPos(names.dependencyDelay),
    },
    {
      name: names.star,
      type: PROP_TYPE.BOOLEAN,
      pos: findPos(names.star),
    },
    {
      name: names.labels,
      type: PROP_TYPE.TEXT_CHOICES,
      typeArgs: {
        subType: "multi",
        choices: findChoiceValues(names.labels),
      },
      pos: findPos(names.labels),
    },
    {
      name: names.remark,
      type: PROP_TYPE.TEXT,
      pos: findPos(names.remark),
    },
  ]
}
