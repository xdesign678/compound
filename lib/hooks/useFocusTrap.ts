import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab / Shift+Tab focus within the referenced container while `isOpen`
 * is true. Focuses the container itself when the modal opens.
 *
 * The container element should have `tabIndex={-1}` so it can receive
 * programmatic focus without appearing in the normal tab order.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, isOpen: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !isOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = el.closest<HTMLElement>('[role="dialog"]') ?? el;
    const parent = dialog.parentElement;
    const isolationNode = parent && parent.children.length === 1 ? parent : dialog;
    const siblings = isolationNode.parentElement
      ? Array.from(isolationNode.parentElement.children).filter(
          (node): node is HTMLElement => node instanceof HTMLElement && node !== isolationNode,
        )
      : [];
    const previousSiblingState = siblings.map((sibling) => ({
      sibling,
      inert: sibling.inert,
      ariaHidden: sibling.getAttribute('aria-hidden'),
    }));
    for (const sibling of siblings) {
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }

    const initialFocusable = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialFocusable ?? el).focus({ preventScroll: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === el) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      for (const state of previousSiblingState) {
        state.sibling.inert = state.inert;
        if (state.ariaHidden === null) state.sibling.removeAttribute('aria-hidden');
        else state.sibling.setAttribute('aria-hidden', state.ariaHidden);
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [ref, isOpen]);
}
