import type {
  AgentEvent,
  AgentRun,
  HumanApproval,
  AppSettings,
  ModelConfig,
  ExpertPreset,
  CreateAgentRunInput,
  CreateMessageInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  IpcResult,
  Message,
  Task,
  TaskDraft,
  TaskFilter,
  TaskSummary,
  TaskWorkspaceContext,
  TaskWorkspace,
  Workspace,
  WorkspaceSummary,
  UpdateTaskInput,
} from './types.js'

export type {
  AgentEvent,
  AgentRun,
  ApprovalDecision,
  AppSettings,
  ModelConfig,
  ExpertPreset,
  CreateAgentRunInput,
  CreateMessageInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  IpcError,
  IpcResult,
  Message,
  HumanApproval,
  Task,
  TaskDraft,
  TaskFilter,
  TaskSummary,
  TaskWorkspaceContext,
  TaskWorkspace,
  UpdateTaskInput,
  Workspace,
  WorkspaceSummary,
} from './types.js'

export const IPC_CHANNELS = {
  tasksList: 'task:list',
  tasksGet: 'task:get',
  tasksCreate: 'task:create',
  tasksUpdate: 'task:update',
  tasksDelete: 'task:delete',
  tasksAttachWorkspace: 'task:attach-workspace',
  tasksDetachWorkspace: 'task:detach-workspace',
  tasksSetPrimaryWorkspace: 'task:set-primary-workspace',
  tasksListWorkspaces: 'task:list-workspaces',
  tasksMarkRead: 'task:mark-read',
  tasksListRunning: 'task:list-running',
  draftsGet: 'task:draft:get',
  draftsSave: 'task:draft:save',
  draftsClear: 'task:draft:clear',
  messagesList: 'message:list',
  messagesCreate: 'message:create',
  messagesDelete: 'message:delete',
  workspacesList: 'workspace:list',
  workspacesCreateFromPath: 'workspace:create-from-path',
  workspacesPickFolder: 'workspace:pick-folder',
  workspacesRemove: 'workspace:remove',
  workspacesOpenFolder: 'workspace:open-folder',
  workspacesListTasks: 'workspace:list-tasks',
  workspacesSetDefault: 'workspace:set-default',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  expertsList: 'experts:list',
  expertsCreate: 'experts:create',
  expertsDelete: 'experts:delete',
  agentRunsListActive: 'agent-run:list-active',
  agentRunsStart: 'agent-run:start',
  agentRunsPause: 'agent-run:pause',
  agentRunsResume: 'agent-run:resume',
  agentRunsCancel: 'agent-run:cancel',
  agentRunsApprove: 'agent-run:approve',
  agentRunsGet: 'agent-run:get',
  agentRunsListByTask: 'agent-run:list-by-task',
  agentRunsSubscribeTask: 'agent-run:subscribe-task',
  agentRunsSubscribeActive: 'agent-run:subscribe-active',
  agentRunsListEvents: 'agent-run:list-events',
  agentRunsListApprovals: 'agent-run:list-approvals',
  configReadModels: 'config:read-models',
  configWriteModels: 'config:write-models',
  configReadMcp: 'config:read-mcp',
  configWriteMcp: 'config:write-mcp',
  configListSkills: 'config:list-skills',
} as const

export type AnybuddyApi = {
  task: {
    list(filter?: TaskFilter): Promise<IpcResult<TaskSummary[]>>
    get(taskId: string): Promise<IpcResult<Task | null>>
    create(input: CreateTaskInput): Promise<IpcResult<Task>>
    update(taskId: string, input: UpdateTaskInput): Promise<IpcResult<Task>>
    delete(taskId: string): Promise<IpcResult<void>>
    attachWorkspace(taskId: string, workspaceId: string, accessMode?: 'read_only' | 'read_write'): Promise<IpcResult<TaskWorkspace>>
    detachWorkspace(taskId: string, workspaceId: string): Promise<IpcResult<void>>
    setPrimaryWorkspace(taskId: string, workspaceId: string): Promise<IpcResult<Task>>
    listWorkspaces(taskId: string): Promise<IpcResult<TaskWorkspaceContext[]>>
    markRead(taskId: string): Promise<IpcResult<Task>>
    listRunning(): Promise<IpcResult<TaskSummary[]>>
  }
  draft: {
    get(taskId: string): Promise<IpcResult<TaskDraft | null>>
    save(taskId: string, input: Omit<TaskDraft, 'taskId' | 'updatedAt'> & Partial<Pick<TaskDraft, 'updatedAt'>>): Promise<IpcResult<TaskDraft>>
    clear(taskId: string): Promise<IpcResult<void>>
  }
  message: {
    list(taskId: string): Promise<IpcResult<Message[]>>
    create(taskId: string, input: CreateMessageInput): Promise<IpcResult<Message>>
    delete(messageId: string): Promise<IpcResult<void>>
  }
  workspace: {
    list(): Promise<IpcResult<WorkspaceSummary[]>>
    createFromPath(input: CreateWorkspaceInput): Promise<IpcResult<Workspace>>
    pickFolder(): Promise<IpcResult<string | null>>
    remove(workspaceId: string): Promise<IpcResult<void>>
    openFolder(workspaceId: string): Promise<IpcResult<void>>
    listTasks(workspaceId: string, filter?: TaskFilter): Promise<IpcResult<TaskSummary[]>>
    setDefault(workspaceId: string): Promise<IpcResult<AppSettings>>
  }
  settings: {
    get(): Promise<IpcResult<AppSettings>>
    update(input: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
  }
  expert: {
    list(): Promise<IpcResult<ExpertPreset[]>>
    create(input: Omit<ExpertPreset, 'createdAt' | 'updatedAt'>): Promise<IpcResult<ExpertPreset>>
    delete(expertId: string): Promise<IpcResult<void>>
  }
  agentRun: {
    listActive(): Promise<IpcResult<AgentRun[]>>
    listByTask(taskId: string): Promise<IpcResult<AgentRun[]>>
    listEvents(taskId: string): Promise<IpcResult<AgentEvent[]>>
    listApprovals(taskId: string): Promise<IpcResult<HumanApproval[]>>
    get(runId: string): Promise<IpcResult<AgentRun | null>>
    start(taskId: string, input?: CreateAgentRunInput): Promise<IpcResult<AgentRun>>
    pause(runId: string): Promise<IpcResult<AgentRun>>
    resume(runId: string): Promise<IpcResult<AgentRun>>
    cancel(runId: string): Promise<IpcResult<AgentRun>>
    approve(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>): Promise<IpcResult<void>>
    subscribeActive(listener: (runs: AgentRun[]) => void): () => void
    subscribeTask(taskId: string, listener: (payload: { runs: AgentRun[]; events: AgentEvent[]; approvals: HumanApproval[] }) => void): () => void
  }
  config: {
    readModels(): Promise<IpcResult<string>>
    writeModels(content: string): Promise<IpcResult<void>>
    readMcp(): Promise<IpcResult<string>>
    writeMcp(content: string): Promise<IpcResult<void>>
    listSkills(): Promise<IpcResult<string[]>>
  }
}

declare global {
  interface Window {
    anybuddy: AnybuddyApi
  }
}
