import { useCallback, useMemo } from 'react';
import { usePeriod } from '@/app/period';
import { useScopedLedger } from '@/app/scope';
import { applyQuery } from '@/engine/analytics';
import { todayIso } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { usePrivacy } from '@/ui';

/** Everything an Explore view needs: the ledger, the shared period, its transactions and the scope line. */
export function useExploreData() {
  const ledger = useScopedLedger();
  const { period } = usePeriod();
  const today = useMemo(() => todayIso(), []);
  const n = ledger.accounts.length;
  const scope = `${period.label} · ${ledger.scoped ? (n === 1 ? ledger.accounts[0].name : `${n} selected accounts`) : `${n} account${n === 1 ? '' : 's'}`}`;
  const periodTxns = useMemo(
    () => (ledger.ready ? applyQuery(ledger.transactions, { start: period.start, end: period.end }) : []),
    [ledger.ready, ledger.transactions, period.start, period.end],
  );
  return { ...ledger, period, today, scope, periodTxns };
}


/** Money as text for labels, tables and chart ticks; masked when "hide amounts" is on (use <Money> for visible JSX). */
export function useFmt() {
  const { hideAmounts } = usePrivacy();
  return useCallback(
    (v: number, o?: { whole?: boolean; compact?: boolean }) => (hideAmounts ? '₹ ••••' : formatINR(v, o)),
    [hideAmounts],
  );
}

/** True when the hide-amounts toggle is on (chart axes show •••• instead of values). */
export function useHideAmounts(): boolean {
  return usePrivacy().hideAmounts;
}

/** Masks rupee amounts inside engine-written sentences when "hide amounts" is on. */
export function useMask(): (text: string) => string {
  const hidden = useHideAmounts();
  return useCallback((text: string) => (hidden ? text.replace(/[₹]\s?[\d,]+(\.\d+)?/g, '₹ ••••') : text), [hidden]);
}
