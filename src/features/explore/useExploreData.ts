import { useMemo } from 'react';
import { usePeriod } from '@/app/period';
import { useLedger } from '@/db/hooks';
import { applyQuery } from '@/engine/analytics';
import { todayIso } from '@/lib/dates';

/** Everything an Explore view needs: the ledger, the shared period, its transactions and the scope line. */
export function useExploreData() {
  const ledger = useLedger();
  const { period } = usePeriod();
  const today = useMemo(() => todayIso(), []);
  const n = ledger.accounts.length;
  const scope = `${period.label} · ${n} account${n === 1 ? '' : 's'}`;
  const periodTxns = useMemo(
    () => (ledger.ready ? applyQuery(ledger.transactions, { start: period.start, end: period.end }) : []),
    [ledger.ready, ledger.transactions, period.start, period.end],
  );
  return { ...ledger, period, today, scope, periodTxns };
}

