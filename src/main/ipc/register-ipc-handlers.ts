import { ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC_CHANNELS } from '../../shared/ipc.js'
import type { IpcResult, WorkspaceArtifact } from '../../shared/types.js'
import { toIpcError } from './serialize-error.js'
import type { AppService } from '../services/app-service.js'
import { AgentRuntimeService } from '../services/agent-runtime-service.js'
import { logProcessError } from '../runtime/error-logger.js'

const execFileAsync = promisify(execFile)

/** 目标成果文件后缀扩展名集合 */
const TARGET_ARTIFACT_EXTENSIONS = new Set([
  'md', 'markdown', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
  'docx', 'pdf', 'xlsx', 'xls', 'csv', 'txt', 'json', 'pptx', 'html',
])

/** 自动排除的系统及生成文件目录名称集合 */
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.git', '.system-skill-cache', '.vite', '.agents',
  '.tmp-tests', '.vscode', '.idea', 'dist', 'out', 'build', '.gemini',
])

/** 递归扫描指定目录下的成果文件列表 */
async function scanDirectoryForArtifacts(
  dirPath: string,
  workspaceId?: string,
  workspaceName?: string,
  basePath: string = dirPath,
  depth: number = 0,
): Promise<WorkspaceArtifact[]> {
  if (depth > 6) return []
  const artifacts: WorkspaceArtifact[] = []
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR_NAMES.has(entry.name)) continue
        const subArtifacts = await scanDirectoryForArtifacts(fullPath, workspaceId, workspaceName, basePath, depth + 1)
        artifacts.push(...subArtifacts)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().replace(/^\./, '')
        if (TARGET_ARTIFACT_EXTENSIONS.has(ext)) {
          const relPath = path.relative(basePath, fullPath).replace(/\\/g, '/')
          const stat = await fs.stat(fullPath)
          artifacts.push({
            id: Buffer.from(relPath).toString('hex'),
            name: entry.name,
            relativePath: relPath,
            absolutePath: fullPath,
            extension: ext,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            workspaceId,
            workspaceName,
          })
        }
      }
    }
  } catch {
    // 忽略权限报错或不可读目录
  }
  return artifacts
}

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function fail(error: unknown): IpcResult<never> {
  logProcessError({ scope: 'ipc-handler' }, error)
  return { ok: false, error: toIpcError(error) }
}

async function listLocalSkills() {
  const skillRoots = [path.join(os.homedir(), '.culclaw', 'skills')]
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

  ipcMain.handle(IPC_CHANNELS.workspacesScanArtifacts, async (_event, taskId: string) => {
    try {
      const taskWorkspaces = appService.listTaskWorkspaces(taskId)
      const allArtifacts: WorkspaceArtifact[] = []
      const scannedPaths = new Set<string>()

      if (taskWorkspaces.length > 0) {
        for (const tw of taskWorkspaces) {
          if (tw.workspace?.path && !scannedPaths.has(tw.workspace.path)) {
            scannedPaths.add(tw.workspace.path)
            const list = await scanDirectoryForArtifacts(tw.workspace.path, tw.workspace.id, tw.workspace.name)
            allArtifacts.push(...list)
          }
        }
      } else {
        // 若无绑定的工作区，扫描系统默认工作区列表
        const defaultWorkspaces = appService.listWorkspaces()
        for (const ws of defaultWorkspaces) {
          if (ws.path && !scannedPaths.has(ws.path)) {
            scannedPaths.add(ws.path)
            const list = await scanDirectoryForArtifacts(ws.path, ws.id, ws.name)
            allArtifacts.push(...list)
          }
        }
      }

      // 按更新时间倒序排列 (最新的产物置顶)
      allArtifacts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return ok(allArtifacts)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.workspacesReadFile, async (_event, absolutePath: string, encoding: 'utf8' | 'base64' = 'utf8') => {
    try {
      const content = await fs.readFile(absolutePath, { encoding: encoding === 'base64' ? 'base64' : 'utf8' })
      return ok(content)
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

  ipcMain.handle(IPC_CHANNELS.expertTeamsList, async () => {
    try {
      return ok(appService.listExpertTeams())
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

  /* 写入 MCP 配置 JSON 字符串 */
  ipcMain.handle(IPC_CHANNELS.configWriteMcp, async (_event, content: string) => {
    try {
      await appService.writeMcpConfig(content)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  /* 列出本地配置与全局 ~/.culclaw/skills 下的可用技能 */
  ipcMain.handle(IPC_CHANNELS.configListSkills, async () => {
    try {
      return ok(await listLocalSkills())
    } catch (error) {
      return fail(error)
    }
  })

  /* 导入技能压缩包或目录至 ~/.culclaw/skills */
  ipcMain.handle(IPC_CHANNELS.configImportSkill, async (_event, input?: { filePath?: string; autoInstall?: boolean }) => {
    try {
      let targetPath = input?.filePath
      if (!targetPath) {
        const dialogResult = await dialog.showOpenDialog({
          title: '选择技能包文件或目录',
          properties: ['openFile', 'openDirectory'],
          filters: [{ name: '技能压缩包', extensions: ['zip'] }],
        })
        if (dialogResult.canceled || !dialogResult.filePaths[0]) {
          throw new Error('已取消选择文件')
        }
        targetPath = dialogResult.filePaths[0]
      }

      const stat = await fs.stat(targetPath)
      const tempDir = path.join(os.tmpdir(), `culclaw-skill-import-${Date.now()}`)
      const sourceFolder = tempDir

      try {
        if (stat.isFile()) {
          if (!targetPath.toLowerCase().endsWith('.zip')) {
            throw new Error('仅支持导入 .zip 格式文件或解压后的技能目录')
          }
          await fs.mkdir(tempDir, { recursive: true })
          if (process.platform === 'win32') {
            await execFileAsync('powershell', [
              '-NoProfile',
              '-Command',
              `Expand-Archive -LiteralPath "${targetPath}" -DestinationPath "${tempDir}" -Force`,
            ])
          } else {
            await execFileAsync('unzip', ['-o', targetPath, '-d', tempDir])
          }
        } else if (stat.isDirectory()) {
          await fs.mkdir(tempDir, { recursive: true })
          await fs.cp(targetPath, tempDir, { recursive: true })
        } else {
          throw new Error('非法的技能包文件或路径')
        }

        let actualSkillDir = sourceFolder
        let skillMdPath = path.join(actualSkillDir, 'SKILL.md')
        let hasSkillMd = false

        try {
          await fs.access(skillMdPath)
          hasSkillMd = true
        } catch {
          const entries = await fs.readdir(sourceFolder, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const subSkillMd = path.join(sourceFolder, entry.name, 'SKILL.md')
              try {
                await fs.access(subSkillMd)
                actualSkillDir = path.join(sourceFolder, entry.name)
                skillMdPath = subSkillMd
                hasSkillMd = true
                break
              } catch {
                // continue searching
              }
            }
          }
        }

        if (!hasSkillMd) {
          throw new Error('包内未找到 SKILL.md 文件，无法识别为有效技能包')
        }

        const skillMdContent = await fs.readFile(skillMdPath, 'utf-8')
        let skillName = path.basename(actualSkillDir)
        let skillDesc = ''

        const yamlMatch = skillMdContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (yamlMatch) {
          const yamlText = yamlMatch[1]
          const nameMatch = yamlText.match(/^name:\s*(.+)$/m)
          if (nameMatch) {
            skillName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
          }
          const descMatch = yamlText.match(/^description:\s*(.+)$/m)
          if (descMatch) {
            skillDesc = descMatch[1].trim().replace(/^['"]|['"]$/g, '')
          }
        }

        const safeSkillId = skillName.replace(/[^\w-]/g, '-').replace(/-+/g, '-').toLowerCase() || `skill-${Date.now()}`
        const globalSkillsRoot = path.join(os.homedir(), '.culclaw', 'skills')
        const finalDestDir = path.join(globalSkillsRoot, safeSkillId)

        await fs.mkdir(globalSkillsRoot, { recursive: true })
        await fs.rm(finalDestDir, { recursive: true, force: true })
        await fs.cp(actualSkillDir, finalDestDir, { recursive: true })

        return ok({ name: safeSkillId, description: skillDesc })
      } finally {
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch {
          // ignore clean up errors
        }
      }
    } catch (error) {
      return fail(error)
    }
  })
}
