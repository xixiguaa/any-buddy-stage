import type { Writable } from 'node:stream';

export type SshCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

export type SshInputWriter = (stdin: Writable) => Promise<void>;

export interface CommandExecutor {
  /**
   * 执行 Docker 命令
   */
  runDocker(
    args: string[],
    input?: SshInputWriter,
    maxOutputBytes?: number,
    allowClosed?: boolean,
  ): Promise<SshCommandResult>;

  /**
   * 关闭底层连接或资源
   */
  close(): Promise<void>;
}
