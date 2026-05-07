import test from 'node:test';
import assert from 'node:assert/strict';

import * as prompts from './prompts';

test('every exported prompt has a matching version constant', () => {
  const promptNames = Object.keys(prompts).filter(
    (name) => name.endsWith('_PROMPT') && typeof prompts[name as keyof typeof prompts] === 'string',
  );

  assert.ok(promptNames.length > 0, 'expected prompt constants to be exported');

  for (const promptName of promptNames) {
    const versionName = `${promptName}_VERSION` as keyof typeof prompts;
    const version = prompts[versionName];
    assert.equal(typeof version, 'string', `${promptName} should export ${String(versionName)}`);
    assert.match(String(version), /^[a-z0-9-]+-v\d+-\d{4}-\d{2}$/);
  }
});
