import type {
  AgentRun,
  AppSettings,
  ModelApiMode,
  ModelConfig,
  Task,
  TaskWorkspaceContext,
} from '../../shared/types.js'

export type RuntimeContext = {
  task: Task
  run: AgentRun
  model: ModelConfig | null
  settings: AppSettings
  taskExperts?: string[]
}

export type AgentToolName = 'web_search'

export type AgentToolCall = {
  name: AgentToolName
  arguments: Record<string, unknown>
}

export type ToolExecutionResult = {
  summary: string
  data: Record<string, unknown>
}

export type ToolExecutionContext = RuntimeContext

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
  apiMode: ModelApiMode
  apiKey: string | null
}

export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  id?: string
}

export class ModelApiModeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelApiModeMismatchError';
  }
}