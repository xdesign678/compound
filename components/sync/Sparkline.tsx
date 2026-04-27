'use client';

import { type ThroughputBucket } from './types';

interface Props {
  data: ThroughputBucket[];
  width?: number;
  height?: number;
}

/**
 * Tiny bar sparkline showing the last 30 minutes of completion rate.
 * Green = succeeded, red = failed. Pure SVG so we don't pull a charts dep.
 */
export default function Sparkline({ data, width = 120, height = 28 }: Props) {
  if (data.length === 0) {
    return <span className="ops-sparkline empty">—</span>;
  }
  const max = Math.max(1, ...data.map((d) => d.done + d.failed));
  const barWidth = (width - data.length * 2) / Math.max(data.length, 1);
  return (
    <svg
      className="ops-sparkline"
      width={width}
      height={height}
      role="img"
      aria-label="近 30 分钟完成速率"
    >
      {data.map((bucket, i) => {
        const total = bucket.done + bucket.failed;
        if (total === 0) return null;
        const x = i * (barWidth + 2);
        const failedHeight = (bucket.failed / max) * height;
        const doneHeight = (bucket.done / max) * height;
        return (
          <g key={bucket.at}>
            <rect
              x={x}
              y={height - failedHeight}
              width={Math.max(2, barWidth)}
              height={failedHeight}
              fill="currentColor"
              fillOpacity={0.2}
              className="ops-sparkline-failed"
            />
            <rect
              x={x}
              y={height - failedHeight - doneHeight}
              width={Math.max(2, barWidth)}
              height={doneHeight}
              fill="currentColor"
              className="ops-sparkline-done"
            />
          </g>
        );
      })}
    </svg>
  );
}
