import { formatDate } from '@/lib/dates';
import type { CategorySource, CounterpartyType, KindSource, Transaction } from '@/domain/types';

export function percentText(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

/** Where the category decision came from, kept separate from how sure we are. */
export function categorySourceLabel(source: CategorySource, confidence: number): string {
  switch (source) {
    case 'user_txn':
      return 'You set this';
    case 'user_rule':
      return 'Remembered rule';
    case 'builtin_rule':
      return `Built-in rule · ${percentText(confidence)} confident`;
    case 'learned':
      return `Learned from your choices · ${percentText(confidence)}`;
    case 'kind_default':
      return `Implied by the type · ${percentText(confidence)} confident`;
    case 'none':
      return 'Needs review';
  }
}

export function kindSourceLabel(source: KindSource, confidence: number): string {
  switch (source) {
    case 'user':
      return 'You set this';
    case 'user_rule':
      return 'Remembered rule';
    case 'rule':
      return `Built-in rule · ${percentText(confidence)} confident`;
    case 'match':
      return 'Matched with another transaction';
    case 'heuristic':
      return `Best guess · ${percentText(confidence)} confident`;
  }
}

export const COUNTERPARTY_LABELS: Record<CounterpartyType, string> = {
  merchant: 'Merchant',
  person: 'Person',
  own_account: 'Your own account',
  bank: 'Bank',
  employer: 'Employer',
  investment_platform: 'Investment platform',
  lender: 'Lender',
  government: 'Government',
  unknown: 'Unknown',
};

/** One plain sentence describing how two linked transactions relate. */
export function linkExplanation(
  txn: Pick<Transaction, 'linkRole'>,
  linked: Pick<Transaction, 'date' | 'accountId'> | null | undefined,
  accountName: (accountId: string) => string,
): string {
  const where = linked ? `${accountName(linked.accountId)} on ${formatDate(linked.date, { short: true })}` : 'another transaction';
  switch (txn.linkRole) {
    case 'card_payment_out':
      return `Card bill payment matched with ${where}`;
    case 'card_payment_in':
      return `Card payment received, matched with the bank debit in ${where}`;
    case 'transfer_out':
      return `Transfer to your own account matched with ${where}`;
    case 'transfer_in':
      return `Transfer from your own account matched with ${where}`;
    case 'refund_of':
      return `Refund matched with the original purchase in ${where}`;
    case 'refunded_by':
      return `Refunded by the credit in ${where}`;
    case 'reversal':
      return `Reversal matched with ${where}`;
    default:
      return `Linked with ${where}`;
  }
}

export function correctionMessage(
  scope: 'this' | 'merchant',
  updated: number,
  merchant: string,
): string {
  if (scope === 'this') return 'Updated this transaction';
  const n = `${updated} transaction${updated === 1 ? '' : 's'}`;
  return `Updated ${n} and remembered for ${merchant}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekdayName(day: number): string {
  return WEEKDAYS[day] ?? '';
}
