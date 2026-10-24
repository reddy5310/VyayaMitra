import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** True at the `lg` breakpoint, where Activity shows the list and the detail side by side. */
export function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return matches;
}

/** Keyboard shortcuts must not fire while typing or while a dialog owns the keyboard. */
export function shortcutsBlocked(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}
