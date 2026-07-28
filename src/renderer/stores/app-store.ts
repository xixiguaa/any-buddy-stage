import { create } from 'zustand'
import type {
  AgentEvent,
  AgentRun,
  AppSettings,
  CreateTaskInput,
  CreateWorkspaceInput,
  HumanApproval,
  Message,
  ExpertPreset,
  ExpertTeamPreset,
  ModelConfig,
  Task,
  TaskDraft,
  TaskRuntimePayload,
  TaskSummary,
  TaskWorkspaceContext,
  WorkspaceSummary,
} from '../../shared/types.js'
import { createAnybuddyClients } from '../api/clients.js'
import { useAnybuddyClients } from '../api/context.js'
import { buildVisibleMessages, isPersistedFinalAssistantMessage } from './runtime-message-view.js'

function sanitizeModelConfigs(models: ModelConfig[]) {
  return models.filter(model => !(model.id === 'local-preview' && model.provider === 'builtin'))
}

export type SidebarTimeRange = 'all' | 'today' | 'last_7_days' | 'last_30_days'

type AppStoreState = {
  initialized: boolean
  selectedTaskId?: string
  tasks: TaskSummary[]
  taskDetail?: Task | null
  taskWorkspaces: TaskWorkspaceContext[]
  messages: Message[]
  streamingContentByMessageId: Record<string, string>
  streamingMessageIdsByRun: Record<string, string[]>
  drafts: Record<string, TaskDraft>
  workspaces: WorkspaceSummary[]
  settings: AppSettings | null
  agentRuns: AgentRun[]
  taskEvents: AgentEvent[]
  taskApprovals: HumanApproval[]
  experts: ExpertPreset[]
  expertTeams: ExpertTeamPreset[]
  sidebarSearch: string
  sidebarStatusFilter: 'all' | 'active' | 'waiting_approval' | 'failed'
  sidebarTimeRange: SidebarTimeRange
  bootstrap(): Promise<void>
  selectTask(taskId: string): Promise<void>
  reloadTask(taskId: string): Promise<void>
  createTask(input: CreateTaskInput, initialMessage?: string): Promise<Task>
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary | undefined>
  createWorkspaceFromFolderPicker(): Promise<WorkspaceSummary | undefined>
  sendMessage(taskId: string, content: string): Promise<void>
  loadDraft(taskId: string): Promise<void>
  saveDraft(taskId: string, draft: Omit<TaskDraft, 'taskId' | 'updatedAt'>): Promise<void>
  clearDraft(taskId: string): Promise<void>
  startRun(taskId: string): Promise<void>
  pauseRun(runId: string): Promise<void>
  resumeRun(runId: string): Promise<void>
  cancelRun(runId: string): Promise<void>
  approveTask(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>): Promise<void>
  resumeInterruptedRun(interruptId: string, action: 'resume' | 'cancel' | 'resume_with_edits', editedArgs?: Record<string, unknown>): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  setSidebarSearch(value: string): void
  setSidebarStatusFilter(value: AppStoreState['sidebarStatusFilter']): void
  setSidebarTimeRange(value: SidebarTimeRange): void
  refreshTaskIndex(): Promise<void>
  customModels: ModelConfig[]
  mcpConfigRaw: string
  loadCustomModels(): Promise<void>
  saveCustomModels(models: ModelConfig[]): Promise<void>
  loadExperts(): Promise<void>
  loadExpertTeams(): Promise<void>
  createExpert(input: Omit<ExpertPreset, 'createdAt' | 'updatedAt'>): Promise<ExpertPreset | undefined>
  deleteExpert(expertId: string): Promise<void>
  deleteTask(taskId: string): Promise<void>
  loadMcpConfig(): Promise<void>
  saveMcpConfig(content: string): Promise<void>
  summonedExpert: ExpertPreset | null
  summonedExpertTeam: ExpertTeamPreset | null
  recentExperts: ExpertPreset[]
  setSummonedExpert(expert: ExpertPreset | null, options?: { addToRecent?: boolean }): void
  setSummonedExpertTeam(team: ExpertTeamPreset | null): void
  clearRecentExperts(): void
}

let bootstrapSubscription: (() => void) | null = null
let selectedTaskSubscription: (() => void) | null = null
let selectedTaskPatchRaf: number | null = null
let selectedTaskPatchQueue: TaskRuntimePayload[] = []
let selectedTaskPatchTaskId: string | null = null
const RECENT_EXPERTS_STORAGE_KEY = 'anybuddy.recentExperts'
const RECENT_EXPERTS_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000
const STREAM_BATCH_FALLBACK_MS = 80

function parseRecentExpertsFromStorage(): ExpertPreset[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(RECENT_EXPERTS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as { updatedAt: number; experts: ExpertPreset[] }
    if (!parsed || typeof parsed.updatedAt !== 'number' || !Array.isArray(parsed.experts)) {
      window.localStorage.removeItem(RECENT_EXPERTS_STORAGE_KEY)
      return []
    }

    if (Date.now() - parsed.updatedAt >= RECENT_EXPERTS_MAX_AGE_MS) {
      window.localStorage.removeItem(RECENT_EXPERTS_STORAGE_KEY)
      return []
    }

    return parsed.experts
  } catch {
    window.localStorage.removeItem(RECENT_EXPERTS_STORAGE_KEY)
    return []
  }
}

function saveRecentExpertsToStorage(experts: ExpertPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  if (experts.length === 0) {
    window.localStorage.removeItem(RECENT_EXPERTS_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(RECENT_EXPERTS_STORAGE_KEY, JSON.stringify({
    updatedAt: Date.now(),
    experts,
  }))
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  return [...items.filter(item => item.id !== nextItem.id), nextItem]
}

function isStreamingAgentMessageEvent(event: AgentEvent) {
  return event.type === 'agent_message' && event.payload?.streaming === true
}

function hasPersistedFinalAssistantForRun(messages: Message[], runId?: string) {
  if (!runId) {
    return false
  }
  return messages.some(message => isPersistedFinalAssistantMessage(message, runId))
}

function readStreamEventId(message: Message) {
  const streamEventId = message.metadata?.streamEventId
  return typeof streamEventId === 'string' && streamEventId.trim().length > 0
    ? streamEventId
    : undefined
}

function hasPersistedStreamReplacement(messages: Message[], streamEventId: string) {
  return messages.some(message => readStreamEventId(message) === streamEventId)
}

function hasPersistedStreamReplacementsForRun(
  messages: Message[],
  streamingIdsByRun: Record<string, string[]>,
  runId: string,
) {
  return (streamingIdsByRun[runId] ?? []).every(streamEventId => (
    hasPersistedStreamReplacement(messages, streamEventId)
  ))
}

function removeStreamingMessage(
  streamingContent: Record<string, string>,
  streamingIdsByRun: Record<string, string[]>,
  runId: string,
  streamEventId: string,
) {
  const hasContent = streamingContent[streamEventId] !== undefined
  const runStreamIds = streamingIdsByRun[runId] ?? []
  if (!hasContent && !runStreamIds.includes(streamEventId)) {
    return {
      nextStreamingContent: streamingContent,
      nextStreamingIdsByRun: streamingIdsByRun,
    }
  }

  const { [streamEventId]: _omit, ...nextStreamingContent } = streamingContent
  const nextRunStreamIds = runStreamIds.filter(id => id !== streamEventId)
  const nextStreamingIdsByRun = nextRunStreamIds.length > 0
    ? { ...streamingIdsByRun, [runId]: nextRunStreamIds }
    : (() => {
        const { [runId]: _removed, ...rest } = streamingIdsByRun
        return rest
      })()

  return { nextStreamingContent, nextStreamingIdsByRun }
}

function removeStreamingRun(
  streamingContent: Record<string, string>,
  streamingIdsByRun: Record<string, string[]>,
  runId: string,
) {
  const ids = streamingIdsByRun[runId] ?? []
  let nextStreamingContent = streamingContent
  if (ids.length > 0) {
    nextStreamingContent = { ...streamingContent }
    for (const id of ids) {
      delete nextStreamingContent[id]
    }
  }

  const { [runId]: _omit, ...nextStreamingIdsByRun } = streamingIdsByRun
  return { nextStreamingContent, nextStreamingIdsByRun }
}

/**
 * 单条更新 task summary：run 状态变化时使用，不触发 IPC、不拉全量。
 * AgentRunStatus 与 TaskStatus 字面量完全重叠，可直接 cast。
 */
function mergeTaskSummary(tasks: TaskSummary[], taskId: string, run: AgentRun): TaskSummary[] {
  const idx = tasks.findIndex(t => t.id === taskId)
  if (idx === -1) return tasks
  const old = tasks[idx]
  return [
    ...tasks.slice(0, idx),
    {
      ...old,
      status: run.status as TaskSummary['status'],
      updatedAt: run.updatedAt,
    },
    ...tasks.slice(idx + 1),
  ]
}

function mergeTaskRuntimePayload(state: AppStoreState, taskId: string, payload: TaskRuntimePayload) {
  if (payload.kind === 'snapshot') {
    const messages = buildVisibleMessages(payload.messages, payload.events)
    const activeRun = payload.runs.find(run => run.id === state.taskDetail?.lastRunId) ?? payload.runs[0]
    // snapshot 通常是初始全量，同时从流式事件恢复仍未被持久化消息替换的临时态。
    const streamingContentByMessageId: Record<string, string> = {}
    const streamingMessageIdsByRun: Record<string, string[]> = {}

    for (const event of payload.events) {
      if (!isStreamingAgentMessageEvent(event) || hasPersistedStreamReplacement(payload.messages, event.id)) {
        continue
      }
      const content = event.payload.content
      if (typeof content !== 'string' || content.length === 0) {
        continue
      }
      streamingContentByMessageId[event.id] = content
      const existingIds = streamingMessageIdsByRun[event.runId] ?? []
      if (!existingIds.includes(event.id)) {
        streamingMessageIdsByRun[event.runId] = [...existingIds, event.id]
      }
    }

    for (const message of payload.messages) {
      if (message.role === 'assistant' && message.metadata?.streaming && message.runId) {
        streamingContentByMessageId[message.id] = message.content
        const existingIds = streamingMessageIdsByRun[message.runId] ?? []
        if (!existingIds.includes(message.id)) {
          streamingMessageIdsByRun[message.runId] = [...existingIds, message.id]
        }
      }
    }
    return {
      agentRuns: [
        ...state.agentRuns.filter(run => run.taskId !== taskId),
        ...payload.runs,
      ],
      taskEvents: payload.events,
      taskApprovals: payload.approvals,
      messages,
      // snapshot 重置 tasks：保留状态中已有项，更新当前 task 摘要
      tasks: state.tasks.some(t => t.id === taskId)
        ? state.tasks.map(t => {
            const matched = activeRun && t.id === taskId
            if (!matched) return t
            return {
              ...t,
              status: activeRun!.status as TaskSummary['status'],
              updatedAt: activeRun!.updatedAt,
            }
          })
        : state.tasks,
      streamingContentByMessageId,
      streamingMessageIdsByRun,
      taskDetail: state.taskDetail && state.taskDetail.id === taskId
        ? {
            ...state.taskDetail,
            status: activeRun?.status ?? state.taskDetail.status,
            updatedAt: activeRun?.updatedAt ?? state.taskDetail.updatedAt,
            lastRunId: activeRun?.id ?? state.taskDetail.lastRunId,
          }
        : state.taskDetail,
    }
  }

  const nextRuns = payload.run
    ? [
        ...state.agentRuns.filter(run => !(run.taskId === taskId && run.id === payload.run?.id)),
        payload.run,
      ]
    : state.agentRuns

  const nextEvents = payload.event && !isStreamingAgentMessageEvent(payload.event)
    ? upsertById(state.taskEvents, payload.event)
    : state.taskEvents

  const nextApprovals = payload.approval
    ? upsertById(state.taskApprovals, payload.approval)
    : state.taskApprovals

  let persistedMessages = state.messages.filter(message => !message.metadata?.synthetic)
  let nextStreamingContent = state.streamingContentByMessageId
  let nextStreamingIdsByRun = state.streamingMessageIdsByRun

  if (payload.event && isStreamingAgentMessageEvent(payload.event)) {
    const runId = payload.event.runId
    const eventId = payload.event.id
    if (
      runId &&
      hasPersistedFinalAssistantForRun(persistedMessages, runId) &&
      hasPersistedStreamReplacementsForRun(persistedMessages, nextStreamingIdsByRun, runId)
    ) {
      const cleared = removeStreamingRun(nextStreamingContent, nextStreamingIdsByRun, runId)
      nextStreamingContent = cleared.nextStreamingContent
      nextStreamingIdsByRun = cleared.nextStreamingIdsByRun
    } else if (runId && hasPersistedStreamReplacement(persistedMessages, eventId)) {
      const removed = removeStreamingMessage(nextStreamingContent, nextStreamingIdsByRun, runId, eventId)
      nextStreamingContent = removed.nextStreamingContent
      nextStreamingIdsByRun = removed.nextStreamingIdsByRun
    } else {
      const streamingContent = payload.event.payload?.content
      if (typeof streamingContent === 'string' && streamingContent.length > 0) {
        if (nextStreamingContent[eventId] !== streamingContent) {
          nextStreamingContent = { ...nextStreamingContent, [eventId]: streamingContent }
        }
        if (runId) {
          const existingIds = nextStreamingIdsByRun[runId] ?? []
          if (!existingIds.includes(eventId)) {
            nextStreamingIdsByRun = {
              ...nextStreamingIdsByRun,
              [runId]: [...existingIds, eventId],
            }
          }
        }
      }
    }
  }

  if (payload.message) {
    persistedMessages = upsertById(persistedMessages, payload.message)
    const completedRunId = payload.message.runId
    const streamEventId = readStreamEventId(payload.message)
    if (completedRunId && streamEventId) {
      const removed = removeStreamingMessage(nextStreamingContent, nextStreamingIdsByRun, completedRunId, streamEventId)
      nextStreamingContent = removed.nextStreamingContent
      nextStreamingIdsByRun = removed.nextStreamingIdsByRun
    }
    if (
      completedRunId &&
      isPersistedFinalAssistantMessage(payload.message, completedRunId) &&
      hasPersistedStreamReplacementsForRun(persistedMessages, nextStreamingIdsByRun, completedRunId)
    ) {
      const cleared = removeStreamingRun(nextStreamingContent, nextStreamingIdsByRun, completedRunId)
      nextStreamingContent = cleared.nextStreamingContent
      nextStreamingIdsByRun = cleared.nextStreamingIdsByRun
    }
  }

  const nextMessages = payload.message || (payload.event && !isStreamingAgentMessageEvent(payload.event))
    ? buildVisibleMessages(persistedMessages, nextEvents)
    : state.messages
  const taskRuns = nextRuns.filter(run => run.taskId === taskId)
  const activeRun = taskRuns.find(run => run.id === state.taskDetail?.lastRunId) ?? taskRuns[0]

  let nextTasks = state.tasks
  if (payload.task) {
    nextTasks = nextTasks.map(t => t.id === taskId ? { ...t, title: payload.task!.title } : t)
  } else if (payload.run) {
    nextTasks = mergeTaskSummary(nextTasks, taskId, payload.run)
  }

  let nextTaskDetail = state.taskDetail
  if (payload.task && nextTaskDetail && nextTaskDetail.id === taskId) {
    nextTaskDetail = { ...nextTaskDetail, ...payload.task }
  } else if (nextTaskDetail && nextTaskDetail.id === taskId) {
    nextTaskDetail = {
      ...nextTaskDetail,
      status: activeRun?.status ?? nextTaskDetail.status,
      updatedAt: activeRun?.updatedAt ?? nextTaskDetail.updatedAt,
      lastRunId: activeRun?.id ?? nextTaskDetail.lastRunId,
    }
  }

  return {
    agentRuns: nextRuns,
    taskEvents: nextEvents,
    taskApprovals: nextApprovals,
    messages: nextMessages,
    tasks: nextTasks,
    streamingContentByMessageId: nextStreamingContent,
    streamingMessageIdsByRun: nextStreamingIdsByRun,
    taskDetail: nextTaskDetail,
  }
}

function mergeTaskRuntimePayloads(state: AppStoreState, taskId: string, payloads: TaskRuntimePayload[]) {
  let nextRuns = state.agentRuns
  let nextEvents = state.taskEvents
  let nextApprovals = state.taskApprovals
  let persistedMessages = state.messages.filter(message => !message.metadata?.synthetic)
  let nextStreamingContent = state.streamingContentByMessageId
  let nextStreamingIdsByRun = state.streamingMessageIdsByRun
  let taskDetail = state.taskDetail
  let nextTasks = state.tasks
  let hasRunPatch = false
  let latestRunPatch: AgentRun | null = null
  let hasVisibleMessageChange = false

  for (const payload of payloads) {
    if (payload.kind === 'snapshot') {
      return mergeTaskRuntimePayload(state, taskId, payload)
    }

    if (payload.run) {
      hasRunPatch = true
      latestRunPatch = payload.run
      nextRuns = [
        ...nextRuns.filter(run => !(run.taskId === taskId && run.id === payload.run?.id)),
        payload.run,
      ]
    }

    if (payload.event) {
      if (!isStreamingAgentMessageEvent(payload.event)) {
        nextEvents = upsertById(nextEvents, payload.event)
        hasVisibleMessageChange = true
      }
      if (isStreamingAgentMessageEvent(payload.event)) {
        const runId = payload.event.runId
        const eventId = payload.event.id
        if (
          runId &&
          hasPersistedFinalAssistantForRun(persistedMessages, runId) &&
          hasPersistedStreamReplacementsForRun(persistedMessages, nextStreamingIdsByRun, runId)
        ) {
          const cleared = removeStreamingRun(nextStreamingContent, nextStreamingIdsByRun, runId)
          nextStreamingContent = cleared.nextStreamingContent
          nextStreamingIdsByRun = cleared.nextStreamingIdsByRun
        } else if (runId && hasPersistedStreamReplacement(persistedMessages, eventId)) {
          const removed = removeStreamingMessage(nextStreamingContent, nextStreamingIdsByRun, runId, eventId)
          nextStreamingContent = removed.nextStreamingContent
          nextStreamingIdsByRun = removed.nextStreamingIdsByRun
        } else {
          const streamingContent = payload.event.payload?.content
          if (typeof streamingContent === 'string' && streamingContent.length > 0) {
            if (nextStreamingContent[eventId] !== streamingContent) {
              nextStreamingContent = { ...nextStreamingContent, [eventId]: streamingContent }
            }
            if (runId) {
              const existingIds = nextStreamingIdsByRun[runId] ?? []
              if (!existingIds.includes(eventId)) {
                nextStreamingIdsByRun = {
                  ...nextStreamingIdsByRun,
                  [runId]: [...existingIds, eventId],
                }
              }
            }
          }
        }
      }
    }

    if (payload.approval) {
      nextApprovals = upsertById(nextApprovals, payload.approval)
    }

    if (payload.message) {
      persistedMessages = upsertById(persistedMessages, payload.message)
      hasVisibleMessageChange = true
      const completedRunId = payload.message.runId
      const streamEventId = readStreamEventId(payload.message)
      if (completedRunId && streamEventId) {
        const removed = removeStreamingMessage(nextStreamingContent, nextStreamingIdsByRun, completedRunId, streamEventId)
        nextStreamingContent = removed.nextStreamingContent
        nextStreamingIdsByRun = removed.nextStreamingIdsByRun
      }
      if (
        completedRunId &&
        isPersistedFinalAssistantMessage(payload.message, completedRunId) &&
        hasPersistedStreamReplacementsForRun(persistedMessages, nextStreamingIdsByRun, completedRunId)
      ) {
        const cleared = removeStreamingRun(nextStreamingContent, nextStreamingIdsByRun, completedRunId)
        nextStreamingContent = cleared.nextStreamingContent
        nextStreamingIdsByRun = cleared.nextStreamingIdsByRun
      }
    }

    if (payload.task) {
      if (taskDetail && taskDetail.id === taskId) {
        taskDetail = { ...taskDetail, ...payload.task }
      }
      nextTasks = nextTasks.map(t => t.id === taskId ? { ...t, title: payload.task!.title } : t)
    }
  }

  const nextMessages = hasVisibleMessageChange ? buildVisibleMessages(persistedMessages, nextEvents) : state.messages
  const taskRuns = nextRuns.filter(run => run.taskId === taskId)
  const activeRun = taskRuns.find(run => run.id === taskDetail?.lastRunId) ?? taskRuns[0]

  if (taskDetail && taskDetail.id === taskId) {
    taskDetail = {
      ...taskDetail,
      status: activeRun?.status ?? taskDetail.status,
      updatedAt: activeRun?.updatedAt ?? taskDetail.updatedAt,
      lastRunId: activeRun?.id ?? taskDetail.lastRunId,
    }
  }

  return {
    agentRuns: nextRuns,
    taskEvents: nextEvents,
    taskApprovals: nextApprovals,
    messages: nextMessages,
    tasks: hasRunPatch && latestRunPatch ? mergeTaskSummary(nextTasks, taskId, latestRunPatch) : nextTasks,
    streamingContentByMessageId: nextStreamingContent,
    streamingMessageIdsByRun: nextStreamingIdsByRun,
    taskDetail,
  }
}

function clearTaskRuntimePatchQueue() {
  selectedTaskPatchQueue = []
  selectedTaskPatchTaskId = null
  if (selectedTaskPatchRaf !== null) {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(selectedTaskPatchRaf)
    } else {
      window.clearTimeout(selectedTaskPatchRaf)
    }
    selectedTaskPatchRaf = null
  }
}

function enqueueTaskRuntimePayload(taskId: string, payload: TaskRuntimePayload, apply: (taskId: string, payloads: TaskRuntimePayload[]) => void) {
  if (payload.kind === 'snapshot') {
    clearTaskRuntimePatchQueue()
    apply(taskId, [payload])
    return
  }

  selectedTaskPatchTaskId = taskId
  selectedTaskPatchQueue.push(payload)
  if (selectedTaskPatchRaf !== null) {
    return
  }

  // 用 requestAnimationFrame 把 patch flush 对齐到下一帧（~16ms）。
  // 浏览器/标签页隐藏时 rAF 不触发，所以保留 setTimeout 兜底。
  const schedule = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
    ? window.requestAnimationFrame.bind(window)
    : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), STREAM_BATCH_FALLBACK_MS)

  selectedTaskPatchRaf = schedule(() => {
    const queuedTaskId = selectedTaskPatchTaskId
    const queuedPayloads = selectedTaskPatchQueue
    selectedTaskPatchQueue = []
    selectedTaskPatchTaskId = null
    selectedTaskPatchRaf = null

    if (queuedTaskId && queuedPayloads.length > 0) {
      apply(queuedTaskId, queuedPayloads)
    }
  })
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  initialized: false,
  tasks: [],
  taskWorkspaces: [],
  messages: [],
  streamingContentByMessageId: {},
  streamingMessageIdsByRun: {},
  drafts: {},
  workspaces: [],
  settings: null,
  agentRuns: [],
  taskEvents: [],
  taskApprovals: [],
  experts: [],
  expertTeams: [],
  sidebarSearch: '',
  sidebarStatusFilter: 'all',
  sidebarTimeRange: 'all',
  customModels: [],
  mcpConfigRaw: '{}',
  recentExperts: parseRecentExpertsFromStorage(),
  summonedExpert: null,
  summonedExpertTeam: null,
  setSummonedExpert(expert, options) {
    set(state => {
      const shouldAddToRecent = options?.addToRecent ?? false
      const recentExperts = shouldAddToRecent && expert
        ? [expert, ...state.recentExperts.filter(item => item.id !== expert.id)].slice(0, 10)
        : state.recentExperts

      if (shouldAddToRecent) {
        saveRecentExpertsToStorage(recentExperts)
      }

      return {
        summonedExpert: expert,
        recentExperts,
      }
    })
  },
  setSummonedExpertTeam(team) {
    set({ summonedExpertTeam: team })
  },
  clearRecentExperts() {
    saveRecentExpertsToStorage([])
    set({ recentExperts: [] })
  },
  async refreshTaskIndex() {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.task.list()
    if (result.ok) {
      set({ tasks: result.data })
    }
  },
  async bootstrap() {
    const clients = createAnybuddyClients(window.anybuddy)
    const [tasksResult, workspacesResult, settingsResult, runsResult, runningTasksResult] = await Promise.all([
      clients.task.list(),
      clients.workspace.list(),
      clients.settings.get(),
      clients.agentRun.listActive(),
      clients.task.listRunning(),
    ])

    if (tasksResult.ok && workspacesResult.ok && settingsResult.ok && runsResult.ok && runningTasksResult.ok) {
      const drafts: Record<string, TaskDraft> = {}
      for (const task of tasksResult.data) {
        const draftResult = await clients.draft.get(task.id)
        if (draftResult.ok && draftResult.data) {
          drafts[task.id] = draftResult.data
        }
      }

      set({
        initialized: true,
        tasks: tasksResult.data,
        workspaces: workspacesResult.data,
        settings: settingsResult.data,
        agentRuns: runsResult.data,
        drafts,
      })
    }

    if (bootstrapSubscription) {
      bootstrapSubscription()
    }
    bootstrapSubscription = clients.agentRun.subscribeActive(runs => {
      set({ agentRuns: runs })
    })

    await Promise.all([
      get().loadCustomModels(),
      get().loadExperts(),
      get().loadExpertTeams(),
      get().loadMcpConfig(),
    ])
  },
  async selectTask(taskId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const [taskResult, taskWorkspacesResult, messagesResult, draftResult, runsResult, eventsResult, approvalsResult] = await Promise.all([
      clients.task.get(taskId),
      clients.task.listWorkspaces(taskId),
      clients.message.list(taskId),
      clients.draft.get(taskId),
      clients.agentRun.listByTask(taskId),
      clients.agentRun.listEvents(taskId),
      clients.agentRun.listApprovals(taskId),
    ])

    if (selectedTaskSubscription) {
      selectedTaskSubscription()
      clearTaskRuntimePatchQueue()
    }
    selectedTaskSubscription = clients.agentRun.subscribeTask(taskId, payload => {
      enqueueTaskRuntimePayload(taskId, payload, (queuedTaskId, payloads) => {
        set(state => mergeTaskRuntimePayloads(state, queuedTaskId, payloads))
      })
    })

    set(state => ({
      selectedTaskId: taskId,
      taskDetail: taskResult.ok ? taskResult.data : state.taskDetail,
      taskWorkspaces: taskWorkspacesResult.ok ? taskWorkspacesResult.data : state.taskWorkspaces,
      messages: messagesResult.ok && eventsResult.ok
        ? buildVisibleMessages(messagesResult.data, eventsResult.data)
        : messagesResult.ok
          ? messagesResult.data
          : state.messages,
      drafts: draftResult.ok && draftResult.data
        ? { ...state.drafts, [taskId]: draftResult.data }
        : state.drafts,
      agentRuns: runsResult.ok
        ? [
            ...state.agentRuns.filter(run => run.taskId !== taskId),
            ...runsResult.data,
          ]
        : state.agentRuns,
      taskEvents: eventsResult.ok ? eventsResult.data : state.taskEvents,
      taskApprovals: approvalsResult.ok ? approvalsResult.data : state.taskApprovals,
    }))
    if (taskResult.ok && taskResult.data) {
      await clients.task.markRead(taskId)
      set(state => ({
        taskDetail: state.taskDetail && state.taskDetail.id === taskId
          ? { ...state.taskDetail, unreadEventCount: 0 }
          : state.taskDetail,
        // 单条更新 task summary：unreadEventCount 清零
        tasks: state.tasks.map(t => t.id === taskId ? { ...t, unreadEventCount: 0 } : t),
      }))
    }
  },
  async reloadTask(taskId: string) {
    await get().selectTask(taskId)
  },
  async createTask(input: CreateTaskInput, initialMessage) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.task.create(input)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    const task = result.data
    const workspacesResult = await clients.workspace.list()
    const currentWorkspaces = workspacesResult.ok ? workspacesResult.data : get().workspaces

    set(state => ({
      workspaces: currentWorkspaces,
      tasks: [awaitSummary(task, currentWorkspaces), ...state.tasks],
    }))

    if (initialMessage) {
      const messageResult = await clients.message.create(task.id, { content: initialMessage, role: 'user' })
      if (!messageResult.ok) {
        throw new Error(messageResult.error.message)
      }

      const runResult = await clients.agentRun.start(task.id, { agentName: 'Main Agent', kind: 'main' })
      if (!runResult.ok) {
        throw new Error(runResult.error.message)
      }
    }
    return task
  },
  async createWorkspace(input: CreateWorkspaceInput) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.workspace.createFromPath(input)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    const refreshed = await clients.workspace.list()
    if (refreshed.ok) {
      set({ workspaces: refreshed.data })
      return refreshed.data.find(workspace => workspace.id === result.data.id)
    }
    return undefined
  },
  async createWorkspaceFromFolderPicker() {
    const clients = createAnybuddyClients(window.anybuddy)
    const picked = await clients.workspace.pickFolder()
    if (!picked.ok || !picked.data) {
      return undefined
    }

    const existingWorkspace = get().workspaces.find(workspace => workspace.path === picked.data)
    if (existingWorkspace) {
      return existingWorkspace
    }

    const normalizedPath = picked.data.replace(/\\/g, '/').replace(/\/+$/, '')
    const segments = normalizedPath.split('/').filter(Boolean)
    const name = segments.at(-1) ?? picked.data

    return get().createWorkspace({
      name,
      path: picked.data,
    })
  },
  async sendMessage(taskId: string, content: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.message.create(taskId, { content, role: 'user' })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    set(state => ({
      messages: [
        ...state.messages.filter(message => message.id !== result.data.id),
        result.data,
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    }))
    const runResult = await clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })
    if (!runResult.ok) {
      throw new Error(runResult.error.message)
    }
    await get().refreshTaskIndex()
  },
  async loadDraft(taskId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.draft.get(taskId)
    set(state => {
      const drafts = { ...state.drafts }
      if (result.ok && result.data) {
        drafts[taskId] = result.data
      } else {
        delete drafts[taskId]
      }
      return { drafts }
    })
  },
  async saveDraft(taskId: string, draft: Omit<TaskDraft, 'taskId' | 'updatedAt'>) {
    const current = get().drafts[taskId]
    if (
      current &&
      current.content === draft.content &&
      JSON.stringify(current.selectedSkillIds) === JSON.stringify(draft.selectedSkillIds) &&
      JSON.stringify(current.selectedConnectorIds) === JSON.stringify(draft.selectedConnectorIds) &&
      JSON.stringify(current.selectedExpertIds) === JSON.stringify(draft.selectedExpertIds) &&
      current.selectedExpertId === draft.selectedExpertId &&
      current.selectedExpertTeamId === draft.selectedExpertTeamId
    ) {
      return
    }

    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.draft.save(taskId, draft)
    if (result.ok) {
      set(state => ({
        drafts: {
          ...state.drafts,
          [taskId]: result.data,
        },
      }))
    }
  },
  async clearDraft(taskId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.draft.clear(taskId)
    set(state => {
      const next = { ...state.drafts }
      delete next[taskId]
      return { drafts: next }
    })
  },
  async startRun(taskId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    await get().reloadTask(taskId)
  },
  async pauseRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.agentRun.pause(runId)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
  },
  async resumeRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.agentRun.resume(runId)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
  },
  async cancelRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.agentRun.cancel(runId)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
  },
  async approveTask(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.agentRun.approve(approvalId, decision, editedArgs)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    if (get().selectedTaskId) {
      await get().reloadTask(get().selectedTaskId!)
    }
  },
  async resumeInterruptedRun(interruptId: string, action: 'resume' | 'cancel' | 'resume_with_edits', editedArgs?: Record<string, unknown>) {
    const decision = action === 'cancel'
      ? 'rejected'
      : action === 'resume_with_edits'
        ? 'edited'
        : 'approved'

    await get().approveTask(interruptId, decision, editedArgs)
  },
  async updateSettings(patch: Partial<AppSettings>) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.settings.update(patch)
    if (result.ok) {
      set({ settings: result.data })
    }
  },
  setSidebarSearch(value: string) {
    set({ sidebarSearch: value })
  },
  setSidebarStatusFilter(value: AppStoreState['sidebarStatusFilter']) {
    set({ sidebarStatusFilter: value })
  },
  setSidebarTimeRange(value: SidebarTimeRange) {
    set({ sidebarTimeRange: value })
  },
  async loadCustomModels() {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.config.readModels()
    if (result.ok) {
      try {
        const list = JSON.parse(result.data) as ModelConfig[]
        set({ customModels: Array.isArray(list) ? sanitizeModelConfigs(list) : [] })
      } catch {
        set({ customModels: [] })
      }
    }
  },
  async loadExperts() {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.expert.list()
    if (result.ok) {
      set({ experts: result.data })
    }
  },
  async loadExpertTeams() {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.expertTeam.list()
    if (result.ok) {
      set({ expertTeams: result.data })
    }
  },
  async createExpert(input) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.expert.create(input)
    if (result.ok) {
      set(state => ({ experts: [...state.experts.filter(expert => expert.id !== result.data.id), result.data] }))
      return result.data
    }
    return undefined
  },
  async deleteExpert(expertId) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.expert.delete(expertId)
    if (result.ok) {
      set(state => ({ experts: state.experts.filter(expert => expert.id !== expertId) }))
    }
  },
  async deleteTask(taskId) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.task.delete(taskId)
    if (result.ok) {
      set(state => {
        const nextSelected = state.selectedTaskId === taskId ? undefined : state.selectedTaskId
        return {
          tasks: state.tasks.filter(task => task.id !== taskId),
          selectedTaskId: nextSelected,
          taskDetail: state.selectedTaskId === taskId ? null : state.taskDetail,
        }
      })
    }
  },
  async saveCustomModels(models) {
    const clients = createAnybuddyClients(window.anybuddy)
    const sanitized = sanitizeModelConfigs(models)
    const content = JSON.stringify(sanitized, null, 2)
    const result = await clients.config.writeModels(content)
    if (result.ok) {
      set({ customModels: sanitized })
    }
  },
  async loadMcpConfig() {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.config.readMcp()
    if (result.ok) {
      set({ mcpConfigRaw: result.data })
    }
  },
  async saveMcpConfig(content) {
    const clients = createAnybuddyClients(window.anybuddy)
    const result = await clients.config.writeMcp(content)
    if (result.ok) {
      set({ mcpConfigRaw: content })
    }
  },
}))

function awaitSummary(task: Task, workspaces: WorkspaceSummary[]): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    mode: task.mode,
    status: task.status,
    unreadEventCount: task.unreadEventCount,
    primaryWorkspaceId: task.primaryWorkspaceId,
    primaryWorkspaceName: workspaces.find(workspace => workspace.id === task.primaryWorkspaceId)?.name,
    expertIds: task.expertIds,
    updatedAt: task.updatedAt,
  }
}

export function useAnybuddyBootstrap() {
  const bootstrap = useAppStore(state => state.bootstrap)
  const initialized = useAppStore(state => state.initialized)
  const clients = useAnybuddyClients()
  return { bootstrap, initialized, clients }
}
