/**
 * Theme: 'system' | 'light' | 'dark', stored in localStorage 'vm-theme'.
 * index.html applies the stored choice before first paint; this provider keeps `data-theme` on
 * <html> and the <meta name="theme-color"> in sync, and follows live OS changes while on 'system'.
 */
/* eslint-disable react-refresh/only-export-components -- hooks/helpers intentionally live beside their components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemePreference } from '@/domain/types';

export const THEME_STORAGE_KEY = 'vm-theme';
/** App-bar colours, used for the browser/OS status bar (match --surface in each theme). */
export const THEME_COLORS = { light: '#ffffff', dark: '#111722' } as const;

export type ResolvedTheme = 'light' | 'dark';

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readStoredTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

function applyToDocument(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
  // index.html ships two media-qualified tags; collapse them so an explicit choice wins over the OS.
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    document.head.appendChild(m);
  }
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media');
    m.content = THEME_COLORS[resolved];
  });
}

const ThemeContext = createContext<ThemeState>({
  preference: 'system',
  resolved: 'light',
  setPreference: () => {},
});

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readStoredTheme);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Follow live OS changes (e.g. sunset auto-dark) — only matters while preference is 'system'.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyToDocument(resolved);
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* private mode / blocked storage: the choice still applies for this session */
    }
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
