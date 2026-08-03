import { createMiddleware, tool } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent, LocalShellBackend, registerHarnessProfile } from 'deepagents/node';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { AppService } from './app-service.js';
import type { AgentExecutor, ExecuteAgentParams } from './agent-executor.js';
import { OpenAIModelService } from './openai-model-service.js';
import { isAllowedArtifactFile, SshDockerSandboxBackend } from './ssh-docker-sandbox-backend.js';
import type { ModelMessage, ResolvedModelConfig, ToolDefinition, ToolExecutionResult } from './agent-runtime-types.js';
import { AgentApprovalPendingError, ModelApiModeMismatchError } from './agent-runtime-types.js';

type SshSandboxBackend = SshDockerSandboxBackend;

function isSshSandboxBackend(candidate: unknown): candidate is SshSandboxBackend {
  return candidate instanceof SshDockerSandboxBackend;
}

// CulClaw 只允许显式专家团成员作为子 Agent，禁用 DeepAgents 默认通用子 Agent。
registerHarnessProfile('openai', {
  generalPurposeSubagent: { enabled: false },
});

function isTaskTool(candidate: unknown): candidate is { name: string } {
  return Boolean(candidate && typeof candidate === 'object' && 'name' in candidate && candidate.name === 'task');
}

/** 创建可被运行时识别的取消异常。 */
function createAbortError() {
  const error = new Error('Agent run cancelled.');
  error.name = 'AbortError';
  return error;
}

/** 在处理流式事件前确认当前 Run 未被用户停止。 */
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

// 单专家模式从模型可见工具中移除 task，确保不会触发子 Agent 调度。
const hideTaskToolMiddleware = createMiddleware({
  name: 'CulClawHideTaskTool',
  wrapModelCall(request, handler) {
    return handler({
      ...request,
      tools: request.tools?.filter(candidate => !isTaskTool(candidate)),
    });
  },
});

/**
 * DeepAgent 执行器依赖项
 */
type DeepAgentExecutorDependencies = {
  /** 模型解析与配置服务 */
  modelService: OpenAIModelService
};

/**
 * 判断当前模型配置是否应当使用 OpenAI Responses API
 * 
 * @param model 已解析的模型配置
 * @returns 是否启用 Responses API
 * @throws {ModelApiModeMismatchError} 当明确配置为 responses 模式但 BaseURL 为非 OpenAI 兼容服务时抛出错误
 */
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

/**
 * 序列化工具执行结果，转换为字符串供模型消费
 * 
 * @param result 工具执行结果对象
 * @returns 序列化后的 JSON 字符串
 */
function serializeToolResult(result: ToolExecutionResult) {
  return JSON.stringify({
    summary: result.summary,
    data: result.data,
  });
}

/**
 * 反序列化工具执行结果字符串为结构化对象
 * 
 * @param raw 原始数据或 JSON 字符串
 * @returns 反序列化后的结构化对象
 */
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
    // 解析 JSON 失败时，回退为原始字符串负载处理
  }

  return {
    summary: raw,
    result: {
      raw,
    },
  };
}

/**
 * 规范化消息内容为字符串或 null
 * 
 * @param content 原始消息内容（可能为字符串或多模态数组）
 * @returns 提取合并后的字符串内容，无效内容返回 null
 */
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

/**
 * 移除推理模型（如 DeepSeek-R1、Qwen-Reasoning 等）意外写入正文的 <think> 块，避免思维链进入消息流与持久化记录。
 */
export function stripThinkingContent(content: string): string {
  const withoutThinkBlocks = content
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<think\b[^>]*$/gi, '');

  // 流式分块可能将 <think> 标签切开，暂时隐藏标签前缀，等下一块到达后再统一处理。
  return withoutThinkBlocks.replace(/<(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '').trim();
}

/**
 * 规范化角色标识为标准的 ModelMessage 角色类型
 * 
 * @param role 原始角色字符串
 * @returns 标准角色类型标识或 null
 */
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

/**
 * 获取 Windows 绝对路径中的盘符字母（小写）
 * 
 * @param absolutePath 绝对路径
 * @returns 盘符字母小写（如 'c'、'd'），若无盘符则返回空字符串
 */
function getDriveLetter(absolutePath: string): string {
  const normalized = path.resolve(absolutePath);
  const parsed = path.parse(normalized);
  if (parsed.root) {
    const drive = parsed.root.replace(/[/\\]+$/, '').charAt(0);
    if (drive) return drive.toLowerCase();
  }
  return '';
}

/**
 * 检查两个绝对路径是否位于同一个盘符下
 * 
 * @param a 路径 A
 * @param b 路径 B
 * @returns 是否相同盘符
 */
function isSameDrive(a: string, b: string): boolean {
  const driveA = getDriveLetter(a);
  const driveB = getDriveLetter(b);
  if (!driveA || !driveB) return false;
  return driveA === driveB;
}

import { CONFIG_DIR_NAME } from '../../shared/constants.js';

/**
 * 递归读取物理工作区目录文件，生成远程沙盒初始化所需的相对路径文件字典
 * 
 * @param rootDir 工作区物理根目录
 * @param maxFiles 文件加载上限（防止内存开销过大）
 * @param maxFileSize 单文件读取最大体积限制（默认 2MB）
 */
type WorkspaceFileSnapshot = Record<string, Uint8Array>;

/** 比较文件原始字节，避免文本解码破坏二进制产物。 */
function fileContentEquals(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

async function loadInitialWorkspaceFiles(rootDir: string, maxFiles = 2000, maxFileSize = 2 * 1024 * 1024): Promise<WorkspaceFileSnapshot> {
  const initialFiles: WorkspaceFileSnapshot = {};
  const ignoredDirs = new Set(['node_modules', '.git', 'out', 'dist', '.vite', '.tmp-tests', 'userData', 'brain', CULCLAW_DIRNAME, SYSTEM_SKILL_CACHE_DIRNAME]);

  async function walk(dir: string) {
    if (Object.keys(initialFiles).length >= maxFiles) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (Object.keys(initialFiles).length >= maxFiles) break;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          try {
            const fileStat = await stat(fullPath);
            if (fileStat.size <= maxFileSize) {
              const relative = path.relative(rootDir, fullPath).replace(/\\/g, '/');
              const virtualPath = `/${relative}`;
              const content = await readFile(fullPath);
              initialFiles[virtualPath] = new Uint8Array(content);
            }
          } catch {
            // 忽略读取失败的单文件
          }
        }
      }
    } catch {
      // 忽略读取失败的目录
    }
  }

  await walk(rootDir);
  return initialFiles;
}

/**
 * 将全局 Skill 直接镜像到远程沙盒，避免默认权限模式在物理工作区创建技能缓存。
 *
 * @param backend 远程 Docker 沙盒后端
 * @param sourceSkillDir 全局 Skill 源目录
 * @param skillId Skill 标识
 * @returns 沙盒内 Skill 目录路径；同步失败时返回 null
 */
async function mirrorSkillIntoRemoteSandboxBackend(
  backend: SshSandboxBackend,
  sourceSkillDir: string,
  skillId: string,
): Promise<string | null> {
  const virtualSkillDir = `/${SYSTEM_SKILL_CACHE_DIRNAME}/${skillId}`;
  const filesToUpload: Array<[string, Uint8Array]> = [];

  try {
    async function walk(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relativePath = path.relative(sourceSkillDir, fullPath).replace(/\\/g, '/');
          const content = await readFile(fullPath);
          filesToUpload.push([`${virtualSkillDir}/${relativePath}`, new Uint8Array(content)]);
        }
      }
    }

    await walk(sourceSkillDir);
    if (filesToUpload.length === 0) {
      return null;
    }

    const uploadResults = await backend.uploadFiles(filesToUpload);
    if (uploadResults.some(item => item.error)) {
      return null;
    }
    console.debug('[DeepAgentBackend] 同步全局 Skill 到远程 Docker 沙盒成功:', filesToUpload.length);
    return virtualSkillDir;
  } catch (error) {
    console.debug('[DeepAgentBackend] 同步全局 Skill 到远程 Docker 沙盒失败:', error);
    return null;
  }
}

/**
 * 将远程 Docker 沙盒运行完成后的新增/修改产物文件导出同步到物理工作区
 * 
 * @param backend 远程 Docker 沙盒后端
 * @param rootDir 工作区物理根目录
 * @param initialFiles 初始载入的文件内容字典
 * @param appService 应用服务实例（可选，用于关联任务产物）
 * @param taskId 任务 ID（可选，用于关联任务产物）
 */
async function exportSandboxOutputsToWorkspace(
  backend: SshSandboxBackend,
  rootDir: string,
  initialFiles: WorkspaceFileSnapshot,
  appService?: AppService,
  taskId?: string,
) {
  try {
    const downloaded = await backend.downloadWorkspaceFiles();
    for (const item of downloaded) {
      if (item.error || !item.content) continue;

      const vPath = item.path.startsWith('/') ? item.path : `/${item.path}`;
      // 过滤系统缓存目录
      if (vPath.startsWith('/.system-skill-cache')) continue;
      const relativePath = vPath.slice(1);
      if (!relativePath) continue;

      // 使用后端相同的规则，避免依赖目录和包管理文件被导出。
      if (!isAllowedArtifactFile(relativePath)) continue;

      const content = typeof item.content === 'string'
        ? new TextEncoder().encode(item.content)
        : item.content;

      const initialContent = initialFiles[vPath];
      // 仅当文件属于新创建，或内容相比初始载入被修改时，才同步输出到物理工作区
      if (initialContent === undefined || !fileContentEquals(initialContent, content)) {
        const resolvedRootDir = path.resolve(rootDir);
        const destPath = path.resolve(resolvedRootDir, relativePath);
        const destinationRelativePath = path.relative(resolvedRootDir, destPath);
        // 防止沙盒内的异常路径突破工作区边界。
        if (destinationRelativePath.startsWith('..') || path.isAbsolute(destinationRelativePath)) {
          console.warn('[DeepAgentBackend] 忽略越界的远程沙盒输出路径:', vPath);
          continue;
        }
        await mkdir(path.dirname(destPath), { recursive: true });
        await writeFile(destPath, content);
        if (appService && taskId) {
          await appService.recordTaskArtifact(taskId, destPath);
        }
        console.debug('[DeepAgentBackend] 沙盒完成，导出写入新文件到工作区并关联任务:', destPath);
      }
    }
  } catch (error) {
    console.warn('[DeepAgentBackend] 导出远程 Docker 沙盒输出物到工作区失败:', error);
  }
}

/** 应用全局配置/数据目录名称 */
const CULCLAW_DIRNAME = CONFIG_DIR_NAME;
/** 系统技能缓存目录名称 */
const SYSTEM_SKILL_CACHE_DIRNAME = '.system-skill-cache';
/** 全局技能存储子目录名称 */
const GLOBAL_SKILLS_DIRNAME = 'skills';

/**
 * 获取系统用户全局技能存储根目录 (~/.culclaw/skills)
 */
function getGlobalSkillsRoot() {
  return path.join(os.homedir(), CULCLAW_DIRNAME, GLOBAL_SKILLS_DIRNAME);
}

/**
 * 项目自定义注册并通过 `tools: [...]` 显式传给 deepagents 的工具白名单。
 * 其他工具（包括 ls / read_file / write_file / edit_file / grep / glob / execute / task / write_todos 等）
 * 都是 deepagents 内置，归类为 'internal'。
 */
const PROJECT_TOOLS = new Set<string>(['web_search']);

/**
 * 分类工具作用域
 * 
 * @param toolName 工具名称
 * @returns 'project' 表示项目自定义工具，'internal' 表示 DeepAgents 内置工具
 */
function classifyToolScope(toolName: string): 'project' | 'internal' {
  return PROJECT_TOOLS.has(toolName) ? 'project' : 'internal';
}

/**
 * 将全局技能镜像同步到后端工作区根目录下的 `.system-skill-cache` 目录中
 * 
 * @param backendRootDir 后端运行根目录
 * @param sourceSkillDir 技能源目录绝对路径
 * @param skillId 技能 ID
 * @returns 缓存目录物理路径，同步失败时返回 null
 */
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
      // 缓存目录不存在，需要执行复制
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

/**
 * 从未知返回结果中提取规范化的模型消息列表
 * 
 * @param result 原始执行结果
 * @returns 解析出来的模型消息数组
 */
function extractMessages(result: unknown): ModelMessage[] {
  if (!result || typeof result !== 'object') {
    return [];
  }

  if ('messages' in result && Array.isArray(result.messages)) {
    return result.messages.flatMap(message => extractMessage(message));
  }

  return extractMessage(result);
}

/**
 * 从单个消息数据结构中解析规范化的模型消息
 * 
 * @param message 原始消息节点
 * @returns 提取的 ModelMessage 数组
 */
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

/**
 * 从流式分块消息中读取文本增量
 * 
 * @param message 消息分块对象
 * @returns 文本内容字符串
 */
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

/**
 * 从流式消息中提取工具调用参数，兼容分块与完整工具调用格式。
 * 
 * @param message 消息分块对象
 * @returns 工具调用分块数组
 */
function readToolCallChunks(message: unknown): Array<{ id?: string; name?: string; args?: string; index?: number }> {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const chunks = (message as { tool_call_chunks?: unknown }).tool_call_chunks;
  if (Array.isArray(chunks) && chunks.length > 0) {
    return chunks.map(chunk => {
      if (!chunk || typeof chunk !== 'object') {
        return {};
      }
      return {
        id: typeof (chunk as { id?: unknown }).id === 'string' ? (chunk as { id?: string }).id : undefined,
        name: typeof (chunk as { name?: unknown }).name === 'string' ? (chunk as { name?: string }).name : undefined,
        args: typeof (chunk as { args?: unknown }).args === 'string' ? (chunk as { args?: string }).args : undefined,
        // 同一条模型消息中的并行工具调用依赖 index 区分，不能只按 source 关联。
        index: typeof (chunk as { index?: unknown }).index === 'number' ? (chunk as { index?: number }).index : undefined,
      };
    });
  }

  const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.map((toolCall, index) => {
    if (!toolCall || typeof toolCall !== 'object') {
      return {};
    }

    const call = toolCall as {
      id?: unknown;
      name?: unknown;
      args?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const rawArgs = call.args ?? call.function?.arguments;
    let args: string | undefined;
    if (typeof rawArgs === 'string') {
      args = rawArgs;
    } else if (rawArgs !== undefined) {
      try {
        args = JSON.stringify(rawArgs);
      } catch {
        args = undefined;
      }
    }

    return {
      id: typeof call.id === 'string' ? call.id : undefined,
      name: typeof call.name === 'string'
        ? call.name
        : typeof call.function?.name === 'string'
          ? call.function.name
          : undefined,
      args,
      index,
    };
  });
}

/**
 * 判断消息是否为工具执行结果类型（tool result）
 *
 * @param message 消息对象
 * @returns 是否为工具结果消息
 */
function isToolResultMessage(message: unknown): message is { name?: string; text?: string; content?: unknown; tool_call_id?: string } {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return type === 'tool';
}

/**
 * 从命名空间路径数组中提取来源标识（子 Agent 类型或主流程 'main'）
 * 
 * @param namespace 命名空间数组
 * @param toolCallSubagentMap 工具调用 ID 到子 Agent 类型的映射字典
 * @returns 来源标识名称
 */
function readNamespaceSource(
  namespace: string[],
  toolCallSubagentMap?: Map<string, { subagentType: string; description?: string }>
): string {
  if (!namespace || !Array.isArray(namespace) || namespace.length === 0) {
    return 'main';
  }

  // 官方 namespace 使用 tools:<toolCallId> 标识子 Agent，名称需由 task 调用参数映射。
  for (const seg of namespace) {
    const str = String(seg).trim();
    if (!str.startsWith('tools:')) continue;
    const toolCallId = str.slice('tools:'.length).trim();
    const mapped = toolCallSubagentMap?.get(toolCallId);
    if (mapped) {
      return mapped.subagentType;
    }
    return `tool-call:${toolCallId}`;
  }
  return 'main';
}

/**
 * 从更新事件数据中提取发生的节点名称列表
 * 
 * @param data 节点更新事件载荷
 * @returns 节点名称列表
 */
function readUpdateNodeNames(data: unknown): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  return Object.keys(data as Record<string, unknown>);
}

/**
 * 提取消息对象的 ID 标识
 * 
 * @param message 消息对象
 * @returns 消息 ID 或 undefined
 */
function readMessageId(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * 判断抛出的错误是否属于等待人工确认挂起（AgentApprovalPendingError）
 * 
 * @param error 捕获到的错误实例或数据
 * @returns 是否属于等待审批错误
 */
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

/**
 * 基于 DeepAgents 架构的 Agent 执行器实现类
 *
 * 负责组装 ChatOpenAI 模型、远程 Docker 沙盒或 LocalShellBackend、项目工具和技能配置，
 * 协调 Agent 流式推理过程，处理消息流、工具调用事件和实时状态推送。
 */
export class DeepAgentExecutor implements AgentExecutor {
  constructor(
    private readonly appService: AppService,
    private readonly dependencies: DeepAgentExecutorDependencies,
  ) { }

  /**
   * 执行 Agent 任务
   * 
   * @param params 执行所需的完整上下文、系统提示词、专家配置、工具列表等参数
   * @returns 执行成功或因挂起审批暂停返回 true；缺少必要配置返回 false
   */
  async execute({ context, signal, systemPrompt, activeExpert, activeExpertTeam, tools, toolExecutionContext, assistantMetadata }: ExecuteAgentParams): Promise<boolean> {
    throwIfAborted(signal);
    // 1. 解析当前任务指定的模型配置
    const resolvedModel = this.dependencies.modelService.resolveModelConfig(
      this.appService.listModelConfigs(),
      context.task.modelId,
    );

    if (!resolvedModel?.apiKey) {
      return false;
    }

    // 2. 获取任务上下文与关联的工作区物理路径
    const taskContext = this.appService.getTaskContext(context.task.id);
    const taskWorkspaces = this.appService.listTaskWorkspaces(context.task.id);
    const primaryWorkspace = taskWorkspaces.find(workspace => workspace.role === 'primary')?.workspace;

    const backendRootDir = primaryWorkspace?.path ?? process.cwd();
    const { backend, isSandbox, initialFiles, disposeBackend, releaseSandbox, restoreBackend } = await this.createBackend(
      context,
      backendRootDir,
      primaryWorkspace?.id,
    );

    const fileExecutionConstraintPrompt = isSandbox
      ? [
        '---',
        '【文件生成规范（必须严格遵守）】：',
        '1. 当前运行位于远程 Docker 沙盒。创建、修改、生成或导出文件时，必须通过工具在沙盒内完成，禁止将执行过程视为对物理工作区的直接写入。',
        '2. 沙盒运行成功结束后，应用会自动将新增或修改的普通文件同步到工作区；不得在未成功调用工具的情况下虚构文件产物。',
        '3. 工具成功后可告知用户沙盒内的输出路径，应用完成同步后该路径会出现在工作区。',
      ].join('\n')
      : [
        '---',
        '【文件生成与物理执行规范（必须严格遵守）】：',
        '1. 当前运行具有完全访问权限。创建、修改、生成或导出文件时，必须真实调用工具在物理工作区中完成。',
        '2. 严禁在未真正发起工具调用生成物理文件的情况下，口头虚构或声称“文件已成功生成”。',
        '3. 只有在工具成功写入并确认物理文件存在后，方可在最终回复中告知用户文件路径。',
      ].join('\n');

    console.debug('[DeepAgentSkills] createDeepAgent context', {
      taskSkillIds: context.task.skillIds,
      backendRootDir,
    });

    try {
      throwIfAborted(signal);
      // 3. 实例化 LangChain ChatOpenAI 模型
      const model = new ChatOpenAI({
        model: resolvedModel.modelName,
        apiKey: resolvedModel.apiKey,
        temperature: 0.2,
        useResponsesApi: shouldUseResponsesApi(resolvedModel),
        configuration: {
          baseURL: resolvedModel.baseUrl,
        },
      });

      // 4. 解析并镜像同步需要的 Skill 目录
      const skillSources = await this.resolveSkillSources(
        context.run.id,
        context.task.skillIds,
        backendRootDir,
        isSandbox && isSshSandboxBackend(backend) ? backend : undefined,
      );

      // 5. 解析专家团子 Agent 成员配置
      const subagents = (activeExpertTeam?.members ?? []).map(member => ({
        name: member.name,
        description: `${member.role}。${member.specialty}`,
        systemPrompt: [
          `你是 ${member.name} (${member.role})。`,
          `擅长领域: ${member.specialty}`,
          member.systemPrompt ? `角色专属提示词:\n${member.systemPrompt}` : '',
          '请用 Markdown 输出你的独立分析、建议和结论，即使任务较小也不要返回空内容。',
        ].filter(Boolean).join('\n'),
      }));
      // 仅在专家团存在实际成员时才启用 task 子 Agent 工具，避免空列表暴露无可用类型的 task。
      const hasSubagents = subagents.length > 0;
      const delegationConstraintPrompt = hasSubagents
        ? ''
        : '当前没有可用子 Agent。禁止调用 task 工具；涉及新建或修改文件时，请直接使用当前后端提供的文件工具。';

      let finalSystemPrompt = `${systemPrompt}\n\n${fileExecutionConstraintPrompt}\n\n${delegationConstraintPrompt}`;
      if (hasSubagents && activeExpertTeam) {
        finalSystemPrompt = [
          `你当前以专家团队 ${activeExpertTeam.name} Leader 的身份调度工作。`,
          `团队定位: ${activeExpertTeam.description}`,
          `团队成员:`,
          activeExpertTeam.members.map(m => `- ${m.name} (${m.role}): ${m.specialty}`).join('\n'),
          activeExpertTeam.systemPrompt ? `【团队专属指令与流程规范】:\n${activeExpertTeam.systemPrompt}` : '',
          '专家团智能调度规则（必须严格遵守）：',
          '1. 优先遵循【团队专属指令】以及用户对话中明确指定的专家协作顺序或并发方式。',
          '2. 若未显式指定，请根据成员职责与任务依赖自动选择最佳调度模式：',
          '   - 【串行/流水线模式】：若成员职责存在上下游依赖（如：先设计后编码、先调研后总结），必须按顺序依次调用 task 工具，并将上一专家的成果作为输入传递给下一专家。',
          '   - 【并行/并发模式】：若成员职责相互独立（如：多视角并行评审、独立模块同时开发），可以在单次响应中同时发起多个 task 工具调用。',
          '3. 委派成员时，必须调用 task 工具并将 subagent_type 精确设置为对应的成员名称。',
          '4. 收集完所有相关成员的 Markdown 输出后，综合各专家意见进行评估归纳，得出最终结论。',
          '---',
          systemPrompt,
          fileExecutionConstraintPrompt,
        ].filter(Boolean).join('\n');
      } else if (activeExpert) {
        finalSystemPrompt = [
          `你当前以专家 ${activeExpert.name} (专家 ID: ${activeExpert.id}) 的身份工作。`,
          `你的定位/擅长领域: ${activeExpert.description}`,
          activeExpert.systemPrompt ? `专家专属系统提示词:\n${activeExpert.systemPrompt}` : '',
          '你正在同一个任务的共享上下文中继续工作。不要把历史上下文视为新的任务，也不要假设需要将任务拆分给其他专家。',
          '请以当前专家视角继续分析、回答或执行。',
          '---',
          systemPrompt,
          fileExecutionConstraintPrompt,
          delegationConstraintPrompt,
        ].filter(Boolean).join('\n');
      }

      // 6. 创建 DeepAgent 实例
      const agent = createDeepAgent({
        model,
        backend,
        // 空子 Agent 列表不传入 DeepAgents，确保不会注册无可调用类型的 task 工具。
        ...(hasSubagents ? { subagents } : {}),
        middleware: hasSubagents ? [] : [hideTaskToolMiddleware],
        permissions: this.resolvePermissions(context),
        // 不使用 DeepAgents 内置 interruptOn，命令在所选后端中连续执行。
        tools: tools.map(toolDefinition => this.toDeepAgentTool(toolDefinition, toolExecutionContext)),
        memory: this.resolveMemoryFiles(backendRootDir),
        skills: skillSources,
        systemPrompt: finalSystemPrompt,
      });

      // 6. 启动 Agent 消息流处理
      const run = await agent.stream({
        messages: (taskContext?.messages ?? []).map(message => ({
          role: message.role === 'tool' ? 'user' : message.role,
          content: message.role === 'tool' ? `Tool result:\n${message.content}` : message.content,
        })),
      }, {
        streamMode: ['messages', 'updates'],
        subgraphs: true,
        signal,
      });

      // 临时映射与状态存储变量
      const rawAccumulatedMessagesMap = new Map<string, string>();
      const accumulatedMessagesMap = new Map<string, string>();
      // 保留每个流式段的来源，以便运行结束后把已展示内容转为历史消息。
      const streamedMessageMetadataById = new Map<string, {
        namespace: string;
        subagentName?: string;
      }>();
      const toolCallArgsMap = new Map<string, string>();
      const toolCallNameMap = new Map<string, string>();
      // 防止同一工具调用以分块和完整消息两种格式重复上报。
      const reportedToolCallIds = new Set<string>();
      // 工具参数会跨多个 chunk 到达；key 必须包含 index，避免并行 task 调用互相覆盖。
      const activeToolCallIdByStream = new Map<string, string>();
      const streamSegmentBySource = new Map<string, number>();
      const failedToolSummaries: string[] = [];
      const updateNodeSeen = new Set<string>();
      const startedSubagents = new Map<string, string>();
      const toolCallSubagentMap = new Map<string, { subagentType: string; description?: string }>();
      let toolIndex = 0;
      let mainAssistantMessage = '';
      let latestAssistantMessage = '';
      let mainAssistantMessageId: string | undefined;
      let latestAssistantMessageId: string | undefined;

      const resolveSubagentDisplayName = (subagentKey: string) => {
        const toolCallId = subagentKey.startsWith('tool-call:')
          ? subagentKey.slice('tool-call:'.length)
          : undefined;
        const mappedType = toolCallId ? toolCallSubagentMap.get(toolCallId)?.subagentType : undefined;
        const resolvedKey = mappedType ?? subagentKey;
        const member = activeExpertTeam?.members.find(
          m => m.name.toLowerCase() === resolvedKey.toLowerCase() ||
            m.id === resolvedKey ||
            m.role.toLowerCase() === resolvedKey.toLowerCase()
        );
        if (member) {
          return `${member.name} (${member.role})`;
        }
        return activeExpertTeam ? '专家团成员' : resolvedKey;
      };

      const streamingPayloadPatch = {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
        streaming: true,
      };

      await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
        status: 'running',
        currentNode: isSandbox ? 'sandbox_ready' : 'local_backend_ready',
        executionEnvironment: isSandbox ? 'sandbox' : 'local',
        runtimeEngine: 'deepagents',
      });

      // 7. 循环处理流式迭代器返回的事件分块
      for await (const item of run as AsyncIterable<[string[], string, unknown]>) {
        throwIfAborted(signal);
        const [namespace, mode, data] = item;
        // 单专家任务不启用子 Agent 展示；专家团按官方 tools:<toolCallId> namespace 路由。
        const source = hasSubagents ? readNamespaceSource(namespace, toolCallSubagentMap) : 'main';

        // 如果是子 Agent 运行且尚未触发启动事件，向渲染进程发送 subagent_started 事件
        const isResolvedSubagent = source !== 'main' && !source.startsWith('tool-call:');
        if (isResolvedSubagent && !startedSubagents.has(source)) {
          const displayName = resolveSubagentDisplayName(source);
          const taskInfo = Array.from(toolCallSubagentMap.values()).find(
            item => item.subagentType === source || item.subagentType.toLowerCase() === source.toLowerCase()
          );
          const taskDesc = taskInfo?.description ? `：${taskInfo.description}` : '';
          startedSubagents.set(source, displayName);
          await this.appService.appendRuntimeEvent(context.run.id, 'subagent_started', {
            expertId: source,
            subagentName: displayName,
            reason: `专家团子 Agent [${displayName}] 已启动协作子任务${taskDesc}`,
            namespace: source,
            executionEnvironment: isSandbox ? 'sandbox' : 'local',
            runtimeEngine: 'deepagents',
          });
        }

        const currentSubagentName = startedSubagents.get(source) || (isResolvedSubagent ? resolveSubagentDisplayName(source) : undefined);

        // 处理 'messages' 模式事件（模型文本输出、工具调用分块、工具执行结果）
        if (mode === 'messages') {
          const chunks = Array.isArray(data) ? data : [data];
          for (const message of chunks) {
            // 7.1 检查并积累工具调用分块 (tool_call_chunks)
            const toolCallChunks = readToolCallChunks(message);
            if (toolCallChunks.length > 0) {
              for (const chunk of toolCallChunks) {
                const toolCallStreamKey = `${source}:${chunk.index ?? 'default'}`;
                const toolCallId = chunk.id ?? activeToolCallIdByStream.get(toolCallStreamKey) ?? `${source}-${chunk.index ?? toolIndex}`;
                activeToolCallIdByStream.set(toolCallStreamKey, toolCallId);
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
                  const isTaskTool = toolName === 'task' || toolName.endsWith('task');
                  let argsComplete = false;
                  if (rawArgs.trim()) {
                    try {
                      parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
                      argsComplete = true;
                    } catch {
                      // 工具参数可能跨多个 chunk，完整 JSON 到达前继续累积。
                      argsComplete = false;
                    }
                  } else if (chunk.args !== undefined && (chunk.args.trim() === '{}' || (isTaskTool && !chunk.args))) {
                    parsedArgs = {};
                    argsComplete = true;
                  }
                  if (!argsComplete) continue;

                  // 若调用的工具为 task，记录 toolCallId 到 subagent_type 和任务描述的关联映射
                  if (isTaskTool) {
                    const subagentType = typeof parsedArgs.subagent_type === 'string'
                      ? parsedArgs.subagent_type
                      : typeof parsedArgs.name === 'string'
                        ? parsedArgs.name
                        : undefined;
                    const description = typeof parsedArgs.description === 'string'
                      ? parsedArgs.description
                      : typeof parsedArgs.prompt === 'string'
                        ? parsedArgs.prompt
                        : undefined;
                    if (subagentType) {
                      toolCallSubagentMap.set(toolCallId, { subagentType, description });
                      if (!startedSubagents.has(subagentType)) {
                        const displayName = resolveSubagentDisplayName(subagentType);
                        startedSubagents.set(subagentType, displayName);
                        await this.appService.appendRuntimeEvent(context.run.id, 'subagent_started', {
                          expertId: subagentType,
                          subagentName: displayName,
                          reason: description ? `已接收协作任务：${description}` : '已接收协作任务，正在启动。',
                          namespace: source,
                          executionEnvironment: isSandbox ? 'sandbox' : 'local',
                          runtimeEngine: 'deepagents',
                        });
                      }
                    }
                  }

                  if (reportedToolCallIds.has(toolCallId)) {
                    toolCallNameMap.delete(toolCallId);
                    toolCallArgsMap.delete(toolCallId);
                    activeToolCallIdByStream.delete(toolCallStreamKey);
                    continue;
                  }

                  // 触发工具调用运行时事件
                  await this.appService.appendRuntimeEvent(context.run.id, 'tool_called', {
                    toolName,
                    arguments: parsedArgs,
                    runtimeEngine: 'deepagents',
                    namespace: source,
                    subagentName: currentSubagentName,
                    toolCallId,
                    runtimeScope: classifyToolScope(toolName),
                    executionEnvironment: isSandbox ? 'sandbox' : 'local',
                  });
                  reportedToolCallIds.add(toolCallId);
                  toolIndex += 1;
                  toolCallNameMap.delete(toolCallId);
                  toolCallArgsMap.delete(toolCallId);
                  activeToolCallIdByStream.delete(toolCallStreamKey);
                }
              }
            }

            // 7.2 检查并记录工具执行结果消息
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
                subagentName: currentSubagentName,
                runtimeScope: classifyToolScope(toolName),
                toolCallId: message.tool_call_id,
                executionEnvironment: isSandbox ? 'sandbox' : 'local',
              });
              if (/^Error:/i.test(content.trim())) {
                failedToolSummaries.push(`${toolName}: ${content.trim()}`);
              }
              streamSegmentBySource.set(source, (streamSegmentBySource.get(source) ?? 0) + 1);
            }

            // 7.3 处理助手流式文本 Token 输出
            const tokenText = readChunkText(message);
            if (tokenText && !isToolResultMessage(message)) {
              const chunkMessageId = readMessageId(message);
              const streamSegment = streamSegmentBySource.get(source) ?? 0;
              const msgId = chunkMessageId
                ? `chunk-${chunkMessageId}`
                : `stream-${source}-${streamSegment}`;
              const nextRawText = `${rawAccumulatedMessagesMap.get(msgId) ?? ''}${tokenText}`;
              rawAccumulatedMessagesMap.set(msgId, nextRawText);
              const nextText = stripThinkingContent(nextRawText);
              accumulatedMessagesMap.set(msgId, nextText);
              streamedMessageMetadataById.set(msgId, {
                namespace: source,
                subagentName: currentSubagentName,
              });
              if (nextText.trim().length > 0) {
                latestAssistantMessage = nextText;
                latestAssistantMessageId = msgId;
                if (source === 'main') {
                  mainAssistantMessage = nextText;
                  mainAssistantMessageId = msgId;
                }
              }
              // 实时更新 Agent 消息事件到 AppService
              await this.appService.upsertAgentMessageEvent(context.run.id, `msg-${msgId}`, nextText, {
                ...streamingPayloadPatch,
                namespace: source,
                subagentName: currentSubagentName,
              });
            }
          }
        }

        // 处理 'updates' 模式事件（LangGraph 节点切换与状态通知）
        if (mode === 'updates') {
          const nodeNames = readUpdateNodeNames(data);
          for (const nodeName of nodeNames) {
            if (isResolvedSubagent) {
              // 针对子 Agent，持续向前端发送 subagent_progress 进度事件
              let stepDescription = `正在执行步骤 [${nodeName}]`;
              if (nodeName === 'model_request') {
                stepDescription = '正在思考分析与规划...';
              } else if (nodeName === 'tools') {
                stepDescription = '正在调配与执行工具...';
              }
              await this.appService.appendRuntimeEvent(context.run.id, 'subagent_progress', {
                expertId: source,
                subagentName: currentSubagentName,
                stepNode: nodeName,
                stepDescription,
                namespace: source,
                executionEnvironment: isSandbox ? 'sandbox' : 'local',
                runtimeEngine: 'deepagents',
              });
            } else if (source === 'main') {
              const key = `${source}:${nodeName}`;
              if (!updateNodeSeen.has(key)) {
                updateNodeSeen.add(key);
                await this.appService.appendRuntimeEvent(context.run.id, 'run_status', {
                  status: 'running',
                  currentNode: nodeName,
                  runtimeEngine: 'deepagents',
                  namespace: source,
                  subagentName: currentSubagentName,
                  executionEnvironment: isSandbox ? 'sandbox' : 'local',
                });
              }
            }
          }
        }
      }

      // 7.4 针对所有运行过的子 Agent 发送 subagent_completed 结束事件
      for (const [subagentKey, displayName] of startedSubagents) {
        await this.appService.appendRuntimeEvent(context.run.id, 'subagent_completed', {
          expertId: subagentKey,
          subagentName: displayName,
          status: 'completed',
          summary: '协作流程已执行完毕',
          namespace: subagentKey,
          executionEnvironment: isSandbox ? 'sandbox' : 'local',
          runtimeEngine: 'deepagents',
        });
      }

      // 8. 汇总最终输出消息与处理错误汇总
      const finalMessage = mainAssistantMessage || latestAssistantMessage;
      const finalStreamMessageId = mainAssistantMessage
        ? mainAssistantMessageId
        : latestAssistantMessageId;
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

      // 除最终段外，已在前端展示的内容在结束时一次性持久化，避免完成 patch 清理临时态后丢失。
      const intermediateMessages = Array.from(accumulatedMessagesMap.entries())
        .filter(([messageId, messageContent]) => messageId !== finalStreamMessageId && messageContent.trim().length > 0)
        .map(([messageId, messageContent]) => {
          const streamMetadata = streamedMessageMetadataById.get(messageId);
          return {
            content: messageContent,
            metadata: {
              ...assistantMetadata,
              runtimeEngine: 'deepagents',
              source: 'runtime_stream',
              namespace: streamMetadata?.namespace ?? 'main',
              subagentName: streamMetadata?.subagentName,
              streamEventId: `msg-${messageId}`,
              streaming: false,
              final: false,
            },
          };
        });

      const finalMetadata = {
        ...assistantMetadata,
        runtimeEngine: 'deepagents',
        final: true,
        ...(finalStreamMessageId ? { streamEventId: `msg-${finalStreamMessageId}` } : {}),
      };

      // 9. 结合任务模式完成当前 Run 记录
      if (context.task.mode === 'plan') {
        await this.appService.completeRuntimeRunWithPlanApproval(
          context.run.id,
          completedMessage,
          finalMetadata,
          intermediateMessages,
        );
      } else {
        await this.appService.completeRuntimeRun(
          context.run.id,
          completedMessage,
          finalMetadata,
          intermediateMessages,
        );
      }

      return true;
    } catch (error) {
      // 若包含待用户审批中断，保持返回 true 代表运行挂起非致命失败
      if (isApprovalPendingError(error)) {
        return true;
      }
      throw error;
    } finally {
      // 容器删除前回收产物；异常、中止和审批挂起时已生成的文件也不会丢失。
      if (isSandbox && isSshSandboxBackend(backend)) {
        await exportSandboxOutputsToWorkspace(backend, backendRootDir, initialFiles, this.appService, context.task.id);
      }

      // 恢复共享后端上本轮临时安装的权限钩子。
      restoreBackend?.();

      // 仅释放本轮创建的临时后端；工作区沙箱由租约和工作区生命周期管理。
      try {
        if (disposeBackend && 'stop' in backend && typeof (backend as any).stop === 'function') {
          await (backend as any).stop();
        } else if (disposeBackend && 'close' in backend && typeof (backend as any).close === 'function') {
          await (backend as any).close();
        }
      } finally {
        await releaseSandbox?.();
      }
    }
  }

  /**
   * 将 AnyBuddy 的 ToolDefinition 转换为 DeepAgent / LangChain 的 tool
   * 
   * @param toolDefinition AnyBuddy 工具定义
   * @param context 工具执行上下文
   */
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

  /**
   * 解析需要注入的记忆文件列表（如项目根目录的 AGENTS.md）
   * 
   * @param rootDir 根目录物理路径
   * @returns 虚拟相对路径数组
   */
  private resolveMemoryFiles(rootDir: string) {
    const projectAgentFile = path.resolve(process.cwd(), 'AGENTS.md');
    const virtualPath = this.toBackendVirtualPath(rootDir, projectAgentFile);
    return virtualPath ? [virtualPath] : [];
  }

  /**
   * 解析并准备 Agent 技能列表（自动扫描全局技能或从选定 ID 加载并镜像到后端）
   * 
   * @param runId 运行 ID
   * @param skillIds 声明使用的技能 ID 列表
   * @param rootDir 后端根目录
   * @returns 解析后的后端虚拟路径数组
   */
  private async resolveSkillSources(
    runId: string,
    skillIds: string[],
    rootDir: string,
    sandboxBackend?: SshSandboxBackend,
  ) {
    let uniqueSkillIds = Array.from(new Set(skillIds.filter(Boolean)));
    const skillsRoot = getGlobalSkillsRoot();

    // 如果前端未选择任何技能，自动扫描系统全局技能目录 ~/.culclaw/skills 下所有包含 SKILL.md 的有效技能
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
        if (sandboxBackend) {
          const virtualPath = await mirrorSkillIntoRemoteSandboxBackend(sandboxBackend, skillDir, skillId);
          if (virtualPath) {
            picked = { source: skillDir, cachedPath: virtualPath, virtualPath };
          }
        } else {
          const cachedPath = await mirrorSkillIntoBackend(rootDir, skillDir, skillId);
          if (cachedPath) {
            const virtualPath = this.toBackendVirtualPath(rootDir, cachedPath);
            if (virtualPath) {
              picked = { source: skillDir, cachedPath, virtualPath };
            }
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

  /**
   * 将物理绝对路径转换为 LocalShellBackend 能处理的虚拟路径格式（以 `/` 开头）
   * 
   * @param rootDir 根目录绝对路径
   * @param absolutePath 目标物理绝对路径
   * @returns 虚拟路径字符串（如 '/.system-skill-cache/my-skill'），跨盘符或越界时返回 null
   */
  private toBackendVirtualPath(rootDir: string, absolutePath: string) {
    const normalizedRoot = path.resolve(rootDir);
    const normalizedTarget = path.resolve(absolutePath);

    if (!isSameDrive(normalizedRoot, normalizedTarget)) {
      return null;
    }

    const relativePath = path.relative(normalizedRoot, normalizedTarget);
    if (!relativePath || relativePath === '') {
      return '/';
    }

    const normalizedRelative = relativePath.replace(/\\/g, '/');
    if (normalizedRelative.startsWith('..')) {
      return null;
    }

    return `/${normalizedRelative}`;
  }

  /**
   * 创建并初始化 Backend 实例（默认权限使用远程 Docker 沙盒，完全访问权限使用 LocalShellBackend）
   * 
   * @param context 执行上下文
   * @param rootDir 后端根目录
   */
  private async createBackend(
    context: ExecuteAgentParams['context'],
    rootDir: string,
    workspaceId?: string,
  ) {
    const isFullAccess = context.task.permissionMode === 'full_access';

    if (isFullAccess) {
      const backend = await LocalShellBackend.create({
        rootDir,
        virtualMode: true,
      });
      console.debug('[DeepAgentBackend] 创建完全访问权限后端 LocalShellBackend', {
        runId: context.run.id,
        taskId: context.task.id,
        permissionMode: context.task.permissionMode,
      });

      // 非 craft 模式（如 plan 模式）下，禁止写文件和修改文件
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

      return {
        backend,
        isSandbox: false,
        initialFiles: {} as WorkspaceFileSnapshot,
        disposeBackend: true,
        releaseSandbox: undefined,
        restoreBackend: undefined,
      };
    }

    // 默认权限模式：直接通过 SSH 使用远程 Docker 沙盒，并上传工作区快照。
    // 工作区有稳定 ID 时复用对应沙箱，否则保留无工作区场景的一次性后端行为。
    const sandboxLease = workspaceId
      ? await SshDockerSandboxBackend.acquireWorkspaceSandbox(workspaceId)
      : undefined;
    // 从 culclaw.ini 或环境变量创建 SSH Docker 沙盒后端。
    const backend = sandboxLease?.backend ?? (await SshDockerSandboxBackend.fromEnvironment());
    const initialFiles = await loadInitialWorkspaceFiles(rootDir);
    const initialFileUploads: Array<[string, Uint8Array]> = Object.entries(initialFiles);
    try {
      const uploadResults = await backend.uploadFiles(initialFileUploads);
      const failedUploads = uploadResults.filter(item => item.error);
      if (failedUploads.length > 0) {
        throw new Error(`远程 Docker 沙盒初始化文件上传失败：${failedUploads.map(item => item.path).join(', ')}`);
      }
    } catch (error) {
      if (sandboxLease) {
        await sandboxLease.release();
      } else {
        await backend.close();
      }
      throw error;
    }

    console.debug('[DeepAgentBackend] 创建默认权限远程 Docker 沙盒后端', {
      runId: context.run.id,
      taskId: context.task.id,
      permissionMode: context.task.permissionMode,
      initialFileCount: Object.keys(initialFiles).length,
    });

    const originalWrite = sandboxLease ? backend.write : undefined;
    const originalEdit = sandboxLease ? backend.edit : undefined;
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

    const restoreBackend = sandboxLease
      ? () => {
        if (originalWrite) backend.write = originalWrite;
        if (originalEdit) backend.edit = originalEdit;
      }
      : undefined;

    return {
      backend,
      isSandbox: true,
      initialFiles,
      disposeBackend: !sandboxLease,
      releaseSandbox: sandboxLease?.release,
      restoreBackend,
    };
  }

  /**
   * 解析 DeepAgent 权限配置
   * 
   * @param _context 执行上下文
   */
  private resolvePermissions(_context: ExecuteAgentParams['context']) {
    // 默认权限通过远程 Docker 容器隔离执行；完全访问权限保持 LocalShellBackend 的原有行为。
    // 不使用 DeepAgents 的逐命令 interruptOn，避免在沙盒运行中请求人工审批。
    return undefined;
  }
}
