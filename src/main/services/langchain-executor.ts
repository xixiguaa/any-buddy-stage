import type { AppService } from './app-service.js';
import type { AgentExecutor, ExecuteAgentParams } from './agent-executor.js';
import { LangChainAgentService, AgentApprovalPendingError } from './langchain-agent-service.js';
import { OpenAIModelService } from './openai-model-service.js';
import { ModelApiModeMismatchError } from './agent-runtime-types.js';

type LangChainExecutorDependencies = {
  modelService: OpenAIModelService
  langChainAgentService?: LangChainAgentService
};

export class LangChainExecutor implements AgentExecutor {
  private readonly langChainAgentService: LangChainAgentService;

  constructor(
    private readonly appService: AppService,
    private readonly dependencies: LangChainExecutorDependencies,
  ) {
    this.langChainAgentService = dependencies.langChainAgentService ?? new LangChainAgentService();
  }

  async execute({ context, systemPrompt, activeExpert, tools, toolExecutionContext, assistantMetadata }: ExecuteAgentParams): Promise<boolean> {
    console.log('[Runtime] tryExecuteWithLangChain entered');
    const resolvedModel = this.dependencies.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      console.log('[Runtime] no resolved model apiKey, falling back to legacy planner');
      return false;
    }

    try {
      const taskContext = this.appService.getTaskContext(context.task.id);
      const customSystemPrompt = activeExpert
        ? [
            `你当前以专家 ${activeExpert.name} (专家 ID: ${activeExpert.id}) 的身份工作。`,
            `你的定位/擅长领域: ${activeExpert.description}`,
            activeExpert.systemPrompt ? `专家专属系统提示词:\n${activeExpert.systemPrompt}` : '',
            '你正在同一个任务的共享上下文中继续工作。不要把历史上下文视为新的任务，也不要假设需要将任务拆分给其他专家。',
            '请以当前专家视角继续分析、回答或执行。',
            '---',
            systemPrompt,
          ].filter(Boolean).join('\n')
        : systemPrompt;

      const runtimeAgent = await this.langChainAgentService.createRuntimeAgent({
        model: resolvedModel,
        tools,
        context: toolExecutionContext,
        systemPrompt: customSystemPrompt,
      });

      const runtimeMessages = (taskContext?.messages ?? []).map(message => ({
        role: message.role,
        content: message.content,
      }));
      console.log('[Runtime] invoking stream with messages count:', runtimeMessages.length);
      const stream = await runtimeAgent.stream({
        messages: runtimeMessages,
      }, {
        streamMode: 'messages',
      });

      const accumulatedMessagesMap = new Map<string, string>();
      const streamingPayloadPatch = {
        ...assistantMetadata,
        streaming: true,
      };
      let turnIndex = 0;
      for await (const chunk of stream) {
        console.log('[Runtime] stream chunk received:', JSON.stringify(chunk).slice(0, 300));

        const assistantMsgs = chunk.messages.filter((m: any) => m.role === 'assistant');
        for (const msg of assistantMsgs) {
          if (!msg.content) continue;

          const msgId = msg.id || `default-streaming-${turnIndex}`;
          const prevContent = accumulatedMessagesMap.get(msgId) || '';
          const newContent = prevContent + msg.content;
          accumulatedMessagesMap.set(msgId, newContent);

          const eventId = `msg-${msgId}`;
          await this.appService.upsertAgentMessageEvent(context.run.id, eventId, newContent, streamingPayloadPatch);
        }

        const hasToolCall = chunk.messages.some((m: any) => m.role === 'assistant' && (m as any).tool_calls?.length > 0);
        if (hasToolCall) {
          turnIndex += 1;
        }
      }

      let finalMessage: string | undefined;
      const keys = Array.from(accumulatedMessagesMap.keys());
      if (keys.length > 0) {
        finalMessage = accumulatedMessagesMap.get(keys[keys.length - 1]);
      }

      console.log('[Runtime] finalMessage:', finalMessage);
      if (finalMessage) {
        await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
          status: 'running',
          currentNode: 'stream_completed',
        });
      }

      await this.appService.completeRuntimeRun(
        context.run.id,
        finalMessage ?? 'Agent 已完成当前任务，但没有返回额外的最终说明。',
        assistantMetadata,
      );
      return true;
    } catch (error) {
      console.error('[Runtime] tryExecuteWithLangChain error:', error);
      if (error instanceof AgentApprovalPendingError) {
        return true;
      }
      if (error instanceof ModelApiModeMismatchError) {
        throw error;
      }

      await this.appService.appendRuntimeMessage(
        context.task.id,
        context.run.id,
        'system',
        `LangChain agent 执行失败，已回退到内置规划循环：${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }
}
