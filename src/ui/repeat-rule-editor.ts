import {
  parseRepeatRuleConfig,
  stringifyRepeatRuleConfig,
  type RepeatRuleConfig,
  type RepeatUnit,
} from "../core/task-repeat"

export type RepeatMode = "none" | RepeatUnit

export interface RepeatRuleEditorState {
  mode: RepeatMode
  intervalText: string
  weekdayValue: string
  maxCountText: string
  endAtValue: Date | null
  occurrence: number
  parseable: boolean
}

interface BuildEditorStateInput {
  mode: RepeatMode
  intervalText: string
  weekdayValue: string
  maxCountText: string
  endAtValue: Date | null
  occurrence: number
}

export function parseRepeatRuleToEditorState(
  rawRule: string,
): RepeatRuleEditorState {
  const normalized = rawRule.trim()
  if (normalized === "") {
    return {
      mode: "none",
      intervalText: "1",
      weekdayValue: "",
      maxCountText: "",
      endAtValue: null,
      occurrence: 1,
      parseable: true,
    }
  }

  const parsed = parseRepeatRuleConfig(normalized)
  if (parsed == null) {
    return {
      mode: "none",
      intervalText: "1",
      weekdayValue: "",
      maxCountText: "",
      endAtValue: null,
      occurrence: 1,
      parseable: false,
    }
  }

  return {
    mode: parsed.unit,
    intervalText: String(parsed.interval),
    weekdayValue: parsed.weekday == null ? "" : String(parsed.weekday),
    maxCountText: parsed.maxCount == null ? "" : String(parsed.maxCount),
    endAtValue: parsed.endAtMs == null ? null : new Date(parsed.endAtMs),
    occurrence: parsed.occurrence,
    parseable: true,
  }
}

export function buildRepeatRuleFromEditorState(input: BuildEditorStateInput): string {
  if (input.mode === "none") {
    return ""
  }

  const rule: RepeatRuleConfig = {
    unit: input.mode,
    interval: normalizePositiveInt(input.intervalText, 1),
    weekday: input.mode === "week" ? normalizeWeekday(input.weekdayValue) : null,
    hour: null,
    minute: null,
    maxCount: normalizeOptionalPositiveInt(input.maxCountText),
    endAtMs:
      input.endAtValue != null && !Number.isNaN(input.endAtValue.getTime())
        ? input.endAtValue.getTime()
        : null,
    occurrence: normalizePositiveInt(input.occurrence, 1),
  }

  return stringifyRepeatRuleConfig(rule)
}

function normalizePositiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim())
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return fallback
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : fallback
}

function normalizeOptionalPositiveInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return null
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return null
  }

  const normalized = Math.floor(parsed)
  return normalized >= 1 ? normalized : null
}

function normalizeWeekday(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return null
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
    return null
  }

  return parsed
}
