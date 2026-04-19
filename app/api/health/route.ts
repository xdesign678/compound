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

  try {
    const result = await chat({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0,
      maxTokens: 10,
    });

    return NextResponse.json({ status: 'ok', reply: result.trim(), env: envStatus });
  } catch {
    return NextResponse.json(
      { status: 'error', error: 'LLM health check failed', env: envStatus },
      { status: 500 }
    );
  }
}
