import type { Block, ContentFragment, DbId } from "../orca.d.ts"
import { getMirrorId } from "./block-utils"
import { toRefDataForSave, type TaskPropertyValues } from "./task-properties"
import type { TaskSchemaDefinition } from "./task-schema"
import { buildNextRecurringTaskValues } from "./task-repeat"
import { t } from "../libs/l10n"

const TAG_TOKEN_PREFIX = "#"

export async function createRecurringTaskInTodayJournal(
  previousStatus: string,
  nextValues: TaskPropertyValues,
  sourceBlockId: DbId,
  schema: TaskSchemaDefinition,
  now: Date = new Date(),
): Promise<boolean> {
  const recurringValues = buildNextRecurringTaskValues(
    previousStatus,
    nextValues,
    schema,
    now,
  )
  if (recurringValues == null) {
    return false
  }

  const journalBlock = (await orca.invokeBackend(
    "get-journal-block",
    now,
  )) as Block | null
  if (journalBlock == null) {
    return false
  }

  const sourceBlock =
    orca.state.blocks[getMirrorId(sourceBlockId)] ??
    orca.state.blocks[sourceBlockId] ??
    null
  const content = buildRecurringTaskContent(sourceBlock, schema.tagAlias)
  const payload = toRefDataForSave(recurringValues, schema)

  await orca.commands.invokeGroup(async () => {
    const createdBlockId = (await orca.commands.invokeEditorCommand(
      "core.editor.insertBlock",
      null,
      journalBlock,
      "lastChild",
      content,
    )) as DbId

    await orca.commands.invokeEditorCommand(
      "core.editor.insertTag",
      null,
      createdBlockId,
      schema.tagAlias,
      payload,
    )
  })

  return true
}

function buildRecurringTaskContent(
  sourceBlock: Block | null,
  taskTagAlias: string,
): ContentFragment[] {
  const text = resolveSourceTaskText(sourceBlock, taskTagAlias)
  return [{ t: "t", v: text === "" ? t("(Untitled task)") : text }]
}

function resolveSourceTaskText(
  sourceBlock: Block | null,
  taskTagAlias: string,
): string {
  if (sourceBlock == null) {
    return ""
  }

  if (typeof sourceBlock.text === "string" && sourceBlock.text.trim() !== "") {
    return stripTaskTag(sourceBlock.text, taskTagAlias)
  }

  if (!Array.isArray(sourceBlock.content) || sourceBlock.content.length === 0) {
    return ""
  }

  const plainText = sourceBlock.content
    .map((fragment) => (typeof fragment.v === "string" ? fragment.v : ""))
    .join("")
    .trim()

  return stripTaskTag(plainText, taskTagAlias)
}

function stripTaskTag(text: string, taskTagAlias: string): string {
  const trimmed = text.trim()
  if (trimmed === "") {
    return ""
  }

  const escapedAlias = taskTagAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const withTaskTagRemoved = trimmed
    .replace(
      new RegExp(`(^|\\s)${escapeRegExp(TAG_TOKEN_PREFIX)}${escapedAlias}(?=\\s|$)`, "gi"),
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()

  return withTaskTagRemoved
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
