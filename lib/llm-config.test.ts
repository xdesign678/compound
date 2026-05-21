import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearLlmConfig,
  getLlmConfig,
  getLlmConfigForPurpose,
  saveLlmConfig,
  setLlmRemember,
} from './llm-config';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function installBrowserStorage() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: sessionStorage,
  });
  return { localStorage, sessionStorage };
}

test('clearLlmConfig removes session-backed current config', () => {
  const { sessionStorage } = installBrowserStorage();
  saveLlmConfig({
    apiKey: 'user-key',
    apiUrl: 'https://example.com/v1/chat/completions',
    model: 'test-model',
  });

  assert.equal(sessionStorage.getItem('compound_llm_config') !== null, true);
  clearLlmConfig();

  assert.deepEqual(getLlmConfig(), {});
  assert.equal(sessionStorage.getItem('compound_llm_config'), null);
});

test('clearLlmConfig removes remembered and legacy config keys', () => {
  const { localStorage, sessionStorage } = installBrowserStorage();
  setLlmRemember(true);
  saveLlmConfig({ apiKey: 'remembered-key', model: 'remembered-model' });
  localStorage.setItem('compound_llm_api_key', 'legacy-local-key');
  localStorage.setItem('compound_llm_api_url', 'legacy-local-url');
  localStorage.setItem('compound_llm_model', 'legacy-local-model');
  sessionStorage.setItem('compound_llm_api_key', 'legacy-session-key');
  sessionStorage.setItem('compound_llm_api_url', 'legacy-session-url');
  sessionStorage.setItem('compound_llm_model', 'legacy-session-model');

  clearLlmConfig();

  assert.deepEqual(getLlmConfig(), {});
  assert.equal(localStorage.getItem('compound_llm_config'), null);
  assert.equal(sessionStorage.getItem('compound_llm_config'), null);
  assert.equal(localStorage.getItem('compound_llm_api_key'), null);
  assert.equal(localStorage.getItem('compound_llm_api_url'), null);
  assert.equal(localStorage.getItem('compound_llm_model'), null);
  assert.equal(sessionStorage.getItem('compound_llm_api_key'), null);
  assert.equal(sessionStorage.getItem('compound_llm_api_url'), null);
  assert.equal(sessionStorage.getItem('compound_llm_model'), null);
});

test('getLlmConfigForPurpose returns the model selected for that workflow', () => {
  installBrowserStorage();
  saveLlmConfig({
    apiKey: 'user-key',
    apiUrl: 'https://example.com/v1/chat/completions',
    model: 'legacy-model',
    askModel: 'ask-model',
    wikiModel: 'wiki-model',
  });

  assert.deepEqual(getLlmConfigForPurpose('ask'), {
    apiKey: 'user-key',
    apiUrl: 'https://example.com/v1/chat/completions',
    model: 'ask-model',
  });
  assert.deepEqual(getLlmConfigForPurpose('wiki'), {
    apiKey: 'user-key',
    apiUrl: 'https://example.com/v1/chat/completions',
    model: 'wiki-model',
  });
});
