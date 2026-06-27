# Agent 架构方案

## 目标
这个仓库应当把“一个任务”视为“一段持续对话的 Agent 运行”。由一个主 Agent 负责整体对话，必要时再召唤专家 Subagent 协作。前端只负责建任务、展示消息流和处理审批，真正的编排逻辑放在 Electron 主进程。

## 推荐模型
- 一个任务对应一个主 Agent。
- 每个专家实现为可复用的 Subagent。
- 用户始终只和主 Agent 对话。
- 由主 Agent 决定何时调用专家，并把结果汇总回任务线程。

这和当前 `src/shared/types.ts` 的数据结构是匹配的：
- `Task` 表示任务配置。
- `AgentRun` 记录每次运行。
- `AgentEvent` 记录流式状态、工具调用和子 Agent 事件。
- `HumanApproval` 记录中断和审批。

## LangChain 选型
第一版优先使用新版 LangChain 的 `createAgent`。模型侧只接 OpenAI 标准模型，不做多模型切换。专家能力按需封装成 Subagent 或工具，取决于它们需要多少自治能力。

优先使用这些 API：
- `createAgent`
- `tool`
- `agent.invoke`
- `agent.stream`
- Subagent 或 Handoff 中间件
- Human-in-the-loop 中间件

只有在工作流需要明确状态迁移、分支、重试或持久化检查点时，再引入 LangGraph。

## 实现方式
- 把 Agent 执行逻辑从 renderer 移到 `src/main/services/`。
- 新增 `agent-runtime-service.ts`，专门负责 LangChain / LangGraph 执行。
- 把运行结果映射回 `AgentRun`、`AgentEvent`、`Message`、`HumanApproval`。
- renderer 只保留表单、聊天展示、运行控制和审批 UI。

## 建议流程
1. 用户在 `NewTaskPage` 创建任务。
2. 主进程启动主 Agent 运行。
3. 主 Agent 按需调用专家 Subagent，完成调研、写作、审校或文件操作。
4. 把中间输出实时写入任务时间线。
5. 当触发敏感工具调用时暂停，等待审批。
6. 审批通过后继续执行，最终结束任务。

## 实际建议
这个产品优先用 Subagent，不优先用 Router。任务应该像“一段对话”，而不是“请求分类器”。Router 只适合主 Agent 内部做专家分发，不适合作为用户侧的主交互模型。

## 第一批内置工具
- `read_workspace_file`：读取主工作区文件。
- `write_workspace_file`：写入文件，默认走审批。
- `edit_workspace_file`：按 patch 修改文件。
- `search_workspace`：在项目内搜索文本或路径。
- `list_workspace_files`：列目录和文件。
- `post_message`：把中间结果写回任务对话流。
- `request_approval`：发起敏感操作审批。
- `consult_subagent`：召唤专家协作。
- `web_search`：联网搜索，只做受控查询，不做任意网页自动化。
- `run_shell_command`：只允许白名单命令。
- `get_task_context`：读取任务模式、权限、技能、连接器和历史消息。
- `get_run_state`：读取当前运行节点、审批状态和最近事件。

`web_search` 不需要单独做成插件，直接作为 Agent 工具接入即可。

## 开发期建议工具边界
- `web_search` 只用于查公开资料、文档和方案，不做通用浏览器自动化。
- `run_shell_command` 只开放白名单命令，例如 `npm run lint`、`npm run dev`、`git status`。
- `get_task_context` 和 `get_run_state` 只读，不直接改状态。

## 第一期开工清单

### `src/main/`
- 新增 `services/agent-runtime-service.ts`，作为唯一的 Agent 执行入口。
- 新增 `services/agent-runtime-types.ts`，定义运行上下文、专家定义、工具返回值、审批事件类型。
- 新增 `services/openai-model-service.ts`，统一封装 OpenAI 标准模型的创建、参数校验与调用。
- 在 `services/app-service.ts` 中保留任务 CRUD、状态持久化、事件落库，只把 `start/pause/resume/cancel/approve` 转发给 runtime。
- 在 `ipc/register-ipc-handlers.ts` 中补齐 Agent 运行相关 IPC，保持 renderer 不直接接触模型实例。
- 在 `runtime/event-bus.ts` 中增加对 `agent_stream`, `subagent_started`, `tool_called`, `approval_requested` 这类事件的广播。

### `src/preload/`
- 在 `bridge.ts` 中只暴露安全的最小 API。
- 把 Agent 运行控制封装成 `window.anybuddy.agentRun.*`。
- 不暴露 LangChain 对象、工具函数、文件系统句柄或模型配置明文。

### `src/renderer/`
- `pages/NewTaskPage.tsx` 继续只负责创建任务入口，不承载执行逻辑。
- `pages/TaskDetailPage.tsx` 负责展示消息流、运行状态、审批卡片和专家介入记录。
- `components/TaskComposer.tsx` 只负责收集用户输入、模式、模型、技能、连接器与权限。
- `stores/app-store.ts` 增加任务运行态同步逻辑，接收主进程推送的运行事件。
- `api/clients.ts` 继续作为 IPC 客户端封装，补全 Agent 运行相关调用。

### `src/shared/`
- 在 `types.ts` 中补充 LangChain 运行所需的结构化类型。
- 明确区分 `Task` 配置、`AgentRun` 实例、`AgentEvent` 流事件、`HumanApproval` 审批记录。
- 在 `ipc.ts` 中补齐 Agent 运行相关请求/响应类型。

### `docs/`
- 保留本文件作为总方案。
- 后续补一份“Agent Runtime 事件协议”文档，专门定义事件名、payload 和状态流转。
- 再补一份“专家 Subagent 设计”文档，定义可复用专家卡片、技能包和调用方式。

## 一期交付标准
- 用户可以创建一个任务，并看到主 Agent 进入运行状态。
- 主 Agent 可以输出消息流，并写入任务时间线。
- 至少支持一个专家 Subagent 被主 Agent 召唤。
- 遇到敏感动作时，可以生成审批记录并暂停任务。
- 审批通过、拒绝、编辑三条路径都能回写到运行状态。
- renderer 页面不直接持有模型调用逻辑，只通过 IPC 驱动运行。

## 一期暂不做
- 不接完整 Router 体系。
- 不做复杂工作流编排 UI。
- 不做插件市场。
- 不做云端同步和多人协作。
- 不做完整权限中心和组织级 RBAC。
- 不做多模型切换或模型市场。
