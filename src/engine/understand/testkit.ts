/**
 * Shared helpers for the understanding/matching tests. All names, numbers and handles are invented.
 */
import type { Account, Direction, Transaction, UserRule } from '@/domain/types';
import { understand, type UnderstandContext, type Understanding } from './index';

export const HOLDER = 'ANIL KUMAR RAO';

export function makeAccount(id: string, type: Account['type'], mask: string, holderName: string | null = HOLDER, name = id): Account {
  return { id, name, institution: 'ICICI', type, mask, holderName: holderName ?? undefined, currency: 'INR', createdAt: '2024-01-01T00:00:00.000Z' };
}

export const SAVINGS = makeAccount('savings', 'savings', '1357', HOLDER, 'ICICI Savings ••1357');
export const SECOND = makeAccount('second', 'savings', '2468', 'RAO ANIL KUMAR', 'DBS Savings ••2468');
export const CARD = makeAccount('card', 'credit_card', '8642', HOLDER, 'ICICI Card ••8642');
export const OWN = [SAVINGS, SECOND, CARD];

export function ctxFor(account: Account, overrides: Partial<UnderstandContext> = {}): UnderstandContext {
  return { account, ownAccounts: OWN, rules: [], p2pReviewThreshold: 500_000, ...overrides };
}

export function run(
  description: string,
  direction: Direction = 'debit',
  opts: { account?: Account; amount?: number; ctx?: Partial<UnderstandContext>; date?: string } = {},
): Understanding {
  const account = opts.account ?? SAVINGS;
  return understand(
    { description, direction, amount: opts.amount ?? 150_000, date: opts.date ?? '2024-06-10' },
    ctxFor(account, opts.ctx),
  );
}

export function makeRule(partial: Partial<UserRule> & Pick<UserRule, 'match' | 'set'>): UserRule {
  return { id: 'r1', enabled: true, createdAt: '2024-01-01T00:00:00.000Z', ...partial };
}

let seq = 0;
export function makeTxn(partial: Partial<Transaction> & Pick<Transaction, 'accountId' | 'direction' | 'amount' | 'date'>): Transaction {
  seq += 1;
  const id = partial.id ?? `t${seq}`;
  return {
    id,
    statementId: 's1',
    rawDescription: '',
    channel: 'OTHER',
    counterparty: { type: 'unknown' },
    merchant: '',
    merchantKey: '',
    kind: 'unknown',
    kindSource: 'heuristic',
    category: 'uncategorized',
    categorySource: 'none',
    confidence: 0,
    reasons: [],
    needsReview: true,
    reviewReasons: [],
    fingerprint: `fp-${id}`,
    source: { page: 1, lineStart: 0, lineEnd: 0, rawLines: [] },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

/** Build a Transaction whose understanding fields come from the real `understand()`. */
export function understood(
  id: string,
  description: string,
  direction: Direction,
  amount: number,
  date: string,
  account: Account,
  extra: Partial<Transaction> = {},
): Transaction {
  const u = understand({ description, direction, amount, date }, ctxFor(account));
  return makeTxn({
    id,
    accountId: account.id,
    direction,
    amount,
    date,
    rawDescription: description,
    channel: u.channel,
    counterparty: u.counterparty,
    merchant: u.merchant,
    merchantKey: u.merchantKey,
    kind: u.kind,
    kindSource: u.kindSource,
    category: u.category,
    categorySource: u.categorySource,
    confidence: u.confidence,
    reasons: u.reasons,
    needsReview: u.needsReview,
    reviewReasons: u.reviewReasons,
    ...extra,
  });
}

/** Apply link updates to a ledger, as the app would persist them. */
export function applyUpdates(txns: readonly Transaction[], updates: ReadonlyArray<{ txnId: string; patch: Partial<Transaction> }>): Transaction[] {
  const byId = new Map(updates.map((u) => [u.txnId, u.patch]));
  return txns.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
}
