
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
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
import { dialog } from 'electron'

const activeRunStatuses: AgentRun['status'][] = ['queued', 'running', 'paused', 'waiting_approval']
const activeTaskStatuses: Task['status'][] = ['queued', 'running', 'paused', 'waiting_approval']
const defaultMcpConfigRaw = JSON.stringify({ mcpServers: {} }, null, 2)
const STREAM_EVENT_FLUSH_MS = 50

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

export class AppService {
  private readonly pendingStreamEventPatches = new Map<string, { taskId: string; event: AgentEvent }>()
  private streamEventFlushTimer: NodeJS.Timeout | null = null

  private state: AppState | null = null

  constructor(
    private readonly repository: AppStateRepository,
    private readonly bus: AppEventBus,
  ) {}

  async init() {
    this.state = await this.repository.load(createDefaultState())
    await this.ensureDefaultExperts()
    await this.hydrateConfigStateFromFiles()
    
    // Cleanup stuck active tasks/runs on startup
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

  private async persist() {
    if (!this.state) {
      throw new Error('App service not initialized')
    }
    await this.repository.save(this.state)
  }

  private get snapshot() {
    if (!this.state) {
      throw new Error('App service not initialized')
    }
    return this.state
  }

  private async mutate<T>(fn: (state: AppState) => T | Promise<T>): Promise<T> {
    const result = await fn(this.snapshot)
    await this.persist()
    return result
  }

  private getConfigDir() {
    return join(os.homedir(), '.anybuddy')
  }

  private getModelsConfigFile() {
    return join(this.getConfigDir(), 'models.json')
  }

  private getMcpConfigFile() {
    return join(this.getConfigDir(), 'mcp.json')
  }

  private async ensureConfigDir() {
    await mkdir(this.getConfigDir(), { recursive: true })
  }

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

  private async syncConfigFilesFromState() {
    this.snapshot.modelConfigs = sanitizeModelConfigs(this.snapshot.modelConfigs)
    await this.ensureConfigDir()
    await Promise.all([
      writeFile(this.getModelsConfigFile(), JSON.stringify(this.snapshot.modelConfigs, null, 2), 'utf8'),
      writeFile(this.getMcpConfigFile(), this.snapshot.mcpConfigRaw || defaultMcpConfigRaw, 'utf8'),
    ])
  }

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
      // Keep SQLite state when file content is invalid.
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

  getTask(taskId: string): Task | null {
    return this.snapshot.tasks.find(task => task.id === taskId) ?? null
  }

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
          accessMode: 'read_write',
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

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      const nextInput = {
        ...input,
        modelId: input.modelId ? this.resolveTaskModelId(input.modelId) : input.modelId,
      }
      Object.assign(task, nextInput, { updatedAt: nowIso() })
      return task
    })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.tasks = state.tasks.filter(task => task.id !== taskId)
      state.messages = state.messages.filter(message => message.taskId !== taskId)
      state.drafts = state.drafts.filter(draft => draft.taskId !== taskId)
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => rel.taskId !== taskId)
      state.agentRuns = state.agentRuns.filter(run => run.taskId !== taskId)
    })
  }

  async clearTaskRuns(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.agentRuns = state.agentRuns.filter(run => run.taskId !== taskId)
      state.agentEvents = state.agentEvents.filter(event => event.taskId !== taskId)
      state.approvals = state.approvals.filter(approval => approval.taskId !== taskId)
    })
    this.emitTaskRuntimeSnapshot(taskId)
  }

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

  async detachWorkspace(taskId: string, workspaceId: string): Promise<void> {
    await this.mutate(state => {
      state.taskWorkspaces = state.taskWorkspaces.filter(rel => !(rel.taskId === taskId && rel.workspaceId === workspaceId && rel.role === 'attached'))
    })
  }

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
        accessMode: 'read_write',
        addedAt: nowIso(),
      })
      return task
    })
  }

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

  listRunningTasks(): TaskSummary[] {
    return this.listTasks({ status: ['queued', 'running', 'paused', 'waiting_approval'] })
  }

  listMessages(taskId: string): Message[] {
    return this.snapshot.messages
      .filter(message => message.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

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

  async deleteMessage(messageId: string): Promise<void> {
    await this.mutate(state => {
      state.messages = state.messages.filter(message => message.id !== messageId)
    })
  }

  getDraft(taskId: string): TaskDraft | null {
    return this.snapshot.drafts.find(draft => draft.taskId === taskId) ?? null
  }

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

  async clearDraft(taskId: string): Promise<void> {
    await this.mutate(state => {
      state.drafts = state.drafts.filter(draft => draft.taskId !== taskId)
    })
  }

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

  async pickWorkspaceFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return null
    }
    return result.filePaths[0]
  }

  async listWorkspaceTasks(workspaceId: string, filter: TaskFilter = {}): Promise<TaskSummary[]> {
    return this.listTasks({ ...filter, workspaceId })
  }

  async setDefaultWorkspace(workspaceId: string): Promise<AppSettings> {
    return this.mutate(state => {
      state.settings.defaultWorkspaceId = workspaceId
      return state.settings
    })
  }

  getSettings(): AppSettings {
    return this.snapshot.settings
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutate(state => Object.assign(state.settings, patch))
  }

  listAgentRuns(): AgentRun[] {
    return [...this.snapshot.agentRuns].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  listActiveAgentRuns(): AgentRun[] {
    return this.listAgentRuns().filter(run => activeRunStatuses.includes(run.status))
  }

  listAgentEvents(taskId: string): AgentEvent[] {
    return this.snapshot.agentEvents
      .filter(event => event.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  listApprovals(taskId: string): HumanApproval[] {
    return this.snapshot.approvals
      .filter(approval => approval.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  listAgentRunsByTask(taskId: string): AgentRun[] {
    return this.listAgentRuns().filter(run => run.taskId === taskId)
  }

  listExperts(): ExpertPreset[] {
    return [...this.snapshot.experts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

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

  async deleteExpert(expertId: string): Promise<void> {
    await this.mutate(state => {
      state.experts = state.experts.filter(expert => expert.id !== expertId)
    })
  }

  listModelConfigs(): ModelConfig[] {
    return sanitizeModelConfigs(this.snapshot.modelConfigs)
  }

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
   * 返回任务运行所需的完整上下文，供 runtime 组装提示词和工具输入。
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

  getAgentRun(runId: string): AgentRun | null {
    return this.snapshot.agentRuns.find(run => run.id === runId) ?? null
  }

  getApproval(approvalId: string): HumanApproval | null {
    return this.snapshot.approvals.find(approval => approval.id === approvalId) ?? null
  }

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
   * 更新或追加运行时流式消息事件，供前端实时显示打字机效果。
   */
  async upsertAgentMessageEvent(runId: string, eventId: string, content: string, payloadPatch?: Record<string, unknown>): Promise<void> {
    let taskId = ''
    let changedEvent: AgentEvent | null = null
    await this.mutate(state => {
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

  async pauseRuntimeRun(runId: string): Promise<AgentRun> {
    return this.updateAgentRunStatus(runId, 'paused')
  }

  async resumeRuntimeRun(runId: string): Promise<AgentRun> {
    return this.updateAgentRunStatus(runId, 'running')
  }

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

  async approveRequest(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>): Promise<HumanApproval> {
    return this.approveRuntimeRequest(approvalId, decision, editedArgs)
  }

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

      run.status = decision === 'rejected' ? 'failed' : 'running'
      run.currentNode = decision === 'rejected' ? 'approval_rejected' : 'approval_resolved'
      run.updatedAt = nowIso()
      if (decision === 'rejected') {
        run.completedAt = run.updatedAt
      }

      const task = state.tasks.find(item => item.id === approval.taskId)
      if (task) {
        task.status = decision === 'rejected' ? 'failed' : 'running'
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

  async readModelsConfig(): Promise<string> {
    return JSON.stringify(sanitizeModelConfigs(this.snapshot.modelConfigs), null, 2)
  }

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

  async readMcpConfig(): Promise<string> {
    try {
      JSON.parse(this.snapshot.mcpConfigRaw)
      return this.snapshot.mcpConfigRaw
    } catch (error) {
      console.error('Failed to read mcp config from state', error)
      return defaultMcpConfigRaw
    }
  }

  async writeMcpConfig(content: string): Promise<void> {
    JSON.parse(content)
    await this.mutate(state => {
      state.mcpConfigRaw = content
    })
    await this.syncConfigFilesFromState()
  }

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
