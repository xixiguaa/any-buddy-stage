import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedArtifactFile, SshDockerSandboxBackend } from './ssh-docker-sandbox-backend.js';

test('artifact export excludes dependencies and package manager files', () => {
  assert.equal(isAllowedArtifactFile('node_modules/example/package.json'), false);
  assert.equal(isAllowedArtifactFile('nested/node_modules/example/report.pdf'), false);
  assert.equal(isAllowedArtifactFile('package.json'), false);
  assert.equal(isAllowedArtifactFile('package-lock.json'), false);
  assert.equal(isAllowedArtifactFile('pnpm-lock.yaml'), false);
  assert.equal(isAllowedArtifactFile('yarn.lock'), false);
  assert.equal(isAllowedArtifactFile('deliverables/report.pdf'), true);
  assert.equal(isAllowedArtifactFile('deliverables/data.json'), true);
});

test('releaseWorkspaceSandbox cleans remote containers when the local pool is empty', async () => {
  const backendClass = SshDockerSandboxBackend as any;
  const originalFromEnvironment = backendClass.fromEnvironment;
  const commands: string[][] = [];
  let closeCount = 0;

  backendClass.fromEnvironment = async () => ({
    async runDocker(args: string[]) {
      commands.push(args);
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
    ['ps', '-aq', '--filter', 'label=culclaw.sandbox.id=workspace-workspace-a'],
    ['rm', '-f', 'abcdef012345', '012345abcdef'],
  ]);
  assert.equal(closeCount, 1);
});

test('local docker passes the upload script as one Docker argument', () => {
  const backend = new SshDockerSandboxBackend({ mode: 'local' });
  const backendState = backend as any;
  backendState.containerId = 'sandbox-container';
  const script = 'while IFS="|" read -r encodedPath encodedContent; do echo "$encodedPath"; done';

  assert.deepEqual(backendState.buildDockerExecArgs(script, true), [
    'exec',
    '-i',
    '-w',
    '/workspace',
    'sandbox-container',
    'sh',
    '-lc',
    script,
  ]);
});

test('fromEnvironment resolves local docker mode by default when no SSH host is configured', async () => {
  const backend = await SshDockerSandboxBackend.fromEnvironment(undefined, {
    SANDBOX_TYPE: 'local',
  });
  assert.equal(backend.mode, 'local');
  await backend.close();
});

test('fromEnvironment resolves ssh docker mode when SSH host is provided', async () => {
  const backend = await SshDockerSandboxBackend.fromEnvironment(undefined, {
    SANDBOX_TYPE: 'ssh',
    SANDBOX_SSH_HOST: '127.0.0.1',
    SANDBOX_SSH_PASSWORD: 'test-password',
  });
  assert.equal(backend.mode, 'ssh');
  await backend.close();
});

test('fromEnvironment prioritizes explicit SANDBOX_DOCKER_IMAGE over SANDBOX_DOCKER_IMAGE_TYPE', async () => {
  const backend = await SshDockerSandboxBackend.fromEnvironment(undefined, {
    SANDBOX_TYPE: 'local',
    SANDBOX_DOCKER_IMAGE_TYPE: 'node',
    SANDBOX_DOCKER_IMAGE: 'custom-mirror/node:22-slim',
  });
  assert.equal((backend as any).dockerImage, 'custom-mirror/node:22-slim');
  await backend.close();
});
