'use client';

import { useAppStore, FONT_SIZE_MAP, type FontSize } from '@/lib/store';

const FONT_SIZES: FontSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

export function FontSizeSelector() {
  const fontSize = useAppStore((s) => s.fontSize);
  const setFontSize = useAppStore((s) => s.setFontSize);

  return (
    <div
      className="settings-segmented settings-segmented-five"
      role="radiogroup"
      aria-label="正文字号"
    >
      {FONT_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          role="radio"
          aria-checked={fontSize === size}
          className={fontSize === size ? 'active' : ''}
          onClick={() => setFontSize(size)}
          aria-label={`字号: ${FONT_SIZE_MAP[size].label}`}
          style={{ fontSize: `${Math.max(11, FONT_SIZE_MAP[size].px - 4)}px` }}
        >
          {FONT_SIZE_MAP[size].label}
        </button>
      ))}
    </div>
  );
}
