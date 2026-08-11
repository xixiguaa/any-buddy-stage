import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntimeService } from './agent-runtime-service.js';
import type { RuntimeContext, ToolDefinition } from './agent-runtime-types.js';

function createContext(connectorIds: string[]): RuntimeContext {
  const now = new Date().toISOString();
  return {
    task: {
      id: 'task-1',
      title: 'Search integration',
      mode: 'ask',
      modelId: 'model-1',
      expertIds: [],
      permissionMode: 'default',
      connectorIds,
      skillIds: [],
      status: 'idle',
      unreadEventCount: 0,
      createdAt: now,
      updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
    },
    model: null,
    settings: {
      networkEnabled: true,
      webSearchEnabled: true,
      maxConcurrentRuns: 1,
    },
  };
}

function createWebSearchTool(): ToolDefinition {
  return {
    name: 'web_search',
    connectorId: 'web-search',
    description: 'Search the web',
    requiresApproval: false,
    async execute() {
      return {
        summary: 'ok',
        data: {},
      };
    },
  };
}

test('buildDeepAgentTools only mounts web_search when web-search connector is selected', () => {
  const toolRegistry = {
    listTools() {
      return [createWebSearchTool()];
    },
  };

  const service = new AgentRuntimeService({} as never, {
    toolRegistry: toolRegistry as never,
    deepAgentExecutor: { execute: async () => true },
  });

  const withoutConnector = (service as any).buildDeepAgentTools(createContext([])) as ToolDefinition[];
  const withConnector = (service as any).buildDeepAgentTools(createContext(['web-search'])) as ToolDefinition[];

  assert.equal(withoutConnector.length, 0);
  assert.equal(withConnector.length, 1);
  assert.equal(withConnector[0]?.name, 'web_search');
});

test('start snapshots the active expert into the created run', async () => {
  const context = createContext([]);
  context.task.activeExpertId = 'expert-video-producer';
  let capturedInput: { expertId?: string } | undefined;
  let receivedActivityCallback = false;
  const appService = {
    getTask: () => context.task,
    restoreArchivedPrimaryWorkspace: async () => null,
    getSettings: () => context.settings,
    createRuntimeRun: async (_taskId: string, input: { expertId?: string }) => {
      capturedInput = input;
      return context.run;
    },
    listModelConfigs: () => [],
    resumeRuntimeRun: async () => context.run,
    listExperts: () => [],
    listExpertTeams: () => [],
    failRuntimeRun: async () => undefined,
  };
  const service = new AgentRuntimeService(appService as never, {
    modelService: { resolveModelConfig: () => null } as never,
    toolRegistry: { listTools: () => [] } as never,
    deepAgentExecutor: {
      execute: async params => {
        receivedActivityCallback = typeof params.onActivity === 'function';
        params.onActivity?.();
        return true;
      },
    },
  });

  await service.start(context.task.id);

  assert.equal(capturedInput?.expertId, 'expert-video-producer');
  assert.equal(receivedActivityCallback, true);
});
