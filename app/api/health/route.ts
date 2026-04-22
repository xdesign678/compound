import { NextResponse } from 'next/server';
import { isAdminAuthConfigured, shouldEnforceAdminAuth } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'compound',
    auth: {
      configured: isAdminAuthConfigured(),
      enforced: shouldEnforceAdminAuth(),
    },
    llm: {
      configured: Boolean(process.env.LLM_API_KEY || process.env.AI_GATEWAY_API_KEY),
    },
    githubSync: {
      configured: Boolean(process.env.GITHUB_REPO && process.env.GITHUB_TOKEN),
    },
    data: {
      configured: Boolean(process.env.DATA_DIR),
    },
  });
}
