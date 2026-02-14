import type { DbId } from "../orca.d.ts"
import { t } from "../libs/l10n"

export interface TaskDashboardStatusSlice {
  key: string
  label: string
  count: number
  color: string
}

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

export interface TaskDashboardData {
  totalTasks: number
  actionableTasks: number
  doneTasks: number
  completionRate: number
  starredTasks: number
  dueSoonTasks: number
  overdueTasks: number
  reviewDueTasks: number
  averageActionScore: number | null
  statusSlices: TaskDashboardStatusSlice[]
  dueBuckets: TaskDashboardDueBucket[]
  blockerItems: TaskDashboardBlockerItem[]
  topActions: TaskDashboardActionItem[]
}

interface TaskDashboardProps {
  data: TaskDashboardData
  generatedAt: Date
  onOpenTask?: (blockId: DbId) => void
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

  React.useEffect(() => {
    ensureTaskDashboardStyles()
  }, [])

  const completionValue = formatPercent(props.data.completionRate)
  const generatedAtText = props.generatedAt.toLocaleTimeString(isChinese ? "zh-CN" : undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })

  const metricCards: DashboardMetricCard[] = [
    {
      key: "total",
      label: t("Total tasks"),
      value: String(props.data.totalTasks),
      hint: t("All Tasks"),
      tone: "cool",
    },
    {
      key: "actionable",
      label: t("Actionable now"),
      value: String(props.data.actionableTasks),
      hint: t("Active Tasks"),
      tone: "warm",
    },
    {
      key: "dueSoon",
      label: t("Due Soon"),
      value: String(props.data.dueSoonTasks),
      hint: t("Tasks due within horizon"),
      tone: "neutral",
    },
    {
      key: "review",
      label: t("Review due"),
      value: String(props.data.reviewDueTasks),
      hint: t("Review"),
      tone: "cool",
    },
    {
      key: "starred",
      label: t("Starred Tasks"),
      value: String(props.data.starredTasks),
      hint: t("Starred"),
      tone: "warm",
    },
    {
      key: "overdue",
      label: t("Overdue tasks"),
      value: String(props.data.overdueTasks),
      hint: t("Needs immediate attention"),
      tone: "danger",
    },
  ]

  const maxStatusCount = Math.max(
    1,
    ...props.data.statusSlices.map((slice) => slice.count),
  )
  const maxDueCount = Math.max(1, ...props.data.dueBuckets.map((bucket) => bucket.count))
  const maxBlockerCount = Math.max(1, ...props.data.blockerItems.map((item) => item.count))
  const actionScoreText = props.data.averageActionScore == null
    ? "--"
    : props.data.averageActionScore.toFixed(1)

  return React.createElement(
    "div",
    {
      className: "mlo-dashboard-root",
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
            t("Completion rate"),
          ),
          React.createElement(
            "strong",
            {
              className: "mlo-dashboard-hero-value",
            },
            completionValue,
          ),
          React.createElement(
            "div",
            {
              className: "mlo-dashboard-progress-track",
            },
            React.createElement("div", {
              className: "mlo-dashboard-progress-fill",
              style: {
                width: `${Math.max(0, Math.min(100, props.data.completionRate))}%`,
              },
            }),
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
            t("Avg action score"),
          ),
          React.createElement(
            "strong",
            {
              className: "mlo-dashboard-hero-value",
            },
            actionScoreText,
          ),
          React.createElement(
            "span",
            {
              className: "mlo-dashboard-hero-helper",
            },
            t("Based on active tasks"),
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
          t("Status distribution"),
        ),
        React.createElement(
          "div",
          {
            className: "mlo-dashboard-list",
          },
          ...props.data.statusSlices.map((slice) => {
            const percentage = props.data.totalTasks === 0
              ? 0
              : (slice.count / props.data.totalTasks) * 100
            return React.createElement(
              "div",
              {
                key: slice.key,
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
                  slice.label,
                ),
                React.createElement(
                  "span",
                  {
                    className: "mlo-dashboard-list-value",
                  },
                  `${slice.count} / ${formatPercent(percentage)}`,
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
                    width: `${(slice.count / maxStatusCount) * 100}%`,
                    background: slice.color,
                  },
                }),
              ),
            )
          }),
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

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
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
  --mlo-dash-ink: #13232f;
  --mlo-dash-line: rgba(19, 35, 47, 0.12);
  --mlo-dash-warm: #d97706;
  --mlo-dash-cool: #0f766e;
  --mlo-dash-alert: #c2410c;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  color: var(--orca-color-text, #17212b);
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
  background:
    linear-gradient(132deg, rgba(217, 119, 6, 0.14), rgba(15, 118, 110, 0.12) 52%, rgba(15, 23, 42, 0.06)),
    repeating-linear-gradient(36deg, rgba(19, 35, 47, 0.03), rgba(19, 35, 47, 0.03) 8px, rgba(19, 35, 47, 0) 8px, rgba(19, 35, 47, 0) 16px),
    var(--orca-color-bg-1);
  box-shadow: 0 16px 26px rgba(15, 23, 42, 0.12);
}

.mlo-dashboard-hero::after {
  content: "";
  position: absolute;
  width: 220px;
  height: 220px;
  right: -90px;
  top: -90px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(217, 119, 6, 0.2), transparent 70%);
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
  background: rgba(15, 118, 110, 0.14);
  color: #0f766e;
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
  color: var(--orca-color-text-2);
}

.mlo-dashboard-hero-stats {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mlo-dashboard-hero-stat {
  border: 1px solid rgba(19, 35, 47, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(1px);
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-hero-label {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--orca-color-text-2);
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
  color: var(--orca-color-text-2);
}

.mlo-dashboard-progress-track {
  height: 6px;
  border-radius: 999px;
  background: rgba(19, 35, 47, 0.12);
  overflow: hidden;
}

.mlo-dashboard-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #0f766e, #0ea5a5);
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
  background: linear-gradient(148deg, rgba(255, 255, 255, 0.66), var(--orca-color-bg-1));
  animation: mloDashboardLiftIn 320ms cubic-bezier(.2,.8,.2,1) backwards;
}

.mlo-dashboard-metric-cool {
  border-color: rgba(15, 118, 110, 0.3);
}

.mlo-dashboard-metric-warm {
  border-color: rgba(217, 119, 6, 0.3);
}

.mlo-dashboard-metric-danger {
  border-color: rgba(194, 65, 12, 0.3);
}

.mlo-dashboard-metric-neutral {
  border-color: rgba(19, 35, 47, 0.18);
}

.mlo-dashboard-metric-label {
  font-size: 11px;
  color: var(--orca-color-text-2);
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
  color: var(--orca-color-text-2);
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
  background: linear-gradient(162deg, rgba(255, 255, 255, 0.68), var(--orca-color-bg-1));
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
  color: var(--orca-color-text);
}

.mlo-dashboard-list-value {
  font-size: 11px;
  color: var(--orca-color-text-2);
}

.mlo-dashboard-track {
  height: 7px;
  border-radius: 999px;
  background: rgba(19, 35, 47, 0.1);
  overflow: hidden;
}

.mlo-dashboard-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #d97706, #0f766e);
  transition: width 260ms ease;
}

.mlo-dashboard-due-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  align-items: end;
}

.mlo-dashboard-due-cell {
  border: 1px solid rgba(19, 35, 47, 0.12);
  border-radius: 8px;
  min-height: 112px;
  padding: 6px 4px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 4px;
  background: linear-gradient(180deg, rgba(15, 118, 110, 0.08), rgba(15, 118, 110, 0.01));
}

.mlo-dashboard-due-cell.is-past {
  background: linear-gradient(180deg, rgba(194, 65, 12, 0.13), rgba(194, 65, 12, 0.03));
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
  background: rgba(19, 35, 47, 0.08);
  overflow: hidden;
  min-height: 58px;
  display: flex;
  align-items: flex-end;
}

.mlo-dashboard-due-bar-fill {
  width: 100%;
  min-height: 8px;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, #d97706, #0f766e);
  transition: height 280ms ease;
}

.mlo-dashboard-due-label {
  text-align: center;
  font-size: 10px;
  color: var(--orca-color-text-2);
}

.mlo-dashboard-top-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mlo-dashboard-top-item {
  border: 1px solid rgba(19, 35, 47, 0.14);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.62);
  padding: 7px 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  cursor: pointer;
  text-align: left;
}

.mlo-dashboard-top-item:hover {
  border-color: rgba(15, 118, 110, 0.42);
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}

.mlo-dashboard-top-text {
  font-size: 12px;
  color: var(--orca-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlo-dashboard-top-score {
  font-size: 11px;
  border-radius: 999px;
  padding: 2px 7px;
  background: rgba(15, 118, 110, 0.12);
  color: #0f766e;
  font-weight: 650;
}

.mlo-dashboard-top-due {
  font-size: 10px;
  color: var(--orca-color-text-2);
  white-space: nowrap;
}

.mlo-dashboard-empty {
  border-radius: 9px;
  border: 1px dashed rgba(19, 35, 47, 0.2);
  padding: 10px;
  font-size: 12px;
  color: var(--orca-color-text-2);
  background: rgba(19, 35, 47, 0.03);
}

@media (max-width: 1100px) {
  .mlo-dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mlo-dashboard-hero {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .mlo-dashboard-due-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
