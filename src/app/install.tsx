/**
 * Install-to-home-screen support.
 * Android / desktop Chrome fire `beforeinstallprompt`, which we capture so the app can offer its own
 * "Install app" button. iOS Safari has no such event; there we show Share → Add to Home Screen steps.
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  /** The browser offered a native install prompt that has not been used yet. */
  canInstall: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** iPhone / iPad Safari: show manual steps instead of a button. */
  showIosSteps: boolean;
  /** Triggers the native prompt. Resolves true if the user accepted. */
  promptInstall: () => Promise<boolean>;
}

const InstallContext = createContext<InstallState>({
  canInstall: false,
  installed: false,
  showIosSteps: false,
  promptInstall: async () => false,
});

export function useInstall(): InstallState {
  return useContext(InstallContext);
}

export function isStandalone(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return Boolean(nav.standalone) || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  } catch {
    return false;
  }
}

export function isIosDevice(ua: string = navigator.userAgent, maxTouchPoints: number = navigator.maxTouchPoints): boolean {
  // iPadOS 13+ reports as a Mac but has touch points.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null); // a prompt event can only be used once
      return outcome === 'accepted';
    } catch {
      setDeferred(null);
      return false;
    }
  }, [deferred]);

  const value = useMemo<InstallState>(
    () => ({
      canInstall: deferred !== null && !installed,
      installed,
      showIosSteps: !installed && isIosDevice(),
      promptInstall,
    }),
    [deferred, installed, promptInstall],
  );
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}
