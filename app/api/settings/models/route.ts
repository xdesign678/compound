import { NextResponse } from 'next/server';
import {
  getSelectedModel,
  hidePresetModel,
  listCustomModels,
  listHiddenPresetModels,
  removeCustomModel,
  saveCustomModel,
  saveSelectedModel,
} from '@/lib/model-history';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';

function modelSettingsResponse() {
  return NextResponse.json({
    models: listCustomModels(),
    hiddenPresetModels: listHiddenPresetModels(),
    selectedModel: getSelectedModel(),
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
    body = await req.json();
  } catch {
    body = {};
  }

  const model =
    typeof (body as { model?: unknown }).model === 'string'
      ? (body as { model: string }).model
      : '';

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
    body = await req.json();
  } catch {
    body = {};
  }

  const selectedModel = (body as { selectedModel?: unknown }).selectedModel;
  if (typeof selectedModel === 'string') {
    saveSelectedModel(selectedModel);
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
    body = await req.json();
  } catch {
    body = {};
  }

  const model =
    typeof (body as { model?: unknown }).model === 'string'
      ? (body as { model: string }).model
      : '';

  removeCustomModel(model);
  return modelSettingsResponse();
}
