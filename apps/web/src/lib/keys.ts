// Keyboard shortcuts scoped to one exercise card.
import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';

/** Elements where a key press belongs to the element itself (typing, choosing, following a link). */
function ownsKeys(el: Element | null, key: string, e: KeyboardEvent): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'SELECT' || tag === 'A') return true;
  if (tag === 'TEXTAREA') return !(key === 'Enter' && (e.ctrlKey || e.metaKey));
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Enter in a text field submits its form natively; digits are typed.
    return type !== 'checkbox' && type !== 'radio' ? true : key !== 'Enter';
  }
  if (tag === 'BUTTON') {
    // Our option buttons hand Enter to the card (Enter = check); other buttons keep their own Enter.
    if (key === 'Enter') return !el.hasAttribute('data-kbd-option');
    return false;
  }
  return false;
}

/**
 * false where several cards share a page (the mock exam): shortcuts then only work with focus
 * inside a card, so "1" doesn't pick option 1 in every item at once.
 */
export const PageWideKeys = createContext(true);

/** Page body, or a container / heading focused programmatically (route change, exam section): not a control. */
function nothingFocused(el: Element | null): boolean {
  if (!el || el === document.body || el === document.documentElement) return true;
  return el.getAttribute('tabindex') === '-1' && /^(MAIN|SECTION|DIV|ARTICLE|H[1-6])$/.test(el.tagName);
}

/**
 * Calls `handler` for key presses while focus is on the page body or inside `scope`, unless the
 * focused element handles the key itself. Return true from the handler to prevent the default.
 */
export function useCardKeys(
  scope: RefObject<HTMLElement | null>,
  handler: (e: KeyboardEvent) => boolean | void,
  enabled = true,
): void {
  const fn = useRef(handler);
  fn.current = handler;
  const pageWide = useContext(PageWideKeys);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.isComposing) return;
      const root = scope.current;
      if (!root || !root.isConnected) return;
      const active = document.activeElement;
      const inside = !!active && root.contains(active);
      if (!inside && (!pageWide || !nothingFocused(active))) return;
      if (inside && ownsKeys(active, e.key, e)) return;
      if (fn.current(e)) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [scope, enabled, pageWide]);
}
