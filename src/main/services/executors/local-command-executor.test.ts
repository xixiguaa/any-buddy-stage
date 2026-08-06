import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalCommandExecutor } from './local-command-executor.js';

test('timeoutMs 为 0 时不限制本地 Docker 命令执行时间', async () => {
  const executor = new LocalCommandExecutor({
    id: 'no-timeout-test',
    dockerCommand: process.execPath,
    timeoutMs: 0,
    maxOutputBytes: 1024,
  });

  const result = await executor.runDocker([
    '-e',
    'setTimeout(() => process.exit(0), 25)',
  ]);

  assert.equal(result.exitCode, 0);
  await executor.close();
});
