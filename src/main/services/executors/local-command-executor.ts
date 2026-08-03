import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import type { CommandExecutor, SshCommandResult, SshInputWriter } from './command-executor.js';

export type LocalCommandExecutorOptions = {
  id: string;
  dockerCommand?: string;
  timeoutMs: number;
  maxOutputBytes: number;
};

export class LocalCommandExecutor implements CommandExecutor {
  private readonly id: string;
  private readonly dockerCommand: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private closed = false;

  constructor(options: LocalCommandExecutorOptions) {
    this.id = options.id;
    this.dockerCommand = options.dockerCommand || 'docker';
    this.timeoutMs = options.timeoutMs;
    this.maxOutputBytes = options.maxOutputBytes;
  }

  async runDocker(
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
        child.stdin?.end();
      })().catch(rejectOnce);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
