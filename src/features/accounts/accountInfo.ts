import type { Account, AccountType, IsoDate, Statement } from '@/domain/types';
import { addMonths, monthKey, monthsBetween, todayIso } from '@/lib/dates';

/** The last `count` calendar months ending with the current one. */
export function coverageMonths(today: IsoDate = todayIso(), count = 12): string[] {
  const current = monthKey(today);
  return monthsBetween(addMonths(current, -(count - 1)), current);
}

export type AccountGroupId = 'bank' | 'cards' | 'other';
export const GROUP_LABELS: Record<AccountGroupId, string> = { bank: 'Bank accounts', cards: 'Credit cards', other: 'Other' };

export function accountGroup(type: AccountType): AccountGroupId {
  if (type === 'savings' || type === 'current') return 'bank';
  if (type === 'credit_card') return 'cards';
  return 'other';
}

/** Latest date any statement of the account covers. */
export function dataThrough(accountId: string, statements: readonly Statement[]): IsoDate | null {
  let latest: IsoDate | null = null;
  for (const s of statements) {
    if (s.accountId !== accountId || !s.periodEnd) continue;
    if (!latest || s.periodEnd > latest) latest = s.periodEnd;
  }
  return latest;
}

export function groupAccounts(accounts: readonly Account[]): { id: AccountGroupId; accounts: Account[] }[] {
  const order: AccountGroupId[] = ['bank', 'cards', 'other'];
  return order
    .map((id) => ({ id, accounts: accounts.filter((a) => !a.archived && accountGroup(a.type) === id) }))
    .filter((g) => g.accounts.length > 0);
}
