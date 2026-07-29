import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  BaseSandbox,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileOperationError,
  type FileUploadResponse,
} from 'deepagents/node';

const FILE_OPERATION_ERRORS = new Set<FileOperationError>([
  'file_not_found',
  'permission_denied',
  'is_directory',
  'invalid_path',
]);

type RemoteDockerSandboxBackendOptions = {
  serverUrl: string;
  accessToken?: string;
  timeoutMs?: number;
  sandboxId?: string;
};

type RemoteFileResponse = {
  path?: unknown;
  contentBase64?: unknown;
  error?: unknown;
};

/**
 * 通过远程 Docker 沙盒服务执行 DeepAgents 命令。
 *
 * 服务端协议：服务端以 sandboxId 标识并按需创建隔离容器，所有文件路径均为容器内绝对路径。
 * 容器需要通过 POSIX shell 执行命令，并提供 awk、grep、find、stat 等基础命令。
 * - POST /execute: { sandboxId, command } -> { output, exitCode, truncated }
 * - POST /files/upload: { sandboxId, files: [{ path, contentBase64 }] } -> { files: [{ path, error }] }
 * - POST /files/download: { sandboxId, paths } -> { files: [{ path, contentBase64, error }] }
 * - POST /close: { sandboxId } -> 用于销毁该次运行对应的容器与工作区
 */
export class RemoteDockerSandboxBackend extends BaseSandbox {
  readonly id: string;

  private readonly serverUrl: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;
  private closed = false;

  constructor(options: RemoteDockerSandboxBackendOptions) {
    super();
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.id = options.sandboxId ?? `remote-docker-${randomUUID()}`;
  }

  /** 从环境变量读取远程沙盒服务配置。 */
  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
    const serverUrl = environment.SANDBOX_SERVER_URL?.trim();
    if (!serverUrl) {
      throw new Error('缺少 SANDBOX_SERVER_URL，无法创建远程 Docker 沙盒。');
    }

    try {
      const parsedUrl = new URL(serverUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
    } catch {
      throw new Error('SANDBOX_SERVER_URL 必须是有效的 HTTP(S) 服务地址。');
    }

    const parsedTimeout = Number(environment.SANDBOX_SERVER_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : undefined;

    return new RemoteDockerSandboxBackend({
      serverUrl,
      accessToken: environment.SANDBOX_SERVER_TOKEN?.trim() || undefined,
      timeoutMs,
    });
  }

  /** 在远程 Docker 容器内执行命令。 */
  async execute(command: string): Promise<ExecuteResponse> {
    const response = await this.request('/execute', {
      sandboxId: this.id,
      command,
    });

    if (
      typeof response.output !== 'string'
      || (typeof response.exitCode !== 'number' && response.exitCode !== null)
      || typeof response.truncated !== 'boolean'
    ) {
      throw new Error('远程沙盒 /execute 返回格式无效。');
    }

    return response as ExecuteResponse;
  }

  /** 批量上传初始工作区、技能和 Agent 生成的文件。 */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const response = await this.request('/files/upload', {
      sandboxId: this.id,
      files: files.map(([path, content]) => ({
        path,
        contentBase64: Buffer.from(content).toString('base64'),
      })),
    });

    const remoteFilesByPath = this.indexFilesResponse(response);
    return files.map(([path]) => {
      const remoteFile = remoteFilesByPath.get(path);
      return {
        path,
        error: remoteFile ? this.toFileError(remoteFile.error) : 'invalid_path',
      };
    });
  }

  /** 批量下载远程沙盒内的文件，支持单个文件失败。 */
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    const response = await this.request('/files/download', {
      sandboxId: this.id,
      paths,
    });

    const remoteFilesByPath = this.indexFilesResponse(response);
    return paths.map(path => {
      const remoteFile = remoteFilesByPath.get(path);
      const error = remoteFile ? this.toFileError(remoteFile.error) : 'invalid_path';
      const contentBase64 = remoteFile?.contentBase64;

      return {
        path,
        content: error || typeof contentBase64 !== 'string'
          ? null
          : new Uint8Array(Buffer.from(contentBase64, 'base64')),
        error,
      };
    });
  }

  /** 结束本次运行对应的远程容器；清理失败不影响已完成的 Agent 结果。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.request('/close', { sandboxId: this.id }, true);
    } catch (error) {
      console.warn('[RemoteDockerSandbox] 释放远程沙盒失败:', error);
    }
  }

  private async request(path: string, payload: Record<string, unknown>, allowAfterClose = false): Promise<Record<string, unknown>> {
    if (this.closed && !allowAfterClose) {
      throw new Error(`远程 Docker 沙盒 ${this.id} 已关闭。`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.serverUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const rawBody = await response.text();

      if (!response.ok) {
        throw new Error(`远程沙盒请求 ${path} 失败（HTTP ${response.status}）：${rawBody.slice(0, 500)}`);
      }

      if (!rawBody) return {};
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`远程沙盒请求 ${path} 返回了无效 JSON 对象。`);
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`远程沙盒请求 ${path} 超时（${this.timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private indexFilesResponse(response: Record<string, unknown>): Map<string, RemoteFileResponse> {
    const remoteFiles = Array.isArray(response.files)
      ? response.files.filter((item): item is RemoteFileResponse => Boolean(item && typeof item === 'object'))
      : [];

    return new Map(remoteFiles.flatMap(file => (
      typeof file.path === 'string' ? [[file.path, file] as const] : []
    )));
  }

  private toFileError(value: unknown): FileOperationError | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' && FILE_OPERATION_ERRORS.has(value as FileOperationError)
      ? value as FileOperationError
      : 'invalid_path';
  }
}
