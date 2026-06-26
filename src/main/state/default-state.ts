import os from 'node:os'
import { join } from 'node:path'
import type { AppSettings, AppState } from '../../shared/types.js'
import { createId, nowIso } from '../../shared/utils.js'

export function createDefaultSettings(): AppSettings {
  return {
    networkEnabled: false,
    webSearchEnabled: false,
    maxConcurrentRuns: 2,
    sandboxEnabled: true,
  }
}

export function createDefaultState(): AppState {
  const now = nowIso()
  const workspace1 = {
    id: createId('workspace'),
    name: 'anybuddy-app',
    path: join(os.homedir(), 'Documents', 'anybuddy-app'),
    icon: 'folder',
    defaultPermissionMode: 'read_write' as const,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  const workspace2 = {
    id: createId('workspace'),
    name: 'anybuddy-docs',
    path: join(os.homedir(), 'Documents', 'anybuddy-docs'),
    icon: 'book',
    defaultPermissionMode: 'read_only' as const,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
  const task1 = {
    id: createId('task'),
    title: '整理多任务工作区设计',
    mode: 'plan' as const,
    modelId: 'local-preview',
    expertId: 'expert-design',
    primaryWorkspaceId: workspace1.id,
    permissionMode: 'default' as const,
    connectorIds: [],
    skillIds: [],
    status: 'running' as const,
    unreadEventCount: 2,
    lastRunId: createId('run'),
    createdAt: now,
    updatedAt: now,
  }

  const task2 = {
    id: createId('task'),
    title: '完善 API 设计说明',
    mode: 'craft' as const,
    modelId: 'local-preview',
    expertId: 'expert-doc',
    primaryWorkspaceId: workspace2.id,
    permissionMode: 'default' as const,
    connectorIds: [],
    skillIds: [],
    status: 'waiting_approval' as const,
    unreadEventCount: 1,
    lastRunId: createId('run'),
    createdAt: now,
    updatedAt: now,
  }

  const task3 = {
    id: createId('task'),
    title: '检查 web_search 集成',
    mode: 'ask' as const,
    modelId: 'local-preview',
    expertId: 'expert-research',
    primaryWorkspaceId: workspace1.id,
    permissionMode: 'default' as const,
    connectorIds: [],
    skillIds: [],
    status: 'queued' as const,
    unreadEventCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  return {
    version: 1,
    tasks: [task1, task2, task3],
    taskWorkspaces: [
      {
        id: createId('taskWorkspace'),
        taskId: task1.id,
        workspaceId: workspace1.id,
        role: 'primary',
        accessMode: 'read_write',
        addedAt: now,
      },
      {
        id: createId('taskWorkspace'),
        taskId: task1.id,
        workspaceId: workspace2.id,
        role: 'attached',
        accessMode: 'read_only',
        addedAt: now,
      },
      {
        id: createId('taskWorkspace'),
        taskId: task2.id,
        workspaceId: workspace2.id,
        role: 'primary',
        accessMode: 'read_only',
        addedAt: now,
      },
      {
        id: createId('taskWorkspace'),
        taskId: task3.id,
        workspaceId: workspace1.id,
        role: 'primary',
        accessMode: 'read_write',
        addedAt: now,
      },
    ],
    messages: [
      {
        id: createId('message'),
        taskId: task1.id,
        role: 'user',
        content: '把主工作区和关联工作区的关系补到详细设计里。',
        createdAt: now,
      },
      {
        id: createId('message'),
        taskId: task1.id,
        role: 'assistant',
        content: '已梳理出主工作区、附加工作区和并行任务模型。',
        createdAt: now,
      },
      {
        id: createId('message'),
        taskId: task2.id,
        role: 'user',
        content: '补一版渲染层与 IPC 层分离的架构说明。',
        createdAt: now,
      },
    ],
    drafts: [
      {
        taskId: task1.id,
        content: '继续补 agent tools 的设计',
        selectedSkillIds: ['skill-frontend-design'],
        selectedConnectorIds: [],
        updatedAt: now,
      },
    ],
    workspaces: [workspace1, workspace2],
    agentRuns: [
      {
        id: task1.lastRunId,
        taskId: task1.id,
        workspaceIds: [workspace1.id, workspace2.id],
        agentId: 'agent-main',
        agentName: 'Main Agent',
        kind: 'main',
        status: 'running',
        graphThreadId: createId('thread'),
        currentNode: 'plan',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: task2.lastRunId,
        taskId: task2.id,
        workspaceIds: [workspace2.id],
        agentId: 'agent-main',
        agentName: 'Main Agent',
        kind: 'main',
        status: 'waiting_approval',
        graphThreadId: createId('thread'),
        currentNode: 'approval',
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentEvents: [
      {
        id: createId('event'),
        taskId: task1.id,
        runId: task1.lastRunId,
        type: 'run_started',
        payload: { agentName: 'Main Agent', node: 'plan' },
        createdAt: now,
      },
      {
        id: createId('event'),
        taskId: task2.id,
        runId: task2.lastRunId,
        type: 'interrupt_requested',
        payload: { reason: 'Awaiting confirmation before writing API documentation changes.' },
        createdAt: now,
      },
    ],
    approvals: [
      {
        id: createId('approval'),
        taskId: task2.id,
        runId: task2.lastRunId,
        reason: 'Confirm write access for attached documentation workspace.',
        originalArgs: { workspaceId: workspace2.id, accessMode: 'read_write' },
        decision: 'pending',
        createdAt: now,
      },
    ],
    settings: createDefaultSettings(),
  }
}
