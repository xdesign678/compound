import { PRESET_MODELS } from './llm-config';
import { getServerDb } from './server-db';

const META_KEY = 'custom_model_history';
const MAX_CUSTOM_MODELS = 20;
const MAX_MODEL_LENGTH = 160;

export const PRESET_MODEL_VALUES = new Set(PRESET_MODELS.map((item) => item.value));

function parseModels(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}

function normalizeModel(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

export function rememberCustomModel(
  existingModels: string[],
  model: string,
  presetValues: ReadonlySet<string> = PRESET_MODEL_VALUES,
): string[] {
  const normalized = normalizeModel(model);
  const cleanedExisting = existingModels
    .map(normalizeModel)
    .filter((item) => item && item.length <= MAX_MODEL_LENGTH && !presetValues.has(item));

  if (!normalized || normalized.length > MAX_MODEL_LENGTH || presetValues.has(normalized)) {
    return Array.from(new Set(cleanedExisting)).slice(0, MAX_CUSTOM_MODELS);
  }

  return Array.from(new Set([normalized, ...cleanedExisting])).slice(0, MAX_CUSTOM_MODELS);
}

export function forgetCustomModel(
  existingModels: string[],
  model: string,
  presetValues: ReadonlySet<string> = PRESET_MODEL_VALUES,
): string[] {
  const normalized = normalizeModel(model);
  return rememberCustomModel(existingModels, '', presetValues).filter(
    (item) => item !== normalized,
  );
}

export function listCustomModels(): string[] {
  const row = getServerDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(META_KEY) as
    | { value: string }
    | undefined;
  return rememberCustomModel(parseModels(row?.value), '');
}

export function saveCustomModel(model: string): string[] {
  const next = rememberCustomModel(listCustomModels(), model);
  getServerDb()
    .prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`)
    .run(META_KEY, JSON.stringify(next));
  return next;
}

export function removeCustomModel(model: string): string[] {
  const next = forgetCustomModel(listCustomModels(), model);
  getServerDb()
    .prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`)
    .run(META_KEY, JSON.stringify(next));
  return next;
}
