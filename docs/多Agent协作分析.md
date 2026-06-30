# 多Agent协作架构分析

## 1. 目标与整体思路

本项目的多 Agent 协作，不是把多个模型实例简单并列运行，而是围绕一个 `Task` 构建一套可追踪、可恢复、可插入人工审批、可派生子线程的运行时系统。

核心设计思路有四点：

1. `Task` 是业务单元，承载标题、模式、模型、工作区、技能、连接器等配置。
2. `AgentRun` 是执行单元，一个任务可以有多个运行实例，其中包含主运行和子 Agent 运行。
3. `AgentEvent` 是事件流单元，所有运行时变化都尽量写成结构化事件，前端靠订阅事件流实现实时刷新。
4. `HumanApproval` 是人工恢复点，当工具调用触发敏感操作时，系统会暂停运行，等待用户批准、拒绝或编辑参数后继续。

从结果上看，这套实现更接近“带事件总线和审批能力的任务运行框架”，而不只是一个简单聊天机器人。

## 2. 核心数据模型

多 Agent 协作的核心类型定义在 [src/shared/types.ts](/D:/anybuddy/src/shared/types.ts:23)。

### 2.1 Task

`Task` 是最顶层的任务对象，字段里和多 Agent 协作直接相关的有：

- `id`：任务唯一标识。
- `mode`：任务模式，当前有 `ask` / `plan` / `craft`。
- `modelId`：任务绑定的模型配置。
- `expertId`：可选，表示该任务可调用的专家或子 Agent 角色。
- `permissionMode`：权限模式，决定运行时工具的风险边界。
- `connectorIds`、`skillIds`：运行时上下文增强配置。
- `lastRunId`：最近一次主运行的 ID。
- `status`：任务状态，会被主运行状态驱动。

### 2.2 AgentRun

`AgentRun` 是整个多 Agent 协作最关键的执行实体，定义见 [src/shared/types.ts](/D:/anybuddy/src/shared/types.ts:72)。

关键字段：

- `taskId`：该运行属于哪个任务。
- `workspaceIds`：运行挂载了哪些工作区。
- `parentRunId`：如果该运行是子 Agent，则它指向父运行。
- `agentId`：运行级实例 ID。
- `agentName`：展示给前端看的名字。
- `kind`：`main` 或 `subagent`。
- `status`：`queued` / `running` / `paused` / `waiting_approval` / `completed` / `failed` / `cancelled` / `archived`。
- `graphThreadId`：为运行保留的线程标识。
- `checkpointId`：可扩展的恢复点标识。
- `currentNode`：当前运行节点，例如 `plan`、`approval_pending`、`finished`。

这个建模方式有两个很重要的后果：

1. 一个任务可以有多次主运行，也可以有多个并行或串行子运行。
2. 子 Agent 并不是独立任务，而是任务内部的子线程，仍然共享同一任务上下文和事件流。

### 2.3 AgentEvent

`AgentEvent` 定义见 [src/shared/types.ts](/D:/anybuddy/src/shared/types.ts:105)。

系统把很多运行状态变化都写成结构化事件，包括：

- `run_started`
- `run_status`
- `agent_message`
- `subagent_started`
- `subagent_completed`
- `tool_called`
- `tool_result`
- `interrupt_requested`
- `interrupt_resolved`
- `approval_requested`
- `run_completed`
- `run_failed`

这意味着前端不需要理解每个服务内部的过程，只需要消费任务级事件流即可重建整个协作过程。

### 2.4 HumanApproval

`HumanApproval` 定义见 [src/shared/types.ts](/D:/anybuddy/src/shared/types.ts:90)。

关键字段：

- `taskId`、`runId`：审批属于哪个任务和哪个运行。
- `reason`：为什么要停下来。
- `originalArgs`：原始工具参数。
- `editedArgs`：用户修改后的参数。
- `decision`：`pending` / `approved` / `rejected` / `edited` / `cancelled`。

这个对象本质上是“人工介入恢复点”，它把模型计划和真实副作用执行拆成了两阶段。

## 3. 主进程中的运行时架构

### 3.1 入口：IPC 层

前端和运行时之间的桥接入口在 [src/main/ipc/register-ipc-handlers.ts](/D:/anybuddy/src/main/ipc/register-ipc-handlers.ts:16)。

这里创建了一个 `AgentRuntimeService`：

- `const agentRuntime = new AgentRuntimeService(appService)`

然后把运行控制暴露成 IPC：

- `agentRunsStart`
- `agentRunsPause`
- `agentRunsResume`
- `agentRunsCancel`
- `agentRunsApprove`
- `agentRunsSendSubagentMessage`
- `agentRunsStopSubagent`

因此，多 Agent 协作在外部的控制面非常清晰：前端只管发 IPC，请求启动、暂停、恢复、审批、对子 Agent 追加消息或停止子 Agent。

### 3.2 状态中心：AppService

`AppService` 是状态管理中心，核心逻辑在 [src/main/services/app-service.ts](/D:/anybuddy/src/main/services/app-service.ts:578)。

它负责：

- 创建和维护 `AgentRun`
- 追加和查询 `AgentEvent`
- 追加和查询 `Message`
- 创建和维护 `HumanApproval`
- 对任务详情页输出完整上下文 `getTaskContext()`

最关键的方法包括：

- `createRuntimeRun()`：创建运行记录并发出 `run_started`。
- `appendRuntimeEvent()`：写事件流。
- `appendRuntimeMessage()`：写消息流。
- `completeRuntimeRun()`：写最终 assistant 消息并把主任务标记完成。
- `upsertAgentMessageEvent()`：更新流式消息事件。
- `requestRuntimeApproval()`：创建人工审批点并切到 `waiting_approval`。
- `approveRuntimeRequest()`：处理审批决策。
- `appendSubagentMessage()`：向子 Agent 线程注入用户消息。
- `stopSubagentRun()`：取消一个子 Agent 线程。

可以把 `AppService` 理解为“协作运行的事实存储层”。`AgentRuntimeService` 做调度，`AppService` 持久化调度结果。

### 3.3 调度器：AgentRuntimeService

实际执行逻辑主要在 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:29)。

它的职责是：

- 启动运行。
- 尝试走 LangChain 流式执行。
- 回退到旧的规划循环。
- 记录工具调用和工具结果。
- 申请人工审批。
- 生成和驱动子 Agent。
- 恢复被中断的运行。

## 4. 主运行的执行链路

### 4.1 从用户发送消息到启动主运行

前端在 [src/renderer/stores/app-store.ts](/D:/anybuddy/src/renderer/stores/app-store.ts:262) 的 `sendMessage()` 里，先创建一条用户消息，再启动主运行：

1. `clients.message.create(taskId, { content, role: 'user' })`
2. `clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })`

主进程收到 `agentRunsStart` IPC 后，会调用 `AgentRuntimeService.start()`，定义在 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:47)。

`start()` 做了三件事：

1. 校验任务是否存在。
2. 调用 `appService.createRuntimeRun()` 创建运行记录。
3. 异步调用 `executeRuntime()` 推进运行。

这里有个重要设计：`start()` 立即返回 `run`，真正执行在后台异步进行。前端靠事件流观察后续状态，而不是同步等待模型返回。

### 4.2 运行前的上下文准备

`executeRuntime()` 会先：

1. 把运行状态切成 `running`。
2. 构造系统提示词 `buildTaskContextPrompt()`。
3. 默认把这段系统提示词写成一条 `system` 消息，进入任务消息流。

这一步使得主运行不是孤立的模型调用，而是一个带运行环境的对话线程。

### 4.3 优先走 LangChain，失败则回退旧规划器

`executeRuntime()` 中的分支很清晰：

- 先调用 `tryExecuteWithLangChain()`
- 若返回 `false`，则走 `executeLegacyPlannerLoop()`

这说明当前项目是双轨架构：

1. 新链路：LangChain agent，支持流式输出。
2. 旧链路：多轮工具规划器，作为回退路径。

这是比较稳健的工程实现，因为模型、协议或 LangChain 层出问题时，不会把整个运行系统拖死。

## 5. 工具调用如何成为多 Agent 协作的基础

### 5.1 工具被统一包进运行时上下文

`buildLangChainTools()` 会把工具注册表中的工具封装成运行时工具，定义在 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:445)。

每次工具执行，都会先进入 `handleToolCall()`。

### 5.2 工具调用的标准记录方式

`handleToolCall()` 的流程是：

1. 追加 `tool_called` 事件。
2. 真正执行工具。
3. 追加 `tool_result` 事件。
4. 追加一条 `role = 'tool'` 的消息。

这四步意味着工具调用会同时存在于：

- 事件流：适合实时 UI、状态面板、时间线。
- 消息流：适合在主聊天区按时间顺序展示。

这也是后面把工具调用插进主聊天框的基础。

## 6. 子 Agent 协作机制

### 6.1 何时允许派生子 Agent

`buildFallbackToolPlan()` 中有一个关键判断，见 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:414)：

- 只有当 `task.expertId` 存在，且当前运行是 `main` 时，才会注入 `consult_subagent` 工具调用候选。

这反映了当前系统的约束：

1. 子 Agent 是一种受控能力，不是默认总开。
2. 只有主运行能派生子运行。
3. 子 Agent 不允许继续递归派生子 Agent。

### 6.2 spawnSubagent 的具体流程

核心逻辑在 `spawnSubagent()`，见 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:524)。

流程如下：

1. 如果当前运行本身就是 `subagent`，直接返回，不再嵌套派生。
2. 调用 `appService.createRuntimeRun()` 创建一个 `kind = 'subagent'` 的运行。
3. 该子运行的 `parentRunId` 指向当前父运行。
4. 给父运行追加 `subagent_started` 事件。
5. 给子运行写一条 `system` 消息，内容是一个简报：
   - `expertId`
   - `reason`
   - `parentTask`
6. 调用 `executeRuntime()` 真正启动这个子运行。
7. 子运行结束后，从该子运行的 assistant 消息中提取最后总结。
8. 给父运行追加 `subagent_completed` 事件，并返回总结。

这里有两个值得注意的设计：

1. 子 Agent 仍然运行在同一个任务下，不新建 task。
2. 父运行拿到的是子运行的“总结结果”，因此子 Agent 更像一个内部专家线程，而不是独立工作流。

### 6.3 子 Agent 消息追加与线程继续

如果用户或父运行希望继续某个子线程，逻辑走 `sendSubagentMessageInternal()`，见 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:605)。

它会：

1. 校验目标 run 是否属于当前任务，且 `kind === 'subagent'`。
2. 调用 `appService.appendSubagentMessage()` 写入一条用户消息，并标记 `source: 'subagent_message'`。
3. 重新构造一个 `subagentContext`。
4. 再次异步执行 `executeRuntime(subagentContext)`。

这说明子 Agent 线程是可继续的。它不是一次性调用，而是持久线程。

### 6.4 停止子 Agent

`stopSubagent()` 会：

1. 校验 run 是否是当前任务下的子运行。
2. 调用 `appService.stopSubagentRun()` 把状态标记为 `cancelled`。
3. 给父运行追加一个 `subagent_completed` 事件，状态写成 `cancelled`。

这里的事件命名虽然统一，但语义上包含了“正常完成”和“取消结束”两种情况。前端需要看 `status` 才能区分。

## 7. 人工审批与恢复机制

### 7.1 为什么需要审批

多 Agent 协作真正落地时，最危险的不是模型输出文本，而是工具副作用，例如：

- 写文件
- 执行命令
- 修改配置
- 删除资源

所以运行时把“计划”和“执行”拆开：当工具需要人工确认时，不直接执行，而是先创建审批点。

### 7.2 requestApproval 的流程

`requestApproval()` 在 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:505)。

它调用 `appService.requestRuntimeApproval()`，后者会：

1. 把运行状态切为 `waiting_approval`。
2. 把任务状态也切为 `waiting_approval`。
3. 创建 `HumanApproval` 记录。
4. 追加 `approval_requested` 事件。
5. 追加 `interrupt_requested` 事件。

从这里可以看到，审批点既是状态变化，也是事件流中的显式节点。

### 7.3 批准后如何恢复

批准逻辑入口是 `approve()`，见 [src/main/services/agent-runtime-service.ts](/D:/anybuddy/src/main/services/agent-runtime-service.ts:82)。

恢复过程不是“从头重新跑一遍”，而是：

1. 先通过 `appService.approveRuntimeRequest()` 更新审批状态。
2. 如果是拒绝，则直接结束。
3. 如果是批准或编辑参数，则调用 `toolRegistry.executeApprovedAction()` 真正执行被中断的动作。
4. 追加 `tool_result` 事件。
5. 追加一条 `role = 'tool'` 的消息，说明这是 `resumed_action`。
6. 如果配置允许，则继续调用 `executeRuntime()`，并且 `appendSystemPrompt: false`，避免重复注入系统提示词。

这是一个很合理的实现，因为它保留了执行现场，并且避免了重新规划导致的上下文偏移。

## 8. 前后端如何协作显示多 Agent 状态

### 8.1 主进程如何推送任务级运行状态

在 [src/main/index.ts](/D:/anybuddy/src/main/index.ts:34) 中，项目重写了 `bus.emitTaskRuntime`：

- 每次任务运行状态变化时，调用 `mainWindow.webContents.send('agent-run:task-changed:${taskId}', payload)`

因此前端接收到的是任务级聚合 payload，而不是单一事件。

payload 结构包含：

- `runs`
- `events`
- `approvals`

### 8.2 前端订阅接口

共享接口定义在 [src/shared/ipc.ts](/D:/anybuddy/src/shared/ipc.ts:133)。

`agentRun` 能力包括：

- 查询活动运行
- 查询任务下所有运行
- 查询任务事件
- 查询审批列表
- 启动 / 暂停 / 恢复 / 取消运行
- 审批
- 给子 Agent 发送消息
- 停止子 Agent
- 订阅活动运行
- 订阅某个任务的运行态变更

渲染层封装在 [src/renderer/api/clients.ts](/D:/anybuddy/src/renderer/api/clients.ts:150)。

### 8.3 Zustand 如何消费运行时推送

关键逻辑在 [src/renderer/stores/app-store.ts](/D:/anybuddy/src/renderer/stores/app-store.ts:143)。

`selectTask(taskId)` 会：

1. 初次并行拉取：
   - task
   - workspaces
   - messages
   - draft
   - runs
   - events
   - approvals
2. 调用 `clients.agentRun.subscribeTask(taskId, payload => { ... })` 订阅后续增量变化。
3. 每次收到 payload，更新：
   - `agentRuns`
   - `taskEvents`
   - `taskApprovals`
   - `messages`

这里的 `messages` 不是单纯的数据库消息，而是通过 `buildVisibleMessages()` 把：

- 持久化消息
- 流式 assistant 消息
- tool/system synthetic message

重新组合成最终可展示消息流。

这就是为什么主聊天区可以看到：

- 用户消息
- assistant 输出
- 工具调用 / 工具结果
- 审批提示
- 子 Agent 相关系统消息

而且这些内容能按时间线交织。

## 9. 任务详情页如何呈现多 Agent 协作

`TaskDetailPage` 是多 Agent 协作在 UI 上的核心落点，见 [src/renderer/pages/TaskDetailPage.tsx](/D:/anybuddy/src/renderer/pages/TaskDetailPage.tsx:33)。

页面展示了四类信息：

1. 主聊天消息流
2. 中断恢复面板
3. Agent Runs 列表
4. Subagent Threads 线程视图
5. 运行时间线

### 9.1 主聊天区

主聊天区现在通过 `messages` 统一渲染：

- 用户消息用普通气泡
- assistant 消息用普通回复气泡
- system 消息居中展示
- tool 消息用折叠组件展示

工具调用已经不再只出现在右侧面板，而是被插进主聊天时间线中，更接近 VS Code 类 Agent 的使用习惯。

### 9.2 Agent Runs 列表

右侧 `Agent Runs` 列表会显示当前任务下所有运行，包括：

- `main`
- `subagent`

对于子 Agent，点击后可以切换到该线程视图。

### 9.3 Subagent Threads

`activeSubagentMessages` 会筛选某个子运行关联的消息：

- `message.runId === run.id`
- 或 `message.metadata?.subagentRunId === run.id`

因此每个子 Agent 都有自己相对独立的消息线程视图，同时仍属于同一任务。

## 10. 当前设计的优点

### 10.1 事件流和消息流分离

项目没有只依赖消息列表，而是同时维护：

- `messages`：更像对话与结果沉淀
- `events`：更像运行过程日志

这使得 UI 可以自由决定展示方式。

### 10.2 主 Agent 与子 Agent 关系清晰

通过 `parentRunId` 和 `kind`，系统可以明确表达：

- 谁是主运行
- 谁是子运行
- 谁派生了谁

### 10.3 审批恢复是原生能力

很多 Agent 系统把人工审批做成 UI 层补丁，本项目是从运行时上下文开始内置审批和恢复接口，这个设计更扎实。

### 10.4 回退路径完整

LangChain 路径不可用时，可以退回旧规划循环，不至于整个运行框架失效。

## 11. 当前实现的限制与改进建议

### 11.1 子 Agent 不能再派生子 Agent

现在 `spawnSubagent()` 明确禁止递归派生。优点是避免失控，缺点是复杂任务无法形成树形协作。

如果未来要扩展，可以考虑：

- 限制最大深度，例如 2 层或 3 层。
- 限制同任务最大并发子运行数。
- 对每层运行增加预算和超时。

### 11.2 子 Agent 仍共享同一任务上下文

当前子 Agent 是任务内子线程，不是独立任务。这简化了实现，但也带来问题：

- 事件流会越来越大。
- 复杂协作下，主任务页可能会承载过多杂讯。

未来可以考虑：

- 给子 Agent 引入独立的上下文视图缓存。
- 或把大型子线程拆分成二级任务。

### 11.3 事件语义仍有收敛空间

比如 `subagent_completed` 既可能表示：

- 正常完成
- 失败结束
- 被父运行取消

虽然 `payload.status` 能区分，但从事件名本身看不够精确。后续可以细分为：

- `subagent_succeeded`
- `subagent_failed`
- `subagent_cancelled`

### 11.4 前端消息重建成本会随事件增长而增加

当前 `buildVisibleMessages()` 会基于 `baseMessages + events` 重建消息流。对于长任务，这会越来越重。

后续可以考虑：

- 增量构建消息索引。
- 对历史事件分页。
- 对已完成运行冻结消息片段，减少重复合成。

## 12. 一条完整的多 Agent 协作时序示例

下面用一个典型场景说明全链路：

1. 用户在任务详情页发送一条消息。
2. 前端先写入用户消息，再通过 IPC 启动一个 `main` 运行。
3. `AgentRuntimeService.start()` 创建 `AgentRun`，写入 `run_started` 事件。
4. `executeRuntime()` 开始执行，写入 system prompt。
5. 主 Agent 规划到需要专家辅助，于是调用 `consult_subagent`。
6. `spawnSubagent()` 创建一个 `kind = 'subagent'` 的子运行，写入 `subagent_started`。
7. 子 Agent 获得一段简报消息并开始自己的运行。
8. 子 Agent 在其线程中执行工具、产生事件、输出 assistant 结论。
9. 子 Agent 结束后，父运行收到 `subagent_completed` 和总结文本。
10. 如果主运行中有敏感工具动作，需要写文件，则触发 `requestApproval()`。
11. 运行切到 `waiting_approval`，任务详情页出现恢复点。
12. 用户批准或编辑参数后，`approve()` 恢复被中断动作，并继续主运行。
13. 主运行完成后，`completeRuntimeRun()` 写入最终 assistant 消息，并把主任务置为 `completed`。
14. 整个过程中，主进程不断通过 `agent-run:task-changed:${taskId}` 推送 `runs/events/approvals`，前端持续重建并展示协作过程。

## 13. 总结

本项目的多 Agent 协作实现，核心不是“多个模型一起说话”，而是：

- 以 `Task` 为边界
- 以 `AgentRun` 为执行线程
- 以 `AgentEvent` 为运行时事实流
- 以 `HumanApproval` 为人工恢复点
- 以前端订阅为实时可视化出口

从工程角度看，这种设计有三个明显优点：

1. 运行过程可观测。
2. 子 Agent 协作有明确边界。
3. 敏感动作可人工接管并恢复。

如果后续继续演进，最值得投入的方向是：

- 子 Agent 树形协作能力
- 事件流分页与增量索引
- 更细粒度的运行语义
- 子线程上下文隔离与预算控制

目前这套实现已经具备一个桌面多 Agent 编程助手的基础骨架，而且主进程、前端、审批和子线程机制之间的边界比较清楚，后续扩展成本相对可控。
