import type { AgentRun, CreateAgentRunInput, ExpertPreset, ExpertTeamPreset } from '../../shared/types.js';
import { BASE_AGENT_SYSTEM_PROMPT, MODE_POLICY_PROMPTS } from '../../shared/prompts/index.js';
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

/**
 * 运行时依赖配置项。
 * 允许在单元测试或集成测试中注入 Mock 实现，替代真实的模型层和执行引擎。
 */
type RuntimeDependencies = {
  modelService?: OpenAIModelService;
  toolRegistry?: ToolRegistryService;
  deepAgentExecutor?: AgentExecutor;
};

/**
 * Agent 运行时服务 (AgentRuntimeService)
 * 
 * 主进程中 Agent 执行的门面与协调服务：
 * 1. 负责管理 AgentRun 的生命周期（启动、暂停、恢复、取消、失败）。
 * 2. 负责构建全局系统提示词 (System Prompt)、解析模式策略 (Ask/Plan/Craft) 与专家 Persona。
 * 3. 负责筛选并挂载适合当前任务的拓展工具 (如 web_search)。
 * 4. 负责对接底层 DeepAgentExecutor 执行引擎，并协调人工敏感操作的确认/恢复流程。
 */
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

  /**
   * 启动指定 Task 的新一轮 Agent 运行 (AgentRun)。
   * 
   * @param taskId 目标任务 ID
   * @param input 创建运行的元数据输入（Agent 名称、Kind 等）
   * @returns 初始创建的 AgentRun 实体对象
   */
  async start(taskId: string, input: CreateAgentRunInput = { agentName: 'Main Agent', kind: 'main' }): Promise<AgentRun> {
    const task = this.appService.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const settings = this.appService.getSettings();
    console.debug('[AgentRuntime] start', {
      taskId,
      permissionMode: task.permissionMode,
    });

    // 在 AppService / 持久层记录新的 AgentRun
    const run = await this.appService.createRuntimeRun(taskId, input);
    // 解析当前任务选中的大模型配置
    const resolvedModel = this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId);

    // Agent 运行时在后台异步推进，先向调用方返回 run 实体，前端通过 IPC 事件订阅观察后续状态变化
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

  /**
   * 暂停指定运行。
   */
  async pause(runId: string) {
    return this.appService.pauseRuntimeRun(runId);
  }

  /**
   * 恢复指定运行。
   */
  async resume(runId: string) {
    return this.appService.resumeRuntimeRun(runId);
  }

  /**
   * 取消指定运行。
   */
  async cancel(runId: string) {
    return this.appService.cancelRuntimeRun(runId);
  }

  /**
   * 处理人工审批决议（通过、拒绝或修改参数后通过）。
   * 
   * @param approvalId 审批请求 ID
   * @param decision 决议类型 ('approved' | 'rejected' | 'edited')
   * @param editedArgs 修改后的工具调用参数（若有）
   */
  async approve(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    // 1. 持久化审批决议
    const approval = await this.appService.approveRequest(approvalId, decision, editedArgs);

    // 2. 若执行引擎在线，优先尝试在内存中恢复挂起的 Promise 任务
    if (this.deepAgentExecutor instanceof DeepAgentExecutor) {
      const resumedPendingExecute = this.deepAgentExecutor.resolvePendingExecuteApproval(approval);
      if (resumedPendingExecute) {
        return approval;
      }
    }

    // 3. 如果用户选择拒绝，则无需启动恢复执行
    if (decision === 'rejected') {
      return approval;
    }

    // 4. 进程重启后的离线恢复保底机制：
    // 当应用重启后，内存中的挂起 Promise 已不存在，此时对于敏感命令执行审批，从审批记录读取命令并重新拉起 Agent 运行。
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
      // 重新拉起 Agent 异步运行
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

  /**
   * 内部核心方法：组装上下文、Prompt 与工具，交付 DeepAgentExecutor 执行。
   */
  private async executeRuntime(
    context: RuntimeContext,
  ) {
    await this.appService.resumeRuntimeRun(context.run.id);

    // 1. 根据任务配置筛选可用拓展工具
    const tools = this.buildDeepAgentTools(context);
    // 2. 构建全局任务上下文系统提示词 (System Prompt)
    const systemPrompt = this.buildTaskContextPrompt(context, tools);
    // 3. 解析当前激活的专家 Preset（Persona）
    const activeExpert = this.resolveActiveExpert(context, this.appService.listExperts());
    const activeExpertTeam = this.resolveActiveExpertTeam(context, this.appService.listExpertTeams());

    // 4. 调用底层 DeepAgentExecutor 引擎推进 Agent 轮次
    const handledByDeepAgent = await this.deepAgentExecutor.execute({
      context,
      systemPrompt,
      activeExpert,
      activeExpertTeam,
      tools,
      toolExecutionContext: this.createToolExecutionContext(context),
      assistantMetadata: this.buildAssistantMetadata(context, activeExpert, activeExpertTeam),
    });

    if (!handledByDeepAgent) {
      throw new Error('DeepAgents 未能启动：请检查模型 API Key 和模型配置。');
    }
  }

  /**
   * 构建完整的任务上下文系统提示词 (System Prompt)。
   * 包含模式策略、挂载工具列表、工作区信息、权限限制、输出要求及工具反馈规则。
   */
  private buildTaskContextPrompt(context: RuntimeContext, tools: ToolDefinition[]) {
    const modeInstruction = this.buildModeInstruction(context.task.mode);
    const mountedProjectTools = tools.map(tool => tool.name).join(', ') || 'none';

    return [
      modeInstruction,
      `Mounted project tools: ${mountedProjectTools}`,
      'Only project tools listed above are mounted for this task. Do not call unlisted project tools.',
      `任务: ${context.task.title}`,
      `模式: ${context.task.mode}`,
      `权限: ${context.task.permissionMode}`,
      `工作区数量: ${context.run.workspaceIds.length}`,
      `模型: ${context.model?.name ?? '未配置默认模型'}`,
      `网络开关: ${context.settings.networkEnabled ? '开启' : '关闭'}`,
      BASE_AGENT_SYSTEM_PROMPT,
    ].join('\n');
  }

  /**
   * 根据任务模式 (Ask / Plan / Craft) 生成对应的行动策略约束指令。
   */
  private buildModeInstruction(mode: RuntimeContext['task']['mode']) {
    return MODE_POLICY_PROMPTS[mode] ?? MODE_POLICY_PROMPTS.craft;
  }

  /**
   * 筛选属于当前任务选中 Connector 插件的工具列表。
   */
  private buildDeepAgentTools(context: RuntimeContext): ToolDefinition[] {
    const selectedConnectors = new Set(context.task.connectorIds);
    return this.toolRegistry.listTools().filter(tool => {
      if (!tool.connectorId) {
        return true;
      }
      return selectedConnectors.has(tool.connectorId);
    });
  }

  /**
   * 创建传递给工具执行函数的上下文对象。
   */
  private createToolExecutionContext(context: RuntimeContext): ToolExecutionContext {
    return { ...context };
  }

  /**
   * 解析当前 Agent 轮次对应的激活专家预设 (ExpertPreset)。
   */
  private resolveActiveExpert(context: RuntimeContext, allExperts: ExpertPreset[]) {
    const expertId = context.run.expertId ?? context.task.activeExpertId;
    if (!expertId) {
      return null;
    }

    return allExperts.find(expert => expert.id === expertId) ?? null;
  }

  /**
   * 解析当前 Agent 轮次对应的激活专家团 (ExpertTeamPreset)。
   */
  private resolveActiveExpertTeam(context: RuntimeContext, allExpertTeams: ExpertTeamPreset[]) {
    const teamId = context.task.activeExpertTeamId;
    if (!teamId) {
      return null;
    }

    return allExpertTeams.find(team => team.id === teamId) ?? null;
  }

  /**
   * 构建附加在 Assistant 消息事件元数据上的描述信息（包含引擎类型、专家 ID、专家名称等）。
   */
  private buildAssistantMetadata(context: RuntimeContext, expert: ExpertPreset | null, expertTeam?: ExpertTeamPreset | null) {
    return {
      runtimeEngine: 'deepagents',
      personaSource: expertTeam ? 'task_active_expert_team' : expert ? 'task_active_expert' : 'default',
      ...(expert
        ? {
            expertId: expert.id,
            expertName: expert.name,
          }
        : {}),
      ...(expertTeam
        ? {
            expertTeamId: expertTeam.id,
            expertTeamName: expertTeam.name,
          }
        : {}),
      runKind: context.run.kind,
    };
  }
}
