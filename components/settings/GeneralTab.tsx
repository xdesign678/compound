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
    <div className="settings-tab-content settings-general-tab">
      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.language.title')}</div>
          <div className="settings-card-desc">{t('settings.language.desc')}</div>
        </div>
        <div
          className="settings-segmented"
          role="radiogroup"
          aria-label={t('settings.language.aria')}
        >
          {(['zh-CN', 'en'] as Locale[]).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={locale === item}
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
          <div className="settings-tool-title">{t('settings.colorMode.title')}</div>
          <div className="settings-card-desc">{t('settings.colorMode.desc')}</div>
        </div>
        <div
          className="settings-segmented settings-segmented-three"
          role="radiogroup"
          aria-label={t('settings.colorMode.title')}
        >
          {(['light', 'dark', 'system'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={colorMode === mode}
              className={colorMode === mode ? 'active' : ''}
              onClick={() => setColorMode(mode)}
            >
              {mode === 'light'
                ? t('settings.colorMode.light')
                : mode === 'dark'
                  ? t('settings.colorMode.dark')
                  : t('settings.colorMode.system')}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.fontSize.title')}</div>
          <div className="settings-card-desc">{t('settings.fontSize.desc')}</div>
        </div>
        <FontSizeSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.lineHeight.title')}</div>
          <div className="settings-card-desc">{t('settings.lineHeight.desc')}</div>
        </div>
        <LineHeightSelector />
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.homeStyle.title')}</div>
          <div className="settings-card-desc">{t('settings.homeStyle.desc')}</div>
        </div>
        <div
          className="settings-segmented"
          role="radiogroup"
          aria-label={t('settings.homeStyle.title')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={homeStyle === 'feed'}
            className={homeStyle === 'feed' ? 'active' : ''}
            onClick={() => setHomeStyle('feed')}
          >
            {t('settings.homeStyle.feed')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={homeStyle === 'library'}
            className={homeStyle === 'library' ? 'active' : ''}
            onClick={() => setHomeStyle('library')}
          >
            {t('settings.homeStyle.library')}
          </button>
        </div>
      </div>

      <div className="settings-tool-row settings-tool-row-flat">
        <div>
          <div className="settings-tool-title">{t('settings.markdownBreaks.title')}</div>
          <div className="settings-card-desc">
            {breaksEnabled
              ? t('settings.markdownBreaks.descLoose')
              : t('settings.markdownBreaks.descStrict')}
          </div>
        </div>
        <div
          className="settings-segmented"
          role="radiogroup"
          aria-label={t('settings.markdownBreaks.title')}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!breaksEnabled}
            className={!breaksEnabled ? 'active' : ''}
            onClick={() => {
              setMarkdownBreaks(false);
              setBreaksEnabled(false);
            }}
          >
            {t('settings.markdownBreaks.strict')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={breaksEnabled}
            className={breaksEnabled ? 'active' : ''}
            onClick={() => {
              setMarkdownBreaks(true);
              setBreaksEnabled(true);
            }}
          >
            {t('settings.markdownBreaks.loose')}
          </button>
        </div>
      </div>
    </div>
  );
}
