# DeepAgents 迁移与单专家共享上下文改造实施文档

## 1. 背景与目标

当前 AnyBuddy 的任务运行时采用“主 Agent + 多个子 Agent 协作”模型：

- 任务层通过 `task.expertIds[]` 维护一个专家集合。
- 运行时主 Agent 会根据提示词和工具，通过 `consult_subagent` 派生多个子 Agent。
- 前端任务详情页展示主运行、子运行、审批与工具事件。

新的目标有两部分，并且建议合并实施：

1. 将 agent 执行内核逐步迁移到 `deepagents`。
2. 将产品逻辑从“一个任务多专家协同”改为“一个任务共享上下文、可切换当前专家对话”。

新的产品语义：

- 一个任务只有一条共享上下文。
- 一个任务里任一时刻只有一个当前激活专家 `activeExpertId`。
- 用户可以在任务内切换专家，但不创建新任务、不清空历史上下文。
- 所有专家共享同一个任务上下文，不同之处在于当前回合的 persona、技能与回答风格。
- 子 Agent 不再作为产品主路径能力暴露。

## 1.1 非目标与兼容边界

本次改造只调整“任务内如何选择和切换专家对话”，不改变现有工作区模型。

以下能力属于硬兼容边界，实施过程中不得破坏：

- `Workspace -> Task -> Message/Run` 的现有层级关系保持不变。
- 一个工作区下仍然可以有多个任务。
- `Task.primaryWorkspaceId` 语义不变。
- `TaskWorkspace`、附加工作区挂载、主工作区切换逻辑不变。
- 任务列表、工作区筛选、工作区统计逻辑不变。
- 消息、运行、审批仍然归属于 `taskId`，而不是引入新的“专家会话”一级资源。
- deepagents 接入后，也必须复用现有任务与工作区绑定关系，不单独发明新的 workspace 边界模型。

本次改造明确不做以下事情：

- 不把“切换专家”建模成新任务。
- 不把“切换专家”建模成新的一级会话实体。
- 不重构现有工作区数据模型。
- 不破坏当前主工作区 + 附加工作区的上下文组织方式。

## 2. 目标架构

### 2.1 产品层心智模型

- `Task` 是共享上下文容器。
- `activeExpertId` 决定当前这轮由哪位专家身份回答或执行。
- `expertIds[]` 语义调整为“当前任务可切换的专家池”。
- 所有消息仍落在同一任务消息流中。

### 2.2 技术层目标

- 保留 `AppService + Repository + IPC + Renderer Store` 作为平台层。
- 将 `AgentRuntimeService` 从“多子 Agent 编排器”重构为“主线程运行时门面”。
- 用 `DeepAgentExecutor` 作为新的主执行引擎。
- 优先使用 deepagents 提供：
  - 文件系统工具
  - 权限控制
  - 中断审批
  - 流式事件
  - skills / memory
- 子 Agent 相关逻辑降级为兼容路径，后续逐步移除或改为内部不可见委托能力。需要注意，deepagents 原生 subagent 是一次性委托模型，不等价于当前可持续交互的子 run。

## 3. 数据结构变更表

### 3.1 共享类型层

| 类型 | 当前字段 | 调整后字段 | 说明 |
| --- | --- | --- | --- |
| `Task` | `expertIds: string[]` | `expertIds: string[]`, `activeExpertId?: string` | `expertIds` 语义从“协作专家列表”改为“可切换专家池”；新增 `activeExpertId` 表示当前专家。 |
| `TaskDraft` | `selectedExpertIds: string[]` | `selectedExpertId?: string`, `availableExpertIds?: string[]` | 发送栏只保留单选专家；如需维护任务专家池，可额外保留 `availableExpertIds`。 |
| `CreateTaskInput` | `expertIds: string[]` | `expertIds: string[]`, `activeExpertId?: string` | 创建任务时允许同时指定可用专家池和默认激活专家。 |
| `UpdateTaskInput` | 可更新 `expertIds` | 可更新 `expertIds`、`activeExpertId` | 用于任务内切换当前专家，或调整任务专家池。 |
| `Message.metadata` | 无专家来源约束 | 增加 `expertId`, `expertName`, `runtimeEngine`, `personaSource` | 便于 UI 展示当前消息来自哪位专家。 |
| `AgentRun` | `kind: main | subagent` | 保留不变，首期只重点保留 `main` | 为兼容现有运行状态与前端订阅保留结构。 |

### 3.2 SQLite / Repository 层

| 表 | 当前列 | 新增/调整列 | 迁移策略 |
| --- | --- | --- | --- |
| `tasks` | `expertIds TEXT NOT NULL` | `activeExpertId TEXT` | 迁移时将老数据的 `activeExpertId` 初始化为 `expertIds[0]`。 |
| `drafts` | `selectedExpertIds TEXT NOT NULL DEFAULT '[]'` | `selectedExpertId TEXT` | 迁移时取 `selectedExpertIds[0]`。旧列先保留一个版本周期。 |
| `messages` | `metadata TEXT` | 无需加列 | 将专家来源写入 `metadata` JSON。 |
| `agent_runs` | 保持不变 | 暂不改 | 深度迁移前先保持兼容。 |

### 3.3 兼容策略

- 老任务读取时：
  - `activeExpertId = task.activeExpertId ?? task.expertIds[0] ?? undefined`
- 老草稿读取时：
  - `selectedExpertId = draft.selectedExpertId ?? draft.selectedExpertIds?.[0] ?? undefined`
- 老前端/旧数据可在过渡期继续保留 `selectedExpertIds` 字段，写入时只写单个主值。

## 4. IPC/API 变更表

### 4.1 任务相关 API

| API | 当前 | 变更后 | 说明 |
| --- | --- | --- | --- |
| `task.create` | 接收 `expertIds[]` | 接收 `expertIds[] + activeExpertId?` | 创建任务时设置任务专家池与默认专家。 |
| `task.update` | 更新 `mode/modelId/expertIds/...` | 支持更新 `activeExpertId` | 可继续复用通用更新接口。 |
| `draft.save` | 接收 `selectedExpertIds[]` | 接收 `selectedExpertId?` | 草稿只保存当前选中的专家。 |

### 4.2 建议新增的显式 API

建议新增以下接口，而不是所有场景都走 `updateTask`：

| API | 参数 | 用途 |
| --- | --- | --- |
| `task.switchActiveExpert` | `taskId`, `expertId` | 任务内切换当前专家，不触发消息发送。 |
| `task.updateAvailableExperts` | `taskId`, `expertIds[]` | 调整当前任务的可选专家池。 |

建议先实现为 `AppService` 新方法，再决定是否对外单独暴露 IPC。

### 4.3 Agent Runtime API

| API | 当前 | 变更后 | 处理策略 |
| --- | --- | --- | --- |
| `agentRun.start` | 创建主 run 或子 run | 仍保留 | 主路径只创建 main run。 |
| `agentRun.sendSubagentMessage` | 对子 Agent 发消息 | 废弃 | 前端、preload、shared IPC 与主进程 IPC 公开面已下线，仅保留内部兼容实现。 |
| `agentRun.stopSubagent` | 停止子 Agent | 废弃 | 前端、preload、shared IPC 与主进程 IPC 公开面已下线，仅保留内部兼容实现。 |
| `agentRun.approve` | 审批恢复 | 保留 | 需要将 deepagents 的 interrupt 机制桥接到现有审批能力，不能假设可无缝直接映射。 |
| `agentRun.listByTask` | 返回主/子 runs | 保留 | 过渡期仍可返回旧数据，UI 将不再强调 subagent。 |

## 5. UI 改造点清单

### 5.1 `TaskComposer.tsx`

当前问题：

- 专家选择是多选。
- 文案为“选择协作专家（可多选）”。
- UI 会展示“已选 N 位专家”。

改造目标：

- 改为单选专家。
- 发送栏中只呈现“当前专家”。
- 如果任务允许多个专家切换，则显示“当前专家 + 切换入口”。

具体改造点：

1. `expertIds: string[]` 改为 `selectedExpertId?: string` 的本地状态。
2. 专家列表从 `Checkbox` 改为单选风格。
3. 删除：
   - “已选 N 位专家”
   - 多专家技能联动逻辑
4. 保留：
   - 专家头像
   - 专家描述
   - 从专家库跳转管理
5. `onSend` 输出参数改为：
   - `activeExpertId?: string`
   - `expertIds?: string[]`（如仍允许管理任务专家池）

### 5.2 `TaskDetailPage.tsx`

当前问题：

- 右侧 runtime 面板强调 `subagentRuns.length`。
- 展示 `Agent Runs` 列表，并区分主 Agent / 子 Agent。

改造目标：

- 右侧从“运行树”转向“当前专家与任务上下文配置”。

建议布局：

1. 当前专家卡片
   - 当前专家名称
   - 描述
   - 切换按钮

2. 可用专家池卡片
   - 展示当前任务可切换的专家集合
   - 点击切换 `activeExpertId`

3. 运行状态卡片
   - 主运行状态
   - 当前节点
   - 待恢复中断数
   - 最近事件数

4. 中断恢复卡片
   - 保留现有审批恢复 UI

5. 删除/弱化内容
   - 子 Agent 数量
   - 子 Agent 展示
   - `sendSubagentMessage` 交互入口

### 5.3 消息展示

建议在 assistant 消息头部展示来源专家：

- 通用助手：`AnyBuddy`
- 某位专家：`AnyBuddy · 架构专家`

依赖 `message.metadata` 字段：

- `expertId`
- `expertName`
- `personaSource`

### 5.4 `runtime-message-view.ts`

改造建议：

1. 保留工具与审批事件汇总。
2. 对以下事件降级处理或移除展示：
   - `subagent_started`
   - `subagent_completed`
3. 新增 persona/专家切换类系统消息支持，便于将“已切换到某专家”注入对话流。

## 6. Runtime 重构清单

### 6.1 `AgentRuntimeService` 重构目标

当前职责：

- 主 Agent 协调者提示词
- `consult_subagent` 多专家委托
- 子 Agent 运行与汇总
- LangChain 路径 + fallback planner

重构后职责：

- 作为统一运行时门面
- 按任务 `activeExpertId` 决定当前 persona
- 调用底层执行器（先 LangChain，后 deepagents）
- 继续负责 run 状态、审批桥接、事件落库

### 6.2 必改项

1. 去掉主协调者提示词
   - 删除“你是多专家协作系统中的主协调者”逻辑
   - 删除“必须 consult_subagent”导向

2. 改造专家 persona 注入
   - main run 根据 `task.activeExpertId` 注入专家 persona
   - 不再要求 subagent 才能拥有专家身份

3. 禁用默认多专家派生
   - `buildFallbackToolPlan()` 不再自动插入 `consult_subagent`
   - `buildLangChainTools()` / `DeepAgentExecutor` 默认不暴露子代理工具

4. assistant 消息追加专家元信息
   - `appendRuntimeMessage()` 时写入 `expertId/expertName`

5. 审批逻辑保留
   - `requestRuntimeApproval()`
   - `approveRuntimeRequest()`
   - `executeApprovedAction()`

6. 子 Agent 能力进入兼容模式
   - `spawnSubagent()` 保留但不走产品主路径
   - `sendSubagentMessage/stopSubagent` 仅保留内部兼容实现，公开暴露面已下线

### 6.3 Fallback Planner 重构

当前 fallback planner 会：

- 获取任务上下文
- 获取运行状态
- 列出工作区文件
- 自动调用 `consult_subagent`

改造后建议：

- 保留上下文读取
- 保留文件工具
- 保留搜索与 shell（受权限控制）
- 去掉自动 `consult_subagent`
- 增加“围绕当前专家 persona 完成回答/执行”的兜底提示

## 7. DeepAgents 接入接口草图

### 7.1 接入原则

- deepagents 只替换主执行内核，不替换平台层。
- `AppService / Repository / IPC / Renderer` 保持为系统真源。
- deepagents 的 streaming / interrupt / tools 通过适配层映射回现有事件模型。

### 7.2 推荐模块划分

建议新增以下模块：

- `src/main/services/agent-executor.ts`
  - 统一执行器接口
- `src/main/services/langchain-executor.ts`
  - 现有 LangChain 逻辑下沉为兼容执行器
- `src/main/services/deepagent-executor.ts`
  - 新 deepagents 主执行器
- `src/main/services/expert-persona-service.ts`
  - 负责生成当前专家 persona prompt / skill 组合

### 7.3 执行器接口草图

```ts
export type ExecuteAgentInput = {
  taskId: string;
  runId: string;
  systemPrompt: string;
  activeExpertId?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
};

export type ExecuteAgentCallbacks = {
  onMessageChunk?(chunk: { runId: string; content: string }): Promise<void>;
  onToolCalled?(payload: { runId: string; toolName: string; args: Record<string, unknown> }): Promise<void>;
  onToolResult?(payload: { runId: string; toolName: string; result: Record<string, unknown> }): Promise<void>;
  onApprovalRequested?(payload: { runId: string; reason: string; originalArgs: Record<string, unknown> }): Promise<void>;
  onCompleted?(payload: { runId: string; finalMessage: string }): Promise<void>;
};

export interface AgentExecutor {
  execute(input: ExecuteAgentInput, callbacks: ExecuteAgentCallbacks): Promise<void>;
}
```

### 7.4 `DeepAgentExecutor` 草图

```ts
type CreateDeepAgentParams = {
  task: Task;
  run: AgentRun;
  activeExpert?: ExpertPreset | null;
  memoryFiles: string[];
  skills: string[];
  permissions: Array<unknown>;
  interruptOn: Record<string, boolean>;
};

class DeepAgentExecutor implements AgentExecutor {
  async execute(input: ExecuteAgentInput, callbacks: ExecuteAgentCallbacks) {
    // 1. 基于任务主 workspace 选择合适的 deepagents backend（如 local disk backend）
    // 2. 基于 task.permissionMode 构建 permissions / interrupt_on
    // 3. 基于 activeExpert 构造本轮 persona prompt
    // 4. 订阅 deepagent stream
    // 5. 将 stream 事件映射为 appService 事件/消息
  }
}
```

### 7.5 专家 persona 组装草图

```ts
type ExpertPersonaContext = {
  task: Task;
  expert: ExpertPreset | null;
};

function buildExpertPersonaPrompt(context: ExpertPersonaContext): string {
  if (!context.expert) {
    return '你是 AnyBuddy，负责在当前共享任务上下文中继续完成用户目标。';
  }

  return [
    `你当前以专家 ${context.expert.name} 的身份工作。`,
    `专家定位: ${context.expert.description}`,
    context.expert.systemPrompt ?? '',
    `你正在同一个任务的共享上下文中继续工作，不要把历史上下文视为新的任务。`,
    `请以该专家视角继续分析、回答或执行。`,
  ].filter(Boolean).join('\n');
}
```

### 7.6 工具策略

首期建议：

- 使用 deepagents 内建工具替换：
  - `list_workspace_files` -> `ls`
  - `read_workspace_file` -> `read_file`
  - `search_workspace` -> `grep`
  - `write_workspace_file` -> `write_file`
  - `edit_workspace_file` -> `edit_file`
  - `run_shell_command` -> `execute`
- 保留业务工具：
  - 审批桥接
  - 获取任务上下文（若仍有需要）

首期建议关闭或隐藏 deepagents 原生子代理能力：

- 不将 `task` tool 暴露为产品主路径能力
- 不用 deepagents 原生 subagent 作为产品能力
- 需要注意，overview 文档说明不能直接通过移除 `SubAgentMiddleware` 来关闭该能力，应按官方子代理配置方式处理

### 7.7 当前接入边界

截至当前实施阶段，deepagents 已接入以下能力：

- 主线程执行器 `DeepAgentExecutor`
- `v3 streamEvents` assistant 文本流
- 项目根 `AGENTS.md` memory
- 任务 `skillIds` 对应的 `.agents/skills/*` skill source
- 基于 `TaskWorkspace` 的 filesystem `permissions`
- 默认关闭产品主路径上的 subagent 能力
- compat-only 注册路径下保留以下 subagent 工具，默认主路径不注册：
  - `consult_subagent`
  - `send_subagent_message`
  - `stop_subagent`

补充说明：

- 当前实现已进一步从“默认注册后过滤”收敛为“compat-only 注册路径”。
- `ToolRegistryService` 默认只注册主路径工具；仅在显式兼容场景下，才会注册上述 subagent 工具。

当前仍未接入、且不能草率启用的能力：

- `interruptOn`

原因：

- deepagents 官方类型说明中，`interruptOn` 依赖 checkpointer。
- AnyBuddy 当前审批恢复依赖自有的 `approvals` 表、`AppService.approveRuntimeRequest()` 以及运行时恢复逻辑。
- 在 deepagents checkpointer 与现有审批恢复链路尚未打通前，直接启用 `interruptOn` 会形成“能暂停、但不能按现有业务语义安全恢复”的半成品状态。

因此当前策略是：

- 暂不启用 deepagents `interruptOn`
- 审批仍由现有 AnyBuddy 工具层与 approval 流处理
- 待后续明确 deepagents checkpointer 持久化与恢复映射方案后，再单独实施 human-in-the-loop 桥接

## 8. 分阶段开发顺序

### Phase 0：数据模型兼容改造

目标：不接 deepagents，先让数据模型支持单专家切换。

任务：

1. `shared/types.ts` 新增 `Task.activeExpertId`。
2. `TaskDraft` 增加 `selectedExpertId`。
3. `AppStateRepository` 增加表迁移。
4. `AppService.createTask/updateTask/saveDraft` 适配新字段。
5. 历史数据兼容读取。

验收：

- 老数据能正常打开。
- 新任务能保存当前专家。

### Phase 1：前端产品逻辑切换

目标：从多选专家切换到单选专家、共享上下文。

任务：

1. 改造 `TaskComposer` 专家选择单选化。
2. 改造 `TaskDetailPage`，增加当前专家/切换专家 UI。
3. assistant 消息展示专家来源。
4. 弱化或隐藏 subagent 相关展示。

验收：

- 一个任务中可切换当前专家。
- 切换专家后历史消息保留。
- 后续消息按当前专家身份返回。

### Phase 2：运行时去多专家编排化

目标：让现有 runtime 不再以多专家协作器为中心。

任务：

1. 移除主协调者 prompt。
2. main run 直接按 `activeExpertId` 工作。
3. 去掉 fallback planner 默认 `consult_subagent`。
4. 保留审批与工具执行。
5. assistant 消息增加专家 metadata。

验收：

- 不创建子 Agent 也能完整运行 ask/plan/craft。
- 切换专家后下一轮执行 persona 生效。

### Phase 3：引入 deepagents 主执行器

目标：用 deepagents 驱动主线程执行。

任务：

1. 抽象 `AgentExecutor` 接口。
2. 新增 `DeepAgentExecutor`。
3. 对接 backend、permissions、interrupt_on、streaming。
4. 将 deepagent 事件映射为 `messages + agent_events + approvals`。
5. 通过配置切换 `langchain | deepagents`。

补充说明：

- 当前代码已经进一步收敛为固定 deepagents 主路径，不再将 `langchain` 作为产品层引擎切换项。
- subagent 相关工具定义虽然仍保留在兼容代码中，但已迁移到 compat-only 注册路径，默认不会注册到主执行链。

验收：

- 主线程可在 deepagents 下完成消息、工具、审批、中断恢复。
- UI 无需感知底层执行器变化。

### Phase 4：下线旧多子 Agent 产品能力

目标：清理不再需要的公开能力。

任务：

1. 从前端、preload、shared IPC、main IPC 下线 `sendSubagentMessage` / `stopSubagent` 公开入口。
2. 从 runtime 默认工具集中移除 `consult_subagent`。
3. 清理 `runtime-message-view` 中的子 Agent 强展示逻辑。
4. 评估是否保留兼容层或彻底移除。

当前状态：

- 第 1、2、3 项已完成。
- 第 4 项仍处于兼容保留阶段，主要残留在 `AgentRuntimeService`、`agent-runtime-types.ts` 和相关测试代码中；`ToolRegistryService` 已迁移为 compat-only 注册路径。

验收：

- 产品路径中不存在多子 Agent 协作入口。
- 旧能力仅保留在内部兼容代码中，或被彻底移除。

## 9. 风险控制策略

### 9.1 数据兼容风险

风险：

- 老任务只存 `expertIds[]`
- 老草稿只存 `selectedExpertIds[]`

控制策略：

- 新增字段，不立刻删旧字段
- 采用惰性兼容读取
- 至少一个版本周期内双读兼容

### 9.2 产品行为变化风险

风险：

- 现有用户可能依赖多专家并发协作
- 切换到单专家对话后，行为变得更线性

控制策略：

- 首期保留 `expertIds[]` 作为任务专家池
- 在任务内支持快速切换专家
- 如确有后台并行需求，后续以 invisible delegation 方式引回，不作为可见会话对象

### 9.3 Runtime 稳定性风险

风险：

- 改造 prompt 策略后，fallback planner 行为变化较大
- 去掉 subagent 后，部分任务的“多视角自动拆解”能力下降

控制策略：

- 分两步做：先改产品模型，再改执行器
- deepagents 与 legacy planner 双层兜底，避免直接切断运行能力
- 为 ask/plan/craft 三种模式分别做手工回归

### 9.4 DeepAgents 接入风险

风险：

- 事件流格式与现有 UI 不一致
- backend / execute / permissions 配置边界复杂
- 中断恢复语义需桥接到自有 approvals 表

控制策略：

- deepagents 只替换主执行器，不替换平台层
- 首期不将原生 subagent 能力作为产品主路径暴露
- 先打通主路径：消息 -> 工具 -> 审批 -> 完成
- 通过 executor adapter 统一映射事件，避免前端感知底层框架差异

### 9.5 回滚策略

当前回滚原则：

- 如果 deepagents 主路径不稳定，运行时仍可回退到 legacy planner。
- 如果新专家单选交互不稳定，数据层仍可保留 `expertIds[]` 兼容回退。
- `langchain` 兼容执行器可保留在内部实现中，但不再作为产品配置项对外暴露。

## 10. 推荐实施顺序总结

建议实际落地顺序：

1. 先改数据模型：`activeExpertId`
2. 再改前端交互：多选专家 -> 单选当前专家
3. 再改 runtime 语义：去协调者化
4. 最后接 deepagents 主执行器
5. 稳定后清理旧 subagent 产品能力

这个顺序能保证：

- 每一步都可独立验证
- 产品逻辑先收敛，再替换执行内核
- 出现问题时可局部回滚，不必整体推倒
