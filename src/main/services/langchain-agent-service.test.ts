import test from 'node:test';
import assert from 'node:assert/strict';
import { LangChainAgentService } from './langchain-agent-service.js';
import type {
  CompatSubagentToolExecutionContext,
  ModelMessage,
  ResolvedModelConfig,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './agent-runtime-types.js';

type FakeRuntimeAgent = {
  invokeCalls: Array<Record<string, unknown>>
  streamCalls: Array<{ input: Record<string, unknown>; options?: Record<string, unknown> }>
  invoke(input: Record<string, unknown>): Promise<{ messages: Array<{ role: string; content: string }> }>
  stream(
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<AsyncIterable<{ messages: Array<{ role: string; content: string }> }>>
};

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

function createToolContext(): CompatSubagentToolExecutionContext {
  const now = new Date().toISOString();
  return {
    task: {
      id: 'task-1',
      title: 'LangChain runtime',
      mode: 'ask',
      modelId: 'model-1',
      expertIds: [],
      permissionMode: 'default',
      connectorIds: [],
      skillIds: [],
      status: 'running',
      unreadEventCount: 0,
      primaryWorkspaceId: 'workspace-1',
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: 'run-1',
      taskId: 'task-1',
      workspaceIds: ['workspace-1'],
      agentId: 'agent-1',
      agentName: 'Main Agent',
      kind: 'main',
      status: 'running',
      graphThreadId: 'thread-1',
      currentNode: 'plan',
      createdAt: now,
      updatedAt: now,
    },
    model: createResolvedModel().model,
    settings: {
      networkEnabled: false,
      webSearchEnabled: false,
      maxConcurrentRuns: 1,
      sandboxEnabled: true,
    },
    async requestApproval() {
      return {
        summary: 'approval requested',
        data: {
          pendingApproval: true,
        },
      };
    },
    async spawnSubagent() {
      return {
        summary: 'subagent requested',
        data: {
          subagentRunId: 'sub-1',
        },
      };
    },
    async sendSubagentMessage() {
      return {
        summary: 'subagent message sent',
        data: {
          ok: true,
        },
      };
    },
    async stopSubagent() {
      return {
        summary: 'subagent stopped',
        data: {
          ok: true,
        },
      };
    },
  };
}

function createEchoTool(executions: Array<Record<string, unknown>>): ToolDefinition {
  return {
    name: 'get_task_context',
    description: 'Read task context',
    requiresApproval: false,
    async execute(_context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolExecutionResult> {
      executions.push(args);
      return {
        summary: 'tool executed',
        data: {
          echoed: args,
        },
      };
    },
  };
}

test('createRuntimeAgent builds ChatOpenAI and createAgent with wrapped tools', async () => {
  const executions: Array<Record<string, unknown>> = [];
  const chatModels: Array<Record<string, unknown>> = [];
  const createdAgents: Array<Record<string, unknown>> = [];

  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke(input) {
      this.invokeCalls.push(input);
      return {
        messages: [{ role: 'assistant', content: 'done' }],
      };
    },
    async stream(input, options) {
      this.streamCalls.push({ input, options });
      return (async function* streamGenerator() {
        yield {
          messages: [{ role: 'assistant', content: 'streamed' }],
        };
      })();
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => {
      chatModels.push(fields);
      return { kind: 'chat-model', fields };
    },
    createAgent: params => {
      createdAgents.push(params as Record<string, unknown>);
      return fakeAgent as never;
    },
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    systemPrompt: 'You are the desktop agent',
    tools: [createEchoTool(executions)],
    context: createToolContext(),
  });

  assert.equal(chatModels.length, 1);
  assert.deepEqual(chatModels[0], {
    model: 'gpt-4o-mini',
    apiKey: 'test-key',
    temperature: 0.2,
    useResponsesApi: false,
    configuration: {
      baseURL: 'https://example.com/v1',
    },
  });

  assert.equal(createdAgents.length, 1);
  assert.equal(createdAgents[0]?.systemPrompt, 'You are the desktop agent');
  assert.equal(Array.isArray(createdAgents[0]?.tools), true);
  assert.equal((createdAgents[0]?.tools as unknown[]).length, 1);

  const wrappedTool = (createdAgents[0]?.tools as Array<{ invoke(args: Record<string, unknown>): Promise<string> }>)[0];
  const output = await wrappedTool.invoke({ query: 'hello' });
  assert.equal(executions.length, 1);
  assert.deepEqual(executions[0], { query: 'hello' });
  assert.match(output, /"summary":"tool executed"/);
  assert.match(output, /"echoed"/);

  await runtimeAgent.invoke({
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(fakeAgent.invokeCalls.length, 1);
});

test('invoke forwards normalized messages to agent.invoke', async () => {
  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke(input) {
      this.invokeCalls.push(input);
      return {
        messages: [{ role: 'assistant', content: 'final answer' }],
      };
    },
    async stream() {
      throw new Error('stream should not be called in this test');
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => ({ kind: 'chat-model', fields }),
    createAgent: () => fakeAgent as never,
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    tools: [],
    context: createToolContext(),
  });

  const result = await runtimeAgent.invoke({
    messages: [
      { role: 'system', content: 'context' },
      { role: 'user', content: 'question' },
      { role: 'tool', content: 'tool output' },
    ],
  });

  assert.equal(fakeAgent.invokeCalls.length, 1);
  assert.deepEqual(fakeAgent.invokeCalls[0], {
    messages: [
      { role: 'system', content: 'context' },
      { role: 'user', content: 'question' },
      { role: 'user', content: 'Tool result:\ntool output' },
    ],
  });
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0], { role: 'assistant', content: 'final answer' });
});

test('stream forwards messages and defaults to values mode', async () => {
  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke() {
      throw new Error('invoke should not be called in this test');
    },
    async stream(input, options) {
      this.streamCalls.push({ input, options });
      return (async function* streamGenerator() {
        yield {
          messages: [{ role: 'assistant', content: 'chunk-1' }],
        };
      })();
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => ({ kind: 'chat-model', fields }),
    createAgent: () => fakeAgent as never,
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    tools: [],
    context: createToolContext(),
  });

  const stream = await runtimeAgent.stream({
    messages: [{ role: 'user', content: 'stream please' }],
  });

  const chunks: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.equal(fakeAgent.streamCalls.length, 1);
  assert.deepEqual(fakeAgent.streamCalls[0], {
    input: {
      messages: [{ role: 'user', content: 'stream please' }],
    },
    options: {
      streamMode: 'values',
    },
  });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], {
    messages: [{ role: 'assistant', content: 'chunk-1' }],
  });
});

test('stream normalizes assistant content blocks into plain text', async () => {
  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke() {
      throw new Error('invoke should not be called in this test');
    },
    async stream() {
      return (async function* streamGenerator() {
        yield {
          messages: [{
            role: 'assistant',
            content: [
              { type: 'text', text: 'chunk ' },
              { type: 'text', text: 'from blocks' },
            ],
          }],
        };
      })() as never;
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => ({ kind: 'chat-model', fields }),
    createAgent: () => fakeAgent as never,
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    tools: [],
    context: createToolContext(),
  });

  const stream = await runtimeAgent.stream({
    messages: [{ role: 'user', content: 'stream please' }],
  });

  const chunks: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    {
      messages: [{ role: 'assistant', content: 'chunk from blocks' }],
    },
  ]);
});

test('stream normalizes LangChain message tuple chunks', async () => {
  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke() {
      throw new Error('invoke should not be called in this test');
    },
    async stream() {
      return (async function* streamGenerator() {
        yield [
          {
            _getType: () => 'ai',
            content: 'tuple chunk',
          },
          {
            langgraph_node: 'agent',
          },
        ];
      })() as never;
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => ({ kind: 'chat-model', fields }),
    createAgent: () => fakeAgent as never,
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    tools: [],
    context: createToolContext(),
  });

  const stream = await runtimeAgent.stream({
    messages: [{ role: 'user', content: 'stream please' }],
  });

  const chunks: Array<{ messages: ModelMessage[] }> = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    {
      messages: [{ role: 'assistant', content: 'tuple chunk' }],
    },
  ]);
});

test('stream normalizes LangChain messages with direct type property', async () => {
  const fakeAgent: FakeRuntimeAgent = {
    invokeCalls: [],
    streamCalls: [],
    async invoke() {
      throw new Error('invoke should not be called in this test');
    },
    async stream() {
      return (async function* streamGenerator() {
        yield {
          messages: [
            {
              type: 'ai',
              content: 'response with type prop',
            },
          ],
        };
      })() as never;
    },
  };

  const service = new LangChainAgentService({
    createChatModel: fields => ({ kind: 'chat-model', fields }),
    createAgent: () => fakeAgent as never,
  });

  const runtimeAgent = await service.createRuntimeAgent({
    model: createResolvedModel(),
    tools: [],
    context: createToolContext(),
  });

  const stream = await runtimeAgent.stream({
    messages: [{ role: 'user', content: 'stream please' }],
  });

  const chunks: Array<{ messages: ModelMessage[] }> = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, [
    {
      messages: [{ role: 'assistant', content: 'response with type prop' }],
    },
  ]);
});
