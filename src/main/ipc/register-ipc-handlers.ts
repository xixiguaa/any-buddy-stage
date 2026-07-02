import { ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IPC_CHANNELS } from '../../shared/ipc.js'
import type { IpcResult } from '../../shared/types.js'
import { toIpcError } from './serialize-error.js'
import type { AppService } from '../services/app-service.js'
import { AgentRuntimeService } from '../services/agent-runtime-service.js'
import { logProcessError } from '../runtime/error-logger.js'

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(error: unknown): IpcResult<never> {
  logProcessError({ scope: 'ipc-handler' }, error)
  return { ok: false, error: toIpcError(error) }
}

async function listLocalSkills() {
  const skillRoots = [
    path.resolve(process.cwd(), '.agents', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
  ]
  const names = new Set<string>()

  for (const skillsRoot of skillRoots) {
    try {
      const entries = await fs.readdir(skillsRoot, { withFileTypes: true })
      const rootNames = await Promise.all(entries
        .filter(entry => entry.isDirectory())
        .map(async entry => {
          const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md')
          try {
            await fs.access(skillFile)
            return entry.name
          } catch {
            return null
          }
        }))

      for (const name of rootNames) {
        if (name) {
          names.add(name)
        }
      }
    } catch {
      continue
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

export function registerIpcHandlers(appService: AppService) {
  const agentRuntime = new AgentRuntimeService(appService)

  ipcMain.handle(IPC_CHANNELS.tasksList, async (_event, filter) => {
    try {
      return ok(appService.listTasks(filter))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksGet, async (_event, taskId: string) => {
    try {
      return ok(appService.getTask(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksCreate, async (_event, input) => {
    try {
      return ok(await appService.createTask(input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksUpdate, async (_event, taskId: string, input) => {
    try {
      return ok(await appService.updateTask(taskId, input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksDelete, async (_event, taskId: string) => {
    try {
      await appService.deleteTask(taskId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksAttachWorkspace, async (_event, taskId: string, workspaceId: string, accessMode) => {
    try {
      return ok(await appService.attachWorkspace(taskId, workspaceId, accessMode))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksDetachWorkspace, async (_event, taskId: string, workspaceId: string) => {
    try {
      await appService.detachWorkspace(taskId, workspaceId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksSetPrimaryWorkspace, async (_event, taskId: string, workspaceId: string) => {
    try {
      return ok(await appService.setPrimaryWorkspace(taskId, workspaceId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksListWorkspaces, async (_event, taskId: string) => {
    try {
      return ok(appService.listTaskWorkspaces(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksMarkRead, async (_event, taskId: string) => {
    try {
      return ok(await appService.markRead(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasksListRunning, async () => {
    try {
      return ok(appService.listRunningTasks())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.draftsGet, async (_event, taskId: string) => {
    try {
      return ok(appService.getDraft(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.draftsSave, async (_event, taskId: string, input) => {
    try {
      return ok(await appService.saveDraft(taskId, input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.draftsClear, async (_event, taskId: string) => {
    try {
      await appService.clearDraft(taskId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.messagesList, async (_event, taskId: string) => {
    try {
      return ok(appService.listMessages(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.messagesCreate, async (_event, taskId: string, input) => {
    try {
      return ok(await appService.createMessage(taskId, input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.messagesDelete, async (_event, messageId: string) => {
    try {
      await appService.deleteMessage(messageId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesList, async () => {
    try {
      return ok(appService.listWorkspaces())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesCreateFromPath, async (_event, input) => {
    try {
      return ok(await appService.createWorkspace(input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesPickFolder, async () => {
    try {
      const pathValue = await appService.pickWorkspaceFolder()
      return ok(pathValue)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesRemove, async (_event, workspaceId: string) => {
    try {
      await appService.removeWorkspace(workspaceId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesOpenFolder, async (_event, workspaceId: string) => {
    try {
      await appService.openWorkspaceFolder(workspaceId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesListTasks, async (_event, workspaceId: string, filter) => {
    try {
      return ok(await appService.listWorkspaceTasks(workspaceId, filter))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesSetDefault, async (_event, workspaceId: string) => {
    try {
      return ok(await appService.setDefaultWorkspace(workspaceId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.settingsGet, async () => {
    try {
      return ok(appService.getSettings())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (_event, input) => {
    try {
      return ok(await appService.updateSettings(input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.expertsList, async () => {
    try {
      return ok(appService.listExperts())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.expertsCreate, async (_event, input) => {
    try {
      return ok(await appService.createExpert(input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.expertsDelete, async (_event, expertId: string) => {
    try {
      await appService.deleteExpert(expertId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsListActive, async () => {
    try {
      return ok(appService.listActiveAgentRuns())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsListByTask, async (_event, taskId: string) => {
    try {
      return ok(appService.listAgentRunsByTask(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsListEvents, async (_event, taskId: string) => {
    try {
      return ok(appService.listAgentEvents(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsListApprovals, async (_event, taskId: string) => {
    try {
      return ok(appService.listApprovals(taskId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsGet, async (_event, runId: string) => {
    try {
      return ok(appService.getAgentRun(runId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsStart, async (_event, taskId: string, input) => {
    try {
      return ok(await agentRuntime.start(taskId, input))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsPause, async (_event, runId: string) => {
    try {
      return ok(await agentRuntime.pause(runId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsResume, async (_event, runId: string) => {
    try {
      return ok(await agentRuntime.resume(runId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsCancel, async (_event, runId: string) => {
    try {
      return ok(await agentRuntime.cancel(runId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsApprove, async (_event, approvalId: string, decision, editedArgs) => {
    try {
      await agentRuntime.approve(approvalId, decision, editedArgs)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.agentRunsClearByTask, async (_event, taskId: string) => {
    try {
      await appService.clearTaskRuns(taskId)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configReadModels, async () => {
    try {
      return ok(await appService.readModelsConfig())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configWriteModels, async (_event, content: string) => {
    try {
      await appService.writeModelsConfig(content)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configReadMcp, async () => {
    try {
      return ok(await appService.readMcpConfig())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configWriteMcp, async (_event, content: string) => {
    try {
      await appService.writeMcpConfig(content)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.configListSkills, async () => {
    try {
      return ok(await listLocalSkills())
    } catch (error) {
      return fail(error)
    }
  })
}
