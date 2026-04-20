'use client';

import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';

interface HeaderProps {
  conceptCount: number;
  sourceCount: number;
  linkCount: number;
}

const TAB_TITLES: Record<string, { t: string; s: (h: HeaderProps) => string }> = {
  wiki: {
    t: '我的 Wiki',
    s: (h) => `${h.conceptCount} 个概念 · ${h.linkCount} 条引用 · ${h.sourceCount} 份资料`,
  },
  sources: {
    t: '原始资料',
    s: (h) => `${h.sourceCount} 份 · AI 只读不改`,
  },
  ask: {
    t: '向 Wiki 提问',
    s: () => '答案来自你的知识库',
  },
  activity: {
    t: 'Wiki 维护',
    s: () => '健康检查与活动日志',
  },
};

export function Header(props: HeaderProps) {
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const back = useAppStore((s) => s.back);
  const openSettings = useAppStore((s) => s.openSettings);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);

  if (detail) {
    return (
      <header className="header">
        <button className="back-btn" onClick={back}>
          <Icon.Back />
          <span>返回</span>
        </button>
        <div className="header-actions">
          <button className="icon-btn" onClick={openSettings} aria-label="设置">
            <Icon.Settings />
          </button>
        </div>
      </header>
    );
  }

  const meta = TAB_TITLES[tab];
  return (
    <header className="header">
      <div className="header-copy">
        <div className="header-kicker">Compound</div>
        <div className="header-title">{meta.t}</div>
        <div className="header-subtitle">{meta.s(props)}</div>
      </div>
      <div className="header-actions">
        <button
          className="icon-btn"
          onClick={openGithubSync}
          aria-label="从 GitHub 同步"
          title="从 GitHub 同步 Obsidian 笔记"
        >
          <Icon.Github />
        </button>
        <button
          className="icon-btn"
          onClick={openObsidianImport}
          aria-label="从 Obsidian 批量导入"
          title="从本地 Obsidian 文件夹批量导入"
        >
          <Icon.Ingest />
        </button>
        <button className="icon-btn" onClick={openSettings} aria-label="设置">
          <Icon.Settings />
        </button>
      </div>
    </header>
  );
}
