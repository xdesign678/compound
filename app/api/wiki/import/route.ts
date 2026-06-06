import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';
import { getServerDb, repo } from '@/lib/server-db';
import { compileConceptArtifactsAfterManualChange } from '@/lib/wiki-compiler';
import type { ActivityLog, Concept } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 2_000_000;
const MAX_FILES = 500;
const MAX_FILE_CHARS = 200_000;

interface ImportFile {
  path?: string;
  content?: string;
}

interface ParsedWikiFile {
  id: string;
  title?: string;
  summary?: string;
  related: string[];
  body: string;
}

function parseScalar(line: string): string {
  const raw = line.trim();
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function parseArray(line: string): string[] {
  const raw = line.trim();
  if (!raw.startsWith('[') || !raw.endsWith(']')) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function stripGeneratedSections(markdown: string): string {
  return markdown
    .replace(/\n## Sources\n[\s\S]*?(?=\n## Evidence\n|\n## Related\n|$)/, '')
    .replace(/\n## Evidence\n[\s\S]*?(?=\n## Related\n|$)/, '')
    .replace(/\n## Related\n[\s\S]*$/, '')
    .trim();
}

function parseWikiMarkdown(content: string): ParsedWikiFile | null {
  const text = content.slice(0, MAX_FILE_CHARS);
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const bodyWithHeading = match[2].trim();
  const meta = new Map<string, string>();
  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    meta.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  const id = parseScalar(meta.get('id') || '');
  if (!id) return null;
  const title = parseScalar(meta.get('title') || '');
  const summary = parseScalar(meta.get('summary') || '');
  const related = parseArray(meta.get('related') || '[]');
  const withoutGenerated = stripGeneratedSections(bodyWithHeading);
  const body = withoutGenerated.replace(/^# .+?\n+/, '').trim();
  return {
    id,
    title,
    summary,
    related,
    body,
  };
}

/**
 * Import Markdown files previously produced by `/api/wiki/export`. The import
 * updates existing concept pages by `frontmatter.id`, records versions, and
 * rebuilds FTS/relation artifacts. Body: `{ files, dryRun? }`.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const payload = await readJsonWithLimit<{ files?: ImportFile[]; dryRun?: boolean }>(
      req,
      MAX_BODY_BYTES,
    );
    const files = Array.isArray(payload.files)
      ? (payload.files as ImportFile[]).slice(0, MAX_FILES)
      : [];
    const dryRun = payload.dryRun === true;

    const parsed = files
      .map((file) =>
        typeof file.content === 'string' && file.path?.endsWith('.md')
          ? parseWikiMarkdown(file.content)
          : null,
      )
      .filter((item): item is ParsedWikiFile => Boolean(item));

    const changed: Array<{ previous: Concept; next: Concept }> = [];
    const skipped: string[] = [];
    const ts = Date.now();
    for (const item of parsed) {
      const previous = repo.getConcept(item.id);
      if (!previous) {
        skipped.push(item.id);
        continue;
      }
      const next: Concept = {
        ...previous,
        title: item.title || previous.title,
        summary: item.summary || previous.summary,
        body: item.body || previous.body,
        related:
          item.related.length > 0
            ? item.related.filter((id) => id !== previous.id)
            : previous.related,
        updatedAt: ts,
        version: previous.version + 1,
      };
      const unchanged =
        next.title === previous.title &&
        next.summary === previous.summary &&
        next.body === previous.body &&
        next.related.length === previous.related.length &&
        next.related.every((id, index) => id === previous.related[index]);
      if (!unchanged) changed.push({ previous, next });
    }

    if (!dryRun && changed.length > 0) {
      const activity: ActivityLog = {
        id: `a-${nanoid(8)}`,
        type: 'ingest',
        title: `导入 Markdown Wiki 修改`,
        details: `从 Markdown 回写 ${changed.length} 个概念页，并重建索引。`,
        relatedConceptIds: changed.map((item) => item.next.id),
        at: ts,
      };
      const trx = getServerDb().transaction(() => {
        for (const item of changed) repo.upsertConcept(item.next);
        compileConceptArtifactsAfterManualChange({
          updatedConcepts: changed,
          changeSummary: '从 Markdown Wiki 导入修改。',
        });
        repo.insertActivity(activity);
      });
      trx();
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      parsed: parsed.length,
      changed: changed.map((item) => item.next.id),
      skipped,
    });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Import failed' }, { status: 500 });
  }
}
