import type { AgentRun, Task, TaskSummary } from '../../shared/types.js'

/**
 * 从主进程返回的 Task 更新任务摘要，避免任意历史 Run 覆盖当前任务状态。
 */
export function mergeTaskSummary(tasks: TaskSummary[], task: Task): TaskSummary[] {
  const idx = tasks.findIndex(item => item.id === task.id)
  if (idx === -1) return tasks
  const old = tasks[idx]
  return [
    ...tasks.slice(0, idx),
    {
      ...old,
      title: task.title,
      mode: task.mode,
      status: task.status,
      unreadEventCount: task.unreadEventCount,
      primaryWorkspaceId: task.primaryWorkspaceId,
      expertIds: task.expertIds,
      updatedAt: task.updatedAt,
    },
    ...tasks.slice(idx + 1),
  ]
}

export type StreamingEntry = {
  id: string
  runId: string
  taskId: string
  content: string
}

/**
 * 流式内容只允许在所属任务详情页渲染，防止切换任务后暂态消息串屏。
 */
export function getStreamingEntriesForTask(
  streamingContentByMessageId: Record<string, string>,
  streamingMessageIdsByRun: Record<string, string[]>,
  agentRuns: AgentRun[],
  taskId?: string,
): StreamingEntry[] {
  if (!taskId) {
    return []
  }

  const runIds = new Set(
    agentRuns
      .filter(run => run.taskId === taskId)
      .map(run => run.id),
  )
  const entries: StreamingEntry[] = []
  for (const runId of runIds) {
    for (const id of streamingMessageIdsByRun[runId] ?? []) {
      const content = streamingContentByMessageId[id]
      if (content !== undefined) {
        entries.push({ id, runId, taskId, content })
      }
    }
  }
  return entries
}
