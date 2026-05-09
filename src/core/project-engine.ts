import type { Block, BlockProperty, DbId } from "../orca.d.ts"
import { getMirrorId, getMirrorIdFromBlock, isValidDbId } from "./block-utils"
import { collectAllTasks, type AllTaskItem } from "./all-tasks-engine"
import { hasProjectTagRef, type ProjectSchemaDefinition } from "./project-schema"
import {
  getProjectPropertiesFromRef,
  mergeProjectLabelValues,
  readProjectLabelChoiceValues,
  toProjectRefDataForSave,
  type ProjectPropertyValues,
} from "./project-properties"
import { getTaskPropertiesFromRef, toRefDataForSave, type TaskPropertyValues } from "./task-properties"
import { isTaskCanceledStatus, isTaskDoneStatus, type TaskSchemaDefinition } from "./task-schema"

const TAG_REF_TYPE = 2
const REF_DATA_TYPE = 3
const TEXT_CHOICES_PROP_TYPE = 6

export interface ProjectStructureNode {
  kind: "project" | "task"
  blockId: DbId
  sourceBlockId: DbId
  text: string
  status?: string
  children: ProjectStructureNode[]
}

export interface ProjectItem {
  blockId: DbId
  sourceBlockId: DbId
  text: string
  properties: ProjectPropertyValues
  structuralTree: ProjectStructureNode[]
  taskIds: DbId[]
  structuralTaskIds: DbId[]
  manualRootTaskIds: DbId[]
  manualTaskIds: DbId[]
  externalManualTaskIds: DbId[]
  childProjectIds: DbId[]
  totalTaskCount: number
  completedTaskCount: number
  canceledTaskCount: number
  progress: number
}

export interface ProjectDatasetSnapshot {
  projectBlocks: Block[]
  projectItems: ProjectItem[]
  allTasks: AllTaskItem[]
}

export async function collectProjectDatasetSnapshot(
  schema: TaskSchemaDefinition,
  projectSchema: ProjectSchemaDefinition,
): Promise<ProjectDatasetSnapshot> {
  const rawProjectBlocks = (await orca.invokeBackend("get-blocks-with-tags", [
    projectSchema.tagAlias,
  ])) as Block[]
  const projectBlocks = rawProjectBlocks.filter((block) => {
    return hasProjectTagRef(block, projectSchema.tagAlias)
  })
  const allTasks = await collectAllTasks(schema)
  const taskById = new Map<DbId, AllTaskItem>()
  for (const item of allTasks) {
    taskById.set(item.blockId, item)
  }

  const projectIdSet = new Set<DbId>(
    projectBlocks.map((block) => getMirrorIdFromBlock(block)),
  )
  const taskChildrenById = new Map<DbId, DbId[]>()
  for (const item of allTasks) {
    taskChildrenById.set(item.blockId, [...item.children])
  }

  const projectItems: ProjectItem[] = []
  const blockCacheById = new Map<DbId, Block | null>()
  const sortedProjectBlocks = [...projectBlocks].sort((left, right) => {
    const leftId = getMirrorIdFromBlock(left)
    const rightId = getMirrorIdFromBlock(right)
    return leftId - rightId
  })

  for (const projectBlock of sortedProjectBlocks) {
    cacheBlockByKnownIds(projectBlock, blockCacheById)
    const projectId = getMirrorIdFromBlock(projectBlock)
    const projectRef = findProjectTagRef(projectBlock, projectSchema.tagAlias)
    const structuralTaskIds = new Set<DbId>()
    const childProjectIds = new Set<DbId>()
    const structuralTree = await collectProjectStructureNodes({
      rootProjectId: projectId,
      block: projectBlock,
      projectIdSet: projectIdSet,
      taskById,
      schema,
      blockCacheById,
      structuralTaskIds,
      childProjectIds,
      visited: new Set<DbId>(),
    })
    const directManualTaskIds = await collectDirectProjectTaskIds(
      projectId,
      allTasks,
      blockCacheById,
    )
    const manualRootTaskIds = directManualTaskIds.filter((taskId) => !structuralTaskIds.has(taskId))
    const manualTaskIds = collectTaskDescendants(manualRootTaskIds, taskChildrenById)
    const totalTaskIds = dedupeDbIdSet([
      ...structuralTaskIds,
      ...manualTaskIds,
    ])
    const completedTaskCount = totalTaskIds.filter((taskId) => {
      const task = taskById.get(taskId)
      return task != null && isTaskDoneStatus(task.status, schema)
    }).length
    const canceledTaskCount = totalTaskIds.filter((taskId) => {
      const task = taskById.get(taskId)
      return task != null && isTaskCanceledStatus(task.status)
    }).length

    projectItems.push({
      blockId: projectId,
      sourceBlockId: projectBlock.id,
      text: resolveProjectText(projectBlock, projectSchema.tagAlias),
      properties: getProjectPropertiesFromRef(projectRef?.data, projectSchema),
      structuralTree,
      taskIds: totalTaskIds,
      structuralTaskIds: [...structuralTaskIds].sort((left, right) => left - right),
      manualRootTaskIds,
      manualTaskIds,
      externalManualTaskIds: manualRootTaskIds,
      childProjectIds: [...childProjectIds].sort((left, right) => left - right),
      totalTaskCount: totalTaskIds.length,
      completedTaskCount,
      canceledTaskCount,
      progress: totalTaskIds.length === 0 ? 0 : completedTaskCount / totalTaskIds.length,
    })
  }

  return {
    projectBlocks,
    projectItems,
    allTasks,
  }
}

export async function addTaskToProjectInView(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  schema: TaskSchemaDefinition
  projectIds: DbId[]
}): Promise<void> {
  const target = await resolveTaskBlockForProjectAssignment(
    options.blockId,
    options.sourceBlockId,
    options.schema,
  )
  const currentValues = getTaskPropertiesFromRef(target.taskRef?.data, options.schema, target.liveBlock)
  const nextProjectRefIds = await ensureProjectRefIds(
    target.writableBlockId,
    options.projectIds,
  )
  const nextValues: TaskPropertyValues = {
    ...currentValues,
    projects: nextProjectRefIds,
  }
  const payload = toRefDataForSave(nextValues, options.schema, {
    existingRefData: target.taskRef?.data,
  })

  if (target.taskRef != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        target.taskRef,
        payload,
      )
      return
    } catch (error) {
      console.error(error)
    }
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    target.writableBlockId,
    options.schema.tagAlias,
    payload,
  )
}

export async function saveProjectPropertiesInView(options: {
  blockId: DbId
  sourceBlockId?: DbId | null
  projectSchema: ProjectSchemaDefinition
  values: ProjectPropertyValues
}): Promise<void> {
  const target = await resolveProjectBlockForProperties(
    options.blockId,
    options.sourceBlockId,
    options.projectSchema,
  )
  const normalizedLabels = mergeProjectLabelValues(
    options.values.labels,
    collectProjectLabelValuesFromBlockTags(target.liveBlock, options.projectSchema.tagAlias),
  )
  await ensureProjectLabelChoices(options.projectSchema, normalizedLabels)
  const payload = toProjectRefDataForSave(
    {
      ...options.values,
      labels: normalizedLabels,
    },
    options.projectSchema,
    target.projectRef?.data,
  )

  if (target.projectRef != null) {
    try {
      await orca.commands.invokeEditorCommand(
        "core.editor.setRefData",
        null,
        cloneProjectRefForCommand(target.projectRef),
        toProjectRefDataCommandPayload(payload),
      )
      return
    } catch (error) {
      console.error(error)
    }
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.insertTag",
    null,
    target.writableBlockId,
    options.projectSchema.tagAlias,
    toProjectRefDataCommandPayload(payload),
  )
}

interface ResolvedTaskAssignmentTarget {
  writableBlockId: DbId
  sourceBlock: Block
  liveBlock: Block
  taskRef: ReturnType<typeof findTaskTagRef>
}

interface ResolvedProjectPropertiesTarget {
  writableBlockId: DbId
  sourceBlock: Block
  liveBlock: Block
  projectRef: ReturnType<typeof findProjectTagRef>
}

async function collectProjectStructureNodes(options: {
  rootProjectId: DbId
  block: Block
  projectIdSet: Set<DbId>
  taskById: Map<DbId, AllTaskItem>
  schema: TaskSchemaDefinition
  blockCacheById: Map<DbId, Block | null>
  structuralTaskIds: Set<DbId>
  childProjectIds: Set<DbId>
  visited: Set<DbId>
}): Promise<ProjectStructureNode[]> {
  const result: ProjectStructureNode[] = []

  for (const childId of options.block.children) {
    const childNodes = await visitProjectStructureBlock({
      rootProjectId: options.rootProjectId,
      blockId: getMirrorId(childId),
      projectIdSet: options.projectIdSet,
      taskById: options.taskById,
      schema: options.schema,
      blockCacheById: options.blockCacheById,
      structuralTaskIds: options.structuralTaskIds,
      childProjectIds: options.childProjectIds,
      visited: options.visited,
    })
    result.push(...childNodes)
  }

  return result
}

async function visitProjectStructureBlock(options: {
  rootProjectId: DbId
  blockId: DbId
  projectIdSet: Set<DbId>
  taskById: Map<DbId, AllTaskItem>
  schema: TaskSchemaDefinition
  blockCacheById: Map<DbId, Block | null>
  structuralTaskIds: Set<DbId>
  childProjectIds: Set<DbId>
  visited: Set<DbId>
}): Promise<ProjectStructureNode[]> {
  const normalizedBlockId = getMirrorId(options.blockId)
  if (options.visited.has(normalizedBlockId)) {
    return []
  }

  options.visited.add(normalizedBlockId)
  const block = await getBlockByIdWithCache(normalizedBlockId, options.blockCacheById)
  if (block == null) {
    return []
  }

  const nestedNodes = await collectProjectStructureNodes({
    rootProjectId: options.rootProjectId,
    block,
    projectIdSet: options.projectIdSet,
    taskById: options.taskById,
    schema: options.schema,
    blockCacheById: options.blockCacheById,
    structuralTaskIds: options.structuralTaskIds,
    childProjectIds: options.childProjectIds,
    visited: options.visited,
  })

  const blockProjectId = getMirrorIdFromBlock(block)
  if (options.projectIdSet.has(blockProjectId)) {
    if (blockProjectId !== options.rootProjectId) {
      options.childProjectIds.add(blockProjectId)
    }

    return [{
      kind: "project",
      blockId: blockProjectId,
      sourceBlockId: block.id,
      text: resolveProjectText(block, options.schema.projectTagAlias),
      children: nestedNodes,
    }]
  }

  const taskItem = options.taskById.get(blockProjectId) ?? null
  if (taskItem != null) {
    options.structuralTaskIds.add(taskItem.blockId)
    return [{
      kind: "task",
      blockId: taskItem.blockId,
      sourceBlockId: taskItem.sourceBlockId,
      text: taskItem.text,
      status: taskItem.status,
      children: nestedNodes,
    }]
  }

  return nestedNodes
}

async function collectDirectProjectTaskIds(
  projectId: DbId,
  allTasks: AllTaskItem[],
  blockCacheById: Map<DbId, Block | null>,
): Promise<DbId[]> {
  const directTaskIds: DbId[] = []

  for (const item of allTasks) {
    const sourceBlock =
      (await getBlockByIdWithCache(item.sourceBlockId, blockCacheById)) ??
      (await getBlockByIdWithCache(item.blockId, blockCacheById))
    const projectIds = resolveTaskProjectBlockIds(item, sourceBlock)
    if (projectIds.includes(projectId)) {
      directTaskIds.push(item.blockId)
    }
  }

  return dedupeDbIdSet(directTaskIds)
}

function resolveTaskProjectBlockIds(
  taskItem: AllTaskItem,
  sourceBlock: Block | null,
): DbId[] {
  const projectIds: DbId[] = []
  if (sourceBlock == null) {
    return dedupeDbIdSet([...taskItem.projects].map((item) => getMirrorId(item)))
  }

  for (const projectRefId of taskItem.projects) {
    const matchedRef = sourceBlock.refs.find((ref) => ref.id === projectRefId)
    const targetProjectId = isValidDbId(matchedRef?.to)
      ? getMirrorId(matchedRef.to)
      : getMirrorId(projectRefId)
    if (isValidDbId(targetProjectId)) {
      projectIds.push(targetProjectId)
    }
  }

  return dedupeDbIdSet(projectIds)
}

async function ensureProjectRefIds(
  sourceBlockId: DbId,
  targetProjectIds: DbId[],
): Promise<DbId[]> {
  const normalizedSourceBlockId = getMirrorId(sourceBlockId)
  if (!isValidDbId(normalizedSourceBlockId)) {
    return []
  }

  const sourceBlock = await getBlockByIdWithCache(normalizedSourceBlockId, new Map<DbId, Block | null>())
  const resolvedRefIds: DbId[] = []
  for (const rawTargetProjectId of dedupeDbIdSet(targetProjectIds.map((item) => getMirrorId(item)))) {
    if (!isValidDbId(rawTargetProjectId) || rawTargetProjectId === normalizedSourceBlockId) {
      continue
    }

    const existingRefId = sourceBlock?.refs.find((ref) => {
      return ref.type === REF_DATA_TYPE &&
        isValidDbId(ref.to) &&
        getMirrorId(ref.to) === rawTargetProjectId
    })?.id
    if (isValidDbId(existingRefId)) {
      resolvedRefIds.push(existingRefId)
      continue
    }

    const createdRefId = (await orca.commands.invokeEditorCommand(
      "core.editor.createRef",
      null,
      normalizedSourceBlockId,
      rawTargetProjectId,
      REF_DATA_TYPE,
    )) as DbId
    if (isValidDbId(createdRefId)) {
      resolvedRefIds.push(createdRefId)
    }
  }

  return dedupeDbIdSet(resolvedRefIds)
}

async function resolveTaskBlockForProjectAssignment(
  blockId: DbId,
  sourceBlockId: DbId | null | undefined,
  schema: TaskSchemaDefinition,
): Promise<ResolvedTaskAssignmentTarget> {
  const candidates = dedupeDbIdSet([
    sourceBlockId,
    sourceBlockId == null ? null : getMirrorId(sourceBlockId),
    getMirrorId(blockId),
    blockId,
  ])

  for (const candidateId of candidates) {
    const sourceBlock = await getBlockByIdWithCache(candidateId, new Map<DbId, Block | null>())
    if (sourceBlock == null) {
      continue
    }

    const liveBlock = orca.state.blocks[getMirrorId(sourceBlock.id)] ?? sourceBlock
    const taskRef = findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(sourceBlock, schema.tagAlias)
    if (taskRef == null) {
      continue
    }
    if (hasProjectTagRef(liveBlock, schema.projectTagAlias) || hasProjectTagRef(sourceBlock, schema.projectTagAlias)) {
      continue
    }

    const writableBlockId = getMirrorIdFromBlock(liveBlock)
    return {
      writableBlockId,
      sourceBlock,
      liveBlock,
      taskRef,
    }
  }

  throw new Error("Current block is not a task")
}

async function resolveProjectBlockForProperties(
  blockId: DbId,
  sourceBlockId: DbId | null | undefined,
  projectSchema: ProjectSchemaDefinition,
): Promise<ResolvedProjectPropertiesTarget> {
  const candidates = dedupeDbIdSet([
    sourceBlockId,
    sourceBlockId == null ? null : getMirrorId(sourceBlockId),
    getMirrorId(blockId),
    blockId,
  ])

  for (const candidateId of candidates) {
    const sourceBlock = await getBlockByIdWithCache(candidateId, new Map<DbId, Block | null>())
    if (sourceBlock == null) {
      continue
    }

    const liveBlock = orca.state.blocks[getMirrorId(sourceBlock.id)] ?? sourceBlock
    const projectRef = findProjectTagRef(liveBlock, projectSchema.tagAlias) ??
      findProjectTagRef(sourceBlock, projectSchema.tagAlias)
    if (projectRef == null) {
      continue
    }

    return {
      writableBlockId: getMirrorIdFromBlock(liveBlock),
      sourceBlock,
      liveBlock,
      projectRef,
    }
  }

  throw new Error("Current block is not a project")
}

async function getBlockByIdWithCache(
  blockId: DbId,
  blockCacheById: Map<DbId, Block | null>,
): Promise<Block | null> {
  if (blockCacheById.has(blockId)) {
    return blockCacheById.get(blockId) ?? null
  }

  const stateBlock = orca.state.blocks[blockId]
  if (stateBlock != null) {
    cacheBlockByKnownIds(stateBlock, blockCacheById)
    return stateBlock
  }

  try {
    const block = (await orca.invokeBackend("get-block", blockId)) as Block | null
    if (block != null) {
      cacheBlockByKnownIds(block, blockCacheById)
      return block
    }
  } catch (error) {
    console.error(error)
  }

  blockCacheById.set(blockId, null)
  return null
}

function cacheBlockByKnownIds(
  block: Block,
  blockCacheById: Map<DbId, Block | null>,
) {
  const aliasIds = [block.id, getMirrorIdFromBlock(block), getMirrorId(block.id)]
  for (const aliasId of aliasIds) {
    if (aliasId == null) {
      continue
    }

    blockCacheById.set(aliasId, block)
  }
}

function resolveProjectText(block: Block, projectTagAlias: string): string {
  const text = typeof block.text === "string" && block.text.trim() !== ""
    ? block.text
    : Array.isArray(block.content)
      ? block.content.map((item) => typeof item.v === "string" ? item.v : "").join("")
      : ""
  const normalized = stripTagFromText(text, projectTagAlias)
  return normalized === "" ? "(Untitled project)" : normalized
}

function stripTagFromText(text: string, tagAlias: string): string {
  if (text.trim() === "") {
    return ""
  }

  const escapedAlias = tagAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text
    .replace(
      new RegExp(`(^|[\\s,，;；、])#${escapedAlias}(?=[\\s,，;；、]|$)`, "gi"),
      " ",
    )
    .replace(/(^|[\s,，;；、])#[^\s#,，;；、]+(?=[\s,，;；、]|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function collectTaskDescendants(
  rootTaskIds: DbId[],
  childrenByTaskId: Map<DbId, DbId[]>,
): DbId[] {
  const result: DbId[] = []
  const queue = [...rootTaskIds]
  const seen = new Set<DbId>()

  while (queue.length > 0) {
    const taskId = queue.shift() as DbId
    if (seen.has(taskId)) {
      continue
    }

    seen.add(taskId)
    result.push(taskId)

    for (const childId of childrenByTaskId.get(taskId) ?? []) {
      if (!seen.has(childId)) {
        queue.push(childId)
      }
    }
  }

  return result
}

function dedupeDbIdSet(values: Array<DbId | null | undefined>): DbId[] {
  const normalized: DbId[] = []
  const seen = new Set<DbId>()

  for (const value of values) {
    if (!isValidDbId(value) || seen.has(value)) {
      continue
    }

    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function findTaskTagRef(block: Block, tagAlias: string) {
  return block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ?? null
}

function findProjectTagRef(block: Block, tagAlias: string) {
  return block.refs.find((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias) ?? null
}

function collectProjectLabelValuesFromBlockTags(
  block: Block | null | undefined,
  projectTagAlias: string,
): string[] {
  if (block == null) {
    return []
  }

  const projectTagAliasLower = projectTagAlias.toLowerCase()
  const labels = block.refs
    .filter((ref) => ref.type === TAG_REF_TYPE)
    .map((ref) => (typeof ref.alias === "string" ? ref.alias : ""))
    .filter((alias) => alias.trim() !== "")
    .filter((alias) => alias.toLowerCase() !== projectTagAliasLower)

  return mergeProjectLabelValues(labels)
}

async function ensureProjectLabelChoices(
  projectSchema: ProjectSchemaDefinition,
  labels: string[],
): Promise<void> {
  const requiredChoices = mergeProjectLabelValues(labels)
  if (requiredChoices.length === 0) {
    return
  }

  const projectTagBlock = await getProjectTagBlockFromSchema(projectSchema)
  if (projectTagBlock == null) {
    return
  }

  const properties = projectTagBlock.properties ?? []
  const labelsProperty = properties.find((item) => {
    return item.name === projectSchema.propertyNames.labels
  })
  const existingChoices = readProjectLabelChoiceValues(labelsProperty)
  const mergedChoices = mergeProjectLabelValues(existingChoices, requiredChoices)
  if (mergedChoices.length === existingChoices.length) {
    return
  }

  const nextProperties: BlockProperty[] = properties.map((property) => {
    if (property.name !== projectSchema.propertyNames.labels) {
      return property
    }

    const baseTypeArgs = isRecord(property.typeArgs) ? property.typeArgs : {}
    return {
      ...property,
      type: TEXT_CHOICES_PROP_TYPE,
      typeArgs: {
        ...baseTypeArgs,
        subType: "multi",
        choices: mergedChoices,
      },
    }
  })

  if (labelsProperty == null) {
    nextProperties.push({
      name: projectSchema.propertyNames.labels,
      type: TEXT_CHOICES_PROP_TYPE,
      typeArgs: {
        subType: "multi",
        choices: mergedChoices,
      },
    })
  }

  await orca.commands.invokeEditorCommand(
    "core.editor.setProperties",
    null,
    [projectTagBlock.id],
    nextProperties,
  )
}

async function getProjectTagBlockFromSchema(
  projectSchema: ProjectSchemaDefinition,
): Promise<Block | null> {
  try {
    return (await orca.invokeBackend(
      "get-block-by-alias",
      projectSchema.tagAlias,
    )) as Block | null
  } catch (error) {
    console.error(error)
    return null
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function cloneProjectRefForCommand(ref: NonNullable<ResolvedProjectPropertiesTarget["projectRef"]>) {
  return {
    id: ref.id,
    from: ref.from,
    to: ref.to,
    type: ref.type,
    alias: ref.alias,
    data: cloneProjectRefDataForCommand(ref.data),
  }
}

function cloneProjectRefDataForCommand(data: BlockProperty[] | undefined): BlockProperty[] | undefined {
  if (!Array.isArray(data)) {
    return data
  }

  return data.map((property) => ({
    ...property,
    typeArgs: cloneCloneableValue(property.typeArgs),
    value: cloneCloneableValue(property.value),
  }))
}

function toProjectRefDataCommandPayload(
  data: BlockProperty[] | undefined,
): Array<{ name: string; type: number; value: unknown }> | undefined {
  const normalized = cloneProjectRefDataForCommand(data)
  if (!Array.isArray(normalized)) {
    return normalized
  }

  return normalized.map((property) => ({
    name: property.name,
    type: property.type,
    value: property.value,
  }))
}

function cloneCloneableValue(value: unknown): unknown {
  if (value == null) {
    return value
  }

  if (value instanceof Date) {
    return new Date(value.getTime())
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneCloneableValue(item))
  }

  if (typeof value === "object") {
    try {
      return structuredClone(value)
    } catch {
      return { ...(value as Record<string, unknown>) }
    }
  }

  return value
}
