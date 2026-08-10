import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Writable } from 'node:stream';
import {
  BaseSandbox,
  type ExecuteResponse,
  type FileDownloadResponse,
  type FileOperationError,
  type FileUploadResponse,
} from 'deepagents/node';
import { readSandboxIni } from '../config/sandbox-ini-config.js';
import type { CommandExecutor, CommandResult, InputWriter } from './executors/command-executor.js';
import { LocalCommandExecutor } from './executors/local-command-executor.js';

const IGNORED_ARTIFACT_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  '.vite',
  '.tmp-tests',
  'userData',
  'brain',
  '.system-skill-cache',
]);

const IGNORED_ARTIFACT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);

/** 判断文件是否属于可以从沙箱导出的用户产物。 */
export function isAllowedArtifactFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  if (pathSegments.some(segment => IGNORED_ARTIFACT_DIRECTORIES.has(segment))) {
    return false;
  }

  const fileName = pathSegments.at(-1)?.toLowerCase();
  if (!fileName || IGNORED_ARTIFACT_FILES.has(fileName)) {
    return false;
  }

  return true;
}

const FILE_OPERATION_ERRORS = new Set<FileOperationError>([
  'file_not_found',
  'permission_denied',
  'is_directory',
  'invalid_path',
]);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_DOCKER_IMAGE = 'nikolaik/python-nodejs:python3.12-nodejs22-slim';
const DOCKER_IMAGES_BY_TYPE = {
  node: 'node:22-slim',
  python: 'python:3.12-slim',
  combined: DEFAULT_DOCKER_IMAGE,
} as const;
/** Docker 沙箱中唯一允许读写用户工作区文件的真实目录。 */
export const DOCKER_SANDBOX_WORKDIR = '/workspace';
const GLOBAL_SANDBOX_ID = 'global';
const GLOBAL_CONTAINER_NAME = 'culclaw-sandbox-global';

type DockerImageType = keyof typeof DOCKER_IMAGES_BY_TYPE;

export type DockerSandboxBackendOptions = {
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxTransferBytes?: number;
  dockerImage?: string;
  dockerImageType?: DockerImageType;
  sandboxId?: string;
};

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

type GlobalSandboxPoolEntry = {
  backendPromise: Promise<DockerSandboxBackend>;
  executionTail: Promise<void>;
};

function parseDockerImageType(value: string | undefined): DockerImageType | undefined {
  const imageType = value?.trim().toLowerCase();
  if (!imageType) return undefined;
  if (imageType === 'node' || imageType === 'python' || imageType === 'combined') {
    return imageType;
  }
  throw new Error('SANDBOX_DOCKER_IMAGE_TYPE 仅支持 node、python 或 combined。');
}

function resolveDockerImage(imageType: DockerImageType | undefined, image: string | undefined): string {
  if (image?.trim()) return image.trim();
  if (imageType) return DOCKER_IMAGES_BY_TYPE[imageType];
  return DEFAULT_DOCKER_IMAGE;
}

/**
 * 仅使用本地 Docker CLI 的全局共享沙箱。
 *
 * 所有任务复用同一个容器，并通过租约队列串行读写，避免不同任务互相覆盖容器内文件。
 */
export class DockerSandboxBackend extends BaseSandbox {
  readonly id: string;

  /** 主进程内唯一的本地 Docker 沙箱实例。 */
  private static globalSandboxEntry: GlobalSandboxPoolEntry | undefined;
  /** 正在关闭的全局沙箱，避免关闭和重新获取交错。 */
  private static pendingGlobalSandboxClose: Promise<void> | undefined;

  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly maxTransferBytes: number;
  private readonly dockerImage: string;
  private readonly containerName: string;
  private readonly containerWorkdir = DOCKER_SANDBOX_WORKDIR;
  private readonly executor: CommandExecutor;

  private containerId?: string;
  private containerReadyPromise?: Promise<void>;
  private closed = false;

  constructor(options: DockerSandboxBackendOptions = {}) {
    super();

    // 超时为 0 时不限制本地 Docker CLI 命令执行时间。
    this.timeoutMs = validateNonNegativeNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxOutputBytes = validatePositiveNumber(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
    this.maxTransferBytes = validatePositiveNumber(options.maxTransferBytes ?? DEFAULT_MAX_TRANSFER_BYTES, 'maxTransferBytes');
    this.dockerImage = resolveDockerImage(options.dockerImageType, options.dockerImage);
    this.id = options.sandboxId ?? 'global-' + randomUUID();
    this.containerName = this.id === GLOBAL_SANDBOX_ID
      ? GLOBAL_CONTAINER_NAME
      : 'culclaw-sandbox-' + randomUUID();
    this.executor = new LocalCommandExecutor({
      id: this.id,
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
    });
  }

  /** 获取全局沙箱的独占租约，所有任务按开始顺序串行进入容器。 */
  static async acquireGlobalSandbox() {
    await DockerSandboxBackend.pendingGlobalSandboxClose?.catch(() => undefined);

    const entry = DockerSandboxBackend.getOrCreateGlobalSandboxEntry();
    const previousExecution = entry.executionTail;
    let releaseExecution: (() => void) | undefined;
    const executionDone = new Promise<void>(resolve => {
      releaseExecution = resolve;
    });
    const executionTail = previousExecution
      .catch(() => undefined)
      .then(() => executionDone);
    entry.executionTail = executionTail;

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

  /** 预热全局沙箱，确保调用方返回时容器已完成创建。 */
  static async prewarmGlobalSandbox(): Promise<void> {
    const lease = await DockerSandboxBackend.acquireGlobalSandbox();
    await lease.release();
  }

  /** 应用退出时等待运行中的租约结束，再停止唯一的本地 Docker 容器以供下次启动复用。 */
  static async closeGlobalSandbox(): Promise<void> {
    if (DockerSandboxBackend.pendingGlobalSandboxClose) {
      await DockerSandboxBackend.pendingGlobalSandboxClose;
      return;
    }

    const entry = DockerSandboxBackend.globalSandboxEntry;
    if (!entry) return;

    DockerSandboxBackend.globalSandboxEntry = undefined;
    let closePromise: Promise<void>;
    closePromise = DockerSandboxBackend.closeGlobalSandboxEntry(entry).finally(() => {
      if (DockerSandboxBackend.pendingGlobalSandboxClose === closePromise) {
        DockerSandboxBackend.pendingGlobalSandboxClose = undefined;
      }
    });
    DockerSandboxBackend.pendingGlobalSandboxClose = closePromise;
    await closePromise;
  }

  /** 从 culclaw.ini 或环境变量读取本地 Docker 配置。 */
  static async fromEnvironment(
    iniPath?: string,
    environment: Record<string, string | undefined> = process.env,
    options: Pick<DockerSandboxBackendOptions, 'sandboxId'> = {},
  ): Promise<DockerSandboxBackend> {
    const iniConfig = await readSandboxIni(iniPath);
    const getConf = (key: string): string | undefined => environment[key]?.trim() || iniConfig[key]?.trim();

    return new DockerSandboxBackend({
      timeoutMs: parseNonNegativeEnvironmentNumber(
        getConf('SANDBOX_DOCKER_TIMEOUT_MS') ?? getConf('SANDBOX_TIMEOUT_MS'),
        DEFAULT_TIMEOUT_MS,
        'SANDBOX_DOCKER_TIMEOUT_MS',
      ),
      maxOutputBytes: parseEnvironmentNumber(
        getConf('SANDBOX_DOCKER_MAX_OUTPUT_BYTES') ?? getConf('SANDBOX_MAX_OUTPUT_BYTES'),
        DEFAULT_MAX_OUTPUT_BYTES,
        'SANDBOX_DOCKER_MAX_OUTPUT_BYTES',
      ),
      maxTransferBytes: parseEnvironmentNumber(
        getConf('SANDBOX_DOCKER_MAX_TRANSFER_BYTES') ?? getConf('SANDBOX_MAX_TRANSFER_BYTES'),
        DEFAULT_MAX_TRANSFER_BYTES,
        'SANDBOX_DOCKER_MAX_TRANSFER_BYTES',
      ),
      dockerImage: getConf('SANDBOX_DOCKER_IMAGE') || undefined,
      dockerImageType: parseDockerImageType(getConf('SANDBOX_DOCKER_IMAGE_TYPE')),
      sandboxId: options.sandboxId,
    });
  }

  /** 立即创建容器，用于启动预热。 */
  async start(): Promise<void> {
    await this.ensureContainer();
  }

  /** 每轮任务上传前清空工作目录，保留容器及其已安装运行环境。 */
  async resetWorkspace(): Promise<void> {
    await this.ensureContainer();
    const result = await this.runDocker(
      this.buildDockerExecArgs('find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'),
    );
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, '重置 Docker 工作目录'));
    }
  }

  /** 在本地 Docker 容器内执行命令。 */
  async execute(command: string): Promise<ExecuteResponse> {
    await this.ensureContainer();
    const result = await this.runDocker(this.buildDockerExecArgs(command));
    const output = result.stdout && result.stderr
      ? result.stdout + '\n' + result.stderr
      : result.stdout || result.stderr;

    return {
      output,
      exitCode: result.exitCode,
      truncated: result.truncated,
    };
  }

  /**
   * 批量上传文件到容器工作区。
   *
   * 调用方使用虚拟工作区路径（如 /report.md）；本方法统一映射为
   * Docker 真实路径（如 /workspace/report.md），避免误写到容器根目录。
   */
  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    if (files.length === 0) return [];

    const responses = new Array<FileUploadResponse>(files.length);
    const candidates: UploadCandidate[] = [];

    files.forEach(([filePath, content], index) => {
      const containerPath = this.toContainerWorkspacePath(filePath);
      if (!containerPath) {
        responses[index] = { path: filePath, error: 'invalid_path' };
        return;
      }

      candidates.push({
        index,
        path: filePath,
        encodedPath: encodeBase64(containerPath),
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
          await writeChunk(stdin, candidate.encodedPath + '|' + encodedContent + '\n');
        }
      },
      this.maxTransferBytes,
    );

    this.assertTransferSucceeded(result, '上传文件');
    this.applyUploadResults(result.stdout, candidates, responses);
    return responses;
  }

  /** 批量下载容器工作区文件，单个文件失败不会中断其他文件。 */
  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    if (paths.length === 0) return [];

    const responses = new Array<FileDownloadResponse>(paths.length);
    const candidates: DownloadCandidate[] = [];

    paths.forEach((filePath, index) => {
      const containerPath = this.toContainerWorkspacePath(filePath);
      if (!containerPath) {
        responses[index] = { path: filePath, content: null, error: 'invalid_path' };
        return;
      }

      candidates.push({
        index,
        path: filePath,
        encodedPath: encodeBase64(containerPath),
      });
    });

    if (candidates.length === 0) return responses;

    await this.ensureContainer();
    const result = await this.runDocker(
      this.buildDockerExecArgs(this.createDownloadScript(), true),
      async stdin => {
        for (const candidate of candidates) {
          await writeChunk(stdin, candidate.encodedPath + '\n');
        }
      },
      this.maxTransferBytes,
    );

    this.assertTransferSucceeded(result, '下载文件');
    this.applyDownloadResults(result.stdout, candidates, responses);
    return responses;
  }

  /**
   * 下载容器工作目录中的全部可导出产物。
   *
   * 返回值保留 /workspace/... 真实路径，便于调用方展示 Docker 中的文件位置；
   * 写回宿主机时由上层再转换为相对工作区路径。
   */
  async downloadWorkspaceFiles(): Promise<FileDownloadResponse[]> {
    await this.ensureContainer();

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
      .filter(filePath => isAllowedArtifactFile(filePath))
      .map(filePath => this.containerWorkdir + '/' + filePath);

    const downloaded: FileDownloadResponse[] = [];
    let totalDownloadedBytes = 0;
    for (const containerPath of containerPaths) {
      try {
        const [downloadedFile] = await this.downloadFiles([containerPath]);
        if (!downloadedFile) {
          downloaded.push({ path: containerPath, content: null, error: 'invalid_path' });
          continue;
        }

        if (downloadedFile.content) {
          const transferBytes = Buffer.byteLength(
            'OK|' + encodeBase64(containerPath) + '|' + Buffer.from(downloadedFile.content).toString('base64') + '\n',
          );
          if (totalDownloadedBytes + transferBytes > this.maxTransferBytes) {
            downloaded.push({ path: containerPath, content: null, error: 'invalid_path' });
            continue;
          }
          totalDownloadedBytes += transferBytes;
        }

        downloaded.push(downloadedFile);
      } catch {
        downloaded.push({
          path: containerPath,
          content: null,
          error: 'invalid_path',
        });
      }
    }

    return downloaded;
  }

  /** 关闭本地 Docker 容器；全局容器只停止，以便下次应用启动复用。 */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.containerReadyPromise?.catch(() => undefined);
      if (this.containerId) {
        const shouldReuseContainer = this.id === GLOBAL_SANDBOX_ID;
        const result = await this.runDocker(
          shouldReuseContainer ? ['stop', this.containerId] : ['rm', '-f', this.containerId],
          undefined,
          this.maxOutputBytes,
          true,
        );
        if (result.exitCode !== 0) {
          throw new Error(this.formatCommandFailure(result, shouldReuseContainer ? '停止 Docker 容器' : '清理 Docker 容器'));
        }
      }
    } catch (error) {
      console.warn('[DockerSandbox] 清理本地 Docker 沙箱失败:', error);
    } finally {
      await this.executor.close();
    }
  }

  private static getOrCreateGlobalSandboxEntry(): GlobalSandboxPoolEntry {
    const existing = DockerSandboxBackend.globalSandboxEntry;
    if (existing) return existing;

    const backendPromise = DockerSandboxBackend.createGlobalSandbox();
    const entry: GlobalSandboxPoolEntry = {
      backendPromise,
      executionTail: Promise.resolve(),
    };
    DockerSandboxBackend.globalSandboxEntry = entry;

    void backendPromise.catch(() => {
      if (DockerSandboxBackend.globalSandboxEntry === entry) {
        DockerSandboxBackend.globalSandboxEntry = undefined;
      }
    });
    return entry;
  }

  private static async createGlobalSandbox(): Promise<DockerSandboxBackend> {
    const backend = await DockerSandboxBackend.fromEnvironment(undefined, process.env, {
      sandboxId: GLOBAL_SANDBOX_ID,
    });

    try {
      await backend.start();
      console.debug('[DockerSandbox] 全局本地 Docker 沙箱已预热');
      return backend;
    } catch (error) {
      await backend.close();
      throw error;
    }
  }

  private static async closeGlobalSandboxEntry(entry: GlobalSandboxPoolEntry): Promise<void> {
    await entry.executionTail.catch(() => undefined);
    const backend = await entry.backendPromise.catch(() => undefined);
    await backend?.close();
  }

  private async ensureContainer(): Promise<void> {
    if (this.closed) {
      throw new Error('Docker 沙箱 ' + this.id + ' 已关闭。');
    }

    if (!this.containerReadyPromise) {
      this.containerReadyPromise = this.createContainer();
    }
    await this.containerReadyPromise;
  }

  /**
   * 将虚拟工作区路径映射为容器真实路径。
   * 同时允许已规范的 /workspace/... 路径，方便下载结果被后续调用复用。
   */
  private toContainerWorkspacePath(filePath: string): string | null {
    if (!isSandboxPath(filePath) || filePath.startsWith('//') || filePath.includes('\\')) {
      return null;
    }

    const segments = filePath.split('/');
    if (segments.some(segment => segment === '..')) {
      return null;
    }

    const normalizedPath = path.posix.normalize(filePath);
    if (normalizedPath === '/' || normalizedPath === '.') {
      return null;
    }

    const containerPath = normalizedPath === this.containerWorkdir || normalizedPath.startsWith(`${this.containerWorkdir}/`)
      ? normalizedPath
      : path.posix.join(this.containerWorkdir, normalizedPath.slice(1));
    const relativePath = path.posix.relative(this.containerWorkdir, containerPath);
    if (!relativePath || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
      return null;
    }

    return containerPath;
  }

  private async createContainer(): Promise<void> {
    const runningContainerId = await this.findContainerId(false);
    if (runningContainerId) {
      await this.assertReusableGlobalContainer(runningContainerId);
      this.containerId = runningContainerId;
      return;
    }

    const stoppedContainerId = await this.findContainerId(true);
    if (stoppedContainerId) {
      await this.assertReusableGlobalContainer(stoppedContainerId);
      const startResult = await this.runDocker(['start', stoppedContainerId]);
      if (startResult.exitCode !== 0) {
        throw new Error(this.formatCommandFailure(startResult, '启动 Docker 容器'));
      }
      this.containerId = stoppedContainerId;
      return;
    }

    const command = [
      'run',
      '-d',
      '--name',
      this.containerName,
      '--label',
      'culclaw.sandbox.id=' + this.id,
      this.dockerImage,
      'sh',
      '-lc',
      'mkdir -p ' + shellQuote(this.containerWorkdir) + ' && while :; do sleep 3600; done',
    ];

    const result = await this.runDocker(command);
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, '创建 Docker 容器'));
    }

    const containerId = result.stdout.trim().split(/\s+/)[0];
    if (!containerId) {
      throw new Error('创建 Docker 容器成功但未返回容器 ID。');
    }
    this.containerId = containerId;
  }

  /** 固定容器名仅允许复用由全局 Docker 沙箱创建的容器，避免接管同名外部容器。 */
  private async assertReusableGlobalContainer(containerId: string): Promise<void> {
    if (this.id !== GLOBAL_SANDBOX_ID) return;

    const result = await this.runDocker([
      'inspect',
      '--format',
      '{{ index .Config.Labels "culclaw.sandbox.id" }}',
      containerId,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, '校验固定 Docker 容器标签'));
    }

    if (result.stdout.trim() !== GLOBAL_SANDBOX_ID) {
      throw new Error(
        '固定 Docker 容器 ' + this.containerName
        + ' 的 culclaw.sandbox.id 标签不是 global，拒绝复用、启动或停止该容器。',
      );
    }
  }

  /** 按固定容器名查询容器，避免仅凭历史容器 ID 产生重复容器。 */
  private async findContainerId(includeStopped: boolean): Promise<string | undefined> {
    const result = await this.runDocker([
      'ps',
      includeStopped ? '-aq' : '-q',
      '--filter',
      'name=^/' + this.containerName + '$',
    ]);
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, '查询 Docker 容器'));
    }

    const containerId = result.stdout.trim().split(/\s+/)[0];
    return containerId || undefined;
  }

  private runDocker(
    args: string[],
    input?: InputWriter,
    maxOutputBytes = this.maxOutputBytes,
    allowClosed = false,
  ): Promise<CommandResult> {
    return this.executor.runDocker(args, input, maxOutputBytes, allowClosed);
  }

  private buildDockerExecArgs(command: string, interactive = false): string[] {
    if (!this.containerId) {
      throw new Error('Docker 容器尚未创建。');
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

  private assertTransferSucceeded(result: CommandResult, operation: string): void {
    if (result.truncated) {
      throw new Error(operation + '响应超过 SANDBOX_DOCKER_MAX_TRANSFER_BYTES 限制。');
    }
    if (result.exitCode !== 0) {
      throw new Error(this.formatCommandFailure(result, operation));
    }
  }

  private formatCommandFailure(result: CommandResult, operation: string): string {
    const detail = (result.stderr || result.stdout).trim().slice(0, 500);
    let message = operation + '失败，Docker exit code ' + (result.exitCode ?? 'unknown');
    if (detail) {
      message += '：' + detail;
    }
    if (/failed to connect to the docker API|dockerDesktopLinuxEngine|daemon is not running/i.test(detail)) {
      message += '（提示：本机 Docker Desktop 或 Docker Daemon 未启动，请先打开 Docker 并确保 Engine 处于 Running 状态。）';
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
    throw new Error('输入流已关闭。');
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
      reject(new Error('输入流已关闭。'));
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
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function isSandboxPath(value: string): boolean {
  return value.startsWith('/') && !value.includes('\0');
}

function validatePositiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(name + ' 必须是大于 0 的数字。');
  }
  return value;
}

/** 本地 Docker 命令超时允许为 0，表示不设置超时。 */
function validateNonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(name + ' 必须是大于或等于 0 的数字。');
  }
  return value;
}

function parseEnvironmentNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(name + ' 必须是大于 0 的数字。');
  }
  return parsed;
}

/** 解析允许使用 0 关闭超时的 Docker 超时配置。 */
function parseNonNegativeEnvironmentNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(name + ' 必须是大于或等于 0 的数字。');
  }
  return parsed;
}
