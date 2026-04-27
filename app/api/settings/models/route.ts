import { NextResponse } from 'next/server';
import { listCustomModels, saveCustomModel } from '@/lib/model-history';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  return NextResponse.json({ models: listCustomModels() });
}

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

  return NextResponse.json({ models: saveCustomModel(model) });
}
