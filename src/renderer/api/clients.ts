import type { CulclawApi } from '../../shared/ipc.js'

class TaskClient {
  constructor(private readonly api: CulclawApi) {}

  list(filter?: Parameters<CulclawApi['task']['list']>[0]) {
    return this.api.task.list(filter)
  }

  get(taskId: string) {
    return this.api.task.get(taskId)
  }

  create(input: Parameters<CulclawApi['task']['create']>[0]) {
    return this.api.task.create(input)
  }

  update(taskId: string, input: Parameters<CulclawApi['task']['update']>[1]) {
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
  constructor(private readonly api: CulclawApi) {}

  get(taskId: string) {
    return this.api.draft.get(taskId)
  }

  save(taskId: string, input: Parameters<CulclawApi['draft']['save']>[1]) {
    return this.api.draft.save(taskId, input)
  }

  clear(taskId: string) {
    return this.api.draft.clear(taskId)
  }
}

class MessageClient {
  constructor(private readonly api: CulclawApi) {}

  list(taskId: string) {
    return this.api.message.list(taskId)
  }

  create(taskId: string, input: Parameters<CulclawApi['message']['create']>[1]) {
    return this.api.message.create(taskId, input)
  }
}

class WorkspaceClient {
  constructor(private readonly api: CulclawApi) {}

  list() {
    return this.api.workspace.list()
  }

  createFromPath(input: Parameters<CulclawApi['workspace']['createFromPath']>[0]) {
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

  listTasks(workspaceId: string, filter?: Parameters<CulclawApi['workspace']['listTasks']>[1]) {
    return this.api.workspace.listTasks(workspaceId, filter)
  }

  setDefault(workspaceId: string) {
    return this.api.workspace.setDefault(workspaceId)
  }

  scanArtifacts(taskId: string) {
    return this.api.workspace.scanArtifacts(taskId)
  }

  readFile(absolutePath: string, encoding?: 'utf8' | 'base64') {
    return this.api.workspace.readFile(absolutePath, encoding)
  }
}

class SettingsClient {
  constructor(private readonly api: CulclawApi) {}

  get() {
    return this.api.settings.get()
  }

  update(input: Parameters<CulclawApi['settings']['update']>[0]) {
    return this.api.settings.update(input)
  }
}

class ExpertClient {
  constructor(private readonly api: CulclawApi) {}

  list() {
    return this.api.expert.list()
  }

  create(input: Parameters<CulclawApi['expert']['create']>[0]) {
    return this.api.expert.create(input)
  }

  delete(expertId: string) {
    return this.api.expert.delete(expertId)
  }
}

class ExpertTeamClient {
  constructor(private readonly api: CulclawApi) {}

  list() {
    return this.api.expertTeam.list()
  }
}

class AgentRunClient {
  constructor(private readonly api: CulclawApi) {}

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

  start(taskId: string, input?: Parameters<CulclawApi['agentRun']['start']>[1]) {
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

  clearByTask(taskId: string) {
    return this.api.agentRun.clearByTask(taskId)
  }

  subscribeActive(listener: Parameters<CulclawApi['agentRun']['subscribeActive']>[0]) {
    return this.api.agentRun.subscribeActive(listener)
  }

  subscribeTask(taskId: string, listener: Parameters<CulclawApi['agentRun']['subscribeTask']>[1]) {
    return this.api.agentRun.subscribeTask(taskId, listener)
  }
}

class ConfigClient {
  constructor(private readonly api: CulclawApi) {}

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

  listSkills() {
    return this.api.config.listSkills()
  }

  importSkill(input?: Parameters<CulclawApi['config']['importSkill']>[0]) {
    return this.api.config.importSkill(input)
  }
}

export type CulclawClients = {
  task: TaskClient
  draft: DraftClient
  message: MessageClient
  workspace: WorkspaceClient
  settings: SettingsClient
  expert: ExpertClient
  expertTeam: ExpertTeamClient
  agentRun: AgentRunClient
  config: ConfigClient
}

export type AnybuddyClients = CulclawClients

export function createCulclawClients(api: CulclawApi): CulclawClients {
  return {
    task: new TaskClient(api),
    draft: new DraftClient(api),
    message: new MessageClient(api),
    workspace: new WorkspaceClient(api),
    settings: new SettingsClient(api),
    expert: new ExpertClient(api),
    expertTeam: new ExpertTeamClient(api),
    agentRun: new AgentRunClient(api),
    config: new ConfigClient(api),
  }
}

/**
 * 兼容性导出的别名，推荐统一使用 createCulclawClients
 */
export const createAnybuddyClients = createCulclawClients
