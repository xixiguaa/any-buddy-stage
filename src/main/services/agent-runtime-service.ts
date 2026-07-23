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

    // 4. 调用底层 DeepAgentExecutor 引擎推进 Agent 轮次
    const handledByDeepAgent = await this.deepAgentExecutor.execute({
      context,
      systemPrompt,
      activeExpert,
      tools,
      toolExecutionContext: this.createToolExecutionContext(context),
      assistantMetadata: this.buildAssistantMetadata(context, activeExpert),
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
      '说明: 当前为桌面 Agent runtime，会根据上下文持续规划、执行工具并写回事件流。',
      '【输出要求】默认优先直接在聊天中给出完整答复、方案、正文或示例，不要把普通问答、写作、总结、方案设计等内容直接写成工作区文件。只有当用户明确要求"保存为文件""输出到工作区""生成 markdown/md 文档""落盘"或类似意思时，才允许调用 write_file 或 edit_file 产出文件。',
      '【工具说明】可用的内置工具包括：ls（列出目录）、read_file（读取文件）、write_file、edit_file、grep（在工作区内搜索文本）、glob（按模式匹配文件名）、execute（执行本地 shell 命令）、task（调度子 Agent 协作）。read_write 权限下 execute 会先等待用户确认；full_access 权限下 execute 可直接执行。此外项目挂载的 web_search 用于在设置中开启 Web 搜索后调用。',
      '【反馈要求】你在调用任何工具之前或期间，必须先向用户输出一句简短的中文规划或说明反馈（例如："好的，收到任务，我先调用 ls 查看目录..."、"已找到匹配，使用 grep 搜索内容..."），绝不允许静默调用工具。',
    ].join('\n');
  }

  /**
   * 根据任务模式 (Ask / Plan / Craft) 生成对应的行动策略约束指令。
   */
  private buildModeInstruction(mode: RuntimeContext['task']['mode']) {
    if (mode === 'ask') {
      return [
        'Mode policy: ASK.',
        'Only answer, explain, inspect, search, or read context.',
        'You may use tools to inspect context, but do not edit files or write files.',
      ].join('\n');
    }

    if (mode === 'plan') {
      return [
        'Mode policy: PLAN.',
        'First analyze the request and produce a concrete step-by-step execution plan, then stop.',
        'You may inspect files, search, and run commands needed to understand the task, but do not write files or edit files before the user approves the plan.',
        'The plan must clearly list what will be done first, second, and later. After the plan is produced, the app will show Confirm and Cancel buttons. Only a confirmed plan may continue in Craft mode.',
      ].join('\n');
    }

    return [
      'Mode policy: CRAFT.',
      'Execute the approved or requested work. You may edit files and run necessary commands while respecting the configured permission mode.',
    ].join('\n');
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
   * 构建附加在 Assistant 消息事件元数据上的描述信息（包含引擎类型、专家 ID、专家名称等）。
   */
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
