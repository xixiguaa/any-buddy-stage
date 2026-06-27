import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { promisify } from 'node:util'
import type { AppService } from './app-service.js'
import type {
  AgentToolCall,
  AllowedShellCommand,
  ToolDefinition,
  ToolExecutionContext,
} from './agent-runtime-types.js'

const execFileAsync = promisify(execFile)

const allowedShellCommands: AllowedShellCommand[] = [
  {
    command: 'git status',
    executable: 'git',
    args: ['status', '--short', '--branch'],
  },
  {
    command: 'npm run lint',
    executable: 'npm.cmd',
    args: ['run', 'lint'],
  },
]

function normalizeSearchQuery(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed || fallback
}

function trimText(text: string, maxLength = 4000) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}\n...<truncated>`
}

type DuckDuckGoTopic = {
  Text?: string
  FirstURL?: string
  Topics?: DuckDuckGoTopic[]
}

type DuckDuckGoResponse = {
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

function splitLines(value: string) {
  return value.length === 0 ? [] : value.split('\n')
}

function applySimplePatch(originalContent: string, patch: string) {
  const originalLines = splitLines(originalContent)
  const patchLines = patch.replace(/\r\n/g, '\n').split('\n')
  const result: string[] = []
  let cursor = 0

  for (const line of patchLines) {
    if (!line || line === '@@') {
      continue
    }

    const prefix = line[0]
    const value = line.slice(1)

    if (prefix === ' ') {
      if (originalLines[cursor] !== value) {
        throw new Error(`Patch context mismatch at line ${cursor + 1}`)
      }
      result.push(value)
      cursor += 1
      continue
    }

    if (prefix === '-') {
      if (originalLines[cursor] !== value) {
        throw new Error(`Patch delete mismatch at line ${cursor + 1}`)
      }
      cursor += 1
      continue
    }

    if (prefix === '+') {
      result.push(value)
      continue
    }

    throw new Error(`Unsupported patch line: ${line}`)
  }

  if (cursor < originalLines.length) {
    result.push(...originalLines.slice(cursor))
  }

  return result.join('\n')
}

function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeMaxResults(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5
  }

  return Math.min(Math.max(Math.floor(value), 1), 10)
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] | undefined): Array<{ title: string; url: string; snippet: string }> {
  if (!topics?.length) {
    return []
  }

  const results: Array<{ title: string; url: string; snippet: string }> = []
  for (const topic of topics) {
    if (Array.isArray(topic.Topics)) {
      results.push(...flattenDuckDuckGoTopics(topic.Topics))
      continue
    }

    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      })
    }
  }

  return results
}

function matchesDomainFilter(url: string, domains: string[]) {
  if (domains.length === 0) {
    return true
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export class ToolRegistryService {
  private readonly tools = new Map<ToolDefinition['name'], ToolDefinition>()

  constructor(private readonly appService: AppService) {
    this.registerBuiltins()
  }

  getTool(name: AgentToolCall['name']) {
    return this.tools.get(name) ?? null
  }

  listTools() {
    return [...this.tools.values()]
  }

  async executeApprovedAction(context: ToolExecutionContext, args: Record<string, unknown>) {
    const toolName = typeof args.toolName === 'string' ? args.toolName : ''
    if (!toolName) {
      return {
        summary: '审批已通过，但没有需要恢复执行的工具动作。',
        data: {
          toolName: 'approved_action',
          resumed: false,
          reason: 'missing_tool_name',
        },
      }
    }

    switch (toolName) {
      case 'write_workspace_file':
        return this.writeWorkspaceFileDirect(context, args)
      case 'edit_workspace_file':
        return this.editWorkspaceFileDirect(context, args)
      case 'run_shell_command':
        return this.runAllowedShellCommand(context, args)
      default:
        throw new Error(`Unsupported approved tool action: ${toolName}`)
    }
  }

  private registerBuiltins() {
    this.register({
      name: 'get_task_context',
      description: '读取当前任务上下文。',
      requiresApproval: false,
      execute: async context => {
        const taskContext = this.appService.getTaskContext(context.task.id)
        if (!taskContext) {
          throw new Error(`Task context not found: ${context.task.id}`)
        }

        return {
          summary: `已读取任务上下文，包含 ${taskContext.messages.length} 条消息和 ${taskContext.workspaces.length} 个工作区。`,
          data: {
            taskId: taskContext.task.id,
            taskTitle: taskContext.task.title,
            mode: taskContext.task.mode,
            permissionMode: taskContext.task.permissionMode,
            workspaceIds: taskContext.workspaces.map(item => item.workspaceId),
            messageCount: taskContext.messages.length,
            approvalCount: taskContext.approvals.length,
          },
        }
      },
    })

    this.register({
      name: 'get_run_state',
      description: '读取当前运行状态。',
      requiresApproval: false,
      execute: async context => {
        const run = this.appService.getAgentRun(context.run.id)
        if (!run) {
          throw new Error(`Run not found: ${context.run.id}`)
        }

        const approvals = this.appService
          .listApprovals(context.task.id)
          .filter(approval => approval.runId === run.id && approval.decision === 'pending')

        const recentEvents = this.appService
          .listAgentEvents(context.task.id)
          .filter(event => event.runId === run.id)
          .slice(-5)
          .map(event => ({
            type: event.type,
            createdAt: event.createdAt,
          }))

        return {
          summary: `当前运行状态为 ${run.status}，最近事件 ${recentEvents.length} 条，待处理审批 ${approvals.length} 条。`,
          data: {
            runId: run.id,
            status: run.status,
            currentNode: run.currentNode ?? null,
            pendingApprovalCount: approvals.length,
            recentEvents,
          },
        }
      },
    })

    this.register({
      name: 'list_workspace_files',
      description: '列出任务主工作区下的目录内容。',
      requiresApproval: false,
      execute: async (context, args) => {
        const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '.')
        const entries = await fs.readdir(targetPath.absolutePath, { withFileTypes: true })

        return {
          summary: `已列出 ${entries.length} 个目录项。`,
          data: {
            workspaceId: targetPath.workspaceId,
            path: targetPath.relativePath,
            entries: entries.map(entry => ({
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
            })),
          },
        }
      },
    })

    this.register({
      name: 'read_workspace_file',
      description: '读取任务主工作区内的文件内容。',
      requiresApproval: false,
      execute: async (context, args) => {
        const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '')
        if (!targetPath.relativePath) {
          throw new Error('read_workspace_file requires a file path')
        }

        const content = await fs.readFile(targetPath.absolutePath, 'utf8')
        return {
          summary: `已读取文件 ${targetPath.relativePath}。`,
          data: {
            workspaceId: targetPath.workspaceId,
            path: targetPath.relativePath,
            content: trimText(content),
          },
        }
      },
    })

    this.register({
      name: 'search_workspace',
      description: '在任务主工作区内搜索文本。',
      requiresApproval: false,
      execute: async (context, args) => {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) {
          throw new Error('search_workspace requires a non-empty query')
        }

        const primaryWorkspace = this.getPrimaryWorkspace(context)
        const output = await execFileAsync('rg', ['-n', '--no-heading', query, primaryWorkspace.workspace.path], {
          cwd: primaryWorkspace.workspace.path,
          timeout: 15000,
          windowsHide: true,
        })

        return {
          summary: '已完成工作区文本搜索。',
          data: {
            workspaceId: primaryWorkspace.workspaceId,
            query,
            output: trimText(output.stdout.trim()),
          },
        }
      },
    })

    this.register({
      name: 'write_workspace_file',
      description: '写入任务主工作区内的文件。',
      requiresApproval: true,
      execute: async (context, args) => {
        const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '')
        const content = typeof args.content === 'string' ? args.content : ''
        if (!targetPath.relativePath) {
          throw new Error('write_workspace_file requires a file path')
        }

        return context.requestApproval({
          reason: `请求写入文件：${targetPath.relativePath}`,
          originalArgs: {
            toolName: 'write_workspace_file',
            workspaceId: targetPath.workspaceId,
            path: targetPath.relativePath,
            content,
          },
          summary: '文件写入需要用户审批，运行已暂停。',
        })
      },
    })

    this.register({
      name: 'edit_workspace_file',
      description: '按补丁修改任务主工作区内的文件。',
      requiresApproval: true,
      execute: async (context, args) => {
        const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '')
        if (!targetPath.relativePath) {
          throw new Error('edit_workspace_file requires a file path')
        }

        return context.requestApproval({
          reason: `请求修改文件：${targetPath.relativePath}`,
          originalArgs: {
            toolName: 'edit_workspace_file',
            workspaceId: targetPath.workspaceId,
            path: targetPath.relativePath,
            patch: args.patch ?? null,
          },
          summary: '文件修改需要用户审批，运行已暂停。',
        })
      },
    })

    this.register({
      name: 'request_approval',
      description: '显式发起用户审批。',
      requiresApproval: false,
      execute: async (context, args) => {
        const reason = typeof args.reason === 'string' ? args.reason : '请求用户审批敏感操作'
        const originalArgs = typeof args.originalArgs === 'object' && args.originalArgs
          ? args.originalArgs as Record<string, unknown>
          : {}

        return context.requestApproval({
          reason,
          originalArgs,
          summary: '已创建审批请求，运行已暂停。',
        })
      },
    })

    this.register({
      name: 'consult_subagent',
      description: '召唤子专家协作。',
      requiresApproval: false,
      execute: async (context, args) => {
        const expertId = typeof args.expertId === 'string' ? args.expertId : context.task.expertId ?? 'default-expert'
        const reason = typeof args.reason === 'string' ? args.reason : '补充子任务分析'
        return context.spawnSubagent({
          agentName: `${expertId}-subagent`,
          kind: 'subagent',
          parentRunId: context.run.id,
          expertId,
          reason,
        })
      },
    })
    this.register({
      name: 'web_search',
      description: '?????????',
      requiresApproval: false,
      execute: async (context, args) => {
        if (!context.settings.networkEnabled || !context.settings.webSearchEnabled) {
          return {
            summary: '????????????????',
            data: {
              enabled: false,
              reason: 'network_disabled',
            },
          }
        }

        const query = normalizeSearchQuery(args.query, context.task.title)
        const domains = normalizeDomains(args.domains)
        const maxResults = normalizeMaxResults(args.maxResults)
        const response = await fetch(`https://api.duckduckgo.com/?${new URLSearchParams({
          q: query,
          format: 'json',
          no_html: '1',
          skip_disambig: '1',
        }).toString()}`)
        if (!response.ok) {
          throw new Error(`web_search request failed: ${response.status}`)
        }

        const payload = await response.json() as DuckDuckGoResponse
        const rawResults = [
          ...(payload.AbstractText && payload.AbstractURL
            ? [{
                title: payload.AbstractText,
                url: payload.AbstractURL,
                snippet: payload.AbstractText,
              }]
            : []),
          ...flattenDuckDuckGoTopics(payload.RelatedTopics),
        ]
        const dedupedResults = rawResults.filter((item, index, list) =>
          list.findIndex(candidate => candidate.url === item.url) === index,
        )
        const filteredResults = dedupedResults.filter(item => matchesDomainFilter(item.url, domains))
        const results = filteredResults.slice(0, maxResults).map(item => ({
          ...item,
          sourceTime: null,
        }))

        return {
          summary: `??? ${results.length} ????????`,
          data: {
            enabled: true,
            provider: 'duckduckgo_instant_answer',
            query,
            domains,
            maxResults,
            results,
            audit: {
              rawCount: rawResults.length,
              filteredCount: dedupedResults.length - filteredResults.length,
            },
          },
        }
      },
    })

    this.register({
      name: 'run_shell_command',
      description: '执行白名单命令。',
      requiresApproval: true,
      execute: async (context, args) => {
        const command = typeof args.command === 'string' ? args.command.trim() : ''
        const matched = allowedShellCommands.find(item => item.command === command)
        if (!matched) {
          return {
            summary: '命令不在白名单内，已拒绝执行。',
            data: {
              allowed: false,
              command,
              allowedCommands: allowedShellCommands.map(item => item.command),
            },
          }
        }

        if (matched.command !== 'git status') {
          return context.requestApproval({
            reason: `请求执行命令：${matched.command}`,
            originalArgs: {
              toolName: 'run_shell_command',
              command: matched.command,
            },
            summary: '命令执行需要用户审批，运行已暂停。',
          })
        }

        const primaryWorkspace = this.getPrimaryWorkspace(context)
        const cwd = primaryWorkspace.workspace.path
        const output = await execFileAsync(matched.executable, matched.args, {
          cwd,
          timeout: 15000,
          windowsHide: true,
        })

        return {
          summary: `命令执行完成：${matched.command}`,
          data: {
            allowed: true,
            command: matched.command,
            cwd,
            stdout: output.stdout.trim(),
            stderr: output.stderr.trim(),
          },
        }
      },
    })
  }

  private getPrimaryWorkspace(context: ToolExecutionContext) {
    const workspace = this.appService
      .listTaskWorkspaces(context.task.id)
      .find(item => item.role === 'primary')

    if (!workspace) {
      throw new Error(`Primary workspace not found for task: ${context.task.id}`)
    }

    return workspace
  }

  private resolveWorkspacePath(context: ToolExecutionContext, inputPath: string) {
    const primaryWorkspace = this.getPrimaryWorkspace(context)
    const safeInput = inputPath.trim().replace(/^[/\\]+/, '')
    const absolutePath = normalize(join(primaryWorkspace.workspace.path, safeInput))
    const relativePath = relative(primaryWorkspace.workspace.path, absolutePath)

    if (relativePath.startsWith('..') || normalize(relativePath).startsWith('..')) {
      throw new Error('Path escapes the primary workspace')
    }

    return {
      workspaceId: primaryWorkspace.workspaceId,
      absolutePath,
      relativePath,
    }
  }

  private register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  private async writeWorkspaceFileDirect(context: ToolExecutionContext, args: Record<string, unknown>) {
    const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '')
    const content = typeof args.content === 'string' ? args.content : ''
    if (!targetPath.relativePath) {
      throw new Error('write_workspace_file requires a file path')
    }

    await fs.mkdir(dirname(targetPath.absolutePath), { recursive: true })
    await fs.writeFile(targetPath.absolutePath, content, 'utf8')

    return {
      summary: `已写入文件 ${targetPath.relativePath}`,
      data: {
        toolName: 'write_workspace_file',
        workspaceId: targetPath.workspaceId,
        path: targetPath.relativePath,
        bytes: Buffer.byteLength(content, 'utf8'),
      },
    }
  }

  private async editWorkspaceFileDirect(context: ToolExecutionContext, args: Record<string, unknown>) {
    const targetPath = this.resolveWorkspacePath(context, typeof args.path === 'string' ? args.path : '')
    const content = typeof args.content === 'string' ? args.content : null
    const patch = typeof args.patch === 'string' ? args.patch : null
    if (!targetPath.relativePath) {
      throw new Error('edit_workspace_file requires a file path')
    }

    await fs.mkdir(dirname(targetPath.absolutePath), { recursive: true })
    const originalContent = await fs.readFile(targetPath.absolutePath, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ''
      }
      throw error
    })
    const nextContent = content ?? (patch ? applySimplePatch(originalContent, patch) : null)
    if (nextContent === null) {
      throw new Error('edit_workspace_file 审批恢复需要 content 或 patch')
    }

    await fs.writeFile(targetPath.absolutePath, nextContent, 'utf8')

    return {
      summary: `已覆盖更新文件 ${targetPath.relativePath}`,
      data: {
        toolName: 'edit_workspace_file',
        workspaceId: targetPath.workspaceId,
        path: targetPath.relativePath,
        bytes: Buffer.byteLength(nextContent, 'utf8'),
      },
    }
  }

  private async runAllowedShellCommand(context: ToolExecutionContext, args: Record<string, unknown>) {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    const matched = allowedShellCommands.find(item => item.command === command)
    if (!matched) {
      throw new Error(`Command is not in allowlist: ${command}`)
    }

    const primaryWorkspace = this.getPrimaryWorkspace(context)
    const cwd = primaryWorkspace.workspace.path
    const output = await execFileAsync(matched.executable, matched.args, {
      cwd,
      timeout: 15000,
      windowsHide: true,
    })

    return {
      summary: `命令执行完成：${matched.command}`,
      data: {
        toolName: 'run_shell_command',
        allowed: true,
        command: matched.command,
        cwd,
        stdout: trimText(output.stdout.trim()),
        stderr: trimText(output.stderr.trim()),
      },
    }
  }
}
