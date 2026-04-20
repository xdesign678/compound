'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import {
  filterObsidianFiles,
  readObsidianBatch,
  runImportQueue,
  loadManifest,
  clearManifest,
  type ObsidianFile,
  type FileStatus,
} from '@/lib/obsidian-import';

type Stage = 'idle' | 'selected' | 'running' | 'done';

const TRIAL_COUNT = 3;

const STATUS_LABEL: Record<FileStatus, string> = {
  pending: '待导入',
  duplicate: '已导入过',
  running: '处理中…',
  success: '完成',
  failed: '失败',
  skipped: '未勾选',
};

const STATUS_COLOR: Record<FileStatus, string> = {
  pending: 'var(--ink-soft)',
  duplicate: '#9ca3af',
  running: '#c96442',
  success: '#10b981',
  failed: '#ef4444',
  skipped: '#9ca3af',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ObsidianImportModal() {
  const isOpen = useAppStore((s) => s.obsidianImportOpen);
  const close = useAppStore((s) => s.closeObsidianImport);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const markFresh = useAppStore((s) => s.markFresh);

  const [stage, setStage] = useState<Stage>('idle');
  const [filesMap, setFilesMap] = useState<Record<string, ObsidianFile>>({});
  const [fileIds, setFileIds] = useState<string[]>([]);
  const files = useMemo(() => fileIds.map(id => filesMap[id]), [fileIds, filesMap]);

  const [loadingFiles, setLoadingFiles] = useState(false);
  const [manifestSize, setManifestSize] = useState(0);
  const stopRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  // 打开时刷新 manifest 统计
  useEffect(() => {
    if (isOpen) {
      setManifestSize(Object.keys(loadManifest()).length);
    }
  }, [isOpen]);

  const reset = useCallback(() => {
    setStage('idle');
    setFilesMap({});
    setFileIds([]);
    setLoadingFiles(false);
    stopRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    if (stage === 'running') {
      if (!confirm('导入正在进行，确定关闭吗？未完成的文件会停止处理（下次可以断点续传）。')) return;
      stopRef.current = true;
    }
    reset();
    close();
  }, [stage, close, reset]);

  const handlePickFolder = () => dirInputRef.current?.click();
  const handlePickFiles = () => fileInputRef.current?.click();

  const handleFilesSelected = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setLoadingFiles(true);
    try {
      const filtered = filterObsidianFiles(list);
      if (filtered.length === 0) {
        alert('没找到 .md 文件（已自动过滤 .obsidian 和 .trash 目录）');
        setLoadingFiles(false);
        return;
      }
      const parsed = await readObsidianBatch(filtered);
      const newMap: Record<string, ObsidianFile> = {};
      const newIds: string[] = [];
      for (const f of parsed) {
        newMap[f.id] = f;
        newIds.push(f.id);
      }
      setFilesMap(newMap);
      setFileIds(newIds);
      setStage('selected');
    } catch (e) {
      alert('读取文件失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoadingFiles(false);
    }
  };

  const counts = useMemo(() => {
    const c = { total: files.length, pending: 0, duplicate: 0, success: 0, failed: 0, selected: 0 };
    for (const f of files) {
      if (f.status === 'pending') c.pending++;
      else if (f.status === 'duplicate') c.duplicate++;
      else if (f.status === 'success') c.success++;
      else if (f.status === 'failed') c.failed++;
      if (f.selected && f.status === 'pending') c.selected++;
    }
    return c;
  }, [files]);

  const toggleSelect = (id: string) => {
    if (stage === 'running') return;
    setFilesMap((prev) => {
      const f = prev[id];
      if (!f || f.status !== 'pending') return prev;
      return { ...prev, [id]: { ...f, selected: !f.selected } };
    });
  };

  const selectAllPending = () => {
    if (stage === 'running') return;
    setFilesMap((prev) => {
      const next = { ...prev };
      for (const id in next) {
        if (next[id].status === 'pending') next[id] = { ...next[id], selected: true };
      }
      return next;
    });
  };

  const deselectAll = () => {
    if (stage === 'running') return;
    setFilesMap((prev) => {
      const next = { ...prev };
      for (const id in next) {
        if (next[id].status === 'pending') next[id] = { ...next[id], selected: false };
      }
      return next;
    });
  };

  const selectOnlyTrial = () => {
    if (stage === 'running') return;
    let trialLeft = TRIAL_COUNT;
    setFilesMap((prev) => {
      const next = { ...prev };
      for (const id of fileIds) {
        const f = next[id];
        if (f.status !== 'pending') continue;
        if (trialLeft > 0) {
          trialLeft--;
          next[id] = { ...f, selected: true };
        } else {
          next[id] = { ...f, selected: false };
        }
      }
      return next;
    });
  };

  const startImport = async () => {
    if (counts.selected === 0) return;
    stopRef.current = false;
    setStage('running');
    showToast(`正在导入 ${counts.selected} 个文件…`, true);

    const accumulatedFreshIds: string[] = [];

    // 快照一份要处理的队列（按当前选择）
    const queue = files.filter((f) => f.selected && f.status === 'pending');

    await runImportQueue({
      files: queue,
      shouldStop: () => stopRef.current,
      onUpdate: (updated, newIds) => {
        setFilesMap((prev) => ({ ...prev, [updated.id]: updated }));
        if (updated.status === 'success' && newIds && newIds.length > 0) {
          accumulatedFreshIds.push(...newIds);
        }
      },
    });

    if (accumulatedFreshIds.length > 0) {
      markFresh(accumulatedFreshIds);
    }

    setManifestSize(Object.keys(loadManifest()).length);
    setStage('done');
    hideToast();
  };

  const stopImport = () => {
    stopRef.current = true;
    showToast('已请求停止，等待当前文件完成…', true);
  };

  const handleClearManifest = () => {
    if (!confirm(`确定清除所有导入记录吗？已导入的资料本身不会被删除，\n但下次再选同样的文件会被当作新文件重复导入。\n\n当前记录数：${manifestSize}`)) {
      return;
    }
    clearManifest();
    setManifestSize(0);
    // 把列表里的 duplicate 重置为 pending
    setFilesMap((prev) => {
      const next = { ...prev };
      for (const id in next) {
        if (next[id].status === 'duplicate') {
          next[id] = { ...next[id], status: 'pending', selected: true };
        }
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onClick={handleClose}>
      <div
        className="modal obsidian-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="obsidian-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />

        {/* 头部 */}
        <div className="obsidian-import-head">
          <h3 id="obsidian-import-title">从 Obsidian 批量导入</h3>
          <p className="modal-desc">
            选择你的 Obsidian 库文件夹（或多个 .md 文件），AI 会逐个编译进 Wiki。
            {manifestSize > 0 && (
              <>
                {' '}
                <span style={{ color: 'var(--ink-soft)' }}>
                  已有 {manifestSize} 条导入记录，重复选择会自动跳过。
                </span>
              </>
            )}
          </p>
        </div>

        {/* 阶段 1：选择文件 */}
        {stage === 'idle' && (
          <>
            <div className="ingest-options">
              <button className="ingest-option" onClick={handlePickFolder} disabled={loadingFiles}>
                <div className="opt-icon">📂</div>
                <div>
                  <div className="opt-title">选择整个文件夹</div>
                  <div className="opt-sub">推荐 · 会扫描所有 .md 文件（自动跳过 .obsidian）</div>
                </div>
              </button>
              <button className="ingest-option" onClick={handlePickFiles} disabled={loadingFiles}>
                <div className="opt-icon">📄</div>
                <div>
                  <div className="opt-title">选择多个文件</div>
                  <div className="opt-sub">按住 Cmd/Ctrl 多选 .md 文件</div>
                </div>
              </button>
            </div>

            {loadingFiles && (
              <p className="modal-desc" style={{ textAlign: 'center' }}>
                正在读取文件内容…
              </p>
            )}

            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 12,
              }}
            >
              {manifestSize > 0 ? (
                <button
                  className="modal-btn"
                  onClick={handleClearManifest}
                  style={{ flex: 1, fontSize: 13, color: 'var(--ink-soft)' }}
                >
                  清除 {manifestSize} 条导入记录
                </button>
              ) : (
                <span />
              )}
              <button className="modal-btn" onClick={handleClose} style={{ flex: 1 }}>
                关闭
              </button>
            </div>
          </>
        )}

        {/* 阶段 2/3/4：列表 + 控制 */}
        {stage !== 'idle' && (
          <>
            {/* 统计条 */}
            <div className="obsidian-import-stats">
              <span>
                共 <b>{counts.total}</b>
              </span>
              <span style={{ color: STATUS_COLOR.pending }}>
                待导入 <b>{counts.pending}</b>
              </span>
              {counts.duplicate > 0 && (
                <span style={{ color: STATUS_COLOR.duplicate }}>
                  跳过 <b>{counts.duplicate}</b>
                </span>
              )}
              <span style={{ color: STATUS_COLOR.success }}>
                成功 <b>{counts.success}</b>
              </span>
              {counts.failed > 0 && (
                <span style={{ color: STATUS_COLOR.failed }}>
                  失败 <b>{counts.failed}</b>
                </span>
              )}
              <span style={{ marginLeft: 'auto', color: 'var(--ink-soft)' }}>
                已勾选 <b>{counts.selected}</b>
              </span>
            </div>

            {/* 操作按钮：选择类 */}
            {stage === 'selected' && counts.pending > 0 && (
              <div className="obsidian-import-toolbar">
                <button className="obsidian-pill" onClick={selectOnlyTrial}>
                  试跑前 {Math.min(TRIAL_COUNT, counts.pending)} 篇
                </button>
                <button className="obsidian-pill" onClick={selectAllPending}>
                  全选待导入
                </button>
                <button className="obsidian-pill" onClick={deselectAll}>
                  全不选
                </button>
              </div>
            )}

            {/* 文件列表 */}
            <div className="obsidian-import-list">
              {files.map((f) => (
                <label
                  key={f.id}
                  className={`obsidian-import-row status-${f.status}`}
                  style={{
                    cursor: f.status === 'pending' && stage !== 'running' ? 'pointer' : 'default',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.selected && f.status === 'pending'}
                    disabled={f.status !== 'pending' || stage === 'running'}
                    onChange={() => toggleSelect(f.id)}
                  />
                  <div className="obsidian-import-row-main">
                    <div className="obsidian-import-title" title={f.path}>
                      {f.title}
                    </div>
                    <div className="obsidian-import-meta">
                      <span title={f.path}>{f.path}</span>
                      <span>·</span>
                      <span>{formatSize(f.size)}</span>
                      {f.error && (
                        <>
                          <span>·</span>
                          <span style={{ color: STATUS_COLOR.failed }} title={f.error}>
                            {f.error.slice(0, 60)}
                          </span>
                        </>
                      )}
                      {f.status === 'success' && (f.newConcepts || f.updatedConcepts) && (
                        <>
                          <span>·</span>
                          <span style={{ color: STATUS_COLOR.success }}>
                            +{f.newConcepts || 0} 新 / {f.updatedConcepts || 0} 更新
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="obsidian-import-status" style={{ color: STATUS_COLOR[f.status] }}>
                    {STATUS_LABEL[f.status]}
                  </div>
                </label>
              ))}
            </div>

            {/* 底部操作按钮 */}
            <div className="obsidian-import-actions">
              {stage === 'selected' && (
                <>
                  <button className="modal-btn" onClick={reset}>
                    返回
                  </button>
                  <button
                    className="modal-btn primary"
                    onClick={startImport}
                    disabled={counts.selected === 0}
                  >
                    开始导入（{counts.selected} 篇）
                  </button>
                </>
              )}

              {stage === 'running' && (
                <button className="modal-btn" onClick={stopImport}>
                  请求停止
                </button>
              )}

              {stage === 'done' && (
                <>
                  <button className="modal-btn" onClick={handleClose}>
                    完成
                  </button>
                  {counts.pending > 0 && (
                    <button className="modal-btn primary" onClick={startImport}>
                      继续导入剩余 {counts.pending} 篇
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* 隐藏的 file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={dirInputRef}
          type="file"
          // @ts-expect-error: non-standard but well-supported folder picker attributes
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
