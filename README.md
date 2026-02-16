# orca-task-planner

[![English](https://img.shields.io/badge/README-English-1f6feb)](README.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2ea44f)](README_zh.md)

`orca-task-planner` is a task management plugin for Orca Note.

## Plugin Overview

This plugin is designed for notes with many tasks where execution order matters.

It helps you:

- capture tasks quickly from normal blocks
- plan tasks with time, dependencies, review, and recurrence
- focus on executable work in **Active Tasks**
- prioritize work using score-based ranking
- complete planning, execution, and review in one unified panel

## Key Features

### 0) Quick capture (fast task collection)

In GTD-style workflows, capture-first is critical.  
The plugin supports fast task collection directly in notes:

- convert the current block into a task with `Alt+Enter`
- create a new task block quickly from the task management panel (`Add task`)
- fill time/dependency/priority details later in the property panel

This allows you to capture first, then organize and schedule in batches.

### 1) Fast task status switching

The plugin provides low-friction status switching:

- press `Alt+Enter` to create a task and cycle status
- status sequence: `TODO -> Doing -> Done -> TODO`
- click the left status icon for the same status cycle
- when switching to `Doing`, start time is recorded automatically

This keeps task capture and execution transitions inside the editor flow.

### 2) Task Property Panel: fast task editing

Click the task tag to open a task property panel and edit key fields in one place:

- basic fields: status, start time, due time, labels, notes, star
- planning fields: importance, urgency, effort
- dependency fields: dependency targets, dependency mode (`ALL` / `ANY`), dependency delay
- cycle fields: review rules, recurrence rules

The panel includes validation and quick save behavior. Dependency targets can be selected by block references, which is useful for complex task graphs.

### 3) Task Management Panel: one place to manage all tasks

The plugin provides a unified task management panel for viewing, filtering, editing, and maintaining all tasks.  
Included views:

- **Dashboard**: global snapshot (completion, due pressure, blockers, top priorities)
- **Active Tasks**: executable tasks right now (primary execution entry)
- **All Tasks**: full task tree (hierarchy and drag/drop management)
- **Starred Tasks**: manually highlighted tasks
- **Due Soon**: tasks due within configured window
- **Review**: review queue and batch review actions
- **Custom Views**: scenario-specific saved rule-based views

This panel supports the full loop of **inspect -> adjust -> execute -> review**.

### 4) Active Tasks: GTD-oriented execution list

In GTD (Getting Things Done), the key is always knowing the next executable action.  
`Active Tasks` implements this idea by showing only tasks you can execute now.

#### Eligibility rules

A task enters `Active Tasks` only if all checks pass:

1. task is not completed and not canceled
2. start time is reached (or not set)
3. no unfinished subtasks exist
4. ancestor dependency chain does not block
5. own dependency condition is satisfied (`ALL` / `ANY` + delay)

#### Priority score formula

Active tasks are scored and ranked with:

```text
Score = 0.40*Importance + 0.25*Urgency + 0.20*DueFactor + 0.10*StartFactor + 0.05*100
```

Sort order:

1. score descending
2. due time ascending
3. stable internal ID order

#### Recommended usage

- start each work session from `Active Tasks`
- execute from top to bottom to reduce context switching
- combine `Due Soon` for short-term scheduling and `Dashboard` for macro calibration

### 5) Recurring tasks

The plugin supports structured recurrence rules for routine and periodic work:

- daily / weekly / monthly recurrence
- interval, weekday (weekly), max count, end date
- automatic roll-forward to next cycle when completed
- coordinated timeline progression for related subtasks in task hierarchies

This turns recurring-task management from manual copying into rule-driven automation.

### 6) Task review

The review system helps maintain a stable review cadence so long-lived tasks are not forgotten:

- single review and cyclic review
- configurable review interval (e.g., every N days/weeks/months)
- centralized review handling in `Review` view
- batch `Mark reviewed` action with automatic next-review progression

### 7) Custom views

Custom views let you persist reusable task slices for different scenarios:

- create, edit, and delete custom views
- combine rules with AND/OR logic
- filter by status, time, dependencies, labels, and more
- persistent across restarts

Useful for long-term slices such as work/home/project phase/weekly planning.

### 8) Task dashboard

`Dashboard` provides macro observability for your task system:

- key metrics: total tasks, active tasks, review tasks, overdue tasks
- structure metrics: status distribution, due pressure
- risk metrics: major blocker categories
- execution metrics: top-priority active tasks

Use it to quickly assess task-system health and rebalance your planning rhythm.

## Installation

### Install from source

1. Place this project under Orca plugin directory, for example:  
   `C:\Users\<your-name>\Documents\orca\plugins\orca-task-planner`
2. Build:

```bash
npm install
npm run build
```

3. Start/restart Orca Note.
4. Enable `orca-task-planner` in plugin settings.

Build output: `dist/index.js`.

## Quick Start

1. Open Command Palette and run `Open Task Views Panel`.
2. Create a task:
   - place cursor on any block
   - press `Alt+Enter`
   - status cycle: `TODO -> Doing -> Done -> TODO`
3. Open task properties:
   - click the task tag, or
   - run `Open task properties`
4. Set core fields:
   - start time / due time
   - dependency mode (`ALL` or `ANY`)
   - dependency delay (if needed)
   - importance / urgency / effort
5. Switch to **Active Tasks** and execute in order.
6. Use `All Tasks` for hierarchy and drag/drop structure management.
7. Use `Review` for periodic review and batch review actions.
8. Use `Due Soon` and `Dashboard` for planning and global overview.

## Commands and Shortcut

- `Alt+Enter`: create/cycle task status
- `Open Task Views Panel`: open task management panel
- `Toggle Task Views Panel`: show/hide task management panel
- `Open task properties`: open task property panel

## Data and Persistence

- task-facing fields are stored in task tag properties
- extended planning fields are persisted in internal task metadata
- custom views are persisted in plugin local data
- no external service is required for core functionality

## FAQ

### Why is a task missing from Active Tasks?

Most common reasons:

- start time not reached yet
- dependency not completed
- dependency delay not elapsed
- ancestor dependency still blocks
- unfinished subtasks exist
- task is already done/canceled

### Why did Active Tasks order change?

When task fields or dependency state changes (for example due date, urgency, dependency completion), scoring updates and order changes accordingly.

### How should I choose `ALL` vs `ANY` dependency mode?

- `ALL`: start only after all prerequisites are completed
- `ANY`: start when any prerequisite is completed

### Can I change the task tag name?

Yes. Update **Task tag name** in plugin settings.

### How do I adjust Due Soon range?

Use plugin settings:

- **Due soon days**
- **Include overdue in Due Soon**

## Development

```bash
npm install
npm run dev
npm run build
```
