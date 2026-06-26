export type TaskMode = 'ask' | 'plan' | 'craft'
export type TaskStatus = 'idle' | 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'archived'
export type PermissionMode = 'default' | 'full_access'
export type WorkspaceRole = 'primary' | 'attached'
export type WorkspaceAccessMode = 'read_only' | 'read_write'
export type AgentRunStatus = 'queued' | 'running' | 'paused' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'archived'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

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
  expertId?: string
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
  selectedSkillIds: string[]
  selectedConnectorIds: string[]
  updatedAt: string
}

export type AgentRun = {
  id: string
  taskId: string
  workspaceIds: string[]
  parentRunId?: string
  agentId: string
  agentName: string
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
}

export type AgentEventType =
  | 'run_started'
  | 'run_status'
  | 'agent_message'
  | 'subagent_started'
  | 'interrupt_requested'
  | 'interrupt_resolved'
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
  expertId?: string
  permissionMode: PermissionMode
  connectorIds: string[]
  skillIds: string[]
}

export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'mode' | 'modelId' | 'expertId' | 'permissionMode' | 'connectorIds' | 'skillIds' | 'status'>>

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
}
