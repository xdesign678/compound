import test from 'node:test';
import assert from 'node:assert/strict';

import { formatCategorizeCompletionMessage } from './categorize-status';

test('formatCategorizeCompletionMessage renders processed and failed counts', () => {
  assert.equal(
    formatCategorizeCompletionMessage({ total: 12, failed: 0, errors: [] }),
    '归类完成，处理了 12 条'
  );

  assert.equal(
    formatCategorizeCompletionMessage({ total: 12, failed: 2, errors: ['timeout'] }),
    '归类完成，处理了 12 条，失败 2 条'
  );
});
