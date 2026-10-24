/**
 * PWA lifecycle. The service worker is registered only in production builds (never in dev or tests).
 * - New version waiting: a slim, non-blocking banner in the header offers "Reload". We never reload on our own,
 *   so nobody loses an import in progress.
 * - First install: one "ready to work offline" toast.
 */
/* eslint-disable react-refresh/only-export-components */
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button, IconButton, useToast } from '@/ui';
import { isBusy, useBusy } from './busy';

const Registrar = lazy(() => import('./PwaRegistrar'));

export interface PwaStatus {
  needRefresh: boolean;
  offlineReady: boolean;
  /** Activates the waiting version and reloads. */
  reload: () => void;
  dismissUpdate: () => void;
}

export interface RegistrarReport {
  needRefresh: boolean;
  offlineReady: boolean;
  update: () => void;
}

const OFFLINE_FLAG = 'vm-offline-announced';

const PwaContext = createContext<PwaStatus>({ needRefresh: false, offlineReady: false, reload: () => {}, dismissUpdate: () => {} });

export function usePwa(): PwaStatus {
  return useContext(PwaContext);
}

export function PwaProvider({ children, enabled = import.meta.env.PROD }: { children: ReactNode; enabled?: boolean }) {
  const { toast } = useToast();
  const [report, setReport] = useState<RegistrarReport>({ needRefresh: false, offlineReady: false, update: () => {} });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!report.offlineReady) return;
    try {
      if (localStorage.getItem(OFFLINE_FLAG)) return;
      localStorage.setItem(OFFLINE_FLAG, '1');
    } catch {
      /* announce anyway */
    }
    toast('VyayaMitra is ready to work offline.', { tone: 'success' });
  }, [report.offlineReady, toast]);

  useEffect(() => {
    if (report.needRefresh) setDismissed(false);
  }, [report.needRefresh]);

  const dismissUpdate = useCallback(() => setDismissed(true), []);
  const value = useMemo<PwaStatus>(
    () => ({
      needRefresh: report.needRefresh && !dismissed,
      offlineReady: report.offlineReady,
      // Never reload under a running import or restore, even if something calls this directly.
      reload: () => {
        if (!isBusy()) report.update();
      },
      dismissUpdate,
    }),
    [report, dismissed, dismissUpdate],
  );

  return (
    <PwaContext.Provider value={value}>
      {children}
      {enabled && (
        <Suspense fallback={null}>
          <Registrar onReport={setReport} />
        </Suspense>
      )}
    </PwaContext.Provider>
  );
}

/** Slim banner shown in the header when a new version is waiting. */
export function UpdateBanner() {
  const { needRefresh, reload, dismissUpdate } = usePwa();
  const busy = useBusy();
  if (!needRefresh) return null;
  if (busy.length > 0) {
    return (
      <div role="status" className="border-t border-primary/20 bg-primary-soft text-primary print:hidden">
        <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 text-sm font-medium md:px-8">
          <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
          <span>Update ready — will apply after your {busy.includes('restore') ? 'restore' : 'import'}.</span>
        </p>
      </div>
    );
  }
  return (
    <div role="status" className="border-t border-primary/20 bg-primary-soft text-primary print:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5 md:px-8">
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium">A new version of VyayaMitra is ready.</p>
        <Button size="sm" onClick={reload}>
          Reload
        </Button>
        <IconButton label="Later" onClick={dismissUpdate} className="min-h-9 min-w-9 text-primary hover:text-primary">
          <X className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
