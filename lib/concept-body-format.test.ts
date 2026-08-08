import test from 'node:test';
import assert from 'node:assert/strict';

import { formatConceptBodyForDisplay } from './concept-body-format';

test('formatConceptBodyForDisplay 会把长纯文本拆成多个段落', () => {
  const body =
    '考斯米迪斯和图比通过 Wason 选择任务实验发现：当题目涉及社会交换契约时，受试者能高效识别违反规则者，但在等价的抽象逻辑题中表现则差得多。这一结果支持领域特异性假设：大脑中存在专门处理社会互惠问题的认知模块。该模块的功能是检测合作中“只取不予”的投机者，其进化逻辑是：互惠利他是人类成功的关键，但需要能识别并惩罚欺骗者，否则合作无法稳定维持。欺骗者检测模块的核心特征包括：自动运行、专用于社会交换情境、对背叛者高度敏感，并与情绪系统联动。这类模块的存在解释了为何人类在正式逻辑测试中表现平庸，却能敏锐察觉他人的“占便宜”行为。';

  const formatted = formatConceptBodyForDisplay(body);

  assert.match(formatted, /\n\n/);
  assert.ok(formatted.split(/\n\s*\n/).length >= 3);
});

test('formatConceptBodyForDisplay 保留已有 markdown 段落结构', () => {
  const markdown = `## 小标题

第一段已经分好。

- 要点一
- 要点二`;

  assert.equal(formatConceptBodyForDisplay(markdown), markdown);
});

test('formatConceptBodyForDisplay 修正紧邻中文/引号的裸 ** 强调', () => {
  const body =
    'LLM Wiki 可以看作**"由 AI 执行的 Zettelkasten"**——人类负责想和策划,AI 负责链接和维护。';

  const formatted = formatConceptBodyForDisplay(body);

  assert.equal(
    formatted,
    'LLM Wiki 可以看作"**由 AI 执行的 Zettelkasten**"——人类负责想和策划,AI 负责链接和维护。',
  );
});

test('formatConceptBodyForDisplay 兼容中文弯引号与书名号', () => {
  assert.equal(formatConceptBodyForDisplay('核心是**“原子化笔记”**——'), '核心是“**原子化笔记**”——');
  assert.equal(formatConceptBodyForDisplay('读**《卡片笔记法》**后'), '读《**卡片笔记法**》后');
});

test('formatConceptBodyForDisplay 不动合法的引号强调写法', () => {
  const body = '他说"**重点**"结束。';
  assert.equal(formatConceptBodyForDisplay(body), body);
});
