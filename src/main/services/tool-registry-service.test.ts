import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistryService } from './tool-registry-service.js';
import type { AppSettings, Task, AgentRun, ModelConfig } from '../../shared/types.js';

function createAppServiceMock() {
  return {
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
    listAgentRunsByTask() {
      return [];
    },
  };
}

function createToolContext(settingsOverrides: Partial<AppSettings> = {}, taskTitle = 'search') {
  const task: Task = {
    id: 'task-1',
    title: taskTitle,
    mode: 'ask',
    modelId: 'model-1',
    expertIds: [],
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'running',
    unreadEventCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const run: AgentRun = {
    id: 'run-1',
    taskId: task.id,
    workspaceIds: [],
    agentId: 'agent-1',
    agentName: 'Main Agent',
    kind: 'main',
    status: 'running',
    graphThreadId: 'thread-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const settings: AppSettings = {
    networkEnabled: true,
    webSearchEnabled: true,
    maxConcurrentRuns: 1,
    ...settingsOverrides,
  };
  return { task, run, model: null as ModelConfig | null, settings };
}

test('web_search prefers SearXNG results and applies filters', async () => {
  const registry = new ToolRegistryService(createAppServiceMock() as never);
  const tool = registry.getTool('web_search');
  assert.ok(tool);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    assert.match(url, /format=json/);
    return new Response(JSON.stringify({
      results: [
        {
          title: 'OpenAI API',
          url: 'https://openai.com/index/openai-api/',
          content: 'Official API overview',
          publishedDate: '2026-07-10T00:00:00Z',
        },
        {
          title: 'OpenAI Docs',
          url: 'https://platform.openai.com/docs/overview',
          content: 'Platform docs',
        },
        {
          title: 'Example result',
          url: 'https://example.com/post',
          content: 'Example content',
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await tool.execute(createToolContext({}, 'openai'), {
      query: 'openai',
      domains: ['openai.com', 'platform.openai.com'],
      maxResults: 2,
    });

    assert.equal(result.data.enabled, true);
    assert.equal(result.data.provider, 'searxng');
    assert.equal((result.data.results as Array<unknown>).length, 2);
    assert.deepEqual(
      (result.data.results as Array<{ url: string }>).map(item => item.url),
      [
        'https://openai.com/index/openai-api/',
        'https://platform.openai.com/docs/overview',
      ],
    );
    assert.equal((result.data.audit as { filteredCount: number }).filteredCount, 1);
    assert.equal((result.data.results as Array<{ sourceTime: string | null }>)[0].sourceTime, '2026-07-10T00:00:00Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search falls back to DuckDuckGo when SearXNG is unavailable', async () => {
  const registry = new ToolRegistryService(createAppServiceMock() as never);
  const tool = registry.getTool('web_search');
  assert.ok(tool);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.duckduckgo.com')) {
      return new Response(JSON.stringify({
        AbstractText: 'OpenAI official page',
        AbstractURL: 'https://openai.com/index/openai-api/',
        RelatedTopics: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Too Many Requests', { status: 429 });
  };

  try {
    const result = await tool.execute(createToolContext({}, 'openai'), {
      query: 'openai',
      maxResults: 3,
    });

    assert.equal(result.data.enabled, true);
    assert.equal(result.data.provider, 'duckduckgo_instant_answer');
    assert.equal(result.data.fallbackFrom, 'searxng');
    assert.equal((result.data.results as Array<unknown>).length, 1);
    const searxngAudit = (result.data.audit as { searxng?: { providerErrors?: Array<unknown> } }).searxng;
    assert.ok(searxngAudit);
    assert.equal(Array.isArray(searxngAudit?.providerErrors), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web_search returns disabled result when network search is off', async () => {
  const registry = new ToolRegistryService(createAppServiceMock() as never);
  const tool = registry.getTool('web_search');
  assert.ok(tool);

  const result = await tool.execute(createToolContext({
    networkEnabled: false,
    webSearchEnabled: false,
  }, 'search'), {
    query: 'openai',
  });

  assert.equal(result.data.enabled, false);
  assert.equal(result.data.reason, 'network_disabled');
});
