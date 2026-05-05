# Task Planner

[![English](https://img.shields.io/badge/README-English-1f6feb)](README_en.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2ea44f)](README.md)

Task Planner 是一个面向 [Orca Note](https://github.com/sethyuan/orca-note) 的一体化任务规划与执行插件。它把普通块转成可管理的任务，并围绕任务标签、激活任务、My Day、计时器、回顾、重复任务和自定义视图，帮助你把笔记里的事项推进到真正可执行。

项目主页：[https://github.com/litcu/orca-plugin-task-planner](https://github.com/litcu/orca-plugin-task-planner)

## 功能亮点

- **任务标签与状态流转**：插件会初始化 `Task` 标签，并为任务维护状态、开始时间、结束时间、依赖、收藏、标签和备注等字段。你可以用 `Alt+Enter` 在待开始和进行中之间快速切换，也可以点击块左侧状态图标打开状态菜单。
- **任务属性弹窗**：点击任务标签或使用命令打开属性面板，集中编辑状态、时间、依赖、回顾、重复、标签、备注和自定义属性。
- **任务管理面板**：通过顶部按钮或命令打开任务面板，在 Dashboard、Active Tasks、All Tasks、Starred Tasks、Due Soon、Review、My Day 和自定义视图之间切换。
- **激活任务计算**：自动判断哪些任务现在可执行，哪些任务被开始时间、依赖、依赖延迟、未完成子任务、顺序子任务或父级依赖阻塞。
- **依赖与顺序任务**：支持依赖任务、`ALL` / `ANY` 依赖模式、依赖延迟、父子任务关联，以及“顺序子任务”模式，让子任务按文档顺序逐个进入 Active Tasks。
- **My Day**：把今天要处理的任务加入 My Day，支持列表和日程排期，并可同步到今日日志中的引用块。My Day 会按你设置的开始小时跨日重置。
- **任务计时器**：可选启用直接计时或番茄钟。计时器会持久化到任务块，并确保同一时间只有一个任务处于运行中；也可以配置任务切到进行中时自动开始计时。
- **回顾与重复任务**：支持单次回顾、周期回顾、批量标记已回顾，以及按天、周、月推进的重复任务规则。
- **筛选与自定义视图**：在任务面板中按任务名、状态、标签、时间、回顾规则和自定义字段筛选，并用 `AND` / `OR` 条件组保存自己的任务视图。

## 快速上手

1. 从 [Releases](https://github.com/litcu/orca-plugin-task-planner/releases) 下载插件包，并在 Orca Note 中安装启用。
2. 在任意块中添加 `#Task` 标签，或把光标放在块内按 `Alt+Enter`，即可把它变成任务。
3. 点击顶部栏的任务按钮，或在命令面板中运行“打开任务管理面板”，查看 Dashboard、Active Tasks、All Tasks 等视图。
4. 点击任务标签打开属性弹窗，补充截止时间、依赖、标签、回顾、重复规则等信息。
5. 到插件设置中按需启用 My Day、任务计时器、启动任务汇总通知、默认面板视图和子任务进度条。

## 常用工作流

### 管理今天

启用 My Day 后，可以把任务加入“我的一天”，在列表中快速处理，也可以切到日程视图拖拽排期。插件会用引用块把 My Day 同步到今日日志，适合把日计划留在日记上下文里。

### 找到下一步行动

Active Tasks 会只展示当前可执行的任务。任务如果还没到开始时间、依赖未完成、依赖延迟未结束、仍有开放子任务，或前序子任务尚未完成，就会被标记为阻塞，帮助你把注意力放在真正能推进的事项上。

### 维护项目任务树

任务可以按 Orca 块结构形成父子关系。你可以在任务面板里拖拽移动任务，也可以通过块菜单把当前块关联到某个父任务。对父任务开启“顺序子任务”后，子任务会按当前位置逐个进入 Active Tasks。

### 记录专注时间

启用任务计时器后，任务列表会显示开始、停止和清除计时操作。直接计时适合记录实际投入时长，番茄钟适合专注/休息节奏。完成或等待任务时，运行中的计时会自动停止。

### 建立自己的视图

自定义视图支持条件组和多字段筛选。你可以保存类似“本周交付”“等待他人”“高优先级工作”“需要回顾”的视图，并在任务面板中长期复用。

## 设置项

- `Task tag name`：用于识别任务的标签名称，默认是 `Task`，修改后会立即应用。
- `Show task panel icon`：控制顶部栏任务面板按钮是否显示。
- `Show subtask progress bar`：在任务列表中显示子任务完成进度。
- `Default task panel view`：设置首次打开任务面板时默认展示的视图。
- `Enable My Day` 与 `My Day start hour`：启用 My Day，并设置跨日重置和日程时间轴的起始小时。
- `Due soon days` 与 `Include overdue in Due Soon`：配置“即将到期”视图的时间范围和是否包含超期任务。
- `Notify task summary on startup`：插件启动时通知激活、超期和临期任务数量。
- `Enable task timer`、`Auto start timer when status becomes Doing`、`Task timer mode`：启用计时器、自动开始计时，并选择直接计时或番茄钟。

## 安装与发布

- 仓库主页：[https://github.com/litcu/orca-plugin-task-planner](https://github.com/litcu/orca-plugin-task-planner)
- 下载发布包：[Releases](https://github.com/litcu/orca-plugin-task-planner/releases)
- 反馈问题：[Issues](https://github.com/litcu/orca-plugin-task-planner/issues)

发布包通常包含 `dist/index.js`、`package.json`、`LICENSE`、`README.md` 和图标文件。安装时请以最新 Release 中的压缩包为准。

## 本地开发

本仓库使用 npm 和现有 `package-lock.json`。

```bash
npm install
npm run dev
npm run build
```

常用校验与发布演练：

```bash
npm run check:marketplace
npm run release:dry-run
```

当前仓库没有单独的 `test` 或 `lint` 脚本，基础验证以 `npm run build` 为准。涉及 marketplace 元数据或发布包结构时，请同时运行 `npm run check:marketplace`；涉及发布脚本时，优先运行 `npm run release:dry-run`。

## 文档入口

开发前建议先阅读 [架构与数据流文档索引](./doc/文档索引.md)。文档按运行时注册、数据模型、任务生命周期、查询与视图、依赖评分、My Day、计时器、回顾重复任务和自定义视图拆分。

## 许可证

本项目基于 [Apache-2.0](./LICENSE) 许可证发布。
