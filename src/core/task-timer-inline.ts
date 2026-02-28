import type { Block, DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"
import { getMirrorId, isValidDbId } from "./block-utils"
import { getPluginSettings } from "./plugin-settings"
import { isTaskDoneStatus, type TaskSchemaDefinition } from "./task-schema"
import {
  checkpointAllRunningTaskTimers,
  formatTaskTimerDuration,
  hasTaskTimerRecord,
  readTaskTimerFromBlock,
  resolveTaskPomodoroProgress,
  resolveTaskStatusFromBlock,
  resolveTaskTimerElapsedMs,
  startTaskTimer,
  stopAllRunningTaskTimers,
  stopTaskTimer,
} from "./task-timer"

const TAG_REF_TYPE = 2
const POMODORO_DURATION_MS = 25 * 60 * 1000
const TICK_INTERVAL_MS = 1000
const CHECKPOINT_INTERVAL_MS = 15000
const REFRESH_DEBOUNCE_MS = 120
const TAG_BUTTON_ROLE = "mlo-task-timer-tag-button"
const TAG_BUTTON_ICON_ROLE = "mlo-task-timer-tag-icon"
const TAG_BUTTON_TEXT_ROLE = "mlo-task-timer-tag-text"
const DETAIL_ROLE = "mlo-task-timer-detail"
const INLINE_STYLE_ROLE = "mlo-task-timer-inline-style"
const DETAIL_BASE_INDENT_PX = 24
const DETAIL_TEXT_OFFSET_FROM_STATUS_ICON_PX = 20
const DETAIL_MIRROR_FALLBACK_OFFSET_PX = 12
const DETAIL_MAX_MIRROR_OFFSET_PX = 64

export interface TaskTimerInlineHandle {
  dispose: () => void
}

export function setupTaskTimerInlineWidgets(
  pluginName: string,
  schema: TaskSchemaDefinition,
): TaskTimerInlineHandle {
  injectInlineTimerStyles(pluginName)

  const { subscribe } = window.Valtio
  const pendingTaskIds = new Set<DbId>()
  const autoStoppingTaskIds = new Set<DbId>()
  let disposed = false
  let refreshTimerId: number | null = null
  let tickTimerId: number | null = null
  let settingsUnsubscribe: (() => void) | null = null
  let blocksUnsubscribe: (() => void) | null = null
  let previousSettings = getPluginSettings(pluginName)
  let checkpointing = false
  let lastCheckpointAtMs = 0

  const scheduleRefresh = (delayMs: number = REFRESH_DEBOUNCE_MS) => {
    if (disposed) {
      return
    }

    if (refreshTimerId != null) {
      window.clearTimeout(refreshTimerId)
    }

    refreshTimerId = window.setTimeout(() => {
      refreshTimerId = null
      void refreshInlineWidgets()
    }, delayMs)
  }

  const clickListener = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const actionButton = target.closest(`button[data-role="${TAG_BUTTON_ROLE}"]`)
    if (!(actionButton instanceof HTMLButtonElement)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const rawBlockId = Number(actionButton.dataset.blockId)
    if (!isValidDbId(rawBlockId)) {
      return
    }

    const taskId = getMirrorId(rawBlockId)
    if (!isValidDbId(taskId) || pendingTaskIds.has(taskId)) {
      return
    }

    const settings = getPluginSettings(pluginName)
    if (!settings.taskTimerEnabled) {
      return
    }

    const action = actionButton.dataset.action === "stop" ? "stop" : "start"
    pendingTaskIds.add(taskId)
    scheduleRefresh(0)

    void (async () => {
      try {
        if (action === "stop") {
          await stopTaskTimer({
            blockId: taskId,
            sourceBlockId: rawBlockId,
            schema,
          })
        } else {
          await startTaskTimer({
            blockId: taskId,
            sourceBlockId: rawBlockId,
            schema,
          })
        }
      } catch (error) {
        console.error(error)
        const fallbackMessage = action === "stop"
          ? t("Failed to stop timer")
          : t("Failed to start timer")
        const message = error instanceof Error ? error.message : fallbackMessage
        orca.notify("error", message)
      } finally {
        pendingTaskIds.delete(taskId)
        scheduleRefresh(0)
      }
    })()
  }

  const checkpointNow = async () => {
    if (checkpointing) {
      return
    }

    checkpointing = true
    const nowMs = Date.now()
    lastCheckpointAtMs = nowMs
    try {
      await checkpointAllRunningTaskTimers(schema, nowMs)
    } catch (error) {
      console.error(error)
    } finally {
      checkpointing = false
    }
  }

  const maybeCheckpoint = () => {
    const nowMs = Date.now()
    if (nowMs - lastCheckpointAtMs < CHECKPOINT_INTERVAL_MS) {
      return
    }

    void checkpointNow()
  }

  const visibilityChangeListener = () => {
    if (document.visibilityState === "hidden") {
      void checkpointNow()
    }
  }

  const beforeUnloadListener = () => {
    void checkpointNow()
  }

  const tick = () => {
    if (disposed) {
      return
    }

    const settings = getPluginSettings(pluginName)
    if (!settings.taskTimerEnabled) {
      return
    }

    maybeCheckpoint()

    const blocks = Array.from(document.querySelectorAll(".orca-block[data-id]"))
    for (const blockNode of blocks) {
      if (!(blockNode instanceof HTMLElement)) {
        continue
      }

      const rawBlockId = Number(blockNode.dataset.id)
      if (!isValidDbId(rawBlockId)) {
        continue
      }

      const block = resolveVisibleTaskBlock(rawBlockId)
      if (block == null || !hasTaskTagRef(block, schema.tagAlias)) {
        removeBlockTimerUi(blockNode)
        continue
      }

      const status = resolveTaskStatusFromBlock(block, schema)
      const timer = readTaskTimerFromBlock(block)
      const taskId = getMirrorId(rawBlockId)

      if (timer.running && isTaskDoneStatus(status, schema) && !autoStoppingTaskIds.has(taskId)) {
        autoStoppingTaskIds.add(taskId)
        void stopTaskTimer({
          blockId: taskId,
          sourceBlockId: rawBlockId,
          schema,
        })
          .catch((error) => {
            console.error(error)
          })
          .finally(() => {
            autoStoppingTaskIds.delete(taskId)
            scheduleRefresh(0)
          })
      }

      renderBlockTimerUi(
        blockNode,
        rawBlockId,
        block,
        schema,
        settings,
        pendingTaskIds.has(taskId),
      )
    }
  }

  async function refreshInlineWidgets() {
    if (disposed) {
      return
    }

    const settings = getPluginSettings(pluginName)
    if (!settings.taskTimerEnabled) {
      removeInlineWidgets()
      return
    }

    const blockNodes = Array.from(document.querySelectorAll(".orca-block[data-id]"))
    for (const blockNode of blockNodes) {
      if (!(blockNode instanceof HTMLElement)) {
        continue
      }

      const rawBlockId = Number(blockNode.dataset.id)
      if (!isValidDbId(rawBlockId)) {
        removeBlockTimerUi(blockNode)
        continue
      }

      const block = resolveVisibleTaskBlock(rawBlockId)
      if (block == null || !hasTaskTagRef(block, schema.tagAlias)) {
        removeBlockTimerUi(blockNode)
        continue
      }

      const taskId = getMirrorId(rawBlockId)
      renderBlockTimerUi(
        blockNode,
        rawBlockId,
        block,
        schema,
        settings,
        pendingTaskIds.has(taskId),
      )
    }
  }

  document.body.addEventListener("click", clickListener, true)
  document.addEventListener("visibilitychange", visibilityChangeListener)
  window.addEventListener("beforeunload", beforeUnloadListener)

  blocksUnsubscribe = subscribe(orca.state.blocks, () => {
    scheduleRefresh()
  })

  const pluginState = orca.state.plugins[pluginName]
  if (pluginState != null) {
    settingsUnsubscribe = subscribe(pluginState, () => {
      const nextSettings = getPluginSettings(pluginName)
      if (previousSettings.taskTimerEnabled && !nextSettings.taskTimerEnabled) {
        void stopAllRunningTaskTimers(schema).finally(() => {
          scheduleRefresh(0)
        })
      }

      previousSettings = nextSettings
      scheduleRefresh()
    })
  }

  tickTimerId = window.setInterval(tick, TICK_INTERVAL_MS)
  scheduleRefresh(0)

  return {
    dispose: () => {
      disposed = true
      document.body.removeEventListener("click", clickListener, true)
      document.removeEventListener("visibilitychange", visibilityChangeListener)
      window.removeEventListener("beforeunload", beforeUnloadListener)

      if (refreshTimerId != null) {
        window.clearTimeout(refreshTimerId)
        refreshTimerId = null
      }
      if (tickTimerId != null) {
        window.clearInterval(tickTimerId)
        tickTimerId = null
      }

      settingsUnsubscribe?.()
      settingsUnsubscribe = null
      blocksUnsubscribe?.()
      blocksUnsubscribe = null

      void checkpointNow()
      removeInlineWidgets()
      removeInlineTimerStyles(pluginName)
    },
  }
}

function renderBlockTimerUi(
  blockEl: HTMLElement,
  rawBlockId: DbId,
  block: Block,
  schema: TaskSchemaDefinition,
  settings: ReturnType<typeof getPluginSettings>,
  pending: boolean,
) {
  const taskId = getMirrorId(rawBlockId)
  const timer = readTaskTimerFromBlock(block)
  const status = resolveTaskStatusFromBlock(block, schema)
  const hasRecord = hasTaskTimerRecord(timer)
  const elapsedMs = resolveTaskTimerElapsedMs(timer)
  const elapsedText = formatTaskTimerDuration(elapsedMs)
  const startDisabled = !timer.running && isTaskDoneStatus(status, schema)
  const action = timer.running ? "stop" : "start"
  const actionLabel = action === "stop" ? t("Stop") : t("Timer")
  const buttonDisabled = pending || startDisabled
  const buttonTitle = startDisabled
    ? t("Completed task cannot start timer")
    : action === "stop"
      ? t("Stop timer")
      : t("Start timer")

  const tagButton = ensureTagButton(blockEl, schema.tagAlias)
  if (tagButton != null) {
    tagButton.dataset.blockId = String(rawBlockId)
    tagButton.dataset.action = action
    tagButton.disabled = buttonDisabled
    tagButton.title = buttonTitle
    tagButton.className = `mlo-task-timer-tag-button ${timer.running ? "is-running" : ""}`
    const iconEl = ensureTagButtonIcon(tagButton)
    iconEl.className = `${TAG_BUTTON_ICON_ROLE} ${
      timer.running ? "ti ti-player-stop-filled" : "ti ti-player-play-filled"
    }`
    const textEl = ensureTagButtonText(tagButton)
    if (textEl.textContent !== actionLabel) {
      textEl.textContent = actionLabel
    }
  }

  const detailEl = ensureDetailElement(blockEl)
  if (detailEl == null) {
    return
  }

  if (!hasRecord) {
    detailEl.remove()
    return
  }

  detailEl.className = `mlo-task-timer-detail ${timer.running ? "is-running" : ""}`
  applyDetailAlignment(detailEl, blockEl, rawBlockId)
  let detailText = settings.taskTimerMode === "pomodoro"
    ? ""
    : t("Elapsed ${time}", { time: elapsedText })
  if (settings.taskTimerMode === "pomodoro") {
    const progress = resolveTaskPomodoroProgress(elapsedMs)
    detailText = t("Pomodoro ${cycle} ${elapsed}/${duration}", {
      cycle: String(progress.cycle),
      elapsed: formatTaskTimerDuration(progress.cycleElapsedMs),
      duration: formatTaskTimerDuration(POMODORO_DURATION_MS),
    })
  }
  detailEl.textContent = detailText
  detailEl.dataset.blockId = String(taskId)
}

function ensureTagButton(
  blockEl: HTMLElement,
  taskTagAlias: string,
): HTMLButtonElement | null {
  const tagName = taskTagAlias.toLowerCase()
  const taskTagEl = blockEl.querySelector(`.orca-tag[data-name="${tagName}"]`)
  if (!(taskTagEl instanceof HTMLElement)) {
    removeTagButton(blockEl)
    return null
  }

  const existing = blockEl.querySelector(`button[data-role="${TAG_BUTTON_ROLE}"]`)
  if (existing instanceof HTMLButtonElement) {
    if (existing.previousElementSibling !== taskTagEl) {
      taskTagEl.insertAdjacentElement("afterend", existing)
    }
    return existing
  }

  const button = document.createElement("button")
  button.type = "button"
  button.dataset.role = TAG_BUTTON_ROLE
  button.className = "mlo-task-timer-tag-button"
  button.appendChild(document.createElement("i")).className = `${TAG_BUTTON_ICON_ROLE} ti ti-player-play-filled`
  button.appendChild(document.createElement("span")).className = TAG_BUTTON_TEXT_ROLE
  taskTagEl.insertAdjacentElement("afterend", button)
  return button
}

function ensureTagButtonIcon(button: HTMLButtonElement): HTMLElement {
  const existing = button.querySelector(`:scope > .${TAG_BUTTON_ICON_ROLE}`)
  if (existing instanceof HTMLElement) {
    return existing
  }

  const iconEl = document.createElement("i")
  iconEl.className = `${TAG_BUTTON_ICON_ROLE} ti ti-player-play-filled`
  button.prepend(iconEl)
  return iconEl
}

function ensureTagButtonText(button: HTMLButtonElement): HTMLElement {
  const existing = button.querySelector(`:scope > .${TAG_BUTTON_TEXT_ROLE}`)
  if (existing instanceof HTMLElement) {
    return existing
  }

  const textEl = document.createElement("span")
  textEl.className = TAG_BUTTON_TEXT_ROLE
  button.appendChild(textEl)
  return textEl
}

function ensureDetailElement(blockEl: HTMLElement): HTMLElement | null {
  const host = resolveDetailHostElement(blockEl)
  if (!(host instanceof HTMLElement)) {
    removeDetail(blockEl)
    return null
  }

  const existing = host.querySelector(`:scope > [data-role="${DETAIL_ROLE}"]`)
  if (existing instanceof HTMLElement) {
    return existing
  }

  const detail = document.createElement("div")
  detail.dataset.role = DETAIL_ROLE
  detail.className = "mlo-task-timer-detail"
  host.appendChild(detail)
  return detail
}

function resolveDetailHostElement(blockEl: HTMLElement): HTMLElement | null {
  const host =
    blockEl.querySelector(":scope > .orca-repr > .orca-repr-main") ??
    blockEl.querySelector(".orca-repr-main")
  return host instanceof HTMLElement ? host : null
}

function applyDetailAlignment(
  detailEl: HTMLElement,
  blockEl: HTMLElement,
  rawBlockId: DbId,
) {
  const host = resolveDetailHostElement(blockEl)
  if (host == null) {
    detailEl.style.setProperty(
      "--mlo-task-timer-detail-indent",
      `${DETAIL_BASE_INDENT_PX}px`,
    )
    return
  }

  const indentPx = resolveDetailIndentPx(host, blockEl, rawBlockId)
  detailEl.style.setProperty(
    "--mlo-task-timer-detail-indent",
    `${indentPx}px`,
  )
}

function resolveDetailIndentPx(
  host: HTMLElement,
  blockEl: HTMLElement,
  rawBlockId: DbId,
): number {
  const hostRect = host.getBoundingClientRect()
  if (hostRect.width > 0) {
    const statusIconLeft = resolveTaskStatusIconLeft(host, blockEl)
    if (statusIconLeft != null) {
      const alignedIndent = Math.round(
        statusIconLeft - hostRect.left + DETAIL_TEXT_OFFSET_FROM_STATUS_ICON_PX,
      )
      return Math.max(
        DETAIL_BASE_INDENT_PX,
        Math.min(DETAIL_BASE_INDENT_PX + DETAIL_MAX_MIRROR_OFFSET_PX, alignedIndent),
      )
    }
  }

  const taskId = getMirrorId(rawBlockId)
  if (taskId === rawBlockId) {
    return DETAIL_BASE_INDENT_PX
  }

  if (hostRect.width <= 0) {
    return DETAIL_BASE_INDENT_PX + DETAIL_MIRROR_FALLBACK_OFFSET_PX
  }

  let mirrorOffsetPx = 0
  const nestedMainEls = host.querySelectorAll(".orca-repr-main")
  for (const candidate of nestedMainEls) {
    if (!(candidate instanceof HTMLElement) || candidate === host) {
      continue
    }

    const candidateRect = candidate.getBoundingClientRect()
    const rawOffsetPx = Math.round(candidateRect.left - hostRect.left)
    if (rawOffsetPx <= 0) {
      continue
    }

    mirrorOffsetPx = Math.max(mirrorOffsetPx, rawOffsetPx)
  }

  if (mirrorOffsetPx <= 0) {
    mirrorOffsetPx = DETAIL_MIRROR_FALLBACK_OFFSET_PX
  }

  const clampedOffsetPx = Math.min(mirrorOffsetPx, DETAIL_MAX_MIRROR_OFFSET_PX)
  return DETAIL_BASE_INDENT_PX + clampedOffsetPx
}

function resolveTaskStatusIconLeft(
  host: HTMLElement,
  blockEl: HTMLElement,
): number | null {
  const candidates: HTMLElement[] = []
  const selector = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    ".orca-checkbox",
    ".orca-task-checkbox",
    ".orca-task-state",
    ".orca-task-icon",
    'i[class*="ti-"]',
  ].join(",")

  const queried = blockEl.querySelectorAll(selector)
  for (const node of queried) {
    if (!(node instanceof HTMLElement)) {
      continue
    }

    if (node.closest(`[data-role="${TAG_BUTTON_ROLE}"]`) != null) {
      continue
    }

    if (node.closest(`[data-role="${DETAIL_ROLE}"]`) != null) {
      continue
    }

    if (node.matches('i[class*="ti-"]')) {
      const className = node.className
      if (
        !/(ti-(circle|square|checkbox|check|point|minus|x))/i.test(className) ||
        /(ti-(chevron|caret|arrow|plus))/i.test(className)
      ) {
        continue
      }
    }

    candidates.push(node)
  }

  if (candidates.length === 0) {
    return null
  }

  const hostRect = host.getBoundingClientRect()
  let leftMost: number | null = null
  for (const element of candidates) {
    const rect = element.getBoundingClientRect()
    const left = Math.round(rect.left)
    if (left < Math.round(hostRect.left) - 1) {
      continue
    }

    if (leftMost == null || left < leftMost) {
      leftMost = left
    }
  }

  return leftMost
}

function removeTagButton(blockEl: HTMLElement) {
  const button = blockEl.querySelector(`button[data-role="${TAG_BUTTON_ROLE}"]`)
  if (button instanceof HTMLElement) {
    button.remove()
  }
}

function removeDetail(blockEl: HTMLElement) {
  const detail = blockEl.querySelector(`[data-role="${DETAIL_ROLE}"]`)
  if (detail instanceof HTMLElement) {
    detail.remove()
  }
}

function removeBlockTimerUi(blockEl: HTMLElement) {
  removeTagButton(blockEl)
  removeDetail(blockEl)
}

function resolveVisibleTaskBlock(rawBlockId: DbId): Block | null {
  const taskId = getMirrorId(rawBlockId)
  return orca.state.blocks[taskId] ?? orca.state.blocks[rawBlockId] ?? null
}

function hasTaskTagRef(block: Block, tagAlias: string): boolean {
  const liveBlock = orca.state.blocks[getMirrorId(block.id)] ?? block
  return liveBlock.refs.some((ref) => ref.type === TAG_REF_TYPE && ref.alias === tagAlias)
}

function removeInlineWidgets() {
  const buttons = document.querySelectorAll(`button[data-role="${TAG_BUTTON_ROLE}"]`)
  buttons.forEach((item) => item.remove())
  const details = document.querySelectorAll(`[data-role="${DETAIL_ROLE}"]`)
  details.forEach((item) => item.remove())
}

function injectInlineTimerStyles(pluginName: string) {
  const styleRole = getInlineStyleRole(pluginName)
  removeInlineTimerStyles(pluginName)

  const styleEl = document.createElement("style")
  styleEl.dataset.role = styleRole
  styleEl.textContent = `
    .mlo-task-timer-tag-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 18px;
      padding: 0 6px;
      margin-left: 4px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 999px;
      background: linear-gradient(
        120deg,
        rgba(148, 163, 184, 0.12),
        rgba(148, 163, 184, 0.05)
      );
      color: color-mix(in srgb, var(--orca-color-text-2) 86%, transparent);
      font-size: 10px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      opacity: 0.85;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease, border-color 120ms ease;
    }

    .mlo-task-timer-tag-button .${TAG_BUTTON_ICON_ROLE} {
      font-size: 11px;
      line-height: 1;
    }

    .mlo-task-timer-tag-button .${TAG_BUTTON_TEXT_ROLE} {
      line-height: 1;
    }

    .mlo-task-timer-tag-button:hover:not(:disabled) {
      opacity: 1;
      background: linear-gradient(
        120deg,
        rgba(148, 163, 184, 0.18),
        rgba(148, 163, 184, 0.1)
      );
      border-color: rgba(148, 163, 184, 0.4);
      color: var(--orca-color-text);
    }

    .mlo-task-timer-tag-button.is-running {
      border-color: rgba(197, 48, 48, 0.26);
      background: linear-gradient(
        120deg,
        rgba(197, 48, 48, 0.11),
        rgba(197, 48, 48, 0.05)
      );
      color: color-mix(in srgb, var(--orca-color-text-red, #c53030) 78%, transparent);
      opacity: 0.92;
    }

    .mlo-task-timer-tag-button:disabled {
      opacity: 0.38;
      cursor: not-allowed;
    }

    [data-role="${DETAIL_ROLE}"] {
      margin: 2px 0 0 var(--mlo-task-timer-detail-indent, 24px);
      font-size: 10px;
      line-height: 1.3;
      color: color-mix(in srgb, var(--orca-color-text-2) 80%, transparent);
      opacity: 0.72;
      font-variant-numeric: tabular-nums;
      user-select: none;
      white-space: nowrap;
    }

    [data-role="${DETAIL_ROLE}"].is-running {
      color: color-mix(in srgb, var(--orca-color-text-red, #c53030) 70%, transparent);
      opacity: 0.84;
    }
  `
  document.head.appendChild(styleEl)
}

function removeInlineTimerStyles(pluginName: string) {
  const styleRole = getInlineStyleRole(pluginName)
  const styleEls = document.querySelectorAll(`style[data-role="${styleRole}"]`)
  styleEls.forEach((item) => item.remove())
}

function getInlineStyleRole(pluginName: string): string {
  return `${pluginName}-${INLINE_STYLE_ROLE}`
}
