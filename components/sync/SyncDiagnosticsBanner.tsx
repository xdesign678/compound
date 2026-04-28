'use client';

import type { SyncDiagnostic, DiagnosticActionId } from './types';

interface Props {
  diagnostics: SyncDiagnostic[];
  busy: boolean;
  onAction: (id: DiagnosticActionId, diagnosticId: string) => void;
}

/**
 * Top-of-page diagnostic banner that surfaces high-confidence patterns
 * (e.g. "16 files all timed out at 55s") with one-click remediation chips.
 *
 * Sits above HeroStatus when present so the user reads the most actionable
 * insight first; absent when no diagnostics are detected.
 */
export default function SyncDiagnosticsBanner({ diagnostics, busy, onAction }: Props) {
  if (!diagnostics || diagnostics.length === 0) return null;

  return (
    <section className="sync-v2-diagnostics" aria-label="智能诊断">
      {diagnostics.map((diag) => (
        <article
          key={diag.id}
          className={`sync-v2-diag sev-${diag.severity}`}
          role={diag.severity === 'critical' ? 'alert' : 'status'}
        >
          <div className="sync-v2-diag-body">
            <div className="sync-v2-diag-head">
              <span className={`sync-v2-diag-tag sev-${diag.severity}`}>
                {diag.severity === 'critical'
                  ? '需立刻处理'
                  : diag.severity === 'warning'
                    ? '注意'
                    : '提示'}
              </span>
              <h3>{diag.title}</h3>
            </div>
            <p>{diag.detail}</p>
          </div>
          <div className="sync-v2-diag-actions" role="group" aria-label="建议动作">
            {diag.actions.map((act) => {
              const className = act.primary
                ? 'sync-v2-btn sync-v2-btn-primary sync-v2-btn-tiny'
                : 'sync-v2-btn sync-v2-btn-ghost sync-v2-btn-tiny';
              if (act.href) {
                return (
                  <a
                    key={act.id}
                    className={className}
                    href={act.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {act.label}
                  </a>
                );
              }
              return (
                <button
                  key={act.id}
                  type="button"
                  className={className}
                  disabled={busy}
                  onClick={() => onAction(act.id, diag.id)}
                >
                  {act.label}
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
