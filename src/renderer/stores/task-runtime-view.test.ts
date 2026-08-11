import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentRun, Task, TaskSummary } from '../../shared/types.js'
import { getStreamingEntriesForTask, mergeTaskSummary, sortTimelineMessages } from './task-runtime-view.js'

test('sortTimelineMessages interleaves feedback and tool events by original time', () => {
  const timeline = sortTimelineMessages([
    { id: 'tool-result', taskId: 'task-b', runId: 'run-b', role: 'tool', content: 'result', createdAt: '2026-07-29T00:00:03.000Z' },
    { id: 'feedback-1', taskId: 'task-b', runId: 'run-b', role: 'assistant', content: 'working', createdAt: '2026-07-29T00:00:01.000Z' },
    { id: 'tool-call', taskId: 'task-b', runId: 'run-b', role: 'tool', content: 'call', createdAt: '2026-07-29T00:00:02.000Z' },
  ])

  assert.deepEqual(timeline.map(message => message.id), ['feedback-1', 'tool-call', 'tool-result'])
})

function createRun(id: string, taskId: string): AgentRun {
  return {
    id,
    taskId,
    workspaceIds: [],
    agentId: `agent-${id}`,
    agentName: 'Main Agent',
    kind: 'main',
    status: 'running',
    graphThreadId: `thread-${id}`,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  }
}

function createTask(status: Task['status']): Task {
  return {
    id: 'task-b',
    title: '任务 B',
    mode: 'craft',
    modelId: 'model-1',
    expertIds: ['expert-1'],
    permissionMode: 'read_write',
    connectorIds: [],
    skillIds: [],
    status,
    unreadEventCount: 0,
    lastRunId: 'run-b',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:01:00.000Z',
  }
}

test('getStreamingEntriesForTask only returns streams owned by the requested task', () => {
  const entries = getStreamingEntriesForTask(
    {
      'stream-a': '任务 A 的流式内容',
      'stream-b': '任务 B 的流式内容',
    },
    {
      'run-a': ['stream-a'],
      'run-b': ['stream-b'],
    },
    [createRun('run-a', 'task-a'), createRun('run-b', 'task-b')],
    'task-b',
    { 'stream-b': '2026-07-29T00:00:02.000Z' },
  )

  assert.deepEqual(entries, [{
    id: 'stream-b',
    runId: 'run-b',
    taskId: 'task-b',
    content: '任务 B 的流式内容',
    createdAt: '2026-07-29T00:00:02.000Z',
  }])
})

test('mergeTaskSummary only changes summary fields from an authoritative task update', () => {
  const summary: TaskSummary = {
    id: 'task-b',
    title: '旧标题',
    mode: 'plan',
    status: 'running',
    unreadEventCount: 3,
    primaryWorkspaceId: 'workspace-1',
    primaryWorkspaceName: '主空间',
    expertIds: [],
    updatedAt: '2026-07-29T00:00:00.000Z',
  }

  const [updated] = mergeTaskSummary([summary], createTask('completed'))

  assert.equal(updated?.status, 'completed')
  assert.equal(updated?.title, '任务 B')
  assert.equal(updated?.mode, 'craft')
  assert.equal(updated?.primaryWorkspaceName, '主空间')
})
