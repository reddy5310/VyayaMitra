// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDatabaseForTests } from './db';
import { useAccounts, useLedger, useTransactions, useTransactionsInRange } from './hooks';
import { openStoreCount } from './store';
import { makeAccount, makeTxn } from './testkit';

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.restoreAllMocks();
});

async function seed() {
  await db.accounts.add(makeAccount());
  await db.transactions.bulkAdd([
    makeTxn({ id: 'jan', date: '2025-01-15' }),
    makeTxn({ id: 'feb1', date: '2025-02-01' }),
    makeTxn({ id: 'feb2', date: '2025-02-20' }),
    makeTxn({ id: 'mar', date: '2025-03-05' }),
  ]);
}

describe('shared ledger reads', () => {
  it('two subscribers share one query and one array', async () => {
    await seed();
    const spy = vi.spyOn(db.transactions, 'toArray');
    const a = renderHook(() => useTransactions());
    const b = renderHook(() => useTransactions());
    const ledger = renderHook(() => useLedger());
    await waitFor(() => expect(a.result.current).toHaveLength(4));
    await waitFor(() => expect(b.result.current).toHaveLength(4));
    await waitFor(() => expect(ledger.result.current.ready).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.result.current).toBe(b.result.current);
    expect(ledger.result.current.transactions).toBe(a.result.current);
    expect(a.result.current!.map((t) => t.id)).toEqual(['mar', 'feb2', 'feb1', 'jan']);
  });

  it('one write triggers one re-read for all subscribers', async () => {
    await seed();
    const a = renderHook(() => useTransactions());
    const b = renderHook(() => useTransactions());
    await waitFor(() => expect(b.result.current).toHaveLength(4));
    const spy = vi.spyOn(db.transactions, 'toArray');
    await db.transactions.add(makeTxn({ id: 'apr', date: '2025-04-01' }));
    await waitFor(() => expect(a.result.current).toHaveLength(5));
    await waitFor(() => expect(b.result.current).toHaveLength(5));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.result.current![0].id).toBe('apr');
    expect(a.result.current).toBe(b.result.current);
  });

  it('accounts are shared too, and the subscription outlives a quick unmount/remount', async () => {
    await seed();
    const spy = vi.spyOn(db.accounts, 'toArray');
    const first = renderHook(() => useAccounts());
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();
    const second = renderHook(() => useAccounts());
    await waitFor(() => expect(second.result.current).toHaveLength(1));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(openStoreCount()).toBeGreaterThan(0);
  });

  it('survives a database reset between subscriptions', async () => {
    await seed();
    const a = renderHook(() => useTransactions());
    await waitFor(() => expect(a.result.current).toHaveLength(4));
    await resetDatabaseForTests();
    await waitFor(() => expect(a.result.current).toEqual([]));
    await db.transactions.add(makeTxn({ id: 'x', date: '2025-05-01' }));
    await waitFor(() => expect(a.result.current).toHaveLength(1));
  });
});

describe('useTransactionsInRange', () => {
  it('reads only the period through the date index, newest first, and is shared per range', async () => {
    await seed();
    const all = vi.spyOn(db.transactions, 'toArray');
    const a = renderHook(() => useTransactionsInRange('2025-02-01', '2025-02-28'));
    const b = renderHook(() => useTransactionsInRange('2025-02-01', '2025-02-28'));
    expect(a.result.current).toBeUndefined();
    await waitFor(() => expect(a.result.current?.map((t) => t.id)).toEqual(['feb2', 'feb1']));
    await waitFor(() => expect(b.result.current).toBe(a.result.current));
    expect(all).not.toHaveBeenCalled(); // never loaded the whole table

    // inclusive bounds; a write inside the range updates it, outside the range does not change the result set
    await db.transactions.add(makeTxn({ id: 'edge', date: '2025-02-28' }));
    await waitFor(() => expect(a.result.current?.map((t) => t.id)).toEqual(['edge', 'feb2', 'feb1']));
    const other = renderHook(() => useTransactionsInRange('2025-03-01', '2025-03-31'));
    await waitFor(() => expect(other.result.current?.map((t) => t.id)).toEqual(['mar']));
  });
});
