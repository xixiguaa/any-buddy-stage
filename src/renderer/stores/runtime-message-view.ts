import type { AgentEvent, Message } from '../../shared/types.js';

type StreamingEventSnapshot = {
  eventId: string
  taskId: string
  runId: string
  content: string
  createdAt: string
};

function extractLatestStreamingEvents(events: AgentEvent[]) {
  const latestByRunId = new Map<string, StreamingEventSnapshot>();

  for (const event of events) {
    if (event.type !== 'agent_message') {
      continue;
    }

    const role = typeof event.payload.role === 'string' ? event.payload.role : '';
    const content = typeof event.payload.content === 'string' ? event.payload.content : '';
    if (role !== 'assistant' || !content.trim()) {
      continue;
    }

    latestByRunId.set(event.runId, {
      eventId: event.id,
      taskId: event.taskId,
      runId: event.runId,
      content,
      createdAt: event.createdAt,
    });
  }

  return [...latestByRunId.values()];
}

export function buildVisibleMessages(baseMessages: Message[], events: AgentEvent[]): Message[] {
  const visibleMessages = [...baseMessages];
  const streamingEvents = extractLatestStreamingEvents(events);

  for (const event of streamingEvents) {
    const alreadyPersisted = baseMessages.some(message =>
      message.runId === event.runId &&
      message.role === 'assistant' &&
      message.content === event.content,
    );

    if (alreadyPersisted) {
      continue;
    }

    visibleMessages.push({
      id: `live-${event.runId}`,
      taskId: event.taskId,
      runId: event.runId,
      role: 'assistant',
      content: event.content,
      metadata: {
        synthetic: true,
        sourceEventId: event.eventId,
        streaming: true,
      },
      createdAt: event.createdAt,
    });
  }

  return visibleMessages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
