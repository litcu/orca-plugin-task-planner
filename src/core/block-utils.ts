import type { Block, DbId } from "../orca.d.ts"

// 统一处理镜像块，避免对镜像块写入或跳转时命中错误目标。
export function getMirrorId(id: DbId): DbId {
  const block = orca.state.blocks[id]
  if (block == null) {
    return id
  }

  const repr = block.properties?.find((item) => item.name === "_repr")?.value as
    | { type?: string; mirroredId?: DbId }
    | undefined

  if (repr?.type === "mirror" && repr.mirroredId != null) {
    return repr.mirroredId
  }

  return id
}

export function getMirrorIdFromBlock(block: Pick<Block, "id" | "properties">): DbId {
  const repr = block.properties?.find((item) => item.name === "_repr")?.value as
    | { type?: string; mirroredId?: DbId }
    | undefined

  if (repr?.type === "mirror" && repr.mirroredId != null) {
    return repr.mirroredId
  }

  return getMirrorId(block.id)
}

export function isValidDbId(id: unknown): id is DbId {
  return (
    typeof id === "number" &&
    Number.isInteger(id) &&
    Number.isFinite(id) &&
    id > 0
  )
}

export function dedupeDbIds(
  ids: Array<DbId | null | undefined>,
): DbId[] {
  const seen = new Set<DbId>()
  const normalized: DbId[] = []

  for (const id of ids) {
    if (!isValidDbId(id) || seen.has(id)) {
      continue
    }

    seen.add(id)
    normalized.push(id)
  }

  return normalized
}
