import { tool } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, LocalShellBackend } from 'deepagents/node';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { AppService } from './app-service.js';
import type { AgentExecutor, ExecuteAgentParams } from './agent-executor.js';
import { OpenAIModelService } from './openai-model-service.js';
import type { ModelMessage, ResolvedModelConfig, ToolDefinition, ToolExecutionResult } from './agent-runtime-types.js';
import { AgentApprovalPendingError, ModelApiModeMismatchError } from './agent-runtime-types.js';
import type { HumanApproval } from '../../shared/types.js';

type DeepAgentExecutorDependencies = {
  modelService: OpenAIModelService
};

type PendingExecuteApproval = {
  runId: string
  originalCommand: string
  execute: (command: string) => Promise<unknown>
  resolve: (value: any) => void
  reject: (error: unknown) => void
};

function shouldUseResponsesApi(model: ResolvedModelConfig) {
  if (model.apiMode === 'chat_completions') {
    return false;
  }

  const isOpenAiUrl = /(^https:\/\/api\.openai\.com(?:\/v1)?$)/i.test(model.baseUrl);
  const isKnownNonOpenAi = /deepseek|anthropic|cohere|gemini|google|vertex|mistral|groq|openrouter|together|ollama|lm-studio|localai|lms/i.test(model.baseUrl);

  if (model.apiMode === 'responses') {
    if (isKnownNonOpenAi) {
      throw new ModelApiModeMismatchError(
        '当前模型/接口地址不支持 Responses API。请在模型配置中将该模型的 API 模式修改为 "Compatible Chat API" 或 "自动" (Auto)。'
      );
    }
    return true;
  }

  return isOpenAiUrl && !isKnownNonOpenAi;
}

function serializeToolResult(result: ToolExecutionResult) {
  return JSON.stringify({
    summary: result.summary,
    data: result.data,
  });
}

function deserializeToolResult(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') {
    return {
      raw,
    };
  }

  try {
    const parsed = JSON.parse(raw) as { summary?: unknown; data?: unknown };
    if (parsed && typeof parsed === 'object') {
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : raw,
        result: parsed.data && typeof parsed.data === 'object' ? parsed.data as Record<string, unknown> : { raw },
      };
    }
  } catch {
    // Fall through to raw string payload below.
  }

  return {
    summary: raw,
    result: {
      raw,
    },
  };
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if ('text' in item && typeof item.text === 'string') {
        return item.text;
      }

      if ('content' in item && typeof item.content === 'string') {
        return item.content;
      }

      return '';
    })
    .join('')
    .trim();

  return text || null;
}

function normalizeRole(role: string): ModelMessage['role'] | null {
  switch (role) {
    case 'assistant':
    case 'ai':
      return 'assistant';
    case 'user':
    case 'human':
      return 'user';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return null;
  }
}

function getDriveLetter(absolutePath: string): string {
  const normalized = path.resolve(absolutePath);
  const parsed = path.parse(normalized);
  if (parsed.root) {
    const drive = parsed.root.replace(/[/\\]+$/, '').charAt(0);
    if (drive) return drive.toLowerCase();
  }
  return '';
}

function isSameDrive(a: string, b: string): boolean {
  const driveA = getDriveLetter(a);
  const driveB = getDriveLetter(b);
  if (!driveA || !driveB) return false;
  return driveA === driveB;
}

const SYSTEM_SKILL_CACHE_DIRNAME = '.system-skill-cache';
const GLOBAL_SKILLS_DIRNAME = 'skills';

function getGlobalSkillsRoot() {
  return path.join(os.homedir(), '.anybuddy', GLOBAL_SKILLS_DIRNAME);
}

// 项目注册并通过 `tools: [...]` 传给 deepagent 的工具白名单。
// 其他工具（包括 ls / read_file / write_file / edit_file / grep / glob / execute / task / write_todos 等）
// 都是 deepagents 内置，归为 'internal'。
const PROJECT_TOOLS = new Set<string>(['web_search'])

function classifyToolScope(toolName: string): 'project' | 'internal' {
  return PROJECT_TOOLS.has(toolName) ? 'project' : 'internal'
}

async function mirrorSkillIntoBackend(backendRootDir: string, sourceSkillDir: string, skillId: string): Promise<string | null> {
  const cacheRoot = path.join(backendRootDir, SYSTEM_SKILL_CACHE_DIRNAME);
  const cacheDir = path.join(cacheRoot, skillId);

  try {
    const sourceStat = await stat(sourceSkillDir);
    if (!sourceStat.isDirectory()) return null;

    let needsCopy = true;
    try {
      const cacheStat = await stat(cacheDir);
      if (cacheStat.isDirectory()) {
        const sourceSkillFile = path.join(sourceSkillDir, 'SKILL.md');
        const cachedSkillFile = path.join(cacheDir, 'SKILL.md');
        const [sourceMeta, cachedMeta] = await Promise.all([
          stat(sourceSkillFile).catch(() => null),
          stat(cachedSkillFile).catch(() => null),
        ]);
        if (sourceMeta && cachedMeta && sourceMeta.mtimeMs <= cachedMeta.mtimeMs) {
          needsCopy = false;
        }
      }
    } catch {
      // cache dir not present
    }

    if (needsCopy) {
      await mkdir(cacheRoot, { recursive: true });
      await cp(sourceSkillDir, cacheDir, { recursive: true });
    }

    return cacheDir;
  } catch (error) {
    console.debug('[DeepAgentSkills] mirror failed', {
      skillId,
      source: sourceSkillDir,
      backendRootDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function extractMessages(result: unknown): ModelMessage[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  if ('messages' in result && Array.isArray(result.messages)) {
    return result.messages.flatMap(message => extractMessage(message));
  }

  return extractMessage(result);
}

function extractMessage(message: unknown): ModelMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const directRole = (message as { role?: unknown }).role;
  const role = typeof directRole === 'string' ? normalizeRole(directRole) : null;
  const content = normalizeMessageContent((message as { content?: unknown }).content);
  if (!role || content === null) {
    return [];
  }

  return [{ role, content }];
}

function readChunkText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const directText = (message as { text?: unknown }).text;
  if (typeof directText === 'string') {
    return directText;
  }

  const content = normalizeMessageContent((message as { content?: unknown }).content);
  return content ?? '';
}

function readToolCallChunks(message: unknown): Array<{ id?: string; name?: string; args?: string }> {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const chunks = (message as { tool_call_chunks?: unknown }).tool_call_chunks;
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks.map(chunk => {
    if (!chunk || typeof chunk !== 'object') {
      return {};
    }
    return {
      id: typeof (chunk as { id?: unknown }).id === 'string' ? (chunk as { id?: string }).id : undefined,
      name: typeof (chunk as { name?: unknown }).name === 'string' ? (chunk as { name?: string }).name : undefined,
      args: typeof (chunk as { args?: unknown }).args === 'string' ? (chunk as { args?: string }).args : undefined,
    };
  });
}

function isToolResultMessage(message: unknown): message is { name?: string; text?: string; content?: unknown; tool_call_id?: string } {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return type === 'tool';
}

function readNamespaceSource(namespace: string[]) {
  const subagentNamespace = namespace.find(segment => segment.startsWith('tools:'));
  return subagentNamespace ?? 'main';
}

function readUpdateNodeNames(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  return Object.keys(data as Record<string, unknown>);
}

function readMessageId(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

function isApprovalPendingError(error: unknown): boolean {
  if (error instanceof AgentApprovalPendingError) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/Tool paused for confirmation/i.test(message) || /AgentApprovalPendingError/i.test(message)) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return cause ? isApprovalPendingError(cause) : false;
}

function normalizeExecuteApprovalCommand(command: string) {
  return command.replace(/\r\n/g, '\n').trim();
}

export class DeepAgentExecutor implements AgentExecutor {
  private readonly approvedExecuteCommandsByRun = new Map<string, Set<string>>();
  private readonly pendingExecuteApprovals = new Map<string, PendingExecuteApproval>();

  constructor(
    private readonly appService: AppService,
    private readonly dependencies: DeepAgentExecutorDependencies,
  ) {}

  async execute({ context, systemPrompt, activeExpert, tools, toolExecutionContext, assistantMetadata }: ExecuteAgentParams): Promise<boolean> {
    const resolvedModel = this.dependencies.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      return false;
    }

      const taskContext = this.appService.getTaskContext(context.task.id);
      const taskWorkspaces = this.appService.listTaskWorkspaces(context.task.id);
      const primaryWorkspace = taskWorkspaces.find(workspace => workspace.role === 'primary')?.workspace;

      const backendRootDir = primaryWorkspace?.path ?? process.cwd();
    const backend = await this.createBackend(context, backendRootDir);

    console.debug('[DeepAgentSkills] createDeepAgent context', {
      taskSkillIds: context.task.skillIds,
      backendRootDir,
    });

    try {
      const model = new ChatOpenAI({
        model: resolvedModel.modelName,
        apiKey: resolvedModel.apiKey,
        temperature: 0.2,
        useResponsesApi: shouldUseResponsesApi(resolvedModel),
        configuration: {
          baseURL: resolvedModel.baseUrl,
        },
      });

      const skillSources = await this.resolveSkillSources(context.run.id, context.task.skillIds, backendRootDir);

      const agent = createDeepAgent({
        model,
        backend,
        subagents: [],
        permissions: this.resolvePermissions(context),
        // Do not enable interruptOn yet. Deepagents requires a checkpointer for
        // human-in-the-loop interrupts, while AnyBuddy currently restores
        // approvals through its own AppService/approval tables.
        tools: tools.map(toolDefinition => this.toDeepAgentTool(toolDefinition, toolExecutionContext)),
        memory: this.resolveMemoryFiles(backendRootDir),
        skills: skillSources,
        systemPrompt: activeExpert
          ? [
              `你当前以专家 ${activeExpert.name} (专家 ID: ${activeExpert.id}) 的身份工作。`,
              `你的定位/擅长领域: ${activeExpert.description}`,
              activeExpert.systemPrompt ? `专家专属系统提示词:\n${activeExpert.systemPrompt}` : '',
              '你正在同一个任务的共享上下文中继续工作。不要把历史上下文视为新的任务，也不要假设需要将任务拆分给其他专家。',
              '请以当前专家视角继续分析、回答或执行。',
              '---',
              systemPrompt,
            ].filter(Boolean).join('\n')
          : systemPrompt,
      });

      const run = await agent.stream({
        messages: (taskContext?.messages ?? []).map(message => ({
          role: message.role === 'tool' ? 'user' : message.role,
          content: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content,
        })),
      }, {
        streamMode: ['messages', 'updates'],
        subgraphs: true,
      });

      const accumulatedMessagesMap = new Map<string, string>();
      const toolCallArgsMap = new Map<string, string>();
      const toolCallNameMap = new Map<string, string>();
      const streamSegmentBySource = new Map<string, number>();
      const failedToolSummaries: string[] = [];
      const updateNodeSeen = new Set<string>();
      let toolIndex = 0;
      let finalAssistantMessage = '';
      const streamingPayloadPatch = {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
        streaming: true,
      };

      for await (const item of run as AsyncIterable<[string[], string, unknown]>) {
        const [namespace, mode, data] = item;
        const source = readNamespaceSource(namespace);

        if (mode === 'messages') {
          const chunks = Array.isArray(data) ? data : [data];
          for (const message of chunks) {
            const toolCallChunks = readToolCallChunks(message);
            if (toolCallChunks.length > 0) {
              for (const chunk of toolCallChunks) {
                const toolCallId = chunk.id ?? `${source}-${toolIndex}`;
                if (chunk.name) {
                  toolCallNameMap.set(toolCallId, chunk.name);
                }
                if (chunk.args) {
                  const nextArgs = `${toolCallArgsMap.get(toolCallId) ?? ''}${chunk.args}`;
                  toolCallArgsMap.set(toolCallId, nextArgs);
                }

                const toolName = toolCallNameMap.get(toolCallId);
                if (toolName) {
                  const rawArgs = toolCallArgsMap.get(toolCallId) ?? '';
                  let parsedArgs: Record<string, unknown> = {};
                  if (rawArgs.trim()) {
                    try {
                      parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
                    } catch {
                      parsedArgs = { rawArgs };
                    }
                  }

                  await this.appService.appendRuntimeEvent(context.run.id, 'tool_called', {
                    toolName,
                    arguments: parsedArgs,
                    runtimeEngine: 'deepagents',
                    namespace: source,
                    toolCallId,
                    runtimeScope: classifyToolScope(toolName),
                  });
                  toolIndex += 1;
                  toolCallNameMap.delete(toolCallId);
                  toolCallArgsMap.delete(toolCallId);
                }
              }
            }

            if (isToolResultMessage(message)) {
              const toolName = typeof message.name === 'string' ? message.name : 'unknown';
              const content = typeof message.text === 'string'
                ? message.text
                : normalizeMessageContent(message.content) ?? '';
              await this.appService.appendRuntimeEvent(context.run.id, 'tool_result', {
                toolName,
                result: { text: content },
                summary: content,
                runtimeEngine: 'deepagents',
                namespace: source,
                runtimeScope: classifyToolScope(toolName),
              });
              if (/^Error:/i.test(content.trim())) {
                failedToolSummaries.push(`${toolName}: ${content.trim()}`);
              }
              streamSegmentBySource.set(source, (streamSegmentBySource.get(source) ?? 0) + 1);
            }

            const tokenText = readChunkText(message);
            if (tokenText && toolCallChunks.length === 0 && !isToolResultMessage(message)) {
              const chunkMessageId = readMessageId(message);
              const streamSegment = streamSegmentBySource.get(source) ?? 0;
              const msgId = chunkMessageId
                ? `chunk-${chunkMessageId}`
                : `stream-${source}-${streamSegment}`;
              const nextText = `${accumulatedMessagesMap.get(msgId) ?? ''}${tokenText}`;
              accumulatedMessagesMap.set(msgId, nextText);
              if (source === 'main' || !finalAssistantMessage) {
                finalAssistantMessage = nextText;
              }
              await this.appService.upsertAgentMessageEvent(context.run.id, `msg-${msgId}`, nextText, {
                ...streamingPayloadPatch,
                namespace: source,
              });
            }
          }
        }

        if (mode === 'updates') {
          const nodeNames = readUpdateNodeNames(data);
          for (const nodeName of nodeNames) {
            const key = `${source}:${nodeName}`;
            if (updateNodeSeen.has(key)) {
              continue;
            }
            updateNodeSeen.add(key);
            await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
              status: 'running',
              currentNode: nodeName,
              runtimeEngine: 'deepagents',
              namespace: source,
            });
          }
        }
      }

      const finalMessage = finalAssistantMessage || Array.from(accumulatedMessagesMap.values()).at(-1);
      if (!finalMessage) {
        return false;
      }

      const completedMessage = failedToolSummaries.length > 0
        ? [
            `工具执行失败原因：\n${failedToolSummaries.map(item => `- ${item}`).join('\n')}`,
            finalMessage,
          ].join('\n\n')
        : finalMessage;

      await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
        status: 'running',
        currentNode: 'stream_completed',
      });

      const finalMetadata = {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
      };
      if (context.task.mode === 'plan') {
        await this.appService.completeRuntimeRunWithPlanApproval(context.run.id, completedMessage, finalMetadata);
      } else {
        await this.appService.completeRuntimeRun(context.run.id, completedMessage, finalMetadata);
      }
      return true;
    } catch (error) {
      if (isApprovalPendingError(error)) {
        return true;
      }
      throw error;
    } finally {
      this.approvedExecuteCommandsByRun.delete(context.run.id);
      this.clearPendingExecuteApprovals(context.run.id);
      if ('close' in backend && typeof backend.close === 'function') {
        await backend.close();
      }
    }
  }

  private toDeepAgentTool(toolDefinition: ToolDefinition, context: ExecuteAgentParams['toolExecutionContext']) {
    const description = toolDefinition.requiresApproval
      ? `${toolDefinition.description} (pauses for confirmation before side effects)`
      : toolDefinition.description;

    return tool(
      async (args: Record<string, unknown>) => {
        const result = await toolDefinition.execute(context, args);
        if (result.data.pendingApproval) {
          throw new AgentApprovalPendingError(toolDefinition.name, result);
        }
        return serializeToolResult(result);
      },
      {
        name: toolDefinition.name,
        description,
        schema: toolDefinition.inputSchema ?? z.object({}).passthrough(),
      },
    );
  }

  private resolveMemoryFiles(rootDir: string) {
    const projectAgentFile = path.resolve(process.cwd(), 'AGENTS.md');
    const virtualPath = this.toBackendVirtualPath(rootDir, projectAgentFile)
    return virtualPath ? [virtualPath] : [];
  }

  private async resolveSkillSources(runId: string, skillIds: string[], rootDir: string) {
    let uniqueSkillIds = Array.from(new Set(skillIds.filter(Boolean)));
    const skillsRoot = getGlobalSkillsRoot();

    // 如果前端未选择任何技能，自动扫描系统全局技能目录 ~/.anybuddy/skills 下所有包含 SKILL.md 的有效技能
    if (uniqueSkillIds.length === 0 && existsSync(skillsRoot)) {
      try {
        const entries = await readdir(skillsRoot, { withFileTypes: true });
        const autoScannedSkillIds: string[] = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
            if (existsSync(skillFile)) {
              autoScannedSkillIds.push(entry.name);
            }
          }
        }
        uniqueSkillIds = autoScannedSkillIds;
        console.debug('[DeepAgentSkills] 自动扫描并装载全局技能列表:', uniqueSkillIds);
      } catch (error) {
        console.debug('[DeepAgentSkills] 自动扫描全局技能目录失败:', error);
      }
    }

    await this.appService.appendRuntimeEvent(runId, 'run_status', {
      status: 'running',
      currentNode: 'loading_skills',
      runtimeEngine: 'deepagents',
      requestedSkillIds: uniqueSkillIds,
    });

    const resolved: Array<{
      skillId: string
      source: string
      cachedPath: string
      virtualPath: string
    }> = [];

    for (const skillId of uniqueSkillIds) {
      let picked: { source: string; cachedPath: string; virtualPath: string } | null = null;
      const skillDir = path.join(skillsRoot, skillId);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (existsSync(skillFile)) {
        const cachedPath = await mirrorSkillIntoBackend(rootDir, skillDir, skillId);
        if (cachedPath) {
          const virtualPath = this.toBackendVirtualPath(rootDir, cachedPath);
          if (virtualPath) {
            picked = { source: skillDir, cachedPath, virtualPath };
          }
        }
      }

      if (picked) {
        console.debug('[DeepAgentSkills] resolve hit', picked);
        await this.appService.appendRuntimeEvent(runId, 'run_status', {
          status: 'running',
          currentNode: 'skill_loaded',
          runtimeEngine: 'deepagents',
          skillId,
          source: picked.source,
          cachedPath: picked.cachedPath,
          virtualPath: picked.virtualPath,
          skillsRoot,
        });
        resolved.push({ ...picked, skillId });
      } else {
        console.debug('[DeepAgentSkills] resolve miss', {
          skillId,
          rootDir,
          tried: [skillsRoot],
        });
        await this.appService.appendRuntimeEvent(runId, 'run_status', {
          status: 'running',
          currentNode: 'skill_missing',
          runtimeEngine: 'deepagents',
          skillId,
          tried: [skillsRoot],
        });
      }
    }

    const virtualPaths = resolved.map(item => item.virtualPath);
    console.debug('[DeepAgentSkills] resolve summary', {
      requested: skillIds,
      unique: uniqueSkillIds,
      resolved: virtualPaths,
    });
    await this.appService.appendRuntimeEvent(runId, 'run_status', {
      status: 'running',
      currentNode: 'skills_ready',
      runtimeEngine: 'deepagents',
      requestedCount: uniqueSkillIds.length,
      resolvedCount: virtualPaths.length,
      resolved: virtualPaths,
    });
    return virtualPaths;
  }

  private toBackendVirtualPath(rootDir: string, absolutePath: string) {
    const normalizedRoot = path.resolve(rootDir)
    const normalizedTarget = path.resolve(absolutePath)

    if (!isSameDrive(normalizedRoot, normalizedTarget)) {
      return null
    }

    const relativePath = path.relative(normalizedRoot, normalizedTarget)
    if (!relativePath || relativePath === '') {
      return '/'
    }

    const normalizedRelative = relativePath.replace(/\\/g, '/')
    if (normalizedRelative.startsWith('..')) {
      return null
    }

    return `/${normalizedRelative}`
  }

  private async createBackend(context: ExecuteAgentParams['context'], rootDir: string) {
    const backend = await LocalShellBackend.create({
      rootDir,
      virtualMode: true,
    });
    const originalExecute = backend.execute.bind(backend);
    console.debug('[DeepAgentBackend] create', {
      runId: context.run.id,
      taskId: context.task.id,
      permissionMode: context.task.permissionMode,
      executeRequiresApproval: context.task.permissionMode === 'read_write',
    });

    if (context.task.mode !== 'craft') {
      backend.write = async (filePath: string) => ({
        error: `${context.task.mode.toUpperCase()} mode must produce a plan and wait for user approval before writing files. Blocked write: ${filePath}`,
        filesUpdate: null,
      });
      backend.edit = async (filePath: string) => ({
        error: `${context.task.mode.toUpperCase()} mode must produce a plan and wait for user approval before editing files. Blocked edit: ${filePath}`,
        filesUpdate: null,
      });
    }

    if (context.task.mode === 'craft' && context.task.permissionMode === 'read_write') {
      backend.execute = async (command: string) => {
        const approvedCommands = this.approvedExecuteCommandsByRun.get(context.run.id);
        const normalizedCommand = normalizeExecuteApprovalCommand(command);
        if (approvedCommands?.has(normalizedCommand)) {
          return originalExecute(command);
        }

        const approval = await this.appService.requestRuntimeApproval(
          context.run.id,
          `即将执行本地命令，请确认是否允许：${command}`,
          {
            toolName: 'execute',
            command,
            permissionMode: context.task.permissionMode,
          },
        );
        return await new Promise<Awaited<ReturnType<typeof originalExecute>>>((resolve, reject) => {
          this.pendingExecuteApprovals.set(approval.id, {
            runId: context.run.id,
            originalCommand: command,
            execute: async (approvedCommand: string) => originalExecute(approvedCommand),
            resolve,
            reject,
          });
        });
      };
    }

    return backend;
  }

  approveExecuteCommand(runId: string, command: string) {
    const normalizedCommand = normalizeExecuteApprovalCommand(command);
    if (!normalizedCommand) {
      return;
    }
    const approvedCommands = this.approvedExecuteCommandsByRun.get(runId) ?? new Set<string>();
    approvedCommands.add(normalizedCommand);
    this.approvedExecuteCommandsByRun.set(runId, approvedCommands);
  }

  resolvePendingExecuteApproval(approval: HumanApproval) {
    const pending = this.pendingExecuteApprovals.get(approval.id);
    if (!pending) {
      return false;
    }

    this.pendingExecuteApprovals.delete(approval.id);
    if (approval.decision === 'rejected') {
      pending.reject(new Error('用户拒绝执行本地命令。'));
      return true;
    }

    const args = approval.editedArgs ?? approval.originalArgs ?? {};
    const command = typeof args.command === 'string' && args.command.trim()
      ? args.command
      : pending.originalCommand;

    this.approveExecuteCommand(pending.runId, command);
    void pending.execute(command).then(pending.resolve, pending.reject);
    return true;
  }

  private clearPendingExecuteApprovals(runId: string) {
    for (const [approvalId, pending] of this.pendingExecuteApprovals) {
      if (pending.runId === runId) {
        this.pendingExecuteApprovals.delete(approvalId);
      }
    }
  }

  private resolvePermissions(_context: ExecuteAgentParams['context']) {
    // LocalShellBackend is required for DeepAgents execute support. DeepAgents
    // path permissions are intentionally disabled because they are incompatible
    // with shell-capable backends; AnyBuddy enforces read_write execute safety
    // through the approval gate in createBackend().
    return undefined;
  }
}
