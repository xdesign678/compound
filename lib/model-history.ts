import { PRESET_MODELS } from './llm-config';
import { getServerDb } from './server-db';

const CUSTOM_MODELS_META_KEY = 'custom_model_history';
const HIDDEN_PRESETS_META_KEY = 'hidden_preset_models';
const SELECTED_MODEL_META_KEY = 'selected_llm_model';
const MAX_CUSTOM_MODELS = 20;
const MAX_MODEL_LENGTH = 160;

export const PRESET_MODEL_VALUES: ReadonlySet<string> = new Set(
  PRESET_MODELS.map((item) => item.value),
);

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

function readMetaValue(key: string): string | undefined {
  const row = getServerDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function writeMetaValue(key: string, value: unknown): void {
  getServerDb()
    .prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`)
    .run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function listCustomModels(): string[] {
  return rememberCustomModel(parseModels(readMetaValue(CUSTOM_MODELS_META_KEY)), '');
}

export function saveCustomModel(model: string): string[] {
  const next = rememberCustomModel(listCustomModels(), model);
  writeMetaValue(CUSTOM_MODELS_META_KEY, next);
  return next;
}

export function removeCustomModel(model: string): string[] {
  const normalized = normalizeModel(model);
  const next = forgetCustomModel(listCustomModels(), model);
  writeMetaValue(CUSTOM_MODELS_META_KEY, next);
  if (getSelectedModel() === normalized) {
    saveSelectedModel('');
  }
  return next;
}

export function listHiddenPresetModels(): string[] {
  return Array.from(
    new Set(
      parseModels(readMetaValue(HIDDEN_PRESETS_META_KEY)).filter((item) =>
        PRESET_MODEL_VALUES.has(item),
      ),
    ),
  );
}

export function hidePresetModel(model: string): string[] {
  const normalized = normalizeModel(model);
  if (!PRESET_MODEL_VALUES.has(normalized)) return listHiddenPresetModels();

  const next = Array.from(new Set([...listHiddenPresetModels(), normalized]));
  writeMetaValue(HIDDEN_PRESETS_META_KEY, next);
  if (getSelectedModel() === normalized) {
    saveSelectedModel('');
  }
  return next;
}

export function getSelectedModel(): string {
  const model = normalizeModel(readMetaValue(SELECTED_MODEL_META_KEY) || '');
  return model.length <= MAX_MODEL_LENGTH ? model : '';
}

export function saveSelectedModel(model: string): string {
  const normalized = normalizeModel(model);
  const next = normalized.length <= MAX_MODEL_LENGTH ? normalized : '';
  writeMetaValue(SELECTED_MODEL_META_KEY, next);
  return next;
}
