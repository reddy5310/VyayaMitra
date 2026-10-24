import { useEffect, useId, useState } from 'react';
import { Keyboard } from 'lucide-react';

const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'j / k', does: 'Next / previous transaction' },
  { keys: 'Enter', does: 'Open the selected transaction' },
  { keys: '/', does: 'Search' },
  { keys: 'Esc', does: 'Close details' },
  { keys: '?', does: 'Show this help' },
];

/** Keyboard users on wide screens get a discoverable cheat sheet; screen readers get the same list as text. */
export function ShortcutHelp({ openSignal }: { openSignal: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (openSignal > 0) setOpen((v) => !v);
  }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative hidden justify-end lg:flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-keyshortcuts="?"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg"
      >
        <Keyboard className="h-4 w-4" aria-hidden />
        Keyboard shortcuts
      </button>
      <div
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-border bg-surface p-3 text-sm shadow-sheet"
      >
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-fg-muted">{s.does}</span>
              <kbd className="rounded-md border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
