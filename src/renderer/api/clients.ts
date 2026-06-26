import type { AnybuddyApi } from '../../shared/ipc.js'

class TaskClient {
  constructor(private readonly api: AnybuddyApi) {}

  list(filter?: Parameters<AnybuddyApi['task']['list']>[0]) {
    return this.api.task.list(filter)
  }

  get(taskId: string) {
    return this.api.task.get(taskId)
  }

  create(input: Parameters<AnybuddyApi['task']['create']>[0]) {
    return this.api.task.create(input)
  }

  update(taskId: string, input: Parameters<AnybuddyApi['task']['update']>[1]) {
    return this.api.task.update(taskId, input)
  }

  delete(taskId: string) {
    return this.api.task.delete(taskId)
  }

  attachWorkspace(taskId: string, workspaceId: string, accessMode?: 'read_only' | 'read_write') {
    return this.api.task.attachWorkspace(taskId, workspaceId, accessMode)
  }

  detachWorkspace(taskId: string, workspaceId: string) {
    return this.api.task.detachWorkspace(taskId, workspaceId)
  }

  setPrimaryWorkspace(taskId: string, workspaceId: string) {
    return this.api.task.setPrimaryWorkspace(taskId, workspaceId)
  }

  listWorkspaces(taskId: string) {
    return this.api.task.listWorkspaces(taskId)
  }

  markRead(taskId: string) {
    return this.api.task.markRead(taskId)
  }

  listRunning() {
    return this.api.task.listRunning()
  }
}

class DraftClient {
  constructor(private readonly api: AnybuddyApi) {}

  get(taskId: string) {
    return this.api.draft.get(taskId)
  }

  save(taskId: string, input: Parameters<AnybuddyApi['draft']['save']>[1]) {
    return this.api.draft.save(taskId, input)
  }

  clear(taskId: string) {
    return this.api.draft.clear(taskId)
  }
}

class MessageClient {
  constructor(private readonly api: AnybuddyApi) {}

  list(taskId: string) {
    return this.api.message.list(taskId)
  }

  create(taskId: string, input: Parameters<AnybuddyApi['message']['create']>[1]) {
    return this.api.message.create(taskId, input)
  }
}

class WorkspaceClient {
  constructor(private readonly api: AnybuddyApi) {}

  list() {
    return this.api.workspace.list()
  }

  createFromPath(input: Parameters<AnybuddyApi['workspace']['createFromPath']>[0]) {
    return this.api.workspace.createFromPath(input)
  }

  pickFolder() {
    return this.api.workspace.pickFolder()
  }

  remove(workspaceId: string) {
    return this.api.workspace.remove(workspaceId)
  }

  openFolder(workspaceId: string) {
    return this.api.workspace.openFolder(workspaceId)
  }

  listTasks(workspaceId: string, filter?: Parameters<AnybuddyApi['workspace']['listTasks']>[1]) {
    return this.api.workspace.listTasks(workspaceId, filter)
  }

  setDefault(workspaceId: string) {
    return this.api.workspace.setDefault(workspaceId)
  }
}

class SettingsClient {
  constructor(private readonly api: AnybuddyApi) {}

  get() {
    return this.api.settings.get()
  }

  update(input: Parameters<AnybuddyApi['settings']['update']>[0]) {
    return this.api.settings.update(input)
  }
}

class AgentRunClient {
  constructor(private readonly api: AnybuddyApi) {}

  listActive() {
    return this.api.agentRun.listActive()
  }

  listByTask(taskId: string) {
    return this.api.agentRun.listByTask(taskId)
  }

  listEvents(taskId: string) {
    return this.api.agentRun.listEvents(taskId)
  }

  listApprovals(taskId: string) {
    return this.api.agentRun.listApprovals(taskId)
  }

  get(runId: string) {
    return this.api.agentRun.get(runId)
  }

  start(taskId: string, input?: Parameters<AnybuddyApi['agentRun']['start']>[1]) {
    return this.api.agentRun.start(taskId, input)
  }

  pause(runId: string) {
    return this.api.agentRun.pause(runId)
  }

  resume(runId: string) {
    return this.api.agentRun.resume(runId)
  }

  cancel(runId: string) {
    return this.api.agentRun.cancel(runId)
  }

  approve(approvalId: string, decision: 'approved' | 'rejected' | 'edited', editedArgs?: Record<string, unknown>) {
    return this.api.agentRun.approve(approvalId, decision, editedArgs)
  }

  subscribeActive(listener: Parameters<AnybuddyApi['agentRun']['subscribeActive']>[0]) {
    return this.api.agentRun.subscribeActive(listener)
  }

  subscribeTask(taskId: string, listener: Parameters<AnybuddyApi['agentRun']['subscribeTask']>[1]) {
    return this.api.agentRun.subscribeTask(taskId, listener)
  }
}

class ConfigClient {
  constructor(private readonly api: AnybuddyApi) {}

  readModels() {
    return this.api.config.readModels()
  }

  writeModels(content: string) {
    return this.api.config.writeModels(content)
  }

  readMcp() {
    return this.api.config.readMcp()
  }

  writeMcp(content: string) {
    return this.api.config.writeMcp(content)
  }
}

export type AnybuddyClients = {
  task: TaskClient
  draft: DraftClient
  message: MessageClient
  workspace: WorkspaceClient
  settings: SettingsClient
  agentRun: AgentRunClient
  config: ConfigClient
}

export function createAnybuddyClients(api: AnybuddyApi): AnybuddyClients {
  return {
    task: new TaskClient(api),
    draft: new DraftClient(api),
    message: new MessageClient(api),
    workspace: new WorkspaceClient(api),
    settings: new SettingsClient(api),
    agentRun: new AgentRunClient(api),
    config: new ConfigClient(api),
  }
}
