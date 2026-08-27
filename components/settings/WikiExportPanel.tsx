'use client';

export function WikiExportPanel({
  loading,
  error,
  lastExportLabel,
  onExport,
}: {
  loading: boolean;
  error: string | null;
  lastExportLabel: string | null;
  onExport: () => void;
}) {
  return (
    <div className="settings-tool-row settings-card-head-adjacent">
      <div>
        <div className="settings-tool-title">导出 Wiki Markdown</div>
        <div className="settings-card-desc">下载概念页、来源索引和关系图，可再用导入回写。</div>
        {lastExportLabel ? (
          <div className="settings-card-desc" role="status">
            最近导出：{lastExportLabel}
          </div>
        ) : (
          <div className="settings-card-desc" role="status">
            还没有成功导出记录。
          </div>
        )}
        {error ? (
          <div className="settings-card-desc" role="alert">
            {error}
          </div>
        ) : null}
      </div>
      <button
        className="modal-btn primary"
        type="button"
        onClick={onExport}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? '导出中…' : '导出 Wiki'}
      </button>
    </div>
  );
}
