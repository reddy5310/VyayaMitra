import { useCallback, useMemo, useState } from 'react';
import {
  renameMerchant,
  setTransactionCategory,
  setTransactionKind,
  type CorrectionScope,
} from '@/db/actions';
import type { Transaction, TxnKind } from '@/domain/types';
import { useToast } from '@/ui';
import { setCategoryForSelected, setKindForSelected } from './bulk';
import { correctionMessage } from './labels';

export type PendingChange =
  | { type: 'category'; value: string; label: string }
  | { type: 'kind'; value: TxnKind; label: string }
  | { type: 'merchant'; value: string; label: string };

export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.';
}

/**
 * Shared "just this one vs always for this merchant" flow used by the detail sheet and review queue.
 * A change is first *requested* (nothing is written), then applied with the chosen scope.
 */
export function useCorrection(
  txn: Transaction | null | undefined,
  allTxns: readonly Transaction[],
  onApplied?: (change: PendingChange, scope: CorrectionScope | 'selected', ids?: string[]) => Promise<void> | void,
) {
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const txnId = txn?.id;
  const merchantKey = txn?.merchantKey;
  const otherCount = useMemo(
    () => (txnId && merchantKey ? allTxns.filter((t) => t.id !== txnId && t.merchantKey === merchantKey).length : 0),
    [allTxns, txnId, merchantKey],
  );

  const request = useCallback((change: PendingChange) => {
    setError(null);
    setPending(change);
  }, []);
  const cancel = useCallback(() => {
    setError(null);
    setPending(null);
  }, []);

  const apply = useCallback(
    async (scope: CorrectionScope) => {
      if (!txn || !pending) return;
      setBusy(true);
      setError(null);
      try {
        const result =
          pending.type === 'category'
            ? await setTransactionCategory(txn.id, pending.value, scope)
            : pending.type === 'kind'
              ? await setTransactionKind(txn.id, pending.value, scope)
              : await renameMerchant(txn.id, pending.value, scope);
        toast(correctionMessage(scope, result.updated, txn.merchant), { tone: 'success' });
        const applied = pending;
        setPending(null);
        await onApplied?.(applied, scope);
      } catch (e) {
        const msg = errorMessage(e);
        setError(msg);
        toast(msg, { tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [txn, pending, toast, onApplied],
  );

  /** Apply a category or type change to exactly these transactions (the group's checked rows). */
  const applySelected = useCallback(
    async (ids: string[]) => {
      if (!pending || pending.type === 'merchant' || ids.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        if (pending.type === 'category') await setCategoryForSelected(ids, pending.value);
        else await setKindForSelected(ids, pending.value);
        toast(`Updated ${ids.length} selected transaction${ids.length === 1 ? '' : 's'}`, { tone: 'success' });
        const applied = pending;
        setPending(null);
        await onApplied?.(applied, 'selected', ids);
      } catch (e) {
        const msg = errorMessage(e);
        setError(msg);
        toast(msg, { tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [pending, toast, onApplied],
  );

  return { pending, request, cancel, apply, applySelected, busy, error, otherCount };
}
