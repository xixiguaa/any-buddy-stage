import process from 'node:process';
import OpenAI from 'openai';
import type { ModelApiMode, ModelConfig } from '../../shared/types.js';
import type {
  AgentToolCall,
  ModelMessage,
  ModelToolPlan,
  ResolvedModelConfig,
} from './agent-runtime-types.js';

const defaultBaseUrl = 'https://api.openai.com/v1';

function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return defaultBaseUrl;
  }

  return trimmed.replace(/\/+$/, '');
}

function normalizeApiMode(value?: ModelApiMode) {
  return value ?? 'auto';
}

function shouldUseResponsesApi(model: ResolvedModelConfig) {
  if (model.apiMode === 'responses') {
    return true;
  }
  if (model.apiMode === 'chat_completions') {
    return false;
  }

  return /(^https:\/\/api\.openai\.com(?:\/v1)?$)|(^https:\/\/api\.openai\.com\/v1$)/i.test(model.baseUrl);
}

function extractJsonBlock(content: string) {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return content.trim();
}

function extractTextContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  // 兼容分段内容响应，尽量提取出后续 JSON 解析需要的纯文本。
  return content
    .map(item => (
      item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
        ? item.text
        : ''
    ))
    .join('')
    .trim();
}

function toChatCompletionMessages(
  systemInstruction: string,
  messages: ModelMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    ...messages.map(message => {
      // 运行时内部存在 tool 消息，但 chat.completions 需要标准消息结构，这里降级成 assistant 文本上下文。
      if (message.role === 'tool') {
        return {
          role: 'assistant',
          content: `Tool result:\n${message.content}`,
        } satisfies OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
      }

      return {
        role: message.role,
        content: message.content,
      } satisfies
        | OpenAI.Chat.Completions.ChatCompletionSystemMessageParam
        | OpenAI.Chat.Completions.ChatCompletionUserMessageParam
        | OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
    }),
  ];
}

function normalizeToolCalls(rawValue: unknown): AgentToolCall[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map(item => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const name = typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name
        : null;

      const args = (item as { arguments?: unknown }).arguments;
      if (!name || !args || typeof args !== 'object' || Array.isArray(args)) {
        return null;
      }

      return {
        name: name as AgentToolCall['name'],
        arguments: args as Record<string, unknown>,
      };
    })
    .filter((item): item is AgentToolCall => Boolean(item));
}

export class OpenAIModelService {
  resolveModelConfig(models: ModelConfig[], taskModelId?: string): ResolvedModelConfig | null {
    const model = this.pickModel(models, taskModelId);
    if (!model) {
      return null;
    }

    return {
      model,
      baseUrl: normalizeBaseUrl(model.baseUrl),
      modelName: model.modelName,
      apiMode: normalizeApiMode(model.apiMode),
      apiKey: this.resolveApiKey(model),
    };
  }

  async buildToolPlan(
    model: ResolvedModelConfig,
    messages: ModelMessage[],
    availableTools: Array<{ name: string; description: string }>,
  ): Promise<ModelToolPlan> {
    if (!model.apiKey) {
      throw new Error(`Model apiKeyRef is not configured in environment for model: ${model.model.id}`);
    }

    const { content } = await this.requestChatCompletion(model, messages, availableTools);
    if (!content) {
      throw new Error('Model returned empty content');
    }

    // 保留本地解析逻辑，后续即使更换底层 SDK，也不用改上层的工具规划协议。
    const parsed = JSON.parse(extractJsonBlock(content)) as {
      toolCalls?: unknown
      finalMessage?: unknown
    };

    return {
      toolCalls: normalizeToolCalls(parsed.toolCalls),
      finalMessage: typeof parsed.finalMessage === 'string' ? parsed.finalMessage : undefined,
    };
  }

  protected async requestChatCompletion(
    model: ResolvedModelConfig,
    messages: ModelMessage[],
    availableTools: Array<{ name: string; description: string }>,
  ): Promise<{ content: string | null }> {
    // 用 prompt 固定输出协议，避免把规划层硬绑定到某一家模型厂商的 function calling 细节。
    const systemInstruction = [
      '你是桌面 Agent 运行时的规划器。',
      '你需要根据任务上下文和可用工具，输出一个 JSON 对象。',
      'JSON 格式必须是 {"toolCalls": AgentToolCall[], "finalMessage"?: string}。',
      '每个 AgentToolCall 格式必须是 {"name": string, "arguments": object}。',
      '如果不需要调用工具，可以返回空数组并提供 finalMessage。',
      '不要输出 JSON 以外的解释。',
      `可用工具: ${availableTools.map(tool => `${tool.name}(${tool.description})`).join('; ')}`,
    ].join('\n');

    const client = new OpenAI({
      apiKey: model.apiKey,
      baseURL: model.baseUrl,
    });

    if (shouldUseResponsesApi(model)) {
      const response = await client.responses.create({
        model: model.modelName,
        temperature: 0.2,
        text: {
          format: {
            type: 'json_object',
          },
        },
        input: [
          {
            role: 'system',
            content: systemInstruction,
          },
          ...messages.map(message => ({
            role: message.role === 'tool' ? 'assistant' : message.role,
            content: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content,
          })),
        ],
      } as never);

      const responseText = 'output_text' in response && typeof response.output_text === 'string'
        ? response.output_text
        : null;

      return {
        content: extractTextContent(responseText) || null,
      };
    }

    // 请求细节交给官方 SDK 处理，这一层只关心“给模型什么上下文”和“拿回什么规划结果”。
    const response = await client.chat.completions.create({
      model: model.modelName,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: toChatCompletionMessages(systemInstruction, messages),
    });

    return {
      content: extractTextContent(response.choices[0]?.message?.content ?? null) || null,
    };
  }

  private pickModel(models: ModelConfig[], taskModelId?: string) {
    if (taskModelId) {
      const matched = models.find(model => model.id === taskModelId && model.enabled);
      if (matched) {
        return matched;
      }
    }

    return models.find(model => model.enabled) ?? null;
  }

  private resolveApiKey(model: ModelConfig) {
    const ref = model.apiKeyRef?.trim();
    if (!ref) {
      return null;
    }

    // 配置里只保存环境变量名，避免把真实密钥直接存进应用数据。
    return process.env[ref] ?? null;
  }
}
