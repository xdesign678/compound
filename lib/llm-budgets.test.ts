import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBackgroundLlmBudgetStats,
  getLlmBudgetStats,
  LlmBudgetQueue,
  runWithLlmBudget,
  type LlmBudgetName,
} from './llm-budgets';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('LlmBudgetQueue limits active tasks to configured concurrency', async () => {
  const queue = new LlmBudgetQueue('test', 2);
  let active = 0;
  let maxActive = 0;

  await Promise.all(
    Array.from({ length: 6 }, () =>
      queue.add(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 2);
  assert.equal(queue.stats().active, 0);
  assert.equal(queue.stats().pending, 0);
});

test('LlmBudgetQueue pauseFor keeps new tasks queued until the pause expires', async () => {
  const queue = new LlmBudgetQueue('test', 1);
  const started: number[] = [];

  queue.pauseFor(40);
  const submittedAt = Date.now();
  const task = queue.add(async () => {
    started.push(Date.now());
  });

  await delay(15);
  assert.equal(started.length, 0);

  await task;
  assert.equal(started.length, 1);
  assert.ok(started[0] - submittedAt >= 30);
});

test('LlmBudgetQueue rejects queued task when caller signal aborts', async () => {
  const queue = new LlmBudgetQueue('test', 1);
  const controller = new AbortController();
  let releaseFirst!: () => void;
  const first = queue.add(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const second = queue.add(async () => undefined, { signal: controller.signal });

  controller.abort(new DOMException('cancelled', 'AbortError'));
  releaseFirst();
  await first;
  await assert.rejects(second, /cancelled|aborted/i);
});

test('background LLM defaults expose a total cap with tuned stage limits', () => {
  assert.equal(getBackgroundLlmBudgetStats().concurrency, 10);
  assert.deepEqual(
    Object.fromEntries(
      (['github_ingest', 'summarize', 'relations', 'contextualize', 'embedding'] as const).map(
        (name) => [name, getLlmBudgetStats(name).concurrency],
      ),
    ),
    {
      github_ingest: 5,
      summarize: 4,
      relations: 2,
      contextualize: 2,
      embedding: 2,
    },
  );
});

test('shared background budget caps combined activity across stages', async () => {
  const stages: LlmBudgetName[] = [
    'github_ingest',
    'summarize',
    'relations',
    'contextualize',
    'embedding',
  ];
  let active = 0;
  let maxActive = 0;

  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      runWithLlmBudget(stages[index % stages.length], async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(15);
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 10);
  assert.equal(getBackgroundLlmBudgetStats().active, 0);
  assert.equal(getBackgroundLlmBudgetStats().pending, 0);
});
