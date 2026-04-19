import type { LlmConfig } from './types';

const STORAGE_KEY = 'compound_llm_config';

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
