import { Button } from '@/ui';
import type { CorrectionScope } from '@/db/actions';

/**
 * Asks whether a change applies to one transaction or to every transaction from the same merchant.
 * `otherCount` is computed from the ledger with the same merchantKey, so the number is exact.
 */
export function CorrectionPrompt({
  change,
  merchant,
  otherCount,
  busy,
  error,
  onChoose,
  selectedCount,
  onChooseSelected,
  onCancel,
}: {
  /** e.g. "Change category to Food & dining" */
  change: string;
  merchant: string;
  otherCount: number;
  busy: boolean;
  error?: string | null;
  onChoose: (scope: CorrectionScope) => void;
  /** Multi-select within a group: how many rows are ticked, and the handler for "these selected". */
  selectedCount?: number;
  onChooseSelected?: () => void;
  onCancel: () => void;
}) {
  const others =
    otherCount === 0
      ? 'No other transactions yet; future ones will follow this too'
      : `${otherCount} other transaction${otherCount === 1 ? '' : 's'} match`;
  return (
    <div role="group" aria-label="Apply this change to" className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft/40 p-3">
      <p className="text-sm font-medium text-fg">{change}</p>
      <div className={onChooseSelected ? "grid gap-2 sm:grid-cols-3" : "grid gap-2 sm:grid-cols-2"}>
        <Button variant="outline" disabled={busy} onClick={() => onChoose('this')}>
          Apply to this transaction
        </Button>
        {onChooseSelected && (
          <Button variant="outline" disabled={busy || !selectedCount} onClick={onChooseSelected}>
            Apply to these {selectedCount ?? 0} selected
          </Button>
        )}
        <Button variant="primary" disabled={busy} onClick={() => onChoose('merchant')} className="h-auto py-2">
          <span className="text-left">
            <span className="block">Remember for “{merchant}”</span>
            <span className="block text-xs font-normal opacity-90">{others}</span>
          </span>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
