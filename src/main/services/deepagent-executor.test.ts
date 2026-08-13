import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  captureSandboxArtifactSnapshot,
  DeepAgentExecutor,
  describeSkillConfigurationIssue,
  exportSandboxOutputsToWorkspace,
  isSuccessfulVideoGenerationResult,
  normalizeSandboxOutputPaths,
  requiresVideoGeneration,
  stripThinkingContent,
} from './deepagent-executor.js';

test('video generation requires a selected video skill and an execution intent', () => {
  assert.equal(requiresVideoGeneration('帮我生成一个视频', ['jimeng-video']), true);
  assert.equal(requiresVideoGeneration('帮我分析这个视频', ['jimeng-video']), false);
  assert.equal(requiresVideoGeneration('帮我生成一个视频', []), false);
});

test('video generation evidence ignores preparation tools and accepts platform task ids', () => {
  assert.equal(isSuccessfulVideoGenerationResult('read_file', 'jimeng skill instructions'), false);
  assert.equal(isSuccessfulVideoGenerationResult('execute', 'HTTP 200\n{"id":"cgt-20260811143206-2xwjz"}'), true);
  assert.equal(isSuccessfulVideoGenerationResult('execute', '{"data":{"task_id":"vid-task-1234"}}'), true);
  assert.equal(isSuccessfulVideoGenerationResult('shell', 'Job ID: generation-20260811-0001'), true);
  assert.equal(isSuccessfulVideoGenerationResult('command', '{"result":{"videoUrl":"https://cdn.example.test/output.webm"}}'), true);
  assert.equal(isSuccessfulVideoGenerationResult('execute', '{"task_id":"abc"}'), false);
  assert.equal(isSuccessfulVideoGenerationResult('execute', 'HTTP 401\nUnauthorized'), false);
  assert.equal(isSuccessfulVideoGenerationResult('jimeng_video_generate', '{"status":"running"}'), true);
});

test('技能配置缺失或格式无效时返回可操作提示', () => {
  assert.equal(
    describeSkillConfigurationIssue('MINIMAX_API_KEY=NOT_SET'),
    '检测到技能缺少必要配置：MINIMAX_API_KEY。请按该技能 SKILL.md 的说明补充环境变量或凭证后，再重新发起任务。',
  );
  assert.match(
    describeSkillConfigurationIssue("Skill 'MiniMax Image Generation' in /SKILL.md does not follow Agent Skills specification: name must be lowercase") ?? '',
    /SKILL\.md 配置无效/,
  );
  assert.equal(describeSkillConfigurationIssue('任务已完成，生成 2 个文件。'), null);
});

test('技能缺少配置时正常结束运行，避免对话持续卡在执行中', async () => {
  const completedMessages: string[] = [];
  const appService = {
    listModelConfigs: () => [],
    getTaskContext: () => ({ messages: [] }),
    listTaskWorkspaces: () => [],
    completeRuntimeRun: async (_runId: string, content: string) => {
      completedMessages.push(content);
    },
  };
  const executor = new DeepAgentExecutor(appService as never, {
    modelService: {
      resolveModelConfig: () => ({
        apiKey: 'test-key',
        modelName: 'test-model',
        baseUrl: 'https://example.test',
      }),
    },
  } as never);
  (executor as any).createBackend = async () => ({
    backend: {},
    isSandbox: false,
    initialFiles: {},
    disposeBackend: false,
  });
  (executor as any).resolveSkillSources = async () => {
    throw new Error('MINIMAX_API_KEY=NOT_SET');
  };

  const handled = await executor.execute({
    context: {
      task: {
        id: 'task-1',
        modelId: 'model-1',
        skillIds: ['minimax-image-generation'],
        mode: 'ask',
      },
      run: { id: 'run-1' },
    } as never,
    signal: new AbortController().signal,
    systemPrompt: '',
    activeExpert: null,
    activeExpertTeam: null,
    tools: [],
    toolExecutionContext: {} as never,
    assistantMetadata: {},
  });

  assert.equal(handled, true);
  assert.deepEqual(completedMessages, [
    '检测到技能缺少必要配置：MINIMAX_API_KEY。请按该技能 SKILL.md 的说明补充环境变量或凭证后，再重新发起任务。',
  ]);
});

test('single artifact host write failure does not block later exports', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'culclaw-artifact-export-'));
  t.after(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });
  await writeFile(path.join(workspacePath, 'blocked-parent'), 'not a directory');
  await mkdir(path.join(workspacePath, 'write-fail'));

  const encode = (value: string) => new TextEncoder().encode(value);
  const backend = {
    async downloadWorkspaceFiles() {
      return [
        { path: '/workspace/blocked-parent/child.txt', content: encode('mkdir failure'), error: null },
        { path: '/workspace/write-fail', content: encode('write failure'), error: null },
        { path: '/workspace/record-fail.txt', content: encode('record failure'), error: null },
        { path: '/workspace/deliverables/after.txt', content: encode('exported'), error: null },
      ];
    },
  };
  const recordedArtifacts: string[] = [];
  const appService = {
    async recordTaskArtifact(_taskId: string, destPath: string) {
      if (destPath.endsWith('record-fail.txt')) {
        throw new Error('record failure');
      }
      recordedArtifacts.push(destPath);
    },
  };

  await exportSandboxOutputsToWorkspace(backend, workspacePath, {}, appService as any, 'task-1');

  assert.equal(await readFile(path.join(workspacePath, 'record-fail.txt'), 'utf8'), 'record failure');
  assert.equal(await readFile(path.join(workspacePath, 'deliverables', 'after.txt'), 'utf8'), 'exported');
  assert.deepEqual(recordedArtifacts, [path.join(workspacePath, 'deliverables', 'after.txt')]);
});

test('stripThinkingContent removes complete and incomplete think blocks', () => {
  assert.equal(
    stripThinkingContent('<think>先分析工具调用</think>这是给用户的回复。'),
    '这是给用户的回复。',
  );
  assert.equal(
    stripThinkingContent('<think>仍在分析'),
    '',
  );
});

test('stripThinkingContent hides split think tag prefixes during streaming', () => {
  assert.equal(stripThinkingContent('正文<th'), '正文');
  assert.equal(
    stripThinkingContent('正文<think>分析完成</think>结论'),
    '正文结论',
  );
});

test('stripThinkingContent handles multiline and attributed think blocks', () => {
  assert.equal(
    stripThinkingContent('<think>docx 包安装成功。现在我写一个 Node.js 脚本来生成 docx 文件。\n\n让我准备 GPT5.5 产品调研文档</think>\n\ndocx 包安装成功,现在编写生成脚本。'),
    'docx 包安装成功,现在编写生成脚本。',
  );
});

test('Docker 产物路径会映射为真实本地工作区路径', () => {
  const workspacePath = path.join(os.tmpdir(), 'culclaw-workspace', '2026-08-11 16-56-15');
  const localPath = path.join(path.resolve(workspacePath), 'deliverables', 'xxxx.md');

  assert.equal(
    normalizeSandboxOutputPaths(
      '产物已保存到 /workspace/2026-08-11-16-56-15--abc123/deliverables/xxxx.md',
      workspacePath,
      '/workspace/2026-08-11-16-56-15--abc123',
    ),
    `产物已保存到 ${localPath}`,
  );
  assert.equal(
    normalizeSandboxOutputPaths('旧路径：/workspace/deliverables/xxxx.md', workspacePath),
    `旧路径：${localPath}`,
  );
});

test('第二次改写同路径产物时，按容器执行前快照同步到主机工作区', async (t) => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'culclaw-artifact-sync-'));
  t.after(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  const encode = (value: string) => new TextEncoder().encode(value);
  const sandboxFiles = new Map<string, Uint8Array>([
    ['/workspace/孙悟空大闹天宫剧本.md', encode('第一版')],
  ]);
  const backend = {
    async downloadWorkspaceFiles() {
      return Array.from(sandboxFiles, ([filePath, content]) => ({
        path: filePath,
        content,
        error: null,
      }));
    },
  };

  // 首轮产物已存在于复用容器；第二轮改写后仍应回传到物理工作区。
  const beforeSecondRun = await captureSandboxArtifactSnapshot(backend, {});
  sandboxFiles.set('/workspace/孙悟空大闹天宫剧本.md', encode('第二版'));

  await exportSandboxOutputsToWorkspace(backend, workspacePath, beforeSecondRun);

  assert.equal(
    await readFile(path.join(workspacePath, '孙悟空大闹天宫剧本.md'), 'utf8'),
    '第二版',
  );
});
