'use client';

import { useAppStore, FONT_SIZE_MAP, type FontSize } from '@/lib/store';
import { t, useLocale, type I18nKey } from '@/lib/i18n';

const FONT_SIZES: FontSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

const FONT_SIZE_LABEL_KEYS: Record<FontSize, I18nKey> = {
  xs: 'settings.fontSize.xs',
  sm: 'settings.fontSize.sm',
  md: 'settings.fontSize.md',
  lg: 'settings.fontSize.lg',
  xl: 'settings.fontSize.xl',
};

export function FontSizeSelector() {
  useLocale();
  const fontSize = useAppStore((s) => s.fontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);

  return (
    <div
      className="settings-segmented settings-segmented-five"
      role="radiogroup"
      aria-label={t('settings.fontSize.title')}
    >
      {FONT_SIZES.map((size) => {
        const label = t(FONT_SIZE_LABEL_KEYS[size]);
        return (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={fontSize === size}
            className={fontSize === size ? 'active' : ''}
            onClick={() => setFontSize(size)}
            aria-label={t('settings.fontSize.optionAria', { label })}
            style={{ fontSize: `${Math.max(11, FONT_SIZE_MAP[size].px - 4)}px` }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
