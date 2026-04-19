import { NextResponse } from 'next/server';
import { chat } from '@/lib/gateway';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const apiKey = url.searchParams.get('apiKey') || undefined;
  const apiUrl = url.searchParams.get('apiUrl') || undefined;
  const model = url.searchParams.get('model') || undefined;

  const llmConfig = (apiKey || apiUrl || model) ? { apiKey, apiUrl, model } : undefined;

  // Diagnostic: show key shape without revealing it
  const rawKey = apiKey || process.env.LLM_API_KEY || process.env.AI_GATEWAY_API_KEY || '';
  const keyDiag = rawKey
    ? { length: rawKey.length, prefix: rawKey.slice(0, 6), suffix: rawKey.slice(-4) }
    : null;

  const envStatus = {
    LLM_API_KEY: !!process.env.LLM_API_KEY,
    LLM_API_KEY_len: (process.env.LLM_API_KEY || '').length,
    LLM_API_URL: process.env.LLM_API_URL || false,
    LLM_MODEL: process.env.LLM_MODEL || '(default)',
    AI_GATEWAY_API_KEY: !!process.env.AI_GATEWAY_API_KEY,
    override: !!llmConfig,
    keyDiag,
  };

  try {
    const result = await chat({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0,
      maxTokens: 10,
      llmConfig,
    });

    return NextResponse.json({ status: 'ok', reply: result.trim(), env: envStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', error: msg, env: envStatus }, { status: 500 });
  }
}
