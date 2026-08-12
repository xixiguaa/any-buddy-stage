import { randomUUID } from 'node:crypto'
import { shell, dialog } from 'electron'
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path, { join } from 'node:path'
import os from 'node:os'
import { AppEventBus } from '../runtime/event-bus.js'
import { AppStateRepository } from '../repositories/app-state-repository.js'
import { createDefaultState } from '../state/default-state.js'
import { DEFAULT_EXPERTS, DEFAULT_EXPERT_TEAMS } from '../../renderer/data/experts.js'
import { OpenAIModelService } from './openai-model-service.js'
import { ChatOpenAI } from '@langchain/openai'
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
  ExpertTeamPreset,
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
  TaskArtifactRecord,
} from '../../shared/types.js'
import { createId, nowIso } from '../../shared/utils.js'

// 活跃中的运行状态与任务状态列表
import { WORKSPACE_DIR_NAME, CONFIG_DIR_NAME } from '../../shared/constants.js'

const activeRunStatuses: AgentRun['status'][] = ['queued', 'running', 'paused', 'waiting_approval']
const activeTaskStatuses: Task['status'][] = ['queued', 'running', 'paused', 'waiting_approval']
const terminalRunStatuses: AgentRun['status'][] = ['completed', 'failed', 'cancelled']

function isTerminalRunStatus(status: AgentRun['status']) {
  return terminalRunStatuses.includes(status)
}

/** 获取系统用户目录下默认工作区根目录路径 (~/CulClaw) */
function getCulClawRootDir(): string {
  return join(os.homedir(), WORKSPACE_DIR_NAME)
}

// 默认空 MCP 配置文件结构
const defaultMcpConfigRaw = JSON.stringify({ mcpServers: {} }, null, 2)

// 流式文本 Patch 防抖刷盘延迟时间 (毫秒)
const STREAM_EVENT_FLUSH_MS = 50

/** 运行结束时需要保留的非最终流式消息段。 */
type RuntimeIntermediateMessage = Pick<Message, 'content' | 'metadata' | 'createdAt'>

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
  /** 模型配置解析服务（用于根据模式和 API Key 实例化 ChatOpenAI 进行意图分析与生成标题） */
  private readonly modelService = new OpenAIModelService()

  /** 缓存待防抖刷盘的流式文本事件 Patch */
  private readonly pendingStreamEventPatches = new Map<string, { taskId: string; event: AgentEvent }>()
  private streamEventFlushTimer: NodeJS.Timeout | null = null

  /** 内存中的全局完整应用状态缓存 */
  private state: AppState | null = null
  /** 正在删除的工作区不能再接收运行时产物回写。 */
  private readonly workspaceRemovalPendingIds = new Set<string>()

  constructor(
    private readonly repository: AppStateRepository,
    private readonly bus: AppEventBus,
  ) { }

  /**
   * 初始化应用服务：从数据库加载状态、初始化默认专家、从本地配置文件水合模型/MCP配置、同步扫描 culclaw 工作区目录，并清理上次未正常关机残留卡住的活跃运行。
   */
  async init() {
    this.state = await this.repository.load(createDefaultState())
    const workspaceNamesChanged = this.normalizeWorkspaceNames()
    await this.ensureDefaultSkills()
    await this.ensureDefaultExperts()
    await this.ensureDefaultExpertTeams()
    await this.hydrateConfigStateFromFiles()
    await this.syncCulClawWorkspaces()

    if (workspaceNamesChanged) {
      await this.persist()
    }

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

  /**
   * 自动恢复并更新应用内置技能包至 ~/.culclaw/skills
   */
  private async ensureDefaultSkills() {
    const userSkillsRoot = join(os.homedir(), CONFIG_DIR_NAME, 'skills')
    const resourcesSkillsRoot = join(process.cwd(), 'resources', 'skills')

    if (!existsSync(resourcesSkillsRoot)) {
      return
    }

    try {
      if (!existsSync(userSkillsRoot)) {
        await mkdir(userSkillsRoot, { recursive: true })
      }

      const entries = readdirSync(resourcesSkillsRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillId = entry.name
          const srcDir = join(resourcesSkillsRoot, skillId)
          const targetDir = join(userSkillsRoot, skillId)

          // 若用户技能目录下缺失 SKILL.md，则自动装载
          if (!existsSync(join(targetDir, 'SKILL.md'))) {
            await mkdir(targetDir, { recursive: true })
            const { cp } = await import('node:fs/promises')
            await cp(srcDir, targetDir, { recursive: true })
            console.log(`[AppService] 已自动水合内置技能: ${skillId}`)
          }
        }
      }
    } catch (error) {
      console.warn('[AppService] 自动水合内置技能失败:', error)
    }
  }

  /**
   * 自动扫描并水合用户目录 CulClaw 文件夹下的已存在工作区子目录
   */
  private async syncCulClawWorkspaces() {
    if (!this.state) return
    const culclawRootDir = getCulClawRootDir()
    if (!existsSync(culclawRootDir)) return

    try {
      const entries = readdirSync(culclawRootDir, { withFileTypes: true })
      const existingPaths = new Set(this.state.workspaces.map(w => w.path))
      let hasNew = false

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const workspacePath = join(culclawRootDir, entry.name)
          if (!existingPaths.has(workspacePath)) {
            const now = nowIso()
            const newWorkspace: Workspace = {
              id: createId('workspace'),
              name: entry.name,
              path: workspacePath,
              defaultPermissionMode: 'read_write',
              isArchived: false,
              createdAt: now,
              updatedAt: now,
              lastOpenedAt: now,
            }
            this.state.workspaces.unshift(newWorkspace)
            existingPaths.add(workspacePath)
            hasNew = true
          }
        }
      }

      if (hasNew) {
        await this.persist()
      }
    } catch (error) {
      console.warn('[AppService] 扫描 AnyBuddy 工作区目录失败:', error)
    }
  }

  /** 将历史工作区名称纠正为物理目录名，保证 Docker 映射目录与宿主机一致。 */
  private normalizeWorkspaceNames(): boolean {
    if (!this.state) return false
    let changed = false
    for (const workspace of this.state.workspaces) {
      const name = path.basename(path.resolve(workspace.path))
      if (name && workspace.name !== name) {
        workspace.name = name
        workspace.updatedAt = nowIso()
        changed = true
      }
    }
    return changed
  }

  /** 同步系统内置专家，同时保留用户创建的自定义专家，并清除已注销的旧内置专家。 */
  private async ensureDefaultExperts() {
    const defaultExpertsById = new Map(DEFAULT_EXPERTS.map(expert => [expert.id, expert]))
    const existingDefaultIds = new Set<string>()
    const syncedAt = nowIso()
    let changed = false

    const experts: ExpertPreset[] = []

    for (const expert of this.snapshot.experts) {
      if (expert.isCustom) {
        experts.push(expert)
        continue
      }

      const defaultExpert = defaultExpertsById.get(expert.id)
      if (!defaultExpert) {
        // 旧内置专家已不在预设清单中，予以清理移除
        changed = true
        continue
      }

      existingDefaultIds.add(expert.id)

      const isCurrent = expert.name === defaultExpert.name
        && expert.description === defaultExpert.description
        && expert.systemPrompt === defaultExpert.systemPrompt
        && JSON.stringify(expert.skills) === JSON.stringify(defaultExpert.skills)

      if (isCurrent) {
        experts.push(expert)
      } else {
        changed = true
        experts.push({
          ...defaultExpert,
          isCustom: false,
          createdAt: expert.createdAt,
          updatedAt: syncedAt,
        })
      }
    }

    for (const defaultExpert of DEFAULT_EXPERTS) {
      if (!existingDefaultIds.has(defaultExpert.id)) {
        experts.push({ ...defaultExpert, isCustom: false })
        changed = true
      }
    }

    if (!changed) {
      return
    }

    await this.mutate(state => {
      state.experts = experts
    })
  }

  /** 同步系统内置专家团，保证顺序严格按 DEFAULT_EXPERT_TEAMS 排布，同时保留用户创建的自定义专家团，并清除已废弃的旧内置团队。 */
  private async ensureDefaultExpertTeams() {
    const existingTeamsById = new Map((this.snapshot.expertTeams ?? []).map(t => [t.id, t]))
    const syncedAt = nowIso()

    // 提取所有自定义专家团
    const customTeams = (this.snapshot.expertTeams ?? []).filter(t => t.isCustom)

    // 按 DEFAULT_EXPERT_TEAMS 预设顺序构建最新内置专家团列表
    const syncedDefaultTeams: ExpertTeamPreset[] = DEFAULT_EXPERT_TEAMS.map(defaultTeam => {
      const existing = existingTeamsById.get(defaultTeam.id)
      if (!existing) {
        return { ...defaultTeam, isCustom: false }
      }

      const isCurrent = existing.name === defaultTeam.name
        && existing.description === defaultTeam.description
        && existing.systemPrompt === defaultTeam.systemPrompt
        && JSON.stringify(existing.members) === JSON.stringify(defaultTeam.members)

      return {
        ...defaultTeam,
        isCustom: false,
        createdAt: existing.createdAt,
        updatedAt: isCurrent ? existing.updatedAt : syncedAt,
      }
    })

    const finalExpertTeams = [...syncedDefaultTeams, ...customTeams]

    // 检查整体顺序或内容与当前内存 snapshot 是否存在差异
    const isIdentical = JSON.stringify(this.snapshot.expertTeams) === JSON.stringify(finalExpertTeams)
    if (isIdentical) {
      return
    }

    await this.mutate(state => {
      state.expertTeams = finalExpertTeams
    })
  }


  /** 获取所有专家团列表 */
  listExpertTeams(): ExpertTeamPreset[] {
    return this.snapshot.expertTeams ?? DEFAULT_EXPERT_TEAMS
  }

  /** 根据 ID 查询特定专家团 */
  getExpertTeam(teamId: string): ExpertTeamPreset | undefined {
    return (this.snapshot.expertTeams ?? DEFAULT_EXPERT_TEAMS).find(t => t.id === teamId)
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

  /** 获取全局本地配置目录路径 (`~/.culclaw`) */
  private getConfigDir() {
    return join(os.homedir(), CONFIG_DIR_NAME)
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
    task?: Task
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

  /**
   * 运行结束后，已由持久化消息接管展示的流式 Patch 无需再补发。
   */
  private discardPendingStreamEventPatches(runId: string) {
    for (const [key, pending] of this.pendingStreamEventPatches) {
      if (pending.event.runId === runId) {
        this.pendingStreamEventPatches.delete(key)
      }
    }
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
   * 若未指定工作区，则自动在用户目录 AnyBuddy 文件夹下创建 "年-月-日 时-分秒" 格式的工作区并绑定。
   */
  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = await this.mutate(state => {
      const now = nowIso()
      const resolvedModelId = this.resolveTaskModelId(input.modelId)

      let primaryWorkspaceId = input.workspaceId?.trim() ? input.workspaceId : undefined

      // 若未指定工作区，自动在用户目录 CulClaw 文件夹下创建新工作区（格式：年-月-日 时-分秒）
      if (!primaryWorkspaceId) {
        const date = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const folderName = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
        const culclawRootDir = getCulClawRootDir()
        const workspacePath = join(culclawRootDir, folderName)

        if (!existsSync(workspacePath)) {
          mkdirSync(workspacePath, { recursive: true })
        }

        const newWorkspace: Workspace = {
          id: createId('workspace'),
          name: folderName,
          path: workspacePath,
          defaultPermissionMode: taskPermissionToWorkspaceAccess(input.permissionMode),
          isArchived: false,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        }

        state.workspaces.unshift(newWorkspace)
        primaryWorkspaceId = newWorkspace.id
      }

      const task: Task = {
        id: createId('task'),
        title: input.title,
        mode: input.mode,
        modelId: resolvedModelId,
        expertIds: input.expertIds,
        activeExpertId: input.activeExpertId ?? input.expertIds[0],
        activeExpertTeamId: input.activeExpertTeamId,
        primaryWorkspaceId,
        permissionMode: input.permissionMode,
        connectorIds: input.connectorIds,
        skillIds: input.skillIds,
        status: 'idle',
        unreadEventCount: 0,
        createdAt: now,
        updatedAt: now,
      }
      state.tasks.unshift(task)

      state.taskWorkspaces.unshift({
        id: createId('taskWorkspace'),
        taskId: task.id,
        workspaceId: primaryWorkspaceId,
        role: 'primary',
        accessMode: taskPermissionToWorkspaceAccess(input.permissionMode),
        addedAt: now,
      })

      for (const workspaceId of input.additionalWorkspaceIds ?? []) {
        if (workspaceId !== primaryWorkspaceId) {
          state.taskWorkspaces.unshift({
            id: createId('taskWorkspace'),
            taskId: task.id,
            workspaceId,
            role: 'attached',
            accessMode: 'read_only',
            addedAt: now,
          })
        }
      }

      return task
    })

    return task
  }

  /**
   * 更新任务属性（模式、激活专家、模型、权限等）。
   */
  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    const updatedTask = await this.mutate(state => {
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

    this.emitTaskRuntimePatch(taskId, { task: updatedTask })
    return updatedTask
  }

  /**
   * 采用 B 方案：在获取到初始对话内容后，后台异步调用大语言模型解析用户意图，自动提炼生成精炼的任务标题。
   */
  async generateAndApplyTaskTitle(taskId: string, initialPrompt: string, modelId?: string): Promise<void> {
    if (!initialPrompt.trim()) return

    try {
      const resolvedModel = this.modelService.resolveModelConfig(
        this.listModelConfigs(),
        modelId,
      )

      if (!resolvedModel?.apiKey) {
        return
      }

      const model = new ChatOpenAI({
        model: resolvedModel.modelName,
        apiKey: resolvedModel.apiKey,
        temperature: 0.3,
        configuration: {
          baseURL: resolvedModel.baseUrl,
        },
      })

      const prompt = `你是一个专业的任务标题提炼助手。请根据用户发送的初始需求文本，提取或生成一个非常简短精炼的任务标题。

要求：
1. 字数严格控制在 4 到 15 个字之间；
2. 保持精炼，只返回标题文本本身，不要出现任何引号、句点、Markdown 语法或前缀说明；
3. 语言与用户输入的主语言一致。

用户需求：
${initialPrompt.slice(0, 1000)}

标题：`

      const response = await model.invoke(prompt)
      const rawText = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c: any) => typeof c === 'string' ? c : c.text ?? '').join('')
          : String(response.content ?? '')

      // 过滤思考模型（如 DeepSeek-R1、Qwen-Reasoning 等）输出的 <think>...</think> 标签与思维链
      const withoutThink = rawText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .trim()

      const cleanTitle = withoutThink
        .replace(/^["'「『【\s]+|["'」』】\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30)

      if (cleanTitle && cleanTitle.length >= 2) {
        await this.updateTask(taskId, { title: cleanTitle })
      }
    } catch (error) {
      console.warn('[AppService] LLM 自动生成任务标题失败，保持原标题:', error)
    }
  }

  /** 删除任务及其关联的消息、草稿、工作区绑定和 Agent 运行记录。 */
  async deleteTask(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.tasks = state.tasks.filter(task => task.id !== taskId)
      state.messages = state.messages.filter(message => message.taskId !== taskId)
      state.drafts = state.drafts.filter(draft => draft.taskId !== taskId)
      state.taskWorkspaces = state.taskWorkspaces.filter(relation => relation.taskId !== taskId)
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

  /** 关联并记录任务产物文件 */
  async recordTaskArtifact(taskId: string, filePath: string, workspaceId?: string): Promise<TaskArtifactRecord | null> {
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
    if (!ext) return null

    const fileName = path.basename(filePath)
    const taskWorkspaces = this.listTaskWorkspaces(taskId)
    let matchedWs = taskWorkspaces.find(tw => tw.workspaceId === workspaceId)?.workspace
    if (!matchedWs && taskWorkspaces.length > 0) {
      matchedWs = taskWorkspaces[0].workspace
    }
    const basePath = matchedWs ? matchedWs.path : path.dirname(filePath)
    const relPath = path.relative(basePath, filePath).replace(/\\/g, '/')

    let updatedTask: Task | null = null
    const record = await this.mutate(state => {
      if (!state.taskArtifacts) {
        state.taskArtifacts = []
      }
      const existingIdx = state.taskArtifacts.findIndex(
        item => item.taskId === taskId && item.absolutePath === filePath
      )
      const now = nowIso()
      const record: TaskArtifactRecord = {
        id: existingIdx >= 0 ? state.taskArtifacts[existingIdx].id : createId('artifact'),
        taskId,
        workspaceId: matchedWs?.id,
        relativePath: relPath,
        absolutePath: filePath,
        fileName,
        extension: ext,
        createdAt: existingIdx >= 0 ? state.taskArtifacts[existingIdx].createdAt : now,
        updatedAt: now,
      }
      if (existingIdx >= 0) {
        state.taskArtifacts[existingIdx] = record
      } else {
        state.taskArtifacts.unshift(record)
      }

      // 产物落盘后更新任务时间，以便渲染进程收到运行时补丁并重新扫描产物。
      const task = state.tasks.find(item => item.id === taskId)
      if (task) {
        task.updatedAt = now
        updatedTask = { ...task }
      }
      return record
    })

    if (updatedTask) {
      this.emitTaskRuntimePatch(taskId, { task: updatedTask })
    }
    return record
  }

  /** 获取指定任务绑定的产物记录列表 */
  listTaskArtifacts(taskId: string): TaskArtifactRecord[] {
    return (this.snapshot.taskArtifacts || [])
      .filter(item => item.taskId === taskId)
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
    const isFirstUserMessage = (input.role === 'user' || !input.role) &&
      this.snapshot.messages.filter(m => m.taskId === taskId && m.role === 'user').length === 0

    const message = await this.mutate(state => {
      const msg: Message = {
        id: createId('message'),
        taskId,
        role: input.role ?? 'user',
        content: input.content,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
        createdAt: nowIso(),
      }
      state.messages.push(msg)
      const task = state.tasks.find(item => item.id === taskId)
      if (task) {
        task.updatedAt = msg.createdAt
        task.unreadEventCount += msg.role === 'assistant' ? 1 : 0
      }
      return msg
    })

    if (isFirstUserMessage && input.content.trim()) {
      const task = this.snapshot.tasks.find(t => t.id === taskId)
      void this.generateAndApplyTaskTitle(taskId, input.content, task?.modelId)
    }

    return message
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
        selectedExpertTeamId: draft.selectedExpertTeamId,
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

  /** 判断工作区是否仍可接收运行时产物写回。 */
  isWorkspaceActive(workspaceId: string): boolean {
    return !this.workspaceRemovalPendingIds.has(workspaceId)
      && this.snapshot.workspaces.some(workspace => workspace.id === workspaceId && !workspace.isArchived)
  }

  /** 创建新的本地项目工作区 */
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    const workspace = await this.mutate(state => {
      const now = nowIso()
      const workspacePath = path.resolve(input.path)
      const workspaceName = path.basename(workspacePath)
      if (!workspaceName || workspaceName === '.' || workspaceName === '..') {
        throw new Error('工作区路径必须包含有效的文件夹名称。')
      }
      const normalizedPath = process.platform === 'win32' ? workspacePath.toLowerCase() : workspacePath
      const duplicate = state.workspaces.find(item => {
        const itemPath = path.resolve(item.path)
        const normalizedItemPath = process.platform === 'win32' ? itemPath.toLowerCase() : itemPath
        return normalizedItemPath === normalizedPath || item.name.toLowerCase() === workspaceName.toLowerCase()
      })
      if (duplicate) {
        throw new Error('工作区目录或名称已存在：' + workspaceName)
      }
      const workspace: Workspace = {
        id: createId('workspace'),
        name: workspaceName,
        path: workspacePath,
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

    return workspace
  }

  /**
   * 归档工作区；运行级 Docker 容器会在任务结束时自行删除，无需额外清理全局容器目录。
   * 宿主机工作区和任务关联均保留，以便后续从历史任务继续对话时恢复。
   */
  async removeWorkspace(workspaceId: string, beforeRemove?: () => Promise<void>): Promise<void> {
    const workspace = this.snapshot.workspaces.find(item => item.id === workspaceId)
    if (!workspace || workspace.isArchived) return

    this.workspaceRemovalPendingIds.add(workspaceId)
    try {
      await beforeRemove?.()
      await this.mutate(state => {
        const target = state.workspaces.find(item => item.id === workspaceId)
        if (target) {
          target.isArchived = true
          target.updatedAt = nowIso()
        }
      })
    } finally {
      this.workspaceRemovalPendingIds.delete(workspaceId)
    }
  }

  /** 恢复任务绑定的归档主工作区记录；Docker 目录会在下一轮沙箱运行时按名称自动创建。 */
  async restoreArchivedPrimaryWorkspace(taskId: string): Promise<Workspace | null> {
    const primaryRelation = this.snapshot.taskWorkspaces.find(item => item.taskId === taskId && item.role === 'primary')
    if (!primaryRelation) return null

    const workspace = this.snapshot.workspaces.find(item => item.id === primaryRelation.workspaceId)
    if (!workspace) {
      throw new Error('原工作区记录已不存在，无法恢复：' + primaryRelation.workspaceId)
    }
    if (!workspace.isArchived) return workspace
    if (!existsSync(workspace.path)) {
      throw new Error('原工作区文件夹不存在，无法恢复：' + workspace.path)
    }

    return this.mutate(state => {
      const target = state.workspaces.find(item => item.id === workspace.id)
      if (!target) {
        throw new Error('找不到原工作区记录：' + workspace.id)
      }
      target.isArchived = false
      target.updatedAt = nowIso()
      target.lastOpenedAt = target.updatedAt
      return { ...target }
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

    let queuedTask: Task | null = null
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
        if (run.kind === 'main') {
          queuedTask = { ...target }
        }
      }
    })

    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    if (queuedTask) {
      this.emitTaskRuntimePatch(taskId, { task: queuedTask })
    }
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
  async completeRuntimeRun(
    runId: string,
    content: string,
    metadata?: Record<string, unknown>,
    intermediateMessages: ReadonlyArray<RuntimeIntermediateMessage> = [],
  ): Promise<void> {
    let taskId = ''
    let completedRun: AgentRun | null = null
    let completedTask: Task | null = null
    let runStatusEvent: AgentEvent | null = null
    let runCompletedEvent: AgentEvent | null = null
    let persistedIntermediateMessages: Message[] = []
    let assistantMessage: Message | null = null
    let didComplete = false
    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      if (isTerminalRunStatus(run.status)) {
        return
      }
      taskId = run.taskId
      didComplete = true
      run.status = 'completed'
      run.currentNode = 'finished'
      run.completedAt = nowIso()
      run.updatedAt = run.completedAt
      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'completed'
        task.updatedAt = run.updatedAt
        completedTask = { ...task }
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
      persistedIntermediateMessages = intermediateMessages
        .filter(message => message.content.trim().length > 0)
        .map(message => ({
          id: createId('message'),
          taskId: run.taskId,
          runId,
          role: 'assistant' as const,
          content: message.content,
          metadata: message.metadata ? { ...message.metadata } : undefined,
          createdAt: message.createdAt,
        }))
      state.messages.push(...persistedIntermediateMessages)
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

    if (!didComplete) {
      return
    }

    this.discardPendingStreamEventPatches(runId)
    if (taskId) {
      // 先用已持久化消息替换前端暂态流，再发送完成状态，避免出现“Done 仍在输出”。
      for (const intermediateMessage of persistedIntermediateMessages) {
        this.emitTaskRuntimePatch(taskId, { message: intermediateMessage })
      }
      if (assistantMessage) {
        this.emitTaskRuntimePatch(taskId, { message: assistantMessage })
      }
      if (completedTask) {
        this.emitTaskRuntimePatch(taskId, { task: completedTask })
      }
      if (completedRun) {
        this.emitTaskRuntimePatch(taskId, { run: completedRun })
      }
      if (runStatusEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runStatusEvent })
      }
      if (runCompletedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runCompletedEvent })
      }
    }
    this.bus.emitActiveRuns(this.listActiveAgentRuns())
  }

  /**
   * 以等待方案确认 (Plan Approval) 的状态完成单次运行。
   */
  async completeRuntimeRunWithPlanApproval(
    runId: string,
    content: string,
    metadata?: Record<string, unknown>,
    intermediateMessages: ReadonlyArray<RuntimeIntermediateMessage> = [],
  ): Promise<void> {
    let taskId = ''
    let waitingRun: AgentRun | null = null
    let waitingTask: Task | null = null
    let runStatusEvent: AgentEvent | null = null
    let runCompletedEvent: AgentEvent | null = null
    let persistedIntermediateMessages: Message[] = []
    let assistantMessage: Message | null = null
    let approval: HumanApproval | null = null
    let approvalRequestedEvent: AgentEvent | null = null
    let didEnterApproval = false

    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      if (isTerminalRunStatus(run.status)) {
        return
      }

      taskId = run.taskId
      didEnterApproval = true
      run.status = 'waiting_approval'
      run.currentNode = 'plan_approval'
      run.updatedAt = nowIso()

      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'waiting_approval'
        task.updatedAt = run.updatedAt
        waitingTask = { ...task }
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

      persistedIntermediateMessages = intermediateMessages
        .filter(message => message.content.trim().length > 0)
        .map(message => ({
          id: createId('message'),
          taskId: run.taskId,
          runId,
          role: 'assistant' as const,
          content: message.content,
          metadata: message.metadata ? { ...message.metadata } : undefined,
          createdAt: message.createdAt,
        }))
      state.messages.push(...persistedIntermediateMessages)

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

    if (!didEnterApproval) {
      return
    }

    this.discardPendingStreamEventPatches(runId)
    if (taskId) {
      for (const intermediateMessage of persistedIntermediateMessages) {
        this.emitTaskRuntimePatch(taskId, { message: intermediateMessage })
      }
      if (assistantMessage) {
        this.emitTaskRuntimePatch(taskId, { message: assistantMessage })
      }
      if (waitingTask) {
        this.emitTaskRuntimePatch(taskId, { task: waitingTask })
      }
      if (waitingRun) {
        this.emitTaskRuntimePatch(taskId, { run: waitingRun })
      }
      if (runStatusEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runStatusEvent })
      }
      if (runCompletedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: runCompletedEvent })
      }
      if (approval) {
        this.emitTaskRuntimePatch(taskId, { approval })
      }
      if (approvalRequestedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: approvalRequestedEvent })
      }
    }
    this.bus.emitActiveRuns(this.listActiveAgentRuns())
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
      if (isTerminalRunStatus(run.status)) {
        return
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
    let failedTask: Task | null = null
    let failedEvent: AgentEvent | null = null
    let persistedStreamMessages: Message[] = []
    let didFail = false
    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        return
      }
      if (isTerminalRunStatus(run.status)) {
        return
      }
      taskId = run.taskId
      didFail = true
      run.status = 'failed'
      run.currentNode = 'failed'
      run.completedAt = nowIso()
      run.updatedAt = run.completedAt
      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = 'failed'
        task.updatedAt = run.updatedAt
        failedTask = { ...task }
      }
      failedEvent = this.createAgentEvent(run, 'run_failed', {
        message: error instanceof Error ? error.message : 'Unknown runtime failure',
      })
      state.agentEvents.push(failedEvent)

      // 失败前已经展示过的流式段也必须转为历史消息，避免刷新或切换任务后丢失。
      const persistedStreamEventIds = new Set(
        state.messages
          .map(message => message.metadata?.streamEventId)
          .filter((streamEventId): streamEventId is string => typeof streamEventId === 'string'),
      )
      for (const event of state.agentEvents) {
        if (
          event.runId !== runId ||
          !isStreamingAgentMessageEvent(event) ||
          persistedStreamEventIds.has(event.id)
        ) {
          continue
        }
        const content = event.payload.content
        if (typeof content !== 'string' || content.trim().length === 0) {
          continue
        }
        persistedStreamMessages.push({
          id: createId('message'),
          taskId: run.taskId,
          runId,
          role: 'assistant',
          content,
          metadata: {
            ...event.payload,
            source: 'runtime_stream',
            streamEventId: event.id,
            streaming: false,
            final: false,
          },
          createdAt: event.createdAt,
        })
      }
      state.messages.push(...persistedStreamMessages)
      failedRun = { ...run }
    })

    if (!didFail) {
      return
    }

    this.discardPendingStreamEventPatches(runId)
    if (taskId) {
      for (const streamMessage of persistedStreamMessages) {
        this.emitTaskRuntimePatch(taskId, { message: streamMessage })
      }
      if (failedTask) {
        this.emitTaskRuntimePatch(taskId, { task: failedTask })
      }
      if (failedRun) {
        this.emitTaskRuntimePatch(taskId, { run: failedRun })
      }
      if (failedEvent) {
        this.emitTaskRuntimePatch(taskId, { event: failedEvent })
      }
    }
    this.bus.emitActiveRuns(this.listActiveAgentRuns())
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
    let approvalTask: Task | null = null
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
        approvalTask = { ...task }
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
      if (approvalTask) {
        this.emitTaskRuntimePatch(taskId, { task: approvalTask })
      }
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
    let resolvedTask: Task | null = null
    let resolvedEvent: AgentEvent | null = null
    let resolvedMessage: Message | null = null
    await this.mutate(state => {
      const approval = state.approvals.find(item => item.id === approvalId)
      if (!approval) {
        throw new Error(`Approval not found: ${approvalId}`)
      }
      if (approval.decision !== 'pending') {
        throw new Error(`Approval already resolved: ${approvalId}`)
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
      if (task && task.lastRunId === run.id) {
        task.status = isPlanConfirmation
          ? (decision === 'rejected' ? 'cancelled' : 'completed')
          : decision === 'rejected'
            ? 'failed'
            : 'running'
        task.updatedAt = run.updatedAt
        resolvedTask = { ...task }
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

    if (targetTaskId) {
      if (resolvedMessage) {
        this.emitTaskRuntimePatch(targetTaskId, { message: resolvedMessage })
      }
      if (resolvedTask) {
        this.emitTaskRuntimePatch(targetTaskId, { task: resolvedTask })
      }
      if (resolvedRun) {
        this.emitTaskRuntimePatch(targetTaskId, { run: resolvedRun })
      }
      if (resolvedApproval) {
        this.emitTaskRuntimePatch(targetTaskId, { approval: resolvedApproval })
      }
      if (resolvedEvent) {
        this.emitTaskRuntimePatch(targetTaskId, { event: resolvedEvent })
      }
    }
    this.bus.emitActiveRuns(this.listActiveAgentRuns())

    if (!resolvedApproval) {
      throw new Error(`Approval not found after resolve: ${approvalId}`)
    }

    return resolvedApproval
  }

  /** 更新 AgentRun 状态并向 UI 发送更新补丁 */
  private async updateAgentRunStatus(runId: string, status: AgentRun['status']): Promise<AgentRun> {
    let taskId = ''
    let updatedRun: AgentRun | null = null
    let updatedTask: Task | null = null
    let statusEvent: AgentEvent | null = null
    let terminalEvent: AgentEvent | null = null
    let persistedStreamMessages: Message[] = []

    await this.mutate(state => {
      const run = state.agentRuns.find(item => item.id === runId)
      if (!run) {
        throw new Error(`Agent run not found: ${runId}`)
      }
      taskId = run.taskId
      run.status = status
      run.updatedAt = nowIso()
      run.currentNode = status === 'paused'
        ? 'paused'
        : status === 'running'
          ? 'execution'
          : run.currentNode
      statusEvent = this.createAgentEvent(run, 'run_status', {
        status,
        currentNode: run.currentNode,
      })
      state.agentEvents.push(statusEvent)

      const task = state.tasks.find(item => item.id === run.taskId)
      if (task && task.lastRunId === run.id) {
        task.status = status
        task.updatedAt = run.updatedAt
        updatedTask = { ...task }
      }

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        run.completedAt = nowIso()
        if (task && task.lastRunId === run.id) {
          task.updatedAt = run.updatedAt
          updatedTask = { ...task }
        }
        terminalEvent = this.createAgentEvent(
          run,
          status === 'failed' ? 'run_failed' : 'run_completed',
          { status },
        )
        state.agentEvents.push(terminalEvent)
      }

      if (status === 'cancelled') {
        const persistedStreamEventIds = new Set(
          state.messages
            .map(message => message.metadata?.streamEventId)
            .filter((streamEventId): streamEventId is string => typeof streamEventId === 'string'),
        )
        for (const event of state.agentEvents) {
          if (
            event.runId !== runId ||
            !isStreamingAgentMessageEvent(event) ||
            persistedStreamEventIds.has(event.id)
          ) {
            continue
          }
          const content = event.payload.content
          if (typeof content !== 'string' || content.trim().length === 0) {
            continue
          }
          persistedStreamMessages.push({
            id: createId('message'),
            taskId: run.taskId,
            runId,
            role: 'assistant',
            content,
            metadata: {
              ...event.payload,
              source: 'runtime_stream',
              streamEventId: event.id,
              streaming: false,
              final: false,
            },
            createdAt: event.createdAt,
          })
        }
        state.messages.push(...persistedStreamMessages)
      }

      updatedRun = { ...run }
      return updatedRun
    })

    if (!updatedRun) {
      throw new Error(`Agent run not found: ${runId}`)
    }

    if (taskId) {
      this.discardPendingStreamEventPatches(runId)
      for (const streamMessage of persistedStreamMessages) {
        this.emitTaskRuntimePatch(taskId, { message: streamMessage })
      }
      if (updatedTask) {
        this.emitTaskRuntimePatch(taskId, { task: updatedTask })
      }
      this.emitTaskRuntimePatch(taskId, { run: updatedRun })
      if (statusEvent) {
        this.emitTaskRuntimePatch(taskId, { event: statusEvent })
      }
      if (terminalEvent) {
        this.emitTaskRuntimePatch(taskId, { event: terminalEvent })
      }
    }
    this.bus.emitActiveRuns(this.listActiveAgentRuns())
    return updatedRun
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
