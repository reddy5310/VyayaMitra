/**
 * Scroll memory: opening a screen starts at the top; coming back to it with Back/Forward restores where
 * the person was (for example the middle of the Activity list). Positions are kept per route path in
 * sessionStorage (tab-scoped, gone when the tab closes). Every storage access is try/catch.
 */
import { useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const SCROLL_STORAGE_KEY = 'vm-scroll';

function readAll(): Record<string, number> {
  try {
    const v = JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? '{}') as Record<string, number>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveScroll(path: string, y: number): void {
  try {
    const all = readAll();
    all[path] = Math.max(0, Math.round(y));
    // Keep the map small.
    const keys = Object.keys(all);
    if (keys.length > 30) delete all[keys[0]];
    sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: no restoration, nothing breaks */
  }
}

export function loadScroll(path: string): number {
  const y = readAll()[path];
  return typeof y === 'number' && y > 0 ? y : 0;
}

export function useScrollMemory(): void {
  const { pathname } = useLocation();
  const navType = useNavigationType();

  useLayoutEffect(() => {
    const target = navType === 'POP' ? loadScroll(pathname) : 0;
    if (target === 0) {
      window.scrollTo?.(0, 0);
      return;
    }
    // Lazy screens render a moment after the route changes: keep trying until the page is tall enough.
    let frames = 0;
    let raf = 0;
    const tick = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 2 && frames++ < 45) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // navType is read once per route change on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    let last = 0;
    const onScroll = () => {
      last = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      saveScroll(pathname, last || window.scrollY);
    };
  }, [pathname]);
}
