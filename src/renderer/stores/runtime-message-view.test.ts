import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, Message } from '../../shared/types.js';
import { buildVisibleMessages } from './runtime-message-view.js';

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
    id: 'live-run-1',
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

test('buildVisibleMessages does not duplicate a persisted final assistant message', () => {
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
