'use client';

import { useAppStore, type LineHeight } from '@/lib/store';
import { t, useLocale, type I18nKey } from '@/lib/i18n';

const LINE_HEIGHTS: LineHeight[] = ['compact', 'snug', 'standard', 'relaxed', 'loose'];

const LINE_HEIGHT_LABEL_KEYS: Record<LineHeight, I18nKey> = {
  compact: 'settings.lineHeight.compact',
  snug: 'settings.lineHeight.snug',
  standard: 'settings.lineHeight.standard',
  relaxed: 'settings.lineHeight.relaxed',
  loose: 'settings.lineHeight.loose',
};

export function LineHeightSelector() {
  useLocale();
  const lineHeight = useAppStore((s) => s.lineHeight);
  const setLineHeight = useAppStore((s) => s.setLineHeight);

  return (
    <div
      className="settings-segmented settings-segmented-five"
      role="radiogroup"
      aria-label={t('settings.lineHeight.title')}
    >
      {LINE_HEIGHTS.map((lh) => {
        const label = t(LINE_HEIGHT_LABEL_KEYS[lh]);
        return (
          <button
            key={lh}
            type="button"
            role="radio"
            aria-checked={lineHeight === lh}
            className={lineHeight === lh ? 'active' : ''}
            onClick={() => setLineHeight(lh)}
            aria-label={t('settings.lineHeight.optionAria', { label })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
