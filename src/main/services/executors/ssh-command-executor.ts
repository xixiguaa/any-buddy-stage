import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { CommandExecutor, SshCommandResult, SshInputWriter } from './command-executor.js';

export type SshCommandExecutorOptions = {
  id: string;
  host: string;
  username?: string;
  port: number;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  hostFingerprint?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  dockerCommand?: string;
};

export class SshCommandExecutor implements CommandExecutor {
  private readonly id: string;
  private readonly host: string;
  private readonly username?: string;
  private readonly port: number;
  private readonly privateKeyPath?: string;
  private readonly password?: string;
  private readonly passphrase?: string;
  private readonly hostFingerprint?: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly dockerCommand: string;

  private connection?: Client;
  private connectionReadyPromise?: Promise<Client>;
  private closed = false;

  constructor(options: SshCommandExecutorOptions) {
    this.id = options.id;
    this.host = options.host;
    this.username = options.username;
    this.port = options.port;
    this.privateKeyPath = options.privateKeyPath;
    this.password = options.password;
    this.passphrase = options.passphrase;
    this.hostFingerprint = options.hostFingerprint;
    this.timeoutMs = options.timeoutMs;
    this.maxOutputBytes = options.maxOutputBytes;
    this.dockerCommand = options.dockerCommand || 'docker';
  }

  async runDocker(
    args: string[],
    input?: SshInputWriter,
    maxOutputBytes = this.maxOutputBytes,
    allowClosed = false,
  ): Promise<SshCommandResult> {
    return this.runSsh(
      [this.dockerCommand, ...args.map(shellQuote)].join(' '),
      input,
      maxOutputBytes,
      allowClosed,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const connection = this.connection;
    this.connection = undefined;
    this.connectionReadyPromise = undefined;
    connection?.end();
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

  private invalidateConnection(connection: Client): void {
    if (this.connection === connection) {
      this.connection = undefined;
      this.connectionReadyPromise = undefined;
    }
    connection.destroy();
  }
}

function shellQuote(value: string): string {
  if (value.includes('\0')) {
    throw new Error('Shell 参数不能包含 NUL 字符。');
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
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
