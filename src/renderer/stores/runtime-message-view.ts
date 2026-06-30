import type { AgentEvent, Message } from '../../shared/types.js';

type StreamingEventSnapshot = {
  eventId: string
  taskId: string
  runId: string
  content: string
  createdAt: string
};

export type RuntimeEventCard = {
  id: string
  taskId: string
  runId: string
  toolName?: string
  title: string
  description: string
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'error'
  detail?: string
  status?: 'running' | 'completed' | 'failed' | 'waiting_approval'
  createdAt: string
  eventType: AgentEvent['type']
};

function stringifyPayload(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readToolName(payload: Record<string, unknown>) {
  const toolName = payload.toolName;
  if (typeof toolName === 'string' && toolName.trim()) {
    return toolName;
  }

  const originalArgs = payload.originalArgs;
  if (originalArgs && typeof originalArgs === 'object') {
    const nestedToolName = (originalArgs as Record<string, unknown>).toolName;
    if (typeof nestedToolName === 'string' && nestedToolName.trim()) {
      return nestedToolName;
    }
  }

  return 'unknown';
}

function extractStreamingEvents(events: AgentEvent[]) {
  return events.flatMap<StreamingEventSnapshot>(event => {
    if (event.type !== 'agent_message') {
      return [];
    }

    const role = typeof event.payload.role === 'string' ? event.payload.role : '';
    const content = typeof event.payload.content === 'string' ? event.payload.content : '';
    if (role !== 'assistant' || !content.trim()) {
      return [];
    }

    return [{
      eventId: event.id,
      taskId: event.taskId,
      runId: event.runId,
      content,
      createdAt: event.createdAt,
    }];
  });
}
export function buildVisibleMessages(baseMessages: Message[], events: AgentEvent[]): Message[] {
  const visibleMessages = [...baseMessages];
  const streamingEvents = extractStreamingEvents(events);
  
  // 1. 将其他的工具和系统日志等运行时事件作为 synthetic message 混入进来，参与排序并展示
  for (const event of events) {
    const summary = summarizeRuntimeEvent(event);
    if (summary) {
      // 避免重复混入
      const alreadyHas = visibleMessages.some(m => m.id === `event-${event.id}`);
      if (!alreadyHas) {
        visibleMessages.push(summary);
      }
    }
  }

  // Group streaming events by runId
  const streamingEventsByRun = new Map<string, StreamingEventSnapshot[]>();
  for (const event of streamingEvents) {
    const list = streamingEventsByRun.get(event.runId) || [];
    list.push(event);
    streamingEventsByRun.set(event.runId, list);
  }

  for (const [runId, list] of streamingEventsByRun.entries()) {
    // If we already have a persisted assistant message for this run, ignore all streaming events of this run.
    const hasPersisted = baseMessages.some(message =>
      message.runId === runId &&
      message.role === 'assistant',
    );
    if (hasPersisted) {
      continue;
    }

    // Otherwise, only show the LATEST streaming event for this run.
    const latestEvent = list.at(-1);
    if (latestEvent) {
      visibleMessages.push({
        id: `live-${latestEvent.eventId}`,
        taskId: latestEvent.taskId,
        runId: latestEvent.runId,
        role: 'assistant',
        content: latestEvent.content,
        metadata: {
          synthetic: true,
          sourceEventId: latestEvent.eventId,
          streaming: true,
        },
        createdAt: latestEvent.createdAt,
      });
    }
  }

  return visibleMessages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
export function summarizeRuntimeEvent(event: AgentEvent): Message | null {
  const createdAt = event.createdAt;

  switch (event.type) {
    case 'tool_called':
      return {
        id: `event-${event.id}`,
        taskId: event.taskId,
        runId: event.runId,
        role: 'tool',
        content: `调用工具: ${String(event.payload.toolName ?? 'unknown')}`,
        metadata: {
          synthetic: true,
          sourceEventId: event.id,
          eventType: event.type,
          payload: event.payload,
        },
        createdAt,
      };
    case 'tool_result':
      return {
        id: `event-${event.id}`,
        taskId: event.taskId,
        runId: event.runId,
        role: 'tool',
        content: `工具结果: ${String(event.payload.toolName ?? 'unknown')}`,
        metadata: {
          synthetic: true,
          sourceEventId: event.id,
          eventType: event.type,
          payload: event.payload,
        },
        createdAt,
      };
    case 'subagent_started':
      return {
        id: `event-${event.id}`,
        taskId: event.taskId,
        runId: event.runId,
        role: 'system',
        content: `子 Agent 已启动 ${String(event.payload.expertId ?? 'default-expert')}`,
        metadata: {
          synthetic: true,
          sourceEventId: event.id,
          eventType: event.type,
          payload: event.payload,
        },
        createdAt,
      };
    case 'subagent_completed':
      return {
        id: `event-${event.id}`,
        taskId: event.taskId,
        runId: event.runId,
        role: 'system',
        content: `子 Agent 已结束 ${String(event.payload.expertId ?? 'default-expert')}`,
        metadata: {
          synthetic: true,
          sourceEventId: event.id,
          eventType: event.type,
          payload: event.payload,
        },
        createdAt,
      };
    case 'approval_requested':
      return {
        id: `event-${event.id}`,
        taskId: event.taskId,
        runId: event.runId,
        role: 'system',
        content: `等待恢复: ${String(event.payload.reason ?? '敏感操作需要确认参数')}`,
        metadata: {
          synthetic: true,
          sourceEventId: event.id,
          eventType: event.type,
          payload: event.payload,
        },
        createdAt,
      };
    default:
      return null;
  }
}

export function buildRuntimeEventCard(event: AgentEvent): RuntimeEventCard {
  switch (event.type) {
    case 'tool_called':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        toolName: String(event.payload.toolName ?? 'unknown'),
        title: `工具调用 · ${String(event.payload.toolName ?? 'unknown')}`,
        description: 'Agent 正在调用工具',
        tone: 'info',
        detail: stringifyPayload(event.payload.arguments),
        status: 'running',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'tool_result':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        toolName: String(event.payload.toolName ?? 'unknown'),
        title: `工具结果 · ${String(event.payload.toolName ?? 'unknown')}`,
        description: '工具已返回结果',
        tone: 'success',
        detail: stringifyPayload(event.payload.result),
        status: 'completed',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'approval_requested':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        toolName: readToolName(event.payload),
        title: '等待恢复',
        description: String(event.payload.reason ?? '敏感操作需要确认参数'),
        tone: 'warning',
        detail: stringifyPayload(event.payload.originalArgs),
        status: 'waiting_approval',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'interrupt_resolved':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        toolName: readToolName(event.payload),
        title: '中断已恢复',
        description: `恢复结果: ${String(event.payload.decision ?? 'resolved')}`,
        tone: String(event.payload.decision) === 'rejected' ? 'error' : 'success',
        detail: stringifyPayload(event.payload.editedArgs),
        status: String(event.payload.decision) === 'rejected' ? 'failed' : 'completed',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'subagent_started':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: `子 Agent 启动 · ${String(event.payload.expertId ?? 'default-expert')}`,
        description: String(event.payload.reason ?? '已启动协作子任务'),
        tone: 'info',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'subagent_completed':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: `子 Agent 结束 · ${String(event.payload.expertId ?? 'default-expert')}`,
        description: String(event.payload.status ?? 'completed'),
        tone: String(event.payload.status) === 'failed'
          ? 'error'
          : String(event.payload.status) === 'cancelled'
            ? 'warning'
            : 'success',
        detail: stringifyPayload(event.payload.summary ?? event.payload.reason ?? event.payload.error),
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'run_failed':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: '运行失败',
        description: String(event.payload.message ?? 'unknown error'),
        tone: 'error',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'run_completed':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: '运行完成',
        description: '当前运行已结束',
        tone: 'success',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    case 'run_status':
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: '状态更新',
        description: `${String(event.payload.status ?? 'unknown')} · ${String(event.payload.currentNode ?? 'idle')}`,
        tone: 'neutral',
        createdAt: event.createdAt,
        eventType: event.type,
      };
    default:
      return {
        id: event.id,
        taskId: event.taskId,
        runId: event.runId,
        title: event.type,
        description: '',
        tone: 'neutral',
        detail: stringifyPayload(event.payload),
        createdAt: event.createdAt,
        eventType: event.type,
      };
  }
}

export function buildRuntimeToolCards(events: AgentEvent[]): RuntimeEventCard[] {
  const cards: RuntimeEventCard[] = [];
  const pendingByTool = new Map<string, RuntimeEventCard>();

  for (const event of events) {
    if (event.type === 'tool_called') {
      const card = buildRuntimeEventCard(event);
      const toolName = card.toolName ?? 'unknown';
      const nextCard = {
        ...card,
        status: 'running' as const,
      };
      pendingByTool.set(`${event.runId}:${toolName}`, nextCard);
      cards.push(nextCard);
      continue;
    }

    if (event.type === 'tool_result' || event.type === 'interrupt_resolved' || event.type === 'approval_requested') {
      const toolName = readToolName(event.payload);
      const key = `${event.runId}:${toolName}`;
      const existing = pendingByTool.get(key);
      if (!existing) {
        cards.push({
          ...buildRuntimeEventCard(event),
          toolName,
          status: event.type === 'approval_requested' ? 'waiting_approval' : 'completed',
        });
        continue;
      }

      if (event.type === 'tool_result') {
        existing.title = `工具结果 · ${toolName}`;
        existing.description = '工具已返回结果';
        existing.detail = stringifyPayload(event.payload.result);
        existing.tone = 'success';
        existing.status = 'completed';
        continue;
      }

      if (event.type === 'approval_requested') {
        existing.title = '等待恢复';
        existing.description = String(event.payload.reason ?? '敏感操作需要确认参数');
        existing.detail = stringifyPayload(event.payload.originalArgs);
        existing.tone = 'warning';
        existing.status = 'waiting_approval';
        continue;
      }

      if (event.type === 'interrupt_resolved') {
        existing.title = '中断已恢复';
        existing.description = `恢复结果: ${String(event.payload.decision ?? 'resolved')}`;
        existing.detail = stringifyPayload(event.payload.editedArgs);
        existing.tone = String(event.payload.decision) === 'rejected' ? 'error' : 'success';
        existing.status = String(event.payload.decision) === 'rejected' ? 'failed' : 'completed';
      }
    }
  }

  return cards.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
