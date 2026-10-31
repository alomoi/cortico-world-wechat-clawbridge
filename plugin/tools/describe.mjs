/**
 * 生成 describe.json（World 自描述）。
 *
 * 安装版不包含 tools/，这里补一份最小实现，行为与上游保持一致：
 * 工具声明、事件声明、以及 envPrompt 模板内容（读 src/ENV_PROMPT.md）。
 *
 * 用法：node tools/describe.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import definition from '../src/definition.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const tools = definition.describe.tools.map(({ name, description, parameters, tags, summary }) => ({
  name,
  description,
  parameters,
  tags,
  ...(summary ? { summary } : {}),
}));

const prompts = [];
try {
  const content = readFileSync(join(root, 'src', 'ENV_PROMPT.md'), 'utf8');
  prompts.push({
    key: `worlds.${definition.id}.env`,
    title: '提示词',
    role: 'envPrompt',
    content,
  });
} catch {
  /* 没有模板就不写 prompts。 */
}

const doc = {
  tools,
  events: definition.describe.events,
  ...(prompts.length ? { prompts } : {}),
};

writeFileSync(join(root, 'describe.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
console.log(`describe.json 已生成：${tools.length} 个工具，${doc.events.length} 个事件`);
