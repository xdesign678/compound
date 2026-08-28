'use client';

import { useState } from 'react';
import type { SyncQuarantine } from '@/lib/sync-reconciliation';
import {
  buildLocalRecoveryExportFilename,
  exportLocalRecoverySnapshot,
  serializeLocalRecoveryExport,
} from '@/lib/local-recovery-export';
import { triggerJsonDownload } from '@/lib/wiki-export-client';
import styles from './SyncQuarantinePanel.module.css';

export function SyncQuarantinePanel({
  quarantine,
  onDismiss,
  onAcceptRemote,
}: {
  quarantine: SyncQuarantine;
  onDismiss: () => void;
  onAcceptRemote: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const localRows =
    quarantine.staleSourceCount +
    quarantine.staleConceptCount +
    (quarantine.staleActivityCount ?? 0) +
    (quarantine.staleAskCount ?? 0);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const snapshot = await exportLocalRecoverySnapshot();
      triggerJsonDownload(
        buildLocalRecoveryExportFilename(),
        serializeLocalRecoveryExport(snapshot),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportError(`本机导出失败：${message.slice(0, 120)}`);
    } finally {
      setExporting(false);
    }
  }

  async function handleAcceptRemote() {
    setRecovering(true);
    try {
      await onAcceptRemote();
    } finally {
      setRecovering(false);
    }
  }

  return (
    <aside className={styles.panel} aria-labelledby="sync-quarantine-title" role="region">
      <p className={styles.eyebrow}>同步隔离</p>
      <h2 className={styles.title} id="sync-quarantine-title">
        本机副本已被保护
      </h2>
      <p className={styles.copy}>
        这次远端快照没有通过身份或游标校验，因此没有用它删除本机资料。请先导出本机副本，再决定是否接受远端副本。
      </p>
      <p className={styles.meta}>
        {localRows > 0
          ? `至少有 ${localRows} 条本机记录未在远端快照中出现；同 ID 的本机内容也保持原样。`
          : '本次隔离无法逐条统计差异；同 ID 的本机内容仍保持原样。'}
        activity 和问答记录在远端缺失，不等于会被删除。
      </p>

      {confirming ? (
        <div className={styles.actions} role="group" aria-labelledby="sync-quarantine-confirm">
          <p className={styles.copy} id="sync-quarantine-confirm">
            这会只清除此设备的资料、概念、活动、问答、离线队列和同步状态，然后重新拉取完整远端快照。不会删除服务器数据，也不会删除
            BYOK 或登录状态。
          </p>
          <button
            className="modal-btn primary danger-confirm"
            type="button"
            disabled={recovering}
            onClick={() => void handleAcceptRemote()}
          >
            {recovering ? '正在重新拉取…' : '确认清空本机并接受远端'}
          </button>
          <button
            className="modal-btn"
            type="button"
            disabled={recovering}
            onClick={() => setConfirming(false)}
          >
            取消，保留本机副本
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            className="modal-btn primary"
            type="button"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? '正在导出本机副本…' : '导出本机副本'}
          </button>
          <button className="modal-btn danger" type="button" onClick={() => setConfirming(true)}>
            接受远端副本
          </button>
          <button className={styles.secondary} type="button" onClick={onDismiss}>
            暂时收起，继续保留本机
          </button>
        </div>
      )}
      {exportError && <p className={styles.error}>{exportError}</p>}
    </aside>
  );
}
