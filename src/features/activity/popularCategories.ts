import type { Transaction } from '@/domain/types';

const DEFAULTS_DEBIT = ['food_dining', 'groceries', 'shopping', 'transport', 'utilities', 'entertainment'];
const DEFAULTS_CREDIT = ['other_income', 'refunds', 'received_from_people', 'salary', 'interest_income'];

/** Popular categories to offer as extra chips: this merchant's past choices, then the user's most used. */
export function popularCategories(txn: Transaction, all: readonly Transaction[], limit = 6): string[] {
  const score = new Map<string, number>();
  for (const t of all) {
    if (t.id === txn.id || t.direction !== txn.direction || t.category === 'uncategorized' || t.categorySource === 'none') continue;
    const weight = t.merchantKey === txn.merchantKey ? 100 : 1;
    score.set(t.category, (score.get(t.category) ?? 0) + weight);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const defaults = txn.direction === 'credit' ? DEFAULTS_CREDIT : DEFAULTS_DEBIT;
  const out: string[] = [];
  for (const id of [...ranked, ...defaults]) {
    if (id !== txn.category && !out.includes(id)) out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
