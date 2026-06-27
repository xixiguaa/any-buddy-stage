# anybuddy

anybuddy 是一个基于 Electron + React + TypeScript 的本地 AI Agent 工作台原型。当前版本已经打通了任务、工作区、SQLite 持久化、运行时事件流，以及一条可回退的 LangChain Agent 执行链路，适合继续围绕 Agent Runtime 逐步完善。

## 当前状态

- 已接入 SQLite 持久化，任务、工作区、消息、运行记录、运行事件、审批记录都会走本地数据库。
- 首次启动会自动写入一份默认数据：`1` 个默认工作区、`1` 个默认任务。
- 已接入官方 `openai` SDK，并抽出 `openai-model-service.ts` 统一处理模型配置和调用。
- 已新增 `langchain-agent-service.ts`，封装了 `createAgent`、`tool`、`agent.invoke`、`agent.stream`。
- `agent-runtime-service.ts` 已优先走 LangChain Agent 执行；若模型不可用或执行失败，会回退到旧的规划循环。
- 工具审批链路已接入运行时：高风险工具可触发审批中断，审批通过后可恢复执行。
- 前端已经能基于运行时事件显示流式助手输出，但目前还是“事件快照拼装消息”，不是 token 级 UI。

## 数据来源说明

- 前端现在看到的任务、工作区、消息、运行状态，主要来自 SQLite。
- 默认初始内容不再只是前端写死，而是在数据库首次初始化时由 `src/main/state/default-state.ts` 写入。
- 仍有少量配置暂未进 SQLite：
  - 模型配置文件：`~/.anybuddy/models.json`
  - MCP 配置文件：`~/.anybuddy/mcp.json`
- `TaskComposer` 里仍保留了内置模型列表和默认 `modelId`，这一块后续需要改成统一配置来源。

## 关键文档

- 当前交接与续开发说明：[`docs/current-status-handoff.md`](docs/current-status-handoff.md)
- Agent 开发清单：[`docs/agent-development-checklist.md`](docs/agent-development-checklist.md)
- Agent 架构方案：[`docs/agent-architecture-proposal.md`](docs/agent-architecture-proposal.md)
- 详细设计草案：[`docs/anybuddy-detailed-design.md`](docs/anybuddy-detailed-design.md)

## 开发命令

```bash
npm install
npm run dev
npm run lint
```

测试相关：

```bash
node ./node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test .tmp-tests/src/main/state/default-state.test.js .tmp-tests/src/main/services/agent-runtime-service.test.js .tmp-tests/src/main/services/langchain-agent-service.test.js .tmp-tests/src/main/services/openai-model-service.test.js .tmp-tests/src/main/services/tool-registry-service.test.js .tmp-tests/src/renderer/stores/runtime-message-view.test.js
```

## 目录概览

```text
src/
  main/
    ipc/
    repositories/
    runtime/
    services/
    state/
  preload/
  renderer/
    components/
    layout/
    pages/
    stores/
  shared/
docs/
```

## 下一阶段重点

下一阶段的重点已经整理到 [`docs/current-status-handoff.md`](docs/current-status-handoff.md)，建议优先继续：

1. 让 runtime 完全以 LangChain Agent 为主路径，进一步收敛旧规划循环。
2. 把模型配置和 MCP 配置统一到可管理的数据源，减少文件配置和前端写死数据。
3. 补齐子 Agent、工具 schema、运行中任务视图和更多自动化测试。
