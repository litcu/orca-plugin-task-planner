import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

const TAG_REF_TYPE = 2
const PROP_TYPE = {
  TEXT: 1,
  DATE_TIME: 5,
  TEXT_CHOICES: 6,
} as const

export const PROJECT_TAG_ALIAS = "Project"

export type ProjectSchemaLocale = "en" | "zh-CN"

export interface ProjectSchemaPropertyNames {
  status: string
  startTime: string
  dueTime: string
  labels: string
  note: string
}

export interface ProjectSchemaDefinition {
  locale: ProjectSchemaLocale
  tagAlias: string
  propertyNames: ProjectSchemaPropertyNames
  statusChoices: [string, string, string, string]
}

export interface EnsureProjectSchemaResult {
  projectTagId: DbId
  schema: ProjectSchemaDefinition
  isNewTag: boolean
}

const PROJECT_SCHEMA_BY_LOCALE: Record<ProjectSchemaLocale, ProjectSchemaDefinition> = {
  en: {
    locale: "en",
    tagAlias: PROJECT_TAG_ALIAS,
    propertyNames: {
      status: "Project status",
      startTime: "Project start date",
      dueTime: "Project due date",
      labels: "Project labels",
      note: "Project note",
    },
    statusChoices: ["Not Started", "In Progress", "Suspended", "Completed"],
  },
  "zh-CN": {
    locale: "zh-CN",
    tagAlias: PROJECT_TAG_ALIAS,
    propertyNames: {
      status: "\u9879\u76ee\u72b6\u6001",
      startTime: "\u9879\u76ee\u5f00\u59cb\u65e5\u671f",
      dueTime: "\u9879\u76ee\u622a\u6b62\u65e5\u671f",
      labels: "\u9879\u76ee\u6807\u7b7e",
      note: "\u9879\u76ee\u5907\u6ce8",
    },
    statusChoices: ["\u672a\u5f00\u59cb", "\u8fdb\u884c\u4e2d", "\u5df2\u6682\u505c", "\u5df2\u5b8c\u6210"],
  },
}

export function getProjectSchemaByAlias(
  locale: string = "en",
  projectTagAlias: string = PROJECT_TAG_ALIAS,
): ProjectSchemaDefinition {
  const schema = locale === "zh-CN"
    ? PROJECT_SCHEMA_BY_LOCALE["zh-CN"]
    : PROJECT_SCHEMA_BY_LOCALE.en

  return withProjectTagAlias(schema, projectTagAlias)
}

export async function ensureProjectTagSchema(
  locale: string,
  projectTagAlias: string = PROJECT_TAG_ALIAS,
): Promise<EnsureProjectSchemaResult> {
  let projectBlock = (await orca.invokeBackend(
    "get-block-by-alias",
    projectTagAlias,
  )) as Block | null

  const isNewTag = projectBlock == null
  if (isNewTag) {
    await orca.commands.invokeGroup(async () => {
      const projectBlockId = (await orca.commands.invokeEditorCommand(
        "core.editor.insertBlock",
        null,
        null,
        null,
        [{ t: "t", v: projectTagAlias }],
      )) as DbId

      await orca.commands.invokeEditorCommand(
        "core.editor.createAlias",
        null,
        projectTagAlias,
        projectBlockId,
      )
    })

    projectBlock = (await orca.invokeBackend(
      "get-block-by-alias",
      projectTagAlias,
    )) as Block | null
  }

  if (projectBlock == null) {
    throw new Error(t("Failed to initialize project tag: ${name}", { name: projectTagAlias }))
  }

  const existingSchema = detectSchemaFromProperties(projectBlock.properties)
  const targetSchema = withProjectTagAlias(
    existingSchema ?? getProjectSchemaByAlias(locale, projectTagAlias),
    projectTagAlias,
  )

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [projectBlock.id],
    buildProjectTagProperties(targetSchema, projectBlock.properties),
  )

  return {
    projectTagId: projectBlock.id,
    schema: targetSchema,
    isNewTag,
  }
}

export function hasProjectTagRef(
  block: Block | null | undefined,
  projectTagAlias: string = PROJECT_TAG_ALIAS,
): boolean {
  if (block == null) {
    return false
  }

  return block.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === projectTagAlias)
}

export function getDefaultProjectStatus(schema: ProjectSchemaDefinition): string {
  return schema.statusChoices[0]
}

export function getProjectStatusChoices(schema: ProjectSchemaDefinition): string[] {
  return [...schema.statusChoices]
}

function withProjectTagAlias(
  schema: ProjectSchemaDefinition,
  projectTagAlias: string,
): ProjectSchemaDefinition {
  return {
    ...schema,
    tagAlias: projectTagAlias,
    propertyNames: { ...schema.propertyNames },
    statusChoices: [...schema.statusChoices] as [string, string, string, string],
  }
}

function detectSchemaFromProperties(
  properties: BlockProperty[] | undefined,
): ProjectSchemaDefinition | null {
  if (properties == null || properties.length === 0) {
    return null
  }

  const names = new Set(properties.map((property) => property.name))
  let bestSchema: ProjectSchemaDefinition | null = null
  let bestScore = 0

  for (const schema of Object.values(PROJECT_SCHEMA_BY_LOCALE)) {
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

function buildProjectTagProperties(
  schema: ProjectSchemaDefinition,
  existingProperties: BlockProperty[] | undefined,
): BlockProperty[] {
  const names = schema.propertyNames
  const [defaultStatus] = schema.statusChoices
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

      const key = choice.toLowerCase()
      if (seen.has(key)) {
        continue
      }

      seen.add(key)
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
      name: names.dueTime,
      type: PROP_TYPE.DATE_TIME,
      typeArgs: { subType: "datetime" },
      pos: findPos(names.dueTime),
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
      name: names.note,
      type: PROP_TYPE.TEXT,
      pos: findPos(names.note),
    },
  ]
}
