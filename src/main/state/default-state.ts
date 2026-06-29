import os from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppState } from '../../shared/types.js';
import { createId, nowIso } from '../../shared/utils.js';

export function createDefaultSettings(): AppSettings {
  return {
    networkEnabled: false,
    webSearchEnabled: false,
    maxConcurrentRuns: 2,
    sandboxEnabled: true,
  };
}

export function createDefaultState(): AppState {
  const now = nowIso();
  const workspaceId = createId('workspace');
  const taskId = createId('task');
  const workspace = {
    id: workspaceId,
    name: '默认工作区',
    path: join(os.homedir(), 'Documents', 'AnyBuddy Workspace'),
    icon: 'folder',
    defaultPermissionMode: 'read_write' as const,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };

  const task = {
    id: taskId,
    title: '开始使用 AnyBuddy',
    mode: 'ask' as const,
    modelId: '',
    primaryWorkspaceId: workspaceId,
    permissionMode: 'default' as const,
    connectorIds: [],
    skillIds: [],
    status: 'idle' as const,
    unreadEventCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  return {
    version: 1,
    tasks: [task],
    taskWorkspaces: [
      {
        id: createId('taskWorkspace'),
        taskId,
        workspaceId,
        role: 'primary',
        accessMode: 'read_write',
        addedAt: now,
      },
    ],
    messages: [],
    drafts: [],
    workspaces: [workspace],
    agentRuns: [],
    agentEvents: [],
    approvals: [],
    modelConfigs: [],
    mcpConfigRaw: JSON.stringify({ mcpServers: {} }, null, 2),
    settings: {
      ...createDefaultSettings(),
      defaultWorkspaceId: workspaceId,
    },
  };
}
