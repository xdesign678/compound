import { NextResponse } from 'next/server';
import { isAdminAuthConfigured, shouldEnforceAdminAuth } from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';

export const runtime = 'nodejs';

export const GET = withRequestTracing(async () => {
  const ctx = getRequestContext();
  return NextResponse.json({
    status: 'ok',
    service: 'compound',
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
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
});
