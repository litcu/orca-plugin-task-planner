# Task Planner

[![English](https://img.shields.io/badge/README-English-1f6feb)](README_en.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2ea44f)](README.md)

Task Planner is an all-in-one task planning and execution plugin for [Orca Note](https://github.com/sethyuan/orca-note). It turns ordinary blocks into manageable tasks and helps you move work forward with task tags, active-task detection, My Day, timers, reviews, recurring tasks, and custom views.

Project home: [https://github.com/litcu/orca-plugin-task-planner](https://github.com/litcu/orca-plugin-task-planner)

## Index

- [Task Planner](#task-planner)
  - [Index](#index)
  - [Plugin Overview](#plugin-overview)
  - [Feature Guide](#feature-guide)
    - [0) Quick Capture](#0-quick-capture)
    - [1) Task Tags and Status Flow](#1-task-tags-and-status-flow)
    - [2) Task Property Popup](#2-task-property-popup)
    - [3) Task Management Panel](#3-task-management-panel)
    - [4) Active Tasks and Blocking Rules](#4-active-tasks-and-blocking-rules)
    - [5) Dependencies, Parent Tasks, and Sequential Subtasks](#5-dependencies-parent-tasks-and-sequential-subtasks)
    - [6) My Day](#6-my-day)
    - [7) Task Timer](#7-task-timer)
    - [8) Reviews](#8-reviews)
    - [9) Recurring Tasks](#9-recurring-tasks)
    - [10) Filters and Custom Views](#10-filters-and-custom-views)
    - [11) Startup Task Summary](#11-startup-task-summary)
  - [Quick Start](#quick-start)
  - [Commands and Shortcuts](#commands-and-shortcuts)
  - [Data and Persistence](#data-and-persistence)
  - [Settings](#settings)
  - [Installation and Releases](#installation-and-releases)
  - [Local Development](#local-development)
  - [Documentation](#documentation)
  - [License](#license)

## Plugin Overview

Task Planner is a task command center for Orca Note. It helps you:

- capture ideas as tasks in seconds
- move from task lists to scheduling, execution, review, and recurrence
- focus only on currently actionable work in **Active Tasks**
- plan today's workload with **My Day** list and schedule views
- track real effort with direct or Pomodoro timers
- reduce priority decision fatigue with scoring, filters, and saved views

## Feature Guide

### 0) Quick Capture

The first step of task management is not perfect planning. It is making sure the task is not lost.

- Add `#Task` to any block to turn it into a task.
- Press `Alt+Enter` inside a block to initialize a task and use the fast status flow.
- Create new tasks directly from the task management panel.
- Fill dates, dependencies, labels, reviews, recurring rules, and custom fields later in the property popup.

### 1) Task Tags and Status Flow

The plugin initializes a `Task` tag and keeps task-facing fields on the tag reference.

- Core statuses are `TODO`, `Doing`, `Waiting`, and `Done` in English workspaces.
- `Alt+Enter` switches the main execution loop between `TODO` and `Doing`.
- Clicking the status icon on the left side of a task block opens a full status menu.
- Switching a task to `Doing` records a start time when none exists.
- When timer auto-start is enabled, switching to `Doing` starts the task timer.

### 2) Task Property Popup

Click a task tag, use the tag menu, or run the command to open a focused task editor.

- Edit status, start time, due time, star, labels, and remarks.
- Edit dependency targets, dependency mode (`ALL` / `ANY`), and dependency delay.
- Configure review tracking and recurring rules.
- Edit priority fields such as importance, urgency, and effort.
- Preserve supported custom task-tag properties in the same workflow.

### 3) Task Management Panel

The task panel is the main workspace for reading, filtering, editing, and executing tasks.

- **Dashboard**: live metrics, due pressure, blockers, and top actionable tasks.
- **Active Tasks**: tasks that are actionable right now.
- **All Tasks**: the full task tree with hierarchy management.
- **Starred Tasks**: manually highlighted tasks.
- **Due Soon**: tasks due within the configured horizon.
- **Review**: tasks that need review, with batch review actions.
- **My Day**: today's task list and schedule board.
- **Custom Views**: saved filter views for recurring contexts.

### 4) Active Tasks and Blocking Rules

Active Tasks is designed to answer one question: what can I do now?

A task is blocked when any of these conditions apply:

1. the task is completed or canceled
2. the start time has not arrived
3. dependencies are not satisfied
4. dependency delay is still active
5. open subtasks are still present
6. a previous sequential subtask is unfinished
7. an ancestor task is blocked by dependencies

Actionable tasks are scored and sorted by urgency, importance, due pressure, start timing, star context, effort, dependency criticality, and task age. Overdue tasks are prioritized first, then score, due time, and stable task ID.

### 5) Dependencies, Parent Tasks, and Sequential Subtasks

Task Planner supports both explicit dependencies and document-tree task structure.

- Use `Depends on` to select prerequisite tasks.
- Choose `ALL` when every dependency must finish first.
- Choose `ANY` when one completed dependency is enough.
- Add dependency delay when a task should wait after dependencies are satisfied.
- Link a block to a parent task from the block menu.
- Enable sequential subtasks on a parent task so children enter Active Tasks one by one in their current order.

### 6) My Day

My Day turns today's plan into an executable workspace.

- Add or remove tasks from My Day from task rows.
- Work in list mode for lightweight daily focus.
- Switch to schedule mode to drag tasks onto a timeline.
- Keep unscheduled tasks visible while planning time blocks.
- Sync My Day tasks into today's journal as reference blocks.
- Reset the My Day boundary based on the configured local start hour.

### 7) Task Timer

The built-in timer turns "I worked on this" into persistent task data.

- Use direct timer mode for simple elapsed-time tracking.
- Use Pomodoro mode for focus, short break, and long break cycles.
- Start, stop, pause, resume, and clear timers from task rows.
- Run only one task timer globally at a time.
- Starting a timer promotes `TODO` or `Waiting` tasks to `Doing`.
- Switching to `Done` or `Waiting` stops a running timer.

### 8) Reviews

Review tracking keeps long-running tasks visible after the initial capture.

- Use a one-time review for a single future check.
- Use cyclic review for ongoing review intervals.
- Find due reviews in the Review view.
- Mark one task or selected tasks as reviewed.
- Automatically advance the next review time for cyclic reviews.

### 9) Recurring Tasks

Recurring rules reduce repeated manual planning for routine work.

- Repeat by day, week, or month.
- Configure interval, weekday, repeat time, maximum count, and end date.
- When a task is completed, the plugin can advance it to the next occurrence.
- Recurrence works with task timing and task state so routine items remain reusable.

### 10) Filters and Custom Views

Custom views turn repeated filtering into a reusable task workspace.

- Filter by task name, status, labels, dates, review rules, and custom properties.
- Combine rules with `AND` / `OR` groups.
- Use operators such as equals, contains, between, before, after, empty, and not empty.
- Save, edit, and delete custom views from the task panel.
- Reopen saved views after restarting Orca Note.

### 11) Startup Task Summary

On plugin startup, Task Planner can show a short workload snapshot.

- active task count
- overdue task count
- tasks due within the configured due-soon window

The notification is controlled by plugin settings and can be disabled.

## Quick Start

1. Download the plugin package from [Releases](https://github.com/litcu/orca-plugin-task-planner/releases), then install and enable it in Orca Note.
2. Add the `#Task` tag to any block, or place the cursor inside a block and press `Alt+Enter`, to turn it into a task.
3. Click the task button in the top bar, or run "Open task management panel" from the command palette, to view Dashboard, Active Tasks, All Tasks, and other views.
4. Click a task tag to open the property popup, then add due dates, dependencies, labels, reviews, recurring rules, and more.
5. Use Active Tasks for execution, My Day for daily planning, Review for periodic follow-up, and Custom Views for saved task contexts.
6. Open plugin settings to enable My Day, task timers, startup task summary notifications, the default panel view, and subtask progress bars as needed.

## Commands and Shortcuts

- `Alt+Enter`: initialize a task or switch the main status flow.
- `Open task management panel`: open the task management panel.
- `Open task property popup`: open the task property popup for the current task block.

## Data and Persistence

- User-facing task fields are stored on the task tag reference.
- Extended task metadata is stored in the block property `_mlo_task_meta`.
- Timer data is stored in the block property `_mlo_task_timer`.
- My Day state and custom views are stored in plugin-local data.
- The plugin is local-first and does not require an external service.

## Settings

- `Task tag name`: The tag used to identify tasks. The default is `Task`, and changes apply immediately.
- `Show task panel icon`: Controls whether the task panel button appears in the top bar.
- `Show subtask progress bar`: Shows subtask completion progress in task lists.
- `Default task panel view`: Sets the view shown when the task panel is opened for the first time.
- `Enable My Day` and `My Day start hour`: Enable My Day and configure the hour used for daily reset and schedule timeline start.
- `Due soon days` and `Include overdue in Due Soon`: Configure the time horizon for the Due Soon view and whether overdue tasks are included.
- `Notify task summary on startup`: Shows a startup notification with counts for active, overdue, and due-soon tasks.
- `Enable task timer`, `Auto start timer when status becomes Doing`, and `Task timer mode`: Enable timers, auto-start timing, and choose direct or Pomodoro mode.

## Installation and Releases

- Repository: [https://github.com/litcu/orca-plugin-task-planner](https://github.com/litcu/orca-plugin-task-planner)
- Download packages: [Releases](https://github.com/litcu/orca-plugin-task-planner/releases)
- Report issues: [Issues](https://github.com/litcu/orca-plugin-task-planner/issues)

A release package usually includes `dist/index.js`, `package.json`, `LICENSE`, `README.md`, and the plugin icon. Use the zip file from the latest Release when installing.

## Local Development

This repository uses npm and the existing `package-lock.json`.

```bash
npm install
npm run dev
npm run build
```

Common validation and release dry run commands:

```bash
npm run check:marketplace
npm run release:dry-run
```

The repository currently has no separate `test` or `lint` script, so `npm run build` is the baseline validation. When changing marketplace metadata or release package structure, also run `npm run check:marketplace`. When changing release scripts, prefer `npm run release:dry-run`.

## Documentation

Before contributing, start with the [architecture and data-flow documentation index](./doc/文档索引.md). The docs are organized by runtime registration, data model, task lifecycle, queries and views, dependency scoring, My Day, timers, reviews and recurring tasks, and custom views.

## License

This project is released under the [Apache-2.0](./LICENSE) license.
