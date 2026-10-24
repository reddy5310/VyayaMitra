import { useMemo } from 'react';
import { useLedger, type Ledger } from '@/db/hooks';
import { usePeriod } from './period';

/**
 * The ledger narrowed to the account scope chosen in the header ("All accounts ▾").
 * Overview and Explore read through this so every total, chart, coverage note and
 * data-through date describes the same accounts. `scoped` is true when a subset is selected.
 */
export function useScopedLedger(): Ledger & { scoped: boolean } {
  const ledger = useLedger();
  const { accountIds } = usePeriod();
  return useMemo(() => {
    if (!accountIds || accountIds.length === 0) return { ...ledger, scoped: false };
    const ids = new Set(accountIds);
    const accounts = ledger.accounts.filter((a) => ids.has(a.id));
    // A stored scope can outlive deleted accounts; fall back to everything rather than show an empty app.
    if (accounts.length === 0) return { ...ledger, scoped: false };
    return {
      ...ledger,
      accounts,
      statements: ledger.statements.filter((s) => ids.has(s.accountId)),
      transactions: ledger.transactions.filter((t) => ids.has(t.accountId)),
      scoped: true,
    };
  }, [ledger, accountIds]);
}
