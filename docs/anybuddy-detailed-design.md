# anybuddy 项目详细设计书

## 1. 项目概述

### 1.1 项目名称

anybuddy

### 1.2 项目定位

anybuddy 是一个本地优先的个人 AI 工作台，参考 WorkBuddy 的“桌面端、本地 Agent、工具连接、任务执行”产品方向，在其基础上做更偏个人效率和可扩展能力的改造。

首版不追求完整替代办公软件，也不做复杂云端协同，而是先打通一个可用的多 Agent 桌面工作台闭环：

1. 用户通过聊天入口创建任务。
2. 任务可以选择模式、模型、技能、连接器和权限。
3. 系统围绕专家、技能、连接器和工作空间组织能力。
4. 本地保存任务、聊天记录、工作空间、技能配置和 MCP 连接器配置。
5. 用户可以在对话中召唤多个 Agent 协作，任务在后台异步执行，边执行边反馈中间结果。
6. Agent 首版内置基础编程工具，包括查看文件、写入文件、搜索文件、编辑文件、执行受控命令和 PowerShell 命令。

### 1.3 设计目标

1. 提供一个清晰、稳定、可扩展的桌面工作台 UI。
2. 以任务聊天作为核心交互，把专家、技能、模型、连接器都收敛到同一套任务上下文中。
3. 首版支持本地数据持久化，不依赖登录系统。
4. 首版直接引入 Agent Runtime，支持后台执行、流式反馈、中途介入、打断和恢复。
5. 基于 LangGraph / Deep Agents 复用多 Agent 编排、持久化、中断、流式事件和工具体系，避免重复造轮子。
6. 技术栈优先选择 TypeScript 生态，降低前后端、桌面壳、Agent 层之间的集成成本。

## 2. 产品范围

### 2.1 首版必做范围

1. 桌面应用基础框架。
2. 左侧导航栏。
3. 固定本地用户信息和用户菜单。
4. 任务搜索 Modal 和任务时间筛选 Popover。
5. 新建任务聊天页。
6. 任务详情聊天页。
7. 模式选择、模型选择、技能选择、连接应用、权限显示。
8. 工作空间选择和本地文件夹绑定。
9. 专家、技能、连接器管理页。
10. 内置专家列表、内置技能列表、内置连接器列表。
11. MCP 配置文件读取和编辑，路径为用户目录下 `.anybuddy/mcp.json`。
12. 本地任务、消息、工作空间、专家、技能、连接器配置持久化。
13. 多 Agent 协作运行时，支持主 Agent 召唤子 Agent。
14. 后台异步任务执行，用户可以离开任务详情页后继续运行。
15. Streaming & Interim Output，实时展示 token、阶段状态、工具调用、子 Agent 进度和中间产物。
16. Human-in-the-Loop，支持敏感工具调用前暂停、用户审批、修改参数、继续执行。
17. 打断与恢复，支持用户主动暂停、取消、追加指令后继续。
18. 内置编程工具：文件列表、读取文件、写入文件、编辑文件、全文搜索、glob、执行受控 cmd/PowerShell 命令。
19. 多任务并行工作台：允许多个任务在后台同时运行，用户可在任务列表、工作空间任务树和任务详情页之间切换，不因离开页面而中断任务。
20. 多工作空间任务上下文：一个任务必须有一个主工作空间，也可以按需挂载多个关联工作空间，用于跨项目阅读、对比、迁移和联动修改。

### 2.2 首版暂不做

1. 登录、注册、账号体系。
2. 云同步、多端实时协作。
3. 插件市场。
4. 复杂 RBAC 权限系统。
5. 真实微信和钉钉深度自动化。
6. 浏览器自动化和 Office 深度自动化。
7. 无限制系统命令执行。

### 2.3 二期可扩展范围

1. 本地知识库索引和向量检索。
2. MCP Server 启停、健康检查和工具发现。
3. 微信机器人、钉钉机器人真实连接。
4. 技能创建器和专家创建器的 Agent 化流程增强。
5. 更完整的任务执行回放和时间旅行。
6. 更细粒度的权限策略、工具市场和组织级策略管理。

## 3. 用户与核心场景

### 3.1 目标用户

1. 希望用 AI 管理个人工作任务的个人用户。
2. 需要频繁处理文档、信息整理、运营、项目推进的用户。
3. 想把 AI、技能、MCP 连接器和本地工作空间串起来的高级用户。

### 3.2 核心场景

#### 场景一：新建任务

用户点击左侧“新建任务”，进入通用聊天页。用户输入需求，选择 ask、plan 或 craft 模式，选择模型、技能、连接应用和权限，发送后形成一个任务会话。

#### 场景二：通过专家发起任务

用户进入“专家”页，选择内置专家或自定义专家。专家本质是带固定角色设定、默认技能和默认模型偏好的 Agent 配置。用户可以基于专家创建新的任务。

#### 场景三：添加专家

用户点击添加专家，系统跳转到新建任务聊天页，并自动带上“创建专家”的技能。默认提示词格式：

```text
帮我创建一个 XXX 专家，擅长 XXXXX。
我的经验是：[请补充你的行业背景、相关经验]
```

LLM 根据对话内容生成专家配置，用户确认后保存到本地专家列表。

#### 场景四：管理技能

用户在“技能”页查看、搜索、导入技能。技能可以从本地导入，也可以后续通过“创建技能”的对话流程生成。

#### 场景五：管理连接器

用户在“连接器”页查看内置微信机器人、钉钉连接器，也可以自定义添加 MCP 连接器。连接器配置保存在：

```text
C:\Users\<username>\.anybuddy\mcp.json
```

界面提供类代码编辑器体验，便于用户直接编辑 JSON 配置。

#### 场景六：工作空间管理

用户在聊天页底部选择当前工作空间，也可以打开本地文件夹作为新工作空间。左侧“空间”区域展示工作空间列表，每个空间下可以折叠展示关联任务。

#### 场景六补充：多工作空间对话任务

用户在新建任务或任务详情中，可以把一个任务从单工作空间升级为多工作空间上下文。例如用户选择 `anybuddy-app` 作为主工作空间，再附加 `anybuddy-docs` 和 `anybuddy-api`。对话中用户可以提出“对比前端和接口文档，找出缺失字段并生成修改建议”。

系统处理原则：

1. 主工作空间决定任务默认执行目录、默认文件读写范围和任务归属。
2. 关联工作空间只在用户显式挂载后进入上下文。
3. Agent 回复和工具调用需要标明来源工作空间，避免跨项目内容混淆。
4. 涉及写入、删除、命令执行时，必须明确目标工作空间，并按该工作空间的权限策略审批。
5. 任务列表中展示主工作空间；任务详情页展示完整工作空间上下文。

#### 场景六补充：多任务并行推进

用户可以同时发起多个任务，例如一个任务在 `anybuddy-app` 中修复 UI，一个任务在 `anybuddy-docs` 中完善文档，另一个任务在后台分析接口 Schema。每个任务独立保存消息、运行状态、事件流和审批请求。

系统处理原则：

1. 每个任务独立运行，互不共享草稿、消息流和审批状态。
2. 不同任务可以绑定同一个工作空间，但同一时间对同一文件执行写入时需要冲突提示。
3. Sidebar 任务列表需要展示运行中、等待审批、失败、已完成等状态。
4. 用户切换任务后，当前任务继续后台运行，任务详情页重新进入时从事件日志恢复时间线。
5. 全局需要有一个“运行中任务”视图或筛选条件，方便用户找回后台任务。

#### 场景七：对话中召唤多 Agent 协作

用户在任务对话中提出复杂目标，例如“读取这个项目，找出登录模块的问题，并修复单元测试”。主 Agent 先生成执行计划，然后按需要召唤子 Agent：

1. 规划 Agent：拆解任务、识别文件范围、定义验收标准。
2. 编程 Agent：读取文件、编辑文件、执行测试命令。
3. 审查 Agent：检查改动风险、补充遗漏和回归点。
4. 总结 Agent：整理最终结果和下一步建议。

子 Agent 在后台独立执行，任务详情页实时展示每个 Agent 的状态、工具调用和中间输出。

#### 场景八：后台执行与流式反馈

用户发送任务后，任务进入后台执行队列。用户可以切换页面或查看其他任务，任务仍继续运行。执行过程中，系统持续输出：

1. LLM token 流。
2. Agent 阶段状态。
3. 工具调用开始、进度、结束和错误。
4. 子 Agent 的中间结果。
5. 文件变更、命令输出、测试结果。

#### 场景九：中途介入和打断

当 Agent 准备执行写文件、删除文件、运行命令、调用外部连接器等敏感动作时，系统暂停并请求用户确认。用户可以：

1. 批准继续。
2. 拒绝执行。
3. 修改工具参数后继续。
4. 追加新指令。
5. 暂停或取消整个任务。

任务状态需要可恢复，用户确认后从中断点继续执行。

## 4. 信息架构

### 4.1 主界面布局

应用采用左右结构：

1. 左侧 Sidebar：应用名称、顶部操作、菜单、任务列表、空间列表、用户信息。
2. 右侧 Main Content：根据当前路由展示新建任务、任务详情、专家/技能/连接器管理等页面。

### 4.2 左侧 Sidebar 结构

```text
Sidebar
├── 顶部区域
│   ├── anybuddy Logo/名称
│   ├── 收起侧边栏按钮
│   ├── 搜索任务按钮
│   └── 筛选按钮
├── 操作菜单
│   ├── 新建任务
│   └── 专家
├── 任务区域
│   ├── 折叠标题：任务
│   └── 任务列表
├── 空间区域
│   ├── 折叠标题：空间
│   └── 工作空间列表
└── 用户区域
    ├── 用户头像
    ├── 用户名称
    └── 用户菜单
```

### 4.3 右侧页面结构

1. `/tasks/new`：新建任务聊天页。
2. `/tasks/:taskId`：任务详情页。
3. `/experts`：专家、技能、连接器管理页。
4. `/settings`：设置页，首版提供版本信息、用户信息展示和基础偏好配置。

## 5. 功能详细设计

### 5.1 用户信息与用户菜单

#### 功能说明

左下角显示写死的用户头像和用户名。点击后弹出菜单。

#### 菜单项

1. 设置。
2. 检查更新。
3. 退出登录。

#### 首版处理

1. 用户信息写死在本地配置或前端常量中。
2. 设置可进入最小设置页，展示版本信息、固定用户信息和基础偏好配置。
3. 检查更新可显示“当前已是最新版本”的提示。
4. 退出登录只关闭菜单或提示“当前版本暂未接入账号系统”。

### 5.2 顶部操作区

#### 收起侧边栏

点击后 Sidebar 进入折叠状态，只保留图标和必要入口。再次点击恢复。

#### 搜索任务

点击后打开 Modal：

1. 顶部为搜索输入框。
2. 下方为任务列表。
3. 支持按任务标题、最近消息、专家名称、工作空间名称过滤。
4. 点击任务后跳转到任务详情页。

#### 筛选任务

点击后打开 Popover：

1. 筛选时间。
2. 全部时间。
3. 今天。
4. 最近 7 天。
5. 最近 30 天。
6. 重置筛选条件按钮。

筛选条件影响 Sidebar 任务列表和搜索 Modal 任务列表。

### 5.3 新建任务聊天页

#### 页面组成

```text
NewTaskPage
├── 消息区域
│   ├── 欢迎态
│   ├── 用户消息
│   ├── AI 消息
│   └── 技能块/工具块
├── 聊天输入框
│   ├── 已选技能块
│   ├── 文本输入区域
│   ├── 左侧控制区
│   └── 右侧操作区
└── 工作空间选择器
```

#### 输入框左侧控制区

1. 模式选择 Popover。
   - ask：问答模式。
   - plan：计划模式。
   - craft：创作/产出模式。
2. 模型选择 Popover。
   - 内置模型列表。
   - 添加自定义模型。
3. 技能选择 Popover。
   - 搜索技能。
   - 技能列表。
   - 导入技能。
4. 连接应用 Popover。
   - 微信。
   - 钉钉。
5. 权限显示。
   - 默认权限。
   - 完全访问权限。

#### 输入框右侧操作区

1. 添加按钮。
   - 本地文件。
   - 知识库。
2. 发送按钮。

#### 工作空间选择器

展示当前工作空间名称和图标。点击后打开 Popover：

1. 搜索工作空间。
2. 工作空间列表。
3. 打开本地工作空间按钮。

选择本地文件夹后，系统创建或更新工作空间记录。

#### 多工作空间选择

新建任务页默认选择一个主工作空间。用户需要跨项目处理时，可以在工作空间选择器中添加关联工作空间。

交互要求：

1. 主工作空间以单选方式展示，决定任务默认归属和默认执行目录。
2. 关联工作空间以多选方式展示，可以添加或移除。
3. 每个已选工作空间显示名称、路径摘要和权限状态。
4. 发送第一条消息后，任务绑定的主工作空间不可直接删除，只能通过“切换主工作空间”操作显式修改。
5. 如果任务已有运行中的 Agent，修改工作空间上下文需要暂停任务并重新确认权限。

### 5.4 任务详情页

#### 功能说明

从任务列表点击任务后进入任务详情页。任务详情页复用聊天消息和输入框，但默认不显示底部工作空间选择器，改为在页面标题区展示当前任务的工作空间上下文。

#### 页面内容

1. 任务标题。
2. 聊天记录。
3. 已选模式、模型、技能、连接器、权限。
4. 消息输入框。
5. 主工作空间和关联工作空间。
6. 当前运行状态：空闲、排队、运行中、等待审批、暂停、失败、完成、取消。
7. 后台运行状态条，用于展示当前 Agent 阶段、最近工具调用和等待用户处理的事项。
8. 后续可加入任务执行日志和工具调用日志。

#### 任务切换与并行对话

任务详情页需要支持用户在多个对话任务之间快速切换。

1. 切换任务时，当前输入草稿按 `taskId` 单独保存。
2. 运行中的任务继续通过后台 Worker 执行，不依赖详情页是否打开。
3. 当前打开任务订阅实时事件；未打开任务只更新 Sidebar 状态、未读计数和全局运行中任务计数。
4. 当后台任务进入 `waiting_approval` 状态时，Sidebar 和任务详情页都要显示醒目标记。
5. 用户可以从任意页面点击等待审批任务，直接进入对应审批位置。

### 5.5 专家、技能、连接器页

#### 顶部 Tab

1. 专家。
2. 技能。
3. 连接器。

#### 专家 Tab

专家是 Agent 配置，不是独立服务。每个专家包含：

1. 名称。
2. 头像或图标。
3. 简介。
4. 擅长领域。
5. 系统提示词。
6. 默认模式。
7. 默认模型。
8. 默认技能。
9. 默认连接器。
10. 创建时间和更新时间。

用户可以：

1. 查看内置专家。
2. 搜索专家。
3. 添加自定义专家。
4. 编辑自定义专家。
5. 删除自定义专家。
6. 基于专家创建任务。

#### 技能 Tab

技能是可注入到任务上下文的能力包。每个技能包含：

1. 名称。
2. 描述。
3. 适用场景。
4. 提示词或执行说明。
5. 可用工具声明。
6. 来源：内置、本地导入、对话生成。
7. 启用状态。

用户可以：

1. 搜索技能。
2. 查看技能详情。
3. 导入本地技能。
4. 通过新建对话创建技能。
5. 启用或禁用技能。

#### 连接器 Tab

连接器用于接入 MCP 或第三方应用。首版内置：

1. 微信机器人。
2. 钉钉。

连接器配置支持：

1. 查看连接器列表。
2. 添加自定义连接器。
3. 编辑 `.anybuddy/mcp.json`。
4. 校验 JSON 格式。
5. 保存配置。

首版可以只做配置管理，不负责真实启动 MCP Server。

### 5.6 任务区域

左侧任务区域可折叠，展示任务列表。任务列表项包含：

1. 任务标题。
2. 最近消息摘要。
3. 更新时间。
4. 所属专家或模式。
5. 主工作空间。
6. 运行状态。
7. 未读事件数量。

点击任务进入任务详情。

任务区域支持快速筛选：

1. 全部任务。
2. 运行中。
3. 等待审批。
4. 最近失败。
5. 当前工作空间相关任务。

### 5.7 空间区域

左侧空间区域可折叠。每个空间项包含：

1. 空间名称。
2. 本地路径。
3. 三点菜单。
4. 子任务列表。
5. 正在运行的任务数量。
6. 等待审批的任务数量。

三点菜单包含：

1. 打开文件夹。
2. 从列表中移除。
3. 设为当前新建任务默认工作空间。

工作空间下的任务列表支持折叠。任务同时关联多个工作空间时，在每个相关工作空间下都可以出现，但需要用“主”标识区分主工作空间归属，避免用户误以为有多个重复任务。

## 6. 技术架构设计

### 6.1 总体架构

```text
┌──────────────────────────────────────────────┐
│                 Renderer UI                  │
│ React + React Router + Zustand + Context     │
└──────────────────────┬───────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────┐
│              Electron Main Process            │
│ Window / File Dialog / Native API / Security  │
└──────────────────────┬───────────────────────┘
                       │ Service API
┌──────────────────────▼───────────────────────┐
│              Local Application Core           │
│ Task / Chat / Expert / Skill / Workspace      │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│              Agent Runtime                    │
│ LangGraph / Deep Agents / Worker / Events     │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│              Tool Sandbox Layer               │
│ File Tools / Command Tools / MCP Tools        │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│              Local Persistence Layer          │
│ SQLite / Checkpoints / Config Files / MCP JSON│
└──────────────────────────────────────────────┘
```

### 6.2 分层说明

#### Renderer UI

负责所有用户界面：

1. 页面路由。
2. Sidebar。
3. 聊天页。
4. Modal、Popover、Tabs、列表和表单。
5. 状态展示。

Renderer 不直接访问文件系统和数据库，只通过 IPC 调用主进程服务。

Renderer 层不能直接拼接 IPC channel，也不能直接依赖 Electron API。Renderer 只依赖 `src/renderer/api` 中定义的业务客户端对象，例如 `TaskClient`、`WorkspaceClient`、`AgentRunClient`。页面和组件只调用这些客户端方法，不关心底层通信方式。

#### Electron Main Process

负责桌面能力：

1. 创建窗口。
2. 管理应用生命周期。
3. 打开本地文件夹选择框。
4. 打开文件夹。
5. 读取和保存配置文件。
6. 对 Renderer 暴露受控 IPC API。

主进程的 IPC handler 只负责协议适配、参数校验、错误映射和调用应用服务，不直接写数据库、不直接实现业务流程。业务逻辑必须下沉到 Local Application Core。

#### Local Application Core

负责业务逻辑：

1. 任务管理。
2. 消息管理。
3. 专家管理。
4. 技能管理。
5. 连接器配置管理。
6. 工作空间管理。
7. 搜索和筛选。

Local Application Core 采用面向对象方式组织。每个业务域由 Service、Repository、Policy 和 DTO/Entity 组成：

1. Service 负责编排业务流程，例如 `TaskService.createTask()`、`WorkspaceService.attachTask()`。
2. Repository 负责数据访问，例如 `TaskRepository.findById()`、`MessageRepository.append()`。
3. Policy 负责规则判断，例如 `WorkspaceAccessPolicy.canWrite()`、`CommandPolicy.validate()`。
4. Entity/DTO 负责类型边界，避免主进程、Renderer、数据库 schema 互相泄漏实现细节。

Core 层不依赖 React、Electron Renderer、组件库或页面状态，只依赖数据库、文件系统适配器、Agent Runtime 接口和系统能力抽象。

#### Agent Runtime

首版直接加入，负责多 Agent 编排和后台任务执行：

1. 基于 LangGraph 管理长任务、状态图、checkpoint、streaming 和 interrupt。
2. 基于 Deep Agents 评估复用子 Agent、文件工具、任务规划、权限和沙箱能力。
3. 支持主 Agent 召唤子 Agent，并将子 Agent 状态、输出和工具调用写入事件流。
4. 支持后台异步执行，任务离开页面后仍持续运行。
5. 支持 Human-in-the-Loop，在敏感工具调用前暂停并等待用户确认。

#### Tool Sandbox Layer

负责所有高风险本地动作的封装和权限控制：

1. 文件工具：`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`。
2. 命令工具：受控 `cmd`、受控 `powershell`。
3. MCP 工具：通过连接器配置加载，首版可先支持配置和部分本地 MCP。
4. 权限策略：按工作空间、工具类型、命令白名单和用户确认约束执行。
5. 审计日志：记录工具名、参数、输出摘要、退出码、审批记录和耗时。

#### Persistence Layer

负责本地持久化：

1. SQLite 保存结构化数据。
2. SQLite 保存任务运行状态、Agent 事件、工具调用日志和中断点元数据。
3. LangGraph checkpoint 保存可恢复的图状态。
4. 用户目录 `.anybuddy/mcp.json` 保存 MCP 配置。
5. 后续可扩展 `.anybuddy/settings.json` 保存用户偏好。

### 6.3 Renderer 与 IPC 分离原则

Renderer 和 IPC 必须作为两个独立层维护，不能让页面组件直接调用 `window.electron.ipcRenderer.invoke()` 这类底层 API。

依赖方向：

```text
React Page / Component
  -> Renderer Store / Hook
  -> Renderer API Client
  -> Preload Bridge
  -> IPC Controller
  -> Application Service
  -> Repository / Runtime / Native Adapter
```

禁止的依赖：

1. React 组件直接 import `electron`、`ipcRenderer`、Node `fs/path/child_process`。
2. React 组件直接写 IPC channel 字符串。
3. IPC handler 直接操作 React store。
4. IPC handler 中写复杂业务逻辑。
5. Repository 反向依赖 Service、IPC 或 Renderer 类型。
6. `src/shared` 放入带副作用的实现代码。

允许的依赖：

1. Renderer 可以依赖 `src/shared/types` 和 `src/shared/schemas`。
2. Renderer 可以依赖 `src/renderer/api` 中的客户端对象。
3. Preload 只暴露稳定的 `AnybuddyApi` 门面对象。
4. Main IPC Controller 可以依赖 Application Service。
5. Application Service 可以依赖 Repository、Policy、Runtime Gateway 和 Native Adapter。

### 6.4 面向对象分层设计

首版不把所有逻辑堆在函数文件里，而是按业务域组织对象。对象职责要小，构造函数只接收依赖，不在构造函数里做重型初始化。

推荐核心类：

1. `TaskService`：创建任务、更新任务、绑定工作空间、聚合任务状态。
2. `MessageService`：读取消息、追加消息、保存草稿、清理草稿。
3. `WorkspaceService`：创建工作空间、规范化路径、打开文件夹、查询空间任务。
4. `AgentRunService`：启动、暂停、恢复、取消任务运行，管理运行队列。
5. `IpcEventBus`：把 Agent 事件转换为 Renderer 可订阅事件。
6. `ToolSandboxService`：统一文件工具、命令工具、MCP 工具的权限入口。
7. `TaskRepository`、`MessageRepository`、`WorkspaceRepository`：封装 SQLite 查询。
8. `WorkspaceAccessPolicy`、`FileLockPolicy`、`CommandPolicy`：封装权限、锁和命令白名单判断。

对象设计规则：

1. 类之间通过构造函数注入依赖，避免在类内部直接 new 其他业务服务。
2. Service 返回 DTO，不返回数据库原始行。
3. Repository 不包含业务判断，只做查询、插入、更新和事务封装。
4. Policy 不访问 UI，不发送 IPC，只返回允许、拒绝或需要审批的判断结果。
5. IPC Controller 不暴露 Service 实例，只暴露受控方法。
6. Renderer API Client 不包含 UI 状态，只负责请求、订阅和错误转换。

示例调用链：

```text
TaskDetailPage
  -> useTaskStore.sendMessage(taskId, content)
  -> taskClient.sendMessage(taskId, payload)
  -> window.anybuddy.message.create(taskId, payload)
  -> MessageIpcController.create(event, taskId, payload)
  -> MessageService.createMessage(taskId, payload)
  -> MessageRepository.insert(message)
```

## 7. 技术栈选型

### 7.1 推荐技术栈

| 层级 | 推荐选型 | 理由 |
|---|---|---|
| 桌面壳 | Electron | 生态成熟，文件系统、窗口、菜单、更新、托盘等能力完整，适合快速做本地工作台 |
| 工程脚手架 | Electron Forge | 统一开发、打包、make、publish 流程，让 Electron 工程结构和发布链路更规范 |
| 构建工具 | Vite | 通过 Electron Forge 的 Vite 能力构建主进程、preload 和 Renderer |
| 前端框架 | React + TypeScript | React 生态成熟，适合拆分复杂工具型界面和可复用聊天组件 |
| 渲染模式 | 客户端渲染 CSR | 运行在 Electron Renderer 中，不需要服务端渲染，也不使用 Next.js SSR |
| UI 组件 | 自有 Design System + Headless/基础组件库，可选 Radix UI / Ariakit / React Aria，必要时局部使用 Ant Design 或 Arco | UI 不强制参照 AntD/Arco；组件库只提供无障碍、弹层、表单和复杂控件基础，视觉规范由 anybuddy 自有设计系统和设计 skills 产出 |
| 状态管理 | Zustand + Context | Zustand 管全局业务状态，Context 管稳定依赖和局部 UI 上下文 |
| 路由 | React Router | 管理新建任务、任务详情、专家页、设置页 |
| Agent 编排 | LangGraph | 管理多 Agent 状态图、长任务、checkpoint、streaming、interrupt 和恢复 |
| Agent Harness | Deep Agents | 复用任务规划、子 Agent、文件工具、权限、沙箱和 MCP 能力，减少自研工作量 |
| 后台执行 | Node Worker Thread 或独立子进程 | 避免长任务阻塞 Electron 主进程，便于暂停、取消和资源隔离 |
| 事件通道 | IPC streaming + SQLite event log | 将 token、工具调用、子 Agent 状态、中断请求和命令输出持续推送到 Renderer |
| 数据库 | SQLite | 本地优先、零服务依赖、适合任务和聊天记录 |
| SQLite ORM | Drizzle ORM 或 Kysely | 类型安全，迁移清晰，适合 TypeScript |
| 配置文件 | JSON + zod 校验 | MCP 配置需要可读可编辑，zod 可提供运行时校验 |
| IPC 类型 | 自定义 typed IPC 封装 | 避免 Renderer 随意调用主进程能力 |
| 代码编辑器 | Monaco Editor | 编辑 `mcp.json` 时体验接近代码编辑器 |
| 图标 | lucide-react | 图标覆盖常见操作，风格轻量统一 |
| 测试 | Vitest + React Testing Library + Playwright | 单测覆盖业务逻辑，E2E 覆盖关键页面流程 |
| 打包与分发 | Electron Forge Makers/Publishers | 通过 Forge 管理平台安装包、构建产物和后续发布流程 |

### 7.2 为什么可以采用 React

anybuddy 首版是典型工具型应用：大量弹窗、Popover、列表、表单、配置管理、聊天输入框和多区域状态联动。React + TypeScript 可以很好地承载这类复杂界面，尤其适合把聊天、选择器、任务列表、专家卡片、MCP 编辑器拆成可复用组件。

采用 React 是可行的，建议首版明确使用 React 技术栈，不再引入其他前端框架。原因是：

1. Electron Renderer 本质上就是一个本地 Web 前端，React 能完整覆盖 UI 需求。
2. React Router、Zustand、React Testing Library 生态成熟；UI 层可以按需要组合 Headless 组件、基础组件库和自研样式。
3. 聊天输入框、任务详情、专家/技能/连接器页都适合用 React 组件组合方式拆分。
4. 后续接入 Agent、MCP、SQLite、文件系统时，复杂度主要在主进程和本地服务层，React 不会成为限制。

因此前端统一采用 React、React Router、Zustand、Context、TypeScript 和 anybuddy 自有 Design System。Ant Design、Arco 或其他组件库只作为局部工程工具，不作为默认视觉参照。

### 7.3 Zustand 与 Context 的职责边界

Zustand 用于全局业务状态和跨页面共享状态，例如：

1. 当前任务、任务列表和任务筛选条件。
2. 当前聊天会话、消息草稿和发送状态。
3. 当前工作空间和工作空间列表。
4. 专家、技能、连接器列表。
5. 当前模型、模式、权限和已选技能。

Context 不作为主要全局状态管理工具，只用于低频变化、稳定引用或局部组件树上下文，例如：

1. ThemeContext：主题、紧凑模式、颜色偏好。
2. IpcClientContext：Renderer 调用主进程的 typed IPC client。
3. Toast/Dialog Context：全局提示、确认框入口。
4. ComposerContext：聊天输入框内部的局部组合上下文。

设计原则：

1. 高频变化状态不要放 Context，避免大范围重渲染。
2. 业务数据优先放 Zustand，并用 selector 精确订阅。
3. 页面内临时状态优先用 `useState` 或 `useReducer`。
4. 复杂派生数据通过 selector 或 memoized selector 计算。

### 7.4 为什么不做服务端渲染

anybuddy 是桌面应用，不是公开 Web 站点。首版不需要 SEO，也没有首屏内容被搜索引擎抓取的需求。应用启动后由 Electron 加载本地 HTML、CSS 和 JavaScript，再由 React 在 Renderer 中完成客户端渲染即可。

不推荐 Next.js SSR 或其他服务端渲染方案，原因是：

1. SSR 需要 Node 服务端运行时，会增加桌面应用启动、打包和调试复杂度。
2. anybuddy 的主要数据来自本地 SQLite、用户目录配置和 IPC API，天然适合客户端按需读取。
3. 桌面应用的首屏性能主要取决于包体、初始化逻辑和本地数据库访问，不需要通过 SSR 优化。
4. SSR 会让 Electron 主进程、Renderer、服务端运行时之间的边界变复杂，首版收益不明显。

结论：首版使用 `React + Vite` 构建单页应用，运行在 Electron Renderer 中，采用客户端渲染。

### 7.5 为什么使用 LangGraph / Deep Agents

首版需要的 Agent 能力已经超过简单聊天循环：多 Agent 协作、后台长任务、流式中间输出、人工介入、打断恢复、工具调用审计和本地文件/命令工具。如果完全自研，需要自己实现状态机、checkpoint、事件流、子 Agent 隔离和中断恢复，成本和风险都高。

推荐采用：

1. LangGraph 作为底层 Agent Orchestration Runtime，负责状态图、长任务、持久化、streaming、interrupt 和恢复。
2. Deep Agents 作为上层 Agent Harness，优先复用它的任务规划、subagents、文件工具、权限、沙箱、MCP 和 streaming 能力。
3. LangChain 作为模型和工具集成层，负责模型适配、工具定义和 MCP 工具接入。

落地策略：

1. 首版优先使用 LangGraph JS/TS，和 Electron + Node 环境保持同一语言栈。
2. 如果 Deep Agents 的 JS 能力覆盖足够，直接基于 Deep Agents 实现主 Agent 和子 Agent。
3. 如果 Deep Agents 某些能力不满足桌面本地权限模型，则用 LangGraph 自定义图实现，并只复用 LangChain 工具抽象。
4. 不直接让 LLM 调用裸 Node API，所有文件和命令能力都必须经过 Tool Sandbox Layer。

### 7.6 为什么推荐 Electron 而不是 Tauri

Tauri 体积更小，但 anybuddy 后续大概率会扩展到本地文件、MCP、模型、Agent Runtime、自动更新、托盘、系统交互等能力。Electron 的成熟度、社区方案和调试便利性更适合首版快速验证。等产品方向稳定后，再评估 Tauri 降体积。

### 7.7 为什么使用 SQLite

首版数据以任务、消息、工作空间、专家、技能、连接器、Agent 运行状态、事件流、工具调用日志为主，都是结构化数据。SQLite 不需要部署服务，适合桌面本地应用。相比 LocalStorage 或 JSON 文件，SQLite 更适合搜索、筛选、分页、迁移、恢复和审计日志。

### 7.8 可替代方案

#### 方案 A：Electron + React + SQLite

推荐方案。开发效率高，桌面能力成熟，适合 4-6 周 MVP。

#### 方案 B：Tauri + React + SQLite

体积小，性能好，但 Rust 和桌面能力集成成本更高。适合二期重构或对安装包体积极敏感时再考虑。

#### 方案 C：Electron + React + 本地 JSON 文件

工程更简单，但任务、消息、搜索、筛选、分页和迁移都会变弱。只适合极早期原型，不建议作为正式 MVP 的数据方案。

### 7.9 Electron Forge 工程规范

首版建议使用 Electron Forge 作为 Electron 工程脚手架和构建分发入口。Forge 可以统一管理开发启动、主进程构建、preload 构建、Renderer 构建、安装包生成和后续发布流程，避免单独拼接 Vite、Electron、打包工具导致配置分散。

推荐初始化方向：

```bash
npm create electron-app@latest anybuddy -- --template=vite-typescript
```

在 Forge Vite + TypeScript 模板基础上接入 React、React Router、Zustand、SQLite 和 UI 组件库。

推荐目录结构：

```text
anybuddy
├── forge.config.ts
├── package.json
├── src
│   ├── main
│   │   ├── index.ts
│   │   ├── composition
│   │   │   └── container.ts
│   │   ├── ipc
│   │   │   ├── controllers
│   │   │   └── registerIpcHandlers.ts
│   │   ├── services
│   │   ├── repositories
│   │   ├── policies
│   │   ├── runtime
│   │   ├── adapters
│   │   └── window
│   ├── preload
│   │   ├── index.ts
│   │   └── bridge.ts
│   ├── renderer
│   │   ├── api
│   │   ├── app
│   │   ├── components
│   │   ├── pages
│   │   ├── routes
│   │   ├── stores
│   │   ├── contexts
│   │   └── styles
│   ├── shared
│   │   ├── types
│   │   ├── schemas
│   │   ├── ipc
│   │   └── constants
│   └── db
│       ├── schema
│       └── migrations
└── tests
    ├── unit
    └── e2e
```

分层原则：

1. `src/main`：只放 Electron 主进程、窗口管理、系统能力、IPC handler 和本地服务。
2. `src/preload`：只暴露经过白名单控制的 typed IPC API，不泄漏 Node 全局能力。
3. `src/renderer`：只放 React UI、路由、Zustand store、Context 和样式。
4. `src/shared`：放主进程和 Renderer 都需要的类型、zod schema、枚举和常量。
5. `src/db`：放 SQLite schema、迁移和数据库访问封装。

目录职责补充：

1. `src/renderer/api`：Renderer 侧业务客户端，例如 `TaskClient`、`MessageClient`、`WorkspaceClient`，负责调用 preload 暴露的 API。
2. `src/preload/bridge.ts`：把 `ipcRenderer.invoke/on/off` 包装成稳定的 `window.anybuddy` 门面。
3. `src/shared/ipc`：定义 channel 常量、请求类型、响应类型和事件类型，是 Renderer 与 Main 的唯一协议来源。
4. `src/main/ipc/controllers`：每个业务域一个 Controller，例如 `TaskIpcController`，只做 schema 校验、调用 Service、返回 DTO。
5. `src/main/composition/container.ts`：集中创建 Repository、Policy、Service、Controller，避免在各文件里散落 `new`。
6. `src/main/services`：应用服务层，承载业务流程。
7. `src/main/repositories`：数据库访问层，只处理 SQLite 查询和事务。
8. `src/main/policies`：权限、安全、并发、文件锁和命令白名单规则。
9. `src/main/adapters`：文件系统、系统对话框、shell、环境变量等外部能力适配器。
10. `src/main/runtime`：Agent Runtime、任务队列、事件总线和 Worker 管理。

推荐 npm scripts：

```json
{
  "start": "electron-forge start",
  "package": "electron-forge package",
  "make": "electron-forge make",
  "publish": "electron-forge publish",
  "lint": "eslint .",
  "test": "vitest",
  "test:e2e": "playwright test"
}
```

Windows 首版 Makers 建议优先配置 Squirrel 或 ZIP；后续需要正式发布时再补代码签名、自动更新和 GitHub Publisher。

## 8. 数据模型设计

### 8.1 Task

```ts
type Task = {
  id: string
  title: string
  mode: 'ask' | 'plan' | 'craft'
  modelId: string
  expertId?: string
  primaryWorkspaceId?: string
  permissionMode: 'default' | 'full_access'
  connectorIds: string[]
  skillIds: string[]
  status: 'idle' | 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
  unreadEventCount: number
  lastRunId?: string
  createdAt: string
  updatedAt: string
}
```

说明：

1. `primaryWorkspaceId` 是任务默认归属和默认执行目录。
2. 多工作空间任务通过 `TaskWorkspace` 表表达，不能只靠 `Task.primaryWorkspaceId`。
3. `status` 是任务级汇总状态，由最新的 `AgentRun`、审批请求和错误事件聚合得到，方便 Sidebar 快速渲染。
4. `unreadEventCount` 用于后台任务提醒，用户进入任务详情页后清零。

### 8.1.1 TaskWorkspace

```ts
type TaskWorkspace = {
  id: string
  taskId: string
  workspaceId: string
  role: 'primary' | 'attached'
  accessMode: 'read_only' | 'read_write'
  addedAt: string
}
```

说明：

1. 一个任务必须且只能有一个 `role = 'primary'` 的工作空间。
2. 一个任务可以有多个 `role = 'attached'` 的关联工作空间。
3. `accessMode` 控制 Agent 对该工作空间的默认能力；关联工作空间建议默认 `read_only`。
4. 文件工具和命令工具执行时，需要同时校验 `taskId`、`workspaceId` 和 `accessMode`。

### 8.2 Message

```ts
type Message = {
  id: string
  taskId: string
  runId?: string
  workspaceId?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
}
```

说明：

1. `workspaceId` 用于标记消息引用或产出主要来自哪个工作空间。
2. 多工作空间回答中，Agent 应在 `metadata.sources` 中记录引用路径和工作空间 ID。
3. `runId` 用于把消息和某一次后台运行关联起来，便于回放和排查。

### 8.3 Expert

```ts
type Expert = {
  id: string
  name: string
  description: string
  avatar?: string
  specialties: string[]
  systemPrompt: string
  defaultMode: 'ask' | 'plan' | 'craft'
  defaultModelId?: string
  defaultSkillIds: string[]
  defaultConnectorIds: string[]
  source: 'builtin' | 'custom'
  createdAt: string
  updatedAt: string
}
```

### 8.4 Skill

```ts
type Skill = {
  id: string
  name: string
  description: string
  instruction: string
  tags: string[]
  source: 'builtin' | 'local' | 'generated'
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

### 8.5 Connector

```ts
type Connector = {
  id: string
  name: string
  type: 'wechat' | 'dingtalk' | 'mcp' | 'custom'
  description?: string
  enabled: boolean
  configPath?: string
  config?: Record<string, unknown>
  source: 'builtin' | 'custom'
  createdAt: string
  updatedAt: string
}
```

### 8.6 Workspace

```ts
type Workspace = {
  id: string
  name: string
  path: string
  icon?: string
  defaultPermissionMode: 'read_only' | 'read_write'
  isArchived: boolean
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}
```

说明：

1. `path` 需要规范化保存，Windows 下统一处理大小写、盘符和尾部分隔符。
2. `isArchived` 表示从空间列表隐藏，但不删除历史任务关联。
3. 工作空间被移除时，不删除任务，只解除后续默认入口；历史任务仍保留空间名称和路径快照。

### 8.7 ModelConfig

```ts
type ModelConfig = {
  id: string
  name: string
  provider: 'builtin' | 'openai_compatible' | 'custom'
  baseUrl?: string
  apiKeyRef?: string
  modelName: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
```

### 8.8 AgentRun

```ts
type AgentRun = {
  id: string
  taskId: string
  workspaceIds: string[]
  parentRunId?: string
  agentId: string
  agentName: string
  kind: 'main' | 'subagent'
  status: 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
  graphThreadId: string
  checkpointId?: string
  currentNode?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}
```

说明：

1. `workspaceIds` 记录本次运行实际可访问的工作空间集合。
2. 同一个任务可以多次运行，每次运行的工作空间集合可能不同。
3. 子 Agent 继承主 Agent 的工作空间集合，但可以被限制到其中一个工作空间。

### 8.9 AgentEvent

```ts
type AgentEvent = {
  id: string
  taskId: string
  runId: string
  parentRunId?: string
  type:
    | 'run_started'
    | 'run_status'
    | 'llm_token'
    | 'agent_message'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_end'
    | 'tool_error'
    | 'subagent_started'
    | 'subagent_event'
    | 'interrupt_requested'
    | 'interrupt_resolved'
    | 'run_completed'
    | 'run_failed'
  payload: Record<string, unknown>
  createdAt: string
}
```

### 8.10 ToolCall

```ts
type ToolCall = {
  id: string
  taskId: string
  runId: string
  workspaceId?: string
  toolName: string
  toolType: 'file' | 'command' | 'powershell' | 'mcp' | 'custom'
  args: Record<string, unknown>
  status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled'
  outputPreview?: string
  exitCode?: number
  approvalId?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}
```

### 8.11 ToolDefinition

```ts
type ToolDefinition = {
  name: string
  displayName: string
  description: string
  category:
    | 'file'
    | 'search'
    | 'command'
    | 'task'
    | 'agent'
    | 'skill'
    | 'mcp'
    | 'web'
    | 'notification'
    | 'workflow'
  source: 'builtin' | 'mcp' | 'skill' | 'connector'
  inputSchema: Record<string, unknown>
  riskLevel: 'read_only' | 'workspace_write' | 'command' | 'network' | 'external_side_effect' | 'system'
  requiredPermission: 'auto' | 'approval_required' | 'blocked_by_default'
  workspaceScope: 'none' | 'primary' | 'attached' | 'any_authorized'
  supportsDryRun: boolean
  enabled: boolean
}
```

说明：

1. Built-in tools、MCP tools 和由 skill 暴露的工作流能力都需要统一映射为 `ToolDefinition`。
2. `riskLevel` 和 `requiredPermission` 决定工具是否自动执行、请求审批或默认禁用。
3. `workspaceScope` 决定工具是否必须携带 `workspaceId`。
4. `inputSchema` 使用 zod 或 JSON Schema 表达，供 ToolRegistry 校验参数。

### 8.12 TaskDraft

```ts
type TaskDraft = {
  taskId: string
  content: string
  selectedSkillIds: string[]
  selectedConnectorIds: string[]
  updatedAt: string
}
```

说明：

1. 每个任务单独保存输入草稿，用户切换任务后不丢失未发送内容。
2. 新建任务页使用临时草稿；第一条消息发送并创建任务后再绑定真实 `taskId`。

### 8.13 FileOperationLock

```ts
type FileOperationLock = {
  id: string
  workspaceId: string
  normalizedPath: string
  taskId: string
  runId: string
  operation: 'write' | 'edit' | 'delete' | 'command_write'
  status: 'active' | 'released' | 'expired'
  expiresAt: string
  createdAt: string
}
```

说明：

1. 多任务并行时，同一文件的写入、编辑、删除需要互斥。
2. 只读操作不加锁。
3. 锁超时后自动释放，并在事件流中记录。
4. 发生冲突时，新工具调用进入等待审批或失败状态，由用户决定是否继续。

### 8.14 HumanApproval

```ts
type HumanApproval = {
  id: string
  taskId: string
  runId: string
  toolCallId?: string
  reason: string
  originalArgs?: Record<string, unknown>
  editedArgs?: Record<string, unknown>
  decision: 'pending' | 'approved' | 'rejected' | 'edited' | 'cancelled'
  decidedAt?: string
  createdAt: string
}
```

## 9. IPC API 设计

Renderer 只调用受控 API，不直接访问 Node 能力。

### 9.1 任务 API

```ts
task.list(filter)
task.search(query, filter)
task.get(taskId)
task.create(payload)
task.update(taskId, patch)
task.delete(taskId)
task.attachWorkspace(taskId, workspaceId, options)
task.detachWorkspace(taskId, workspaceId)
task.setPrimaryWorkspace(taskId, workspaceId)
task.markRead(taskId)
task.listRunning()
```

任务过滤条件需要支持：

```ts
type TaskFilter = {
  workspaceId?: string
  status?: Task['status'][]
  timeRange?: 'all' | 'today' | 'last_7_days' | 'last_30_days'
  keyword?: string
}
```

### 9.2 消息 API

```ts
message.list(taskId)
message.create(taskId, payload)
message.delete(messageId)
message.saveDraft(taskId, payload)
message.getDraft(taskId)
message.clearDraft(taskId)
```

### 9.3 工作空间 API

```ts
workspace.list()
workspace.pickFolder()
workspace.createFromPath(path)
workspace.remove(workspaceId)
workspace.openFolder(workspaceId)
workspace.listTasks(workspaceId, filter?)
workspace.setDefault(workspaceId)
```

### 9.4 专家、技能、连接器 API

```ts
expert.list()
expert.create(payload)
expert.update(id, patch)
expert.delete(id)

skill.list()
skill.importFromPath(path)
skill.create(payload)
skill.update(id, patch)
skill.delete(id)

connector.list()
connector.update(id, patch)
connector.readMcpConfig()
connector.validateMcpConfig(content)
connector.saveMcpConfig(content)
```

### 9.5 Agent 执行 API

```ts
agentRun.start(taskId, payload)
agentRun.pause(runId)
agentRun.resume(runId, payload?)
agentRun.cancel(runId)
agentRun.get(runId)
agentRun.listByTask(taskId)
agentRun.listActive()
agentRun.subscribeEvents(taskId)
agentRun.subscribeAllActiveEvents()
agentRun.approve(approvalId, decision, editedArgs?)
```

事件订阅通过 IPC streaming 从主进程推送到 Renderer。Renderer 收到事件后写入 Zustand 中的当前任务视图，同时主进程将事件追加到 SQLite，保证页面切换或应用重启后可以恢复任务时间线。

多任务订阅策略：

1. 当前打开任务使用 `agentRun.subscribeEvents(taskId)` 订阅完整事件流。
2. Sidebar 和全局状态栏使用 `agentRun.subscribeAllActiveEvents()` 订阅轻量事件，只包含任务状态、未读计数、等待审批和错误摘要。
3. Renderer 不保存全部后台任务 token 流，只保存当前任务的实时 token；其他任务依赖 SQLite event log 恢复。
4. 应用启动时调用 `agentRun.listActive()` 恢复运行中、暂停中和等待审批的任务状态。

### 9.6 Typed IPC 协议设计

IPC 协议统一放在 `src/shared/ipc`，Renderer、preload 和 main 都从这里引用类型和 channel 常量，禁止各层手写字符串。

```ts
type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError }

type IpcError = {
  code:
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'CONFLICT'
    | 'AGENT_BUSY'
    | 'INTERNAL_ERROR'
  message: string
  details?: Record<string, unknown>
}
```

协议设计规则：

1. 所有 IPC 请求必须有 zod schema 校验。
2. 所有 IPC 返回值必须包在 `IpcResult<T>` 中，不能直接抛原始异常给 Renderer。
3. IPC channel 命名使用 `domain:action`，例如 `task:create`、`workspace:listTasks`、`agentRun:subscribeEvents`。
4. Renderer API Client 将 `IpcResult<T>` 转成业务层可用结果或受控错误。
5. IPC Controller 捕获异常后转换为 `IpcError`，并写入主进程日志。
6. 订阅类 API 必须返回取消订阅函数，避免页面切换后事件泄漏。

### 9.7 Renderer API Client 设计

Renderer 侧为每个业务域创建一个 Client 类。组件和 Zustand store 只依赖 Client，不依赖 preload 的具体结构。

```ts
class TaskClient {
  constructor(private readonly api: AnybuddyApi) {}

  async list(filter: TaskFilter): Promise<TaskSummary[]> {
    const result = await this.api.task.list(filter)
    if (!result.ok) throw mapIpcError(result.error)
    return result.data
  }
}
```

设计要求：

1. Client 只做请求封装、错误转换和订阅管理。
2. Client 不保存 UI 状态，不操作 Zustand store。
3. Store 负责组合多个 Client 调用并更新页面状态。
4. React 组件优先调用 Store action，不直接调用 Client；只有非常薄的页面初始化逻辑可以直接调用 Client。
5. 单元测试中可以用 mock Client 替代真实 IPC，保证 Renderer 测试不依赖 Electron。

### 9.8 Main IPC Controller 设计

Main 侧为每个业务域创建一个 Controller 类。Controller 是 IPC 协议层，不是业务层。

```ts
class TaskIpcController {
  constructor(private readonly taskService: TaskService) {}

  register(registry: IpcRegistry): void {
    registry.handle('task:list', this.list)
    registry.handle('task:create', this.create)
  }

  private list = async (payload: unknown): Promise<IpcResult<TaskSummary[]>> => {
    const input = TaskListSchema.parse(payload)
    const tasks = await this.taskService.list(input)
    return { ok: true, data: tasks }
  }
}
```

设计要求：

1. Controller 方法必须是薄方法，只做校验、调用 Service、返回 DTO。
2. Controller 不直接 import Repository。
3. Controller 不直接访问 `BrowserWindow`，事件推送统一通过 `IpcEventBus`。
4. Controller 不处理 React 语义，例如当前页面、弹窗、选中状态。
5. Controller 层错误统一经过 `toIpcError()` 转换。

## 10. 安全设计

### 10.1 首版安全边界

1. Renderer 禁用 Node Integration。
2. 启用 Context Isolation。
3. 所有本地能力通过 preload 暴露有限 API。
4. 文件夹选择必须由用户主动触发。
5. MCP 配置保存前必须做 JSON 格式校验。
6. 文件和命令工具只能在用户选择的工作空间或显式授权路径内运行。
7. 写文件、编辑文件、执行命令、调用外部连接器默认触发 Human-in-the-Loop 审批。
8. 命令执行必须经过白名单、参数校验、超时限制和输出截断。
9. 多工作空间任务中，每次工具调用必须携带 `workspaceId`，不能只传相对路径。
10. 关联工作空间默认只读；升级为可写需要用户显式确认。
11. `web_search` 默认关闭，用户首次使用或在设置中开启后才可调用。
12. 网络检索需要记录查询词、时间、结果 URL、调用任务和触发 Agent，便于审计。

### 10.2 权限模式设计

首版权限需要真实生效：

1. 默认权限：只能访问用户显式选择的工作空间和上传文件。
2. 完全访问权限：允许访问用户额外授权的本地路径，但仍需要敏感操作审批。

首版权限策略：

1. 工具调用前确认。
2. 文件访问范围限制。
3. 命令执行白名单。
4. 敏感操作二次确认。
5. 工具调用日志。
6. 工作空间级权限隔离。
7. 多任务写入冲突检测。
8. 网络访问开关和域名级限制。

### 10.3 Agent 内置 Tools 设计

Agent 自带 tools 参考 Claude Code 的工具体系，但不照搬命名和权限模型。Claude Code 官方 tools reference 中包含 `Agent`、`Bash`、`PowerShell`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`LSP`、`Monitor`、`WebFetch`、`WebSearch`、`Skill`、任务管理、MCP 资源读取等工具。anybuddy 首版按桌面工作台、多工作空间和安全审批需求重新分层。

#### 首版必备 Tools

文件与搜索：

1. `read_file`：读取文件内容，默认带行号，支持 `offset` 和 `limit` 分页。
2. `list_dir`：列出目录内容，只允许在任务绑定工作空间内运行。
3. `glob_files`：按 glob pattern 查找文件，结果需要限制数量并提示是否截断。
4. `grep_text`：基于 ripgrep 或等价实现搜索文件内容，支持按文件类型、glob 和大小限制过滤。
5. `write_file`：创建新文件或覆盖完整文件。覆盖已有文件前必须先读过该文件，并触发审批。
6. `edit_file`：精确字符串替换编辑文件。必须满足读前编辑、唯一匹配或显式 `replace_all`，并触发审批。

命令执行：

1. `run_cmd`：执行 Windows cmd 命令。
2. `run_powershell`：执行 PowerShell 命令，Windows 首版优先支持。
3. `monitor_command`：启动后台命令并持续采集输出，例如 dev server、测试 watch、日志 tail。首版可以先做只读输出监控，不允许 monitor 自行写文件。

任务与计划：

1. `create_task_item`：创建任务执行清单项。
2. `update_task_item`：更新清单状态、依赖和说明。
3. `list_task_items`：读取当前任务清单。
4. `enter_plan_mode`：进入计划模式，只允许分析和产出计划，不允许写文件或执行命令。
5. `exit_plan_mode`：提交计划给用户确认，确认后才允许进入执行。

Agent 协作：

1. `spawn_subagent`：启动子 Agent 执行独立子任务。
2. `send_subagent_message`：给运行中的子 Agent 追加指令。
3. `stop_subagent`：停止子 Agent。
4. `list_agent_runs`：列出当前任务下主 Agent 和子 Agent 的运行状态。

上下文与能力：

1. `use_skill`：调用已安装 skill。Skill 本身不是新工具能力，而是对已有工具和提示流程的封装。
2. `list_mcp_resources`：列出已连接 MCP server 暴露的资源。
3. `read_mcp_resource`：读取指定 MCP resource。
4. `wait_for_connector`：等待 MCP/连接器启动或连接完成。

网络检索：

1. `web_search`：联网搜索公开网页信息，返回标题、摘要、URL 和来源时间信息。默认需要用户开启网络能力；首版不直接抓取完整网页正文。

通知与用户确认：

1. `ask_user`：向用户提出结构化澄清或审批问题。
2. `request_approval`：对敏感工具调用发起审批，支持批准、拒绝、修改参数后继续。
3. `notify_user`：长任务完成、失败或等待审批时推送桌面通知。

#### 二期增强 Tools

1. `lsp_query`：代码智能工具，支持跳转定义、查找引用、获取类型、列出符号、读取诊断。
2. `notebook_edit`：编辑 Jupyter Notebook cell。
3. `web_fetch`：抓取指定 URL 并提取内容，需要域名级权限。
4. `open_artifact`：把 Markdown、HTML、报告、图表作为可预览产物展示。
5. `create_worktree`、`enter_worktree`、`exit_worktree`：为高风险代码修改创建隔离工作树。
6. `workflow_run`：运行预定义多 Agent workflow，返回汇总结果。
7. `schedule_task`：一次性或周期性计划任务，适合定时检查、定时报表和提醒。

#### 首版暂不内置 Tools

1. 不内置无限制浏览器自动化。
2. 不内置真实微信、钉钉深度自动化执行，只做连接器配置。
3. 不内置系统级控制工具，例如修改注册表、安装驱动、管理系统服务。
4. 不内置跨工作空间自动批量移动或删除文件；如确需执行，必须走明确审批和文件锁。
5. 不内置绕过审批的 `bypass_permissions` 模式。

#### Tool 设计规则

1. 每个 tool 必须声明 `name`、`description`、`inputSchema`、`riskLevel`、`requiredPermission`、`workspaceScope`、`supportsDryRun`。
2. 每个 tool 调用必须生成 `ToolCall` 记录，并写入事件流。
3. 每个 tool 必须接收结构化参数，禁止让 LLM 拼接宿主 shell 字符串绕过策略。
4. 只读 tool 默认可自动执行，但仍受工作空间和敏感文件 deny 规则限制。
5. 写入、删除、命令执行、外部连接器、网络访问默认进入 Human-in-the-Loop。
6. 子 Agent 的 tool 集合可以被收窄；默认不允许子 Agent 获得比主 Agent 更高的权限。
7. Skill 只能组合现有 tools，不能绕过 Tool Sandbox Layer 新增隐式能力。
8. MCP tools 进入系统前必须映射为统一 `ToolDefinition`，并标记来源 server、权限等级和审计字段。

命令工具首版限制：

1. 默认只能在当前工作空间目录运行。
2. 默认允许只读命令，例如 `dir`、`type`、`where`、`git status`、`git diff`、`npm test`、`npm run test`。
3. 写入、删除、安装依赖、网络请求、启动服务、移动文件等命令必须用户审批。
4. 高危命令默认拒绝，例如递归删除、格式化磁盘、修改系统目录、修改用户全局配置。
5. 每次命令执行必须设置超时时间、最大输出长度、退出码记录和审计日志。
6. PowerShell 脚本必须作为结构化参数传递，不允许 LLM 拼接任意宿主 shell 命令绕过策略。

网络工具首版限制：

1. `web_search` 只返回搜索结果元数据和摘要，不直接下载网页正文。
2. 默认每个任务最多连续调用 8 次 `web_search`，超过后需要用户确认。
3. 支持 `allowedDomains` 和 `blockedDomains`，但二者不能在同一次调用中混用。
4. 搜索结果进入 Agent 上下文前需要标记来源 URL 和检索时间。
5. 不允许通过 `web_search` 访问本地网络地址、内网 IP、localhost 或文件协议。
6. 如果用户关闭网络能力，Agent 必须说明无法联网，并改用本地资料或请求用户提供链接内容。

### 10.4 Background Execution 与打断策略

1. Agent 运行在 Worker Thread 或独立子进程，不阻塞 Electron 主进程。
2. 每个后台任务都有 `AgentRun` 记录和 LangGraph `thread_id`。
3. 每个关键节点写入 checkpoint，应用重启后可恢复到最近可恢复点。
4. 用户点击暂停时，运行时在下一个安全中断点暂停。
5. 用户点击取消时，运行时终止当前 Worker，并把任务标记为 `cancelled`。
6. 用户追加指令时，追加内容写入任务事件流，并通过 LangGraph resume 机制继续执行。

### 10.5 多任务并发控制

首版允许多个任务并行，但需要控制资源和冲突：

1. 默认最多同时运行 2 个 Agent 任务，其余任务进入 `queued`。
2. 用户可以在设置中调整最大并发数，但首版建议上限不超过 4。
3. 每个运行任务独立 Worker、独立 LangGraph thread、独立事件流。
4. 同一工作空间允许多个只读任务并发。
5. 同一工作空间出现写入、编辑、删除或命令写入时，需要通过 `FileOperationLock` 检查文件级冲突。
6. 同一文件已有活动写锁时，新的写操作默认暂停并提示用户处理。
7. 任务取消或失败时，必须释放该任务持有的文件操作锁。
8. 应用退出前提示仍在运行或等待审批的任务，支持继续后台保存状态或全部暂停。

### 10.6 多工作空间工具调用策略

1. 文件路径在进入工具层前必须解析为 `{ workspaceId, relativePath, absolutePath }`。
2. Agent 面向用户展示路径时优先使用 `workspaceName:relative/path` 格式。
3. 跨工作空间复制、移动或同步文件属于敏感操作，必须审批。
4. 命令工具一次只能在一个工作空间目录中执行，不允许单次命令跨多个工作目录。
5. 需要跨工作空间分析时，由 Agent 分多次只读工具调用完成，再汇总结果。
6. 写入关联工作空间前，如果该空间仍是 `read_only`，系统必须先请求用户升级权限。

## 11. UI 设计原则

### 11.1 视觉方向

anybuddy 是个人工作台，不是营销网站。界面应偏工具型、安静、清晰、信息密度适中。避免大面积装饰性渐变和营销式卡片堆叠。

UI 设计不默认模仿 Ant Design、Arco、Notion、Linear 或其他现成产品。首版可以借用成熟组件库的交互基础，但视觉语言、布局密度、状态表达和组件组合应沉淀为 anybuddy 自己的 Design System。

设计关键词：

1. 本地工作台：明确文件、工作空间、任务和执行状态的关系。
2. 多任务并行：运行中、等待审批、失败、完成等状态需要可扫描。
3. Agent 透明度：工具调用、子 Agent、审批和中间产物要有清晰层级。
4. 低干扰：不使用营销式大 Hero、夸张装饰和无意义动效。
5. 专业感：字体、间距、边框、阴影、状态色和空状态都需要统一规范。

### 11.2 UI Skills 设计工作流

UI 设计可以按页面或模块调用对应的设计 skills，而不是直接套 AntD/Arco 默认风格。

适用方式：

1. 做主工作台、任务详情、专家页等核心界面时，先调用前端设计类 skill 输出设计方向、布局密度、组件层级和状态表达。
2. 做已有页面重构时，调用 redesign 类 skill 做审查和升级建议。
3. 做高保真视觉探索时，可以调用 imagegen/frontend-web 类 skill 生成参考图，再转为实际 React 组件和 Design Token。
4. 做偏工具型、控制台型界面时，可以选择 minimalist、industrial-brutalist 或其他合适风格 skill，但必须服从 anybuddy 的产品定位。
5. 每次 skill 输出不能直接当最终规范，必须整理为可执行的 Design Token、组件 API 和页面布局规则。

输出要求：

1. 每个核心页面应先有页面设计说明，再进入实现。
2. 设计说明至少包含：信息层级、布局区域、交互状态、空状态、错误状态、加载状态、响应式规则。
3. 视觉方案应沉淀为 `src/renderer/styles/tokens.css` 和组件级样式规则。
4. 不允许把多个组件库默认样式混用成拼贴感界面。
5. 如果使用 AntD/Arco，只使用必要控件能力，并覆盖为 anybuddy 自有视觉。

### 11.3 组件库策略

组件库选择按能力而不是按默认样式：

1. 弹层、Popover、Dialog、Dropdown、Tooltip：优先 Headless 或无样式基础组件，方便自定义视觉。
2. 表单、校验、复杂输入：可以使用成熟库，但样式需要和 Design Token 对齐。
3. Tree、Table、Virtual List 等复杂控件：可局部使用 AntD、Arco 或 TanStack 生态，但必须封装在 `src/renderer/components/base` 或业务组件内部。
4. 图标统一使用 `lucide-react` 或自有图标封装，不直接混用多个图标库。
5. 业务组件不直接暴露第三方组件类型，避免未来替换组件库成本过高。

封装原则：

1. 第三方组件只能出现在 Base Component 层或少量页面级复杂控件中。
2. 业务页面使用 `AnyDialog`、`AnyPopover`、`AnyTabs`、`AnyTree`、`AnyButton` 这类内部组件。
3. 组件 props 使用业务语义，不透传大量第三方组件参数。
4. 自有组件必须支持键盘操作、焦点状态、禁用状态、加载状态和错误状态。
5. 视觉变更优先通过 Design Token 完成，而不是在页面里写零散样式。

### 11.4 组件原则

1. 图标按钮用于收起、搜索、筛选、添加、发送、更多操作。
2. Modal 用于任务搜索。
3. Popover 用于轻量选择：模式、模型、技能、连接器、筛选、工作空间。
4. Tabs 用于专家、技能、连接器切换。
5. 折叠面板用于任务和空间区域。
6. 聊天输入框作为核心复用组件。

### 11.5 关键复用组件

1. `AppSidebar`
2. `SidebarHeader`
3. `TaskSearchModal`
4. `TaskFilterPopover`
5. `UserMenu`
6. `ChatPanel`
7. `ChatComposer`
8. `ModeSelector`
9. `ModelSelector`
10. `SkillSelector`
11. `ConnectorSelector`
12. `PermissionIndicator`
13. `WorkspaceSelector`
14. `ExpertTabsPage`
15. `McpConfigEditor`

## 12. 开发里程碑

### 第 1 阶段：基础工程和主界面

目标：搭建桌面应用骨架和主布局。

交付：

1. Electron Forge + React + TypeScript 工程。
2. 主窗口和路由。
3. Sidebar。
4. 新建任务页和任务详情页空壳。
5. 专家页空壳。

### 第 2 阶段：本地数据和任务聊天

目标：任务、消息和工作空间可本地保存。

交付：

1. SQLite 初始化和迁移。
2. Task、Message、Workspace 表。
3. 新建任务。
4. 发送消息。
5. 任务列表。
6. 任务详情。
7. 工作空间选择和保存。
8. TaskWorkspace 关联表。
9. 多任务输入草稿隔离。
10. 按工作空间查看关联任务。

### 第 3 阶段：专家、技能、连接器

目标：完成核心能力管理界面。

交付：

1. 专家 Tab。
2. 技能 Tab。
3. 连接器 Tab。
4. 内置专家、技能、连接器 seed 数据。
5. MCP JSON 编辑器。
6. JSON 校验和保存。

### 第 4 阶段：搜索、筛选和交互打磨

目标：让主流程可用。

交付：

1. 搜索任务 Modal。
2. 任务时间筛选。
3. Sidebar 折叠。
4. 用户菜单。
5. 空间折叠和更多菜单。
6. 空状态、加载态、错误态。

### 第 5 阶段：LLM 和 Agent 预留接口

目标：为后续真实 Agent 能力铺好接口。

交付：

1. ModelConfig 数据结构。
2. 模型选择器。
3. 自定义模型表单。
4. ChatService 抽象。
5. AgentRuntime 接口定义。
6. ToolRegistry 接口定义。

### 第 6 阶段：多任务和多工作空间执行闭环

目标：让多个任务可以在多个工作空间中并行对话和后台运行。

交付：

1. 后台任务队列和最大并发控制。
2. 运行中任务状态栏或筛选视图。
3. 全局活动事件订阅。
4. 任务级未读事件和等待审批提醒。
5. 多工作空间任务上下文。
6. 文件操作锁和写入冲突提示。
7. 应用重启后的任务状态恢复。

## 13. 测试策略

### 13.1 单元测试

覆盖：

1. 任务筛选。
2. 任务搜索。
3. MCP JSON 校验。
4. 数据模型转换。
5. 权限模式判断。
6. TaskWorkspace 主工作空间唯一性。
7. 多任务草稿隔离。
8. 文件操作锁冲突判断。
9. 任务状态聚合。
10. Renderer API Client 错误转换。
11. IPC Controller 参数校验和错误映射。
12. `web_search` 网络开关、域名过滤和调用次数限制。
13. `web_search` 审计日志字段完整性。

### 13.2 组件测试

覆盖：

1. ChatComposer。
2. TaskSearchModal。
3. WorkspaceSelector。
4. ExpertTabsPage。
5. McpConfigEditor。
6. 多工作空间选择器。
7. Sidebar 运行中任务和等待审批标记。

### 13.3 E2E 测试

覆盖关键路径：

1. 创建任务。
2. 发送消息。
3. 搜索任务并进入详情。
4. 添加工作空间。
5. 打开专家页。
6. 编辑并保存 MCP 配置。
7. 创建一个绑定多个工作空间的任务。
8. 同时启动两个任务并在任务间切换。
9. 后台任务进入等待审批后从 Sidebar 回到任务详情。
10. 两个任务尝试写入同一文件时出现冲突提示。
11. 首次使用 `web_search` 时提示开启网络能力。
12. 关闭网络能力后 Agent 不再调用 `web_search`，并给出本地替代方案。

### 13.4 架构约束测试

通过 lint 或 dependency rule 约束低耦合边界：

1. `src/renderer` 禁止 import `electron`、`fs`、`path`、`child_process`。
2. `src/renderer/components` 禁止 import `src/preload` 和 `src/main`。
3. `src/main/ipc/controllers` 禁止 import React、Zustand 和 Renderer 文件。
4. `src/main/repositories` 禁止 import Service、IPC Controller 和 Renderer 文件。
5. `src/shared` 禁止引用有副作用的运行时代码，只允许类型、schema、常量和纯函数。

## 14. 主要风险与应对

### 14.1 功能范围膨胀

风险：专家、技能、连接器、Agent、MCP 都容易越做越大。

应对：首版只做配置和 UI 闭环，真实执行能力放到二期。

### 14.2 本地执行安全风险

风险：一旦加入文件写入、命令执行、MCP 工具调用，误操作和越权风险会明显增加。

应对：首版不执行危险操作；二期加入权限策略、确认机制和审计日志。

### 14.3 聊天组件复杂度高

风险：新建任务、任务详情、创建专家、创建技能都会复用聊天组件，容易出现耦合。

应对：将聊天拆成 `ChatPanel`、`ChatMessageList`、`ChatComposer`、`ComposerToolbar`，由页面传入上下文和能力开关。

### 14.4 MCP 配置错误

风险：用户手写 JSON 容易出错。

应对：使用 Monaco Editor + zod schema 校验，保存前提示具体错误位置。

### 14.5 Electron 体积和性能

风险：桌面应用体积偏大，列表和聊天记录过多时性能下降。

应对：首版控制依赖数量；消息列表后续支持虚拟滚动；数据库查询分页。

### 14.6 React 状态管理失控

风险：如果把任务、消息、筛选条件、工作空间、专家、技能等状态同时塞进 Context，任意状态变化都可能触发大范围组件重渲染，聊天页和列表页会变得难维护。

应对：Context 只承载主题、IPC client、全局提示等稳定上下文；业务状态统一放 Zustand，并通过 selector 精确订阅。局部表单、Popover 开关、输入框临时值保留在组件内部。

### 14.7 Renderer 与 IPC 高耦合

风险：如果 React 组件直接调用 IPC channel，后续调整协议、替换运行时、做单元测试都会很困难，页面也会混入主进程语义。

应对：Renderer 只能调用 API Client；API Client 只能调用 preload 暴露的 `AnybuddyApi`；IPC Controller 只调用 Service。通过目录规则、lint 规则和测试 mock Client 保证边界不被破坏。

### 14.8 面向对象分层过度设计

风险：如果所有简单逻辑都拆成类，首版会出现大量空壳类和间接调用，降低开发速度。

应对：只在业务域边界使用类，例如 Service、Repository、Policy、Controller、Client。纯数据转换、简单 selector、schema 校验仍使用普通函数。类必须有稳定职责和明确依赖，不能为了形式化而创建。

## 15. 推荐 MVP 实施顺序

1. 先完成 Electron Forge + React + SQLite 基础工程。
2. 再做 Sidebar 和路由骨架。
3. 然后做任务、消息、工作空间三条主数据链路。
4. 再做聊天输入框的模式、模型、技能、连接器、权限选择。
5. 然后做专家、技能、连接器管理页。
6. 最后补搜索、筛选、用户菜单、MCP 编辑器和体验细节。

## 16. 结论

anybuddy 首版应该聚焦“个人本地 AI 工作台”的基础闭环，而不是一开始就实现完整自动化办公。推荐技术路线是 Electron Forge + React + TypeScript + React Router + Zustand + Context + SQLite + Monaco Editor。这个组合能较快完成桌面界面、本地数据、配置管理、打包分发和未来 Agent Runtime 的扩展接口。

首版的成功标准不是 Agent 多强，而是工作台结构是否清晰、任务和聊天是否稳定、专家/技能/连接器/工作空间是否能自然组织起来。只要这个基础打稳，后续再接入模型、MCP、文件工具和自动化执行才有可靠承载面。
