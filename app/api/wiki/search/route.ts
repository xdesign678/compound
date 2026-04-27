import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as {
      query?: string;
      conceptLimit?: number;
      chunkLimit?: number;
    };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const context = wikiRepo.searchWikiContext(query, {
      conceptLimit: body.conceptLimit ?? 24,
      chunkLimit: body.chunkLimit ?? 12,
    });

    return NextResponse.json(context);
  } catch (error) {
    console.error('[wiki/search] error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Wiki search failed' }, { status: 500 });
  }
}
