import type { AgentRun, CreateAgentRunInput, ExpertPreset } from '../../shared/types.js';
import type { AppService } from './app-service.js';
import type { AgentExecutor } from './agent-executor.js';
import { DeepAgentExecutor } from './deepagent-executor.js';
import { OpenAIModelService } from './openai-model-service.js';
import { ToolRegistryService } from './tool-registry-service.js';
import type {
  RuntimeContext,
  ToolDefinition,
  ToolExecutionContext,
} from './agent-runtime-types.js';

// 运行时依赖全部支持注入，方便测试时替换模型层和执行器。
type RuntimeDependencies = {
  modelService?: OpenAIModelService
  toolRegistry?: ToolRegistryService
  deepAgentExecutor?: AgentExecutor
};

export class AgentRuntimeService {
  private readonly modelService: OpenAIModelService;
  private readonly toolRegistry: ToolRegistryService;
  private readonly deepAgentExecutor: AgentExecutor;

  constructor(
    private readonly appService: AppService,
    dependencies: RuntimeDependencies = {},
  ) {
    this.modelService = dependencies.modelService ?? new OpenAIModelService();
    this.toolRegistry = dependencies.toolRegistry ?? new ToolRegistryService(appService);
    this.deepAgentExecutor = dependencies.deepAgentExecutor ?? new DeepAgentExecutor(appService, {
      modelService: this.modelService,
    });
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
    const approval = await this.appService.approveRequest(approvalId, decision, editedArgs);

    if (this.deepAgentExecutor instanceof DeepAgentExecutor) {
      const resumedPendingExecute = this.deepAgentExecutor.resolvePendingExecuteApproval(approval);
      if (resumedPendingExecute) {
        return approval;
      }
    }

    if (decision === 'rejected') {
      return approval;
    }

    // Fallback for approvals restored after process restart, where the in-memory
    // pending execute promise no longer exists. Normal approvals resume in-place
    // through resolvePendingExecuteApproval() above and must not restart the agent.
    const args = approval.editedArgs ?? approval.originalArgs ?? {};
    const originalArgs = approval.originalArgs ?? {};
    if (args.toolName !== 'execute' && originalArgs.toolName !== 'execute') {
      return approval;
    }

    const command = typeof args.command === 'string' ? args.command : '';
    const originalCommand = typeof originalArgs.command === 'string' ? originalArgs.command : '';
    if (!command.trim() && !originalCommand.trim()) {
      throw new Error('Missing approved execute command');
    }

    const run = this.appService.getAgentRun(approval.runId);
    const task = this.appService.getTask(approval.taskId);
    if (!run || !task) {
      throw new Error(`Runtime context missing for approval: ${approvalId}`);
    }

    try {
      if (this.deepAgentExecutor instanceof DeepAgentExecutor) {
        this.deepAgentExecutor.approveExecuteCommand(run.id, command || originalCommand);
        if (originalCommand && originalCommand !== command) {
          this.deepAgentExecutor.approveExecuteCommand(run.id, originalCommand);
        }
      }
      await this.executeRuntime({
        task,
        run,
        model: this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId)?.model ?? null,
        settings: this.appService.getSettings(),
      });
      return approval;
    } catch (error) {
      await this.appService.failRuntimeRun(run.id, error);
      throw error;
    }
  }

  private async executeRuntime(
    context: RuntimeContext,
  ) {
    await this.appService.resumeRuntimeRun(context.run.id);

    const systemPrompt = this.buildTaskContextPrompt(context);
    const activeExpert = this.resolveActiveExpert(context, this.appService.listExperts());

    const handledByDeepAgent = await this.deepAgentExecutor.execute({
      context,
      systemPrompt,
      activeExpert,
      tools: this.buildDeepAgentTools(),
      toolExecutionContext: this.createToolExecutionContext(context),
      assistantMetadata: this.buildAssistantMetadata(context, activeExpert),
    });
    if (!handledByDeepAgent) {
      throw new Error('DeepAgents 未能启动：请检查模型 API Key 和模型配置。');
    }
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
      '【输出要求】默认优先直接在聊天中给出完整答复、方案、正文或示例，不要把普通问答、写作、总结、方案设计等内容直接写成工作区文件。只有当用户明确要求"保存为文件""输出到工作区""生成 markdown/md 文档""落盘"或类似意思时，才允许调用 write_file 或 edit_file 产出文件。',
      '【工具说明】可用的内置工具包括：ls（列出目录）、read_file（读取文件）、write_file、edit_file、grep（在工作区内搜索文本）、glob（按模式匹配文件名）、execute（执行本地 shell 命令）、task（调度子 Agent 协作）。read_write 权限下 execute 会先等待用户确认；full_access 权限下 execute 可直接执行。此外项目挂载的 web_search 用于在设置中开启 Web 搜索后调用。',
      '【反馈要求】你在调用任何工具之前或期间，必须先向用户输出一句简短的中文规划或说明反馈（例如："好的，收到任务，我先调用 ls 查看目录..."、"已找到匹配，使用 grep 搜索内容..."），绝不允许静默调用工具。',
    ].join('\n');
  }

  private buildDeepAgentTools(): ToolDefinition[] {
    return this.toolRegistry.listTools()
  }

  private createToolExecutionContext(context: RuntimeContext): ToolExecutionContext {
    return { ...context }
  }

  private resolveActiveExpert(context: RuntimeContext, allExperts: ExpertPreset[]) {
    const expertId = context.run.expertId ?? context.task.activeExpertId;
    if (!expertId) {
      return null;
    }

    return allExperts.find(expert => expert.id === expertId) ?? null;
  }

  private buildAssistantMetadata(context: RuntimeContext, expert: ExpertPreset | null) {
    return {
      runtimeEngine: 'deepagents',
      personaSource: expert ? 'task_active_expert' : 'default',
      ...(expert
        ? {
            expertId: expert.id,
            expertName: expert.name,
          }
        : {}),
      runKind: context.run.kind,
    };
  }
}
