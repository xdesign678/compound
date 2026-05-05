export const DESKTOP_LAYOUT_MIN_WIDTH = 1024;

export function isDesktopWidth(width: number) {
  return width >= DESKTOP_LAYOUT_MIN_WIDTH;
}
