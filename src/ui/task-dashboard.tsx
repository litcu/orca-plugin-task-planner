import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

export interface TaskDashboardDueBucket {
  key: string
  label: string
  count: number
  isPast: boolean
}

export interface TaskDashboardBlockerItem {
  key: string
  label: string
  count: number
}

export interface TaskDashboardActionItem {
  blockId: DbId
  text: string
  score: number
  endTime: Date | null
}

export type TaskDashboardQuickFilter = "overdue" | "due-today" | "blocked"

export interface TaskDashboardData {
  actionableTasks: number
  dueTodayTasks: number
  mustDoTodayTasks: number
  overdueTasks: number
  actionableDue48hTasks: number
  doneTodayTasks: number
  blockedTasks: number
  dueBuckets: TaskDashboardDueBucket[]
  blockerItems: TaskDashboardBlockerItem[]
  topActions: TaskDashboardActionItem[]
}

interface TaskDashboardProps {
  data: TaskDashboardData
  generatedAt: Date
  onOpenTask?: (blockId: DbId) => void
  onApplyQuickFilter?: (filter: TaskDashboardQuickFilter) => void
}

interface DashboardMetricCard {
  key: string
  label: string
  value: string
  hint: string
  tone: "cool" | "warm" | "danger" | "neutral"
}

export function TaskDashboard(props: TaskDashboardProps) {
  const React = window.React
  const isChinese = orca.state.locale === "zh-CN"
  const themeClassName = orca.state.themeMode === "dark"
    ? "mlo-dashboard-theme-dark"
    : "mlo-dashboard-theme-light"

  React.useEffect(() => {
    ensureTaskDashboardStyles()
  }, [])

  const generatedAtText = props.generatedAt.toLocaleTimeString(isChinese ? "zh-CN" : undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

  const metricCards: DashboardMetricCard[] = [
    {
      key: "actionable",
      label: t("Actionable now"),
      value: String(props.data.actionableTasks),
      hint: t("Active Tasks"),
      tone: "warm",
    },
    {
      key: "overdue",
      label: t("Overdue tasks"),
      value: String(props.data.overdueTasks),
      hint: t("Needs immediate attention"),
      tone: "danger",
    },
    {
      key: "dueToday",
      label: t("Due today"),
      value: String(props.data.dueTodayTasks),
      hint: t("Due before end of day"),
      tone: "neutral",
    },
    {
      key: "actionableDue48h",
      label: t("Actionable in 48h"),
      value: String(props.data.actionableDue48hTasks),
      hint: t("Actionable tasks due soon"),
      tone: "cool",
    },
    {
      key: "doneToday",
      label: t("Completed today"),
      value: String(props.data.doneTodayTasks),
      hint: t("Approx by modified time"),
      tone: "warm",
    },
  ]

  const maxDueCount = Math.max(1, ...props.data.dueBuckets.map((bucket) => bucket.count))
  const maxBlockerCount = Math.max(1, ...props.data.blockerItems.map((item) => item.count))
  const quickFilterCards: Array<{
    key: TaskDashboardQuickFilter
    label: string
    count: number
    hint: string
  }> = [
    {
      key: "overdue",
      label: t("Only overdue"),
      count: props.data.overdueTasks,
      hint: t("Focus immediate issues"),
    },
    {
      key: "due-today",
      label: t("Only due today"),
      count: props.data.dueTodayTasks,
      hint: t("Focus today's deadlines"),
    },
    {
      key: "blocked",
      label: t("Only blocked"),
      count: props.data.blockedTasks,
      hint: t("Find blocked tasks quickly"),
    },
  ]

  return React.createElement(
    "div",
    {
      className: `mlo-dashboard-root ${themeClassName}`,
    },
    React.createElement(
      "section",
      {
        className: "mlo-dashboard-hero",
      },
      React.createElement(
        "div",
        {
          className: "mlo-dashboard-hero-main",
        },
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-kicker",
          },
          t("Task Command Center"),
        ),
        React.createElement(
          "h3",
          {
            className: "mlo-dashboard-title",
          },
          t("Task Dashboard"),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-subtitle",
          },
          t("Updated at ${time}", { time: generatedAtText }),
        ),
      ),
      React.createElement(
        "div",
        {
          className: "mlo-dashboard-hero-stats",
        },
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-hero-stat",
          },
          React.createElement(
            "span",
            {
              className: "mlo-dashboard-hero-label",
            },
            t("Must handle today"),
          ),
          React.createElement(
            "strong",
            {
              className: "mlo-dashboard-hero-value",
            },
            String(props.data.mustDoTodayTasks),
          ),
          React.createElement(
            "span",
            {
              className: "mlo-dashboard-hero-helper",
            },
            t("Overdue + due today"),
          ),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-hero-stat",
          },
          React.createElement(
            "span",
            {
              className: "mlo-dashboard-hero-label",
            },
            t("Blocked tasks"),
          ),
          React.createElement(
            "strong",
            {
              className: "mlo-dashboard-hero-value",
            },
            String(props.data.blockedTasks),
          ),
          React.createElement(
            "span",
            {
              className: "mlo-dashboard-hero-helper",
            },
            t("Need unblocking"),
          ),
        ),
      ),
    ),
    React.createElement(
      "section",
      {
        className: "mlo-dashboard-metric-grid",
      },
      ...metricCards.map((metric, index) =>
        React.createElement(
          "article",
          {
            key: metric.key,
            className: `mlo-dashboard-metric-card mlo-dashboard-metric-${metric.tone}`,
            style: {
              animationDelay: `${Math.min(index, 8) * 36}ms`,
            },
          },
          React.createElement(
            "div",
            {
              className: "mlo-dashboard-metric-label",
            },
            metric.label,
          ),
          React.createElement(
            "div",
            {
              className: "mlo-dashboard-metric-value",
            },
            metric.value,
          ),
          React.createElement(
            "div",
            {
              className: "mlo-dashboard-metric-hint",
            },
            metric.hint,
          ),
        )),
    ),
    React.createElement(
      "section",
      {
        className: "mlo-dashboard-grid",
      },
      React.createElement(
        "article",
        {
          className: "mlo-dashboard-card",
        },
        React.createElement(
          "h4",
          {
            className: "mlo-dashboard-card-title",
          },
          t("Focus tasks"),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-shortcuts",
          },
          ...quickFilterCards.map((shortcut) =>
            React.createElement(
              "button",
              {
                key: shortcut.key,
                type: "button",
                className: "mlo-dashboard-shortcut-btn",
                disabled: shortcut.count === 0,
                onClick: () => props.onApplyQuickFilter?.(shortcut.key),
              },
              React.createElement(
                "div",
                {
                  className: "mlo-dashboard-shortcut-title",
                },
                React.createElement(
                  "span",
                  {
                    className: "mlo-dashboard-shortcut-label",
                  },
                  shortcut.label,
                ),
                React.createElement(
                  "span",
                  {
                    className: "mlo-dashboard-shortcut-value",
                  },
                  String(shortcut.count),
                ),
              ),
              React.createElement(
                "span",
                {
                  className: "mlo-dashboard-shortcut-hint",
                },
                shortcut.hint,
              ),
            )),
        ),
      ),
      React.createElement(
        "article",
        {
          className: "mlo-dashboard-card",
        },
        React.createElement(
          "h4",
          {
            className: "mlo-dashboard-card-title",
          },
          t("Due pressure next 7 days"),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-due-grid",
          },
          ...props.data.dueBuckets.map((bucket) =>
            React.createElement(
              "div",
              {
                key: bucket.key,
                className: `mlo-dashboard-due-cell ${bucket.isPast ? "is-past" : ""}`,
              },
              React.createElement(
                "div",
                {
                  className: "mlo-dashboard-due-value",
                },
                String(bucket.count),
              ),
              React.createElement(
                "div",
                {
                  className: "mlo-dashboard-due-bar-track",
                },
                React.createElement("div", {
                  className: "mlo-dashboard-due-bar-fill",
                  style: {
                    height: `${Math.max(10, (bucket.count / maxDueCount) * 100)}%`,
                  },
                }),
              ),
              React.createElement(
                "div",
                {
                  className: "mlo-dashboard-due-label",
                },
                bucket.label,
              ),
            )),
        ),
      ),
      React.createElement(
        "article",
        {
          className: "mlo-dashboard-card",
        },
        React.createElement(
          "h4",
          {
            className: "mlo-dashboard-card-title",
          },
          t("Main blockers"),
        ),
        props.data.blockerItems.length === 0
          ? React.createElement(
              "div",
              {
                className: "mlo-dashboard-empty",
              },
              t("No blockers detected"),
            )
          : React.createElement(
              "div",
              {
                className: "mlo-dashboard-list",
              },
              ...props.data.blockerItems.map((blocker) =>
                React.createElement(
                  "div",
                  {
                    key: blocker.key,
                    className: "mlo-dashboard-list-row",
                  },
                  React.createElement(
                    "div",
                    {
                      className: "mlo-dashboard-list-header",
                    },
                    React.createElement(
                      "span",
                      {
                        className: "mlo-dashboard-list-label",
                      },
                      blocker.label,
                    ),
                    React.createElement(
                      "span",
                      {
                        className: "mlo-dashboard-list-value",
                      },
                      String(blocker.count),
                    ),
                  ),
                  React.createElement(
                    "div",
                    {
                      className: "mlo-dashboard-track",
                    },
                    React.createElement("div", {
                      className: "mlo-dashboard-fill",
                      style: {
                        width: `${(blocker.count / maxBlockerCount) * 100}%`,
                      },
                    }),
                  ),
                )),
            ),
      ),
      React.createElement(
        "article",
        {
          className: "mlo-dashboard-card",
        },
        React.createElement(
          "h4",
          {
            className: "mlo-dashboard-card-title",
          },
          t("Top actionable tasks"),
        ),
        props.data.topActions.length === 0
          ? React.createElement(
              "div",
              {
                className: "mlo-dashboard-empty",
              },
              t("No actionable tasks"),
            )
          : React.createElement(
              "div",
              {
                className: "mlo-dashboard-top-list",
              },
              ...props.data.topActions.map((item) =>
                React.createElement(
                  "button",
                  {
                    key: item.blockId,
                    type: "button",
                    className: "mlo-dashboard-top-item",
                    onClick: () => props.onOpenTask?.(item.blockId),
                    title: item.text,
                  },
                  React.createElement(
                    "span",
                    {
                      className: "mlo-dashboard-top-text",
                    },
                    item.text,
                  ),
                  React.createElement(
                    "span",
                    {
                      className: "mlo-dashboard-top-score",
                    },
                    item.score.toFixed(1),
                  ),
                  React.createElement(
                    "span",
                    {
                      className: "mlo-dashboard-top-due",
                    },
                    formatDueHint(item.endTime, isChinese),
                  ),
                )),
            ),
      ),
    ),
  )
}

function formatDueHint(endTime: Date | null, isChinese: boolean): string {
  if (endTime == null || Number.isNaN(endTime.getTime())) {
    return t("No due")
  }

  const now = new Date()
  const nowMs = now.getTime()
  const dueMs = endTime.getTime()
  if (dueMs < nowMs) {
    const days = Math.max(1, Math.ceil((nowMs - dueMs) / (24 * 60 * 60 * 1000)))
    return t("Overdue ${days}d", { days: String(days) })
  }

  return endTime.toLocaleDateString(isChinese ? "zh-CN" : undefined)
}

function ensureTaskDashboardStyles() {
  const styleId = "mlo-task-dashboard-style"
  if (document.getElementById(styleId) != null) {
    return
  }

  const styleEl = document.createElement("style")
  styleEl.id = styleId
  styleEl.textContent = `
.mlo-dashboard-root {
  --mlo-dash-ink: var(--orca-color-text-1, var(--orca-color-text, #17212b));
  --mlo-dash-muted: var(--orca-color-text-2, #526173);
  --mlo-dash-line: var(--orca-color-border-1, var(--orca-color-border, rgba(19, 35, 47, 0.18)));
  --mlo-dash-accent: var(--orca-color-text-teal, #0f766e);
  --mlo-dash-danger: var(--orca-color-text-red, #c53030);
  --mlo-dash-warning: var(--orca-color-text-yellow, #b7791f);
  --mlo-dash-hero-bg:
    linear-gradient(132deg, color-mix(in srgb, var(--mlo-dash-warning) 13%, transparent), color-mix(in srgb, var(--mlo-dash-accent) 12%, transparent) 52%, transparent),
    linear-gradient(158deg, var(--orca-color-bg-1), var(--orca-color-bg-2));
  --mlo-dash-card-bg: linear-gradient(158deg, var(--orca-color-bg-2), var(--orca-color-bg-1));
  --mlo-dash-soft-bg: linear-gradient(160deg, var(--orca-color-bg-2), var(--orca-color-bg-1));
  --mlo-dash-stat-bg: color-mix(in srgb, var(--orca-color-bg-1) 82%, var(--orca-color-bg-2));
  --mlo-dash-track-bg: color-mix(in srgb, var(--orca-color-text-2) 18%, transparent);
  --mlo-dash-button-bg: var(--orca-color-bg-1);
  --mlo-dash-button-hover-shadow: 0 6px 14px color-mix(in srgb, var(--mlo-dash-ink) 10%, transparent);
  --mlo-dash-chip-bg: color-mix(in srgb, var(--mlo-dash-accent) 14%, transparent);
  --mlo-dash-chip-text: var(--mlo-dash-accent);
  --mlo-dash-empty-bg: color-mix(in srgb, var(--orca-color-text-2) 8%, transparent);
  --mlo-dash-shadow: 0 16px 26px color-mix(in srgb, var(--mlo-dash-ink) 12%, transparent);
  --mlo-dash-glow: radial-gradient(circle, color-mix(in srgb, var(--mlo-dash-warning) 20%, transparent), transparent 70%);
  --mlo-dash-kicker-bg: color-mix(in srgb, var(--mlo-dash-accent) 16%, transparent);
  --mlo-dash-kicker-text: var(--mlo-dash-accent);
  --mlo-dash-card-hover-border: color-mix(in srgb, var(--mlo-dash-accent) 45%, var(--mlo-dash-line));
  --mlo-dash-progress-bg: linear-gradient(90deg, var(--mlo-dash-accent), var(--orca-color-text-blue, #2563eb));
  --mlo-dash-pressure-bg: linear-gradient(90deg, var(--mlo-dash-warning), var(--mlo-dash-accent));
  --mlo-dash-pressure-vertical-bg: linear-gradient(180deg, var(--mlo-dash-warning), var(--mlo-dash-accent));
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  min-width: 0;
  color: var(--mlo-dash-ink);
}

.mlo-dashboard-root.mlo-dashboard-theme-dark {
  --mlo-dash-ink: var(--orca-color-text-1, var(--orca-color-text, #f8fafc));
  --mlo-dash-muted: color-mix(in srgb, var(--orca-color-text-2, #cbd5e1) 92%, var(--orca-color-text-1, #f8fafc));
  --mlo-dash-line: var(--orca-color-border-1, var(--orca-color-border, rgba(148, 163, 184, 0.34)));
  --mlo-dash-hero-bg:
    linear-gradient(132deg, color-mix(in srgb, var(--mlo-dash-warning) 16%, transparent), color-mix(in srgb, var(--mlo-dash-accent) 15%, transparent) 52%, transparent),
    linear-gradient(160deg, var(--orca-color-bg-2), var(--orca-color-bg-1));
  --mlo-dash-card-bg: linear-gradient(156deg, var(--orca-color-bg-2), var(--orca-color-bg-1));
  --mlo-dash-soft-bg: linear-gradient(162deg, var(--orca-color-bg-2), var(--orca-color-bg-1));
  --mlo-dash-stat-bg: var(--orca-color-bg-1);
  --mlo-dash-track-bg: color-mix(in srgb, var(--orca-color-text-2) 24%, transparent);
  --mlo-dash-button-bg: var(--orca-color-bg-1);
  --mlo-dash-button-hover-shadow: 0 8px 18px rgba(2, 6, 23, 0.45);
  --mlo-dash-chip-bg: color-mix(in srgb, var(--mlo-dash-accent) 24%, transparent);
  --mlo-dash-empty-bg: color-mix(in srgb, var(--orca-color-text-2) 12%, transparent);
  --mlo-dash-shadow: 0 18px 30px rgba(2, 6, 23, 0.42);
  --mlo-dash-glow: radial-gradient(circle, color-mix(in srgb, var(--mlo-dash-warning) 28%, transparent), transparent 72%);
}

.mlo-dashboard-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--mlo-dash-line);
  background: var(--mlo-dash-hero-bg);
  box-shadow: var(--mlo-dash-shadow);
}

.mlo-dashboard-hero::after {
  content: "";
  position: absolute;
  width: 220px;
  height: 220px;
  right: -90px;
  top: -90px;
  border-radius: 999px;
  background: var(--mlo-dash-glow);
  pointer-events: none;
}

.mlo-dashboard-hero-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-kicker {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--mlo-dash-kicker-bg);
  color: var(--mlo-dash-kicker-text);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
}

.mlo-dashboard-title {
  margin: 0;
  font-size: 25px;
  line-height: 1.04;
  letter-spacing: 0.015em;
  color: var(--mlo-dash-ink);
  font-family: "Avenir Next Condensed", "Bahnschrift SemiCondensed", "DIN Alternate", "Trebuchet MS", sans-serif;
  font-weight: 750;
}

.mlo-dashboard-subtitle {
  font-size: 12px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-hero-stats {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mlo-dashboard-hero-stat {
  border: 1px solid var(--mlo-dash-line);
  border-radius: 12px;
  background: var(--mlo-dash-stat-bg);
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-hero-label {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-hero-value {
  font-size: 24px;
  line-height: 1;
  color: var(--mlo-dash-ink);
  font-family: "Avenir Next Condensed", "Bahnschrift SemiCondensed", "DIN Alternate", "Trebuchet MS", sans-serif;
  font-weight: 760;
}

.mlo-dashboard-hero-helper {
  font-size: 10px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-progress-track {
  height: 6px;
  border-radius: 999px;
  background: var(--mlo-dash-track-bg);
  overflow: hidden;
}

.mlo-dashboard-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--mlo-dash-progress-bg);
  transition: width 260ms ease;
}

.mlo-dashboard-metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(144px, 1fr));
  gap: 8px;
}

.mlo-dashboard-metric-card {
  border-radius: 12px;
  border: 1px solid var(--mlo-dash-line);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: var(--mlo-dash-card-bg);
  animation: mloDashboardLiftIn 320ms cubic-bezier(.2,.8,.2,1) backwards;
}

.mlo-dashboard-metric-cool {
  border-color: color-mix(in srgb, var(--mlo-dash-accent) 34%, var(--mlo-dash-line));
}

.mlo-dashboard-metric-warm {
  border-color: color-mix(in srgb, var(--mlo-dash-warning) 34%, var(--mlo-dash-line));
}

.mlo-dashboard-metric-danger {
  border-color: color-mix(in srgb, var(--mlo-dash-danger) 34%, var(--mlo-dash-line));
}

.mlo-dashboard-metric-neutral {
  border-color: var(--mlo-dash-line);
}

.mlo-dashboard-metric-label {
  font-size: 11px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-metric-value {
  font-size: 24px;
  line-height: 1;
  color: var(--mlo-dash-ink);
  font-family: "Avenir Next Condensed", "Bahnschrift SemiCondensed", "DIN Alternate", "Trebuchet MS", sans-serif;
  font-weight: 760;
}

.mlo-dashboard-metric-hint {
  font-size: 10px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mlo-dashboard-card {
  border: 1px solid var(--mlo-dash-line);
  border-radius: 12px;
  padding: 10px;
  background: var(--mlo-dash-soft-bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mlo-dashboard-card-title {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.02em;
  color: var(--mlo-dash-ink);
  font-weight: 650;
}

.mlo-dashboard-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-list-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mlo-dashboard-list-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.mlo-dashboard-list-label {
  font-size: 12px;
  color: var(--mlo-dash-ink);
}

.mlo-dashboard-list-value {
  font-size: 11px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-track {
  height: 7px;
  border-radius: 999px;
  background: var(--mlo-dash-track-bg);
  overflow: hidden;
}

.mlo-dashboard-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--mlo-dash-pressure-bg);
  transition: width 260ms ease;
}

.mlo-dashboard-due-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 6px;
  align-items: end;
}

.mlo-dashboard-due-cell {
  border: 1px solid var(--mlo-dash-line);
  border-radius: 8px;
  min-height: 112px;
  padding: 6px 4px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 4px;
  background: color-mix(in srgb, var(--mlo-dash-accent) 8%, var(--orca-color-bg-1));
}

.mlo-dashboard-due-cell.is-past {
  background: color-mix(in srgb, var(--mlo-dash-danger) 12%, var(--orca-color-bg-1));
}

.mlo-dashboard-due-value {
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--mlo-dash-ink);
}

.mlo-dashboard-due-bar-track {
  position: relative;
  border-radius: 6px;
  background: var(--mlo-dash-track-bg);
  overflow: hidden;
  min-height: 58px;
  display: flex;
  align-items: flex-end;
}

.mlo-dashboard-due-bar-fill {
  width: 100%;
  min-height: 8px;
  border-radius: 6px 6px 0 0;
  background: var(--mlo-dash-pressure-vertical-bg);
  transition: height 280ms ease;
}

.mlo-dashboard-due-label {
  text-align: center;
  font-size: 10px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-top-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-shortcuts {
  display: grid;
  gap: 6px;
}

.mlo-dashboard-shortcut-btn {
  border: 1px solid var(--mlo-dash-line);
  border-radius: 9px;
  background: var(--mlo-dash-button-bg);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  cursor: pointer;
  transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
}

.mlo-dashboard-shortcut-btn:hover:not(:disabled) {
  border-color: var(--mlo-dash-card-hover-border);
  box-shadow: var(--mlo-dash-button-hover-shadow);
  transform: translateY(-1px);
}

.mlo-dashboard-shortcut-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.mlo-dashboard-shortcut-title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.mlo-dashboard-shortcut-label {
  font-size: 12px;
  color: var(--mlo-dash-ink);
}

.mlo-dashboard-shortcut-value {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--mlo-dash-chip-bg);
  color: var(--mlo-dash-chip-text);
  font-weight: 650;
}

.mlo-dashboard-shortcut-hint {
  font-size: 10px;
  color: var(--mlo-dash-muted);
}

.mlo-dashboard-top-item {
  border: 1px solid var(--mlo-dash-line);
  border-radius: 9px;
  background: var(--mlo-dash-button-bg);
  padding: 7px 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  cursor: pointer;
  text-align: left;
  transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
}

.mlo-dashboard-top-item:hover {
  border-color: var(--mlo-dash-card-hover-border);
  box-shadow: var(--mlo-dash-button-hover-shadow);
  transform: translateY(-1px);
}

.mlo-dashboard-top-text {
  font-size: 12px;
  color: var(--mlo-dash-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlo-dashboard-top-score {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--mlo-dash-chip-bg);
  color: var(--mlo-dash-chip-text);
  font-weight: 650;
}

.mlo-dashboard-top-due {
  font-size: 10px;
  color: var(--mlo-dash-muted);
  white-space: nowrap;
}

.mlo-dashboard-empty {
  border-radius: 9px;
  border: 1px dashed var(--mlo-dash-line);
  padding: 10px;
  font-size: 12px;
  color: var(--mlo-dash-muted);
  background: var(--mlo-dash-empty-bg);
}

.mlo-dashboard-shortcut-btn:focus-visible,
.mlo-dashboard-top-item:focus-visible {
  outline: 2px solid var(--orca-color-text-blue, #2563eb);
  outline-offset: 1px;
}

@media (max-width: 1100px) {
  .mlo-dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mlo-dashboard-hero {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 920px) {
  .mlo-dashboard-hero-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 680px) {
  .mlo-dashboard-title {
    font-size: 22px;
  }

  .mlo-dashboard-top-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .mlo-dashboard-top-due {
    grid-column: 1 / -1;
  }
}

@media (max-height: 780px) {
  .mlo-dashboard-root {
    gap: 10px;
  }

  .mlo-dashboard-hero {
    padding: 12px;
  }

  .mlo-dashboard-metric-card,
  .mlo-dashboard-card {
    padding: 9px;
  }

  .mlo-dashboard-due-cell {
    min-height: 98px;
  }

  .mlo-dashboard-due-bar-track {
    min-height: 48px;
  }
}

@keyframes mloDashboardLiftIn {
  0% {
    opacity: 0;
    transform: translateY(7px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}
`

  document.head.appendChild(styleEl)
}
