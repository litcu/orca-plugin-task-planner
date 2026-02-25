# orca-task-planner

[![English](https://img.shields.io/badge/README-English-1f6feb)](README.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2ea44f)](README_zh.md)

`orca-task-planner` is an all-in-one planning and execution plugin for Orca Note.

## Plugin Overview

A task command center for Orca Note. It helps you:

- capture ideas as tasks in seconds
- run planning, scheduling, execution, and review in one flow
- focus only on actionable work in **Active Tasks**
- shape today with **My Day** (list and schedule)
- track real effort with built-in timer
- reduce priority decision fatigue with scoring and views

## Key Features

### 0) Quick capture (fast task collection)

The first step of task management is not perfect planning, but not losing input.  
The plugin supports immediate task capture inside notes:

- convert the current block into a task with `Alt+Enter`
- create a new task block quickly from the task management panel (`Add task`)
- fill time/dependency/priority details later in the property panel

Capture first, refine later, without breaking your writing flow.

### 1) Fast task status switching

Status switching is designed as a low-friction editor action:

- press `Alt+Enter` to create a task and cycle status
- status sequence: `TODO -> Doing -> Done -> TODO`
- click the left status icon for the same status cycle
- when switching to `Doing`, start time is recorded automatically
- if timer auto-start is enabled, switching to `Doing` also starts task timer

Progress and execution records stay inside the editor, so workflow stays continuous.

### 2) Task Property Panel: fast task editing

Click the task tag to open a single editing surface for "fill in -> save -> continue":

- basic fields: status, start time, due time, labels, notes, star
- planning fields: importance, urgency, effort
- dependency fields: dependency targets, dependency mode (`ALL` / `ANY`), dependency delay
- cycle fields: review rules, recurrence rules

The panel includes validation and quick save. Dependency targets can be selected by block references, making complex task graphs manageable without context switching.

### 3) Task Management Panel: one place to manage all tasks

The task panel is the plugin's operations hub for viewing, filtering, editing, and executing tasks.  
Included views:

- **Dashboard**: global snapshot (completion, due pressure, blockers, top priorities)
- **My Day**: daily focus list and schedule board (list/schedule mode)
- **Active Tasks**: executable tasks right now (primary execution entry)
- **All Tasks**: full task tree (hierarchy and drag/drop management)
- **Starred Tasks**: manually highlighted tasks
- **Due Soon**: tasks due within configured window
- **Review**: review queue and batch review actions
- **Custom Views**: scenario-specific saved rule-based views

It supports the full loop of **inspect -> adjust -> execute -> review** in one place.

### 4) Active Tasks: GTD-oriented execution list

`Active Tasks` is designed to answer one question instantly: "What should I do right now?"

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
base = 0.40*I + 0.22*U + 0.20*D + 0.10*S + 0.08*C
score = base * criticalBoost * deadlineBoost * startByBoost * agingBoost / timePenalty
```

Where:

- `timePenalty = 1 + 0.9*EffN`
- `criticalBoost = 1 + 0.3*Criticality`
- `deadlineBoost = 1 + 0.25*OverdueN`
- `startByBoost = 1 + 0.22*StartBy`
- `agingBoost = 1 + 0.12*AgingN`

And key factors are:

- `I/U`: non-linear mapping of importance/urgency (neutral at `50`)
- `D`: due factor (`45` if no due date, `100` if overdue, otherwise exponential decay by due distance)
- `S`: start factor (`100` when start is reached, quadratic decay for future tasks, floor at `10`)
- `C`: context factor (`80` for starred tasks, otherwise `50`)
- `EffN`: normalized effort (`effort/100`)
- `Criticality`: dependency criticality from dependency graph (`0.6*descendants + 0.4*dependencyDemand`)
- `OverdueN`: normalized overdue days (`daysOverdue/7`)
- `StartBy`: latest-start pressure using effort and remaining days
- `AgingN`: waiting-time factor (`waitingDays/14`)
- `dependencyDemand`: downstream task demand intensity (higher when dependent tasks are high importance/urgency)

Sort order:

1. overdue tasks first
2. score descending
3. due time ascending
4. stable internal ID order

You do not need to manually compare tasks repeatedly. The list keeps attention on what is most worth pushing now.

#### Recommended usage

- start each work session from `Active Tasks`
- execute from top to bottom to reduce context switching
- combine `Due Soon` for short-term scheduling and `Dashboard` for macro calibration

### 5) Recurring tasks

Recurring rules turn repeated planning into automatic progression:

- daily / weekly / monthly recurrence
- interval, weekday (weekly), max count, end date
- automatic roll-forward to next cycle when completed
- coordinated timeline progression for related subtasks in task hierarchies

Great for standups, weekly reports, maintenance checks, and other cadence-based work.

### 6) Task review

Review keeps long-running work visible so tasks do not disappear after kickoff:

- single review and cyclic review
- configurable review interval (e.g., every N days/weeks/months)
- centralized review handling in `Review` view
- batch `Mark reviewed` action with automatic next-review progression

### 7) Custom views

Custom views save high-frequency filters as reusable entry points:

- create, edit, and delete custom views
- combine rules with AND/OR logic
- filter by status, time, dependencies, labels, and more
- persistent across restarts

Useful for recurring contexts such as work/home/project phase/weekly planning.

### 8) Task dashboard

`Dashboard` gives an operating view of your task system:

- key metrics: total tasks, active tasks, review tasks, overdue tasks
- structure metrics: status distribution, due pressure
- risk metrics: major blocker categories
- execution metrics: top-priority active tasks

Use it for a quick daily calibration before execution starts.

### 9) My Day view

`My Day` turns "today's plan" into an executable workspace:

- keep a dedicated "today list" of tasks
- switch between list mode and schedule mode
- drag and resize task cards on timeline for time blocking
- use right-click menu on cards for quick actions
- sync My Day tasks to today journal section automatically
- avoid duplicate mirror insertion when the task already exists in today's journal

Move directly from priority list to concrete time blocks without duplicating task sources.

### 10) Task timer

The built-in task timer turns "I worked on it for a while" into measurable effort:

- timer modes: `Direct timer` and `Pomodoro timer`
- start/stop timer from task rows and inline task widgets
- only one running task timer at a time (starting one stops others)
- optional auto-start when status switches to `Doing`
- auto-stop when status switches to `Done`
- elapsed time persists across restarts

Useful for effort review and better estimation over time.

### 11) Startup task summary notification

On startup, the plugin can show a quick snapshot of today's workload:

- active task count
- overdue task count
- due-soon task count within configured due-soon window

This notification is optional and can be toggled in settings.

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

### Install from GitHub Release

1. Download `orca-task-planner-vX.Y.Z.zip` from GitHub `Releases` assets.
2. Extract it to your Orca plugins folder:  
   `C:\Users\<your-name>\Documents\orca\plugins\`
3. Ensure the final structure is:  
   `...\plugins\orca-task-planner\dist\index.js`
4. Start/restart Orca Note and enable `orca-task-planner`.


## Quick Start

1. Open Command Palette and run `Open task management panel` (your unified workspace).
2. Create a task:
   - place cursor on any block
   - press `Alt+Enter`
   - status cycle: `TODO -> Doing -> Done -> TODO`
3. Open task properties:
   - click the task tag, or
   - run `Open task property popup`
4. Set core fields:
   - start time / due time
   - dependency mode (`ALL` or `ANY`)
   - dependency delay (if needed)
   - importance / urgency / effort
5. Switch to **Active Tasks** and execute in order.
6. Use `All Tasks` for hierarchy and drag/drop structure management.
7. Use `My Day` for daily focus and schedule planning.
8. Use `Review` for periodic review and batch review actions.
9. Use `Due Soon` and `Dashboard` for planning and global overview.

## Commands and Shortcut

- `Alt+Enter`: create/cycle task status
- `Open task management panel`: open task management panel
- `Open task property popup`: open task property panel

## Data and Persistence

- task-facing fields are stored in task tag properties
- extended planning fields are persisted in block property `_mlo_task_meta`
- task timer data is persisted in block property `_mlo_task_timer`
- custom views and My Day state are persisted in plugin local data
- local-first persistence, with no external service required

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

### How do I set the initial task panel view?

Use plugin setting:

- **Default task panel view** (used when opening the task panel for the first time)

### Can I hide the top task panel icon?

Yes. In plugin settings:

- **Show task panel icon** (enabled by default)

### How do I use My Day view?

Enable it in plugin settings via **Enable My Day**, then switch to `My Day` tab in task panel.

### How does My Day day boundary work?

Use **My Day start hour** to define when a new My Day starts (0-23 local hour).

### How does task timer work with status switching?

If **Auto start timer when status becomes Doing** is enabled, switching to `Doing` starts timer automatically.  
Switching to `Done` stops running timer automatically.

### Why does starting one task timer stop another running timer?

The plugin enforces a single running task timer globally to keep elapsed time records consistent.

### Can I disable startup task summary notification?

Yes. Disable **Notify task summary on startup** in plugin settings.

## Development

```bash
npm install
npm run dev
npm run build
```

## Release

One-click release commands:

```bash
npm run release
```

Version level options:

```bash
npm run release:dry-run
npm run release:patch
npm run release:minor
npm run release:major
```

`release:dry-run` will only build and package locally (no version bump, no commit/tag, no push).  
Local artifact path:

```text
release/orca-task-planner-vX.Y.Z.zip
```

`release` / `release:patch` / `release:minor` / `release:major` will:

1. ensure git working tree is clean
2. ensure current branch is `main`
3. run `npm run build`
4. run `npm version <patch|minor|major> --tag-version-prefix v` (creates commit + tag)
5. run `git push origin main`
6. run `git push origin vX.Y.Z`

After push, GitHub Actions will auto-create (or update) Release and upload `orca-task-planner-vX.Y.Z.zip`.
