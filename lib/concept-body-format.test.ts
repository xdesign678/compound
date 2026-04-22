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
