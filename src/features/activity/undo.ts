import { deleteRule, renameMerchant, resetTransaction, setTransactionCategory, setTransactionKind, type CorrectionScope } from '@/db/actions';
import type { CategorySource, KindSource, Transaction, TxnKind } from '@/domain/types';
import type { PendingChange } from './useCorrection';

/** What a transaction looked like before a correction, so the correction can be taken back. */
export interface Snapshot {
  id: string;
  category: string;
  categorySource: CategorySource;
  kind: TxnKind;
  kindSource: KindSource;
  merchant: string;
}

export function snapshot(t: Transaction): Snapshot {
  return { id: t.id, category: t.category, categorySource: t.categorySource, kind: t.kind, kindSource: t.kindSource, merchant: t.merchant };
}

/** Automatic decisions come back by resetting; the user's own earlier choices are written back as they were. */
async function restoreOne(change: PendingChange, before: Snapshot): Promise<void> {
  const automatic = before.categorySource !== 'user_txn' && before.kindSource !== 'user';
  if (change.type === 'merchant') {
    await renameMerchant(before.id, before.merchant, 'this');
  } else if (automatic) {
    await resetTransaction(before.id);
  } else if (change.type === 'category') {
    await setTransactionCategory(before.id, before.category, 'this');
  } else {
    await setTransactionKind(before.id, before.kind, 'this');
  }
}

/**
 * Builds the function behind a toast's "Undo" button, or null when the correction cannot be reversed exactly.
 * 'this' and 'selected' restore each row; 'merchant' deletes the rule it created, which reverts the rows it changed.
 */
export function makeUndo(
  change: PendingChange,
  scope: CorrectionScope | 'selected',
  before: readonly Snapshot[],
  ruleId: string | undefined,
): (() => Promise<void>) | null {
  if (scope === 'merchant') {
    if (!ruleId) return null;
    return async () => {
      await deleteRule(ruleId);
    };
  }
  if (before.length === 0) return null;
  return async () => {
    for (const snap of before) await restoreOne(change, snap);
  };
}
