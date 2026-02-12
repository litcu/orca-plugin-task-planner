import type { DbId } from "../orca.d.ts"

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
