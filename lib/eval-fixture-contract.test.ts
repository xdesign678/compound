import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface FixtureItem {
  id: string;
  category: string;
  question: string;
  expectedConceptIds?: string[];
  expectedConceptTitles?: string[];
  expectedKeywords?: string[];
  shouldAnswer?: boolean;
}

test('CI eval fixture is de-identified and structurally complete', () => {
  const filePath = path.join(process.cwd(), 'eval/fixtures/ci-corpus.json');
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { items: FixtureItem[] };
  assert.ok(Array.isArray(parsed.items));
  assert.ok(parsed.items.length >= 3);

  const ids = new Set<string>();
  for (const item of parsed.items) {
    assert.equal(ids.has(item.id), false, `duplicate fixture id ${item.id}`);
    ids.add(item.id);
    assert.ok(item.question.length > 8);
    assert.doesNotMatch(item.question, /compund\.zeabur|production incident id/i);
    const answerable = item.shouldAnswer !== false;
    if (answerable) {
      const hasIds = (item.expectedConceptIds ?? []).length > 0;
      const hasTitles = (item.expectedConceptTitles ?? []).length > 0;
      assert.equal(hasIds || hasTitles, true, `${item.id} needs concept ids or titles`);
    }
  }
});
