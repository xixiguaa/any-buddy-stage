# AnyBuddy

一个本地优先的 AI Agent 工作台。它通过任务、工作区、专家预设和运行时事件，将复杂工作拆解为可追踪、可恢复、可协作的 Agent 工作流。

## 项目解决的问题

许多 AI 编程或办公助手仍停留在一次性聊天界面：上下文难以管理、任务状态难以追踪、工具调用不透明、长任务中断后难以恢复，也难以将不同专家能力组织进同一条工作流。

AnyBuddy 将 Agent 从聊天窗口带入本地工作台。每个任务都可以携带工作区上下文、模型设置、技能、连接器、运行时事件、审批状态和历史记录。你可以创建和继续任务、调用专家、查看运行时事件，并逐步将 Agent 工作流沉淀为可维护的本地系统。

## 项目亮点

- 本地优先的持久化：任务、消息、工作区、运行记录、事件和审批状态均保存在本地 SQLite 中。
- 原生桌面体验：Electron 主进程负责文件系统访问、运行时编排和持久化；渲染进程专注于交互界面。
- 基于任务的 Agent 工作流：产品围绕任务创建、继续执行、运行状态和事件流组织。
- 专家预设：通过专家角色快速加载技能组合和任务上下文。
- 可见的运行时事件：在界面中展示工具调用、审批、子 Agent 状态和执行进度。
- 工作模式与权限分离：`ask`、`plan`、`craft` 决定 Agent 如何工作；`read_write`、`full_access` 决定 Agent 可以做什么。
- 安全的命令审批：在 `read_write` 模式下，执行本地命令前会请求确认；审批通过后会在原运行流中恢复，不会从头重新执行工具链。
- 全局技能目录：技能统一从 `~/.anybuddy/skills/<skillId>/SKILL.md` 加载，并在运行时镜像到当前工作区缓存。
- 可扩展架构：共享 IPC 契约、预加载桥接、主进程服务和工具注册表保持清晰的边界。

## 工作模式与权限

AnyBuddy 将 Agent 的工作方式与能力边界分开配置，避免将产品意图与安全策略混在一起。

### 工作模式

- `ask`：问答模式，适合解释、检索、分析和快速答疑；默认不主动修改代码。
- `plan`：规划模式，适合拆解任务、生成步骤并确认执行方向。
- `craft`：执行模式，适合直接实现需求、修改文件并完成验证。

### 权限模式

- `read_write`：允许读写工作区；执行本地 `execute` 命令前需要用户确认，审批后会在当前 DeepAgents 运行中原地恢复。
- `full_access`：完全访问模式；可以直接执行本地命令，仅应在用户明确授权当前任务时使用。

## 截图

> 当前仓库尚未提交真实截图。首个公开版本建议添加 `docs/assets/anybuddy-preview.png` 或 `docs/assets/anybuddy-demo.gif`，以便在 GitHub README 中直观展示产品形态。

```md
![AnyBuddy 预览图](docs/assets/anybuddy-preview.png)
```

建议截图包含以下内容：

- 新建任务页面：展示模型、工作模式、权限、技能、工作区和专家选择入口。
- 任务详情页面：展示对话、运行时事件、审批或子 Agent 状态。
- 专家配置页面：展示专家预设和技能组合。

## 快速开始

### 环境要求

- 推荐使用 Node.js 20 或更高版本。
- 项目使用 pnpm 管理依赖和运行脚本。
- 需要可运行 Electron 桌面应用的系统环境。

### 远程 Docker 沙盒

默认权限模式直接通过 SSH 连接远程服务器，并在远程 Docker 容器中执行 Agent 命令。完全访问权限仍使用本地 `LocalShellBackend`。

### SSH 远程 Docker 沙盒

如果远程服务器没有 HTTP 沙盒服务，但可以通过 SSH 使用 Docker，可使用内置 `ssh2` 客户端执行远程 Docker 命令：

```bash
SANDBOX_SSH_HOST=your-server.example.com
SANDBOX_SSH_USER=ubuntu
SANDBOX_SSH_PORT=22
SANDBOX_SSH_PASSWORD=your-password
# 或使用密钥认证：SANDBOX_SSH_KEY_PATH=/path/to/id_ed25519
# 可选：SANDBOX_SSH_KEY_PASSPHRASE=your-key-passphrase
# 可选：SANDBOX_SSH_HOST_FINGERPRINT=SHA256:...
SANDBOX_DOCKER_IMAGE=node:22-bookworm-slim
```

同一个工作区下的任务共享同一个 SSH Docker 沙箱。工作区创建后会异步预热容器，任务首次运行会等待预热完成；应用退出或工作区归档时会清理对应容器。

设置 `SANDBOX_SSH_HOST` 后，应用会使用 SSH 后端；也可以将 `SANDBOX_SERVER_URL` 写成 `ssh://user@host:22` 触发 SSH 后端。远程 SSH 用户必须有权限执行 Docker。未设置 `SANDBOX_SSH_HOST_FINGERPRINT` 时，`ssh2` 会接受服务器提供的主机密钥，生产环境建议配置该值；密码会通过进程环境传入，请勿提交到仓库。容器需要提供 POSIX shell、`base64`、`dirname`、`mkdir`、`tr` 等基础命令；可通过 `SANDBOX_DOCKER_IMAGE` 指定已有镜像。可选的 `SANDBOX_SSH_TIMEOUT_MS`、`SANDBOX_SSH_MAX_OUTPUT_BYTES` 和 `SANDBOX_SSH_MAX_TRANSFER_BYTES` 分别控制命令超时、命令输出上限（默认 1 MiB）和文件传输输出上限（默认 64 MiB）。

### sandbox.ini 配置

桌面应用启动时会读取 `sandbox.ini`：开发环境读取项目根目录，打包后读取应用 `.exe` 同级目录。可参考 `sandbox.ini.example` 配置 `[ssh]` 和 `[docker]`。INI 中已填写的字段优先，未填写的字段仍可通过同名 `SANDBOX_*` 环境变量提供，以兼容旧配置。

`sandbox.ini` 包含明文密码，已加入 `.gitignore`，不会被打进安装包。发布后请手动将该文件放到 `.exe` 同级目录，并限制文件访问权限。

### 安装依赖

```bash
pnpm install --frozen-lockfile
```

该命令严格按已提交的 `pnpm-lock.yaml` 安装依赖，且不会在安装过程中修改锁文件。

### 启动开发应用

```bash
pnpm run dev
```

该命令通过 Electron Forge 和 Vite 启动 Electron 开发应用。`pnpm start` 与 `pnpm run dev` 等效。

### 类型检查

```bash
pnpm run lint
```

当前 `lint` 脚本会执行 `tsc --noEmit` 进行 TypeScript 类型检查。

### 本地打包

```bash
pnpm run package
```

### 构建发布物

```bash
pnpm run make
```

### 构建 ZIP 便携包

```bash
pnpm run make:zip
```

生成的 ZIP 包完整解压后即可运行其中的应用程序。

## 文档

- [贡献指南](docs/contributing.md)：介绍如何参与贡献、提交 Issue、发起 Pull Request 和验证改动。
- [技术架构](docs/technical-architecture.md)：介绍项目结构、进程边界、数据流和架构图。
- [详细设计草案](docs/anybuddy-detailed-design.md)：包含更完整的产品与实现设计说明。

## 目录结构

```text
src/
  main/       Electron 主进程、IPC 处理器、仓储和运行时服务
  preload/    暴露给渲染进程的安全桥接层
  renderer/   React 界面、页面、组件、状态和样式
  shared/     共享类型、IPC 契约和跨进程辅助工具
docs/         贡献文档、架构说明和设计草案
```

## GitHub About 配置建议

GitHub 仓库页面右上角的描述、主题和 About 元数据需要手动配置，不能仅通过 README 自动设置。建议填写：

描述：

```text
面向任务工作流、专家预设、运行时事件和 Electron 桌面自动化的本地优先 AI Agent 工作台。
```

主题：

```text
ai-agent, agent-workflow, electron, react, typescript, sqlite, langchain, desktop-app, local-first, task-management, ai-workspace, ipc
```

网站：

```text
https://github.com/<your-org-or-user>/anybuddy
```

## 参与贡献

欢迎参与 AnyBuddy 的建设。无论是提交 bug、改进文档、优化界面体验、补充测试，还是参与 Agent Runtime 和工具体系建设，都可以从贡献指南开始。

开始贡献前，请先阅读 [docs/contributing.md](docs/contributing.md)。其中介绍了推荐的本地开发流程、代码规范、验证步骤和 Pull Request 要求。

如果准备进行较大的改动，请先阅读 [docs/technical-architecture.md](docs/technical-architecture.md)，确保主进程、预加载层、渲染进程和 shared 契约之间的边界保持清晰。
