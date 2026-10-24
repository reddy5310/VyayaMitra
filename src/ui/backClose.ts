/**
 * Make the platform Back gesture (Android back button, browser Back) close the topmost sheet or
 * full-screen task instead of leaving the screen underneath it.
 *
 * While `open`, one history entry is pushed (same URL, so the hash router is unaffected). Back pops it and
 * closes the topmost task; closing in the UI removes the entry again. A module-level stack keeps nested
 * sheets in order, so one Back closes exactly one.
 */
import { useEffect, useRef } from 'react';

interface Entry {
  id: number;
  close: () => void;
}

const stack: Entry[] = [];
let nextId = 1;
let ignorePops = 0;
let listening = false;

function onPop(): void {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = stack.pop();
  top?.close();
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPop);
  listening = true;
}

export function useBackClose(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const entry: Entry = { id: nextId++, close: () => closeRef.current() };
    let pushed = false;
    // Deferred a tick so React StrictMode's mount/unmount/mount probe never touches the history.
    const timer = setTimeout(() => {
      try {
        // Keep the router's own state (key/idx) on our entry so it still recognises it.
        window.history.pushState({ ...(window.history.state ?? {}), vmSheet: entry.id }, '');
        ensureListener();
        stack.push(entry);
        pushed = true;
      } catch {
        /* history unavailable: Back simply behaves as before */
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      if (!pushed) return;
      const i = stack.indexOf(entry);
      if (i === -1) return; // already consumed by Back
      stack.splice(i, 1);
      // Closed from the UI: drop our entry, but only if nothing navigated on top of it.
      if (window.history.state?.vmSheet === entry.id) {
        ignorePops++;
        window.history.back();
      }
    };
  }, [open]);
}
