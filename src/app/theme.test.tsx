import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, resolveTheme, useTheme } from './theme';

type Listener = (e: MediaQueryListEvent) => void;

/** Controllable prefers-color-scheme: dark. */
function mockSystemTheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('dark') ? dark : false;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${preference}/${resolved}`}</p>
      <button onClick={() => setPreference('dark')}>dark</button>
      <button onClick={() => setPreference('light')}>light</button>
      <button onClick={() => setPreference('system')}>system</button>
    </div>
  );
}

const html = () => document.documentElement;
const metaColors = () => Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')).map((m) => m.content);

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML =
    '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111722" media="(prefers-color-scheme: dark)">';
  html().removeAttribute('data-theme');
});
afterEach(() => localStorage.clear());

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('ThemeProvider', () => {
  it('defaults to system and applies the OS theme to <html>', () => {
    mockSystemTheme(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('system/dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  it('reads the stored preference', () => {
    mockSystemTheme(false);
    localStorage.setItem('vm-theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('dark/dark');
  });

  it('ignores a corrupt stored value', () => {
    mockSystemTheme(false);
    localStorage.setItem('vm-theme', 'purple');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('state')).toHaveTextContent('system/light');
  });

  it('persists a user choice and updates data-theme and theme-color', async () => {
    mockSystemTheme(false);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    await userEvent.click(screen.getByText('dark'));
    expect(localStorage.getItem('vm-theme')).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(new Set(metaColors())).toEqual(new Set(['#111722']));
    await userEvent.click(screen.getByText('light'));
    expect(localStorage.getItem('vm-theme')).toBe('light');
    expect(new Set(metaColors())).toEqual(new Set(['#ffffff']));
  });

  it('follows live system changes while on system, and ignores them once a theme is chosen', async () => {
    const sys = mockSystemTheme(false);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html().getAttribute('data-theme')).toBe('light');
    act(() => sys.set(true));
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('state')).toHaveTextContent('system/dark');

    await userEvent.click(screen.getByText('light'));
    act(() => sys.set(false));
    act(() => sys.set(true));
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('removes its system listener on unmount', () => {
    const sys = mockSystemTheme(false);
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(sys.listenerCount()).toBe(1);
    unmount();
    expect(sys.listenerCount()).toBe(0);
  });

  it('still works when localStorage throws', async () => {
    mockSystemTheme(false);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    await userEvent.click(screen.getByText('dark'));
    expect(html().getAttribute('data-theme')).toBe('dark');
    spy.mockRestore();
  });
});
