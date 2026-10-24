// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from './actions';
import { db, resetDatabaseForTests } from './db';
import { DEFAULT_SETTINGS, useLedger, useSettings, useTransaction, useTransactions } from './hooks';
import { useFeedback, useTemplates } from './learning';
import { makeAccount, makeDraft, makeTxn } from './testkit';

beforeEach(async () => {
  await resetDatabaseForTests();
});

describe('hooks', () => {
  it('useTransactions: undefined while loading, then date desc with a stable intra-statement order', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'old', date: '2025-01-01' }),
      makeTxn({ id: 'new-early-line', date: '2025-01-09', source: { page: 1, lineStart: 3, lineEnd: 3, rawLines: [] } }),
      makeTxn({ id: 'new-late-line', date: '2025-01-09', source: { page: 1, lineStart: 9, lineEnd: 9, rawLines: [] } }),
      makeTxn({ id: 'new-page2', date: '2025-01-09', source: { page: 2, lineStart: 1, lineEnd: 1, rawLines: [] } }),
    ]);
    const { result } = renderHook(() => useTransactions());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current!.map((t) => t.id)).toEqual(['new-page2', 'new-late-line', 'new-early-line', 'old']);
  });

  it('is live: new rows appear without remounting', async () => {
    const { result } = renderHook(() => useTransactions());
    await waitFor(() => expect(result.current).toEqual([]));
    await db.transactions.add(makeTxn({ id: 'x' }));
    await waitFor(() => expect(result.current).toHaveLength(1));
  });

  it('useTransaction distinguishes loading, found and not found', async () => {
    await db.transactions.add(makeTxn({ id: 'found' }));
    const hit = renderHook(() => useTransaction('found'));
    expect(hit.result.current).toBeUndefined();
    await waitFor(() => expect(hit.result.current?.id).toBe('found'));
    const miss = renderHook(() => useTransaction('nope'));
    await waitFor(() => expect(miss.result.current).toBeNull());
    const none = renderHook(() => useTransaction(undefined));
    await waitFor(() => expect(none.result.current).toBeNull());
  });

  it('useSettings is always defined and merges defaults', async () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current).toEqual(DEFAULT_SETTINGS);
    await updateSettings({ theme: 'dark' });
    await waitFor(() => expect(result.current.theme).toBe('dark'));
    expect(result.current.p2pReviewThreshold).toBe(DEFAULT_SETTINGS.p2pReviewThreshold);
  });

  it('useLedger is ready only when everything has loaded', async () => {
    await db.accounts.add(makeAccount());
    const { result } = renderHook(() => useLedger());
    expect(result.current.ready).toBe(false);
    expect(result.current.transactions).toEqual([]);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.accounts).toHaveLength(1);
  });

  it('useTemplates and useFeedback are live (undefined while loading)', async () => {
    const tpl = renderHook(() => useTemplates());
    const fb = renderHook(() => useFeedback());
    expect(tpl.result.current).toBeUndefined();
    expect(fb.result.current).toBeUndefined();
    await waitFor(() => expect(tpl.result.current).toEqual([]));
    await waitFor(() => expect(fb.result.current).toEqual([]));
    await db.templates.add({ ...makeDraft(), id: 't1', source: 'auto', verifiedCount: 1, useCount: 1, createdAt: 't', updatedAt: 't' });
    const before = { kind: 'expense' as const, category: 'x', categorySource: 'none' as const, kindSource: 'heuristic' as const, confidence: 0.5 };
    await db.feedback.bulkAdd([
      { id: 'f2', at: '2025-02-02T00:00:00Z', txnId: 'a', merchantKey: 'm', action: 'category', scope: 'this', before, after: { kind: 'expense', category: 'y' } },
      { id: 'f1', at: '2025-02-01T00:00:00Z', txnId: 'a', merchantKey: 'm', action: 'confirm', scope: 'this', before, after: { kind: 'expense', category: 'x' } },
    ]);
    await waitFor(() => expect(tpl.result.current).toHaveLength(1));
    await waitFor(() => expect(fb.result.current?.map((e) => e.id)).toEqual(['f1', 'f2']));
  });
});
