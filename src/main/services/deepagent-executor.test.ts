import test from 'node:test';
import assert from 'node:assert/strict';
import { stripThinkingContent } from './deepagent-executor.js';

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
