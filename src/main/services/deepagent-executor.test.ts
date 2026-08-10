import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  captureSandboxArtifactSnapshot,
  exportSandboxOutputsToWorkspace,
  stripThinkingContent,
} from './deepagent-executor.js';

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
