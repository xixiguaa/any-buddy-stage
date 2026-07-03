import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistryService } from './tool-registry-service.js';
import type { AppSettings, Task, AgentRun, ModelConfig } from '../../shared/types.js';

function createAppServiceMock(overrides: Partial<{
  networkEnabled: boolean
  webSearchEnabled: boolean
  taskTitle: string
}> = {}) {
  const networkEnabled = overrides.networkEnabled ?? true
  const webSearchEnabled = overrides.webSearchEnabled ?? true
  const taskTitle = overrides.taskTitle ?? 'search'

  return {
    getTaskContext() {
      return null
    },
    getAgentRun() {
      return null
    },
    listApprovals() {
      return []
    },
    listAgentEvents() {
      return []
    },
    listTaskWorkspaces() {
      return []
    },
    listAgentRunsByTask() {
      return []
    },
  }
}

function createToolContext(appService: ReturnType<typeof createAppServiceMock>, taskTitle: string) {
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
  }
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
  }
  const settings: AppSettings = {
    networkEnabled: true,
    webSearchEnabled: true,
    maxConcurrentRuns: 1,
  }
  return { task, run, model: null as ModelConfig | null, settings }
}

test('web_search 抓取 DuckDuckGo 结果并应用域名过滤与数量上限', async () => {
  const registry = new ToolRegistryService(createAppServiceMock() as never)
  const tool = registry.getTool('web_search')
  assert.ok(tool)

  const originalFetch = globalThis.fetch
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
  })

  try {
    const result = await tool.execute({
      ...createToolContext(createAppServiceMock(), 'openai'),
    }, {
      query: 'openai',
      domains: ['openai.com', 'platform.openai.com'],
      maxResults: 2,
    })

    assert.equal(result.data.enabled, true)
    assert.equal(result.data.provider, 'duckduckgo_instant_answer')
    assert.equal((result.data.results as Array<unknown>).length, 2)
    assert.deepEqual(
      (result.data.results as Array<{ url: string }>).map(item => item.url),
      [
        'https://openai.com/index/openai-api/',
        'https://platform.openai.com/docs/overview',
      ],
    )
    assert.equal((result.data.audit as { filteredCount: number }).filteredCount, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web_search 在网络/搜索未开启时返回 enabled=false', async () => {
  const registry = new ToolRegistryService(createAppServiceMock({
    networkEnabled: false,
    webSearchEnabled: false,
  }) as never)
  const tool = registry.getTool('web_search')
  assert.ok(tool)

  const result = await tool.execute({
    ...createToolContext(createAppServiceMock({
      networkEnabled: false,
      webSearchEnabled: false,
    }), 'search'),
  }, {
    query: 'openai',
  })

  assert.equal(result.data.enabled, false)
  assert.equal(result.data.reason, 'network_disabled')
})