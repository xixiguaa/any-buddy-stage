import { createAgent, tool } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { ReactAgent } from 'langchain';
import type { ModelApiMode } from '../../shared/types.js';
import type {
  ModelMessage,
  ResolvedModelConfig,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './agent-runtime-types.js';

// 统一约束传给 LangChain agent 的输入结构，先只保留当前 runtime 真正需要的 messages。
type AgentInput = {
  messages: ModelMessage[]
};

// 对外暴露一层轻量 stream 选项，避免上层直接依赖 LangChain 更复杂的类型细节。
type AgentStreamOptions = {
  streamMode?: 'values' | 'messages' | 'updates' | 'custom' | 'debug'
};

// 这是给现有 runtime 用的适配接口，而不是直接把 LangChain 的 ReactAgent 暴露出去。
export type RuntimeAgent = {
  invoke(input: AgentInput): Promise<{ messages: ModelMessage[] }>
  stream(
    input: AgentInput,
    options?: AgentStreamOptions,
  ): Promise<AsyncIterable<{ messages: ModelMessage[] }>>
};

type CreateAgentParams = {
  model: unknown
  tools: unknown[]
  systemPrompt?: string
};

// 通过依赖注入把 createAgent / ChatOpenAI 创建逻辑抽出来，便于测试时替换成假实现。
type LangChainAgentServiceDependencies = {
  createAgent?: (params: CreateAgentParams) => ReactAgent
  createChatModel?: (fields: {
    model: string
    apiKey: string
    temperature: number
    useResponsesApi: boolean
    configuration: {
      baseURL: string
    }
  }) => unknown
};

function shouldUseResponsesApi(model: ResolvedModelConfig) {
  if (model.apiMode === 'responses') {
    return true;
  }
  if (model.apiMode === 'chat_completions') {
    return false;
  }

  return model.baseUrl.toLowerCase() === 'https://api.openai.com/v1';
}

// 工具执行如果触发敏感操作恢复点，需要立刻中断当前 agent 轮次，等待确认后再恢复。
export class AgentApprovalPendingError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly result: ToolExecutionResult,
  ) {
    super(`Tool paused for confirmation: ${toolName}`);
    this.name = 'AgentApprovalPendingError';
  }
}

// 当前内部消息角色和 LangChain 兼容，因此这里只做一个显式透传点。
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

// 工具结果统一序列化成字符串，便于 LangChain agent 把它作为标准 tool output 回灌给模型。
function serializeToolResult(result: ToolExecutionResult) {
  return JSON.stringify({
    summary: result.summary,
    data: result.data,
  });
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

export class LangChainAgentService {
  private readonly createAgentFn: (params: CreateAgentParams) => ReactAgent;
  private readonly createChatModelFn: NonNullable<LangChainAgentServiceDependencies['createChatModel']>;

  constructor(dependencies: LangChainAgentServiceDependencies = {}) {
    this.createAgentFn = dependencies.createAgent ?? (params => createAgent(params as never));
    this.createChatModelFn = dependencies.createChatModel ?? (fields => new ChatOpenAI(fields));
  }

  async createRuntimeAgent(input: {
    model: ResolvedModelConfig
    tools: ToolDefinition[]
    context: ToolExecutionContext
    systemPrompt?: string
  }): Promise<RuntimeAgent> {
    if (!input.model.apiKey) {
      throw new Error(`Model apiKeyRef is not configured in environment for model: ${input.model.model.id}`);
    }

    const model = this.createChatModelFn({
      model: input.model.modelName,
      apiKey: input.model.apiKey,
      temperature: 0.2,
      useResponsesApi: shouldUseResponsesApi(input.model),
      configuration: {
        baseURL: input.model.baseUrl,
      },
    });

    const agent = this.createAgentFn({
      model,
      tools: input.tools.map(toolDefinition => this.toLangChainTool(toolDefinition, input.context)),
      systemPrompt: input.systemPrompt,
    });

    return {
      invoke: async runtimeInput => {
        const result = await agent.invoke({
          messages: this.toLangChainMessages(runtimeInput.messages),
        });

        return {
          messages: this.extractMessages(result),
        };
      },
      stream: async (runtimeInput, options = {}) => {
        const stream = await agent.stream(
          {
            messages: this.toLangChainMessages(runtimeInput.messages),
          },
          {
            streamMode: options.streamMode ?? 'values',
          },
        );

        return this.normalizeStream(stream);
      },
    };
  }

  private toLangChainMessages(messages: ModelMessage[]) {
    return messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
  }

  private toLangChainTool(toolDefinition: ToolDefinition, context: ToolExecutionContext) {
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
        // 当前阶段先允许透传任意对象参数，后面再逐步收紧到每个工具自己的 schema。
        schema: z.object({}).passthrough(),
      },
    );
  }

  private extractMessages(result: unknown): ModelMessage[] {
    if (Array.isArray(result)) {
      return this.extractMessagesFromArray(result);
    }

    if (!result || typeof result !== 'object') {
      return [];
    }

    if ('messages' in result && Array.isArray(result.messages)) {
      return result.messages.flatMap(message => this.extractMessage(message));
    }

    return this.extractMessage(result);
  }

  private extractMessagesFromArray(result: unknown[]): ModelMessage[] {
    if (result.length === 2 && this.looksLikeLangChainMessage(result[0])) {
      return this.extractMessage(result[0]);
    }

    return result.flatMap(item => this.extractMessage(item));
  }

  private looksLikeLangChainMessage(value: unknown) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      ('content' in value || 'role' in value || 'type' in value || '_getType' in value),
    );
  }

  private extractMessage(message: unknown): ModelMessage[] {
    if (!message || typeof message !== 'object') {
      return [];
    }

    const role = this.extractRole(message);
    const content = normalizeMessageContent((message as { content?: unknown }).content);

    if (!role || content === null) {
      return [];
    }

    return [{
      role,
      content,
    }];
  }

  private extractRole(message: object): ModelMessage['role'] | null {
    const directRole = (message as { role?: unknown }).role;
    if (typeof directRole === 'string') {
      return normalizeRole(directRole);
    }

    const typeProp = (message as { type?: unknown }).type;
    if (typeof typeProp === 'string') {
      return normalizeRole(typeProp);
    }

    const getType = (message as { _getType?: unknown })._getType;
    if (typeof getType === 'function') {
      const type = getType.call(message);
      if (typeof type === 'string') {
        return normalizeRole(type);
      }
    }

    const constructorName = (message as { constructor?: { name?: string } }).constructor?.name;
    if (constructorName?.toLowerCase().includes('aimessage')) {
      return 'assistant';
    }

    return null;
  }

  private async *normalizeStream(stream: AsyncIterable<unknown>) {
    for await (const chunk of stream) {
      yield {
        messages: this.extractMessages(chunk),
      };
    }
  }
}
