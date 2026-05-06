import type { Block, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

const TAG_REF_TYPE = 2

export const PROJECT_TAG_ALIAS = "Project"

export interface ProjectSchemaDefinition {
  tagAlias: string
}

export interface EnsureProjectSchemaResult {
  projectTagId: DbId
  schema: ProjectSchemaDefinition
  isNewTag: boolean
}

export function getProjectSchemaByAlias(
  projectTagAlias: string = PROJECT_TAG_ALIAS,
): ProjectSchemaDefinition {
  return {
    tagAlias: projectTagAlias,
  }
}

export async function ensureProjectTagSchema(
  _locale: string,
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

  return {
    projectTagId: projectBlock.id,
    schema: getProjectSchemaByAlias(projectTagAlias),
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
