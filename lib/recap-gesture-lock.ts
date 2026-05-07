export type RecapGestureAxis = 'horizontal' | 'vertical';

export const RECAP_DIRECTION_LOCK_FRAMES = 8;

export function resolveRecapGestureAxis({
  dx,
  dy,
  frameCount,
  ratio = 1.25,
}: {
  dx: number;
  dy: number;
  frameCount: number;
  ratio?: number;
}): RecapGestureAxis | null {
  if (frameCount < RECAP_DIRECTION_LOCK_FRAMES) return null;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  return absX >= absY * ratio ? 'horizontal' : 'vertical';
}
