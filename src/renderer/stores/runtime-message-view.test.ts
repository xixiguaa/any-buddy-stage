import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, Message } from '../../shared/types.js';
import { buildRuntimeEventCard, buildVisibleMessages, summarizeRuntimeEvent } from './runtime-message-view.js';

function createMessage(input: Partial<Message> & Pick<Message, 'id' | 'taskId' | 'role' | 'content' | 'createdAt'>): Message {
  return {
    id: input.id,
    taskId: input.taskId,
    role: input.role,
    content: input.content,
    createdAt: input.createdAt,
    runId: input.runId,
    workspaceId: input.workspaceId,
    metadata: input.metadata,
  };
}

function createEvent(input: Partial<AgentEvent> & Pick<AgentEvent, 'id' | 'taskId' | 'runId' | 'type' | 'payload' | 'createdAt'>): AgentEvent {
  return {
    id: input.id,
    taskId: input.taskId,
    runId: input.runId,
    parentRunId: input.parentRunId,
    type: input.type,
    payload: input.payload,
    createdAt: input.createdAt,
  };
}

test('buildVisibleMessages appends a synthetic streaming assistant message from agent_message events', () => {
  const baseMessages = [
    createMessage({
      id: 'message-1',
      taskId: 'task-1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  ];

  const events = [
    createEvent({
      id: 'event-1',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: 'streaming answer',
      },
      createdAt: '2026-01-01T00:00:01.000Z',
    }),
  ];

  const visibleMessages = buildVisibleMessages(baseMessages, events);

  assert.equal(visibleMessages.length, 2);
  assert.deepEqual(visibleMessages[1], {
    id: 'live-event-1',
    taskId: 'task-1',
    runId: 'run-1',
    role: 'assistant',
    content: 'streaming answer',
    metadata: {
      synthetic: true,
      sourceEventId: 'event-1',
      streaming: true,
    },
    createdAt: '2026-01-01T00:00:01.000Z',
  });
});

test('buildVisibleMessages does not duplicate a persisted final assistant message and hides intermediate stream messages', () => {
  const baseMessages = [
    createMessage({
      id: 'message-1',
      taskId: 'task-1',
      runId: 'run-1',
      role: 'assistant',
      content: 'final answer',
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  ];

  const events = [
    createEvent({
      id: 'event-1',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: 'partial answer',
      },
      createdAt: '2026-01-01T00:00:01.000Z',
    }),
    createEvent({
      id: 'event-2',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: 'final answer',
      },
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  ];

  const visibleMessages = buildVisibleMessages(baseMessages, events);

  assert.equal(visibleMessages.length, 1);
  assert.equal(visibleMessages[0]?.id, 'message-1');
});

test('buildVisibleMessages only shows the latest streaming event when run is active', () => {
  const visibleMessages = buildVisibleMessages([], [
    createEvent({
      id: 'event-1',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: 'first chunk',
      },
      createdAt: '2026-01-01T00:00:01.000Z',
    }),
    createEvent({
      id: 'event-2',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: 'second chunk',
      },
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  ]);

  assert.equal(visibleMessages.length, 1);
  assert.equal(visibleMessages[0]?.content, 'second chunk');
});

test('summarizeRuntimeEvent converts tool and interrupt events into readable synthetic messages', () => {
  const toolEvent = createEvent({
    id: 'event-tool',
    taskId: 'task-1',
    runId: 'run-1',
    type: 'tool_called',
    payload: {
      toolName: 'read_workspace_file',
    },
    createdAt: '2026-01-01T00:00:03.000Z',
  });

  const interruptEvent = createEvent({
    id: 'event-interrupt',
    taskId: 'task-1',
    runId: 'run-1',
    type: 'approval_requested',
    payload: {
      reason: '请求写入文件',
    },
    createdAt: '2026-01-01T00:00:04.000Z',
  });

  assert.equal(summarizeRuntimeEvent(toolEvent)?.content, '调用工具: read_workspace_file');
  assert.equal(summarizeRuntimeEvent(interruptEvent)?.content, '等待恢复: 请求写入文件');
});

test('buildVisibleMessages keeps assistant progress text and tool events together in order', () => {
  const visibleMessages = buildVisibleMessages([], [
    createEvent({
      id: 'progress-1',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'agent_message',
      payload: {
        role: 'assistant',
        content: '你是想看“agent 为什么没有中间反馈”这件事，我先顺着这个方向检查一下，我先把 src/app.ts 读一遍，看看里面现在是怎么处理的。',
        source: 'runtime_tool_progress',
      },
      createdAt: '2026-01-01T00:00:01.000Z',
    }),
    createEvent({
      id: 'tool-1',
      taskId: 'task-1',
      runId: 'run-1',
      type: 'tool_called',
      payload: {
        toolName: 'read_workspace_file',
        arguments: {
          path: 'src/app.ts',
        },
      },
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  ]);

  assert.equal(visibleMessages.length, 2);
  assert.equal(visibleMessages[0]?.role, 'assistant');
  assert.match(visibleMessages[0]?.content ?? '', /先顺着这个方向检查一下/);
  assert.equal(visibleMessages[1]?.role, 'tool');
  assert.equal(visibleMessages[1]?.content, '调用工具: read_workspace_file');
});

test('buildRuntimeEventCard exposes structured tool result details for runtime timeline cards', () => {
  const toolResultEvent = createEvent({
    id: 'event-result',
    taskId: 'task-1',
    runId: 'run-1',
    type: 'tool_result',
    payload: {
      toolName: 'read_workspace_file',
      result: {
        path: 'src/app.ts',
      },
    },
    createdAt: '2026-01-01T00:00:05.000Z',
  });

  const card = buildRuntimeEventCard(toolResultEvent);
  assert.equal(card.title, '工具结果 · read_workspace_file');
  assert.equal(card.tone, 'success');
  assert.match(card.detail ?? '', /src\/app\.ts/);
});
