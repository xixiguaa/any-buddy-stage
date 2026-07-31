export type TaskMode = 'ask' | 'plan' | 'craft'
export type TaskStatus = 'idle' | 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'archived'
export type WorkspaceRole = 'primary' | 'attached'
export type WorkspaceAccessMode = 'read_only' | 'read_write'
export type PermissionMode = WorkspaceAccessMode | 'default' | 'full_access'
export type AgentRunStatus = 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'archived'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export type ModelProvider = 'builtin' | 'openai_compatible' | 'custom'
export type ModelApiMode = 'auto' | 'responses' | 'chat_completions'

export type ExpertPreset = {
  id: string
  name: string
  description: string
  skills: string[]
  isCustom?: boolean
  systemPrompt?: string
  createdAt: string
  updatedAt: string
}

export type ExpertTeamMember = {
  id: string
  name: string
  role: string
  specialty: string
  skills: string[]
  systemPrompt?: string
}

export type ExpertTeamPreset = {
  id: string
  name: string
  description: string
  members: ExpertTeamMember[]
  systemPrompt?: string
  isCustom?: boolean
  createdAt: string
  updatedAt: string
}

export type Workspace = {
  id: string
  name: string
  path: string
  icon?: string
  defaultPermissionMode: WorkspaceAccessMode
  isArchived: boolean
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string
}

export type Task = {
  id: string
  title: string
  mode: TaskMode
  modelId: string
  expertIds: string[]
  activeExpertId?: string
  activeExpertTeamId?: string
  primaryWorkspaceId?: string
  permissionMode: PermissionMode
  connectorIds: string[]
  skillIds: string[]
  status: TaskStatus
  unreadEventCount: number
  lastRunId?: string
  createdAt: string
  updatedAt: string
}

export type TaskWorkspace = {
  id: string
  taskId: string
  workspaceId: string
  role: WorkspaceRole
  accessMode: WorkspaceAccessMode
  addedAt: string
}

export type TaskWorkspaceContext = TaskWorkspace & {
  workspace: Workspace
}

export type Message = {
  id: string
  taskId: string
  runId?: string
  workspaceId?: string
  role: MessageRole
  content: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type TaskDraft = {
  taskId: string
  content: string
  selectedMode?: TaskMode
  selectedSkillIds: string[]
  selectedConnectorIds: string[]
  selectedExpertIds: string[]
  selectedExpertId?: string
  selectedExpertTeamId?: string
  updatedAt: string
}

export type AgentRun = {
  id: string
  taskId: string
  workspaceIds: string[]
  parentRunId?: string
  agentId: string
  agentName: string
  expertId?: string
  kind: 'main' | 'subagent'
  status: AgentRunStatus
  graphThreadId: string
  checkpointId?: string
  currentNode?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'edited' | 'cancelled'

export type HumanApproval = {
  id: string
  taskId: string
  runId: string
  toolCallId?: string
  reason: string
  originalArgs?: Record<string, unknown>
  editedArgs?: Record<string, unknown>
  decision: ApprovalDecision
  decidedAt?: string
  createdAt: string
  updatedAt?: string
}

export type AgentEventType =
  | 'run_started'
  | 'run_status'
  | 'agent_message'
  | 'subagent_started'
  | 'subagent_progress'
  | 'subagent_completed'
  | 'tool_called'
  | 'tool_result'
  | 'interrupt_requested'
  | 'interrupt_resolved'
  | 'approval_requested'
  | 'run_completed'
  | 'run_failed'

export type AgentEvent = {
  id: string
  taskId: string
  runId: string
  parentRunId?: string
  type: AgentEventType
  payload: Record<string, unknown>
  createdAt: string
}

export type TaskRuntimeSnapshotPayload = {
  kind: 'snapshot'
  taskId: string
  runs: AgentRun[]
  events: AgentEvent[]
  approvals: HumanApproval[]
  messages: Message[]
}

export type TaskRuntimePatchPayload = {
  kind: 'patch'
  taskId: string
  run?: AgentRun
  event?: AgentEvent
  approval?: HumanApproval
  message?: Message
  task?: Task
}

export type TaskRuntimePayload = TaskRuntimeSnapshotPayload | TaskRuntimePatchPayload

export type AppSettings = {
  networkEnabled: boolean
  webSearchEnabled: boolean
  maxConcurrentRuns: number
  defaultWorkspaceId?: string
  sandboxEnabled?: boolean
  wechatWebhook?: string
  wechatSecret?: string
  dingtalkWebhook?: string
  dingtalkSecret?: string
}

export type ModelConfig = {
  id: string
  name: string
  provider: ModelProvider
  baseUrl?: string
  apiKeyRef?: string
  modelName: string
  apiMode?: ModelApiMode
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AppState = {
  version: number
  tasks: Task[]
  taskWorkspaces: TaskWorkspace[]
  messages: Message[]
  drafts: TaskDraft[]
  workspaces: Workspace[]
  agentRuns: AgentRun[]
  agentEvents: AgentEvent[]
  approvals: HumanApproval[]
  experts: ExpertPreset[]
  expertTeams: ExpertTeamPreset[]
  modelConfigs: ModelConfig[]
  /** 任务与产物关联持久化记录 */
  taskArtifacts?: TaskArtifactRecord[]
  mcpConfigRaw: string
  settings: AppSettings
}

export type TaskSummary = {
  id: string
  title: string
  mode: TaskMode
  status: TaskStatus
  unreadEventCount: number
  primaryWorkspaceId?: string
  primaryWorkspaceName?: string
  expertIds: string[]
  updatedAt: string
}

export type WorkspaceSummary = Workspace & {
  taskCount: number
  runningTaskCount: number
  waitingApprovalCount: number
}

export type IpcError = {
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

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError }

export type TaskFilter = {
  workspaceId?: string
  status?: TaskStatus[]
  timeRange?: 'all' | 'today' | 'last_7_days' | 'last_30_days'
  keyword?: string
}

export type CreateTaskInput = {
  title: string
  mode: TaskMode
  workspaceId?: string
  additionalWorkspaceIds?: string[]
  modelId: string
  expertIds: string[]
  activeExpertId?: string
  activeExpertTeamId?: string
  permissionMode: PermissionMode
  connectorIds: string[]
  skillIds: string[]
}

export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'mode' | 'modelId' | 'expertIds' | 'activeExpertId' | 'activeExpertTeamId' | 'permissionMode' | 'connectorIds' | 'skillIds' | 'status'>>

export type CreateWorkspaceInput = {
  name: string
  path: string
  icon?: string
  defaultPermissionMode?: WorkspaceAccessMode
}

export type CreateMessageInput = {
  content: string
  role?: MessageRole
  workspaceId?: string
  metadata?: Record<string, unknown>
}

export type CreateAgentRunInput = {
  agentName: string
  kind?: 'main' | 'subagent'
  parentRunId?: string
  expertId?: string
}

/** 任务关联产物持久化记录 */
export interface TaskArtifactRecord {
  /** 记录 ID */
  id: string
  /** 关联的任务 ID */
  taskId: string
  /** 关联的工作区 ID */
  workspaceId?: string
  /** 相对工作区路径 */
  relativePath: string
  /** 磁盘绝对路径 */
  absolutePath: string
  /** 文件名 */
  fileName: string
  /** 扩展名 */
  extension: string
  /** 创建时间 */
  createdAt: string
  /** 修改时间 */
  updatedAt: string
}

/** 工作区扫描出的产物文件对象 */
export interface WorkspaceArtifact {
  /** 成果唯一标识 (可由相对路径或 hash 生成) */
  id: string
  /** 关联的任务 ID */
  taskId?: string
  /** 文件显示名称，例如 "GPT-5.5产品调研报告.docx" */
  name: string
  /** 相对工作区根目录的路径，例如 "reports/GPT-5.5产品调研报告.docx" */
  relativePath: string
  /** 磁盘绝对路径 */
  absolutePath: string
  /** 文件小写扩展名 (不含点)，例如 "docx", "pdf", "xlsx", "md", "png" */
  extension: string
  /** 文件字节大小 */
  size: number
  /** 最后修改时间 (ISO 字符串) */
  updatedAt: string
  /** 所属工作区 ID */
  workspaceId?: string
  /** 所属工作区名称 */
  workspaceName?: string
}

