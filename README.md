# anybuddy

anybuddy 是一个面向本地工作流的 AI Agent 桌面工作台原型。项目目标是把「任务创建、专家/技能配置、工作空间挂载、权限审批、运行状态追踪」整合到一个 Electron 应用中，让用户可以用对话方式组织和驱动复杂工作。

> 当前阶段：项目主要完成了静态页面和前端交互原型。页面中的 Agent 执行、模型调用、外部连接器、通知集成等能力仍处于占位或待接入状态，请不要将当前版本视为可完整执行真实自动化任务的生产版本。

## 项目状态

- ✅ Electron + React + TypeScript 基础工程已搭建
- ✅ 主界面、任务创建页、任务详情页、专家与技能页、设置页已完成静态/半静态原型
- ✅ 侧边栏任务列表、工作空间列表、搜索筛选、设置弹窗等 UI 已具备基础交互
- ✅ 任务模式、模型、技能、连接器、权限模式等选择控件已完成前端形态
- 🚧 Agent 真实运行逻辑、模型网关、连接器执行、跨应用通知等仍待完善
- 🚧 数据持久化、运行事件、审批流等后端能力以本地原型实现为主，仍需继续联调

## 核心页面

### 新建任务

入口：`/tasks/new`

用于创建一个新的 Agent 任务，支持配置：

- 任务标题与初始提示词
- 运行模式：Ask / Plan / Craft
- 模型选择与自定义模型配置
- 技能包选择与本地技能导入
- 外部连接器选择，如 MCP、微信、钉钉、本地文件、网页搜索等
- 主工作空间与关联工作空间
- 权限模式：默认受限 / 完全访问

### 任务详情

入口：`/tasks/:taskId`

用于展示单个任务的对话、运行状态和人工审批信息，包括：

- 用户与助手消息流
- 任务状态标签
- 主工作空间信息
- 待审批操作卡片
- 继续发送消息的输入区

### 专家与技能配置

入口：`/experts`

用于管理 Agent 预设能力，包括：

- 内置专家卡片
- 自定义专家创建入口
- 技能包列表与搜索
- 本地技能导入
- 连接器说明
- MCP 配置文件编辑区

### 系统设置

入口：设置页或侧边栏用户菜单

当前包括：

- 外部网络访问开关
- 联网搜索开关
- 最大并发任务数
- 默认工作区
- 自定义模型配置
- 微信 / 钉钉全局助理参数
- 沙箱安全开关

## 技术栈

- [Electron](https://www.electronjs.org/)：桌面应用运行时
- [Electron Forge](https://www.electronforge.io/)：开发、打包与构建工具链
- [Vite](https://vitejs.dev/)：渲染进程构建
- [React](https://react.dev/)：前端 UI
- [TypeScript](https://www.typescriptlang.org/)：类型系统
- [Ant Design](https://ant.design/)：基础组件库
- [Zustand](https://zustand-demo.pmnd.rs/)：前端状态管理
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)：本地数据存储依赖

## 本地开发

### 环境要求

建议使用：

- Node.js 20+
- npm 10+

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

等价命令：

```bash
npm start
```

### 类型检查

```bash
npm run lint
```

当前 `lint` 脚本实际执行的是 TypeScript 类型检查：

```bash
tsc --noEmit
```

### 打包应用

```bash
npm run package
```

### 生成安装包

```bash
npm run make
```

## 项目结构

```text
anybuddy/
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 主进程入口
│   │   ├── ipc/              # IPC 注册与错误序列化
│   │   ├── repositories/     # 本地状态/数据访问层
│   │   ├── runtime/          # 运行时事件总线
│   │   ├── services/         # 应用服务层
│   │   ├── state/            # 默认状态数据
│   │   └── window/           # 主窗口创建逻辑
│   ├── preload/              # Electron preload 与桥接 API
│   ├── renderer/             # React 渲染进程
│   │   ├── api/              # 前端 API client 与上下文
│   │   ├── components/       # 通用 UI 组件
│   │   ├── layout/           # AppShell、Sidebar、TopBar
│   │   ├── pages/            # 页面组件
│   │   ├── stores/           # Zustand 状态管理
│   │   ├── styles/           # 全局样式
│   │   └── App.tsx           # 路由与主题配置
│   └── shared/               # 主进程/渲染进程共享类型与工具
├── docs/                     # 项目文档
├── forge.config.ts           # Electron Forge 配置
├── vite.renderer.config.ts   # 渲染进程 Vite 配置
├── vite.preload.config.ts    # preload Vite 配置
├── tsconfig.json             # TypeScript 配置
└── package.json              # 项目脚本与依赖
```

## 已实现的前端能力

### 任务工作台

- 侧边栏展示任务列表和工作空间列表
- 支持按状态和时间范围筛选任务
- 支持全局搜索任务
- 支持展开工作空间查看关联任务
- 支持创建任务并进入任务详情页

### 任务编排入口

- 支持 Ask / Plan / Craft 三种模式选择
- 支持选择内置模型和添加自定义模型
- 支持选择技能包、导入本地技能 JSON
- 支持选择连接器
- 支持选择主工作空间、关联额外工作空间
- 支持默认权限与完全访问权限切换

### 专家/技能/连接器

- 内置设计专家、文档助手、搜索与调试等专家卡片
- 可通过弹窗填写自定义专家名称和定位
- 技能列表支持搜索
- 连接器页面提供 MCP、本地文件、搜索、微信、钉钉等概念入口
- MCP 配置支持直接编辑 JSON 文本

### 设置中心

- 支持基础运行时设置
- 支持自定义模型增删
- 支持微信/钉钉 webhook 参数表单
- 支持沙箱安全开关

## 待办方向

后续可优先补齐以下能力：

1. **真实 Agent Runtime**
   - 接入可执行的 Agent 运行引擎
   - 实现 run / pause / resume / cancel 的真实状态流转
   - 将工具调用、子 Agent、审批事件写入任务事件流

2. **模型网关**
   - 统一内置模型和自定义模型调用协议
   - 支持 API Key、Base URL、模型 ID 的安全存储
   - 增加模型连通性测试

3. **连接器落地**
   - MCP Server 配置读取与调用
   - 本地文件系统权限边界
   - 微信/钉钉通知发送
   - Web Search 能力开关与调用链路

4. **权限与审批**
   - 明确默认受限模式下的可执行动作
   - 完善待审批工具调用的参数编辑逻辑
   - 增加危险操作二次确认和审计记录

5. **数据持久化与迁移**
   - 稳定 SQLite schema
   - 增加数据迁移机制
   - 区分 mock 数据和真实用户数据

6. **工程质量**
   - 增加单元测试和端到端测试
   - 增加 ESLint / Prettier 配置
   - 补充 CI 检查
   - 完善错误提示和空状态

## 开发约定建议

- 当前 UI 中部分功能仍为原型占位，新增功能时建议同步更新 README 的「项目状态」和「待办方向」。
- 涉及真实文件写入、外部网络请求、Webhook 通知、模型 API 调用的功能，应优先接入权限确认和错误处理。
- 任务、运行、审批、消息等核心类型位于 `src/shared/types.ts`，新增字段时应同时检查主进程、preload、renderer 三侧调用链。

## License

当前项目未声明开源许可证。如需公开发布，请先补充 LICENSE 文件并明确授权范围。
