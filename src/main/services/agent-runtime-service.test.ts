import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRuntimeService } from './agent-runtime-service.js';
import { AgentApprovalPendingError } from './langchain-agent-service.js';
import type {
  AgentToolCall,
  ModelToolPlan,
  ResolvedModelConfig,
} from './agent-runtime-types.js';

type FakeApproval = {
  id: string
  taskId: string
  runId: string
  reason: string
  originalArgs?: Record<string, unknown>
  editedArgs?: Record<string, unknown>
  decision: 'pending' | 'approved' | 'rejected' | 'edited'
};

function createApprovalHarness() {
  const task = {
    id: 'task-1',
    title: 'approval flow',
    mode: 'craft',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'waiting_approval',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const run = {
    id: 'run-1',
    taskId: task.id,
    workspaceIds: ['workspace-1'],
    agentId: 'agent-1',
    agentName: 'Main Agent',
    kind: 'main',
    status: 'waiting_approval',
    graphThreadId: 'thread-1',
    currentNode: 'approval_pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const approval: FakeApproval = {
    id: 'approval-1',
    taskId: task.id,
    runId: run.id,
    reason: 'request file write',
    originalArgs: {
      toolName: 'write_workspace_file',
      workspaceId: 'workspace-1',
      path: 'notes.txt',
      content: 'original content',
    },
    decision: 'pending',
  };

  const taskWorkspace = {
    workspaceId: 'workspace-1',
    taskId: task.id,
    role: 'primary',
    accessMode: 'read_write',
    addedAt: new Date().toISOString(),
    workspace: {
      id: 'workspace-1',
      name: 'workspace',
      path: '',
      defaultPermissionMode: 'read_write',
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  const messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let completedSummary: string | null = null;
  let failedError: unknown = null;

  const resolvedModel: ResolvedModelConfig = {
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

  const modelService = {
    resolveModelConfig() {
      return resolvedModel;
    },
    async buildToolPlan() {
      return {
        toolCalls: [],
        finalMessage: 'approval flow completed',
      };
    },
  };

  const appService = {
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getAgentRun(runId: string) {
      return runId === run.id ? run : null;
    },
    listTaskWorkspaces(taskId: string) {
      return taskId === task.id ? [taskWorkspace] : [];
    },
    listModelConfigs() {
      return [];
    },
    getTaskContext() {
      return {
        task,
        messages: [],
        workspaces: [taskWorkspace],
        approvals: [approval],
      };
    },
    async approveRuntimeRequest(approvalId: string, decision: FakeApproval['decision'], editedArgs?: Record<string, unknown>) {
      if (approvalId !== approval.id) {
        throw new Error(`Approval not found: ${approvalId}`);
      }

      approval.decision = decision;
      approval.editedArgs = editedArgs;
      run.status = decision === 'rejected' ? 'failed' : 'running';
      task.status = decision === 'rejected' ? 'failed' : 'running';
      return approval;
    },
    async appendRuntimeEvent(_runId: string, type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
    async appendRuntimeMessage(_taskId: string, _runId: string, role: string, content: string, metadata?: Record<string, unknown>) {
      messages.push({ role, content, metadata });
    },
    async completeRuntimeRun(_runId: string, summary: string) {
      run.status = 'completed';
      task.status = 'completed';
      completedSummary = summary;
    },
    async failRuntimeRun(_runId: string, error: unknown) {
      run.status = 'failed';
      task.status = 'failed';
      failedError = error;
    },
    async resumeRuntimeRun(_runId: string) {
      run.status = 'running';
      return run;
    },
  };

  return {
    task,
    run,
    approval,
    taskWorkspace,
    messages,
    events,
    appService,
    modelService,
    getCompletedSummary: () => completedSummary,
    getFailedError: () => failedError,
  };
}

function createLoopRuntimeHarness(plans: ModelToolPlan[]) {
  const task = {
    id: 'task-loop-1',
    title: 'Loop task',
    mode: 'ask',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'idle',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let activeRun: {
    id: string
    taskId: string
    workspaceIds: string[]
    agentId: string
    agentName: string
    kind: 'main' | 'subagent'
    status: string
    graphThreadId: string
    currentNode: string
    createdAt: string
    updatedAt: string
  } | null = null;

  const messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const toolExecutions: AgentToolCall[] = [];
  const modelCalls: Array<{ toolCountSeen: number; messageCountSeen: number }> = [];
  let completedSummary: string | null = null;
  let failedError: unknown = null;
  let resolveFinished: (() => void) | null = null;
  let rejectFinished: ((error: unknown) => void) | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const resolvedModel: ResolvedModelConfig = {
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

  const modelService = {
    resolveModelConfig() {
      return resolvedModel;
    },
    async buildToolPlan(_model: ResolvedModelConfig, modelMessages: Array<{ role: string; content: string }>) {
      const nextPlan = plans.shift();
      if (!nextPlan) {
        throw new Error('No more plans configured for test');
      }

      modelCalls.push({
        toolCountSeen: messages.filter(message => message.role === 'tool').length,
        messageCountSeen: modelMessages.length,
      });

      return nextPlan;
    },
  };

  const toolRegistry = {
    listTools() {
      return [
        { name: 'get_task_context', description: 'Read task context' },
        { name: 'get_run_state', description: 'Read run state' },
      ];
    },
    getTool(name: AgentToolCall['name']) {
      return {
        name,
        execute: async (_context: unknown, args: Record<string, unknown>) => {
          toolExecutions.push({ name, arguments: args });
          return {
            summary: `${name} done`,
            data: {
              toolName: name,
              ok: true,
            },
          };
        },
      };
    },
  };

  const appService = {
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    async createRuntimeRun(taskId: string, input: { agentName?: string; kind?: 'main' | 'subagent' }) {
      activeRun = {
        id: 'run-1',
        taskId,
        workspaceIds: ['workspace-1'],
        agentId: 'agent-1',
        agentName: input.agentName ?? 'Main Agent',
        kind: input.kind ?? 'main',
        status: 'queued',
        graphThreadId: 'thread-1',
        currentNode: 'plan',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return activeRun;
    },
    listModelConfigs() {
      return [];
    },
    async resumeRuntimeRun(runId: string) {
      if (activeRun?.id === runId) {
        activeRun.status = 'running';
      }
      return activeRun;
    },
    getTaskContext() {
      return {
        task,
        messages,
        workspaces: [],
        approvals: [],
      };
    },
    async appendRuntimeMessage(_taskId: string, _runId: string, role: string, content: string, metadata?: Record<string, unknown>) {
      messages.push({ role, content, metadata });
    },
    async appendRuntimeEvent(_runId: string, type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
    async completeRuntimeRun(runId: string, summary: string) {
      if (activeRun?.id === runId) {
        activeRun.status = 'completed';
      }
      task.status = 'completed';
      completedSummary = summary;
      messages.push({
        role: 'assistant',
        content: summary,
      });
      resolveFinished?.();
    },
    async failRuntimeRun(runId: string, error: unknown) {
      if (activeRun?.id === runId) {
        activeRun.status = 'failed';
      }
      task.status = 'failed';
      failedError = error;
      rejectFinished?.(error);
    },
  };

  return {
    task,
    appService,
    modelService,
    toolRegistry,
    messages,
    events,
    toolExecutions,
    modelCalls,
    finished,
    getCompletedSummary: () => completedSummary,
    getFailedError: () => failedError,
  };
}

function createFallbackLangChainHarness() {
  return {
    async createRuntimeAgent() {
      throw new Error('langchain unavailable in legacy loop test');
    },
  };
}

function createApprovalResumeHarness(plans: ModelToolPlan[]) {
  const task = {
    id: 'task-approval-loop-1',
    title: 'Approval loop task',
    mode: 'craft',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'waiting_approval',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const run = {
    id: 'run-approval-1',
    taskId: task.id,
    workspaceIds: ['workspace-1'],
    agentId: 'agent-1',
    agentName: 'Main Agent',
    kind: 'main',
    status: 'waiting_approval',
    graphThreadId: 'thread-1',
    currentNode: 'approval_pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const approval: FakeApproval = {
    id: 'approval-loop-1',
    taskId: task.id,
    runId: run.id,
    reason: 'request file write',
    originalArgs: {
      toolName: 'write_workspace_file',
      workspaceId: 'workspace-1',
      path: 'notes.txt',
      content: 'approved content',
    },
    decision: 'pending',
  };

  const taskWorkspace = {
    workspaceId: 'workspace-1',
    taskId: task.id,
    role: 'primary',
    accessMode: 'read_write',
    addedAt: new Date().toISOString(),
    workspace: {
      id: 'workspace-1',
      name: 'workspace',
      path: '',
      defaultPermissionMode: 'read_write',
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  const messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const modelCalls: Array<{ toolCountSeen: number; messageCountSeen: number }> = [];
  let completedSummary: string | null = null;
  let failedError: unknown = null;
  let resolveFinished: (() => void) | null = null;
  let rejectFinished: ((error: unknown) => void) | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const resolvedModel: ResolvedModelConfig = {
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

  const modelService = {
    resolveModelConfig() {
      return resolvedModel;
    },
    async buildToolPlan(_model: ResolvedModelConfig, modelMessages: Array<{ role: string; content: string }>) {
      const nextPlan = plans.shift();
      if (!nextPlan) {
        throw new Error('No more plans configured for approval resume test');
      }

      modelCalls.push({
        toolCountSeen: messages.filter(message => message.role === 'tool').length,
        messageCountSeen: modelMessages.length,
      });

      return nextPlan;
    },
  };

  const toolRegistry = {
    listTools() {
      return [
        { name: 'write_workspace_file', description: 'Write a file into the workspace' },
      ];
    },
    getTool() {
      return null;
    },
    async executeApprovedAction(_context: unknown, args: Record<string, unknown>) {
      const path = typeof args.path === 'string' ? args.path : '';
      const content = typeof args.content === 'string' ? args.content : '';
      await writeFile(join(taskWorkspace.workspace.path, path), content, 'utf8');
      return {
        summary: `approved write: ${path}`,
        data: {
          toolName: 'write_workspace_file',
          path,
          bytes: Buffer.byteLength(content, 'utf8'),
        },
      };
    },
  };

  const appService = {
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getAgentRun(runId: string) {
      return runId === run.id ? run : null;
    },
    listTaskWorkspaces(taskId: string) {
      return taskId === task.id ? [taskWorkspace] : [];
    },
    listModelConfigs() {
      return [];
    },
    getTaskContext() {
      return {
        task,
        messages,
        workspaces: [taskWorkspace],
        approvals: [approval],
      };
    },
    async approveRuntimeRequest(approvalId: string, decision: FakeApproval['decision'], editedArgs?: Record<string, unknown>) {
      if (approvalId !== approval.id) {
        throw new Error(`Approval not found: ${approvalId}`);
      }

      approval.decision = decision;
      approval.editedArgs = editedArgs;
      run.status = decision === 'rejected' ? 'failed' : 'running';
      run.currentNode = decision === 'rejected' ? 'approval_rejected' : 'approval_resolved';
      task.status = decision === 'rejected' ? 'failed' : 'running';
      return approval;
    },
    async appendRuntimeEvent(_runId: string, type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
    async appendRuntimeMessage(_taskId: string, _runId: string, role: string, content: string, metadata?: Record<string, unknown>) {
      messages.push({ role, content, metadata });
    },
    async completeRuntimeRun(_runId: string, summary: string) {
      run.status = 'completed';
      run.currentNode = 'finished';
      task.status = 'completed';
      completedSummary = summary;
      resolveFinished?.();
    },
    async failRuntimeRun(_runId: string, error: unknown) {
      run.status = 'failed';
      run.currentNode = 'failed';
      task.status = 'failed';
      failedError = error;
      rejectFinished?.(error);
    },
    async resumeRuntimeRun(_runId: string) {
      run.status = 'running';
      return run;
    },
  };

  return {
    task,
    run,
    approval,
    taskWorkspace,
    messages,
    events,
    appService,
    modelService,
    toolRegistry,
    finished,
    modelCalls,
    getCompletedSummary: () => completedSummary,
    getFailedError: () => failedError,
  };
}

function createLangChainRuntimeHarness() {
  const task = {
    id: 'task-langchain-1',
    title: 'LangChain runtime task',
    mode: 'ask',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'idle',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let activeRun: {
    id: string
    taskId: string
    workspaceIds: string[]
    agentId: string
    agentName: string
    kind: 'main' | 'subagent'
    status: string
    graphThreadId: string
    currentNode: string
    createdAt: string
    updatedAt: string
  } | null = null;

  const messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const toolExecutions: AgentToolCall[] = [];
  let completedSummary: string | null = null;
  let failedError: unknown = null;
  let resolveFinished: (() => void) | null = null;
  let rejectFinished: ((error: unknown) => void) | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const resolvedModel: ResolvedModelConfig = {
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

  const modelService = {
    resolveModelConfig() {
      return resolvedModel;
    },
    async buildToolPlan() {
      throw new Error('legacy planner should not be called when langchain runtime is enabled');
    },
  };

  const toolRegistry = {
    listTools() {
      return [
        { name: 'get_task_context', description: 'Read task context', requiresApproval: false },
      ];
    },
    getTool(name: AgentToolCall['name']) {
      return {
        name,
        requiresApproval: false,
        execute: async (_context: unknown, args: Record<string, unknown>) => {
          toolExecutions.push({ name, arguments: args });
          return {
            summary: `${name} done`,
            data: {
              toolName: name,
              ok: true,
            },
          };
        },
      };
    },
  };

  const appService = {
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    async createRuntimeRun(taskId: string, input: { agentName?: string; kind?: 'main' | 'subagent' }) {
      activeRun = {
        id: 'run-langchain-1',
        taskId,
        workspaceIds: ['workspace-1'],
        agentId: 'agent-1',
        agentName: input.agentName ?? 'Main Agent',
        kind: input.kind ?? 'main',
        status: 'queued',
        graphThreadId: 'thread-1',
        currentNode: 'plan',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return activeRun;
    },
    listModelConfigs() {
      return [];
    },
    async resumeRuntimeRun(runId: string) {
      if (activeRun?.id === runId) {
        activeRun.status = 'running';
      }
      return activeRun;
    },
    getTaskContext() {
      return {
        task,
        messages,
        workspaces: [],
        approvals: [],
      };
    },
    async appendRuntimeMessage(_taskId: string, _runId: string, role: string, content: string, metadata?: Record<string, unknown>) {
      messages.push({ role, content, metadata });
    },
    async appendRuntimeEvent(_runId: string, type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
    async completeRuntimeRun(runId: string, summary: string) {
      if (activeRun?.id === runId) {
        activeRun.status = 'completed';
      }
      task.status = 'completed';
      completedSummary = summary;
      messages.push({
        role: 'assistant',
        content: summary,
      });
      resolveFinished?.();
    },
    async failRuntimeRun(runId: string, error: unknown) {
      if (activeRun?.id === runId) {
        activeRun.status = 'failed';
      }
      task.status = 'failed';
      failedError = error;
      rejectFinished?.(error);
    },
  };

  return {
    task,
    appService,
    modelService,
    toolRegistry,
    messages,
    events,
    toolExecutions,
    finished,
    getCompletedSummary: () => completedSummary,
    getFailedError: () => failedError,
  };
}

test('approve writes the requested workspace file and completes the run', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'anybuddy-runtime-test-'));
  try {
    const harness = createApprovalHarness();
    harness.taskWorkspace.workspace.path = tempDir;
    const runtime = new AgentRuntimeService(harness.appService as never, {
      modelService: harness.modelService as never,
      continueAfterApproval: false,
    });

    await runtime.approve(harness.approval.id, 'approved');

    const content = await readFile(join(tempDir, 'notes.txt'), 'utf8');
    assert.equal(content, 'original content');
    assert.equal(harness.run.status, 'completed');
    assert.equal(harness.task.status, 'completed');
    assert.ok(harness.getCompletedSummary());
    assert.equal(harness.getFailedError(), null);
    assert.ok(harness.events.some(event => event.type === 'tool_result'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('approve prefers edited approval args when provided', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'anybuddy-runtime-test-'));
  try {
    const harness = createApprovalHarness();
    harness.taskWorkspace.workspace.path = tempDir;
    const runtime = new AgentRuntimeService(harness.appService as never, {
      modelService: harness.modelService as never,
      continueAfterApproval: false,
    });

    await runtime.approve(harness.approval.id, 'edited', {
      toolName: 'write_workspace_file',
      workspaceId: 'workspace-1',
      path: 'notes.txt',
      content: 'edited content',
    });

    const content = await readFile(join(tempDir, 'notes.txt'), 'utf8');
    assert.equal(content, 'edited content');
    assert.equal(harness.run.status, 'completed');
    assert.equal(harness.getFailedError(), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('approve applies an edit patch to an existing file', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'anybuddy-runtime-test-'));
  try {
    const harness = createApprovalHarness();
    harness.taskWorkspace.workspace.path = tempDir;
    harness.approval.originalArgs = {
      toolName: 'edit_workspace_file',
      workspaceId: 'workspace-1',
      path: 'notes.txt',
      patch: [
        '@@',
        '-original content',
        '+replaced content',
      ].join('\n'),
    };

    await writeFile(join(tempDir, 'notes.txt'), 'original content', 'utf8');

    const runtime = new AgentRuntimeService(harness.appService as never, {
      modelService: harness.modelService as never,
      continueAfterApproval: false,
    });
    await runtime.approve(harness.approval.id, 'approved');

    const content = await readFile(join(tempDir, 'notes.txt'), 'utf8');
    assert.equal(content, 'replaced content');
    assert.equal(harness.run.status, 'completed');
    assert.equal(harness.getFailedError(), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('approve can create a new file from an additive patch', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'anybuddy-runtime-test-'));
  try {
    const harness = createApprovalHarness();
    harness.taskWorkspace.workspace.path = tempDir;
    harness.approval.originalArgs = {
      toolName: 'edit_workspace_file',
      workspaceId: 'workspace-1',
      path: 'new-file.txt',
      patch: [
        '@@',
        '+first line',
        '+second line',
      ].join('\n'),
    };

    const runtime = new AgentRuntimeService(harness.appService as never, {
      modelService: harness.modelService as never,
      continueAfterApproval: false,
    });
    await runtime.approve(harness.approval.id, 'approved');

    const content = await readFile(join(tempDir, 'new-file.txt'), 'utf8');
    assert.equal(content, 'first line\nsecond line');
    assert.equal(harness.run.status, 'completed');
    assert.equal(harness.getFailedError(), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('start loops through multiple planning rounds until the model returns a final answer', async () => {
  const harness = createLoopRuntimeHarness([
    {
      toolCalls: [
        {
          name: 'get_task_context',
          arguments: { taskId: 'task-loop-1' },
        },
      ],
      finalMessage: 'read context first',
    },
    {
      toolCalls: [
        {
          name: 'get_run_state',
          arguments: { runId: 'run-1' },
        },
      ],
    },
    {
      toolCalls: [],
      finalMessage: 'final answer generated',
    },
  ]);

  const runtime = new AgentRuntimeService(harness.appService as never, {
    modelService: harness.modelService as never,
    toolRegistry: harness.toolRegistry as never,
    langChainAgentService: createFallbackLangChainHarness() as never,
  });

  await runtime.start(harness.task.id, { agentName: 'Main Agent', kind: 'main' });
  await harness.finished;

  assert.equal(harness.getFailedError(), null);
  assert.equal(harness.getCompletedSummary(), 'final answer generated');
  assert.equal(harness.toolExecutions.length, 2);
  assert.equal(harness.modelCalls.length, 3);
  assert.equal(harness.modelCalls[1]?.toolCountSeen, 1);
  assert.equal(harness.modelCalls[2]?.toolCountSeen, 2);
});

test('start completes immediately when the model returns a final answer without tool calls', async () => {
  const harness = createLoopRuntimeHarness([
    {
      toolCalls: [],
      finalMessage: 'answer directly',
    },
  ]);

  const runtime = new AgentRuntimeService(harness.appService as never, {
    modelService: harness.modelService as never,
    toolRegistry: harness.toolRegistry as never,
    langChainAgentService: createFallbackLangChainHarness() as never,
  });

  await runtime.start(harness.task.id, { agentName: 'Main Agent', kind: 'main' });
  await harness.finished;

  assert.equal(harness.getFailedError(), null);
  assert.equal(harness.getCompletedSummary(), 'answer directly');
  assert.equal(harness.toolExecutions.length, 0);
  assert.equal(harness.modelCalls.length, 1);
});

test('approve resumes the main agent loop and finishes with the next model answer', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'anybuddy-runtime-test-'));
  try {
    const harness = createApprovalResumeHarness([
      {
        toolCalls: [],
        finalMessage: 'completed after approval',
      },
    ]);
    harness.taskWorkspace.workspace.path = tempDir;

    const runtime = new AgentRuntimeService(harness.appService as never, {
      modelService: harness.modelService as never,
      toolRegistry: harness.toolRegistry as never,
      langChainAgentService: createFallbackLangChainHarness() as never,
    });

    await runtime.approve(harness.approval.id, 'approved');
    await harness.finished;

    const content = await readFile(join(tempDir, 'notes.txt'), 'utf8');
    assert.equal(content, 'approved content');
    assert.equal(harness.getFailedError(), null);
    assert.equal(harness.getCompletedSummary(), 'completed after approval');
    assert.equal(harness.modelCalls.length, 1);
    assert.equal(harness.modelCalls[0]?.toolCountSeen, 1);
    assert.ok(harness.messages.some(message => message.role === 'tool' && message.content.includes('resumed_action:')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('start can complete through langchain agent execution without using legacy planner loop', async () => {
  const harness = createLangChainRuntimeHarness();
  const createdAgents: Array<{ messagesSeen: number }> = [];

  const langChainAgentService = {
    async createRuntimeAgent(input: {
      tools: Array<{ execute(context: unknown, args: Record<string, unknown>): Promise<{ summary: string; data: Record<string, unknown> }> }>
    }) {
      return {
        invoke: async () => ({ messages: [] }),
        stream: async (runtimeInput: { messages: Array<{ role: string; content: string }> }) => {
          createdAgents.push({ messagesSeen: runtimeInput.messages.length });
          await input.tools[0]?.execute({} as never, { taskId: 'task-langchain-1' });
          return (async function* () {
            yield {
              messages: [
                { role: 'assistant', content: 'langchain partial' },
              ],
            };
            yield {
              messages: [
                { role: 'assistant', content: 'langchain final answer' },
              ],
            };
          })();
        },
      };
    },
  };

  const runtime = new AgentRuntimeService(harness.appService as never, {
    modelService: harness.modelService as never,
    toolRegistry: harness.toolRegistry as never,
    langChainAgentService: langChainAgentService as never,
  });

  await runtime.start(harness.task.id, { agentName: 'Main Agent', kind: 'main' });
  await harness.finished;

  assert.equal(harness.getFailedError(), null);
  assert.equal(harness.getCompletedSummary(), 'langchain final answer');
  assert.equal(harness.toolExecutions.length, 1);
  assert.ok(harness.events.some(event => event.type === 'tool_called'));
  assert.ok(harness.events.some(event => event.type === 'tool_result'));
  assert.ok(harness.events.some(event => event.type === 'agent_message' && event.payload.content === 'langchain partial'));
  assert.ok(harness.messages.some(message => message.role === 'assistant' && message.content === 'langchain final answer'));
  assert.equal(createdAgents.length, 1);
});

test('start stops the langchain run when a tool requests approval', async () => {
  const harness = createLangChainRuntimeHarness();
  let createRuntimeAgentCalls = 0;

  const langChainAgentService = {
    async createRuntimeAgent(input: {
      tools: Array<{ execute(context: unknown, args: Record<string, unknown>): Promise<{ summary: string; data: Record<string, unknown> }> }>
    }) {
      createRuntimeAgentCalls += 1;
      return {
        invoke: async () => ({ messages: [] }),
        stream: async () => {
          const result = await input.tools[0]?.execute({} as never, { path: 'notes.txt' });
          throw new AgentApprovalPendingError('write_workspace_file', result);
        },
      };
    },
  };

  const toolRegistry = {
    listTools() {
      return [
        { name: 'write_workspace_file', description: 'Write a file into the workspace', requiresApproval: true },
      ];
    },
    getTool(name: AgentToolCall['name']) {
      return {
        name,
        requiresApproval: true,
        async execute() {
          return {
            summary: 'waiting for approval',
            data: {
              toolName: name,
              pendingApproval: true,
              approvalId: 'approval-1',
            },
          };
        },
      };
    },
  };

  const runtime = new AgentRuntimeService(harness.appService as never, {
    modelService: harness.modelService as never,
    toolRegistry: toolRegistry as never,
    langChainAgentService: langChainAgentService as never,
  });

  await runtime.start(harness.task.id, { agentName: 'Main Agent', kind: 'main' });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(harness.getFailedError(), null);
  assert.equal(harness.getCompletedSummary(), null);
  assert.equal(createRuntimeAgentCalls, 1);
  assert.ok(harness.events.some(event => event.type === 'tool_called'));
  assert.ok(harness.events.some(event => event.type === 'tool_result'));
  assert.ok(harness.messages.some(message => message.role === 'tool' && message.content.includes('waiting for approval')));
});

test('subagent management can append a message and stop a subagent run', async () => {
  const task = {
    id: 'task-subagent-1',
    title: 'Subagent control task',
    mode: 'ask',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'running',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mainRun = {
    id: 'run-main',
    taskId: task.id,
    workspaceIds: ['workspace-1'],
    agentId: 'agent-main',
    agentName: 'Main Agent',
    kind: 'main',
    status: 'running',
    graphThreadId: 'thread-main',
    currentNode: 'execution',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const subRun = {
    id: 'run-sub',
    taskId: task.id,
    workspaceIds: ['workspace-1'],
    agentId: 'agent-sub',
    agentName: 'research-subagent',
    kind: 'subagent',
    status: 'running',
    graphThreadId: 'thread-sub',
    parentRunId: mainRun.id,
    currentNode: 'execution',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];

  const appService = {
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    getAgentRun(runId: string) {
      return runId === mainRun.id ? mainRun : runId === subRun.id ? subRun : null;
    },
    listModelConfigs() {
      return [];
    },
    async createRuntimeRun() {
      throw new Error('not used');
    },
    async resumeRuntimeRun() {
      return mainRun;
    },
    getTaskContext() {
      return {
        task,
        messages,
        workspaces: [],
        approvals: [],
      };
    },
    async appendRuntimeMessage(_taskId: string, _runId: string, role: string, content: string, metadata?: Record<string, unknown>) {
      messages.push({ role, content, metadata });
    },
    async appendRuntimeEvent(_runId: string, type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
    async appendSubagentMessage(_runId: string, content: string) {
      messages.push({ role: 'assistant', content, metadata: { source: 'subagent_message' } });
    },
    async stopSubagentRun(runId: string) {
      if (runId !== subRun.id) {
        throw new Error('unexpected run id');
      }
      subRun.status = 'cancelled';
      return subRun;
    },
    async completeRuntimeRun() {
      return;
    },
    async failRuntimeRun() {
      return;
    },
  };

  const toolRegistry = {
    listTools() {
      return [
        { name: 'send_subagent_message', description: 'message subagent', requiresApproval: false },
        { name: 'stop_subagent', description: 'stop subagent', requiresApproval: false },
      ];
    },
    getTool(name: AgentToolCall['name']) {
      if (name === 'send_subagent_message') {
        return {
          name,
          async execute(context: any, args: Record<string, unknown>) {
            return context.sendSubagentMessage(String(args.runId), String(args.content));
          },
        };
      }

      if (name === 'stop_subagent') {
        return {
          name,
          async execute(context: any, args: Record<string, unknown>) {
            return context.stopSubagent(String(args.runId), typeof args.reason === 'string' ? args.reason : undefined);
          },
        };
      }

      return null;
    },
  };

  const runtime = new AgentRuntimeService(appService as never, {
    modelService: {
      resolveModelConfig() {
        return null;
      },
    } as never,
    toolRegistry: toolRegistry as never,
    langChainAgentService: createFallbackLangChainHarness() as never,
  });

  await (runtime as any).handleToolCall({
    task,
    run: mainRun,
    model: null,
    settings: appService.getSettings(),
  }, {
    name: 'send_subagent_message',
    arguments: {
      runId: subRun.id,
      content: 'Please continue the analysis',
    },
  });

  await (runtime as any).handleToolCall({
    task,
    run: mainRun,
    model: null,
    settings: appService.getSettings(),
  }, {
    name: 'stop_subagent',
    arguments: {
      runId: subRun.id,
      reason: 'main agent no longer needs parallel work',
    },
  });

  assert.ok(messages.some(message => message.content.includes('Please continue the analysis')));
  assert.equal(subRun.status, 'cancelled');
  assert.ok(events.some(event => event.type === 'subagent_completed'));
});

test('public subagent runtime controls forward to subagent helpers', async () => {
  const task = {
    id: 'task-subagent-public-1',
    title: 'Subagent public control task',
    mode: 'ask',
    modelId: 'model-1',
    permissionMode: 'default',
    connectorIds: [],
    skillIds: [],
    status: 'running',
    unreadEventCount: 0,
    primaryWorkspaceId: 'workspace-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const subRun = {
    id: 'run-sub-public',
    taskId: task.id,
    workspaceIds: ['workspace-1'],
    agentId: 'agent-sub',
    agentName: 'ops-subagent',
    kind: 'subagent',
    status: 'running',
    graphThreadId: 'thread-sub',
    parentRunId: 'run-main',
    currentNode: 'execution',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const calls: string[] = [];

  const appService = {
    getTask(taskId: string) {
      return taskId === task.id ? task : null;
    },
    getAgentRun(runId: string) {
      return runId === subRun.id ? subRun : null;
    },
    getSettings() {
      return {
        networkEnabled: false,
        webSearchEnabled: false,
        maxConcurrentRuns: 1,
        sandboxEnabled: true,
      };
    },
    listModelConfigs() {
      return [];
    },
    async appendSubagentMessage(_runId: string, content: string) {
      calls.push(`message:${content}`);
    },
    async stopSubagentRun(_runId: string, reason?: string) {
      calls.push(`stop:${reason ?? ''}`);
      subRun.status = 'cancelled';
      return subRun;
    },
    async appendRuntimeEvent(_runId: string, type: string) {
      calls.push(`event:${type}`);
    },
  };

  const runtime = new AgentRuntimeService(appService as never, {
    modelService: {
      resolveModelConfig() {
        return null;
      },
    } as never,
    toolRegistry: {
      listTools() {
        return [];
      },
      getTool() {
        return null;
      },
    } as never,
    langChainAgentService: createFallbackLangChainHarness() as never,
  });

  await runtime.sendSubagentMessage(task.id, subRun.id, 'follow up');
  await runtime.stopSubagentRun(task.id, subRun.id, 'done');

  assert.deepEqual(calls, [
    'message:follow up',
    'stop:done',
    'event:subagent_completed',
  ]);
});
