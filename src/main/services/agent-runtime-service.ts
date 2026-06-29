import type { AgentRun, CreateAgentRunInput } from '../../shared/types.js';
import type { AppService } from './app-service.js';
import { LangChainAgentService, AgentApprovalPendingError } from './langchain-agent-service.js';
import { OpenAIModelService } from './openai-model-service.js';
import { ToolRegistryService } from './tool-registry-service.js';
import type {
  AgentToolCall,
  ModelMessage,
  ModelToolPlan,
  RuntimeContext,
  ToolApprovalRequest,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './agent-runtime-types.js';

const defaultMaxPlanningRounds = 6;

// 运行时依赖全部支持注入，方便测试时替换模型层、工具层和 LangChain 封装层。
type RuntimeDependencies = {
  modelService?: OpenAIModelService
  toolRegistry?: ToolRegistryService
  langChainAgentService?: LangChainAgentService
  maxPlanningRounds?: number
  continueAfterApproval?: boolean
};

export class AgentRuntimeService {
  private readonly modelService: OpenAIModelService;
  private readonly toolRegistry: ToolRegistryService;
  private readonly langChainAgentService: LangChainAgentService;
  private readonly maxPlanningRounds: number;
  private readonly continueAfterApproval: boolean;

  constructor(
    private readonly appService: AppService,
    dependencies: RuntimeDependencies = {},
  ) {
    this.modelService = dependencies.modelService ?? new OpenAIModelService();
    this.toolRegistry = dependencies.toolRegistry ?? new ToolRegistryService(appService);
    this.langChainAgentService = dependencies.langChainAgentService ?? new LangChainAgentService();
    this.maxPlanningRounds = dependencies.maxPlanningRounds ?? defaultMaxPlanningRounds;
    this.continueAfterApproval = dependencies.continueAfterApproval ?? true;
  }

  async start(taskId: string, input: CreateAgentRunInput = { agentName: 'Main Agent', kind: 'main' }): Promise<AgentRun> {
    const task = this.appService.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const settings = this.appService.getSettings();
    const run = await this.appService.createRuntimeRun(taskId, input);
    const resolvedModel = this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId);

    // runtime 在后台异步推进，调用方先拿到 run，再通过事件流观察后续状态变化。
    void this.executeRuntime({
      task,
      run,
      model: resolvedModel?.model ?? null,
      settings,
    }).catch(error => {
      void this.appService.failRuntimeRun(run.id, error);
    });

    return run;
  }

  async pause(runId: string) {
    return this.appService.pauseRuntimeRun(runId);
  }

  async resume(runId: string) {
    return this.appService.resumeRuntimeRun(runId);
  }

  async cancel(runId: string) {
    return this.appService.cancelRuntimeRun(runId);
  }

  async approve(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    const approval = await this.appService.approveRuntimeRequest(approvalId, decision, editedArgs);
    if (decision === 'rejected') {
      return;
    }

    const run = this.appService.getAgentRun(approval.runId);
    const task = this.appService.getTask(approval.taskId);
    if (!run || !task) {
      throw new Error(`Runtime context missing for approval: ${approvalId}`);
    }

    try {
      // 恢复时不重新规划，而是先把被中断的工具动作真正执行掉。
      const result = await this.toolRegistry.executeApprovedAction(
        this.createToolExecutionContext({
          task,
          run,
          model: null,
          settings: this.appService.getSettings(),
        }),
        approval.editedArgs ?? approval.originalArgs ?? {},
      );

      await this.appService.appendRuntimeEvent(run.id, 'tool_result', {
        toolName: result.data.toolName ?? 'resumed_action',
        result: result.data,
        resumedFromInterrupt: true,
      });

      await this.appService.appendRuntimeMessage(
        task.id,
        run.id,
        'tool',
        `resumed_action: ${result.summary}`,
        result.data,
      );

      if (!this.continueAfterApproval) {
        await this.appService.completeRuntimeRun(run.id, result.summary);
        return;
      }

      // 默认行为是恢复后继续主循环，并且不重复追加 system prompt，避免上下文污染。
      await this.executeRuntime({
        task,
        run,
        model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId)?.model ?? null,
        settings: this.appService.getSettings(),
      }, {
        appendSystemPrompt: false,
      });
    } catch (error) {
      await this.appService.failRuntimeRun(run.id, error);
      throw error;
    }
  }

  async sendSubagentMessage(taskId: string, runId: string, content: string) {
    const task = this.appService.getTask(taskId);
    const run = this.appService.getAgentRun(runId);
    if (!task || !run) {
      throw new Error(`Runtime context missing for subagent message: ${runId}`);
    }

    const context: RuntimeContext = {
      task,
      run,
      model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId)?.model ?? null,
      settings: this.appService.getSettings(),
    };

    return this.sendSubagentMessageInternal(context, runId, content);
  }

  async stopSubagentRun(taskId: string, runId: string, reason?: string) {
    const task = this.appService.getTask(taskId);
    const run = this.appService.getAgentRun(runId);
    if (!task || !run) {
      throw new Error(`Runtime context missing for subagent stop: ${runId}`);
    }

    const context: RuntimeContext = {
      task,
      run,
      model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId)?.model ?? null,
      settings: this.appService.getSettings(),
    };

    return this.stopSubagent(context, runId, reason);
  }

  private async executeRuntime(
    context: RuntimeContext,
    options: {
      appendSystemPrompt?: boolean
    } = {},
  ) {
    await this.appService.resumeRuntimeRun(context.run.id);

    const systemPrompt = this.buildTaskContextPrompt(context);
    if (options.appendSystemPrompt !== false) {
      await this.appService.appendRuntimeMessage(context.task.id, context.run.id, 'system', systemPrompt);
    }

    // 优先走 LangChain agent。若当前没有可用模型，或 LangChain 调用异常，则回退旧规划循环。
    const handledByLangChain = await this.tryExecuteWithLangChain(context, systemPrompt);
    if (handledByLangChain) {
      return;
    }

    await this.executeLegacyPlannerLoop(context);
  }

  private async tryExecuteWithLangChain(context: RuntimeContext, systemPrompt: string): Promise<boolean> {
    console.log('[Runtime] tryExecuteWithLangChain entered');
    const resolvedModel = this.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      console.log('[Runtime] no resolved model apiKey, falling back to legacy planner');
      return false;
    }

    try {
      const taskContext = this.appService.getTaskContext(context.task.id);
      const runtimeAgent = await this.langChainAgentService.createRuntimeAgent({
        model: resolvedModel,
        tools: this.buildLangChainTools(context),
        context: this.createToolExecutionContext(context),
        systemPrompt,
      });

      const runtimeMessages = (taskContext?.messages ?? []).map<ModelMessage>(message => ({
        role: message.role,
        content: message.content,
      }));
      console.log('[Runtime] invoking stream with messages count:', runtimeMessages.length);
      const stream = await runtimeAgent.stream({
        messages: runtimeMessages,
      });

      let latestMessages: ModelMessage[] = [];
      let lastStreamedAssistantContent: string | null = null;
      for await (const chunk of stream) {
        console.log('[Runtime] stream chunk received:', JSON.stringify(chunk).slice(0, 300));
        latestMessages = chunk.messages;
        const assistantMessage = this.pickFinalAssistantMessage(chunk.messages);
        console.log('[Runtime] picked assistant message:', assistantMessage);
        if (!assistantMessage || assistantMessage === lastStreamedAssistantContent) {
          continue;
        }

        lastStreamedAssistantContent = assistantMessage;
        await this.appService.appendRuntimeEvent(context.run.id, 'agent_message', {
          role: 'assistant',
          content: assistantMessage,
          source: 'langchain_agent_stream',
        });
      }

      const finalMessage = this.pickFinalAssistantMessage(latestMessages);
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
      );
      return true;
    } catch (error) {
      console.error('[Runtime] tryExecuteWithLangChain error:', error);
      if (error instanceof AgentApprovalPendingError) {
        // 中断事件和 tool message 已经在工具执行阶段写入，这里只需停止当前轮次。
        return true;
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

  private async executeLegacyPlannerLoop(context: RuntimeContext) {
    // 当前仍然保留“多轮规划 + 工具执行”的旧外壳，作为 LangChain 路径不可用时的回退方案。
    for (let round = 0; round < this.maxPlanningRounds; round += 1) {
      const plan = await this.resolveToolPlan(context);

      if (plan.toolCalls.length === 0) {
        await this.appService.completeRuntimeRun(
          context.run.id,
          plan.finalMessage ?? 'Agent 已完成当前任务，但没有返回额外的最终说明。',
        );
        return;
      }

      if (plan.finalMessage) {
        await this.appService.appendRuntimeMessage(
          context.task.id,
          context.run.id,
          'assistant',
          plan.finalMessage,
          {
            source: 'model_planner',
            toolCount: plan.toolCalls.length,
            round: round + 1,
          },
        );
      }

      for (const tool of plan.toolCalls) {
        const result = await this.handleToolCall(context, tool);
        if (result.data.pendingApproval) {
          return;
        }
      }
    }

    throw new Error(`Agent exceeded the planning round limit (${this.maxPlanningRounds})`);
  }

  private buildTaskContextPrompt(context: RuntimeContext) {
    return [
      `任务: ${context.task.title}`,
      `模式: ${context.task.mode}`,
      `权限: ${context.task.permissionMode}`,
      `工作区数量: ${context.run.workspaceIds.length}`,
      `模型: ${context.model?.name ?? '未配置默认模型'}`,
      `网络开关: ${context.settings.networkEnabled ? '开启' : '关闭'}`,
      '说明: 当前为桌面 Agent runtime，会根据上下文持续规划、执行工具并写回事件流。',
    ].join('\n');
  }

  private async resolveToolPlan(context: RuntimeContext): Promise<ModelToolPlan> {
    const resolvedModel = this.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      return {
        toolCalls: this.buildFallbackToolPlan(context),
      };
    }

    try {
      const taskContext = this.appService.getTaskContext(context.task.id);
      const history = (taskContext?.messages ?? [])
        .slice(-8)
        .map<ModelMessage>(message => ({
          role: message.role,
          content: message.content,
        }));

      return await this.modelService.buildToolPlan(
        resolvedModel,
        [
          {
            role: 'user',
            content: [
              `任务标题: ${context.task.title}`,
              `任务模式: ${context.task.mode}`,
              `权限模式: ${context.task.permissionMode}`,
              `当前运行节点: ${context.run.currentNode ?? 'plan'}`,
            ].join('\n'),
          },
          ...history,
        ],
        this.toolRegistry.listTools().map(tool => ({
          name: tool.name,
          description: tool.description,
        })),
      );
    } catch (error) {
      await this.appService.appendRuntimeMessage(
        context.task.id,
        context.run.id,
        'system',
        `模型规划失败，已回退到内置计划：${error instanceof Error ? error.message : 'unknown error'}`,
      );

      return {
        toolCalls: this.buildFallbackToolPlan(context),
      };
    }
  }

  private buildFallbackToolPlan(context: RuntimeContext): AgentToolCall[] {
    const tools: AgentToolCall[] = [
      {
        name: 'get_task_context',
        arguments: {
          taskId: context.task.id,
        },
      },
      {
        name: 'get_run_state',
        arguments: {
          runId: context.run.id,
        },
      },
      {
        name: 'list_workspace_files',
        arguments: {
          path: '.',
        },
      },
    ];

    if (context.task.expertId && context.run.kind === 'main') {
      tools.push({
        name: 'consult_subagent',
        arguments: {
          expertId: context.task.expertId,
          reason: '请子专家补充分析结论',
        },
      });
    }

    if (context.settings.networkEnabled && context.settings.webSearchEnabled) {
      tools.push({
        name: 'web_search',
        arguments: {
          query: context.task.title,
        },
      });
    }

    if (context.task.mode !== 'ask') {
      tools.push({
        name: 'run_shell_command',
        arguments: {
          command: context.task.mode === 'craft' ? 'npm run lint' : 'git status',
        },
      });
    }

    return tools;
  }

  private buildLangChainTools(context: RuntimeContext): ToolDefinition[] {
    // 这里把 ToolRegistry 中的工具再包一层，目的是保留 runtime 侧的事件记录和消息沉淀。
    return this.toolRegistry.listTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      requiresApproval: tool.requiresApproval,
      execute: async (_toolContext, args) => this.handleToolCall(context, {
        name: tool.name,
        arguments: args,
      }),
    }));
  }

  private async handleToolCall(context: RuntimeContext, call: AgentToolCall) {
    await this.appService.appendRuntimeEvent(context.run.id, 'tool_called', {
      toolName: call.name,
      arguments: call.arguments,
    });

    const tool = this.toolRegistry.getTool(call.name);
    const result = tool
      ? await tool.execute(this.createToolExecutionContext(context), call.arguments)
      : this.buildUnsupportedToolResult(call.name);

    await this.appService.appendRuntimeEvent(context.run.id, 'tool_result', {
      toolName: call.name,
      result: result.data,
    });

    await this.appService.appendRuntimeMessage(
      context.task.id,
      context.run.id,
      'tool',
      `${call.name}: ${result.summary}`,
      result.data,
    );

    return result;
  }

  private createToolExecutionContext(context: RuntimeContext): ToolExecutionContext {
    return {
      ...context,
      requestApproval: input => this.requestApproval(context, input),
      spawnSubagent: input => this.spawnSubagent(context, input),
      sendSubagentMessage: (runId, content) => this.sendSubagentMessageInternal(context, runId, content),
      stopSubagent: (runId, reason) => this.stopSubagent(context, runId, reason),
    };
  }

  private buildUnsupportedToolResult(name: AgentToolCall['name']): ToolExecutionResult {
    return {
      summary: '当前工具在首版中尚未接入执行器。',
      data: {
        supported: false,
        toolName: name,
      },
    };
  }

  private async requestApproval(context: RuntimeContext, input: ToolApprovalRequest): Promise<ToolExecutionResult> {
    const approval = await this.appService.requestRuntimeApproval(
      context.run.id,
      input.reason,
      input.originalArgs,
    );

    return {
      summary: input.summary,
      data: {
        approvalRequested: true,
        pendingApproval: true,
        approvalId: approval.id,
        reason: input.reason,
        originalArgs: input.originalArgs,
      },
    };
  }

  private async spawnSubagent(context: RuntimeContext, input: CreateAgentRunInput & { reason?: string }): Promise<ToolExecutionResult> {
    if (context.run.kind === 'subagent') {
      return {
        summary: '当前子 Agent 不再继续派生新的子 Agent，以避免递归调度。',
        data: {
          nestedSubagentAllowed: false,
          parentRunId: context.run.id,
        },
      };
    }

    const expertId = input.expertId ?? 'default-expert';
    const reason = input.reason ?? '补充子任务分析';
    const subRun = await this.appService.createRuntimeRun(context.task.id, {
      agentName: input.agentName,
      kind: 'subagent',
      parentRunId: input.parentRunId ?? context.run.id,
      expertId,
    });

    await this.appService.appendRuntimeEvent(context.run.id, 'subagent_started', {
      subagentRunId: subRun.id,
      expertId,
      reason,
    });

    await this.appService.resumeRuntimeRun(subRun.id);

    await this.appService.appendRuntimeMessage(
      context.task.id,
      subRun.id,
      'system',
      `Subagent brief\nexpertId: ${expertId}\nreason: ${reason}\nparentTask: ${context.task.title}`,
      {
        expertId,
        parentRunId: context.run.id,
      },
    );

    try {
      await this.executeRuntime({
        task: context.task,
        run: subRun,
        model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), context.task.modelId)?.model ?? null,
        settings: this.appService.getSettings(),
      });

      const completedRun = this.appService.getAgentRun(subRun.id);
      const summary = this.appService
        .listMessages(context.task.id)
        .filter(message => message.runId === subRun.id && message.role === 'assistant')
        .at(-1)?.content
        ?? `专家 ${expertId} 已完成协作，但没有返回额外总结。`;

      await this.appService.appendRuntimeEvent(context.run.id, 'subagent_completed', {
        subagentRunId: subRun.id,
        expertId,
        summary,
        status: completedRun?.status ?? 'completed',
      });

      return {
        summary,
        data: {
          subagentRunId: subRun.id,
          expertId,
          summary,
          status: completedRun?.status ?? 'completed',
        },
      };
    } catch (error) {
      await this.appService.appendRuntimeEvent(context.run.id, 'subagent_completed', {
        subagentRunId: subRun.id,
        expertId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'unknown error',
      });
      throw error;
    }
  }

  private async sendSubagentMessageInternal(context: RuntimeContext, runId: string, content: string): Promise<ToolExecutionResult> {
    const targetRun = this.appService.getAgentRun(runId);
    if (!targetRun || targetRun.taskId !== context.task.id || targetRun.kind !== 'subagent') {
      throw new Error(`Subagent run not found in current task: ${runId}`);
    }

    await this.appService.appendSubagentMessage(runId, content, {
      requestedByRunId: context.run.id,
    });

    const subagentContext: RuntimeContext = {
      task: context.task,
      run: targetRun,
      model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), context.task.modelId)?.model ?? null,
      settings: this.appService.getSettings(),
    };

    if (typeof this.appService.resumeRuntimeRun === 'function' && typeof this.appService.failRuntimeRun === 'function') {
      void this.executeRuntime(subagentContext).catch(error => {
        void this.appService.failRuntimeRun(runId, error);
      });
    }

    return {
      summary: 'Subagent message sent and thread continues.',
      data: {
        subagentRunId: runId,
        content,
      },
    };
  }
  private async stopSubagent(context: RuntimeContext, runId: string, reason?: string): Promise<ToolExecutionResult> {
    const targetRun = this.appService.getAgentRun(runId);
    if (!targetRun || targetRun.taskId !== context.task.id || targetRun.kind !== 'subagent') {
      throw new Error(`Subagent run not found in current task: ${runId}`);
    }

    await this.appService.stopSubagentRun(runId, reason);
    await this.appService.appendRuntimeEvent(context.run.id, 'subagent_completed', {
      subagentRunId: runId,
      expertId: targetRun.agentName,
      status: 'cancelled',
      reason: reason ?? 'stopped by parent agent',
    });

    return {
      summary: `已停止子 Agent ${targetRun.agentName}。`,
      data: {
        subagentRunId: runId,
        status: 'cancelled',
        reason: reason ?? 'stopped by parent agent',
      },
    };
  }

  private pickFinalAssistantMessage(messages: ModelMessage[]) {
    const assistantMessages = messages.filter(message => message.role === 'assistant' && message.content.trim().length > 0);
    return assistantMessages.at(-1)?.content ?? null;
  }
}
