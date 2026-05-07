'use client';

export type ImportKind = 'ingest' | 'obsidian' | 'github';

export interface RecentImportEntry {
  id: string;
  kind: ImportKind;
  label: string;
  detail?: string;
  at: number;
}

interface ImportProgressProps {
  title: string;
  stage: string;
  detail?: string;
  progress?: number;
  running?: boolean;
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
}

const RECENT_IMPORTS_KEY = 'compound_recent_imports';
const MAX_RECENT_IMPORTS = 5;

export function ImportProgress({
  title,
  stage,
  detail,
  progress,
  running = false,
  error,
  onCancel,
  onRetry,
  onClose,
}: ImportProgressProps) {
  const boundedProgress =
    typeof progress === 'number' ? Math.min(100, Math.max(0, Math.round(progress))) : undefined;

  return (
    <section className="import-progress" aria-live="polite">
      <div className="import-progress-head">
        <div>
          <div className="import-progress-title">{title}</div>
          <div className="import-progress-stage">{stage}</div>
        </div>
        {running && onCancel && (
          <button className="modal-btn import-progress-action" onClick={onCancel}>
            取消
          </button>
        )}
      </div>

      {detail && <div className="import-progress-detail">{detail}</div>}

      {typeof boundedProgress === 'number' && (
        <div className="import-progress-bar" aria-label={`${title}进度 ${boundedProgress}%`}>
          <div className="import-progress-fill" style={{ width: `${boundedProgress}%` }} />
        </div>
      )}

      {error && (
        <div className="import-progress-error">
          <div className="import-progress-error-text">{error.slice(0, 180)}</div>
          <div className="import-progress-actions">
            {onRetry && (
              <button className="modal-btn primary import-progress-action" onClick={onRetry}>
                重试
              </button>
            )}
            <button
              className="modal-btn import-progress-action"
              onClick={() => void navigator.clipboard?.writeText(error)}
            >
              复制日志
            </button>
            {onClose && (
              <button className="modal-btn import-progress-action" onClick={onClose}>
                关闭
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function rememberRecentImport(entry: Omit<RecentImportEntry, 'id' | 'at'>) {
  if (typeof window === 'undefined') return;
  const next: RecentImportEntry = {
    ...entry,
    id: `${entry.kind}-${Date.now()}`,
    at: Date.now(),
  };
  const current = readRecentImports();
  const filtered = current.filter((item) => item.kind !== next.kind || item.label !== next.label);
  localStorage.setItem(
    RECENT_IMPORTS_KEY,
    JSON.stringify([next, ...filtered].slice(0, MAX_RECENT_IMPORTS)),
  );
}

export function readRecentImports(): RecentImportEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_IMPORTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_IMPORTS) : [];
  } catch {
    return [];
  }
}
