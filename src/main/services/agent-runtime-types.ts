import type {
  AgentRun,
  AppSettings,
  CreateAgentRunInput,
  ModelConfig,
  Task,
  TaskWorkspaceContext,
} from '../../shared/types.js'

export type RuntimeContext = {
  task: Task
  run: AgentRun
  model: ModelConfig | null
  settings: AppSettings
}

export type AgentToolName =
  | 'read_workspace_file'
  | 'write_workspace_file'
  | 'edit_workspace_file'
  | 'search_workspace'
  | 'list_workspace_files'
  | 'post_message'
  | 'request_approval'
  | 'consult_subagent'
  | 'web_search'
  | 'run_shell_command'
  | 'get_task_context'
  | 'get_run_state'

export type AgentToolCall = {
  name: AgentToolName
  arguments: Record<string, unknown>
}

export type ToolExecutionResult = {
  summary: string
  data: Record<string, unknown>
}

export type ToolExecutionContext = RuntimeContext & {
  requestApproval(input: ToolApprovalRequest): Promise<ToolExecutionResult>
  spawnSubagent(input: CreateAgentRunInput & { reason?: string }): Promise<ToolExecutionResult>
}

export type AllowedShellCommand = {
  command: string
  executable: string
  args: string[]
}

export type ToolDefinition = {
  name: AgentToolName
  description: string
  requiresApproval: boolean
  execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolExecutionResult>
}

export type ToolApprovalRequest = {
  reason: string
  originalArgs: Record<string, unknown>
  summary: string
}

export type TaskContextSnapshot = {
  task: Task
  workspaces: TaskWorkspaceContext[]
  messageCount: number
  approvalCount: number
}

export type ResolvedModelConfig = {
  model: ModelConfig
  baseUrl: string
  modelName: string
  apiKey: string | null
}

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export type ModelToolPlan = {
  toolCalls: AgentToolCall[]
  finalMessage?: string
}
