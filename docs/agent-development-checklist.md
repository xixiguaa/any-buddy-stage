# Agent 开发清单

这份清单面向后续续开发，分为“已完成 / 进行中 / 待完成”三个层次，方便快速判断优先级。

## 已完成

### P0

- [x] 接入官方 `openai` SDK，并抽出 `openai-model-service.ts`
- [x] 在主进程新增 LangChain `createAgent` 封装
- [x] 接入 `tool`、`agent.invoke`、`agent.stream`
- [x] 建立 `agent-runtime-service.ts`，承接主运行时逻辑
- [x] 建立 `agent-runtime-types.ts`，统一 runtime 相关类型
- [x] 建立 `tool-registry-service.ts`，统一工具注册与分发
- [x] 让审批链路真正接管高风险工具，而不只是保留接口
- [x] 默认状态改为初始化 `1` 个工作区 + `1` 个任务，并写入 SQLite

### 测试

- [x] `openai-model-service.test.ts`
- [x] `langchain-agent-service.test.ts`
- [x] `agent-runtime-service.test.ts`
- [x] `tool-registry-service.test.ts`
- [x] `default-state.test.ts`
- [x] `runtime-message-view.test.ts`

## 进行中

### Runtime 主链路切换

- [~] `agent-runtime-service.ts` 已优先走 LangChain Agent
- [~] 旧“模型规划循环”仍保留为 fallback
- [~] 审批恢复已接通，但仍需补更多边界测试

### 前端运行态展示

- [~] 已能显示流式助手输出快照
- [~] 仍不是 token 级 UI
- [~] 工具调用卡片 / 子 Agent 卡片 / 审批卡片还不够完整

### 数据来源统一

- [~] 任务、工作区、消息、运行态已走 SQLite
- [~] 模型配置和 MCP 配置仍是文件
- [~] 前端个别模型数据仍有硬编码

## 待完成

### P0：把 Agent Runtime 真正收稳

- [ ] 明确旧 fallback 链路的保留策略
- [ ] 收敛 `run` / `task` / `event` 状态流转规范
- [ ] 补 LangChain 主路径的失败恢复与状态回写测试
- [ ] 补审批中断、审批编辑参数、审批恢复的完整集成测试

### P1：补全工具与子 Agent

- [ ] 为每个工具定义更严格的 `zod schema`
- [ ] 把 `spawnSubagent` 从占位实现替换成真实执行逻辑
- [ ] 设计主 Agent / 子 Agent 的上下文边界与回写协议
- [ ] 增加 `send_subagent_message`、`stop_subagent`、`list_agent_runs` 等能力

### P1：统一配置源

- [ ] 评估并实现模型配置 SQLite 化
- [ ] 评估并实现 MCP 配置统一接入应用配置层
- [ ] 去掉 `TaskComposer` 内置模型列表
- [ ] 让 runtime、设置页、任务创建页共享同一模型配置来源

### P1：前端补强

- [ ] 任务详情页补齐工具调用卡片
- [ ] 任务详情页补齐审批卡片编辑体验
- [ ] 任务详情页补齐子 Agent 轨迹展示
- [ ] 增加全局“运行中任务”视图
- [ ] 优化运行事件时间线可读性

### P2：质量与工程化

- [ ] 清理剩余乱码文案与旧注释
- [ ] 补 IPC 层测试
- [ ] 补 renderer 组件测试
- [ ] 补多任务并发冲突测试
- [ ] 补应用重启后任务恢复测试
