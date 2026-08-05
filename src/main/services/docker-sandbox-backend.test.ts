import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedArtifactFile, DockerSandboxBackend } from './docker-sandbox-backend.js';

test('artifact export excludes dependencies and package manager files', () => {
  assert.equal(isAllowedArtifactFile('node_modules/example/package.json'), false);
  assert.equal(isAllowedArtifactFile('nested/node_modules/example/report.pdf'), false);
  assert.equal(isAllowedArtifactFile('package.json'), false);
  assert.equal(isAllowedArtifactFile('package-lock.json'), false);
  assert.equal(isAllowedArtifactFile('pnpm-lock.yaml'), false);
  assert.equal(isAllowedArtifactFile('deliverables/report.pdf'), true);
  assert.equal(isAllowedArtifactFile('deliverables/data.json'), true);
});

test('local docker passes the upload script as one Docker argument', () => {
  const backend = new DockerSandboxBackend();
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

test('fromEnvironment uses local docker configuration only', async () => {
  const backend = await DockerSandboxBackend.fromEnvironment(undefined, {
    SANDBOX_DOCKER_IMAGE_TYPE: 'node',
    SANDBOX_DOCKER_IMAGE: 'custom-mirror/node:22-slim',
  });

  assert.equal((backend as any).dockerImage, 'custom-mirror/node:22-slim');
  await backend.close();
});

test('global sandbox leases share one backend and execute serially', async () => {
  const backendClass = DockerSandboxBackend as any;
  const originalFromEnvironment = backendClass.fromEnvironment;
  backendClass.globalSandboxEntry = undefined;
  backendClass.pendingGlobalSandboxClose = undefined;

  let starts = 0;
  let closes = 0;
  const backend = {
    async start() {
      starts += 1;
    },
    async close() {
      closes += 1;
    },
  };

  backendClass.fromEnvironment = async () => backend;
  try {
    const firstLease = await DockerSandboxBackend.acquireGlobalSandbox();
    const secondLeasePromise = DockerSandboxBackend.acquireGlobalSandbox();
    await Promise.resolve();

    assert.equal(starts, 1);
    await firstLease.release();

    const secondLease = await secondLeasePromise;
    assert.equal(secondLease.backend, backend);
    await secondLease.release();

    await DockerSandboxBackend.closeGlobalSandbox();
    assert.equal(closes, 1);
  } finally {
    backendClass.fromEnvironment = originalFromEnvironment;
    backendClass.globalSandboxEntry = undefined;
    backendClass.pendingGlobalSandboxClose = undefined;
  }
});

