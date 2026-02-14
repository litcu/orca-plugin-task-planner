import type { Block, BlockRef, DbId } from "../orca.d.ts"
import { getMirrorId } from "../core/block-utils"
import {
  collectNextActionEvaluations,
  type NextActionBlockedReason,
} from "../core/dependency-engine"
import { getTaskPropertiesFromRef } from "../core/task-properties"
import type { TaskSchemaDefinition } from "../core/task-schema"
import { t } from "../libs/l10n"

export interface TaskActivationInfo {
  isActive: boolean
  blockedReason: NextActionBlockedReason[]
}

const BLOCKED_REASON_PRIORITY: NextActionBlockedReason[] = [
  "completed",
  "canceled",
  "not-started",
  "dependency-delayed",
  "dependency-unmet",
  "ancestor-dependency-unmet",
  "has-open-children",
]

export async function loadTaskActivationInfo(
  schema: TaskSchemaDefinition,
  blockId: DbId,
): Promise<TaskActivationInfo | null> {
  const targetId = getMirrorId(blockId)
  const evaluations = await collectNextActionEvaluations(schema)
  const matched = evaluations.find((item) => item.item.blockId === targetId)
  if (matched != null) {
    return {
      isActive: matched.isNextAction,
      blockedReason: [...matched.blockedReason],
    }
  }

  const block =
    orca.state.blocks[targetId] ??
    orca.state.blocks[blockId] ??
    null
  const taskRef = (() => {
    if (block == null) {
      return null
    }

    const liveBlock = orca.state.blocks[getMirrorId(block.id)] ?? block
    return findTaskTagRef(liveBlock, schema.tagAlias) ?? findTaskTagRef(block, schema.tagAlias)
  })()
  if (taskRef == null) {
    return null
  }

  const status = getTaskPropertiesFromRef(taskRef.data, schema).status
  if (status === schema.statusChoices[2]) {
    return {
      isActive: false,
      blockedReason: ["completed"],
    }
  }

  if (isCanceledStatus(status)) {
    return {
      isActive: false,
      blockedReason: ["canceled"],
    }
  }

  return null
}

export function resolveBlockedReasonTag(reasons: NextActionBlockedReason[]): string {
  const primaryReason = pickPrimaryBlockedReason(reasons)
  return resolveBlockedReasonLabel(primaryReason ?? "dependency-unmet")
}

function pickPrimaryBlockedReason(
  reasons: NextActionBlockedReason[],
): NextActionBlockedReason | null {
  if (reasons.length === 0) {
    return null
  }

  for (const candidate of BLOCKED_REASON_PRIORITY) {
    if (reasons.includes(candidate)) {
      return candidate
    }
  }

  return reasons[0] ?? null
}

function resolveBlockedReasonLabel(reason: NextActionBlockedReason): string {
  switch (reason) {
    case "completed":
      return t("Blocked by completion")
    case "canceled":
      return t("Blocked by cancellation")
    case "not-started":
      return t("Blocked by start time")
    case "dependency-unmet":
      return t("Blocked by dependencies")
    case "dependency-delayed":
      return t("Blocked by dependency delay")
    case "has-open-children":
      return t("Blocked by open subtasks")
    case "ancestor-dependency-unmet":
      return t("Blocked by ancestor dependencies")
    default:
      return t("Blocked by dependencies")
  }
}

function findTaskTagRef(block: Block, tagAlias: string): BlockRef | null {
  return block.refs.find((ref) => ref.type === 2 && ref.alias === tagAlias) ?? null
}

function isCanceledStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "已取消" ||
    normalized === "取消"
  )
}
