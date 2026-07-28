import type { ExpertPreset, ExpertTeamPreset } from '../../shared/types.js';
import type { RuntimeContext, ToolDefinition, ToolExecutionContext } from './agent-runtime-types.js';

export type ExecuteAgentParams = {
  context: RuntimeContext
  systemPrompt: string
  activeExpert: ExpertPreset | null
  activeExpertTeam?: ExpertTeamPreset | null
  tools: ToolDefinition[]
  toolExecutionContext: ToolExecutionContext
  assistantMetadata: Record<string, unknown>
};

export interface AgentExecutor {
  execute(params: ExecuteAgentParams): Promise<boolean>
}
