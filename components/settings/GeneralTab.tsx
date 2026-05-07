'use client';

import { useState, useEffect } from 'react';
import { useAppStore, type ColorMode, type Locale } from '@/lib/store';
import { t, useLocale } from '@/lib/i18n';
import { getMarkdownBreaks, setMarkdownBreaks } from '@/lib/format';
import { FontSizeSelector } from './FontSizeSelector';
import { LineHeightSelector } from './LineHeightSelector';

export function GeneralTab() {
  const { locale, setLocale } = useLocale();
  const homeStyle = useAppStore((s) => s.homeStyle);
  const setHomeStyle = useAppStore((s) => s.setHomeStyle);
  const colorMode = useAppStore((s) => s.colorMode);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const [breaksEnabled, setBreaksEnabled] = useState(getMarkdownBreaks());

  useEffect(() => {
    setBreaksEnabled(getMarkdownBreaks());
  }, []);

  return (
    <div className="settings-tab-content">
      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.language.title')}</div>
          <div className="settings-card-desc">{t('settings.language.desc')}</div>
        </div>
        <div className="settings-segmented">
          {(['zh-CN', 'en'] as Locale[]).map((item) => (
            <button
              key={item}
              className={locale === item ? 'active' : ''}
              onClick={() => setLocale(item)}
            >
              {item === 'zh-CN' ? t('settings.language.zh') : t('settings.language.en')}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">颜色模式</div>
          <div className="settings-card-desc">浅色、深色或跟随系统</div>
        </div>
        <div className="settings-segmented settings-segmented-three">
          {(['light', 'dark', 'system'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              className={colorMode === mode ? 'active' : ''}
              onClick={() => setColorMode(mode)}
            >
              {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '系统'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">正文字号</div>
          <div className="settings-card-desc">调整 Wiki 和资料详情页阅读字号</div>
        </div>
        <FontSizeSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">行间距</div>
          <div className="settings-card-desc">调整详情页正文行间距</div>
        </div>
        <LineHeightSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">首页样式</div>
          <div className="settings-card-desc">动态流或分类知识库</div>
        </div>
        <div className="settings-segmented">
          <button
            className={homeStyle === 'feed' ? 'active' : ''}
            onClick={() => setHomeStyle('feed')}
          >
            动态流
          </button>
          <button
            className={homeStyle === 'library' ? 'active' : ''}
            onClick={() => setHomeStyle('library')}
          >
            知识库
          </button>
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">Markdown 换行</div>
          <div className="settings-card-desc">
            {breaksEnabled ? '宽松模式：单个换行即分段' : '严格模式：需空行才能分段'}
          </div>
        </div>
        <div className="settings-segmented">
          <button
            className={!breaksEnabled ? 'active' : ''}
            onClick={() => {
              setMarkdownBreaks(false);
              setBreaksEnabled(false);
            }}
          >
            严格
          </button>
          <button
            className={breaksEnabled ? 'active' : ''}
            onClick={() => {
              setMarkdownBreaks(true);
              setBreaksEnabled(true);
            }}
          >
            宽松
          </button>
        </div>
      </div>
    </div>
  );
}
