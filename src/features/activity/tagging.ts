import { setTransactionsTag } from '@/db/review';
import type { ExpenseTag, FeedbackEvent, Statement, Transaction } from '@/domain/types';
import { useToast } from '@/ui';
import { isEstimated, isExtractionIssue, isUserDecided } from './reviewKinds';
import { errorMessage } from './useCorrection';

export interface StateChip {
  label: string;
  on: boolean;
  /** Warning chips are only shown when they apply. */
  warning?: boolean;
  offLabel?: string;
}

/** Six separate facts about a transaction. Deliberately not collapsed into one confidence number. */
export function stateChips(txn: Transaction, statement: Statement | undefined, history: readonly FeedbackEvent[] | undefined): StateChip[] {
  return [
    { label: 'Imported', on: true },
    { label: 'Reconciled', on: statement?.reconciliation.status === 'balanced', offLabel: 'Not reconciled' },
    { label: 'Categorized', on: txn.categorySource !== 'none', offLabel: 'Not categorized' },
    { label: 'Reviewed', on: isUserDecided(txn) || Boolean(history?.some((e) => e.action === 'confirm')), offLabel: 'Not reviewed' },
    { label: 'Estimated', on: isEstimated(txn), warning: true },
    { label: 'Incomplete', on: isExtractionIssue(txn), warning: true },
  ];
}

export const TAG_OPTIONS: { value: ExpenseTag | ''; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'planned', label: 'Planned' },
  { value: 'exceptional', label: 'Exceptional' },
  { value: 'reimbursable', label: 'Reimbursable' },
];

/** Tag these transactions and offer to put every one of them back exactly as it was. */
export function useTagging() {
  const { toast } = useToast();
  return async (txns: readonly Transaction[], tag: ExpenseTag | null) => {
    const ids = txns.map((t) => t.id);
    if (ids.length === 0) return;
    try {
      await setTransactionsTag(ids, tag);
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
      return;
    }
    // Restore per previous value, because one call applies one tag to many rows.
    const before = new Map<ExpenseTag | null, string[]>();
    for (const t of txns) before.set(t.tag ?? null, [...(before.get(t.tag ?? null) ?? []), t.id]);
    toast(tag ? `Tagged ${ids.length} as ${tag}` : `Removed the tag from ${ids.length}`, {
      tone: 'success',
      action: {
        label: 'Undo',
        onClick: () => {
          Promise.all([...before.entries()].map(([prev, group]) => setTransactionsTag(group, prev))).then(
            () => toast('Tag change undone', { tone: 'success' }),
            (e: unknown) => toast(errorMessage(e), { tone: 'error' }),
          );
        },
      },
    });
  };
}

