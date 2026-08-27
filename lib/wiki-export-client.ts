export const LAST_WIKI_EXPORT_KEY = 'compound:lastWikiExport';

export interface WikiExportFile {
  path: string;
  content: string;
}

export interface WikiExportPayload {
  ok: true;
  files: WikiExportFile[];
}

export interface LastWikiExport {
  at: number;
  fileCount: number;
  filename: string;
}

export function buildWikiExportFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `compound-wiki-export-${stamp}.json`;
}

export function serializeWikiExport(files: WikiExportFile[]): string {
  return `${JSON.stringify({ ok: true, files }, null, 2)}\n`;
}

export function readLastWikiExport(raw: string | null | undefined): LastWikiExport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LastWikiExport;
    if (
      !parsed ||
      typeof parsed.at !== 'number' ||
      !Number.isFinite(parsed.at) ||
      typeof parsed.fileCount !== 'number' ||
      typeof parsed.filename !== 'string'
    ) {
      return null;
    }
    return {
      at: parsed.at,
      fileCount: parsed.fileCount,
      filename: parsed.filename,
    };
  } catch {
    return null;
  }
}

export function writeLastWikiExport(record: LastWikiExport): string {
  return JSON.stringify(record);
}

export function triggerJsonDownload(filename: string, contents: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
