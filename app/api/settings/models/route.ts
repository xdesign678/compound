import { NextResponse } from 'next/server';
import {
  getSelectedModel,
  getModelForTask,
  getSelectedAskModel,
  getSelectedWikiModel,
  hidePresetModel,
  listCustomModels,
  listHiddenPresetModels,
  removeCustomModel,
  saveCustomModel,
  saveSelectedAskModel,
  saveSelectedModel,
  saveSelectedWikiModel,
} from '@/lib/model-history';
import { isRequestBodyTooLargeError, readJsonWithLimit } from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 16_384;

function modelSettingsResponse() {
  const selectedWikiModel = getSelectedWikiModel() || getModelForTask('ingest');
  const selectedAskModel = getSelectedAskModel() || getModelForTask('query');
  return NextResponse.json({
    models: listCustomModels(),
    hiddenPresetModels: listHiddenPresetModels(),
    selectedModel: getSelectedModel() || selectedAskModel,
    selectedWikiModel,
    selectedAskModel,
  });
}

/**
 * Return the cloud-backed model settings: custom model shortcuts, hidden preset
 * shortcuts, and the selected model override.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  return modelSettingsResponse();
}

/**
 * Remember a custom model shortcut in the shared server-side settings history.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await readJsonWithLimit(req, MAX_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    body = {};
  }

  const model =
    typeof (body as { model?: unknown }).model === 'string'
      ? (body as { model: string }).model.trim()
      : '';

  if (!model) {
    return NextResponse.json({ error: 'model must be a non-empty string' }, { status: 400 });
  }

  saveCustomModel(model);
  return modelSettingsResponse();
}

/**
 * Update shared model preferences, including the selected model or a hidden
 * preset shortcut.
 */
export async function PATCH(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await readJsonWithLimit(req, MAX_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    body = {};
  }

  const selectedModel = (body as { selectedModel?: unknown }).selectedModel;
  if (typeof selectedModel === 'string') {
    saveSelectedModel(selectedModel);
    saveSelectedWikiModel(selectedModel);
    saveSelectedAskModel(selectedModel);
  }

  const selectedWikiModel = (body as { selectedWikiModel?: unknown }).selectedWikiModel;
  if (typeof selectedWikiModel === 'string') {
    saveSelectedWikiModel(selectedWikiModel);
  }

  const selectedAskModel = (body as { selectedAskModel?: unknown }).selectedAskModel;
  if (typeof selectedAskModel === 'string') {
    saveSelectedAskModel(selectedAskModel);
  }

  const hiddenPresetModel = (body as { hiddenPresetModel?: unknown }).hiddenPresetModel;
  if (typeof hiddenPresetModel === 'string') {
    hidePresetModel(hiddenPresetModel);
  }

  return modelSettingsResponse();
}

/**
 * Remove a custom model shortcut from the shared server-side settings history.
 */
export async function DELETE(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await readJsonWithLimit(req, MAX_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    body = {};
  }

  const model =
    typeof (body as { model?: unknown }).model === 'string'
      ? (body as { model: string }).model
      : '';

  removeCustomModel(model);
  return modelSettingsResponse();
}
