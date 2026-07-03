import process from 'node:process';
import type { ModelApiMode, ModelConfig } from '../../shared/types.js';
import type { ResolvedModelConfig } from './agent-runtime-types.js';
import { ModelApiModeMismatchError } from './agent-runtime-types.js';

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

function isKnownNonOpenAiEndpoint(baseUrl: string) {
  return /deepseek|anthropic|cohere|gemini|google|vertex|mistral|groq|openrouter|together|ollama|lm-studio|localai|lms/i.test(baseUrl);
}

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

export class OpenAIModelService {
  resolveModelConfig(models: ModelConfig[], taskModelId?: string): ResolvedModelConfig | null {
    const model = this.pickModel(models, taskModelId);
    if (!model) {
      return null;
    }

    const normalizedBaseUrl = normalizeBaseUrl(model.baseUrl);
    const normalizedApiMode = normalizeApiMode(model.apiMode);
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