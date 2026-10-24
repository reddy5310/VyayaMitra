/**
 * Shared live reads. Every component that needs the ledger used to run its own Dexie liveQuery and
 * its own sort (≈0.5 s per read at 50k rows). A LiveStore runs ONE liveQuery per data set, sorts once
 * per change, and hands the same array to every subscriber through useSyncExternalStore.
 *
 * The subscription stays alive for a short grace period after the last subscriber leaves, so moving
 * between screens re-uses the warm result instead of re-reading the database.
 */
import { liveQuery, type Subscription } from 'dexie';
import { db, onDatabaseReset } from './db';

const GRACE_MS = 2000;
const RETRY_MS = 500;

export interface LiveStore<T> {
  subscribe(listener: () => void): () => void;
  /** `undefined` until the first result arrives. The same reference is returned until the data changes. */
  getSnapshot(): T | undefined;
}

interface Controller {
  reset(phase: 'before' | 'after'): void;
  isOpen(): boolean;
}

const controllers = new Set<Controller>();
onDatabaseReset((phase) => {
  for (const c of controllers) c.reset(phase);
});

/** Number of liveQuery subscriptions currently open (diagnostics and tests). */
export function openStoreCount(): number {
  let n = 0;
  for (const c of controllers) if (c.isOpen()) n++;
  return n;
}

export function createLiveStore<T>(query: () => Promise<T>, onIdle?: () => void): LiveStore<T> {
  let value: T | undefined;
  let sub: Subscription | undefined;
  let boundTo = '';
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };

  const stop = () => {
    sub?.unsubscribe();
    sub = undefined;
    clearTimeout(retryTimer);
  };
  const start = () => {
    boundTo = db.name;
    sub = liveQuery(query).subscribe({
      next: (v) => {
        value = v;
        emit();
      },
      error: (e) => {
        console.warn('Live query failed; retrying', e);
        stop();
        if (listeners.size > 0) retryTimer = setTimeout(start, RETRY_MS);
      },
    });
  };

  const controller: Controller = {
    isOpen: () => sub !== undefined,
    reset(phase) {
      if (phase === 'before') {
        stop();
        return;
      }
      value = undefined;
      emit();
      if (listeners.size > 0) start();
    },
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      controllers.add(controller);
      clearTimeout(graceTimer);
      if (sub && boundTo !== db.name) {
        stop();
        value = undefined;
      }
      if (!sub) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        graceTimer = setTimeout(() => {
          if (listeners.size > 0) return;
          stop();
          value = undefined;
          controllers.delete(controller);
          onIdle?.();
        }, GRACE_MS);
        (graceTimer as { unref?: () => void }).unref?.();
      };
    },
    getSnapshot: () => value,
  };
}

/** Stores keyed by parameters (e.g. a date range); each is removed once nobody uses it. */
export function createKeyedStores<T>(make: (key: string) => () => Promise<T>) {
  const stores = new Map<string, LiveStore<T>>();
  return (key: string): LiveStore<T> => {
    let s = stores.get(key);
    if (!s) {
      s = createLiveStore(make(key), () => stores.delete(key));
      stores.set(key, s);
    }
    return s;
  };
}
