import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistryService } from './tool-registry-service.js';

function createToolRegistry() {
  const appService = {
    getTaskContext() {
      return null;
    },
    getAgentRun() {
      return null;
    },
    listApprovals() {
      return [];
    },
    listAgentEvents() {
      return [];
    },
    listTaskWorkspaces() {
      return [];
    },
  };

  return new ToolRegistryService(appService as never);
}

test('web_search 会映射真实搜索结果并执行域名过滤与数量限制', async () => {
  const registry = createToolRegistry();
  const tool = registry.getTool('web_search');
  assert.ok(tool);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    AbstractText: 'OpenAI 官方说明',
    AbstractURL: 'https://openai.com/index/openai-api/',
    RelatedTopics: [
      {
        Text: 'OpenAI Docs',
        FirstURL: 'https://platform.openai.com/docs/overview',
      },
      {
        Text: 'Example result',
        FirstURL: 'https://example.com/post',
      },
      {
        Name: 'Nested',
        Topics: [
          {
            Text: 'OpenAI pricing',
            FirstURL: 'https://openai.com/api/pricing/',
          },
        ],
      },
    ],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    const result = await tool.execute({
      task: {
        id: 'task-1',
        title: 'search',
        mode: 'ask',
        modelId: 'model-1',
        permissionMode: 'default',
        connectorIds: [],
        skillIds: [],
        status: 'running',
        unreadEventCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      run: {
        id: 'run-1',
        taskId: 'task-1',
        workspaceIds: [],
        agentId: 'agent-1',
        agentName: 'Main Agent',
        kind: 'main',
        status: 'running',
        graphThreadId: 'thread-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      model: null,
      settings: {
        networkEnabled: true,
        webSearchEnabled: true,
        maxConcurrentRuns: 1,
      },
      requestApproval: async () => {
        throw new Error('not used');
      },
      spawnSubagent: async () => {
        throw new Error('not used');
      },
    }, {
      query: 'openai',
      domains: ['openai.com', 'platform.openai.com'],
      maxResults: 2,
    });

    assert.equal(result.data.enabled, true);
    assert.equal(result.data.provider, 'duckduckgo_instant_answer');
    assert.equal((result.data.results as Array<unknown>).length, 2);
    assert.deepEqual(
      (result.data.results as Array<{ url: string }>).map(item => item.url),
      [
        'https://openai.com/index/openai-api/',
        'https://platform.openai.com/docs/overview',
      ],
    );
    assert.equal((result.data.audit as { filteredCount: number }).filteredCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
