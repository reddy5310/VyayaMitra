import { useState } from 'react';
import { exitSampleData, useSampleMode } from './sample';

/**
 * Persistent notice shown while sample data is active. Renders nothing otherwise.
 * Mount once, at the top of the app shell, outside any route.
 */
export function SampleBanner() {
  const sample = useSampleMode();
  const [busy, setBusy] = useState(false);
  if (!sample) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-warning bg-warning-soft px-4 py-2 text-sm text-fg"
    >
      <span className="font-medium">Sample data — not your money</span>
      <button
        type="button"
        disabled={busy}
        className="rounded-md border border-warning px-3 py-1 text-sm font-medium hover:bg-surface disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          void exitSampleData().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Exiting…' : 'Exit sample data'}
      </button>
    </div>
  );
}
