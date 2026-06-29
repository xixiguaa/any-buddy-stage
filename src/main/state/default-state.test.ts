import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultSettings, createDefaultState } from './default-state.js';

test('createDefaultState returns one default workspace and one default task', () => {
  const state = createDefaultState();

  assert.equal(state.workspaces.length, 1);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.taskWorkspaces.length, 1);
  assert.equal(state.messages.length, 0);
  assert.equal(state.drafts.length, 0);
  assert.equal(state.agentRuns.length, 0);
  assert.equal(state.agentEvents.length, 0);
  assert.equal(state.approvals.length, 0);
  assert.equal(state.modelConfigs.length, 0);

  const workspace = state.workspaces[0];
  const task = state.tasks[0];
  const taskWorkspace = state.taskWorkspaces[0];

  assert.equal(workspace.name, '默认工作区');
  assert.equal(task.title, '开始使用 AnyBuddy');
  assert.equal(task.modelId, '');
  assert.equal(task.primaryWorkspaceId, workspace.id);
  assert.equal(taskWorkspace.workspaceId, workspace.id);
  assert.equal(taskWorkspace.taskId, task.id);

  assert.deepEqual(state.settings, {
    ...createDefaultSettings(),
    defaultWorkspaceId: workspace.id,
  });
});
