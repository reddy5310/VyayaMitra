import { useState } from 'react';
import type { CorrectionScope } from '@/db/actions';
import type { Transaction } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Button, Money } from '@/ui';

const PREVIEW_LIMIT = 8;

/**
 * Asks whether a change applies to one transaction, to the ticked ones, or to every transaction from the same
 * merchant. Anything that would change more than one row shows those rows first and needs a second tap.
 */
export function CorrectionPrompt({
  change,
  merchant,
  merchantRows,
  busy,
  error,
  onChoose,
  selectedRows,
  onChooseSelected,
  onCancel,
}: {
  /** e.g. "Change category to Food & dining" */
  change: string;
  merchant: string;
  /** Every transaction with this merchant (including the one being corrected). */
  merchantRows: readonly Transaction[];
  busy: boolean;
  error?: string | null;
  onChoose: (scope: CorrectionScope) => void;
  /** Multi-select within a group: the ticked rows, and the handler for "these selected". */
  selectedRows?: readonly Transaction[];
  onChooseSelected?: () => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState<'merchant' | 'selected' | null>(null);
  const others = merchantRows.length - 1;
  const othersText =
    others <= 0 ? 'No other transactions yet; future ones will follow this too' : `${others} other transaction${others === 1 ? '' : 's'} match`;
  const selectedCount = selectedRows?.length ?? 0;

  if (confirming) {
    const rows = confirming === 'merchant' ? merchantRows : (selectedRows ?? []);
    const run = () => (confirming === 'merchant' ? onChoose('merchant') : onChooseSelected?.());
    return (
      <div role="group" aria-label="Rows that will change" className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft/40 p-3">
        <p className="text-sm font-medium text-fg">
          {change}: this changes {rows.length} transactions
          {confirming === 'merchant' ? ' now, and remembers it for future ones' : ''}
        </p>
        <ul className="divide-y divide-border rounded-lg bg-surface text-sm">
          {rows.slice(0, PREVIEW_LIMIT).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0 truncate text-fg">
                {formatDate(t.date, { short: true })} · {t.merchant}
              </span>
              <Money value={t.amount} direction={t.direction} tone="direction" className="shrink-0" />
            </li>
          ))}
        </ul>
        {rows.length > PREVIEW_LIMIT && <p className="text-xs text-fg-muted">and {rows.length - PREVIEW_LIMIT} more</p>}
        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={run}>
            Change {rows.length} transactions
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
            Back
          </Button>
        </div>
        <p className="text-xs text-fg-muted">You can undo this right after.</p>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Apply this change to" className="space-y-2 rounded-xl border border-primary/40 bg-primary-soft/40 p-3">
      <p className="text-sm font-medium text-fg">{change}</p>
      <div className={onChooseSelected ? 'grid gap-2 sm:grid-cols-3' : 'grid gap-2 sm:grid-cols-2'}>
        <Button variant="outline" disabled={busy} onClick={() => onChoose('this')}>
          Apply to this transaction
        </Button>
        {onChooseSelected && (
          <Button
            variant="outline"
            disabled={busy || selectedCount === 0}
            onClick={() => (selectedCount > 1 ? setConfirming('selected') : onChooseSelected())}
          >
            Apply to these {selectedCount} selected
          </Button>
        )}
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => (merchantRows.length > 1 ? setConfirming('merchant') : onChoose('merchant'))}
          className="h-auto py-2"
        >
          <span className="text-left">
            <span className="block">Remember for “{merchant}”</span>
            <span className="block text-xs font-normal opacity-90">{othersText}</span>
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
