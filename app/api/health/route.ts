import { NextResponse } from 'next/server';
import { chat } from '@/lib/gateway';

export const runtime = 'nodejs';

export async function GET() {
  const envStatus = {
    LLM_API_KEY: !!process.env.LLM_API_KEY,
    LLM_API_URL: !!process.env.LLM_API_URL,
    LLM_MODEL: !!process.env.LLM_MODEL,
    AI_GATEWAY_API_KEY: !!process.env.AI_GATEWAY_API_KEY,
  };

  // Non-secret preview of what env is pointing to (safe to expose).
  const debug = {
    apiUrl: process.env.LLM_API_URL || '(unset → defaults to openrouter)',
    model: process.env.LLM_MODEL || '(unset → defaults to claude-sonnet-4.6)',
    keyPrefix: process.env.LLM_API_KEY?.slice(0, 8) || '(unset)',
    keyLength: process.env.LLM_API_KEY?.length || 0,
  };

  try {
    const result = await chat({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0,
      maxTokens: 10,
    });

    return NextResponse.json({ status: 'ok', reply: result.trim(), env: envStatus, debug });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        status: 'error',
        error: 'LLM health check failed',
        detail: message,
        env: envStatus,
        debug,
      },
      { status: 500 }
    );
  }
}
