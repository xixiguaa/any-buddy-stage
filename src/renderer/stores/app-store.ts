import { create } from 'zustand'
import type {
  AgentEvent,
  AgentRun,
  AppSettings,
  CreateTaskInput,
  CreateWorkspaceInput,
  HumanApproval,
  Message,
  ModelConfig,
  Task,
  TaskDraft,
  TaskSummary,
  TaskWorkspaceContext,
  WorkspaceSummary,
} from '../../shared/types.js'
import { createAnybuddyClients } from '../api/clients.js'
import { useAnybuddyClients } from '../api/context.js'
import { buildVisibleMessages } from './runtime-message-view.js'

export type SidebarTimeRange = 'all' | 'today' | 'last_7_days' | 'last_30_days'

type AppStoreState = {
  initialized: boolean
  selectedTaskId?: string
  tasks: TaskSummary[]
  taskDetail?: Task | null
  taskWorkspaces: TaskWorkspaceContext[]
  messages: Message[]
  drafts: Record<string, TaskDraft>
  workspaces: WorkspaceSummary[]
  settings: AppSettings | null
  agentRuns: AgentRun[]
  taskEvents: AgentEvent[]
  taskApprovals: HumanApproval[]
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
  sendSubagentMessage(runId: string, content: string): Promise<void>
  stopSubagent(runId: string, reason?: string): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  setSidebarSearch(value: string): void
  setSidebarStatusFilter(value: AppStoreState['sidebarStatusFilter']): void
  setSidebarTimeRange(value: SidebarTimeRange): void
  refreshTaskIndex(): Promise<void>
  customModels: ModelConfig[]
  mcpConfigRaw: string
  loadCustomModels(): Promise<void>
  saveCustomModels(models: ModelConfig[]): Promise<void>
  loadMcpConfig(): Promise<void>
  saveMcpConfig(content: string): Promise<void>
  summonedExpert: any | null
  setSummonedExpert(expert: any): void
}

let bootstrapSubscription: (() => void) | null = null
let selectedTaskSubscription: (() => void) | null = null

export const useAppStore = create<AppStoreState>((set, get) => ({
  initialized: false,
  tasks: [],
  taskWorkspaces: [],
  messages: [],
  drafts: {},
  workspaces: [],
  settings: null,
  agentRuns: [],
  taskEvents: [],
  taskApprovals: [],
  sidebarSearch: '',
  sidebarStatusFilter: 'all',
  sidebarTimeRange: 'all',
  customModels: [],
  mcpConfigRaw: '{}',
  summonedExpert: null,
  setSummonedExpert(expert) {
    set({ summonedExpert: expert })
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
    }
    selectedTaskSubscription = clients.agentRun.subscribeTask(taskId, payload => {
      console.log('[AppStore] subscribeTask payload events:', payload.events);
      set(state => {
        const next = buildVisibleMessages(state.messages, payload.events);
        console.log('[AppStore] computed visible messages (init):', next.map(m => ({ id: m.id, role: m.role, content: m.content.slice(0, 30) })));
        return {
          agentRuns: [
            ...state.agentRuns.filter(run => run.taskId !== taskId),
            ...payload.runs,
          ],
          taskEvents: payload.events,
          taskApprovals: payload.approvals,
          messages: next,
        };
      });

      void clients.message.list(taskId).then(messagesLiveResult => {
        if (messagesLiveResult.ok) {
          console.log('[AppStore] message list loaded:', messagesLiveResult.data.map(m => ({ id: m.id, role: m.role, content: m.content.slice(0, 30) })));
        }
        set(state => {
          const nextMessages = messagesLiveResult.ok
            ? buildVisibleMessages(messagesLiveResult.data, payload.events)
            : state.messages

          console.log('[AppStore] computed visible messages (final):', nextMessages.map(m => ({ id: m.id, role: m.role, content: m.content.slice(0, 30) })));
          return {
            agentRuns: [
              ...state.agentRuns.filter(run => run.taskId !== taskId),
              ...payload.runs,
            ],
            taskEvents: payload.events,
            taskApprovals: payload.approvals,
            messages: nextMessages,
          }
        })
      })
      void get().refreshTaskIndex()
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
      }))
      await get().refreshTaskIndex()
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
    set(state => ({ tasks: [awaitSummary(task, state.workspaces), ...state.tasks] }))
    if (initialMessage) {
      await clients.message.create(task.id, { content: initialMessage, role: 'user' })
      await clients.agentRun.start(task.id, { agentName: 'Main Agent', kind: 'main' })
    }
    await get().refreshTaskIndex()
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
    await clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })
    await get().selectTask(taskId)
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
      JSON.stringify(current.selectedConnectorIds) === JSON.stringify(draft.selectedConnectorIds)
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
    await clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })
    await get().reloadTask(taskId)
    await get().refreshTaskIndex()
  },
  async pauseRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.pause(runId)
    await get().refreshTaskIndex()
  },
  async resumeRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.resume(runId)
    await get().refreshTaskIndex()
  },
  async cancelRun(runId: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.cancel(runId)
    await get().refreshTaskIndex()
  },
  async approveTask(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.approve(approvalId, decision, editedArgs)
    if (get().selectedTaskId) {
      await get().reloadTask(get().selectedTaskId!)
    }
    await get().refreshTaskIndex()
  },
  async resumeInterruptedRun(interruptId: string, action: 'resume' | 'cancel' | 'resume_with_edits', editedArgs?: Record<string, unknown>) {
    const decision = action === 'cancel'
      ? 'rejected'
      : action === 'resume_with_edits'
        ? 'edited'
        : 'approved'

    await get().approveTask(interruptId, decision, editedArgs)
  },
  async sendSubagentMessage(runId: string, content: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.sendSubagentMessage(runId, content)
    if (get().selectedTaskId) {
      await get().reloadTask(get().selectedTaskId!)
    }
  },
  async stopSubagent(runId: string, reason?: string) {
    const clients = createAnybuddyClients(window.anybuddy)
    await clients.agentRun.stopSubagent(runId, reason)
    if (get().selectedTaskId) {
      await get().reloadTask(get().selectedTaskId!)
    }
    await get().refreshTaskIndex()
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
  setSidebarStatusFilter(value: string) {
    set({ sidebarStatusFilter: value as AppStoreState['sidebarStatusFilter'] })
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
        set({ customModels: Array.isArray(list) ? list : [] })
      } catch {
        set({ customModels: [] })
      }
    }
  },
  async saveCustomModels(models) {
    const clients = createAnybuddyClients(window.anybuddy)
    const content = JSON.stringify(models, null, 2)
    const result = await clients.config.writeModels(content)
    if (result.ok) {
      set({ customModels: models })
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
    updatedAt: task.updatedAt,
  }
}

export function useAnybuddyBootstrap() {
  const bootstrap = useAppStore(state => state.bootstrap)
  const initialized = useAppStore(state => state.initialized)
  const clients = useAnybuddyClients()
  return { bootstrap, initialized, clients }
}
