import type { LlmConfig } from './types';
import { getAdminAuthHeaders } from './admin-auth-client';
import { withRequestId } from './trace-client';

const STORAGE_KEY = 'compound_llm_config';
const HIDDEN_PRESET_MODELS_KEY = 'compound_hidden_preset_models';

export const PRESET_MODELS = [
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4.6' },
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5' },
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro-preview' },
] as const;

export function getLlmConfig(): LlmConfig {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LlmConfig) : {};
  } catch {
    return {};
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getHiddenPresetModels(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HIDDEN_PRESET_MODELS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const presetValues: ReadonlySet<string> = new Set(PRESET_MODELS.map((item) => item.value));
    return parsed.filter(
      (item): item is string => typeof item === 'string' && presetValues.has(item),
    );
  } catch {
    return [];
  }
}

export function hidePresetModel(model: string): string[] {
  if (typeof window === 'undefined') return [];
  const presetValues: ReadonlySet<string> = new Set(PRESET_MODELS.map((item) => item.value));
  if (!presetValues.has(model)) return getHiddenPresetModels();

  const next = Array.from(new Set([...getHiddenPresetModels(), model]));
  localStorage.setItem(HIDDEN_PRESET_MODELS_KEY, JSON.stringify(next));
  return next;
}

export async function fetchCustomModels(): Promise<string[]> {
  const res = await fetch('/api/settings/models', {
    headers: withRequestId(getAdminAuthHeaders()),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: unknown };
  return Array.isArray(data.models)
    ? data.models.filter((item): item is string => typeof item === 'string')
    : [];
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
  const data = (await res.json()) as { models?: unknown };
  return Array.isArray(data.models)
    ? data.models.filter((item): item is string => typeof item === 'string')
    : [];
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
  const data = (await res.json()) as { models?: unknown };
  return Array.isArray(data.models)
    ? data.models.filter((item): item is string => typeof item === 'string')
    : [];
}

export function modelLabel(model: string): string {
  const preset = PRESET_MODELS.find((item) => item.value === model);
  if (preset) return preset.label;
  return model.split('/').pop() || model;
}
