'use client';

import '@/components/modals.css';
import '@/app/modals.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useModalKeyboard } from '@/lib/hooks/useModalKeyboard';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import {
  filterObsidianFiles,
  readObsidianBatch,
  runImportQueue,
  loadManifest,
  clearManifest,
  type ObsidianFile,
  type FileStatus,
} from '@/lib/obsidian-import';
import { ImportProgress, rememberRecentImport } from './ImportProgress';
import { Icon } from './Icons';

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
  const files = useMemo(() => fileIds.map((id) => filesMap[id]), [fileIds, filesMap]);

  const [loadingFiles, setLoadingFiles] = useState(false);
  const [manifestSize, setManifestSize] = useState(0);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingClearManifest, setConfirmingClearManifest] = useState(false);
  const [visible, setVisible] = useState(false);
  const stopRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  useModalKeyboard(isOpen, close);
  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [isOpen]);

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
    setInlineError(null);
    setConfirmingClose(false);
    setConfirmingClearManifest(false);
    stopRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    if (stage === 'running') {
      setConfirmingClose(true);
      return;
    }
    reset();
    close();
  }, [stage, close, reset]);

  const confirmClose = useCallback(() => {
    stopRef.current = true;
    setConfirmingClose(false);
    reset();
    close();
  }, [close, reset]);

  const handlePickFolder = () => dirInputRef.current?.click();
  const handlePickFiles = () => fileInputRef.current?.click();

  const handleFilesSelected = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setLoadingFiles(true);
    setInlineError(null);
    try {
      const filtered = filterObsidianFiles(list);
      if (filtered.length === 0) {
        setInlineError('没找到 .md 文件（已自动过滤 .obsidian 和 .trash 目录）');
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
      setInlineError('读取文件失败：' + (e instanceof Error ? e.message : String(e)));
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
  const firstFailedFile = useMemo(() => files.find((f) => f.status === 'failed'), [files]);

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
    rememberRecentImport({
      kind: 'obsidian',
      label: `${queue.length} 个 Obsidian 文件`,
      detail: queue[0]?.path,
    });

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
    setConfirmingClearManifest(true);
  };

  const confirmClearManifest = () => {
    clearManifest();
    setManifestSize(0);
    setConfirmingClearManifest(false);
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

  return (
    <div className={`modal-overlay${visible ? ' visible' : ''}`} onClick={handleClose}>
      <div
        className="modal obsidian-import-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="obsidian-import-title"
        aria-describedby="obsidian-import-desc"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />

        {/* 头部 */}
        <div className="obsidian-import-head">
          <h3 id="obsidian-import-title">从 Obsidian 批量导入</h3>
          <p className="modal-desc" id="obsidian-import-desc">
            选择你的 Obsidian 库文件夹（或多个 .md 文件），AI 会逐个编译进 Wiki。
            {manifestSize > 0 && (
              <>
                {' '}
                <span className="obsidian-import-note">
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
              <button
                className="ingest-option"
                type="button"
                onClick={handlePickFolder}
                disabled={loadingFiles}
              >
                <div className="opt-icon" aria-hidden="true">
                  <Icon.File />
                </div>
                <div>
                  <div className="opt-title">选择整个文件夹</div>
                  <div className="opt-sub">推荐 · 会扫描所有 .md 文件（自动跳过 .obsidian）</div>
                </div>
              </button>
              <button
                className="ingest-option"
                type="button"
                onClick={handlePickFiles}
                disabled={loadingFiles}
              >
                <div className="opt-icon" aria-hidden="true">
                  <Icon.File />
                </div>
                <div>
                  <div className="opt-title">选择多个文件</div>
                  <div className="opt-sub">按住 Cmd/Ctrl 多选 .md 文件</div>
                </div>
              </button>
            </div>

            {loadingFiles && (
              <p className="modal-desc obsidian-import-loading" role="status" aria-live="polite">
                正在读取文件内容…
              </p>
            )}

            {inlineError && (
              <p className="modal-desc obsidian-import-inline-error" role="alert">
                {inlineError}
              </p>
            )}

            {confirmingClearManifest ? (
              <div className="obsidian-import-confirm" role="alert" aria-live="assertive">
                <p className="modal-desc">
                  确定清除 {manifestSize}{' '}
                  条导入记录吗？已导入的资料本身不会被删除，但下次再选同样的文件会被当作新文件重复导入。
                </p>
                <div className="obsidian-import-confirm-actions">
                  <button
                    className="modal-btn primary"
                    type="button"
                    onClick={confirmClearManifest}
                  >
                    确认清除
                  </button>
                  <button
                    className="modal-btn"
                    type="button"
                    onClick={() => setConfirmingClearManifest(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="obsidian-import-idle-actions">
                {manifestSize > 0 ? (
                  <button className="modal-btn" type="button" onClick={handleClearManifest}>
                    清除 {manifestSize} 条导入记录
                  </button>
                ) : (
                  <span aria-hidden="true" />
                )}
                <button className="modal-btn" type="button" onClick={handleClose}>
                  关闭
                </button>
              </div>
            )}
          </>
        )}

        {/* 阶段 2/3/4：列表 + 控制 */}
        {stage !== 'idle' && (
          <>
            <ImportProgress
              title="Obsidian 导入"
              stage={
                stage === 'running'
                  ? '正在逐个编译 Markdown'
                  : stage === 'done'
                    ? counts.failed > 0
                      ? '部分文件导入失败'
                      : '导入完成'
                    : '等待开始'
              }
              detail={
                stage === 'running'
                  ? files.find((f) => f.status === 'running')?.path
                  : firstFailedFile?.error
                    ? firstFailedFile.path
                    : `已选择 ${counts.selected} 篇`
              }
              progress={
                counts.total > 0 ? ((counts.success + counts.failed) / counts.total) * 100 : 0
              }
              running={stage === 'running'}
              error={stage === 'done' && firstFailedFile?.error ? firstFailedFile.error : null}
              onCancel={stopImport}
              onRetry={counts.pending > 0 ? startImport : undefined}
              onClose={handleClose}
            />
            {/* 统计条 */}
            <div className="obsidian-import-stats" role="status" aria-live="polite">
              <span>
                共 <b>{counts.total}</b>
              </span>
              <span className="obsidian-status-pending">
                待导入 <b>{counts.pending}</b>
              </span>
              {counts.duplicate > 0 && (
                <span className="obsidian-status-muted">
                  跳过 <b>{counts.duplicate}</b>
                </span>
              )}
              <span className="obsidian-status-success">
                成功 <b>{counts.success}</b>
              </span>
              {counts.failed > 0 && (
                <span className="obsidian-status-failed">
                  失败 <b>{counts.failed}</b>
                </span>
              )}
              <span className="obsidian-import-selected-count">
                已勾选 <b>{counts.selected}</b>
              </span>
            </div>

            {/* 操作按钮：选择类 */}
            {stage === 'selected' && counts.pending > 0 && (
              <div className="obsidian-import-toolbar">
                <button className="obsidian-pill" type="button" onClick={selectOnlyTrial}>
                  试跑前 {Math.min(TRIAL_COUNT, counts.pending)} 篇
                </button>
                <button className="obsidian-pill" type="button" onClick={selectAllPending}>
                  全选待导入
                </button>
                <button className="obsidian-pill" type="button" onClick={deselectAll}>
                  全不选
                </button>
              </div>
            )}

            {/* 文件列表 */}
            <div className="obsidian-import-list" role="list" aria-label="待导入文件">
              {files.map((f) => (
                <label
                  key={f.id}
                  className={`obsidian-import-row status-${f.status}`}
                  role="listitem"
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${f.title}`}
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
                          <span className="obsidian-status-failed" title={f.error}>
                            {f.error.slice(0, 60)}
                          </span>
                        </>
                      )}
                      {f.status === 'success' && (f.newConcepts || f.updatedConcepts) && (
                        <>
                          <span>·</span>
                          <span className="obsidian-status-success">
                            +{f.newConcepts || 0} 新 / {f.updatedConcepts || 0} 更新
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`obsidian-import-status obsidian-status-${f.status}`}>
                    {STATUS_LABEL[f.status]}
                  </div>
                </label>
              ))}
            </div>

            {/* 底部操作按钮 */}
            <div className="obsidian-import-actions">
              {confirmingClose ? (
                <>
                  <p className="modal-desc obsidian-import-close-warning" role="alert">
                    导入正在进行，确定关闭吗？未完成的文件会停止处理（下次可以断点续传）。
                  </p>
                  <button className="modal-btn primary" type="button" onClick={confirmClose}>
                    确认关闭
                  </button>
                  <button
                    className="modal-btn"
                    type="button"
                    onClick={() => setConfirmingClose(false)}
                  >
                    继续导入
                  </button>
                </>
              ) : (
                <>
                  {stage === 'selected' && (
                    <>
                      <button className="modal-btn" type="button" onClick={reset}>
                        返回
                      </button>
                      <button
                        className="modal-btn primary"
                        type="button"
                        onClick={startImport}
                        disabled={counts.selected === 0}
                      >
                        开始导入（{counts.selected} 篇）
                      </button>
                    </>
                  )}

                  {stage === 'running' && (
                    <>
                      <button className="modal-btn" type="button" onClick={stopImport}>
                        请求停止
                      </button>
                      <button className="modal-btn" type="button" onClick={handleClose}>
                        关闭
                      </button>
                    </>
                  )}

                  {stage === 'done' && (
                    <>
                      <button className="modal-btn" type="button" onClick={handleClose}>
                        完成
                      </button>
                      {counts.pending > 0 && (
                        <button className="modal-btn primary" type="button" onClick={startImport}>
                          继续导入剩余 {counts.pending} 篇
                        </button>
                      )}
                    </>
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
          hidden
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
          hidden
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
