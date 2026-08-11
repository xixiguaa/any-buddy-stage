import type { ExpertPreset, ExpertTeamPreset } from '../../shared/types.js';
import type { RuntimeContext, ToolDefinition, ToolExecutionContext } from './agent-runtime-types.js';

export type ExecuteAgentParams = {
  context: RuntimeContext
  /** 用于停止当前 Agent Run 的取消信号。 */
  signal?: AbortSignal
  /** 每收到模型流式分块或工具事件时调用，用于续期运行时无进展看门狗。 */
  onActivity?: () => void
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
