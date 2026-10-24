import { institutionById } from '@/domain/institutions';
import type { Account, AccountType, Institution, ParsedStatement } from '@/domain/types';

export type NewAccountInput = Omit<Account, 'id' | 'createdAt'>;

/** Short label for account names; 'OTHER' reads better as "Bank". */
function institutionLabel(id: Institution): string {
  return id === 'OTHER' ? 'Bank' : institutionById(id).short;
}

const TYPE_LABEL: Record<AccountType, string> = {
  savings: 'Savings',
  current: 'Current',
  credit_card: 'Credit Card',
  wallet: 'Wallet',
  loan: 'Loan',
  investment: 'Investment',
  cash: 'Cash',
};

/** Every distinct last-4 the statement mentions: primary account/card mask first, then add-on cards. */
export function statementMasks(parsed: Pick<ParsedStatement, 'accountMask' | 'cardMasks'>): string[] {
  return [...new Set([parsed.accountMask, ...(parsed.cardMasks ?? [])].filter((m): m is string => !!m))];
}

export function accountMasks(account: Pick<Account, 'mask' | 'extraMasks'>): string[] {
  return [...new Set([account.mask, ...(account.extraMasks ?? [])].filter((m): m is string => !!m))];
}

/**
 * The existing account this statement belongs to: same institution and type, and a shared mask
 * (primary or add-on card). A statement with no printed mask matches only when exactly one
 * mask-less account of that institution and type exists.
 */
export function findMatchingAccount(accounts: readonly Account[], parsed: ParsedStatement): Account | undefined {
  const sameKind = accounts.filter((a) => a.institution === parsed.institution && a.type === parsed.accountType);
  const masks = statementMasks(parsed);
  if (masks.length === 0) {
    const maskless = sameKind.filter((a) => accountMasks(a).length === 0);
    return maskless.length === 1 ? maskless[0] : undefined;
  }
  const hits = sameKind.filter((a) => accountMasks(a).some((m) => masks.includes(m)));
  if (hits.length === 0) return undefined;
  const primary = parsed.accountMask;
  return (
    hits.find((a) => !a.archived && a.mask === primary) ??
    hits.find((a) => !a.archived) ??
    hits[0]
  );
}

/** Other existing accounts that could plausibly be the right home (same institution and type). */
export function candidateAccounts(accounts: readonly Account[], parsed: ParsedStatement, chosenId?: string): string[] {
  return accounts
    .filter((a) => a.id !== chosenId && a.institution === parsed.institution && a.type === parsed.accountType)
    .map((a) => a.id);
}

export function proposeAccount(parsed: ParsedStatement): NewAccountInput {
  const masks = statementMasks(parsed);
  const mask = masks[0];
  const base = `${institutionLabel(parsed.institution)} ${TYPE_LABEL[parsed.accountType]}`;
  const proposed: NewAccountInput = {
    name: mask ? `${base} ••${mask}` : base,
    institution: parsed.institution,
    type: parsed.accountType,
    currency: 'INR',
  };
  if (mask) proposed.mask = mask;
  if (masks.length > 1) proposed.extraMasks = masks.slice(1);
  if (parsed.holderName) proposed.holderName = parsed.holderName;
  return proposed;
}

export function accountToInput(account: Account): NewAccountInput {
  const { id: _id, createdAt: _createdAt, ...rest } = account;
  return rest;
}
