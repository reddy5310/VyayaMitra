/**
 * BUSY FLAG — keeps the app from reloading itself while a long, non-resumable task is running.
 *
 * A task that must not be interrupted (the import wizard, a backup restore) marks the app busy:
 *
 *   import { setBusy } from '@/app/busy';
 *   useEffect(() => { setBusy('import', true); return () => setBusy('import', false); }, []);
 *   // or around an async job:  setBusy('restore', true); try { await restore(); } finally { setBusy('restore', false); }
 *
 * While any reason is active the PWA update banner says "Update ready — will apply after your import"
 * and no reload is performed or offered. Setting the same reason twice is harmless, and each reason
 * clears independently. `useBusy()` returns the active reasons (empty array = idle); `isBusy()` is the
 * non-reactive check.
 */
import { useSyncExternalStore } from 'react';

export type BusyReason = 'import' | 'restore';

const active = new Set<BusyReason>();
let snapshot: readonly BusyReason[] = [];
const listeners = new Set<() => void>();

export function setBusy(reason: BusyReason, on: boolean): void {
  if (on === active.has(reason)) return;
  if (on) active.add(reason);
  else active.delete(reason);
  snapshot = [...active];
  listeners.forEach((l) => l());
}

export function isBusy(): boolean {
  return active.size > 0;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Active busy reasons; empty when idle. */
export function useBusy(): readonly BusyReason[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
