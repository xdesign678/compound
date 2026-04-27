'use client';

import { useAppStore, LINE_HEIGHT_MAP, type LineHeight } from '@/lib/store';

const LINE_HEIGHTS: LineHeight[] = ['compact', 'standard', 'relaxed'];

export function LineHeightSelector() {
  const lineHeight = useAppStore((s) => s.lineHeight);
  const setLineHeight = useAppStore((s) => s.setLineHeight);

  return (
    <div className="settings-segmented settings-segmented-three">
      {LINE_HEIGHTS.map((lh) => (
        <button
          key={lh}
          className={lineHeight === lh ? 'active' : ''}
          onClick={() => setLineHeight(lh)}
          aria-label={`行间距: ${LINE_HEIGHT_MAP[lh].label}`}
        >
          {LINE_HEIGHT_MAP[lh].label}
        </button>
      ))}
    </div>
  );
}
