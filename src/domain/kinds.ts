import type { Direction, TxnKind } from './types';

/**
 * How a transaction contributes to the headline metrics.
 *
 * income      — counts toward Income
 * spending    — counts toward Spending (refund credits subtract from it)
 * invested    — counts toward Saved & invested (returns subtract)
 * people_in   — "Received from people": shown separately, NOT counted as income
 * neutral     — moves money between the user's own pockets; excluded everywhere
 *
 * Principle: when unsure, never overstate savings. Unknown debits count as
 * spending (flagged for review); unknown credits are NOT counted as income.
 */
export type MetricBucket = 'income' | 'spending' | 'invested' | 'people_in' | 'neutral';

export function metricBucket(kind: TxnKind, direction: Direction): MetricBucket {
  switch (kind) {
    case 'income':
    case 'interest':
      return 'income';
    case 'expense':
    case 'cash_withdrawal':
    case 'fee':
    case 'loan_payment':
    case 'p2p_out':
    case 'refund':
      return 'spending';
    case 'investment':
    case 'investment_return':
      return 'invested';
    case 'p2p_in':
      return 'people_in';
    case 'unknown':
      return direction === 'debit' ? 'spending' : 'neutral';
    case 'self_transfer':
    case 'card_payment':
    case 'reversal':
    case 'loan_disbursal':
      return 'neutral';
  }
}

/**
 * Signed contribution of a transaction to its bucket, in paise.
 * Spending: debits add, credits (refunds) subtract.
 * Income: credits add, debits subtract (e.g. salary clawback).
 * Invested: investment debits add, returns subtract.
 */
export function signedContribution(kind: TxnKind, direction: Direction, amount: number): number {
  const bucket = metricBucket(kind, direction);
  switch (bucket) {
    case 'income':
    case 'people_in':
      return direction === 'credit' ? amount : -amount;
    case 'spending':
      return direction === 'debit' ? amount : -amount;
    case 'invested':
      return direction === 'debit' ? amount : -amount;
    case 'neutral':
      return 0;
  }
}

export const KIND_LABELS: Record<TxnKind, string> = {
  income: 'Income',
  interest: 'Interest earned',
  expense: 'Spending',
  cash_withdrawal: 'Cash withdrawal',
  fee: 'Fees & charges',
  refund: 'Refund',
  reversal: 'Reversal',
  self_transfer: 'Between my accounts',
  card_payment: 'Card bill payment',
  investment: 'Invested',
  investment_return: 'Investment withdrawal',
  loan_payment: 'Loan EMI',
  loan_disbursal: 'Loan received',
  p2p_out: 'Sent to a person',
  p2p_in: 'Received from a person',
  unknown: 'Needs review',
};

/** Kinds a user may pick when correcting a transaction, in display order. */
export const USER_SELECTABLE_KINDS: TxnKind[] = [
  'expense',
  'income',
  'p2p_out',
  'p2p_in',
  'self_transfer',
  'card_payment',
  'investment',
  'investment_return',
  'loan_payment',
  'refund',
  'cash_withdrawal',
  'fee',
  'interest',
  'reversal',
  'loan_disbursal',
];

/** Kinds whose category is chosen from spending categories. */
export const SPENDING_KINDS: ReadonlySet<TxnKind> = new Set<TxnKind>([
  'expense',
  'p2p_out',
  'refund',
  'unknown',
]);
