import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  isAllowedArtifactFile,
  DockerSandboxBackend,
  resolveContainerWorkspacePath,
  resolveDockerWorkspaceDirectoryName,
} from './docker-sandbox-backend.js';

test('artifact export excludes dependencies and package manager files', () => {
  assert.equal(isAllowedArtifactFile('node_modules/example/package.json'), false);
  assert.equal(isAllowedArtifactFile('nested/node_modules/example/report.pdf'), false);
  assert.equal(isAllowedArtifactFile('package.json'), false);
  assert.equal(isAllowedArtifactFile('package-lock.json'), false);
  assert.equal(isAllowedArtifactFile('pnpm-lock.yaml'), false);
  assert.equal(isAllowedArtifactFile('deliverables/report.pdf'), true);
  assert.equal(isAllowedArtifactFile('deliverables/data.json'), true);
  assert.equal(isAllowedArtifactFile('src/main.ts'), true);
  assert.equal(isAllowedArtifactFile('scripts/setup.js'), true);
  assert.equal(isAllowedArtifactFile('tools/generate.py'), true);
  assert.equal(isAllowedArtifactFile('styles/app.css'), true);
  assert.equal(isAllowedArtifactFile('config/agent.yaml'), true);
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

test('virtual workspace paths resolve inside the Docker workspace', () => {
  const backend = new DockerSandboxBackend();
  const backendState = backend as any;

  assert.equal(
    backendState.toContainerWorkspacePath('/孙悟空大闹天宫剧本.md'),
    '/workspace/孙悟空大闹天宫剧本.md',
  );
  assert.equal(
    backendState.toContainerWorkspacePath('/workspace/孙悟空大闹天宫剧本.md'),
    '/workspace/孙悟空大闹天宫剧本.md',
  );
  assert.equal(backendState.toContainerWorkspacePath('/../escape.md'), null);
  assert.equal(backendState.toContainerWorkspacePath('//escape.md'), null);
});

test('每个工作区使用与名称一致的 Docker 文件夹', () => {
  const backend = new DockerSandboxBackend({ workspaceName: '武松打虎剧本' });
  const backendState = backend as any;
  backendState.containerId = 'sandbox-container';

  assert.equal(resolveContainerWorkspacePath('武松打虎剧本'), '/workspace/武松打虎剧本');
  assert.equal(
    backendState.toContainerWorkspacePath('/剧本.md'),
    '/workspace/武松打虎剧本/剧本.md',
  );
  assert.deepEqual(backendState.buildDockerExecArgs('pwd'), [
    'exec',
    '-w',
    '/workspace/武松打虎剧本',
    'sandbox-container',
    'sh',
    '-lc',
    'pwd',
  ]);
  assert.throws(() => resolveContainerWorkspacePath('../other'));
});

test('同名物理工作区使用 workspace id 哈希生成不同 Docker 文件夹', () => {
  const firstDirectory = resolveDockerWorkspaceDirectoryName('同名剧本', 'workspace-first-id');
  const secondDirectory = resolveDockerWorkspaceDirectoryName('同名剧本', 'workspace-second-id');

  assert.match(firstDirectory, /^同名剧本--[a-f0-9]{10}$/);
  assert.match(secondDirectory, /^同名剧本--[a-f0-9]{10}$/);
  assert.notEqual(firstDirectory, secondDirectory);
  assert.equal(
    resolveContainerWorkspacePath('同名剧本', 'workspace-first-id'),
    `/workspace/${firstDirectory}`,
  );
});

test('工作区兼容旧 /workspace 路径并统一为虚拟路径', () => {
  const backend = new DockerSandboxBackend({
    workspaceName: '武松打虎剧本',
    workspaceId: 'workspace-path-normalization',
  });
  const backendState = backend as any;
  const workspaceRoot = backend.getContainerWorkspaceRoot();

  assert.equal(backend.normalizeWorkspaceVirtualPath('/workspace/剧本.md'), '/剧本.md');
  assert.equal(backend.normalizeWorkspaceVirtualPath('/剧本.md'), '/剧本.md');
  assert.equal(
    backendState.toContainerWorkspacePath('/workspace/剧本.md'),
    `${workspaceRoot}/剧本.md`,
  );
});

test('Shell 命令兼容旧工作区路径且允许工具使用临时绝对路径', () => {
  const backend = new DockerSandboxBackend({
    workspaceName: '武松打虎剧本',
    workspaceId: 'workspace-shell-boundary',
  });
  const backendState = backend as any;
  const workspaceRoot = backend.getContainerWorkspaceRoot();

  assert.doesNotThrow(() => backendState.normalizeShellCommand('printf ok > deliverables/result.md'));
  assert.doesNotThrow(() => backendState.normalizeShellCommand(`cat '${workspaceRoot}/input.md'`));
  assert.equal(
    backendState.normalizeShellCommand('cat /workspace/shared.md'),
    `cat ${workspaceRoot}/shared.md`,
  );
  assert.equal(
    backendState.normalizeShellCommand('printf temp > /tmp/shared.md'),
    'printf temp > /tmp/shared.md',
  );

  const spacedBackend = new DockerSandboxBackend({
    workspaceName: '带 空格的剧本',
    workspaceId: 'workspace-with-spaces',
  });
  const spacedBackendState = spacedBackend as any;
  assert.doesNotThrow(() => spacedBackendState.normalizeShellCommand(
    `cat '${spacedBackend.getContainerWorkspaceRoot()}/input file.md'`,
  ));
});

test('uploadFiles maps virtual paths to the Docker workspace before transfer', async () => {
  const backend = new DockerSandboxBackend();
  const backendState = backend as any;
  backendState.containerId = 'sandbox-container';
  const inputChunks: string[] = [];
  backendState.ensureContainer = async () => {};
  backendState.runDocker = async (_args: string[], writeInput?: (stream: any) => Promise<void>) => {
    await writeInput?.({
      destroyed: false,
      write(chunk: string) {
        inputChunks.push(chunk);
        return true;
      },
    });
    const encodedPath = inputChunks[0].split('|')[0];
    return { stdout: 'OK|' + encodedPath + '\n', stderr: '', exitCode: 0, truncated: false };
  };

  const response = await backend.uploadFiles([
    ['/孙悟空大闹天宫剧本.md', new Uint8Array(Buffer.from('剧本内容'))],
  ]);

  const [encodedPath] = inputChunks[0].split('|');
  assert.equal(Buffer.from(encodedPath, 'base64').toString(), '/workspace/孙悟空大闹天宫剧本.md');
  assert.deepEqual(response, [{ path: '/孙悟空大闹天宫剧本.md', error: null }]);
});

test('global sandbox reuses the fixed stopped container and only stops it on close', async () => {
  const backend = new DockerSandboxBackend({ sandboxId: 'global' });
  const backendState = backend as any;
  const dockerCalls: string[][] = [];
  const success = (stdout = '') => ({ stdout, stderr: '', exitCode: 0, truncated: false });

  backendState.executor = {
    async runDocker(args: string[]) {
      dockerCalls.push(args);
      if (args[0] === 'ps' && args[1] === '-q') return success();
      if (args[0] === 'ps' && args[1] === '-aq') return success('existing-container\n');
      if (args[0] === 'inspect') return success('global\n');
      if (args[0] === 'start' || args[0] === 'stop') return success('existing-container\n');
      throw new Error('unexpected Docker command: ' + args.join(' '));
    },
    async close() {},
  };

  await backend.start();
  await backend.close();

  assert.equal(backendState.containerName, 'culclaw-sandbox-global');
  assert.deepEqual(dockerCalls, [
    ['ps', '-q', '--filter', 'name=^/culclaw-sandbox-global$'],
    ['ps', '-aq', '--filter', 'name=^/culclaw-sandbox-global$'],
    ['inspect', '--format', '{{ index .Config.Labels "culclaw.sandbox.id" }}', 'existing-container'],
    ['start', 'existing-container'],
    ['stop', 'existing-container'],
  ]);
});

test('global sandbox refuses a same-named container without the global label', async () => {
  const backend = new DockerSandboxBackend({ sandboxId: 'global' });
  const backendState = backend as any;
  const dockerCalls: string[][] = [];
  const success = (stdout = '') => ({ stdout, stderr: '', exitCode: 0, truncated: false });

  backendState.executor = {
    async runDocker(args: string[]) {
      dockerCalls.push(args);
      if (args[0] === 'ps' && args[1] === '-q') return success('foreign-container\n');
      if (args[0] === 'inspect') return success('other-sandbox\n');
      throw new Error('unexpected Docker command: ' + args.join(' '));
    },
    async close() {},
  };

  await assert.rejects(backend.start(), /culclaw\.sandbox\.id 标签不是 global/);
  await backend.close();

  assert.deepEqual(dockerCalls, [
    ['ps', '-q', '--filter', 'name=^/culclaw-sandbox-global$'],
    ['inspect', '--format', '{{ index .Config.Labels "culclaw.sandbox.id" }}', 'foreign-container'],
  ]);
});

test('resetWorkspace clears only the container workspace contents', async () => {
  const backend = new DockerSandboxBackend({ sandboxId: 'global' });
  const backendState = backend as any;
  const dockerCalls: string[][] = [];
  backendState.containerId = 'sandbox-container';
  backendState.containerReadyPromise = Promise.resolve();
  backendState.executor = {
    async runDocker(args: string[]) {
      dockerCalls.push(args);
      return { stdout: '', stderr: '', exitCode: 0, truncated: false };
    },
    async close() {},
  };

  await backend.resetWorkspace();

  assert.deepEqual(dockerCalls, [[
    'exec',
    '-w',
    '/workspace',
    'sandbox-container',
    'sh',
    '-lc',
    'find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
  ]]);
});

test('removeWorkspaceDirectory removes only the selected Docker workspace directory', async () => {
  const backend = new DockerSandboxBackend({ workspaceName: 'retained-local-workspace' });
  const backendState = backend as any;
  const dockerCalls: string[][] = [];
  backendState.containerId = 'sandbox-container';
  backendState.containerReadyPromise = Promise.resolve();
  backendState.executor = {
    async runDocker(args: string[]) {
      dockerCalls.push(args);
      return { stdout: '', stderr: '', exitCode: 0, truncated: false };
    },
    async close() {},
  };

  await backend.removeWorkspaceDirectory();

  assert.deepEqual(dockerCalls, [[
    'exec',
    '-w',
    '/workspace',
    'sandbox-container',
    'sh',
    '-lc',
    "rm -rf -- '/workspace/retained-local-workspace'",
  ]]);
});

test('downloadWorkspaceFiles returns Docker workspace paths and continues after an individual transfer failure', async () => {
  const backend = new DockerSandboxBackend({ sandboxId: 'global' });
  const backendState = backend as any;
  const downloadPath = (filePath: string) => Buffer.from(filePath).toString('base64');
  const downloadContent = (content: string) => Buffer.from(content).toString('base64');
  let downloadAttempts = 0;
  backendState.containerId = 'sandbox-container';
  backendState.containerReadyPromise = Promise.resolve();
  backendState.executor = {
    async runDocker(args: string[]) {
      const command = args.at(-1);
      if (command === 'find . -type f -print0') {
        return {
          stdout: './deliverables/ok.txt\0./deliverables/too-large.bin\0./src/result.ts\0',
          stderr: '',
          exitCode: 0,
          truncated: false,
        };
      }

      downloadAttempts += 1;
      if (downloadAttempts === 2) {
        return { stdout: '', stderr: 'transfer limit', exitCode: 0, truncated: true };
      }

      const filePath = downloadAttempts === 1
        ? '/workspace/deliverables/ok.txt'
        : '/workspace/src/result.ts';
      const content = downloadAttempts === 1 ? 'ok' : 'export const result = true';
      return {
        stdout: 'OK|' + downloadPath(filePath) + '|' + downloadContent(content) + '\n',
        stderr: '',
        exitCode: 0,
        truncated: false,
      };
    },
    async close() {},
  };

  const files = await backend.downloadWorkspaceFiles();

  assert.equal(downloadAttempts, 3);
  assert.deepEqual(files[0], {
    path: '/workspace/deliverables/ok.txt',
    content: new Uint8Array(Buffer.from('ok')),
    error: null,
  });
  assert.deepEqual(files[1], {
    path: '/workspace/deliverables/too-large.bin',
    content: null,
    error: 'invalid_path',
  });
  assert.deepEqual(files[2], {
    path: '/workspace/src/result.ts',
    content: new Uint8Array(Buffer.from('export const result = true')),
    error: null,
  });
});

test('downloadWorkspaceFiles retains the total transfer limit across individual files', async () => {
  const backend = new DockerSandboxBackend({ sandboxId: 'global', maxTransferBytes: 120 });
  const backendState = backend as any;
  const content = 'a'.repeat(50);
  let downloadAttempts = 0;
  backendState.containerId = 'sandbox-container';
  backendState.containerReadyPromise = Promise.resolve();
  backendState.executor = {
    async runDocker(args: string[]) {
      const command = args.at(-1);
      if (command === 'find . -type f -print0') {
        return { stdout: './one.txt\0./two.txt\0', stderr: '', exitCode: 0, truncated: false };
      }

      downloadAttempts += 1;
      const filePath = '/workspace/' + (downloadAttempts === 1 ? 'one.txt' : 'two.txt');
      return {
        stdout: 'OK|' + Buffer.from(filePath).toString('base64') + '|' + Buffer.from(content).toString('base64') + '\n',
        stderr: '',
        exitCode: 0,
        truncated: false,
      };
    },
    async close() {},
  };

  const files = await backend.downloadWorkspaceFiles();

  assert.equal(downloadAttempts, 2);
  assert.equal(files[0].error, null);
  assert.equal(files[1].path, '/workspace/two.txt');
  assert.equal(files[1].content, null);
  assert.equal(files[1].error, 'invalid_path');
});

test('fromEnvironment uses local docker configuration only', async () => {
  const backend = await DockerSandboxBackend.fromEnvironment(undefined, {
    SANDBOX_DOCKER_IMAGE_TYPE: 'node',
    SANDBOX_DOCKER_IMAGE: 'custom-mirror/node:22-slim',
    SANDBOX_DOCKER_TIMEOUT_MS: '0',
  });

  assert.equal((backend as any).dockerImage, 'custom-mirror/node:22-slim');
  assert.equal((backend as any).timeoutMs, 0);
  await backend.close();
});

test('global sandbox leases share one backend and execute serially', async () => {
  const backendClass = DockerSandboxBackend as any;
  const originalFromEnvironment = backendClass.fromEnvironment;
  backendClass.globalSandboxEntry = undefined;
  backendClass.pendingGlobalSandboxClose = undefined;

  let starts = 0;
  let closes = 0;
  const selectedWorkspaces: string[] = [];
  const backend = {
    async start() {
      starts += 1;
    },
    async close() {
      closes += 1;
    },
    async useWorkspace(workspaceName: string) {
      selectedWorkspaces.push(workspaceName);
    },
  };

  backendClass.fromEnvironment = async () => backend;
  try {
    const firstLease = await DockerSandboxBackend.acquireGlobalSandbox('武松打虎剧本');
    const secondLeasePromise = DockerSandboxBackend.acquireGlobalSandbox('鲁智深倒拔垂杨柳');
    await Promise.resolve();

    assert.equal(starts, 1);
    assert.deepEqual(selectedWorkspaces, ['武松打虎剧本']);
    await firstLease.release();

    const secondLease = await secondLeasePromise;
    assert.equal(secondLease.backend, backend);
    assert.deepEqual(selectedWorkspaces, ['武松打虎剧本', '鲁智深倒拔垂杨柳']);
    await secondLease.release();

    await DockerSandboxBackend.closeGlobalSandbox();
    assert.equal(closes, 1);
  } finally {
    backendClass.fromEnvironment = originalFromEnvironment;
    backendClass.globalSandboxEntry = undefined;
    backendClass.pendingGlobalSandboxClose = undefined;
  }
});
