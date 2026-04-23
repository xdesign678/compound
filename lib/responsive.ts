export const DESKTOP_LAYOUT_MIN_WIDTH = 1024;
export const TABLET_LAYOUT_MIN_WIDTH = 768;

export function isDesktopWidth(width: number) {
  return width >= DESKTOP_LAYOUT_MIN_WIDTH;
}

export function isTabletWidth(width: number) {
  return width >= TABLET_LAYOUT_MIN_WIDTH && width < DESKTOP_LAYOUT_MIN_WIDTH;
}
