import type { Block, BlockProperty, DbId } from "../orca.d.ts"

// 任务标签固定别名：后续阶段可在设置中开放自定义
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

interface TaskSchemaPropertyNames {
  status: string
  startTime: string
  endTime: string
  importance: string
  urgency: string
  effort: string
  dependsOn: string
  dependsMode: string
  dependencyDelay: string
  star: string
  repeatRule: string
}

export interface TaskSchemaDefinition {
  locale: TaskSchemaLocale
  tagAlias: string
  propertyNames: TaskSchemaPropertyNames
  statusChoices: [string, string, string]
  dependencyModeChoices: [DependencyMode, DependencyMode]
}

const TASK_SCHEMA_BY_LOCALE: Record<TaskSchemaLocale, TaskSchemaDefinition> = {
  en: {
    locale: "en",
    tagAlias: TASK_TAG_ALIAS,
    propertyNames: {
      status: "Status",
      startTime: "Start time",
      endTime: "End time",
      importance: "Importance",
      urgency: "Urgency",
      effort: "Effort",
      dependsOn: "Depends on",
      dependsMode: "Depends mode",
      dependencyDelay: "Dependency delay",
      star: "Star",
      repeatRule: "Repeat rule",
    },
    statusChoices: ["TODO", "Doing", "Done"],
    dependencyModeChoices: ["ALL", "ANY"],
  },
  "zh-CN": {
    locale: "zh-CN",
    tagAlias: TASK_TAG_ALIAS,
    propertyNames: {
      status: "状态",
      startTime: "开始时间",
      endTime: "结束时间",
      importance: "重要性",
      urgency: "紧急度",
      effort: "工作量",
      dependsOn: "依赖任务",
      dependsMode: "依赖模式",
      dependencyDelay: "依赖延迟",
      star: "收藏",
      repeatRule: "重复规则",
    },
    statusChoices: ["待开始", "进行中", "已完成"],
    dependencyModeChoices: ["ALL", "ANY"],
  },
}

export interface EnsureTaskSchemaResult {
  taskTagId: DbId
  schemaLocale: TaskSchemaLocale
  schema: TaskSchemaDefinition
  isNewTag: boolean
}

export function getTaskSchemaByLocale(locale: string): TaskSchemaDefinition {
  return locale === "zh-CN"
    ? TASK_SCHEMA_BY_LOCALE["zh-CN"]
    : TASK_SCHEMA_BY_LOCALE.en
}

export async function ensureTaskTagSchema(
  locale: string,
): Promise<EnsureTaskSchemaResult> {
  let taskBlock = (await orca.invokeBackend(
    "get-block-by-alias",
    TASK_TAG_ALIAS,
  )) as Block | null

  const isNewTag = taskBlock == null
  if (isNewTag) {
    await orca.commands.invokeGroup(async () => {
      const taskBlockId = (await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        null,
        null,
        [{ t: "t", v: TASK_TAG_ALIAS }],
      )) as DbId

      await orca.commands.invokeEditorCommand(
        "core.editor.createAlias",
        null,
        TASK_TAG_ALIAS,
        taskBlockId,
      )
    })

    taskBlock = (await orca.invokeBackend(
      "get-block-by-alias",
      TASK_TAG_ALIAS,
    )) as Block | null
  }

  if (taskBlock == null) {
    throw new Error("初始化任务标签失败：未找到 Task 标签块")
  }

  // 已存在任务 schema 时沿用既有命名，避免切换语言后自动改写历史属性
  const existingSchema = detectSchemaFromProperties(taskBlock.properties)
  const targetSchema = existingSchema ?? getTaskSchemaByLocale(locale)

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [taskBlock.id],
    buildTaskTagProperties(targetSchema, taskBlock.properties),
  )

  return {
    taskTagId: taskBlock.id,
    schemaLocale: targetSchema.locale,
    schema: targetSchema,
    isNewTag,
  }
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
  const findProperty = (name: string) => {
    return existingProperties?.find((property) => property.name === name)
  }
  const findPos = (name: string) => {
    return findProperty(name)?.pos
  }

  return [
    {
      name: names.status,
      type: PROP_TYPE.TEXT_CHOICES,
      typeArgs: {
        subType: "single",
        choices: schema.statusChoices,
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
      name: names.importance,
      type: PROP_TYPE.NUMBER,
      pos: findPos(names.importance),
    },
    {
      name: names.urgency,
      type: PROP_TYPE.NUMBER,
      pos: findPos(names.urgency),
    },
    {
      name: names.effort,
      type: PROP_TYPE.NUMBER,
      pos: findPos(names.effort),
    },
    {
      name: names.dependsOn,
      type: PROP_TYPE.BLOCK_REFS,
      pos: findPos(names.dependsOn),
    },
    {
      name: names.dependsMode,
      type: PROP_TYPE.TEXT_CHOICES,
      typeArgs: {
        subType: "single",
        choices: schema.dependencyModeChoices,
      },
      pos: findPos(names.dependsMode),
    },
    {
      name: names.dependencyDelay,
      type: PROP_TYPE.NUMBER,
      pos: findPos(names.dependencyDelay),
    },
    {
      name: names.star,
      type: PROP_TYPE.BOOLEAN,
      pos: findPos(names.star),
    },
    {
      name: names.repeatRule,
      type: PROP_TYPE.TEXT,
      pos: findPos(names.repeatRule),
    },
  ]
}
