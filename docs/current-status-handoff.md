# 当前状态与下次续开发说明

这份文档用于下次继续开发时快速恢复上下文，也适合直接提供给新的 LLM 作为交接说明。

## 1. 当前已完成

### 1.1 模型层

- 已新增 `src/main/services/openai-model-service.ts`。
- 已改为使用官方 `openai` SDK，而不是手写 HTTP 调用。
- 该服务负责：
  - 解析模型配置
  - 校验 `apiKey` / `baseUrl`
  - 构建工具规划请求
- 已有对应测试：`src/main/services/openai-model-service.test.ts`

### 1.2 LangChain Agent 封装

- 已新增 `src/main/services/langchain-agent-service.ts`。
- 当前已经封装并可用的能力：
  - `createAgent`
  - `tool`
  - `agent.invoke`
  - `agent.stream`
- 当前对上层暴露的是轻量接口 `RuntimeAgent`，避免主流程直接依赖 LangChain 返回类型。
- 工具若触发审批，会抛出 `AgentApprovalPendingError`，让 runtime 中断当前轮次并等待审批恢复。
- 已有对应测试：`src/main/services/langchain-agent-service.test.ts`

### 1.3 Runtime 主执行链路

- 已新增 `src/main/services/agent-runtime-service.ts`
- 当前逻辑是：
  1. 先构建任务上下文 prompt
  2. 优先尝试走 LangChain Agent
  3. 如果模型不可用或 LangChain 失败，则回退到旧的“模型规划 + 工具执行”循环
- 审批恢复链路已经接入：
  - 工具触发审批后，run 进入 `waiting_approval`
  - 审批通过后，会先执行被阻塞的动作
  - 默认继续推进 runtime
- 当前保留旧规划循环，目的是：
  - 可回退
  - 便于验证新链路是否稳定
  - 避免一次性大改导致 runtime 全挂
- 已有对应测试：`src/main/services/agent-runtime-service.test.ts`

### 1.4 Tool Registry 与运行时工具

- 已有 `src/main/services/tool-registry-service.ts`
- 已覆盖的工具包括运行时需要的基本能力，例如：
  - 任务上下文读取
  - 运行状态读取
  - 工作区文件浏览 / 读取 / 编辑
  - shell 命令
  - web search
  - 子 agent 占位能力
- 当前仍有一些工具 schema 比较宽松，后续还要收紧

### 1.5 SQLite 持久化

- 当前主数据已经走 SQLite：
  - tasks
  - workspaces
  - messages
  - drafts
  - agentRuns
  - agentEvents
  - approvals
  - settings
- 首次启动时会通过 `src/main/state/default-state.ts` 初始化默认数据。
- 目前默认种子数据为：
  - `1` 个默认工作区：`默认工作区`
  - `1` 个默认任务：`开始使用 AnyBuddy`

### 1.6 前端运行态显示

- 已新增 `src/renderer/stores/runtime-message-view.ts`
- 当前前端会把 `agent_message` 事件拼成一条临时可见消息，让用户看到“流式输出中的最新快照”。
- `src/renderer/stores/app-store.ts` 已接入这层消息拼装逻辑。
- `src/renderer/pages/TaskDetailPage.tsx` 已能识别“正在输出”的助手消息样式。
- 当前不是 token 级逐字 UI，而是“最新事件快照覆盖式展示”。

## 2. 当前仍未完成

### 2.1 Runtime 仍是“双轨制”

- LangChain Agent 已接入，但旧规划循环还在。
- 这意味着现在不是完全切换，而是“LangChain 主路径 + 旧链路兜底”。
- 下一阶段要决定：
  - 继续保留兜底多久
  - 什么时候把旧链路缩减为纯 fallback
  - 最终是否彻底移除

### 2.2 子 Agent 还只是占位实现

- `spawnSubagent` 当前只打通了运行链路和事件记录。
- 真实的专家型 Subagent 还没接入独立模型执行逻辑。
- 也还没有真正的专家分工、子任务上下文隔离、结果汇总策略。

### 2.3 模型与 MCP 配置还未统一进 SQLite

- 现在这两块仍是文件配置：
  - `~/.anybuddy/models.json`
  - `~/.anybuddy/mcp.json`
- 也就是说：
  - 业务主状态在 SQLite
  - 模型/MCP 配置仍在文件
- 这是当前架构里一个比较明显的“半收敛状态”。

### 2.4 前端还有写死数据残留

- `TaskComposer` 仍保留内置模型列表。
- 默认 `modelId = local-preview` 仍有硬编码痕迹。
- 这部分应该改成统一读取配置服务或数据库映射。

### 2.5 文案 / 注释乱码仍未彻底清理

- 目前仓库里还存在一部分历史乱码文本。
- README 和部分 docs 会在这次更新后恢复正常。
- 但代码里仍可能有旧乱码字符串、旧注释和旧占位文案，需要后续继续清理。

### 2.6 测试覆盖还不够完整

- 已有主服务层测试，但还缺：
  - 更多 IPC 层测试
  - renderer 组件级测试
  - 任务审批流的更完整集成测试
  - 多任务并发与冲突场景测试

## 3. 现在最建议继续做的顺序

### P0：继续把 Agent Runtime 做稳

1. 继续完善 `agent-runtime-service.ts`
2. 把 LangChain Agent 路径补成更完整的主路径
3. 明确旧规划循环的保留边界
4. 补更多“审批中断 -> 恢复执行”测试
5. 明确 run / task / event 三者的状态流转规范

### P1：把配置源统一

1. 评估是否把模型配置写入 SQLite
2. 评估是否把 MCP 配置也统一纳入应用配置层
3. 去掉前端内置模型列表
4. 让新建任务页、设置页、runtime 全部共享同一份模型配置来源

### P1：把子 Agent 从占位实现变成真实能力

1. 为 `consult_subagent` / `spawnSubagent` 设计真实执行逻辑
2. 定义主 Agent 与子 Agent 的上下文边界
3. 定义子 Agent 的结果回写协议
4. 让前端能展示子 Agent 开始、执行中、完成、失败等事件

### P1：补足运行中体验

1. 补“运行中任务”全局视图
2. 补更清晰的工具调用卡片
3. 补审批卡片的参数展示 / 编辑体验
4. 改善任务详情页对运行事件的可读性

### P2：继续补质量和测试

1. 收紧每个工具的 `zod schema`
2. 补 IPC 层测试
3. 补 renderer 测试
4. 补多任务并发场景测试
5. 补应用重启后的运行恢复测试

## 4. 下次回来建议先看这些文件

- `src/main/services/agent-runtime-service.ts`
- `src/main/services/langchain-agent-service.ts`
- `src/main/services/openai-model-service.ts`
- `src/main/services/tool-registry-service.ts`
- `src/main/services/app-service.ts`
- `src/main/state/default-state.ts`
- `src/renderer/stores/runtime-message-view.ts`
- `src/renderer/stores/app-store.ts`
- `src/renderer/pages/TaskDetailPage.tsx`

## 5. 当前关键判断

### 为什么 runtime 还自己写

因为这个项目不只是“调用 LangChain Agent”这么简单，还需要承接应用自己的业务语义：

- 任务状态
- 运行记录
- 事件流
- 审批中断
- SQLite 持久化
- 前端订阅更新
- 多工作区上下文

所以 LangChain 更适合作为“Agent 执行内核”，而 runtime 仍需要保留为应用层编排器。

### 为什么先保留 fallback

因为现在正处于切换期：

- 新链路已经能跑
- 但还没有覆盖所有边界
- 保留旧链路可以降低回归风险

这比一次性彻底替换更稳。

## 6. 已知风险

- App 层仍残留一部分旧模拟运行逻辑和旧文案，后续要继续清理。
- 模型配置、MCP 配置、任务创建模型选择还未完全收敛到统一配置源。
- 子 Agent 目前不是真正可用的专家执行器。
- 前端虽然能看见流式结果，但展示形态仍比较初级。

## 7. 建议交给下一个 LLM 的工作指令

如果下次需要让新的 LLM 接手，建议直接附上下面这段：

```text
请先阅读 docs/current-status-handoff.md、docs/agent-development-checklist.md、src/main/services/agent-runtime-service.ts、src/main/services/langchain-agent-service.ts。当前项目已经完成 SQLite 持久化、官方 OpenAI SDK 接入、LangChain Agent 封装，以及 runtime 到 LangChain 的主路径接入，但仍保留旧规划循环作为 fallback。请在“可回退、可测试”的前提下继续完善 agent runtime、审批恢复、子 agent、配置统一和前端运行态展示。
```

## 8. 验证命令

```bash
npm run lint
node ./node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test .tmp-tests/src/main/state/default-state.test.js .tmp-tests/src/main/services/agent-runtime-service.test.js .tmp-tests/src/main/services/langchain-agent-service.test.js .tmp-tests/src/main/services/openai-model-service.test.js .tmp-tests/src/main/services/tool-registry-service.test.js .tmp-tests/src/renderer/stores/runtime-message-view.test.js
```
