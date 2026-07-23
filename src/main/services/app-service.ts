import { randomUUID } from 'node:crypto'
import { shell, dialog } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { AppEventBus } from '../runtime/event-bus.js'
import { AppStateRepository } from '../repositories/app-state-repository.js'
import { createDefaultState } from '../state/default-state.js'
import { DEFAULT_EXPERTS } from '../../renderer/data/experts.js'
import type {
  AgentEvent,
  AgentRun,
  AppSettings,
  AppState,
  CreateAgentRunInput,
  CreateMessageInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  HumanApproval,
  Message,
  ExpertPreset,
  Task,
  TaskDraft,
  TaskFilter,
  TaskSummary,
  TaskWorkspace,
  TaskWorkspaceContext,
  UpdateTaskInput,
  Workspace,
  WorkspaceSummary,
  ModelConfig,
} from '../../shared/types.js'
import { createId, nowIso } from '../../shared/utils.js'

// 活跃中的运行状态与任务状态列表
const activeRunStatuses: AgentRun['status'][] = ['queued', 'running', 'paused', 'waiting_approval']
const activeTaskStatuses: Task['status'][] = ['queued', 'running', 'paused', 'waiting_approval']

// 默认空 MCP 配置文件结构
const defaultMcpConfigRaw = JSON.stringify({ mcpServers: {} }, null, 2)

// 流式文本 Patch 防抖刷盘延迟时间 (毫秒)
const STREAM_EVENT_FLUSH_MS = 50

/**
 * 判断事件是否为流式生成中的 Agent 助手消息事件。
 */
function isStreamingAgentMessageEvent(event: AgentEvent) {
  return event.type === 'agent_message' && event.payload?.streaming === true
}

/**
 * 规范化模型配置数组：剔除已过时的内置预览模型，纠正第三方端点 (如 DeepSeek) 的 API 模式。
 */
function sanitizeModelConfigs(models: ModelConfig[]) {
  return models
    .filter(model => !(model.id === 'local-preview' && model.provider === 'builtin'))
    .map(model => {
      const normalizedBaseUrl = model.baseUrl?.trim().replace(/\/+$/, '')
      const normalizedApiMode = model.apiMode ?? 'auto'
      const shouldForceChatCompletions = typeof normalizedBaseUrl === 'string' && /deepseek/i.test(normalizedBaseUrl)

      return {
        ...model,
        ...(normalizedBaseUrl ? { baseUrl: normalizedBaseUrl } : {}),
        apiMode: shouldForceChatCompletions && normalizedApiMode !== 'chat_completions'
          ? 'chat_completions'
          : normalizedApiMode,
      }
    })
}

/**
 * 判断 ISO 时间戳字符串是否落在筛选时间范围内。
 */
function matchesTimeRange(updatedAt: string, timeRange: TaskFilter['timeRange']) {
  if (!timeRange || timeRange === 'all') {
    return true
  }

  const now = new Date()
  const target = new Date(updatedAt)

  if (Number.isNaN(target.getTime())) {
    return false
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (timeRange === 'today') {
    return target.getTime() >= startOfToday.getTime()
  }

  const daysBack = timeRange === 'last_7_days' ? 7 : 30
  const cutoff = new Date(startOfToday)
  cutoff.setDate(cutoff.getDate() - (daysBack - 1))
  return target.getTime() >= cutoff.getTime()
}

/**
 * 将任务全局权限约束 (read_only / read_write) 映射到具体工作区关系的访问权限。
 */
function taskPermissionToWorkspaceAccess(permissionMode: Task['permissionMode']): TaskWorkspace['accessMode'] {
  return permissionMode === 'read_only' ? 'read_only' : 'read_write'
}

/**
 * 应用主领域服务 (AppService)
 * 
 * 职责覆盖：
 * 1. 负责整合持久化仓储 (`AppStateRepository`) 与内存缓存数据 (`AppState`)。
 * 2. 负责 Task、Workspace、Message、Draft、Expert、AgentRun、AgentEvent、HumanApproval 领域的 CRUD。
 * 3. 负责向应用事件总线 (`AppEventBus`) 实时广播增量 Patch 与快照补丁，维持渲染进程 UI 状态同步。
 * 4. 负责镜像是将模型与 MCP 配置导出同步至本地隐藏配置文件 (`~/.anybuddy/models.json` / `mcp.json`)。
 */
export class AppService {
  /** 缓存待防抖刷盘的流式文本事件 Patch */
  private readonly pendingStreamEventPatches = new Map<string, { taskId: string; event: AgentEvent }>()
  private streamEventFlushTimer: NodeJS.Timeout | null = null

  /** 内存中的全局完整应用状态缓存 */
  private state: AppState | null = null

  constructor(
    private readonly repository: AppStateRepository,
    private readonly bus: AppEventBus,
  ) {}

  /**
   * 初始化应用服务：从数据库加载状态、初始化默认专家、从本地配置文件水合模型/MCP配置，并清理上次未正常关机残留卡住的活跃运行。
   */
  async init() {
    this.state = await this.repository.load(createDefaultState())
    await this.ensureDefaultExperts()
    await this.hydrateConfigStateFromFiles()
    
    // 应用启动时清理异常卡在活跃状态（running/queued等）的任务与运行
    let changed = false
    for (const run of this.state.agentRuns) {
      if (activeRunStatuses.includes(run.status)) {
        run.status = 'cancelled'
        run.completedAt = nowIso()
        run.updatedAt = run.completedAt
        changed = true
      }
    }
    for (const task of this.state.tasks) {
      if (activeTaskStatuses.includes(task.status) && task.status !== 'waiting_approval') {
        task.status = 'paused'
        task.updatedAt = nowIso()
        changed = true
      }
    }
    if (changed) {
      await this.persist()
    }
  }

  /** 确保系统预设的默认专家 (ExpertPresets) 已注入持久化状态中 */
  private async ensureDefaultExperts() {
    const existingIds = new Set(this.snapshot.experts.map(expert => expert.id))
    const missingExperts = DEFAULT_EXPERTS.filter(expert => !existingIds.has(expert.id))
    if (missingExperts.length === 0) {
      return
    }

    await this.mutate(state => {
      state.experts = [...state.experts, ...missingExperts]
    })
  }

  /** 将当前内存中的全局状态写入底层持久化 SQLite 仓储（排除流式中间吐字的暂态事件） */
  private async persist() {
    if (!this.state) {
      throw new Error('App service not initialized')
    }
    await this.repository.save({
      ...this.state,
      agentEvents: this.state.agentEvents.filter(event => !isStreamingAgentMessageEvent(event)),
    })
  }

  /** 读取当前内存中的只读快照；未初始化时抛错 */
  private get snapshot() {
    if (!this.state) {
      throw new Error('App service not initialized')
    }
    return this.state
  }

  /** 对内存状态进行可变修改，修改完成后自动触发写盘持久化 */
  private async mutate<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
    const result = await fn(this.snapshot)
    await this.persist()
    return result
  }

  /** 对内存状态进行可变修改，但跳过落盘持久化（适用于频繁高频流式 Patch） */
  private async mutateTransient<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
    return fn(this.snapshot)
  }

  /** 获取 AnyBuddy 的全局本地配置目录路径 (`~/.anybuddy`) */
  private getConfigDir() {
    return join(os.homedir(), '.anybuddy')
  }

  /** 获取模型配置文件路径 (`~/.anybuddy/models.json`) */
  private getModelsConfigFile() {
    return join(this.getConfigDir(), 'models.json')
  }

  /** 获取 MCP 配置文件路径 (`~/.anybuddy/mcp.json`) */
  private getMcpConfigFile() {
    return join(this.getConfigDir(), 'mcp.json')
  }

  /** 确保本地配置目录存在 */
  private async ensureConfigDir() {
    await mkdir(this.getConfigDir(), { recursive: true })
  }

  /** 同步读取模型配置文件，解析失败时退回空数组 */
  private readModelsConfigFileSync(): string {
    const file = this.getModelsConfigFile()
    try {
      if (!existsSync(file)) {
        return '[]'
      }
      return readFileSync(file, 'utf8')
    } catch {
      return '[]'
    }
  }

  /** 将内存中的模型与 MCP 配置同步镜像写入本地隐藏文件 (`~/.anybuddy/`) */
  private async syncConfigFilesFromState() {
    this.snapshot.modelConfigs = sanitizeModelConfigs(this.snapshot.modelConfigs)
    await this.ensureConfigDir()
    await Promise.all([
      writeFile(this.getModelsConfigFile(), JSON.stringify(this.snapshot.modelConfigs, null, 2), 'utf8'),
      writeFile(this.getMcpConfigFile(), this.snapshot.mcpConfigRaw || defaultMcpConfigRaw, 'utf8'),
    ])
  }

  /** 从本地配置文件水合 (Hydrate) 模型和 MCP 配置至内存及数据库 */
  private async hydrateConfigStateFromFiles() {
    const fileModelsRaw = this.readModelsConfigFileSync()
    const fileMcpRaw = await this.readMcpConfigFromFile()
    let changed = false

    try {
      const parsedModels = JSON.parse(fileModelsRaw) as ModelConfig[]
      if (Array.isArray(parsedModels) && parsedModels.length > 0) {
        this.snapshot.modelConfigs = sanitizeModelConfigs(parsedModels)
        changed = true
      }
    } catch {
      // 当本地文件内容非法时，保留 SQLite 中原有的数据
    }

    if (fileMcpRaw && fileMcpRaw !== defaultMcpConfigRaw) {
      this.snapshot.mcpConfigRaw = fileMcpRaw
      changed = true
    }

    if (changed) {
      await this.persist()
    }

    await this.syncConfigFilesFromState()
  }

  /** 向事件总线广播指定任务的完整运行时快照包 */
  private emitTaskRuntimeSnapshot(taskId: string) {
    this.bus.emitTaskRuntime(taskId, {
      kind: 'snapshot',
      taskId,
      runs: this.listAgentRunsByTask(taskId),
      events: this.listAgentEvents(taskId),
      approvals: this.listApprovals(taskId),
      messages: this.listMessages(taskId),
    })
  }

  /** 向事件总线广播指定任务的增量 Patch 变更 */
  private emitTaskRuntimePatch(taskId: string, patch: {
    run?: AgentRun
    event?: AgentEvent
    approval?: HumanApproval
    message?: Message
  }) {
    this.bus.emitTaskRuntime(taskId, {
      kind: 'patch',
      taskId,
      ...patch,
    })
  }

  /** 将流式打字机消息 Patch 放入队列，并在防抖时间到期后合并批量广播 */
  private queueStreamEventPatch(taskId: string, event: AgentEvent) {
    this.pendingStreamEventPatches.set(`${taskId}:${event.id}`, { taskId, event })
    if (this.streamEventFlushTimer) {
      return
    }

    this.streamEventFlushTimer = setTimeout(() => {
      const pending = [...this.pendingStreamEventPatches.values()]
      this.pendingStreamEventPatches.clear()
      this.streamEventFlushTimer = null

      for (const item of pending) {
        this.emitTaskRuntimePatch(item.taskId, {
          event: item.event,
        })
      }
    }, STREAM_EVENT_FLUSH_MS)
  }

  /** 创建 AgentEvent 数据工厂 */
  private createAgentEvent(run: AgentRun, type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent {
    return {
      id: createId('event'),
      taskId: run.taskId,
      runId: run.id,
      parentRunId: run.parentRunId,
      type,
      payload,
      createdAt: nowIso(),
    }
  }

  /** 为 Task 数据填充主工作区名称等摘要拓展字段 */
  private enrichTask(task: Task): TaskSummary {
    const taskWorkspace = this.snapshot.taskWorkspaces.find(item => item.taskId === task.id && item.role === 'primary')
    const workspaceName = taskWorkspace ? this.snapshot.workspaces.find(workspace => workspace.id === taskWorkspace.workspaceId)?.name : undefined
    return {
      id: task.id,
      title: task.title,
      mode: task.mode,
      status: task.status,
      unreadEventCount: task.unreadEventCount,
      primaryWorkspaceId: task.primaryWorkspaceId,
      primaryWorkspaceName: workspaceName,
      expertIds: task.expertIds,
      updatedAt: task.updatedAt,
    }
  }

  // ==========================================
  // 任务 (Task) 业务接口
  // ==========================================

  /**
   * 根据筛选条件（关键词、时间范围、状态、关联工作区）获取任务摘要列表。
   */
  listTasks(filter: TaskFilter = {}): TaskSummary[] {
    const { tasks, taskWorkspaces, workspaces } = this.snapshot
    const summaries = tasks.map(task => {
      const primary = taskWorkspaces.find(item => item.taskId === task.id && item.role === 'primary')
      const workspaceName = primary ? workspaces.find(workspace => workspace.id === primary.workspaceId)?.name : undefined
        return {
          id: task.id,
          title: task.title,
          mode: task.mode,
          status: task.status,
          unreadEventCount: task.unreadEventCount,
          primaryWorkspaceId: task.primaryWorkspaceId,
          primaryWorkspaceName: workspaceName,
          expertIds: task.expertIds,
          updatedAt: task.updatedAt,
        }
      })

    return summaries.filter(task => {
      if (filter.keyword) {
        const keyword = filter.keyword.trim().toLowerCase()
        const haystack = `${task.title} ${task.primaryWorkspaceName ?? ''} ${task.status}`.toLowerCase()
        if (!haystack.includes(keyword)) {
          return false
        }
      }

      if (!matchesTimeRange(task.updatedAt, filter.timeRange)) {
        return false
      }

      if (filter.status?.length && !filter.status.includes(task.status)) {
        return false
      }

      if (filter.workspaceId) {
        const related = taskWorkspaces.some(item => item.taskId === task.id && item.workspaceId === filter.workspaceId)
        if (!related) {
          return false
        }
      }

      return true
    })
  }

  /** 根据 ID 查询指定任务 */
  getTask(taskId: string): Task | null {
    return this.snapshot.tasks.find(task => task.id === taskId) ?? null
  }

  /**
   * 创建新任务，同时绑定主工作区和可选的附加工作区。
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.mutate(state => {
      const now = nowIso()
      const resolvedModelId = this.resolveTaskModelId(input.modelId)
      const task: Task = {
        id: createId('task'),
        title: input.title,
        mode: input.mode,
        modelId: resolvedModelId,
        expertIds: input.expertIds,
        activeExpertId: input.activeExpertId ?? input.expertIds[0],
        primaryWorkspaceId: input.workspaceId,
        permissionMode: input.permissionMode,
        connectorIds: input.connectorIds,
        skillIds: input.skillIds,
        status: 'idle',
        unreadEventCount: 0,
        createdAt: now,
        updatedAt: now,
      }
      state.tasks.unshift(task)

      if (input.workspaceId) {
        state.taskWorkspaces.unshift({
          id: createId('taskWorkspace'),
          taskId: task.id,
          workspaceId: input.workspaceId,
          role: 'primary',
          accessMode: taskPermissionToWorkspaceAccess(input.permissionMode),
          addedAt: now,
        })
      }

      for (const workspaceId of input.additionalWorkspaceIds ?? []) {
        state.taskWorkspaces.unshift({
          id: createId('taskWorkspace'),
          taskId: task.id,
          workspaceId,
          role: 'attached',
          accessMode: 'read_only',
          addedAt: now,
        })
      }

      return task
    })
  }

  /**
   * 更新任务属性（模式、激活专家、模型、权限等）。
   */
  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      const nextInput: UpdateTaskInput = { ...input }
      if ('modelId' in input) {
        nextInput.modelId = this.resolveTaskModelId(input.modelId)
      } else {
        delete nextInput.modelId
      }
      Object.assign(task, nextInput, { updatedAt: nowIso() })
      if (input.permissionMode) {
        const primaryRelation = state.taskWorkspaces.find(rel => rel.taskId === taskId && rel.role === 'primary')
        if (primaryRelation) {
          primaryRelation.accessMode = taskPermissionToWorkspaceAccess(input.permissionMode)
        }
      }
      return task
    })
  }

  /** 彻底删除任务及其关联的消息、草稿、工作区绑定和 Agent 运行记录 */
  async deleteTask(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.tasks = state.tasks.filter(task => task.id !== taskId)
      state.messages = state.messages.filter(message => message.taskId !== taskId)
      state.drafts = state.drafts.filter(draft => draft.taskId !== taskId)
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => rel.taskId !== taskId)
      state.agentRuns = state.agentRuns.filter(run => run.taskId !== taskId)
    })
  }

  /** 清空指定任务下的所有运行日志、事件和审批记录 */
  async clearTaskRuns(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.agentRuns = state.agentRuns.filter(run => run.taskId !== taskId)
      state.agentEvents = state.agentEvents.filter(event => event.taskId !== taskId)
      state.approvals = state.approvals.filter(approval => approval.taskId !== taskId)
    })
    this.emitTaskRuntimeSnapshot(taskId)
  }

  // ==========================================
  // 工作区 (Workspace) 关联业务接口
  // ==========================================

  /** 为任务附加额外的关联工作区 */
  async attachWorkspace(taskId: string, workspaceId: string, accessMode: 'read_only' | 'read_write' = 'read_only'): Promise<TaskWorkspace> {
    return this.mutate(state => {
      const relation: TaskWorkspace = {
        id: createId('taskWorkspace'),
        taskId,
        workspaceId,
        role: 'attached',
        accessMode,
        addedAt: nowIso(),
      }
      state.taskWorkspaces.unshift(relation)
      return relation
    })
  }

  /** 解绑任务的附加工作区 */
  async detachWorkspace(taskId: string, workspaceId: string): Promise<void> {
    await this.mutate(state => {
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => !(rel.taskId === taskId && rel.workspaceId === workspaceId && rel.role === 'attached'))
    })
  }

  /** 切换任务的主工作区 */
  async setPrimaryWorkspace(taskId: string, workspaceId: string): Promise<Task> {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      task.primaryWorkspaceId = workspaceId
      task.updatedAt = nowIso()
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => !(rel.taskId === taskId && rel.role === 'primary'))
      state.taskWorkspaces.unshift({
        id: createId('taskWorkspace'),
        taskId,
        workspaceId,
        role: 'primary',
        accessMode: taskPermissionToWorkspaceAccess(task.permissionMode),
        addedAt: nowIso(),
      })
      return task
    })
  }

  /** 获取指定任务绑定的所有工作区上下文信息列表 */
  listTaskWorkspaces(taskId: string): TaskWorkspaceContext[] {
    return this.snapshot.taskWorkspaces
      .filter(relation => relation.taskId === taskId)
      .map(relation => {
        const workspace = this.snapshot.workspaces.find(item => item.id === relation.workspaceId)
        if (!workspace) {
          return null
        }
        return { ...relation, workspace }
      })
      .filter((item): item is TaskWorkspaceContext => Boolean(item))
      .sort((a, b) => {
        if (a.role === b.role) {
          return a.addedAt.localeCompare(b.addedAt)
        }
        return a.role === 'primary' ? -1 : 1
      })
  }

  /** 清空任务的未读事件计数 */
  async markRead(taskId: string): Promise<Task> {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      task.unreadEventCount = 0
      task.updatedAt = nowIso()
      return task
    })
  }

  /** 获取所有处于活跃运行状态的任务摘要 */
  listRunningTasks(): TaskSummary[] {
    return this.listTasks({ status: ['queued', 'running', 'paused', 'waiting_approval'] })
  }

  // ==========================================
  // 消息 (Message) & 草稿 (Draft) 业务接口
  // ==========================================

  /** 获取指定任务下的历史对话消息列表 */
  listMessages(taskId: string): Message[] {
    return this.snapshot.messages
      .filter(message => message.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 创建新的对话消息并向任务追加引用 */
  async createMessage(taskId: string, input: CreateMessageInput): Promise<Message> {
    return this.mutate(state => {
      const message: Message = {
        id: createId('message'),
        taskId,
        role: input.role ?? 'user',
        content: input.content,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
        createdAt: nowIso(),
      }
      state.messages.push(message)
      const task = state.tasks.find(item => item.id === taskId)
      if (task) {
        task.updatedAt = message.createdAt
        task.unreadEventCount += message.role === 'assistant' ? 1 : 0
      }
      return message
    })
  }

  /** 删除单条指定消息 */
  async deleteMessage(messageId: string): Promise<void> {
    await this.mutate(state => {
      state.messages = state.messages.filter(message => message.id !== messageId)
    })
  }

  /** 获取指定任务输入框的暂存草稿 */
  getDraft(taskId: string): TaskDraft | null {
    return this.snapshot.drafts.find(draft => draft.taskId === taskId) ?? null
  }

  /** 保存或更新任务输入框草稿 */
  async saveDraft(taskId: string, draft: Omit<TaskDraft, 'taskId' | 'updatedAt'> & Partial<Pick<TaskDraft, 'updatedAt'>>): Promise<TaskDraft> {
    return this.mutate(state => {
      const next: TaskDraft = {
        taskId,
        content: draft.content,
        selectedSkillIds: draft.selectedSkillIds,
        selectedConnectorIds: draft.selectedConnectorIds,
        selectedExpertIds: draft.selectedExpertIds ?? [],
        selectedExpertId: draft.selectedExpertId ?? draft.selectedExpertIds?.[0],
        updatedAt: draft.updatedAt ?? nowIso(),
      }
      const index = state.drafts.findIndex(item => item.taskId === taskId)
      if (index >= 0) {
        state.drafts[index] = next
      } else {
        state.drafts.push(next)
      }
      return next
    })
  }

  /** 清除任务草稿 */
  async clearDraft(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.drafts = state.drafts.filter(draft => draft.taskId !== taskId)
    })
  }

  // ==========================================
  // 工作区 (Workspace) 管理业务接口
  // ==========================================

  /** 获取包含关联任务数及状态统计的工作区摘要列表 */
  listWorkspaces(): WorkspaceSummary[] {
    const { workspaces, taskWorkspaces, tasks } = this.snapshot
    return workspaces
      .filter(workspace => !workspace.isArchived)
      .map(workspace => {
        const relatedTaskIds = taskWorkspaces.filter(rel => rel.workspaceId === workspace.id).map(rel => rel.taskId)
        const relatedTasks = tasks.filter(task => relatedTaskIds.includes(task.id))
        return {
          ...workspace,
          taskCount: relatedTasks.length,
          runningTaskCount: relatedTasks.filter(task => activeTaskStatuses.includes(task.status)).length,
          waitingApprovalCount: relatedTasks.filter(task => task.status === 'waiting_approval').length,
        }
      })
  }

  /** 创建新的本地项目工作区 */
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.mutate(state => {
      const now = nowIso()
      const workspace: Workspace = {
        id: createId('workspace'),
        name: input.name,
        path: input.path,
        icon: input.icon,
        defaultPermissionMode: input.defaultPermissionMode ?? 'read_write',
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      }
      state.workspaces.unshift(workspace)
      return workspace
    })
  }

  /** 归档/移除工作区 */
  async removeWorkspace(workspaceId: string): Promise<void> {
    await this.mutate(state => {
      const workspace = state.workspaces.find(item => item.id === workspaceId)
      if (workspace) {
        workspace.isArchived = true
        workspace.updatedAt = nowIso()
      }
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => rel.workspaceId !== workspaceId || rel.role === 'primary')
    })
  }

  /** 在系统原生文件管理器 (Explorer/Finder) 中打开指定工作区文件夹 */
  async openWorkspaceFolder(workspaceId: string): Promise<void> {
    const workspace = this.snapshot.workspaces.find(item => item.id === workspaceId)
    if (!workspace) {
      throw new Error(`找不到该工作空间记录：${workspaceId}`)
    }
    if (!workspace.path) {
      throw new Error('未配置工作空间文件夹路径。')
    }
    if (!existsSync(workspace.path)) {
      throw new Error(`文件夹路径不存在，可能已被移动或删除：${workspace.path}`)
    }
    const err = await shell.openPath(workspace.path)
    if (err) {
      throw new Error(`打开文件夹失败：${err}`)
    }
  }

  /** 调起原生系统弹窗选择本地文件夹 */
  async pickWorkspaceFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return null
    }
    return result.filePaths[0]
  }

  /** 查询归属于指定工作区的任务列表 */
  async listWorkspaceTasks(workspaceId: string, filter: TaskFilter = {}): Promise<TaskSummary[]> {
    return this.listTasks({ ...filter, workspaceId })
  }

  /** 设置应用默认工作区 ID */
  async setDefaultWorkspace(workspaceId: string): Promise<AppSettings> {
    return this.mutate(state => {
      state.settings.defaultWorkspaceId = workspaceId
      return state.settings
    })
  }

  /** 获取当前应用全局设置 */
  getSettings(): AppSettings {
    return this.snapshot.settings
  }

  /** 更新全局设置 Patch */
  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutate(state => Object.assign(state.settings, patch))
  }

  // ==========================================
  // Agent 运行记录 (AgentRun) 与 专家 (Expert) 业务接口
  // ==========================================

  /** 获取所有 AgentRun 列表（按创建时间倒序） */
  listAgentRuns(): AgentRun[] {
    return [...this.snapshot.agentRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** 获取当前活跃的 AgentRun 列表 */
  listActiveAgentRuns(): AgentRun[] {
    return this.listAgentRuns().filter(run => activeRunStatuses.includes(run.status))
  }

  /** 获取指定任务下的所有 Agent 事件流 */
  listAgentEvents(taskId: string): AgentEvent[] {
    return this.snapshot.agentEvents
      .filter(event => event.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 获取指定任务下的敏感操作审批列表 */
  listApprovals(taskId: string): HumanApproval[] {
    return this.snapshot.approvals
      .filter(approval => approval.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 获取特定 Task 下的所有运行记录 */
  listAgentRunsByTask(taskId: string): AgentRun[] {
    return this.listAgentRuns().filter(run => run.taskId === taskId)
  }

  /** 获取专家预设 (ExpertPresets) 列表 */
  listExperts(): ExpertPreset[] {
    return [...this.snapshot.experts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /** 创建或更新专家角色设定 */
  async createExpert(input: Omit<ExpertPreset, 'createdAt' | 'updatedAt'>): Promise<ExpertPreset> {
    const now = nowIso()
    const expert: ExpertPreset = {
      ...input,
      createdAt: now,
      updatedAt: now,
    }

    return this.mutate(state => {
      state.experts = [
        ...state.experts.filter(item => item.id !== expert.id),
        expert,
      ]
      return expert
    })
  }

  /** 删除自定义专家预设 */
  async deleteExpert(expertId: string): Promise<void> {
    await this.mutate(state => {
      state.experts = state.experts.filter(expert => expert.id !== expertId)
    })
  }

  /** 获取规范化后的可用模型配置列表 */
  listModelConfigs(): ModelConfig[] {
    return sanitizeModelConfigs(this.snapshot.modelConfigs)
  }

  /** 解析匹配任务使用的有效模型 ID，无法匹配时自动降级 */
  private resolveTaskModelId(requestedModelId?: string) {
    if (requestedModelId && this.snapshot.modelConfigs.some(model => model.id === requestedModelId)) {
      return requestedModelId
    }

    const fallbackModel = this.snapshot.modelConfigs.find(model => model.enabled) ?? this.snapshot.modelConfigs[0]
    if (!fallbackModel) {
      throw new Error('No model config is available')
    }

    return fallbackModel.id
  }

  /**
   * 返回任务运行所需的完整上下文，供 AgentRuntimeService 组装提示词和工具输入。
   */
  getTaskContext(taskId: string) {
    const task = this.getTask(taskId)
    if (!task) {
      return null
    }

    return {
      task,
      messages: this.listMessages(taskId),
      workspaces: this.listTaskWorkspaces(taskId),
      runs: this.listAgentRunsByTask(taskId),
      events: this.listAgentEvents(taskId),
      approvals: this.listApprovals(taskId),
    }
  }

  /** 获取指定 AgentRun 实体 */
  getAgentRun(runId: string): AgentRun | null {
    return this.snapshot.agentRuns.find(run => run.id === runId) ?? null
  }

  /** 获取指定审批实体 */
  getApproval(approvalId: string): HumanApproval | null {
    return this.snapshot.approvals.find(approval => approval.id === approvalId) ?? null
  }

  /** 向运行追加子 Agent 派生的消息 */
  async appendSubagentMessage(runId: string, content: string, metadata?: Record<string, unknown>) {
    const run = this.getAgentRun(runId)
    if (!run) {
      throw new Error(`Agent run not found: ${runId}`)
    }

    await this.appendRuntimeMessage(run.taskId, run.id, 'user', content, {
      ...(metadata ?? {}),
      source: 'subagent_message',
    })
    await this.appendRuntimeEvent(run.id, 'agent_message', {
      role: 'user',
      content,
      source: 'subagent_message',
    })
  }

  /** 停止指定的子 Agent 运行 */
  async stopSubagentRun(runId: string, reason?: string): Promise<AgentRun> {
    const run = this.getAgentRun(runId)
    if (!run) {
      throw new Error(`Agent run not found: ${runId}`)
    }
    if (run.kind !== 'subagent') {
      throw new Error(`Run is not a subagent: ${runId}`)
    }

    const updatedRun = await this.updateAgentRunStatus(runId, 'cancelled')
    await this.appendRuntimeEvent(runId, 'interrupt_resolved', {
      reason: reason ?? 'subagent_stopped',
      source: 'stop_subagent',
    })
    return updatedRun
  }

  /**
   * 创建 runtime 运行记录，只负责落库和事件初始化，不做真实执行。
   */
  async createRuntimeRun(taskId: string, input: CreateAgentRunInput = { agentName: 'Main Agent', kind: 'main' }): Promise<AgentRun> {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const now = nowIso()
    const run: AgentRun = {
      id: createId('run'),
      taskId,
      workspaceIds: this.snapshot.taskWorkspaces.filter(rel => rel.taskId === taskId).map(rel => rel.workspaceId),
      agentId: randomUUID(),
      agentName: input.agentName,
      kind: input.kind ?? 'main',
      expertId: input.expertId,
      status: 'queued',
      graphThreadId: createId('thread'),
      parentRunId: input.parentRunId,
      currentNode: 'plan',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    await this.mutate(state => {
      state.agentRuns.unshift(run)
      state.agentEvents.push(this.createAgentEvent(run, 'run_started', {
        agentName: run.agentName,
        kind: run.kind,
        expertId: run.expertId ?? null,
        currentNode: run.currentNode,
      }))
      const target = state.tasks.find(item => item.id === taskId)
      if (target) {
        if (run.kind === 'main') {
          target.status = 'queued'
          target.lastRunId = run.id
        }
        target.updatedAt = now
      }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    this.emitTaskRuntimeSnapshot(taskId)
    return run
  }

  /**
   * 追加 runtime 事件，前端任务详情页会实时消费这条事件流。
   */
  async appendRuntimeEvent(runId: string, type: AgentEvent['type'], payload: Record<string, unknown>): Promise<void> {
    let taskId = ''
    let createdEvent: AgentEvent | null = null
    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      taskId = run.taskId
      createdEvent = this.createAgentEvent(run, type, payload)
      state.agentEvents.push(createdEvent)
    })

    if (taskId && createdEvent) {
      this.emitTaskRuntimePatch(taskId, {
        event: createdEvent,
      })
    }
  }

  /**
   * 追加 runtime 消息，包含 system、assistant 和 tool 三类消息。
   */
  async appendRuntimeMessage(taskId: string, runId: string, role: Message['role'], content: string, metadata?: Record<string, unknown>): Promise<void> {
    let createdMessage: Message | null = null
    await this.mutate(state => {
      createdMessage = {
        id: createId('message'),
        taskId,
        runId,
        role,
        content,
        metadata,
        createdAt: nowIso(),
      }
      state.messages.push(createdMessage)
      const task = state.tasks.find(item => item.id === taskId)
      if (task) {
        task.updatedAt = nowIso()
      }
    })

    if (createdMessage) {
      this.emitTaskRuntimePatch(taskId, {
        message: createdMessage,
      })
    }
  }

  /**
   * 正常结束 runtime run，并补一条最终助手消息。
   */
  async completeRuntimeRun(runId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    let taskId = ''
    let completedRun: AgentRun | null = null
    let runStatusEvent: AgentEvent | null = null
    let runCompletedEvent: AgentEvent | null = null
    let assistantMessage: Message | null = null
    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      taskId = run.taskId
      run.status = 'completed'
      run.currentNode = 'finished'
      run.completedAt = nowIso()
      run.updatedAt = run.completedAt
      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'completed'
        task.updatedAt = run.updatedAt
      }
      runStatusEvent = this.createAgentEvent(run, 'run_status', {
        status: 'completed',
        currentNode: run.currentNode,
      })
      state.agentEvents.push(runStatusEvent)
      runCompletedEvent = this.createAgentEvent(run, 'run_completed', {
        status: 'completed',
      })
      state.agentEvents.push(runCompletedEvent)
      assistantMessage = {
        id: createId('message'),
        taskId: run.taskId,
        runId,
        role: 'assistant',
        content,
        metadata,
        createdAt: nowIso(),
      }
      state.messages.push(assistantMessage)
      completedRun = { ...run }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (taskId) {
      if (completedRun) {
        this.emitTaskRuntimePatch(taskId, { run: completedRun })
      }
      if (runStatusEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runStatusEvent })
      }
      if (runCompletedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runCompletedEvent })
      }
      if (assistantMessage) {
        this.emitTaskRuntimePatch(taskId, { message: assistantMessage })
      }
    }
  }

  /**
   * 以等待方案确认 (Plan Approval) 的状态完成单次运行。
   */
  async completeRuntimeRunWithPlanApproval(runId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    let taskId = ''
    let waitingRun: AgentRun | null = null
    let runStatusEvent: AgentEvent | null = null
    let runCompletedEvent: AgentEvent | null = null
    let assistantMessage: Message | null = null
    let approval: HumanApproval | null = null
    let approvalRequestedEvent: AgentEvent | null = null

    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }

      taskId = run.taskId
      run.status = 'waiting_approval'
      run.currentNode = 'plan_approval'
      run.updatedAt = nowIso()

      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'waiting_approval'
        task.updatedAt = run.updatedAt
      }

      runStatusEvent = this.createAgentEvent(run, 'run_status', {
        status: 'waiting_approval',
        currentNode: run.currentNode,
      })
      state.agentEvents.push(runStatusEvent)

      runCompletedEvent = this.createAgentEvent(run, 'run_completed', {
        status: 'waiting_approval',
        awaiting: 'plan_confirmation',
      })
      state.agentEvents.push(runCompletedEvent)

      assistantMessage = {
        id: createId('message'),
        taskId: run.taskId,
        runId,
        role: 'assistant',
        content,
        metadata: {
          ...metadata,
          planApprovalPending: true,
        },
        createdAt: nowIso(),
      }
      state.messages.push(assistantMessage)

      approval = {
        id: createId('approval'),
        taskId: run.taskId,
        runId: run.id,
        toolCallId: createId('planApproval'),
        reason: '请确认是否按当前方案继续执行。',
        originalArgs: {
          approvalType: 'plan_confirmation',
          nextMode: 'craft',
          plan: content,
        },
        decision: 'pending',
        createdAt: nowIso(),
      }
      state.approvals.push(approval)

      approvalRequestedEvent = this.createAgentEvent(run, 'approval_requested', {
        approvalId: approval.id,
        reason: approval.reason,
        originalArgs: approval.originalArgs,
      })
      state.agentEvents.push(approvalRequestedEvent)

      waitingRun = { ...run }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (taskId) {
      if (waitingRun) {
        this.emitTaskRuntimePatch(taskId, { run: waitingRun })
      }
      if (runStatusEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runStatusEvent })
      }
      if (runCompletedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runCompletedEvent })
      }
      if (assistantMessage) {
        this.emitTaskRuntimePatch(taskId, { message: assistantMessage })
      }
      if (approval) {
        this.emitTaskRuntimePatch(taskId, { approval })
      }
      if (approvalRequestedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: approvalRequestedEvent })
      }
    }
  }

  /**
   * 更新或追加运行时流式消息事件，供前端实时显示打字机效果。
   */
  async upsertAgentMessageEvent(runId: string, eventId: string, content: string, payloadPatch?: Record<string, unknown>): Promise<void> {
    let taskId = ''
    let changedEvent: AgentEvent | null = null
    await this.mutateTransient(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      taskId = run.taskId

      const existing = state.agentEvents.find(event => event.id === eventId)
      if (existing) {
        existing.payload = {
          ...existing.payload,
          content,
          ...(payloadPatch ?? {}),
        }
        changedEvent = { ...existing }
      } else {
        const event = {
          id: eventId,
          taskId: run.taskId,
          runId,
          parentRunId: run.parentRunId ?? undefined,
          type: 'agent_message' as const,
          payload: {
            role: 'assistant',
            content,
            source: 'langchain_agent_stream',
            ...(payloadPatch ?? {}),
          },
          createdAt: nowIso(),
        }
        state.agentEvents.push(event)
        changedEvent = event
      }
    })

    if (taskId && changedEvent) {
      this.queueStreamEventPatch(taskId, changedEvent)
    }
  }

  /**
   * 运行时失败统一走这里，确保错误能同步到事件流和任务状态。
   */
  async failRuntimeRun(runId: string, error: unknown): Promise<void> {
    let taskId = ''
    let failedRun: AgentRun | null = null
    let failedEvent: AgentEvent | null = null
    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        return
      }
      taskId = run.taskId
      run.status = 'failed'
      run.currentNode = 'failed'
      run.completedAt = nowIso()
      run.updatedAt = run.completedAt
      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'failed'
        task.updatedAt = run.updatedAt
      }
      failedEvent = this.createAgentEvent(run, 'run_failed', {
        message: error instanceof Error ? error.message : 'Unknown runtime failure',
      })
      state.agentEvents.push(failedEvent)
      failedRun = { ...run }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (taskId) {
      if (failedRun) {
        this.emitTaskRuntimePatch(taskId, { run: failedRun })
      }
      if (failedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: failedEvent })
      }
    }
  }

  /** 暂停运行时 AgentRun */
  async pauseRuntimeRun(runId: string): Promise<AgentRun> {
    return this.updateAgentRunStatus(runId, 'paused')
  }

  /** 恢复运行 AgentRun */
  async resumeRuntimeRun(runId: string): Promise<AgentRun> {
    return this.updateAgentRunStatus(runId, 'running')
  }

  /** 取消运行 AgentRun */
  async cancelRuntimeRun(runId: string): Promise<AgentRun> {
    return this.updateAgentRunStatus(runId, 'cancelled')
  }

  /**
   * 为运行时工具调用创建中断恢复点，并把任务切换到等待恢复状态。
   */
  async requestRuntimeApproval(runId: string, reason: string, originalArgs: Record<string, unknown>): Promise<HumanApproval> {
    let approval: HumanApproval | null = null
    let taskId = ''
    let approvalRun: AgentRun | null = null
    let approvalRequestedEvent: AgentEvent | null = null

    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }

      taskId = run.taskId
      run.status = 'waiting_approval'
      run.currentNode = 'approval_pending'
      run.updatedAt = nowIso()

      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'waiting_approval'
        task.updatedAt = run.updatedAt
      }

      approval = {
        id: createId('approval'),
        taskId: run.taskId,
        runId: run.id,
        toolCallId: createId('toolCall'),
        reason,
        originalArgs,
        decision: 'pending',
        createdAt: nowIso(),
      }

      state.approvals.push(approval)
      approvalRequestedEvent = this.createAgentEvent(run, 'approval_requested', {
        approvalId: approval.id,
        reason,
        originalArgs,
      })
      state.agentEvents.push(approvalRequestedEvent)
      state.agentEvents.push(this.createAgentEvent(run, 'interrupt_requested', {
        approvalId: approval.id,
        reason,
      }))
      approvalRun = { ...run }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (taskId) {
      if (approvalRun) {
        this.emitTaskRuntimePatch(taskId, { run: approvalRun })
      }
      if (approval) {
        this.emitTaskRuntimePatch(taskId, { approval })
      }
      if (approvalRequestedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: approvalRequestedEvent })
      }
    }

    if (!approval) {
      throw new Error('Failed to create approval request')
    }

    return approval
  }

  /** 响应审批请求（别名） */
  async approveRequest(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>): Promise<HumanApproval> {
    return this.approveRuntimeRequest(approvalId, decision, editedArgs)
  }

  /**
   * 响应人工敏感操作审批（通过、修改参数通过、或拒绝），恢复或终止运行状态并记录原因。
   */
  async approveRuntimeRequest(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>): Promise<HumanApproval> {
    let targetTaskId = ''
    let resolvedApproval: HumanApproval | null = null
    let resolvedRun: AgentRun | null = null
    let resolvedEvent: AgentEvent | null = null
    let resolvedMessage: Message | null = null
    await this.mutate(state => {
      const approval = state.approvals.find(item => item.id === approvalId)
      if (!approval) {
        throw new Error(`Approval not found: ${approvalId}`)
      }
      approval.decision = decision
      approval.editedArgs = editedArgs
      approval.decidedAt = nowIso()
      targetTaskId = approval.taskId
      resolvedApproval = { ...approval }

      const run = state.agentRuns.find(item => item.id === approval.runId)
      if (!run) {
        throw new Error(`Agent run not found: ${approval.runId}`)
      }

      const isPlanConfirmation = approval.originalArgs?.approvalType === 'plan_confirmation'
      run.status = isPlanConfirmation
        ? (decision === 'rejected' ? 'cancelled' : 'completed')
        : decision === 'rejected'
          ? 'failed'
          : 'running'
      run.currentNode = decision === 'rejected' ? 'approval_rejected' : 'approval_resolved'
      run.updatedAt = nowIso()
      if (decision === 'rejected' || isPlanConfirmation) {
        run.completedAt = run.updatedAt
      }

      const task = state.tasks.find(item => item.id === approval.taskId)
      if (task) {
        task.status = isPlanConfirmation
          ? (decision === 'rejected' ? 'cancelled' : 'completed')
          : decision === 'rejected'
            ? 'failed'
            : 'running'
        task.updatedAt = run.updatedAt
      }

      resolvedEvent = this.createAgentEvent(run, 'interrupt_resolved', {
        approvalId,
        decision,
        editedArgs: editedArgs ?? null,
      })
      state.agentEvents.push(resolvedEvent)

      const primaryWorkspace = state.workspaces.find(w => w.id === task?.primaryWorkspaceId)
      const workspaceName = primaryWorkspace ? primaryWorkspace.name : 'workspace'

      resolvedMessage = {
        id: createId('message'),
        taskId: approval.taskId,
        runId: run.id,
        role: 'assistant',
        content: decision === 'rejected'
          ? '已取消本次敏感操作，当前运行已停止。'
          : decision === 'edited'
            ? `已按修改后的参数恢复执行，目标工作区：[${workspaceName}]。`
            : `已按原参数恢复执行，目标工作区：[${workspaceName}]。`,
        createdAt: nowIso(),
      }
      if (isPlanConfirmation) {
        resolvedMessage.content = decision === 'rejected'
          ? '已取消按该方案继续执行。'
          : '方案已确认，接下来将进入 Craft 执行模式。'
        resolvedMessage.metadata = { planApprovalResolved: true, decision }
      }
      state.messages.push(resolvedMessage)
      resolvedRun = { ...run }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (targetTaskId) {
      if (resolvedRun) {
        this.emitTaskRuntimePatch(targetTaskId, { run: resolvedRun })
      }
      if (resolvedApproval) {
        this.emitTaskRuntimePatch(targetTaskId, { approval: resolvedApproval })
      }
      if (resolvedEvent) {
        this.emitTaskRuntimePatch(targetTaskId, { event: resolvedEvent })
      }
      if (resolvedMessage) {
        this.emitTaskRuntimePatch(targetTaskId, { message: resolvedMessage })
      }
    }

    if (!resolvedApproval) {
      throw new Error(`Approval not found after resolve: ${approvalId}`)
    }

    return resolvedApproval
  }

  /** 更新 AgentRun 状态并向 UI 发送更新补丁 */
  private async updateAgentRunStatus(runId: string, status: AgentRun['status']): Promise<AgentRun> {
    return this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      run.status = status
      run.updatedAt = nowIso()
      run.currentNode = status === 'paused'
        ? 'paused'
        : status === 'running'
          ? 'execution'
          : run.currentNode
      state.agentEvents.push(this.createAgentEvent(run, 'run_status', {
        status,
        currentNode: run.currentNode,
      }))
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        run.completedAt = nowIso()
        const task = state.tasks.find(item => item.id === run.taskId)
        if (task && task.lastRunId === run.id) {
          task.status = status === 'completed' ? 'completed' : status
          task.updatedAt = run.updatedAt
        }
        state.agentEvents.push(this.createAgentEvent(
          run,
          status === 'failed' ? 'run_failed' : 'run_completed',
          { status },
        ))
      }
      return run
    })
  }

  // ==========================================
  // 模型 (Models) & MCP 外部配置文件镜像读写
  // ==========================================

  /** 读取格式化后的模型配置 JSON 字符串 */
  async readModelsConfig(): Promise<string> {
    return JSON.stringify(sanitizeModelConfigs(this.snapshot.modelConfigs), null, 2)
  }

  /** 写入并覆盖模型配置 JSON，同时更新内存与 `~/.anybuddy/models.json` */
  async writeModelsConfig(content: string): Promise<void> {
    const parsed = JSON.parse(content) as ModelConfig[]
    if (!Array.isArray(parsed)) {
      throw new Error('Models config must be a JSON array')
    }

    await this.mutate(state => {
      state.modelConfigs = sanitizeModelConfigs(parsed)
    })
    await this.syncConfigFilesFromState()
  }

  /** 读取 MCP 服务的配置 JSON 文本 */
  async readMcpConfig(): Promise<string> {
    try {
      JSON.parse(this.snapshot.mcpConfigRaw)
      return this.snapshot.mcpConfigRaw
    } catch (error) {
      console.error('Failed to read mcp config from state', error)
      return defaultMcpConfigRaw
    }
  }

  /** 保存 MCP 服务配置文本，并同步至 `~/.anybuddy/mcp.json` */
  async writeMcpConfig(content: string): Promise<void> {
    JSON.parse(content)
    await this.mutate(state => {
      state.mcpConfigRaw = content
    })
    await this.syncConfigFilesFromState()
  }

  /** 从磁盘文件 `~/.anybuddy/mcp.json` 读取 MCP 配置内容 */
  private async readMcpConfigFromFile(): Promise<string> {
    const file = this.getMcpConfigFile()
    try {
      if (!existsSync(file)) {
        return defaultMcpConfigRaw
      }
      return await readFile(file, 'utf8')
    } catch (error) {
      console.error('Failed to read mcp config', error)
      return defaultMcpConfigRaw
    }
  }
}
