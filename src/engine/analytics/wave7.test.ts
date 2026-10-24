import { beforeEach, describe, expect, it } from 'vitest';
import type { Budget, InsightFeedback, SavingAction } from '@/domain/types';
import { budgetStatuses, explainChange, generateInsights, monthReviewData } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const bank = () => makeAccount({ id: 'bank', name: 'Bank' });
const st = (from = '2025-06-01', to = '2025-10-31') => makeStatement({ accountId: 'bank', periodStart: from, periodEnd: to });
const t = (date: string, rupees: number, extra: Record<string, unknown> = {}) =>
  makeTxn({ accountId: 'bank', date, rupees, category: 'shopping', merchant: `Shop ${date}`, ...extra } as Parameters<typeof makeTxn>[0]);
const food = (date: string, rupees: number, extra: Record<string, unknown> = {}) => t(date, rupees, { category: 'food_dining', ...extra });

describe('BudgetStatus overBy / overPct', () => {
  it('is present only when spent exceeds the limit', () => {
    const b: Budget = { id: 'b', category: 'food_dining', monthlyLimit: 400_000, createdAt: 'x', updatedAt: 'x' };
    const ctx = { month: '2025-10', today: '2025-11-02', accounts: [bank()], statements: [st()] };
    const [over] = budgetStatuses([b], [food('2025-10-04', 5000)], ctx);
    expect(over).toMatchObject({ state: 'over', overBy: 100_000, overPct: 25 });
    const [at] = budgetStatuses([b], [food('2025-10-04', 4000)], ctx);
    expect(at.overBy).toBeUndefined();
    expect(at.overPct).toBeUndefined();
  });
});

describe('insight keys, feedback and tags', () => {
  const baseline = () => [food('2025-07-10', 3000), food('2025-08-10', 3000), food('2025-09-10', 3000)];
  const input = (txns: ReturnType<typeof t>[], feedback: InsightFeedback[] = []) => ({
    txns, accounts: [bank()], statements: [st()], budgets: [], recurringDecisions: [], actions: [], feedback,
    start: '2025-10-01', end: '2025-10-31', today: '2025-11-02',
  });
  const fb = (over: Partial<InsightFeedback> & { key: string; insightId: string }): InsightFeedback => ({ id: `${over.insightId}${over.action}${Math.random()}`, action: 'dismissed', at: '2025-11-01T00:00:00Z', ...over });

  it('gives every insight a stable, period-free key', () => {
    const txns = [...baseline(), food('2025-10-04', 5000)];
    const a = generateInsights(input(txns));
    const b = generateInsights({ ...input(txns), start: '2025-10-01', end: '2025-10-31', today: '2025-11-03' });
    const cc = a.find((i) => i.type === 'category_change');
    expect(cc?.key).toBe('category_change:food_dining');
    expect(b.find((i) => i.type === 'category_change')?.key).toBe(cc?.key);
    for (const i of a) expect(i.key).toMatch(new RegExp(`^${i.type}:`));
  });

  it('hides dismissed and expected ids, irrelevant keys, and keys dismissed 3+ times', () => {
    const txns = [...baseline(), food('2025-10-04', 5000)];
    const cc = generateInsights(input(txns)).find((i) => i.type === 'category_change');
    expect(cc).toBeDefined();
    const key = cc?.key as string;
    const id = cc?.id as string;
    const has = (fb: InsightFeedback[]) => generateInsights(input(txns, fb)).some((i) => i.type === 'category_change');
    expect(has([fb({ key, insightId: id, action: 'dismissed' })])).toBe(false);
    expect(has([fb({ key, insightId: id, action: 'expected' })])).toBe(false);
    expect(has([fb({ key, insightId: 'other-period', action: 'dismissed' })])).toBe(true);
    expect(has([fb({ key, insightId: 'older', action: 'irrelevant' })])).toBe(false);
    expect(has([1, 2].map((n) => fb({ key, insightId: `old${n}`, action: 'dismissed' })))).toBe(true);
    expect(has([1, 2, 3].map((n) => fb({ key, insightId: `old${n}`, action: 'dismissed' })))).toBe(false);
  });

  it('keeps tagged rows in totals but out of category-spike and large-transaction triggers, and mentions money expected back', () => {
    const small = ['2025-09-01', '2025-09-08', '2025-09-15', '2025-09-22', '2025-10-01', '2025-10-03'].map((d) => t(d, 400));
    const plain = [...baseline(), food('2025-10-04', 5000), t('2025-10-07', 24000, { merchant: 'Big Buy' }), ...small];
    expect(generateInsights(input(plain)).some((i) => i.type === 'large_transaction')).toBe(true);
    const tagged = [
      ...baseline(),
      food('2025-10-04', 5000, { tag: 'planned' }),
      t('2025-10-07', 24000, { merchant: 'Big Buy', tag: 'reimbursable' }),
      ...small,
    ];
    const out = generateInsights(input(tagged));
    expect(out.some((i) => i.type === 'large_transaction')).toBe(false);
    expect(out.some((i) => i.type === 'category_change')).toBe(false);
  });

  it('mentions reimbursable spend as expected back', () => {
    const statements = [makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-10-31' })];
    const txns = [t('2025-09-05', 10000), t('2025-10-05', 20000), t('2025-10-06', 3000, { tag: 'reimbursable' })];
    const sc = generateInsights({ ...input(txns), statements }).find((i) => i.type === 'spending_change');
    expect(sc?.body).toContain('₹3,000 of this is tagged as expected back');
  });
});

describe('explainChange drivers', () => {
  const accounts = [bank()];
  const statements = [st('2025-08-01', '2025-09-30')];
  const base = { accounts, statements, current: { start: '2025-09-01', end: '2025-09-30' }, today: '2025-10-05' };
  const m = (date: string, rupees: number, merchant: string, extra: Record<string, unknown> = {}) => food(date, rupees, { merchant, merchantKey: merchant.toLowerCase(), ...extra });

  it('reports purchase counts, average size, merchant mix, one-offs and refunds without claiming price changes', () => {
    const txns = [
      m('2025-08-02', 200, 'Cafe'), m('2025-08-09', 200, 'Cafe'), m('2025-08-12', 100, 'Gone Cafe'), m('2025-08-15', 300, 'Cafe'),
      m('2025-09-02', 300, 'Cafe'), m('2025-09-09', 300, 'Cafe'), m('2025-09-12', 800, 'New Spot'), m('2025-09-15', 400, 'Cafe', { tag: 'planned' }),
      m('2025-09-20', 3000, 'Feast'), m('2025-09-21', 100, 'Cafe', { direction: 'credit', kind: 'refund' }),
    ];
    const r = explainChange(txns, base);
    const d = r.drivers;
    expect(d?.purchases).toEqual({ current: 5, previous: 4 });
    expect(d?.averageSize).toEqual({ current: Math.round(470_000 / 5), previous: Math.round(80_000 / 4) });
    expect(d?.merchantMix).toEqual({ newMerchants: 380_000, stoppedMerchants: 10_000, newCount: 2, stoppedCount: 1 });
    expect(d?.refunds).toEqual({ current: 10_000, previous: 0 });
    expect(d?.oneOffs.txnIds).toHaveLength(2); // planned tag and the 3,000 feast
    expect(d?.oneOffs.total).toBe(40_000 + 300_000);
    for (const mc of r.merchants) expect(mc.sentence).not.toMatch(/price/i);
  });
});

describe('monthReviewData', () => {
  const accounts = [bank()];
  const action: SavingAction = { id: 'a1', type: 'category_limit', title: 'Cap dining', category: 'food_dining', baselineMonthly: 800_000, targetMonthly: 500_000, startMonth: '2025-09', status: 'active', createdAt: 'x', updatedAt: 'x' };
  const ctx = (over = {}) => ({
    accounts, statements: [st()], budgets: [], actions: [action], goals: [], contributions: [], recurringDecisions: [], feedback: [],
    month: '2025-10', today: '2025-11-03', ...over,
  });
  const txns = [
    food('2025-07-10', 3000), food('2025-08-10', 3000), food('2025-09-10', 4000),
    food('2025-10-04', 6000, { needsReview: true, reviewReasons: ['Running balance mismatch'] }),
    t('2025-10-06', 2000, { tag: 'exceptional' }),
    t('2025-10-07', 500, { tag: 'reimbursable' }),
  ];

  it('assembles readiness, changes, tags, actions, budgets and suggestions for a covered month', () => {
    const b: Budget = { id: 'b', category: 'food_dining', monthlyLimit: 500_000, createdAt: 'x', updatedAt: 'x' };
    const r = monthReviewData(txns, ctx({ budgets: [b] }));
    expect(r.month).toBe('2025-10');
    expect(r.readiness).toEqual({ coverageComplete: true, missing: [], needsReview: 1, extractionIssues: 1 });
    expect(r.changes?.comparison.previous.label).toBe('September 2025');
    expect(r.changes?.comparable).toBe(true);
    expect(r.tagged.total).toBe(250_000);
    expect(r.tagged.byTag).toEqual({ exceptional: 200_000, reimbursable: 50_000 });
    expect(r.tagged.txnIds).toHaveLength(2);
    expect(r.budgets[0]).toMatchObject({ state: 'over', overBy: 100_000 });
    expect(r.actions[0]).toMatchObject({ state: 'achieved', monthsEvaluated: ['2025-09', '2025-10'] });
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
    expect(r.suggestions.every((i) => i.action)).toBe(true);
    expect(r.uncertain.join(' ')).toMatch(/1 transaction worth ₹6,000/);
    expect(r.uncertain.join(' ')).toMatch(/could not be fully verified/);
  });

  it('uses equivalent elapsed days for an unfinished month, with an honest readiness note', () => {
    const statements = [st('2025-06-01', '2025-10-14')];
    const r = monthReviewData(txns, ctx({ statements, today: '2025-10-14' }));
    expect(r.readiness.coverageComplete).toBe(false);
    expect(r.readiness.missing.join(' ')).toMatch(/not over yet/);
    expect(r.changes?.comparison.current.end).toBe('2025-10-14');
    expect(r.changes?.comparison.previous).toMatchObject({ start: '2025-09-01', end: '2025-09-14' });
    expect(r.changes?.comparable).toBe(true);
  });

  it('flags missing statements, returns null changes without earlier data, and lists expected insight ids', () => {
    const gap = monthReviewData(txns, ctx({ statements: [st('2025-06-01', '2025-10-20')] }));
    expect(gap.readiness.coverageComplete).toBe(false);
    expect(gap.readiness.missing[0]).toBe('No Bank statement covers 21–31 Oct 2025');
    const first = monthReviewData([food('2025-10-04', 100)], ctx({ statements: [st('2025-10-01', '2025-10-31')], actions: [] }));
    expect(first.changes).toBeNull();

    const all = generateInsights({ txns, accounts, statements: [st()], budgets: [], recurringDecisions: [], actions: [], start: '2025-10-01', end: '2025-10-31', today: '2025-11-03' });
    const target = all.find((i) => i.type === 'needs_review');
    expect(target).toBeDefined();
    const feedback: InsightFeedback[] = [{ id: 'f', key: target?.key as string, insightId: target?.id as string, action: 'expected', at: '2025-11-02T00:00:00Z' }];
    const r = monthReviewData(txns, ctx({ feedback }));
    expect(r.expectedInsightIds).toEqual([target?.id]);
    expect(r.suggestions.some((i) => i.id === target?.id)).toBe(false);
  });
});
