import type { ExpertPreset } from '../../shared/types.js';
import type { RuntimeContext, ToolDefinition, ToolExecutionContext } from './agent-runtime-types.js';

export type ExecuteAgentParams = {
  context: RuntimeContext
  systemPrompt: string
  activeExpert: ExpertPreset | null
  tools: ToolDefinition[]
  toolExecutionContext: ToolExecutionContext
  assistantMetadata: Record<string, unknown>
};

export interface AgentExecutor {
  execute(params: ExecuteAgentParams): Promise<boolean>
}
