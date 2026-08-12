import type { Writable } from 'node:stream';

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

export type InputWriter = (stdin: Writable) => Promise<void>;

export interface CommandExecutor {
  /**
   * 执行 Docker 命令
   */
  runDocker(
    args: string[],
    input?: InputWriter,
    maxOutputBytes?: number,
    allowClosed?: boolean,
    signal?: AbortSignal,
  ): Promise<CommandResult>;

  /**
   * 关闭底层连接或资源
   */
  close(): Promise<void>;
}
