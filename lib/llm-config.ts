import type { LlmConfig } from './types';
import { getAdminAuthHeaders } from './admin-auth-client';
import { withRequestId } from './trace-client';

const STORAGE_KEY = 'compound_llm_config';
const REMEMBER_KEY = 'compound_llm_remember';
const LEGACY_STORAGE_KEYS = [
  'compound_llm_api_key',
  'compound_llm_api_url',
  'compound_llm_model',
] as const;

export const PRESET_MODELS = [
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4.6' },
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5' },
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro-preview' },
] as const;

export type ModelSettings = {
  models: string[];
  hiddenPresetModels: string[];
  selectedModel: string;
};

function parseModelSettings(data: {
  models?: unknown;
  hiddenPresetModels?: unknown;
  selectedModel?: unknown;
}) {
  return {
    models: Array.isArray(data.models)
      ? data.models.filter((item): item is string => typeof item === 'string')
      : [],
    hiddenPresetModels: Array.isArray(data.hiddenPresetModels)
      ? data.hiddenPresetModels.filter((item): item is string => typeof item === 'string')
      : [],
    selectedModel: typeof data.selectedModel === 'string' ? data.selectedModel : '',
  };
}

export function getLlmConfig(): LlmConfig {
  if (typeof window === 'undefined') return {};
  try {
    const remember = localStorage.getItem(REMEMBER_KEY) === '1';
    const store = remember ? localStorage : sessionStorage;
    const raw = store.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LlmConfig) : {};
  } catch {
    return {};
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  if (typeof window === 'undefined') return;
  const remember = localStorage.getItem(REMEMBER_KEY) === '1';
  const store = remember ? localStorage : sessionStorage;
  store.setItem(STORAGE_KEY, JSON.stringify(config));
  // Clean up the other store to avoid stale data
  const otherStore = remember ? sessionStorage : localStorage;
  otherStore.removeItem(STORAGE_KEY);
}

export function clearLlmConfig(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

export function isLlmRemembered(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(REMEMBER_KEY) === '1';
}

export function setLlmRemember(remember: boolean): void {
  if (typeof window === 'undefined') return;
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, '1');
    // Migrate current config from sessionStorage to localStorage
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      localStorage.setItem(STORAGE_KEY, raw);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } else {
    localStorage.removeItem(REMEMBER_KEY);
    // Migrate current config from localStorage to sessionStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      sessionStorage.setItem(STORAGE_KEY, raw);
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export async function fetchModelSettings(): Promise<ModelSettings> {
  const res = await fetch('/api/settings/models', {
    headers: withRequestId(getAdminAuthHeaders()),
  });
  if (!res.ok) return { models: [], hiddenPresetModels: [], selectedModel: '' };
  return parseModelSettings(await res.json());
}

export async function fetchCustomModels(): Promise<string[]> {
  return (await fetchModelSettings()).models;
}

export async function rememberCustomModelOnServer(model: string): Promise<string[]> {
  const trimmed = model.trim();
  if (!trimmed || PRESET_MODELS.some((item) => item.value === trimmed)) return fetchCustomModels();

  const res = await fetch('/api/settings/models', {
    method: 'POST',
    headers: withRequestId({
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    }),
    body: JSON.stringify({ model: trimmed }),
  });
  if (!res.ok) return [];
  return parseModelSettings(await res.json()).models;
}

export async function removeCustomModelOnServer(model: string): Promise<string[]> {
  const trimmed = model.trim();
  if (!trimmed || PRESET_MODELS.some((item) => item.value === trimmed)) return fetchCustomModels();

  const res = await fetch('/api/settings/models', {
    method: 'DELETE',
    headers: withRequestId({
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    }),
    body: JSON.stringify({ model: trimmed }),
  });
  if (!res.ok) return [];
  return parseModelSettings(await res.json()).models;
}

export async function saveSelectedModelOnServer(model: string): Promise<ModelSettings> {
  const res = await fetch('/api/settings/models', {
    method: 'PATCH',
    headers: withRequestId({
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    }),
    body: JSON.stringify({ selectedModel: model.trim() }),
  });
  if (!res.ok) return { models: [], hiddenPresetModels: [], selectedModel: '' };
  return parseModelSettings(await res.json());
}

export async function hidePresetModelOnServer(model: string): Promise<ModelSettings> {
  const res = await fetch('/api/settings/models', {
    method: 'PATCH',
    headers: withRequestId({
      'Content-Type': 'application/json',
      ...getAdminAuthHeaders(),
    }),
    body: JSON.stringify({ hiddenPresetModel: model.trim() }),
  });
  if (!res.ok) return fetchModelSettings();
  return parseModelSettings(await res.json());
}

export function modelLabel(model: string): string {
  const preset = PRESET_MODELS.find((item) => item.value === model);
  if (preset) return preset.label;
  return model.split('/').pop() || model;
}
