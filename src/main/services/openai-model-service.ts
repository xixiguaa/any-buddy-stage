import process from 'node:process';
import type { ModelApiMode, ModelConfig } from '../../shared/types.js';
import type { ResolvedModelConfig } from './agent-runtime-types.js';
import { ModelApiModeMismatchError } from './agent-runtime-types.js';

// 默认 OpenAI API Base URL 访问端点
const defaultBaseUrl = 'https://api.openai.com/v1';

/**
 * 规范化 API Base URL 地址：去除末尾多余斜杠，若为空则返回默认地址。
 */
function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return defaultBaseUrl;
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * 规范化 API 模式：未配置时默认为 'auto' (自动匹配)。
 */
function normalizeApiMode(value?: ModelApiMode) {
  return value ?? 'auto';
}

/**
 * 判断当前 Base URL 是否属于已知的非 OpenAI 原生端点 (如 DeepSeek, Anthropic, Ollama, LM Studio 等)。
 */
function isKnownNonOpenAiEndpoint(baseUrl: string) {
  return /deepseek|anthropic|cohere|gemini|google|vertex|mistral|groq|openrouter|together|ollama|lm-studio|localai|lms/i.test(baseUrl);
}

/**
 * 判断当前模型配置是否应当使用 OpenAI 的 Responses API (新版格式)。
 * 对于非 OpenAI 原生兼容端点（如 DeepSeek 等第三方提供商），若强制配置了 Responses 模式会抛出模式不匹配异常。
 */
function shouldUseResponsesApi(model: ResolvedModelConfig) {
  if (model.apiMode === 'chat_completions') {
    return false;
  }

  const isOpenAiUrl = /(^https:\/\/api\.openai\.com(?:\/v1)?$)/i.test(model.baseUrl);
  const isKnownNonOpenAi = isKnownNonOpenAiEndpoint(model.baseUrl);

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

/**
 * OpenAI 模型配置解析与管理服务 (OpenAIModelService)
 * 
 * 核心职责：
 * 1. 负责从当前应用保存的模型列表中匹配适合当前 Task 的有效模型配置。
 * 2. 自动修正/规范化模型接口的 BaseURL 与 API Mode (Chat Completions vs Responses API)。
 * 3. 安全地从系统环境变量中读取绑定的真实 API Key（避免明文保存密钥）。
 */
export class OpenAIModelService {
  /**
   * 解析并返回最终可用于 LangChain / DeepAgents 初始化的 ResolvedModelConfig 对象。
   * 
   * @param models 当前系统可用的模型配置列表
   * @param taskModelId 当前任务选中的指定模型 ID（若未指定或不可用，将自动降级使用第一个启用的模型）
   * @returns 规范化后的模型配置对象，若无可用模型则返回 null
   */
  resolveModelConfig(models: ModelConfig[], taskModelId?: string): ResolvedModelConfig | null {
    const model = this.pickModel(models, taskModelId);
    if (!model) {
      return null;
    }

    const normalizedBaseUrl = normalizeBaseUrl(model.baseUrl);
    const normalizedApiMode = normalizeApiMode(model.apiMode);
    // 当模式为 auto 且目标地址为非 OpenAI 原生提供商（如 DeepSeek）时，自动切换为标准的 chat_completions 兼容模式
    const effectiveApiMode = normalizedApiMode === 'auto' && isKnownNonOpenAiEndpoint(normalizedBaseUrl)
      ? 'chat_completions'
      : normalizedApiMode;

    return {
      model,
      baseUrl: normalizedBaseUrl,
      modelName: model.modelName,
      apiMode: effectiveApiMode,
      apiKey: this.resolveApiKey(model),
    };
  }

  /**
   * 挑选匹配的模型配置：优先选择任务绑定的模型 ID，如未匹配到则退回使用列表第一个已启用的模型。
   */
  private pickModel(models: ModelConfig[], taskModelId?: string) {
    if (taskModelId) {
      const matched = models.find(model => model.id === taskModelId && model.enabled);
      if (matched) {
        return matched;
      }
    }

    return models.find(model => model.enabled) ?? null;
  }

  /**
   * 解析模型的 API Key：根据配置的环境变量引用名称 (apiKeyRef)，从 process.env 中动态读取密钥。
   */
  private resolveApiKey(model: ModelConfig) {
    const ref = model.apiKeyRef?.trim();
    if (!ref) {
      return null;
    }

    // 配置里只保存环境变量名，避免把真实密钥直接存进应用数据库或配置文件。
    return process.env[ref] ?? null;
  }
}