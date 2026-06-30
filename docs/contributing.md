# 贡献指南 / Contributing to AnyBuddy

感谢你对 AnyBuddy 感兴趣。本文档介绍如何在本地启动项目、如何提交可审查的改动，以及如何参与开源贡献。

Thanks for your interest in contributing to AnyBuddy. This guide explains how to run the project locally, make reviewable changes, and participate in the open source workflow.

## 开始之前 / Before You Start

请先阅读 [README](../README.md) 和 [技术架构文档](technical-architecture.md)。AnyBuddy 是一个 Electron 应用，很多改动会跨越主进程、preload 桥、渲染进程和共享类型契约。提前理解这些边界，可以避免把不同层的职责耦合在一起。

Read the [README](../README.md) and [Technical Architecture](technical-architecture.md) first. AnyBuddy is an Electron app, so many changes cross the main process, preload bridge, renderer process, and shared type contracts. Understanding these boundaries helps avoid accidental coupling between layers.

## 本地开发 / Local Development

安装依赖：

Install dependencies:

```bash
npm install
```

启动开发应用：

Start the development app:

```bash
npm run dev
```

提交改动前运行类型检查：

Run TypeScript checks before submitting changes:

```bash
npm run lint
```

## 推荐贡献流程 / Recommended Workflow

1. 创建或选择一个描述清晰的 Issue。
2. 保持改动聚焦在一个行为、缺陷或功能区域。
3. 优先提交小而清晰的 Pull Request，避免把无关重构混在一起。
4. 当行为、启动方式、架构或用户流程发生变化时，同步更新文档。
5. 发起 Pull Request 前运行 `npm run lint`。

1. Create or pick an issue that describes the problem clearly.
2. Keep the change focused on one behavior, bug, or feature area.
3. Prefer small, clear pull requests over large unrelated rewrites.
4. Update documentation when behavior, setup, architecture, or user-facing workflows change.
5. Run `npm run lint` before opening a pull request.

## 代码组织 / Code Organization

- Electron 主进程代码放在 `src/main/`。
- preload 桥代码放在 `src/preload/`。
- React 界面代码放在 `src/renderer/`。
- 共享类型和 IPC 契约放在 `src/shared/`。
- 不要直接编辑 `.vite/` 下的生成文件。

- Put Electron main-process code in `src/main/`.
- Put preload bridge code in `src/preload/`.
- Put React UI code in `src/renderer/`.
- Put shared types and IPC contracts in `src/shared/`.
- Do not edit generated output under `.vite/`.

## 代码风格 / Coding Style

- 使用 TypeScript 和 ES modules。
- 保持 2 空格缩进和分号，匹配现有代码风格。
- React 组件和组件文件使用 `PascalCase`。
- helper、函数和局部变量使用 `camelCase`。
- IPC payload 应在 shared 契约中保持显式类型。

- Use TypeScript and ES modules.
- Keep 2-space indentation and semicolons, matching the existing codebase.
- Use `PascalCase` for React components and component files.
- Use `camelCase` for helpers, functions, and local variables.
- Keep IPC payloads explicitly typed in shared contracts.

## Pull Request 要求 / Pull Requests

一个好的 Pull Request 应包含：

A good pull request includes:

- 简短说明改了什么，以及为什么改。
- 说明手动验证或自动检查结果。
- 如果包含可见 UI 改动，附上截图或录屏。
- 如果有关联 Issue 或讨论，请附上链接。

- A short summary of what changed and why.
- Notes about manual verification or automated checks.
- Screenshots or screen recordings for visible UI changes.
- Links to related issues or discussions when available.

## 报告问题 / Reporting Issues

报告 bug 时，请尽量包含：

When reporting a bug, include:

- 你期望发生什么。
- 实际发生了什么。
- 复现步骤。
- 操作系统和 Node.js 版本。
- 能帮助说明问题的日志或截图。

- What you expected to happen.
- What actually happened.
- Steps to reproduce the issue.
- Your operating system and Node.js version.
- Relevant logs or screenshots when they help explain the problem.

## 适合贡献的方向 / Areas That Need Help

- 任务运行时稳定性和执行行为。
- 任务创建、任务详情、专家预设和审批流程的 UI 打磨。
- 架构、扩展点和用户工作流文档。
- 主进程服务、IPC 契约和渲染进程状态的自动化测试。

- Runtime reliability and task execution behavior.
- UI polish for task creation, task details, expert presets, and approval flows.
- Documentation for architecture, extension points, and user workflows.
- Automated tests around main-process services, IPC contracts, and renderer state.
