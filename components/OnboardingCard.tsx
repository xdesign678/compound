'use client';

import { useEffect, useState } from 'react';

import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';

const ONBOARDING_DISMISSED_KEY = 'compound:onboarding-dismissed';

interface OnboardingCardProps {
  variant?: 'full' | 'compact';
}

export function OnboardingCard({ variant = 'full' }: OnboardingCardProps) {
  const openModal = useAppStore((s) => s.openModal);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1');
  }, []);

  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const restoreOnboarding = () => {
    localStorage.removeItem(ONBOARDING_DISMISSED_KEY);
    setDismissed(false);
  };

  if (variant === 'compact') {
    return (
      <section
        className="empty-state empty-state-compact"
        aria-labelledby="onboarding-compact-title"
      >
        <div className="es-icon" aria-hidden="true">
          <Icon.Sparkle />
        </div>
        <h3 id="onboarding-compact-title">开始构建知识库</h3>
        <p className="onboarding-compact-desc">选择一个入口继续导入。</p>
        <div className="onboarding-actions onboarding-actions-compact">
          <button
            className="modal-btn primary empty-state-action"
            type="button"
            onClick={openModal}
          >
            粘贴正文或笔记
          </button>
          <button
            className="modal-btn empty-state-action"
            type="button"
            onClick={openObsidianImport}
          >
            从 Obsidian 导入
          </button>
          <button className="modal-btn empty-state-action" type="button" onClick={openGithubSync}>
            从 GitHub 同步
          </button>
        </div>
      </section>
    );
  }

  if (dismissed) {
    return (
      <section
        className="empty-state empty-state-spacious onboarding-card onboarding-card-dismissed"
        aria-labelledby="onboarding-return-title"
      >
        <div className="onboarding-hero">
          <h3 id="onboarding-return-title">知识库还没有内容</h3>
          <p className="onboarding-desc">需要导入时，可以随时回到这里选择入口。</p>
        </div>
        <button
          className="modal-btn primary empty-state-action"
          type="button"
          onClick={restoreOnboarding}
        >
          重新选择导入方式
        </button>
      </section>
    );
  }

  return (
    <section
      className="empty-state empty-state-spacious onboarding-card"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc onboarding-choice-hint"
    >
      <div className="onboarding-hero">
        <div className="es-icon" aria-hidden="true">
          <Icon.Sparkle />
        </div>
        <h3 id="onboarding-title">欢迎使用 Compound</h3>
        <p className="onboarding-desc" id="onboarding-desc">
          喂资料给 AI，让它帮你编译一部相互链接、持续生长的知识 Wiki。
        </p>
        <p className="onboarding-choice-hint" id="onboarding-choice-hint">
          从三种方式中选择一个开始。
        </p>
      </div>
      <div className="onboarding-options">
        <button className="onboarding-option" type="button" onClick={openModal}>
          <span className="onboarding-option-icon" aria-hidden="true">
            <Icon.Text />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">粘贴正文或笔记</div>
            <div className="onboarding-option-sub">最快的开始方式</div>
          </div>
        </button>
        <button className="onboarding-option" type="button" onClick={openObsidianImport}>
          <span className="onboarding-option-icon" aria-hidden="true">
            <Icon.Ingest />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">从 Obsidian 导入</div>
            <div className="onboarding-option-sub">批量导入本地 Markdown 文件</div>
          </div>
        </button>
        <button className="onboarding-option" type="button" onClick={openGithubSync}>
          <span className="onboarding-option-icon" aria-hidden="true">
            <Icon.Github />
          </span>
          <div className="onboarding-option-body">
            <div className="onboarding-option-title">从 GitHub 同步</div>
            <div className="onboarding-option-sub">自动导入仓库中的文档</div>
          </div>
        </button>
      </div>
      <button className="onboarding-skip" type="button" onClick={dismissOnboarding}>
        稍后再说
      </button>
    </section>
  );
}
