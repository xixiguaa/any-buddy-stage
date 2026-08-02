import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import {
  BaseSandbox,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileOperationError,
  type FileUploadResponse,
} from 'deepagents/node';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { readSandboxIni } from '../config/sandbox-ini-config.js';

const FILE_OPERATION_ERRORS = new Set<FileOperationError>([
  'file_not_found',
  'permission_denied',
  'is_directory',
  'invalid_path',
]);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
// 默认镜像同时提供 Python 3.12 与 Node.js 22；仍可通过 SANDBOX_DOCKER_IMAGE 覆盖。
const DEFAULT_DOCKER_IMAGE = 'nikolaik/python-nodejs:python3.12-nodejs22-slim';
const DOCKER_IMAGES_BY_TYPE = {
  node: 'node:22-slim',
  python: 'python:3.12-slim',
  combined: DEFAULT_DOCKER_IMAGE,
} as const;

type DockerImageType = keyof typeof DOCKER_IMAGES_BY_TYPE;
const CONTAINER_WORKDIR = '/workspace';

export type SshDockerSandboxBackendOptions = {
  mode?: 'local' | 'ssh';
  host?: string;
  username?: string;
  port?: number;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  hostFingerprint?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxTransferBytes?: number;
  dockerImage?: string;
  dockerImageType?: DockerImageType;
  sandboxId?: string;
};

type SshCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

type SshInputWriter = (stdin: Writable) => Promise<void>;

type UploadCandidate = {
  index: number;
  path: string;
  encodedPath: string;
  content: Uint8Array;
};

type DownloadCandidate = {
  index: number;
  path: string;
  encodedPath: string;
};

/** 工作区沙箱池中的单个实例及其串行执行队列。 */
type WorkspaceSandboxPoolEntry = {
  backendPromise: Promise<SshDockerSandboxBackend>;
  executionTail: Promise<void>;
};

/** 解析镜像类型，避免错误配置导致远程 Docker 进入长时间拉取等待。 */
function parseDockerImageType(value: string | undefined): DockerImageType | undefined {
  const imageType = value?.trim().toLowerCase();
  if (!imageType) return undefined;
  if (imageType === 'node' || imageType === 'python' || imageType === 'combined') {
    return imageType;
  }
  throw new Error('SANDBOX_DOCKER_IMAGE_TYPE 仅支持 node、python 或 combined。');
}

/** 根据镜像类型选择官方镜像；未指定类型时保留原有自定义镜像能力。 */
function resolveDockerImage(imageType: DockerImageType | undefined, image: string | undefined): string {
  if (imageType) return DOCKER_IMAGES_BY_TYPE[imageType];
  return validateNonEmpty(image?.trim() || DEFAULT_DOCKER_IMAGE, 'dockerImage');
}

/**
 * 通过 SSH 连接远程主机，并在远程 Docker 容器中执行 DeepAgents 命令。
 *
 * 远程主机需要安装并允许当前 SSH 用户使用 Docker CLI。容器只在首次执行、
 * 上传或下载时创建，关闭后通过 docker rm -f 清理。文件传输使用单条 SSH
 * 管道和 Base64 标记协议，避免为每个文件重复建立 SSH 连接。
 */
export class SshDockerSandboxBackend extends BaseSandbox {
  readonly id: string;
  readonly mode: 'local' | 'ssh';

  /** 主进程内按工作区复用的远程 Docker 沙箱。 */
  private static readonly workspaceSandboxPool = new Map<string, WorkspaceSandboxPoolEntry>();
  /** 已从池中移除、但仍在等待运行任务结束的沙箱清理任务。 */
  private static readonly pendingWorkspaceSandboxCloses = new Set<Promise<void>>();

  private readonly host: string;
  private readonly username?: string;
  private readonly port: number;
  private readonly privateKeyPath?: string;
  private readonly password?: string;
  private readonly passphrase?: string;
  private readonly hostFingerprint?: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly maxTransferBytes: number;
  private readonly dockerImage: string;
  private readonly containerName: string;
  private readonly containerWorkdir = CONTAINER_WORKDIR;
  private readonly dockerCommand = 'docker';

  private containerId?: string;
  private containerReadyPromise?: Promise<void>;
  private connection?: Client;
  private connectionReadyPromise?: Promise<Client>;
  private closed = false;

  /**
   * 独占获取工作区沙箱，避免同一工作区的多个任务同时读写同一个容器目录。
   */
  static async acquireWorkspaceSandbox(workspaceId: string) {
    const entry = SshDockerSandboxBackend.getOrCreateWorkspaceSandboxEntry(workspaceId);
    const previousExecution = entry.executionTail;
    let releaseExecution: (() => void) | undefined;
    const executionDone = new Promise<void>(resolve => {
      releaseExecution = resolve;
    });
    const executionTail = previousExecution
      .catch(() => undefined)
      .then(() => executionDone);
    entry.executionTail = executionTail;

    // 队列尾部空闲后重置，避免长期运行时保留完整的历史 Promise 链。
    void executionTail.finally(() => {
      if (entry.executionTail === executionTail) {
        entry.executionTail = Promise.resolve();
      }
    });

    try {
      await previousExecution.catch(() => undefined);
      const backend = await entry.backendPromise;
      let released = false;

      return {
        backend,
        release: async () => {
          if (released) return;
          released = true;
          releaseExecution?.();
          await executionDone;
        },
      };
    } catch (error) {
      releaseExecution?.();
      throw error;
    }
  }

  /**
   * 释放已归档工作区的沙箱，并清理此前应用进程遗留的同标签远程容器。
   */
  static async releaseWorkspaceSandbox(workspaceId: string): Promise<void> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const entry = SshDockerSandboxBackend.workspaceSandboxPool.get(normalizedWorkspaceId);
    if (entry) {
      SshDockerSandboxBackend.workspaceSandboxPool.delete(normalizedWorkspaceId);
      const closePromise = SshDockerSandboxBackend.closeWorkspaceSandboxEntry(entry);
      SshDockerSandboxBackend.pendingWorkspaceSandboxCloses.add(closePromise);
      try {
        await closePromise;
      } finally {
        SshDockerSandboxBackend.pendingWorkspaceSandboxCloses.delete(closePromise);
      }
    }

    await SshDockerSandboxBackend.removeRemoteWorkspaceContainers(normalizedWorkspaceId);
  }

  /** 在应用退出时释放当前进程创建的全部工作区沙箱。 */
  static async closeAllWorkspaceSandboxes(): Promise<void> {
    const entries = Array.from(SshDockerSandboxBackend.workspaceSandboxPool.values());
    SshDockerSandboxBackend.workspaceSandboxPool.clear();
    const pendingCloses = Array.from(SshDockerSandboxBackend.pendingWorkspaceSandboxCloses);
    await Promise.allSettled([
      ...entries.map(entry => SshDockerSandboxBackend.closeWorkspaceSandboxEntry(entry)),
      ...pendingCloses,
    ]);
  }

  constructor(options: SshDockerSandboxBackendOptions) {
    super();

    this.mode = options.mode ?? (options.host ? 'ssh' : 'local');
    this.host = validateHost(options.host ?? 'localhost');
    this.username = validateUsername(options.username);
    this.port = validatePort(options.port ?? 22);
    this.privateKeyPath = options.privateKeyPath?.trim() || undefined;
    this.password = options.password;
    this.passphrase = options.passphrase;
    this.hostFingerprint = normalizeFingerprint(options.hostFingerprint);
    if (this.mode === 'ssh' && !this.password && !this.privateKeyPath) {
      throw new Error('请配置 SANDBOX_SSH_PASSWORD 或 SANDBOX_SSH_KEY_PATH。');
    }
    this.timeoutMs = validatePositiveNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxOutputBytes = validatePositiveNumber(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
    this.maxTransferBytes = validatePositiveNumber(options.maxTransferBytes ?? DEFAULT_MAX_TRANSFER_BYTES, 'maxTransferBytes');
    // 配置镜像类型时使用内置官方镜像；未配置时兼容已有 image 配置。
    this.dockerImage = resolveDockerImage(options.dockerImageType, options.dockerImage);
    this.id = options.sandboxId ?? `ssh-docker-${randomUUID()}`;
    this.containerName = `culclaw-sandbox-${randomUUID()}`;
  }

  /** 从 culclaw.ini 配置文件或环境变量读取 SSH 和 Docker 配置。 */
  static async fromEnvironment(
    iniPath?: string,
    environment: Record<string, string | undefined> = process.env,
    options: Pick<SshDockerSandboxBackendOptions, 'sandboxId'> = {},
  ) {
    const iniConfig = await readSandboxIni(iniPath);
    const getConf = (key: string): string | undefined => environment[key]?.trim() || iniConfig[key]?.trim();

    const rawMode = getConf('SANDBOX_TYPE') || getConf('SANDBOX_MODE');
    let mode: 'local' | 'ssh' = 'local';
    const normalizedMode = rawMode?.trim().toLowerCase();

    if (normalizedMode?.includes('local')) {
      mode = 'local';
    } else if (normalizedMode?.includes('ssh') || normalizedMode?.includes('remote')) {
      mode = 'ssh';
    } else {
      const configuredServerUrl = getConf('SANDBOX_SERVER_URL');
      const configuredSshHost = getConf('SANDBOX_SSH_HOST');
      const configuredPassword = getConf('SANDBOX_SSH_PASSWORD');
      const configuredKeyPath = getConf('SANDBOX_SSH_KEY_PATH');
      if ((configuredSshHost || configuredServerUrl?.toLowerCase().startsWith('ssh://')) && (configuredPassword || configuredKeyPath)) {
        mode = 'ssh';
      } else {
        mode = 'local';
      }
    }

    const configuredServerUrl = getConf('SANDBOX_SERVER_URL');
    let sshUrl: URL | undefined;
    if (mode === 'ssh' && !getConf('SANDBOX_SSH_HOST') && configuredServerUrl?.toLowerCase().startsWith('ssh://')) {
      try {
        sshUrl = new URL(configuredServerUrl);
        if (sshUrl.protocol !== 'ssh:') {
          throw new Error('unsupported ssh url');
        }
      } catch {
        throw new Error('SANDBOX_SERVER_URL 必须是有效的 ssh://user@host:port 地址。');
      }
    }

    const host = getConf('SANDBOX_SSH_HOST') || sshUrl?.hostname || (mode === 'local' ? 'localhost' : undefined);
    if (mode === 'ssh' && !host) {
      throw new Error('缺少 SANDBOX_SSH_HOST 或有效的 SANDBOX_SERVER_URL 配置，无法创建 SSH Docker 沙盒。');
    }

    const timeoutRaw = getConf('SANDBOX_SSH_TIMEOUT_MS') ?? getConf('SANDBOX_SERVER_TIMEOUT_MS');
    const username = getConf('SANDBOX_SSH_USER')
      || (sshUrl?.username ? decodeURIComponent(sshUrl.username) : undefined);
    const password = getConf('SANDBOX_SSH_PASSWORD')
      || (sshUrl?.password ? decodeURIComponent(sshUrl.password) : undefined);
    const urlPort = sshUrl?.port ? Number(sshUrl.port) : undefined;

    return new SshDockerSandboxBackend({
      mode,
      host,
      username,
      port: parseEnvironmentNumber(
        getConf('SANDBOX_SSH_PORT') ?? (urlPort ? String(urlPort) : undefined),
        22,
        'SANDBOX_SSH_PORT',
        true,
      ),
      privateKeyPath: getConf('SANDBOX_SSH_KEY_PATH') || undefined,
      password: password || undefined,
      passphrase: getConf('SANDBOX_SSH_KEY_PASSPHRASE') || undefined,
      hostFingerprint: getConf('SANDBOX_SSH_HOST_FINGERPRINT') || undefined,
      timeoutMs: parseEnvironmentNumber(timeoutRaw, DEFAULT_TIMEOUT_MS, 'SANDBOX_SSH_TIMEOUT_MS'),
      maxOutputBytes: parseEnvironmentNumber(
        getConf('SANDBOX_SSH_MAX_OUTPUT_BYTES'),
        DEFAULT_MAX_OUTPUT_BYTES,
        'SANDBOX_SSH_MAX_OUTPUT_BYTES',
      ),
      maxTransferBytes: parseEnvironmentNumber(
        getConf('SANDBOX_SSH_MAX_TRANSFER_BYTES'),
        DEFAULT_MAX_TRANSFER_BYTES,
        'SANDBOX_SSH_MAX_TRANSFER_BYTES',
      ),
      dockerImage: getConf('SANDBOX_DOCKER_IMAGE') || undefined,
      dockerImageType: parseDockerImageType(getConf('SANDBOX_DOCKER_IMAGE_TYPE')),
      sandboxId: options.sandboxId,
    });
  }

  /** 立即创建远程容器，用于在工作区创建阶段预热。 */
  async start(): Promise<void> {
    await this.ensureContainer();
  }

  /** 在远程 Docker 容器内执行命令。 */
  async execute(command: string): Promise<ExecuteResponse> {
    await this.ensureContainer();
    const result = await this.runDocker(this.buildDockerExecArgs(command));
    const output = result.stdout && result.stderr
      ? `${result.stdout}\n${result.stderr}`
      : result.stdout || result.stderr;

    return {
      output,
      exitCode: result.exitCode,
      truncated: result.truncated,
    };
  }

  /** 批量上传文件到远程容器，支持单个文件失败。 */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    if (files.length === 0) return [];

    const responses = new Array<FileUploadResponse>(files.length);
    const candidates: UploadCandidate[] = [];

    files.forEach(([path, content], index) => {
      if (!isSandboxPath(path)) {
        responses[index] = { path, error: 'invalid_path' };
        return;
      }

      candidates.push({
        index,
        path,
        encodedPath: encodeBase64(path),
        content,
      });
    });

    if (candidates.length === 0) return responses;
    await this.ensureContainer();

    const result = await this.runDocker(
      this.buildDockerExecArgs(this.createUploadScript(), true),
      async stdin => {
        for (const candidate of candidates) {
          const encodedContent = Buffer.from(candidate.content).toString('base64');
          await writeChunk(stdin, `${candidate.encodedPath}|${encodedContent}\n`);
        }
      },
      this.maxTransferBytes,
    );

    this.assertTransferSucceeded(result, '上传文件');
    this.applyUploadResults(result.stdout, candidates, responses);
    return responses;
  }

  /** 批量下载远程容器文件，支持单个文件失败。 */
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    if (paths.length === 0) return [];

    const responses = new Array<FileDownloadResponse>(paths.length);
    const candidates: DownloadCandidate[] = [];

    paths.forEach((path, index) => {
      if (!isSandboxPath(path)) {
        responses[index] = { path, content: null, error: 'invalid_path' };
        return;
      }

      candidates.push({
        index,
        path,
        encodedPath: encodeBase64(path),
      });
    });

    if (candidates.length === 0) return responses;
    await this.ensureContainer();

    const result = await this.runDocker(
      this.buildDockerExecArgs(this.createDownloadScript(), true),
      async stdin => {
        for (const candidate of candidates) {
          await writeChunk(stdin, `${candidate.encodedPath}\n`);
        }
      },
      this.maxTransferBytes,
    );

    this.assertTransferSucceeded(result, '下载文件');
    this.applyDownloadResults(result.stdout, candidates, responses);
    return responses;
  }

  /** 下载容器工作区中的全部普通文件，并转换为沙盒虚拟路径。 */
  async downloadWorkspaceFiles(): Promise<FileDownloadResponse[]> {
    await this.ensureContainer();

    // 使用 NUL 分隔，避免文件名含换行符时破坏传输列表。
    const listed = await this.runDocker(
      this.buildDockerExecArgs('find . -type f -print0'),
      undefined,
      this.maxTransferBytes,
    );
    this.assertTransferSucceeded(listed, '枚举容器工作区文件');

    const containerPaths = listed.stdout
      .split('\0')
      .filter(Boolean)
      .map(filePath => filePath.replace(/^\.\//, ''))
      .filter(Boolean)
      .map(filePath => `${this.containerWorkdir}/${filePath}`);

    const downloaded = await this.downloadFiles(containerPaths);
    return downloaded.map(item => ({
      ...item,
      path: this.toWorkspaceVirtualPath(item.path),
    }));
  }

  /** 关闭并清理本次运行创建的远程容器。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      // 等待创建流程结束，避免 close 与 docker run 竞态导致容器遗留。
      await this.containerReadyPromise?.catch(() => undefined);
      if (this.containerId) {
        const result = await this.runSsh(
          `${this.dockerCommand} rm -f ${shellQuote(this.containerId)}`,
          undefined,
          this.maxOutputBytes,
          true,
        );
        if (result.exitCode !== 0) {
          throw new Error(this.formatCommandFailure(result, '清理远程 Docker 容器'));
        }
      }
    } catch (error) {
      console.warn('[SshDockerSandbox] 清理远程 Docker 沙盒失败:', error);
    } finally {
      const connection = this.connection;
      this.connection = undefined;
      this.connectionReadyPromise = undefined;
      connection?.end();
    }
  }

  /** 获取或创建工作区专属的后端实例。 */
  private static getOrCreateWorkspaceSandboxEntry(workspaceId: string): WorkspaceSandboxPoolEntry {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const existing = SshDockerSandboxBackend.workspaceSandboxPool.get(normalizedWorkspaceId);
    if (existing) return existing;

    const backendPromise = SshDockerSandboxBackend.createWorkspaceSandbox(normalizedWorkspaceId);
    const entry: WorkspaceSandboxPoolEntry = {
      backendPromise,
      executionTail: Promise.resolve(),
    };
    SshDockerSandboxBackend.workspaceSandboxPool.set(normalizedWorkspaceId, entry);

    void backendPromise.catch(() => {
      // 初始化失败时移除失效条目，后续运行可以重新尝试创建。
      if (SshDockerSandboxBackend.workspaceSandboxPool.get(normalizedWorkspaceId) === entry) {
        SshDockerSandboxBackend.workspaceSandboxPool.delete(normalizedWorkspaceId);
      }
    });
    return entry;
  }

  /** 创建并启动某个工作区的独立远程 Docker 容器。 */
  private static async createWorkspaceSandbox(workspaceId: string): Promise<SshDockerSandboxBackend> {
    const backend = await SshDockerSandboxBackend.fromEnvironment(undefined, process.env, {
      sandboxId: `workspace-${workspaceId}`,
    });

    try {
      await backend.start();
      console.debug('[SshDockerSandbox] 工作区沙箱已预热:', workspaceId);
      return backend;
    } catch (error) {
      await backend.close();
      throw error;
    }
  }

  /** 等待正在使用的任务退出后，再关闭对应的远程容器。 */
  private static async closeWorkspaceSandboxEntry(entry: WorkspaceSandboxPoolEntry): Promise<void> {
    await entry.executionTail.catch(() => undefined);
    const backend = await entry.backendPromise.catch(() => undefined);
    await backend?.close();
  }

  /**
   * 当前进程重启后内存池会丢失；通过稳定标签定位并清理远程遗留容器。
   */
  private static async removeRemoteWorkspaceContainers(workspaceId: string): Promise<void> {
    const sandboxId = `workspace-${workspaceId}`;
    const backend = await SshDockerSandboxBackend.fromEnvironment(undefined, process.env, { sandboxId });
    const labelFilter = `label=culclaw.sandbox.id=${sandboxId}`;

    try {
      const listed = await backend.runDocker(['ps', '-aq', '--filter', labelFilter]);
      if (listed.exitCode !== 0) {
        throw new Error(backend.formatCommandFailure(listed, '查询远程 Docker 工作区容器'));
      }

      // 仅接受 Docker 返回的标准容器 ID，避免将远程命令输出直接拼接进删除命令。
      const containerIds = listed.stdout
        .split(/\s+/)
        .filter(containerId => /^[a-f0-9]{12,64}$/i.test(containerId));
      if (containerIds.length === 0) return;

      const removed = await backend.runDocker(['rm', '-f', ...containerIds]);
      if (removed.exitCode !== 0) {
        throw new Error(backend.formatCommandFailure(removed, '删除远程 Docker 工作区容器'));
      }
    } finally {
      await backend.close();
    }
  }

  private async ensureContainer(): Promise<void> {
    if (this.closed) {
      throw new Error(`SSH Docker 沙盒 ${this.id} 已关闭。`);
    }

    if (!this.containerReadyPromise) {
      this.containerReadyPromise = this.createContainer();
    }
    await this.containerReadyPromise;
  }

  /** 将容器工作区内的绝对路径转换为 DeepAgents 使用的虚拟绝对路径。 */
  private toWorkspaceVirtualPath(containerPath: string): string {
    const relativePath = containerPath.slice(this.containerWorkdir.length).replace(/^\/+/, '');
    return `/${relativePath}`;
  }

  private async createContainer(): Promise<void> {
    const command = [
      'run',
      '-d',
      '--name',
      this.containerName,
      '--label',
      `culclaw.sandbox.id=${this.id}`,
      this.dockerImage,
      'sh',
      '-lc',
      `mkdir -p ${shellQuote(this.containerWorkdir)} && while :; do sleep 3600; done`,
    ];

    const result = await this.runDocker(command);
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, '创建远程 Docker 容器'));
    }

    const containerId = result.stdout.trim().split(/\s+/)[0];
    if (!containerId) {
      throw new Error('创建远程 Docker 容器成功但未返回容器 ID。');
    }
    this.containerId = containerId;
  }

  private buildDockerExecArgs(command: string, interactive = false): string[] {
    if (!this.containerId) {
      throw new Error('远程 Docker 容器尚未创建。');
    }

    return [
      'exec',
      ...(interactive ? ['-i'] : []),
      '-w',
      this.containerWorkdir,
      this.containerId,
      'sh',
      '-lc',
      command,
    ];
  }

  /** 构造文件上传 Shell 脚本，压缩为单行避免 SSH 模式下换行符被宿主 Shell 切割导致 exit code 255 报错 */
  private createUploadScript(): string {
    return [
      'while IFS="|" read -r encodedPath encodedContent; do',
      '  [ -n "$encodedPath" ] || continue;',
      '  path=$(printf "%s" "$encodedPath" | base64 -d 2>/dev/null) || { printf "ERR|%s|invalid_path\\n" "$encodedPath"; continue; };',
      '  case "$path" in /*) ;; *) printf "ERR|%s|invalid_path\\n" "$encodedPath"; continue ;; esac;',
      '  parent=$(dirname "$path");',
      '  if mkdir -p "$parent" && printf "%s" "$encodedContent" | base64 -d > "$path"; then',
      '    printf "OK|%s\\n" "$encodedPath";',
      '  else',
      '    printf "ERR|%s|permission_denied\\n" "$encodedPath";',
      '  fi;',
      'done',
    ].join(' ');
  }

  /** 构造文件下载 Shell 脚本，压缩为单行避免 SSH 模式下换行符被宿主 Shell 切割导致 exit code 255 报错 */
  private createDownloadScript(): string {
    return [
      'while IFS="|" read -r encodedPath; do',
      '  [ -n "$encodedPath" ] || continue;',
      '  path=$(printf "%s" "$encodedPath" | base64 -d 2>/dev/null) || { printf "ERR|%s|invalid_path\\n" "$encodedPath"; continue; };',
      '  case "$path" in /*) ;; *) printf "ERR|%s|invalid_path\\n" "$encodedPath"; continue ;; esac;',
      '  if [ -d "$path" ]; then',
      '    printf "ERR|%s|is_directory\\n" "$encodedPath";',
      '  elif [ -f "$path" ] && [ -r "$path" ]; then',
      '    content=$(base64 < "$path" 2>/dev/null | tr -d "\\r\\n");',
      '    printf "OK|%s|%s\\n" "$encodedPath" "$content";',
      '  elif [ -f "$path" ]; then',
      '    printf "ERR|%s|permission_denied\\n" "$encodedPath";',
      '  else',
      '    printf "ERR|%s|file_not_found\\n" "$encodedPath";',
      '  fi;',
      'done',
    ].join(' ');
  }

  private applyUploadResults(
    output: string,
    candidates: UploadCandidate[],
    responses: FileUploadResponse[],
  ): void {
    const indexesByPath = this.createCandidateQueues(candidates);

    for (const line of output.split(/\r?\n/)) {
      const [status, encodedPath, errorCode] = line.split('|');
      if (!encodedPath || (status !== 'OK' && status !== 'ERR')) continue;

      const index = indexesByPath.get(encodedPath)?.shift();
      if (index === undefined) continue;

      const candidate = candidates.find(item => item.index === index);
      if (!candidate) continue;
      responses[index] = {
        path: candidate.path,
        error: status === 'OK' ? null : this.toFileError(errorCode) ?? 'invalid_path',
      };
    }

    for (const candidate of candidates) {
      if (!responses[candidate.index]) {
        responses[candidate.index] = { path: candidate.path, error: 'invalid_path' };
      }
    }
  }

  private applyDownloadResults(
    output: string,
    candidates: DownloadCandidate[],
    responses: FileDownloadResponse[],
  ): void {
    const indexesByPath = this.createCandidateQueues(candidates);

    for (const line of output.split(/\r?\n/)) {
      const parts = line.split('|');
      const status = parts[0];
      const encodedPath = parts[1];
      if (!encodedPath || (status !== 'OK' && status !== 'ERR')) continue;

      const index = indexesByPath.get(encodedPath)?.shift();
      if (index === undefined) continue;

      const candidate = candidates.find(item => item.index === index);
      if (!candidate) continue;

      if (status === 'OK') {
        const encodedContent = parts.slice(2).join('|');
        responses[index] = {
          path: candidate.path,
          content: new Uint8Array(Buffer.from(encodedContent, 'base64')),
          error: null,
        };
      } else {
        responses[index] = {
          path: candidate.path,
          content: null,
          error: this.toFileError(parts[2]) ?? 'invalid_path',
        };
      }
    }

    for (const candidate of candidates) {
      if (!responses[candidate.index]) {
        responses[candidate.index] = {
          path: candidate.path,
          content: null,
          error: 'invalid_path',
        };
      }
    }
  }

  private createCandidateQueues(
    candidates: Array<UploadCandidate | DownloadCandidate>,
  ): Map<string, number[]> {
    const queues = new Map<string, number[]>();
    for (const candidate of candidates) {
      const queue = queues.get(candidate.encodedPath) ?? [];
      queue.push(candidate.index);
      queues.set(candidate.encodedPath, queue);
    }
    return queues;
  }

  private async ensureConnection(allowClosed = false): Promise<Client> {
    if (this.closed && !allowClosed) {
      throw new Error(`SSH Docker 沙盒 ${this.id} 已关闭。`);
    }

    if (this.connection) return this.connection;
    if (!this.connectionReadyPromise) {
      this.connectionReadyPromise = this.connectClient().catch(error => {
        this.connectionReadyPromise = undefined;
        throw error;
      });
    }
    return this.connectionReadyPromise;
  }

  private async connectClient(): Promise<Client> {
    const privateKey = this.privateKeyPath
      ? await readFile(this.privateKeyPath)
      : undefined;

    if (!this.hostFingerprint) {
      console.warn(
        '[SshDockerSandbox] 未配置 SANDBOX_SSH_HOST_FINGERPRINT，ssh2 将接受服务器提供的主机密钥。',
      );
    }

    const config: ConnectConfig = {
      host: this.host,
      port: this.port,
      username: this.username,
      password: this.password,
      privateKey,
      passphrase: this.passphrase,
      readyTimeout: this.timeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      ...(this.hostFingerprint
        ? {
          hostHash: 'sha256',
          hostVerifier: (fingerprint: string) => hostFingerprintMatches(fingerprint, this.hostFingerprint!),
        }
        : {}),
    };

    const client = new Client();
    return new Promise<Client>((resolve, reject) => {
      let settled = false;

      const invalidate = () => {
        if (this.connection === client) {
          this.connection = undefined;
          this.connectionReadyPromise = undefined;
        }
      };

      const onError = (error: Error) => {
        invalidate();
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const onClose = () => {
        invalidate();
        if (!settled) {
          settled = true;
          reject(new Error('SSH 连接在准备就绪前关闭。'));
        }
      };

      client.on('error', onError);
      client.on('close', onClose);
      client.once('ready', () => {
        settled = true;
        this.connection = client;
        resolve(client);
      });

      try {
        client.connect(config);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** 命令超时后废弃整条 SSH 连接，避免后续清理复用已失效的通道。 */
  private invalidateConnection(connection: Client): void {
    if (this.connection === connection) {
      this.connection = undefined;
      this.connectionReadyPromise = undefined;
    }
    connection.destroy();
  }

  /**
   * 统一执行 Docker CLI；本地模式不经宿主 Shell，避免 Windows Cmd 改写容器内脚本。
   */
  private async runDocker(
    args: string[],
    input?: SshInputWriter,
    maxOutputBytes = this.maxOutputBytes,
    allowClosed = false,
  ): Promise<SshCommandResult> {
    if (this.mode === 'local') {
      return this.runLocalDocker(args, input, maxOutputBytes, allowClosed);
    }

    return this.runSsh(
      [this.dockerCommand, ...args.map(shellQuote)].join(' '),
      input,
      maxOutputBytes,
      allowClosed,
    );
  }

  /**
   * 在本地 Docker 模式下直接执行 Docker CLI，并将每个参数原样传递给容器。
   */
  private async runLocalDocker(
    args: string[],
    input?: SshInputWriter,
    maxOutputBytes = this.maxOutputBytes,
    allowClosed = false,
  ): Promise<SshCommandResult> {
    if (this.closed && !allowClosed) {
      throw new Error(`Docker 沙盒 ${this.id} 已关闭。`);
    }

    if (args.some(argument => argument.includes('\0'))) {
      throw new Error('Docker 命令参数不能包含 NUL 字符。');
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let truncated = false;
    const outputLimit = Math.max(1, Math.floor(maxOutputBytes));

    const capture = (chunks: Buffer[], value: Buffer) => {
      const remaining = outputLimit - capturedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }

      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining));
        capturedBytes += remaining;
        truncated = true;
        return;
      }

      chunks.push(value);
      capturedBytes += value.length;
    };

    return new Promise<SshCommandResult>((resolve, reject) => {
      const child = spawn(this.dockerCommand, args, {
        shell: false,
        env: process.env,
      });

      let settled = false;
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          // 忽略关闭清理异常
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const timer = setTimeout(() => {
        rejectOnce(new Error(`本地 Docker 命令执行超时 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        capture(stdoutChunks, chunk);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        capture(stderrChunks, chunk);
      });

      child.on('error', err => {
        clearTimeout(timer);
        rejectOnce(err);
      });

      child.on('close', code => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code,
          truncated,
        });
      });

      void (async () => {
        if (input && child.stdin) {
          await input(child.stdin);
        }
        // 上传脚本按行读取标准输入；所有内容写完后必须关闭输入，容器才能结束循环。
        child.stdin?.end();
      })().catch(rejectOnce);
    });
  }

  private async runSsh(
    remoteCommand: string,
    input?: SshInputWriter,
    maxOutputBytes = this.maxOutputBytes,
    allowClosed = false,
  ): Promise<SshCommandResult> {
    if (remoteCommand.includes('\0')) {
      throw new Error('远程 SSH 命令不能包含 NUL 字符。');
    }

    const client = await this.ensureConnection(allowClosed);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let truncated = false;
    const outputLimit = Math.max(1, Math.floor(maxOutputBytes));

    const capture = (chunks: Buffer[], value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = outputLimit - capturedBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }

      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        capturedBytes += remaining;
        truncated = true;
        return;
      }

      chunks.push(chunk);
      capturedBytes += chunk.length;
    };

    let stream: ClientChannel | undefined;
    let inputPromise: Promise<void> | undefined;
    let exitCode: number | null = null;
    const commandPromise = new Promise<SshCommandResult>((resolve, reject) => {
      let settled = false;
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      try {
        client.exec(remoteCommand, (error, channel) => {
          if (error) {
            rejectOnce(error);
            return;
          }

          stream = channel;
          channel.on('data', (value: Buffer | string) => capture(stdoutChunks, value));
          channel.stderr.on('data', value => capture(stderrChunks, value));
          channel.stderr.on('error', rejectOnce);
          channel.once('error', rejectOnce);
          channel.once('exit', code => {
            exitCode = typeof code === 'number' ? code : null;
          });
          channel.once('close', () => {
            if (settled) return;
            settled = true;
            resolve({
              stdout: Buffer.concat(stdoutChunks).toString('utf8'),
              stderr: Buffer.concat(stderrChunks).toString('utf8'),
              exitCode,
              truncated,
            });
          });

          inputPromise = (async () => {
            if (input) {
              await input(channel);
            }
            channel.end();
          })();
          void inputPromise.catch(error => {
            if (!channel.destroyed) channel.destroy();
            rejectOnce(error);
          });
        });
      } catch (error) {
        rejectOnce(error);
      }
    });

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        if (stream && !stream.destroyed) {
          stream.close();
          stream.destroy();
        }
        // SSH 命令超时意味着连接状态不再可信，必须重连后再执行容器清理。
        this.invalidateConnection(client);
        reject(new Error(`SSH Docker 沙盒命令超时（${this.timeoutMs}ms）。`));
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([commandPromise, timeoutPromise]);
      await inputPromise;
      return result;
    } catch (error) {
      if (stream && !stream.destroyed) {
        stream.close();
        stream.destroy();
      }
      this.invalidateConnection(client);
      await inputPromise?.catch(() => undefined);
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private assertTransferSucceeded(result: SshCommandResult, operation: string): void {
    if (result.truncated) {
      throw new Error(`${operation}响应超过 SANDBOX_SSH_MAX_TRANSFER_BYTES 限制。`);
    }
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, operation));
    }
  }

  /** 格式化失败命令提示，对于 Docker Daemon 未启动等常见异常追加诊断指导 */
  private formatCommandFailure(result: SshCommandResult, operation: string): string {
    const detail = (result.stderr || result.stdout).trim().slice(0, 500);
    const executor = this.mode === 'local' ? 'Docker' : 'SSH';
    let message = `${operation}失败（${executor} exit code ${result.exitCode ?? 'unknown'}）${detail ? `：${detail}` : '。'}`;
    if (/failed to connect to the docker API|dockerDesktopLinuxEngine|daemon is not running/i.test(detail)) {
      message += '（提示：目标机器上的 Docker Desktop 或 Docker Daemon 未启动，请先打开 Docker 确保 Engine 处于 Running 状态。）';
    }
    return message;
  }

  private toFileError(value: unknown): FileOperationError | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' && FILE_OPERATION_ERRORS.has(value as FileOperationError)
      ? value as FileOperationError
      : 'invalid_path';
  }
}

async function writeChunk(stream: Writable, chunk: string | Uint8Array): Promise<void> {
  if (stream.destroyed) {
    throw new Error('SSH 输入流已关闭。');
  }
  if (stream.write(chunk)) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.removeListener('drain', onDrain);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('SSH 输入流已关闭。'));
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
    stream.once('close', onClose);
  });
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function shellQuote(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Shell 参数不能包含 NUL 字符。');
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isSandboxPath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0');
}

function validateHost(value: string): string {
  const host = validateNonEmpty(value.trim(), 'host');
  if (/\s/.test(host)) {
    throw new Error('SSH host 不能包含空白字符。');
  }
  return host;
}

function validateUsername(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/\s|@/.test(value)) {
    throw new Error('SSH username 不能包含空白字符或 @。');
  }
  return value;
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  const fingerprint = value?.trim();
  return fingerprint || undefined;
}

function hostFingerprintMatches(actual: string, expected: string): boolean {
  const normalizedActual = actual.trim();
  const normalizedExpected = expected.trim();
  if (normalizedActual.toLowerCase() === normalizedExpected.toLowerCase()) return true;

  const expectedBase64 = normalizedExpected.replace(/^sha256:/i, '').replace(/=+$/, '');
  if (!/^[0-9a-f]{64}$/i.test(normalizedActual) || !expectedBase64) return false;

  const actualBase64 = Buffer.from(normalizedActual, 'hex')
    .toString('base64')
    .replace(/=+$/, '');
  return actualBase64 === expectedBase64;
}

function validatePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('SSH port 必须是 1 到 65535 之间的整数。');
  }
  return value;
}

function validatePositiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是大于 0 的数字。`);
  }
  return value;
}

function validateNonEmpty(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} 不能为空。`);
  }
  return value;
}

/** 规范化工作区 ID，避免将空标识写入沙箱池。 */
function normalizeWorkspaceId(value: string): string {
  return validateNonEmpty(value.trim(), 'workspaceId');
}

function parseEnvironmentNumber(
  value: string | undefined,
  fallback: number,
  name: string,
  integer = false,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} 必须是大于 0 的${integer ? '整数' : '数字'}。`);
  }
  return parsed;
}
