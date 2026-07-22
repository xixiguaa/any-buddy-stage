# 仓库指南

## 应用概览

- AnyBuddy 是一个 Electron Forge + Vite 桌面应用，使用 TypeScript、React 19、Ant Design、Zustand、SQLite、LangChain 和 DeepAgents。
- 主进程负责运行时、文件系统、SQLite、模型与工具调用；预加载层提供受控桥接；渲染进程负责 React 界面和状态管理。
- 实际入口文件为 `src/main/index.ts`、`src/preload/index.ts` 和 `src/renderer/main.tsx`。Electron Forge 由 `forge.config.ts` 和 `vite.*.config.ts` 配置。

## 依赖与命令

- 本仓库使用 pnpm 工作区。依赖锁定文件为 `pnpm-lock.yaml`，安装策略位于 `pnpm-workspace.yaml`；不要混用 npm 或手工编辑锁文件。
- 本地初始化和 CI 使用 `pnpm install --frozen-lockfile`。该命令会严格按锁文件安装依赖，且不修改锁文件。
- `pnpm run dev` 或 `pnpm start` 启动 Electron 开发应用。
- `pnpm run lint` 执行 TypeScript 类型检查：`tsc --noEmit`。用户要求跳过本地检查时，不要自动运行该命令。
- `pnpm run package` 仅生成已打包的应用目录；`pnpm run make` 生成所有配置的发布物；`pnpm run make:zip` 仅生成 Windows ZIP 便携包；`pnpm run make:squirrel` 仅生成 Windows Squirrel 安装包。
- 打包会耗时且写入 `out/`。除非用户明确要求，不要运行 `package` 或 `make` 系列命令。
- `pnpm-workspace.yaml` 允许 `better-sqlite3`、`electron`、`electron-winstaller` 和 `esbuild` 执行安装构建脚本；不要无故收紧这些规则，否则原生依赖或打包工具可能无法工作。

## 测试与验证

- `package.json` 当前没有统一测试脚本。`pnpm exec tsc -p tsconfig.test.json` 会将现有 Node 测试编译到 `.tmp-tests/`。
- 编译后的测试应逐个指定文件运行，例如：`node --test .tmp-tests/src/main/services/agent-runtime-service.test.js`。不要将 `.tmp-tests` 目录直接传给 `node --test`。
- `node scripts/test-sqlite-checkpointer.mjs` 是 SQLite checkpointer 冒烟测试，会在仓库的 `userData/` 下创建本地测试数据库；不要提交该目录或其生成文件。
- 验证范围应与改动风险匹配：类型或 IPC 改动至少运行类型检查；运行时、仓储或状态逻辑改动应运行相关测试；可见界面改动应进行人工验证。

## 项目结构

- `src/main/`：Electron 主进程、IPC 处理器、仓储、运行时服务和窗口创建。
- `src/preload/`：通过 `contextBridge` 暴露给渲染进程的受控 API。
- `src/renderer/`：React 界面、页面、组件、客户端封装、状态和样式。
- `src/shared/`：共享领域类型、IPC 通道和跨进程契约。
- `scripts/`：独立维护或冒烟检查脚本。
- `docs/`：贡献文档、技术架构、详细设计和发布素材。
- `.vite/`、`dist/renderer/` 与 `out/` 为生成输出，不应直接编辑或提交。

## 跨进程边界

- 渲染进程代码必须通过 `window.anybuddy` 调用主进程能力；不要在 `src/renderer/` 中导入 Electron、Node API 或直接访问文件系统。
- 新增或修改 IPC 时，同时更新四处：`src/shared/ipc.ts`、`src/preload/bridge.ts`、`src/main/ipc/register-ipc-handlers.ts` 和 `src/renderer/api/clients.ts`。
- 共享载荷与领域类型位于 `src/shared/types.ts`。在接入界面或服务前，先在共享层明确 IPC 契约。
- 新增运行时订阅时，注意释放 `ipcRenderer` 监听器，保持 `subscribeActive` 与 `subscribeTask` 返回取消订阅函数的现有模式。

## 运行时与持久化

- SQLite 持久化位于 `src/main/repositories/app-state-repository.ts`。`save(state)` 会在一个事务中重写全部表；不要针对高频流式分块进行持久化写入。
- Agent 运行时由 `src/main/services/agent-runtime-service.ts` 协调，DeepAgents 执行位于 `src/main/services/deepagent-executor.ts`，项目工具在 `src/main/services/tool-registry-service.ts` 中注册。
- 流式助手输出应保持暂态，直至运行完成。最终助手消息由 `AppService` 的 `completeRuntimeRun` 持久化。
- 运行时补丁通过 `agent-run:task-changed:<taskId>` 到达渲染进程，并在 `src/renderer/stores/app-store.ts` 中合并；不要为每个流式 token 重建 `messages`。
- 主状态存储在 Electron `app.getPath('userData')` 下的 `anybuddy.db`，不在仓库中。
- 模型和 MCP 配置会通过 `AppService` 镜像到 `~/.anybuddy` 下的文件；请通过主进程服务 API 访问。
- 全局技能目录为 `~/.anybuddy/skills/<skillId>/SKILL.md`。DeepAgents 会在执行前将选中的技能镜像到当前后端的 `.system-skill-cache`。

## 界面与状态

- 渲染进程使用 React 19、Ant Design、lucide 图标和 Zustand。优先沿用现有组件、状态和交互模式。
- 任务对话界面位于 `src/renderer/pages/TaskDetailPage.tsx`；运行时消息整理逻辑位于 `src/renderer/stores/runtime-message-view.ts`。
- 保持现有自动滚动行为：仅当用户已接近底部，或刚切换任务后，才跟随新输出滚动。
- 组件和组件文件使用 `PascalCase`；函数、辅助方法和局部变量使用 `camelCase`；遵循邻近代码的格式与导入风格。

## 提交约定

- 保持改动聚焦，不要夹带无关重构、生成物或本地数据。
- 当行为、启动方式、构建流程、架构或用户流程改变时，同步更新中文 README 或相关文档。
- 代码审查说明应简要列出行为变化、验证结果，以及仍存在的风险或未验证项。
