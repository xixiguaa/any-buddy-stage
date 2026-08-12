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

/** 连续无模型或工具事件时自动结束，避免异常技能或上游请求让任务永久停留在执行中。 */
const AGENT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

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
  /** 当前正在执行的 Run 取消控制器。 */
  private readonly abortControllersByRunId = new Map<string, AbortController>();
  /** 当前运行关联的工作区，用于工作区删除时取消对应任务。 */
  private readonly workspaceIdsByRunId = new Map<string, string[]>();

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
    let task = this.appService.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 从历史任务继续对话时恢复被归档的主工作区记录；默认 Docker 模式随后会按工作区名称创建临时目录。
    await this.appService.restoreArchivedPrimaryWorkspace(taskId);
    task = this.appService.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const settings = this.appService.getSettings();
    console.debug('[AgentRuntime] start', {
      taskId,
      permissionMode: task.permissionMode,
    });

    // 在 AppService / 持久层记录新的 AgentRun
    const run = await this.appService.createRuntimeRun(taskId, {
      ...input,
      // 固化本轮启动时的专家，避免后续任务配置变化影响运行审计。
      expertId: input.expertId ?? task.activeExpertId,
    });
    // 解析当前任务选中的大模型配置
    const resolvedModel = this.modelService.resolveModelConfig(this.appService.listModelConfigs(), task.modelId);

    // Agent 运行时在后台异步推进，先向调用方返回 run 实体，前端通过 IPC 事件订阅观察后续状态变化
    this.executeInBackground({
      task,
      run,
      model: resolvedModel?.model ?? null,
      settings,
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
    // 先中断执行流，避免 Run 状态已取消后模型或工具仍继续工作。
    this.abortControllersByRunId.get(runId)?.abort();
    return this.appService.cancelRuntimeRun(runId);
  }

  /** 删除工作区前取消所有关联运行，避免运行继续写回已归档的工作区。 */
  async cancelWorkspaceRuns(workspaceId: string): Promise<void> {
    const runIds = Array.from(this.workspaceIdsByRunId.entries())
      .filter(([, workspaceIds]) => workspaceIds.includes(workspaceId))
      .map(([runId]) => runId);
    await Promise.all(runIds.map(runId => this.cancel(runId)));
  }

  /**
   * 处理人工审批决议（通过、拒绝或修改参数后通过）。
   * 
   * @param approvalId 审批请求 ID
   * @param decision 决议类型 ('approved' | 'rejected' | 'edited')
   * @param editedArgs 修改后的工具调用参数（若有）
   */
  async approve(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    // 命令不再逐步审批；此处仅持久化其他既有审批类型（例如计划确认）。
    return this.appService.approveRequest(approvalId, decision, editedArgs);
  }

  /** 在后台执行 Run，并在运行结束后释放取消控制器。 */
  private executeInBackground(context: RuntimeContext) {
    const controller = this.createAbortController(context.run.id);
    this.workspaceIdsByRunId.set(context.run.id, [...context.run.workspaceIds]);
    const inactivityError = new Error('Agent 连续 10 分钟未返回模型或工具进度，已自动结束。请检查技能配置、网络连接或模型服务后重试。');
    let timedOut = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshInactivityTimer = () => {
      if (controller.signal.aborted) return;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (controller.signal.aborted) return;
        timedOut = true;
        controller.abort(inactivityError);
        void this.appService.failRuntimeRun(context.run.id, inactivityError);
      }, AGENT_INACTIVITY_TIMEOUT_MS);
    };

    refreshInactivityTimer();
    void this.executeRuntime(context, controller.signal, refreshInactivityTimer)
      .catch(error => {
        // 用户主动停止后的异常不应覆盖已写入的 cancelled 状态。
        if (!controller.signal.aborted || timedOut) {
          void this.appService.failRuntimeRun(context.run.id, timedOut ? inactivityError : error);
        }
      })
      .finally(() => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        this.clearAbortController(context.run.id, controller);
        this.workspaceIdsByRunId.delete(context.run.id);
      });
  }

  /** 为 Run 创建并登记取消控制器。 */
  private createAbortController(runId: string) {
    const controller = new AbortController();
    this.abortControllersByRunId.set(runId, controller);
    return controller;
  }

  /** 仅清理当前执行实例的控制器，避免误删后续执行。 */
  private clearAbortController(runId: string, controller: AbortController) {
    if (this.abortControllersByRunId.get(runId) === controller) {
      this.abortControllersByRunId.delete(runId);
    }
  }

  /**
   * 内部核心方法：组装上下文、Prompt 与工具，交付 DeepAgentExecutor 执行。
   */
  private async executeRuntime(
    context: RuntimeContext,
    signal: AbortSignal,
    onActivity: () => void,
  ) {
    if (signal.aborted) {
      return;
    }
    onActivity();
    await this.appService.resumeRuntimeRun(context.run.id);
    if (signal.aborted) {
      return;
    }

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
      signal,
      onActivity,
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
