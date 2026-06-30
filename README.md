# AnyBuddy

一个本地优先的 AI Agent 工作台，用任务、工作区、专家预设和运行时事件，把复杂工作拆成可追踪、可恢复、可协作的 Agent 流程。

A local-first AI Agent workspace that turns complex work into traceable, resumable, and collaborative Agent workflows with tasks, workspace context, expert presets, and runtime events.

## 项目解决什么问题 / What Problem It Solves

很多 AI 编程或办公助手仍停留在一次性聊天界面：上下文难管理、任务状态难追踪、工具调用不透明、长任务中断后难恢复，也很难把不同专家能力组织进同一个工作流。

Many AI coding or productivity assistants still behave like one-off chat boxes: context is hard to manage, task status is difficult to track, tool calls are opaque, long-running work is hard to resume, and expert capabilities are difficult to compose into one workflow.

AnyBuddy 试图把 Agent 从“聊天窗口”推进到“本地工作台”：每个任务都有工作区、模型、技能、连接器、运行事件、审批状态和历史记录。你可以创建任务、继续任务、召唤专家、查看运行时事件，并逐步把 Agent 工作流沉淀为可维护的本地系统。

AnyBuddy moves Agents from a simple chat window into a local workspace. Each task can carry workspace context, model settings, skills, connectors, runtime events, approval state, and history. You can create tasks, continue tasks, summon experts, inspect runtime events, and gradually turn Agent workflows into a maintainable local system.

## 亮点 / Highlights

- 本地优先：核心任务、消息、工作区、运行记录和审批状态走本地 SQLite 持久化。
- Electron 桌面体验：主进程负责文件系统、运行时和持久化，渲染进程专注交互界面。
- 任务式 Agent 工作流：围绕任务创建、继续执行、运行状态和事件流组织体验。
- 专家预设：支持通过专家角色快速加载技能组合和任务上下文。
- 运行时事件可见：将工具调用、审批、子 Agent 状态和执行过程展示在界面中。
- 可扩展架构：通过 shared IPC 契约、preload 桥、主进程服务和 tool registry 保持边界清晰。

- Local-first persistence: tasks, messages, workspaces, runs, events, and approvals are stored locally with SQLite.
- Desktop-native Electron shell: the main process owns filesystem access, runtime orchestration, and persistence while the renderer focuses on UI.
- Task-based Agent workflow: the product is organized around task creation, continuation, runtime state, and event streams.
- Expert presets: expert roles can quickly load skill sets and task context.
- Visible runtime events: tool calls, approvals, sub-agent state, and execution progress are surfaced in the UI.
- Extensible architecture: shared IPC contracts, the preload bridge, main-process services, and the tool registry keep boundaries clear.

## 截图 / Screenshots

> 当前仓库还没有提交真实截图。建议在首个公开版本中补充 `docs/assets/anybuddy-preview.png` 或 `docs/assets/anybuddy-demo.gif`，让 README 在 GitHub 首页直接展示产品形态。

> No real screenshot is committed yet. For the first public release, add `docs/assets/anybuddy-preview.png` or `docs/assets/anybuddy-demo.gif` so the GitHub README shows the product clearly.

```md
![AnyBuddy preview](docs/assets/anybuddy-preview.png)
```

建议截图内容 / Recommended screenshot content:

- 新建任务界面，展示模型、模式、技能、工作区和专家选择入口。
- 任务详情界面，展示对话、运行时事件、审批或子 Agent 状态。
- 专家配置界面，展示专家预设和技能组合。

- New task screen showing model, mode, skills, workspace, and expert selection.
- Task detail screen showing conversation, runtime events, approvals, or sub-agent state.
- Expert configuration screen showing expert presets and skill sets.

## 快速上手 / Quick Start

### 环境要求 / Prerequisites

- 推荐使用 Node.js 20 或更新版本。
- 项目脚本使用 npm。
- 需要可运行 Electron 桌面应用的系统环境。

- Node.js 20 or newer is recommended.
- npm is used by the project scripts.
- A desktop environment capable of running Electron apps is required.

### 安装依赖 / Install Dependencies

```bash
npm install
```

### 启动开发应用 / Start Development App

```bash
npm run dev
```

该命令会通过 Electron Forge 和 Vite 启动 Electron 开发应用。`npm start` 等同于 `npm run dev`。

This starts the Electron development app through Electron Forge and Vite. `npm start` is equivalent to `npm run dev`.

### 类型检查 / Type Check

```bash
npm run lint
```

当前 `lint` 脚本会执行 `tsc --noEmit` 进行 TypeScript 检查。

The current `lint` script runs TypeScript checking with `tsc --noEmit`.

### 本地打包 / Package Locally

```bash
npm run package
```

### 构建安装包 / Build Installers

```bash
npm run make
```

## 文档 / Documentation

- [贡献指南 / Contribution Guide](docs/contributing.md): 介绍如何参与贡献、提交 Issue、发起 Pull Request 和验证改动。
- [技术架构 / Technical Architecture](docs/technical-architecture.md): 介绍项目结构、进程边界、数据流和架构图。
- [详细设计草案 / Detailed Design Draft](docs/anybuddy-detailed-design.md): 更完整的产品与实现设计说明。

## 目录结构 / Repository Layout

```text
src/
  main/       Electron 主进程、IPC 处理、仓储、运行时服务
  preload/    暴露给渲染进程的安全桥
  renderer/   React 界面、页面、组件、状态和样式
  shared/     共享类型、IPC 契约和跨进程工具
docs/         贡献文档、架构说明和设计草案
```

```text
src/
  main/       Electron main process, IPC handlers, repositories, runtime services
  preload/    Safe bridge exposed to the renderer process
  renderer/   React UI, pages, components, stores, and styles
  shared/     Shared types, IPC contracts, and cross-process helpers
docs/         Contributor docs, architecture notes, and design drafts
```

## GitHub About 配置建议 / Suggested GitHub About Settings

GitHub 右上角的 Description、Topics 和 About 需要在仓库页面手动配置，不能只靠 README 自动设置。建议填写：

GitHub Description, Topics, and About metadata must be configured manually on the repository page. Recommended values:

Description:

```text
Local-first AI Agent workspace for task-based workflows, expert presets, runtime events, and Electron desktop automation.
```

Topics:

```text
ai-agent, agent-workflow, electron, react, typescript, sqlite, langchain, desktop-app, local-first, task-management, ai-workspace, ipc
```

Website:

```text
https://github.com/<your-org-or-user>/anybuddy
```

## 参与贡献 / Contributing

欢迎大家参与贡献 AnyBuddy。无论是提交 bug、改进文档、优化界面体验、补充测试，还是参与 Agent Runtime 和工具体系建设，都可以从贡献指南开始。

Contributions are welcome. Whether you want to report bugs, improve documentation, polish the UI, add tests, or work on the Agent runtime and tool system, the contribution guide is the best place to start.

开始贡献前，请先阅读 [docs/contributing.md](docs/contributing.md)。它介绍了推荐的本地开发流程、代码规范、验证步骤和 Pull Request 要求。

Start with [docs/contributing.md](docs/contributing.md). It explains the recommended local workflow, coding conventions, verification steps, and pull request expectations.

如果准备进行较大的改动，请先阅读 [docs/technical-architecture.md](docs/technical-architecture.md)，确保主进程、preload、渲染进程和 shared 契约之间的边界保持清晰。

For larger changes, read [docs/technical-architecture.md](docs/technical-architecture.md) first so the main, preload, renderer, and shared boundaries stay clear.
