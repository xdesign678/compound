import test from 'node:test';
import assert from 'node:assert/strict';

// We test graph-expand purely through pure-function behavior on a mocked
// server DB. The full DB exercise lives in integration tests; here we only
// guard the pure aggregation/ordering logic by invoking on an empty set.

import { graphExpand } from './graph-expand';

test('graphExpand returns empty when no seeds', () => {
  const result = graphExpand([]);
  assert.deepEqual(result.concepts, []);
  assert.deepEqual(result.trace, {});
});
