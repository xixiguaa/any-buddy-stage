import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIModelService } from './openai-model-service.js';
import type { ModelMessage, ResolvedModelConfig } from './agent-runtime-types.js';

class TestOpenAIModelService extends OpenAIModelService {
  constructor(
    private readonly responseFactory: () => Promise<{ content: string | null }>,
  ) {
    super();
  }

  protected override requestChatCompletion(
    _model: ResolvedModelConfig,
    _messages: ModelMessage[],
    _availableTools: Array<{ name: string; description: string }>,
  ) {
    return this.responseFactory();
  }
}

function createResolvedModel(): ResolvedModelConfig {
  return {
    model: {
      id: 'model-1',
      name: 'Planner',
      provider: 'openai_compatible',
      modelName: 'gpt-4o-mini',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    baseUrl: 'https://example.com/v1',
    modelName: 'gpt-4o-mini',
    apiMode: 'auto',
    apiKey: 'test-key',
  };
}

test('buildToolPlan parses json content wrapped in fenced code blocks', async () => {
  const service = new TestOpenAIModelService(async () => ({
    content: [
      '```json',
      '{"toolCalls":[{"name":"get_task_context","arguments":{"taskId":"task-1"}}],"finalMessage":"ready"}',
      '```',
    ].join('\n'),
  }));

  const plan = await service.buildToolPlan(createResolvedModel(), [
    { role: 'user', content: 'plan this task' },
  ], [
    { name: 'get_task_context', description: 'Read task context' },
  ]);

  assert.deepEqual(plan.toolCalls, [
    {
      name: 'get_task_context',
      arguments: { taskId: 'task-1' },
    },
  ]);
  assert.equal(plan.finalMessage, 'ready');
});

test('buildToolPlan throws when sdk response content is empty', async () => {
  const service = new TestOpenAIModelService(async () => ({
    content: null,
  }));

  await assert.rejects(
    () => service.buildToolPlan(createResolvedModel(), [], []),
    /Model returned empty content/,
  );
});

test('resolveModelConfig defaults apiMode to auto when model config omits it', () => {
  const service = new OpenAIModelService();
  const resolved = service.resolveModelConfig([
    {
      id: 'model-1',
      name: 'Planner',
      provider: 'openai_compatible',
      baseUrl: 'https://example.com/v1',
      apiKeyRef: 'OPENAI_API_KEY',
      modelName: 'gpt-4o-mini',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  assert.equal(resolved?.apiMode, 'auto');
});
