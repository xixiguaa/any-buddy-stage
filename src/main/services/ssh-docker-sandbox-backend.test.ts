import test from 'node:test';
import assert from 'node:assert/strict';
import { SshDockerSandboxBackend } from './ssh-docker-sandbox-backend.js';

test('releaseWorkspaceSandbox cleans remote containers when the local pool is empty', async () => {
  const backendClass = SshDockerSandboxBackend as any;
  const originalFromEnvironment = backendClass.fromEnvironment;
  const commands: string[] = [];
  let closeCount = 0;

  backendClass.fromEnvironment = async () => ({
    dockerCommand: 'docker',
    async runSsh(command: string) {
      commands.push(command);
      return commands.length === 1
        ? {
            stdout: 'abcdef012345\n012345abcdef\nnot-a-container-id\n',
            stderr: '',
            exitCode: 0,
            truncated: false,
          }
        : { stdout: '', stderr: '', exitCode: 0, truncated: false };
    },
    formatCommandFailure: () => 'command failed',
    async close() {
      closeCount += 1;
    },
  });

  try {
    await SshDockerSandboxBackend.releaseWorkspaceSandbox('workspace-a');
  } finally {
    backendClass.fromEnvironment = originalFromEnvironment;
  }

  assert.deepEqual(commands, [
    "docker ps -aq --filter 'label=culclaw.sandbox.id=workspace-workspace-a'",
    "docker rm -f 'abcdef012345' '012345abcdef'",
  ]);
  assert.equal(closeCount, 1);
});
