// @vitest-environment jsdom
import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteRule, setTransactionCategory, setTransactionKind, ValidationError } from './actions';
import { META_MIGRATIONS, VyayaMitraDB, db, resetDatabaseForTests } from './db';
import {
  clearInsightFeedback,
  mergeMerchants,
  recordInsightFeedback,
  saveMonthReview,
  setTransactionsTag,
  useInsightFeedback,
  useMonthReviews,
  useTransactionHistory,
} from './review';
import { fakeLink, makeAccount, makeTxn } from './testkit';
import { reprocessLedger } from '@/engine/import';
import { linkTransactions } from '@/engine/match';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/engine/understand', async () => {
  const k = await import('./testkit');
  return {
    understand: vi.fn(k.fakeUnderstand),
    trainLearnedModel: vi.fn(k.fakeTrain),
    buildCalibration: vi.fn(k.fakeCalibration),
    ruleMatches: k.fakeRuleMatches,
    normalizeMerchantKey: (s: string) => s.trim().toLowerCase(),
  };
});
vi.mock('@/engine/match', async () => {
  const k = await import('./testkit');
  return { linkTransactions: vi.fn(k.fakeLink) };
});
vi.mock('@/parsing', async () => ({ ...(await import('@/parsing/errors')), parseStatement: vi.fn() }));


beforeEach(async () => {
  await resetDatabaseForTests();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

async function seed() {
  await db.accounts.add(makeAccount());
  await db.transactions.bulkAdd([
    makeTxn({ id: 'a', rawDescription: 'SWIGGY ORDER 1' }),
    makeTxn({ id: 'b', rawDescription: 'SWIGGY ORDER 2' }),
    makeTxn({ id: 'z', rawDescription: 'UBER TRIP', merchant: 'Uber', merchantKey: 'uber', counterparty: { type: 'merchant', name: 'UBER' }, category: 'transport' }),
  ]);
}

describe('schema v2 -> v3 migration', () => {
  it('keeps all v2 data and adds the review tables', async () => {
    const name = 'migration-v3-test';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(1).stores({
      accounts: 'id',
      statements: 'id, accountId, fileHash',
      transactions: 'id, accountId, statementId, date, linkId, merchantKey, &[accountId+fingerprint]',
      rules: 'id',
      customCategories: 'id',
      budgets: 'id, &category',
      goals: 'id',
      goalContributions: 'id, goalId',
      recurringDecisions: 'merchantKey',
      savingActions: 'id',
      meta: 'key',
    });
    old.version(2).stores({ templates: 'id, [institution+fileKind], source', feedback: 'id, txnId, merchantKey, at' });
    await old.open();
    await old.table('accounts').add(makeAccount({ id: 'acc' }));
    await old.table('transactions').add(makeTxn({ id: 'keep', accountId: 'acc', fingerprint: 'f' }));
    await old.table('feedback').add({ id: 'f1', at: 't', txnId: 'keep', merchantKey: 'm', action: 'confirm', scope: 'this', before: {}, after: {} });
    await old.table('meta').put({ key: META_MIGRATIONS, value: [{ version: 2, at: 't' }] });
    old.close();

    const v3 = new VyayaMitraDB(name);
    await v3.open();
    expect(v3.verno).toBe(3);
    expect(await v3.transactions.count()).toBe(1);
    expect(await v3.accounts.count()).toBe(1);
    expect(await v3.feedback.count()).toBe(1);
    expect((await v3.meta.get(META_MIGRATIONS))!.value).toMatchObject([{ version: 2 }, { version: 3 }]);
    await v3.insightFeedback.add({ id: 'i', key: 'k', insightId: 'x', action: 'dismissed', at: 't' });
    await v3.monthReviews.put({ month: '2025-01', status: 'in_progress', notes: [], nextActionIds: [], updatedAt: 't' });
    expect(await v3.insightFeedback.where('key').equals('k').count()).toBe(1);
    expect((await v3.monthReviews.get('2025-01'))!.status).toBe('in_progress');
    v3.close();
    await Dexie.delete(name);
  });
});

describe('tags', () => {
  it('tags and untags in one transaction, recording a feedback event per changed row', async () => {
    await seed();
    await setTransactionsTag(['a', 'b', 'a'], 'planned');
    expect((await db.transactions.get('a'))!.tag).toBe('planned');
    expect((await db.transactions.get('z'))!.tag).toBeUndefined();
    const events = await db.feedback.toArray();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ action: 'tag', scope: 'this', before: { kind: 'expense', category: 'food_dining' }, after: { kind: 'expense', category: 'food_dining' } });

    await setTransactionsTag(['a', 'b'], 'planned'); // no change -> no new events
    expect(await db.feedback.count()).toBe(2);

    await setTransactionsTag(['a'], null);
    expect((await db.transactions.get('a'))!.tag).toBeUndefined();
    expect('tag' in (await db.transactions.get('a'))!).toBe(false);
    expect(await db.feedback.count()).toBe(3);
  });

  it('validates', async () => {
    await seed();
    await expect(setTransactionsTag(['a'], 'weird' as 'planned')).rejects.toBeInstanceOf(ValidationError);
    await expect(setTransactionsTag([], 'planned')).rejects.toBeInstanceOf(ValidationError);
    await expect(setTransactionsTag(['ghost'], 'planned')).rejects.toBeInstanceOf(ValidationError);
  });

  it('survives reprocess, relink, rule changes and corrections', async () => {
    await seed();
    await setTransactionsTag(['a'], 'exceptional');
    await reprocessLedger();
    const { ruleId } = await setTransactionCategory('b', 'groceries', 'merchant');
    expect((await db.transactions.get('a'))!.tag).toBe('exceptional');
    await setTransactionKind('a', 'investment', 'this');
    await deleteRule(ruleId!);
    await reprocessLedger();
    expect((await db.transactions.get('a'))!.tag).toBe('exceptional');
  });
});

describe('insight feedback and month reviews', () => {
  it('records one mark per key, replaces it, and clears it', async () => {
    await recordInsightFeedback({ key: 'subscription:netflix', insightId: 'i1', action: 'dismissed' });
    await recordInsightFeedback({ key: 'subscription:netflix', insightId: 'i1', action: 'expected' });
    await recordInsightFeedback({ key: 'spike:food', insightId: 'i2', action: 'irrelevant' });
    const all = await db.insightFeedback.toArray();
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.key === 'subscription:netflix')!.action).toBe('expected');
    await clearInsightFeedback(all[0].id);
    expect(await db.insightFeedback.count()).toBe(1);
    await expect(recordInsightFeedback({ key: '', insightId: 'x', action: 'dismissed' })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordInsightFeedback({ key: 'k', insightId: 'x', action: 'nope' as 'dismissed' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves a month review, one per month, completing stamps completedAt', async () => {
    await saveMonthReview({ month: '2025-05', status: 'in_progress', notes: ['Goa trip was planned'], nextActionIds: ['a1', 'a1'] });
    expect(await db.monthReviews.get('2025-05')).toMatchObject({ status: 'in_progress', notes: ['Goa trip was planned'], nextActionIds: ['a1'] });
    expect((await db.monthReviews.get('2025-05'))!.completedAt).toBeUndefined();
    await saveMonthReview({ month: '2025-05', status: 'completed', notes: [], nextActionIds: [] });
    expect(await db.monthReviews.count()).toBe(1);
    const done = (await db.monthReviews.get('2025-05'))!;
    expect(done.completedAt).toBeTruthy();
    expect(done.updatedAt).toBeTruthy();
    await expect(saveMonthReview({ month: '2025-13', status: 'completed', notes: [], nextActionIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveMonthReview({ month: '2025-06', status: 'later' as 'completed', notes: [], nextActionIds: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('hooks are live', async () => {
    const fb = renderHook(() => useInsightFeedback());
    const mr = renderHook(() => useMonthReviews());
    expect(fb.result.current).toBeUndefined();
    await waitFor(() => expect(fb.result.current).toEqual([]));
    await recordInsightFeedback({ key: 'k', insightId: 'i', action: 'dismissed' });
    await saveMonthReview({ month: '2025-07', status: 'in_progress', notes: [], nextActionIds: [] });
    await saveMonthReview({ month: '2025-06', status: 'in_progress', notes: [], nextActionIds: [] });
    await waitFor(() => expect(fb.result.current).toHaveLength(1));
    await waitFor(() => expect(mr.result.current?.map((r) => r.month)).toEqual(['2025-06', '2025-07']));
  });
});

describe('mergeMerchants', () => {
  it('creates one alias rule per source key, regroups rows, and reverts via deleteRule', async () => {
    await seed();
    await db.transactions.add(makeTxn({ id: 'r', rawDescription: 'SWIGGY RENAMED', reasons: ['You renamed this merchant'], merchant: 'My Swiggy' }));
    const res = await mergeMerchants(['swiggy', 'Uber', 'swiggy'], { merchantKey: 'Food Apps', name: 'Food Apps' });
    expect(res.updated).toBe(4);
    expect(res.ruleId).toBeTruthy();
    const rules = await db.rules.toArray();
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.match).sort((x, y) => x.value.localeCompare(y.value))).toEqual([
      { field: 'merchantKey', op: 'equals', value: 'swiggy' },
      { field: 'merchantKey', op: 'equals', value: 'uber' },
    ]);
    expect(rules.every((r) => r.set.merchantKey === 'food apps' && r.set.merchant === 'Food Apps')).toBe(true);
    for (const id of ['a', 'b', 'z']) expect(await db.transactions.get(id)).toMatchObject({ merchantKey: 'food apps', merchant: 'Food Apps' });
    expect(await db.transactions.get('r')).toMatchObject({ merchantKey: 'food apps', merchant: 'My Swiggy' });

    await reprocessLedger();
    expect((await db.transactions.get('a'))!.merchantKey).toBe('food apps');

    const swiggyRule = rules.find((r) => r.match.value === 'swiggy')!;
    await deleteRule(swiggyRule.id);
    expect((await db.transactions.get('a'))!.merchantKey).toBe('swiggy');
    expect((await db.transactions.get('z'))!.merchantKey).toBe('food apps');
  });

  it('merging again updates the existing rule and validates input', async () => {
    await seed();
    await mergeMerchants(['swiggy'], { merchantKey: 'one', name: 'One' });
    await mergeMerchants(['swiggy'], { merchantKey: 'two', name: 'Two' });
    const rules = await db.rules.toArray();
    expect(rules).toHaveLength(1);
    expect(rules[0].set).toMatchObject({ merchantKey: 'two', merchant: 'Two' });
    await expect(mergeMerchants([], { merchantKey: 'x', name: 'X' })).rejects.toBeInstanceOf(ValidationError);
    await expect(mergeMerchants(['two'], { merchantKey: 'two', name: 'Two' })).rejects.toBeInstanceOf(ValidationError);
    await expect(mergeMerchants(['a'], { merchantKey: 'x', name: '  ' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('transaction history', () => {
  it('lists correction events oldest first', async () => {
    await seed();
    await setTransactionCategory('a', 'groceries', 'this');
    await new Promise((r) => setTimeout(r, 3));
    await setTransactionsTag(['a'], 'planned');
    await setTransactionCategory('b', 'shopping', 'this');
    const { result } = renderHook(() => useTransactionHistory('a'));
    await waitFor(() => expect(result.current?.map((e) => e.action)).toEqual(['category', 'tag']));
    const none = renderHook(() => useTransactionHistory(undefined));
    await waitFor(() => expect(none.result.current).toEqual([]));
  });
});
