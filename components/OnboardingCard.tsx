'use client';

import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';

interface OnboardingCardProps {
  variant?: 'full' | 'compact';
}

export function OnboardingCard({ variant = 'full' }: OnboardingCardProps) {
  const openModal = useAppStore((s) => s.openModal);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);

  if (variant === 'compact') {
    return (
      <div className="empty-state empty-state-compact">
        <div className="es-icon">
          <Icon.Sparkle />
        </div>
        <h3>开始构建知识库</h3>
        <div className="onboarding-actions onboarding-actions-compact">
          <button className="modal-btn primary empty-state-action" onClick={openModal}>
            粘贴正文或笔记
          </button>
          <button className="modal-btn empty-state-action" onClick={openObsidianImport}>
            从 Obsidian 导入
          </button>
          <button className="modal-btn empty-state-action" onClick={openGithubSync}>
            从 GitHub 同步
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-state empty-state-spacious onboarding-card">
      <div className="onboarding-hero">
        <div className="es-icon">
          <Icon.Sparkle />
        </div>
        <h3>欢迎使用 Compound</h3>
        <p className="onboarding-desc">
          喂资料给 AI，让它帮你编译一部相互链接、持续生长的知识 Wiki。
        </p>
      </div>
      <div className="onboarding-options">
        <button className="onboarding-option" onClick={openModal}>
          <span className="onboarding-option-icon">
            <Icon.Text />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">粘贴正文或笔记</div>
            <div className="onboarding-option-sub">最快的开始方式</div>
          </div>
        </button>
        <button className="onboarding-option" onClick={openObsidianImport}>
          <span className="onboarding-option-icon">
            <Icon.Ingest />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">从 Obsidian 导入</div>
            <div className="onboarding-option-sub">批量导入本地 Markdown 文件</div>
          </div>
        </button>
        <button className="onboarding-option" onClick={openGithubSync}>
          <span className="onboarding-option-icon">
            <Icon.Github />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">从 GitHub 同步</div>
            <div className="onboarding-option-sub">自动导入仓库中的文档</div>
          </div>
        </button>
      </div>
    </div>
  );
}
