/**
 * Lightweight haptic feedback helpers for mobile.
 * Uses navigator.vibrate on Android; iOS Safari ignores it silently,
 * so we wrap in try/catch to avoid breaking anything.
 */

export function hapticLight() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(8);
    }
  } catch {
    /* ignore */
  }
}

export function hapticMedium() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(18);
    }
  } catch {
    /* ignore */
  }
}

export function hapticSuccess() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([10, 30, 10]);
    }
  } catch {
    /* ignore */
  }
}
