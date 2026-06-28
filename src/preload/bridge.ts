import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc.js'
import type { AnybuddyApi } from '../shared/ipc.js'
import type {
  AgentEvent,
  AgentRun,
  AppSettings,
  CreateAgentRunInput,
  CreateMessageInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  HumanApproval,
  IpcResult,
  Message,
  Task,
  TaskDraft,
  TaskFilter,
  TaskSummary,
  TaskWorkspaceContext,
  UpdateTaskInput,
  Workspace,
  WorkspaceSummary,
} from '../shared/types.js'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
}

const anybuddyApi: AnybuddyApi = {
  task: {
    list: filter => invoke<TaskSummary[]>(IPC_CHANNELS.tasksList, filter),
    get: taskId => invoke<Task | null>(IPC_CHANNELS.tasksGet, taskId),
    create: input => invoke<Task>(IPC_CHANNELS.tasksCreate, input satisfies CreateTaskInput),
    update: (taskId, input) => invoke<Task>(IPC_CHANNELS.tasksUpdate, taskId, input satisfies UpdateTaskInput),
    delete: taskId => invoke<void>(IPC_CHANNELS.tasksDelete, taskId),
    attachWorkspace: (taskId, workspaceId, accessMode) => invoke(IPC_CHANNELS.tasksAttachWorkspace, taskId, workspaceId, accessMode),
    detachWorkspace: (taskId, workspaceId) => invoke<void>(IPC_CHANNELS.tasksDetachWorkspace, taskId, workspaceId),
    setPrimaryWorkspace: (taskId, workspaceId) => invoke<Task>(IPC_CHANNELS.tasksSetPrimaryWorkspace, taskId, workspaceId),
    listWorkspaces: taskId => invoke<TaskWorkspaceContext[]>(IPC_CHANNELS.tasksListWorkspaces, taskId),
    markRead: taskId => invoke<Task>(IPC_CHANNELS.tasksMarkRead, taskId),
    listRunning: () => invoke<TaskSummary[]>(IPC_CHANNELS.tasksListRunning),
  },
  draft: {
    get: taskId => invoke<TaskDraft | null>(IPC_CHANNELS.draftsGet, taskId),
    save: (taskId, input) => invoke<TaskDraft>(IPC_CHANNELS.draftsSave, taskId, input),
    clear: taskId => invoke<void>(IPC_CHANNELS.draftsClear, taskId),
  },
  message: {
    list: taskId => invoke<Message[]>(IPC_CHANNELS.messagesList, taskId),
    create: (taskId, input) => invoke<Message>(IPC_CHANNELS.messagesCreate, taskId, input satisfies CreateMessageInput),
    delete: messageId => invoke<void>(IPC_CHANNELS.messagesDelete, messageId),
  },
  workspace: {
    list: () => invoke<WorkspaceSummary[]>(IPC_CHANNELS.workspacesList),
    createFromPath: input => invoke<Workspace>(IPC_CHANNELS.workspacesCreateFromPath, input satisfies CreateWorkspaceInput),
    pickFolder: () => invoke<string | null>(IPC_CHANNELS.workspacesPickFolder),
    remove: workspaceId => invoke<void>(IPC_CHANNELS.workspacesRemove, workspaceId),
    openFolder: workspaceId => invoke<void>(IPC_CHANNELS.workspacesOpenFolder, workspaceId),
    listTasks: (workspaceId, filter) => invoke<TaskSummary[]>(IPC_CHANNELS.workspacesListTasks, workspaceId, filter),
    setDefault: workspaceId => invoke<AppSettings>(IPC_CHANNELS.workspacesSetDefault, workspaceId),
  },
  settings: {
    get: () => invoke<AppSettings>(IPC_CHANNELS.settingsGet),
    update: input => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, input),
  },
  agentRun: {
    listActive: () => invoke<AgentRun[]>(IPC_CHANNELS.agentRunsListActive),
    listByTask: taskId => invoke<AgentRun[]>(IPC_CHANNELS.agentRunsListByTask, taskId),
    listEvents: taskId => invoke<AgentEvent[]>(IPC_CHANNELS.agentRunsListEvents, taskId),
    listApprovals: taskId => invoke<HumanApproval[]>(IPC_CHANNELS.agentRunsListApprovals, taskId),
    get: runId => invoke<AgentRun | null>(IPC_CHANNELS.agentRunsGet, runId),
    start: (taskId, input) => invoke<AgentRun>(IPC_CHANNELS.agentRunsStart, taskId, input),
    pause: runId => invoke<AgentRun>(IPC_CHANNELS.agentRunsPause, runId),
    resume: runId => invoke<AgentRun>(IPC_CHANNELS.agentRunsResume, runId),
    cancel: runId => invoke<AgentRun>(IPC_CHANNELS.agentRunsCancel, runId),
    approve: (approvalId, decision, editedArgs) => invoke<void>(IPC_CHANNELS.agentRunsApprove, approvalId, decision, editedArgs),
    sendSubagentMessage: (runId, content) => invoke<void>(IPC_CHANNELS.agentRunsSendSubagentMessage, runId, content),
    stopSubagent: (runId, reason) => invoke<void>(IPC_CHANNELS.agentRunsStopSubagent, runId, reason),
    subscribeActive: listener => {
      const channel = 'agent-run:active-changed'
      const handler = (_event: Electron.IpcRendererEvent, runs: AgentRun[]) => listener(runs)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    subscribeTask: (taskId, listener) => {
      const channel = `agent-run:task-changed:${taskId}`
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { runs: AgentRun[]; events: AgentEvent[]; approvals: HumanApproval[] },
      ) => listener(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
  config: {
    readModels: () => invoke<string>(IPC_CHANNELS.configReadModels),
    writeModels: content => invoke<void>(IPC_CHANNELS.configWriteModels, content),
    readMcp: () => invoke<string>(IPC_CHANNELS.configReadMcp),
    writeMcp: content => invoke<void>(IPC_CHANNELS.configWriteMcp, content),
  },
}

contextBridge.exposeInMainWorld('anybuddy', anybuddyApi)
