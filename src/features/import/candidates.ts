import type { Account, RowWarning, Transaction } from '@/domain/types';
import type { PreviewRow } from '@/engine/import';
import { daysBetween } from '@/lib/dates';

export const TRANSFER_WINDOW_DAYS = 3;

export interface TransferCandidate {
  row: PreviewRow;
  other: Transaction;
  otherAccount?: Account;
  /** Absolute days between the two legs. */
  daysApart: number;
  /** Either side is a credit card, so this reads as a card bill payment rather than a transfer. */
  cardRepayment: boolean;
}

/**
 * Rows of the incoming statement that look like the other leg of something already in the ledger: the same
 * amount, the opposite direction, within a few days, in a different account of the user's own, and not yet linked.
 * Purely a hint for the review screen; the importer does the actual linking after commit.
 */
export function findTransferCandidates(
  rows: readonly PreviewRow[],
  targetAccountId: string | undefined,
  ledger: readonly Transaction[],
  accounts: readonly Account[],
  targetType?: Account['type'],
): TransferCandidate[] {
  const out: TransferCandidate[] = [];
  for (const row of rows) {
    if (row.duplicateOf !== undefined) continue;
    let best: { t: Transaction; days: number } | null = null;
    for (const t of ledger) {
      if (t.accountId === targetAccountId || t.linkedTxnId) continue;
      if (t.amount !== row.row.amount || t.direction === row.row.direction) continue;
      const days = Math.abs(daysBetween(row.row.date, t.date));
      if (days > TRANSFER_WINDOW_DAYS) continue;
      if (!best || days < best.days) best = { t, days };
    }
    if (best) {
      const otherAccount = accounts.find((a) => a.id === best!.t.accountId);
      out.push({
        row,
        other: best.t,
        otherAccount,
        daysApart: best.days,
        cardRepayment: targetType === 'credit_card' || otherAccount?.type === 'credit_card',
      });
    }
  }
  return out;
}

/** Warnings that mean the amount or its direction may be wrong, which decide whether money goes in or out. */
export const UNCERTAIN_WARNINGS: ReadonlySet<RowWarning> = new Set<RowWarning>(['balance_break', 'ambiguous_amount', 'direction_from_balance']);
export const isUncertain = (r: PreviewRow) => r.row.warnings.some((w) => UNCERTAIN_WARNINGS.has(w));
