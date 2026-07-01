import { tool } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, FilesystemBackend, LocalShellBackend } from 'deepagents/node';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AppService } from './app-service.js';
import type { AgentExecutor, ExecuteAgentParams } from './agent-executor.js';
import { AgentApprovalPendingError } from './langchain-agent-service.js';
import { OpenAIModelService } from './openai-model-service.js';
import type { ModelMessage, ResolvedModelConfig, ToolDefinition, ToolExecutionResult } from './agent-runtime-types.js';
import { ModelApiModeMismatchError } from './agent-runtime-types.js';

type DeepAgentExecutorDependencies = {
  modelService: OpenAIModelService
};

function shouldUseResponsesApi(model: ResolvedModelConfig) {
  if (model.apiMode === 'chat_completions') {
    return false;
  }

  const isOpenAiUrl = /(^https:\/\/api\.openai\.com(?:\/v1)?$)/i.test(model.baseUrl);
  const isKnownNonOpenAi = /deepseek|anthropic|cohere|gemini|google|vertex|mistral|groq|openrouter|together|ollama|lm-studio|localai|lms/i.test(model.baseUrl);

  if (model.apiMode === 'responses') {
    if (isKnownNonOpenAi) {
      throw new ModelApiModeMismatchError(
        '当前模型/接口地址不支持 Responses API。请在模型配置中将该模型的 API 模式修改为 "Compatible Chat API" 或 "自动" (Auto)。'
      );
    }
    return true;
  }

  return isOpenAiUrl && !isKnownNonOpenAi;
}

function serializeToolResult(result: ToolExecutionResult) {
  return JSON.stringify({
    summary: result.summary,
    data: result.data,
  });
}

function deserializeToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return {
      raw,
    };
  }

  try {
    const parsed = JSON.parse(raw) as { summary?: unknown; data?: unknown };
    if (parsed && typeof parsed === 'object') {
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : raw,
        result: parsed.data && typeof parsed.data === 'object' ? parsed.data as Record<string, unknown> : { raw },
      };
    }
  } catch {
    // Fall through to raw string payload below.
  }

  return {
    summary: raw,
    result: {
      raw,
    },
  };
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if ('text' in item && typeof item.text === 'string') {
        return item.text;
      }

      if ('content' in item && typeof item.content === 'string') {
        return item.content;
      }

      return '';
    })
    .join('')
    .trim();

  return text || null;
}

function normalizeRole(role: string): ModelMessage['role'] | null {
  switch (role) {
    case 'assistant':
    case 'ai':
      return 'assistant';
    case 'user':
    case 'human':
      return 'user';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return null;
  }
}

function extractMessages(result: unknown): ModelMessage[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  if ('messages' in result && Array.isArray(result.messages)) {
    return result.messages.flatMap(message => extractMessage(message));
  }

  return extractMessage(result);
}

function extractMessage(message: unknown): ModelMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const directRole = (message as { role?: unknown }).role;
  const role = typeof directRole === 'string' ? normalizeRole(directRole) : null;
  const content = normalizeMessageContent((message as { content?: unknown }).content);
  if (!role || content === null) {
    return [];
  }

  return [{ role, content }];
}

export class DeepAgentExecutor implements AgentExecutor {
  constructor(
    private readonly appService: AppService,
    private readonly dependencies: DeepAgentExecutorDependencies,
  ) {}

  async execute({ context, systemPrompt, activeExpert, tools, toolExecutionContext, assistantMetadata }: ExecuteAgentParams): Promise<boolean> {
    const resolvedModel = this.dependencies.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      return false;
    }

      const taskContext = this.appService.getTaskContext(context.task.id);
      const taskWorkspaces = this.appService.listTaskWorkspaces(context.task.id);
      const primaryWorkspace = taskWorkspaces.find(workspace => workspace.role === 'primary')?.workspace;

    const backendRootDir = primaryWorkspace?.path ?? process.cwd();
    const backend = await this.createBackend(context, backendRootDir);

    try {
      const model = new ChatOpenAI({
        model: resolvedModel.modelName,
        apiKey: resolvedModel.apiKey,
        temperature: 0.2,
        useResponsesApi: shouldUseResponsesApi(resolvedModel),
        configuration: {
          baseURL: resolvedModel.baseUrl,
        },
      });

      const agent = createDeepAgent({
        model,
        backend,
        subagents: [],
        permissions: this.resolvePermissions(context, taskWorkspaces),
        // Do not enable interruptOn yet. Deepagents requires a checkpointer for
        // human-in-the-loop interrupts, while AnyBuddy currently restores
        // approvals through its own AppService/approval tables.
        tools: tools.map(toolDefinition => this.toDeepAgentTool(toolDefinition, toolExecutionContext)),
        memory: this.resolveMemoryFiles(backendRootDir),
        skills: this.resolveSkillSources(context.task.skillIds, backendRootDir),
        systemPrompt: activeExpert
          ? [
              `你当前以专家 ${activeExpert.name} (专家 ID: ${activeExpert.id}) 的身份工作。`,
              `你的定位/擅长领域: ${activeExpert.description}`,
              activeExpert.systemPrompt ? `专家专属系统提示词:\n${activeExpert.systemPrompt}` : '',
              '你正在同一个任务的共享上下文中继续工作。不要把历史上下文视为新的任务，也不要假设需要将任务拆分给其他专家。',
              '请以当前专家视角继续分析、回答或执行。',
              '---',
              systemPrompt,
            ].filter(Boolean).join('\n')
          : systemPrompt,
      });

      const run = await agent.streamEvents({
        messages: (taskContext?.messages ?? []).map(message => ({
          role: message.role === 'tool' ? 'user' : message.role,
          content: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content,
        })),
      }, {
        version: 'v3',
      });

      const accumulatedMessagesMap = new Map<string, string>();
      let streamIndex = 0;
      const streamingPayloadPatch = {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
        streaming: true,
      };
      const consumeMessages = async () => {
        for await (const messageRun of run.messages) {
          const msgId = `deepagent-${streamIndex++}`;
          let content = '';
          for await (const token of messageRun.text) {
            content += token;
            accumulatedMessagesMap.set(msgId, content);
            await this.appService.upsertAgentMessageEvent(context.run.id, `msg-${msgId}`, content, streamingPayloadPatch);
          }
        }
      };

      const consumeToolCalls = async () => {
        let toolIndex = 0;
        for await (const call of run.toolCalls) {
          const toolEventId = `deepagent-tool-${toolIndex++}`;
          await this.appService.appendRuntimeEvent(context.run.id, 'tool_called', {
            toolName: call.name,
            arguments: call.input && typeof call.input === 'object' ? call.input as Record<string, unknown> : {},
            runtimeEngine: 'deepagents',
          });

          try {
            const output = await call.output;
            const parsed = deserializeToolResult(output);
            await this.appService.appendRuntimeEvent(context.run.id, 'tool_result', {
              toolName: call.name,
              result: 'result' in parsed ? parsed.result : parsed,
              summary: parsed.summary,
              runtimeEngine: 'deepagents',
              toolEventId,
            });
          } catch (error) {
            await this.appService.appendRuntimeEvent(context.run.id, 'tool_result', {
              toolName: call.name,
              result: {
                error: error instanceof Error ? error.message : String(error),
              },
              runtimeEngine: 'deepagents',
              toolEventId,
            });
          }
        }
      };

      await Promise.all([
        consumeMessages(),
        consumeToolCalls(),
      ]);

      const finalMessage = Array.from(accumulatedMessagesMap.values()).at(-1);
      if (!finalMessage) {
        return false;
      }

      await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
        status: 'running',
        currentNode: 'stream_completed',
      });

      await this.appService.completeRuntimeRun(context.run.id, finalMessage, {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
      });
      return true;
    } catch (error) {
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
        `DeepAgents 执行失败，已回退到 LangChain：${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    } finally {
      if ('close' in backend && typeof backend.close === 'function') {
        await backend.close();
      }
    }
  }

  private toDeepAgentTool(toolDefinition: ToolDefinition, context: ExecuteAgentParams['toolExecutionContext']) {
    const description = toolDefinition.requiresApproval
      ? `${toolDefinition.description} (pauses for confirmation before side effects)`
      : toolDefinition.description;

    return tool(
      async (args: Record<string, unknown>) => {
        const result = await toolDefinition.execute(context, args);
        if (result.data.pendingApproval) {
          throw new AgentApprovalPendingError(toolDefinition.name, result);
        }
        return serializeToolResult(result);
      },
      {
        name: toolDefinition.name,
        description,
        schema: z.object({}).passthrough(),
      },
    );
  }

  private resolveMemoryFiles(rootDir: string) {
    const projectAgentFile = path.resolve(process.cwd(), 'AGENTS.md');
    const virtualPath = this.toBackendVirtualPath(rootDir, projectAgentFile)
    return virtualPath ? [virtualPath] : [];
  }

  private resolveSkillSources(skillIds: string[], rootDir: string) {
    const uniqueSkillIds = Array.from(new Set(skillIds.filter(Boolean)));
    return uniqueSkillIds
      .map(skillId => {
        const skillDir = path.resolve(process.cwd(), '.agents', 'skills', skillId);
        const skillFile = path.join(skillDir, 'SKILL.md')
        if (!existsSync(skillFile)) {
          return null
        }

        return this.toBackendVirtualPath(rootDir, skillDir)
      })
      .filter((item): item is string => Boolean(item));
  }

  private toBackendVirtualPath(rootDir: string, absolutePath: string) {
    const normalizedRoot = path.resolve(rootDir)
    const normalizedTarget = path.resolve(absolutePath)
    const relativePath = path.relative(normalizedRoot, normalizedTarget)
    if (!relativePath || relativePath === '') {
      return '/'
    }

    const normalizedRelative = relativePath.replace(/\\/g, '/')
    if (normalizedRelative.startsWith('..')) {
      return null
    }

    return `/${normalizedRelative}`
  }

  private async createBackend(context: ExecuteAgentParams['context'], rootDir: string) {
    if (context.task.permissionMode === 'full_access') {
      return LocalShellBackend.create({
        rootDir,
        virtualMode: true,
      });
    }

    return new FilesystemBackend({
      rootDir,
      virtualMode: true,
    });
  }

  private resolvePermissions(context: ExecuteAgentParams['context'], taskWorkspaces: ReturnType<AppService['listTaskWorkspaces']>) {
    if (context.task.permissionMode === 'full_access') {
      return undefined;
    }

    const normalizeWorkspacePath = (workspacePath: string) => {
      const normalized = workspacePath.replace(/\\/g, '/').replace(/\/+$|\/+$/g, '');
      const withoutDrive = normalized.replace(/^[A-Za-z]:/, '');
      return withoutDrive.startsWith('/') ? withoutDrive : `/${withoutDrive}`;
    };

    const allowedRules = taskWorkspaces.flatMap(workspace => {
      const basePath = normalizeWorkspacePath(workspace.workspace.path);
      const readRule = {
        operations: ['read'] as const,
        paths: [`${basePath}/**`, basePath],
      };

      if (workspace.accessMode === 'read_write') {
        return [
          readRule,
          {
            operations: ['write'] as const,
            paths: [`${basePath}/**`, basePath],
          },
        ];
      }

      return [readRule];
    });

    return [
      ...allowedRules,
      {
        operations: ['read', 'write'] as const,
        paths: ['/**'],
        mode: 'deny' as const,
      },
    ];
  }
}
