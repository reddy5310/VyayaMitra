import { beforeEach, describe, expect, it } from 'vitest';
import type { Budget, RecurringDecision, SavingAction } from '@/domain/types';
import { generateInsights, type Insight, type InsightInput } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const bank = () => makeAccount({ id: 'bank', name: 'ICICI Savings', institution: 'ICICI' });

function base(over: Partial<InsightInput>): InsightInput {
  return {
    txns: [],
    accounts: [bank()],
    statements: [],
    budgets: [],
    recurringDecisions: [],
    actions: [],
    start: '2025-10-01',
    end: '2025-10-31',
    today: '2025-10-14',
    ...over,
  };
}

const spend = (date: string, rupees: number, extra: Partial<Parameters<typeof makeTxn>[0]> = {}) =>
  makeTxn({ accountId: 'bank', date, rupees, category: 'shopping', merchant: `Shop ${date}`, ...extra });

const byType = (list: Insight[], type: Insight['type']) => list.filter((i) => i.type === type);

describe('spending change', () => {
  const sepFull = () => makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
  const txns = () => [
    spend('2025-09-03', 5000),
    spend('2025-09-10', 4000),
    spend('2025-09-20', 6000), // after day 14: outside the equivalent range
    spend('2025-10-03', 3000),
    spend('2025-10-09', 2000),
  ];

  it('compares a partial current month with the equivalent days of the previous month, and states the basis', () => {
    const octTo14 = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-14' });
    const out = generateInsights(base({ txns: txns(), statements: [sepFull(), octTo14] }));
    const sc = byType(out, 'spending_change')[0];
    expect(sc).toBeDefined();
    expect(sc.basis).toContain('1–14 Oct 2025');
    expect(sc.basis).toContain('1–14 Sep 2025');
    expect(sc.basis).toContain('equivalent days');
    expect(sc.title).toMatch(/down 44%/);
    expect(sc.body).toContain('₹5,000');
    expect(sc.body).toContain('₹9,000');
    expect(sc.evidence.txnIds.length).toBeGreaterThan(0);
    expect(byType(out, 'coverage')).toHaveLength(0);
  });

  it('never claims spending is down when the current month is only partly imported', () => {
    const octTo7 = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-07' });
    const out = generateInsights(base({ txns: txns(), statements: [sepFull(), octTo7] }));
    expect(byType(out, 'spending_change')).toHaveLength(0);
    const cov = byType(out, 'coverage')[0];
    expect(cov).toBeDefined();
    expect(cov.body).toContain('No ICICI Savings statement covers 8–14 Oct 2025');
    expect(cov.action).toMatchObject({ type: 'import_statement', label: expect.stringContaining('Oct ICICI Savings') });
    for (const i of out) expect(`${i.title} ${i.body}`).not.toMatch(/\bdown\b|\bless than\b|\bsaved\b/i);
  });

  it('compares whole months only when both are complete, stating the basis', () => {
    const sepOct = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-10-31' });
    const all = [spend('2025-09-05', 10000), spend('2025-10-05', 12500)];
    const out = generateInsights(base({ txns: all, statements: [sepOct], today: '2025-11-05' }));
    const sc = byType(out, 'spending_change')[0];
    expect(sc.title).toMatch(/up 25%/);
    expect(sc.basis).toMatch(/October 2025 with September 2025/);
    expect(sc.severity).toBe('warning');
    expect(sc.action?.type).toBe('review_transactions');
  });

  it('says a comparison is blocked when only the previous month is missing', () => {
    const oct = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
    const out = generateInsights(base({ txns: [spend('2025-09-05', 100), spend('2025-10-05', 100)], statements: [oct], today: '2025-11-05' }));
    expect(byType(out, 'spending_change')).toHaveLength(0);
    const cov = byType(out, 'coverage')[0];
    expect(cov.title).toMatch(/Can't compare/);
    expect(cov.body).toContain('No imported statement covers 1–30 Sep 2025');
    expect(cov.action?.label).toBe('Import a statement for September 2024'.replace('2024', '2025'));
  });
});

describe('category change, budgets and review insights', () => {
  const st = () => makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-10-31' });
  const dining = (date: string, rupees: number) => spend(date, rupees, { category: 'food_dining' });
  const baseline = () => [dining('2025-07-10', 3000), dining('2025-08-10', 3000), dining('2025-09-10', 3000)];

  it('flags a category 30% and ₹1,000 above its 3-complete-month baseline, with a limit action', () => {
    const out = generateInsights(base({ txns: [...baseline(), dining('2025-10-04', 5000)], statements: [st()], today: '2025-11-02' }));
    const cc = byType(out, 'category_change')[0];
    expect(cc.title).toMatch(/Food & dining is up 67%/);
    expect(cc.body).toContain('₹5,000');
    expect(cc.body).toContain('₹3,000');
    expect(cc.basis).toMatch(/Jul 2025, Aug 2025, Sep 2025/);
    expect(cc.action).toEqual({ type: 'category_limit', label: expect.stringContaining('₹3,000'), category: 'food_dining', suggestedTarget: 300_000 });
    expect(cc.estimatedMonthlySaving).toBe(200_000);
    expect(cc.evidence.txnIds).toHaveLength(1);
  });

  it('ignores small or sub-₹1,000 rises', () => {
    const small = generateInsights(base({ txns: [...baseline(), dining('2025-10-04', 3800)], statements: [st()], today: '2025-11-02' }));
    expect(byType(small, 'category_change')).toHaveLength(0);
    const tiny = [dining('2025-07-10', 100), dining('2025-08-10', 100), dining('2025-09-10', 100), dining('2025-10-04', 600)];
    expect(byType(generateInsights(base({ txns: tiny, statements: [st()], today: '2025-11-02' })), 'category_change')).toHaveLength(0);
  });

  it('uses tentative wording when the month is not fully covered', () => {
    const partial = makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-10-10' });
    const out = generateInsights(base({ txns: [...baseline(), dining('2025-10-04', 5000)], statements: [partial] }));
    const cc = byType(out, 'category_change')[0];
    expect(cc.body).toMatch(/may be running above/);
    expect(cc.body).toMatch(/at least/);
  });

  it('reports a budget that is over, and one to watch', () => {
    const budgets: Budget[] = [
      { id: 'b1', category: 'food_dining', monthlyLimit: 400_000, createdAt: 'x', updatedAt: 'x' },
      { id: 'b2', category: 'shopping', monthlyLimit: 1_000_000, createdAt: 'x', updatedAt: 'x' },
    ];
    const txns = [dining('2025-10-04', 5000), spend('2025-10-05', 8500)];
    const out = generateInsights(base({ txns, statements: [st()], budgets, today: '2025-10-31' }));
    const over = byType(out, 'budget').find((i) => i.title.includes('Food'));
    const watch = byType(out, 'budget').find((i) => i.title.includes('Shopping'));
    expect(over).toMatchObject({ severity: 'critical', title: 'Food & dining is over its budget' });
    expect(over?.body).toContain('₹1,000 over');
    expect(watch?.title).toMatch(/may go over/);
    expect(out.indexOf(over as Insight)).toBeLessThan(out.indexOf(watch as Insight));
  });

  it('flags a large transaction (> 3x the 90-day median and >= ₹5,000), a high share to people and review items', () => {
    const small = ['2025-09-01', '2025-09-08', '2025-09-15', '2025-09-22', '2025-10-01', '2025-10-03'].map((d) => spend(d, 400));
    const big = spend('2025-10-07', 24000, { merchant: 'Furniture Mart', needsReview: true, reviewReasons: ['large'] });
    const sent = spend('2025-10-09', 12000, { kind: 'p2p_out', category: 'sent_to_people', merchant: 'A Friend' });
    const out = generateInsights(base({ txns: [...small, big, sent], statements: [st()], today: '2025-10-14' }));
    const large = byType(out, 'large_transaction')[0];
    expect(large.title).toContain('₹24,000');
    expect(large.title).toContain('Furniture Mart');
    expect(large.evidence.txnIds).toContain(big.id);
    const people = byType(out, 'people_out')[0];
    expect(people.action?.type).toBe('review_transactions');
    expect(people.body).toContain('₹12,000');
    const nr = byType(out, 'needs_review')[0];
    expect(nr.title).toMatch(/1 transaction needs a quick look/);
    expect(nr.evidence.txnIds).toEqual([big.id]);
  });

  it('does not call a purchase large below ₹5,000 or without enough history', () => {
    const few = [spend('2025-10-01', 100), spend('2025-10-02', 4900)];
    expect(byType(generateInsights(base({ txns: few, statements: [st()] })), 'large_transaction')).toHaveLength(0);
    const lowMedian = ['01', '02', '03', '04', '05', '06'].map((d) => spend(`2025-10-${d}`, 100));
    const mid = [...lowMedian, spend('2025-10-08', 4900)];
    expect(byType(generateInsights(base({ txns: mid, statements: [st()] })), 'large_transaction')).toHaveLength(0);
  });
});

describe('recurring, savings rate and actions', () => {
  const st = () => makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-10-31' });

  it('summarises recurring commitments and suggests new series with a review action', () => {
    const subs = ['2025-08-05', '2025-09-05', '2025-10-05'].map((d) => spend(d, 199, { merchant: 'Streamly', category: 'subscriptions' }));
    const out = generateInsights(base({ txns: subs, statements: [st()], today: '2025-10-14' }));
    const rec = byType(out, 'recurring');
    const total = rec.find((i) => i.title.includes('a month goes to'));
    expect(total?.title).toBe('About ₹199 a month goes to 1 recurring payment');
    const fresh = rec.find((i) => i.title.includes('looks like'));
    expect(fresh?.title).toBe('Streamly looks like a monthly payment');
    expect(fresh?.action).toMatchObject({ type: 'review_recurring', merchantKey: 'streamly' });
    expect(fresh?.estimatedMonthlySaving).toBe(19_900);
    expect(fresh?.evidence.txnIds).toHaveLength(3);
  });

  it('drops dismissed series and series that ended long ago', () => {
    const subs = ['2025-08-05', '2025-09-05', '2025-10-05'].map((d) => spend(d, 199, { merchant: 'Streamly' }));
    const dismissed: RecurringDecision[] = [{ merchantKey: 'streamly', status: 'dismissed', updatedAt: 'x' }];
    expect(byType(generateInsights(base({ txns: subs, statements: [st()], recurringDecisions: dismissed })), 'recurring')).toHaveLength(0);
    const ended = generateInsights(base({ txns: subs, statements: [st()], today: '2026-04-01', start: '2026-03-01', end: '2026-03-31' }));
    expect(byType(ended, 'recurring')).toHaveLength(0);
  });

  it('reports the savings rate only when income coverage is full', () => {
    const txns = [
      spend('2025-10-01', 50000, { direction: 'credit', kind: 'income', category: 'salary', merchant: 'Employer' }),
      spend('2025-10-04', 10000),
    ];
    const full = generateInsights(base({ txns, statements: [st()], today: '2025-10-31' }));
    const sr = byType(full, 'savings_rate')[0];
    expect(sr.title).toBe('You kept 80% of your income');
    expect(sr.severity).toBe('positive');
    const partial = makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-10-10' });
    expect(byType(generateInsights(base({ txns, statements: [partial], today: '2025-10-31' })), 'savings_rate')).toHaveLength(0);
    const none = generateInsights(base({ txns, statements: [], today: '2025-10-31' }));
    expect(byType(none, 'savings_rate')).toHaveLength(0);
    expect(byType(none, 'coverage')[0].title).toBe('No statements imported yet');
  });

  it('shows outcomes of active saving actions: waiting, then measured from complete months', () => {
    const action: SavingAction = {
      id: 'sa1', type: 'category_limit', title: 'Cap shopping', category: 'shopping', baselineMonthly: 1_000_000, targetMonthly: 600_000,
      startMonth: '2025-09', status: 'active', createdAt: 'x', updatedAt: 'x',
    };
    const txns = [spend('2025-09-10', 5000)];
    const waiting = generateInsights(base({ txns, statements: [makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-20' })], actions: [action], today: '2025-09-25', start: '2025-09-01', end: '2025-09-30' }));
    expect(byType(waiting, 'action_outcome')[0].title).toContain('Waiting');
    const done = generateInsights(base({ txns, statements: [st()], actions: [action], today: '2025-10-05', start: '2025-10-01', end: '2025-10-31' }));
    const o = byType(done, 'action_outcome')[0];
    expect(o.title).toContain('is working');
    expect(o.body).toContain('₹5,000');
    expect(o.basis).toContain('Sep 2025');
    expect(generateInsights(base({ txns, statements: [st()], actions: [{ ...action, status: 'dropped' }], today: '2025-10-05' }))
      .some((i) => i.type === 'action_outcome')).toBe(false);
  });
});

describe('ordering and stability', () => {
  it('gives stable ids, orders most important first and returns at most 8', () => {
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-10-10' });
    const txns = [
      ...['2025-07-10', '2025-08-10', '2025-09-10'].map((d) => spend(d, 3000, { category: 'food_dining' })),
      spend('2025-10-04', 9000, { category: 'food_dining', needsReview: true }),
      spend('2025-10-05', 12000, { kind: 'p2p_out', category: 'sent_to_people', merchant: 'A Friend' }),
    ];
    const budgets: Budget[] = ['food_dining', 'shopping', 'travel', 'fitness', 'groceries', 'transport', 'utilities', 'education'].map((category, i) => ({
      id: `b${i}`, category, monthlyLimit: category === 'food_dining' ? 100_000 : 10_000_000, createdAt: 'x', updatedAt: 'x',
    }));
    const input = base({ txns, statements: [st], budgets });
    const a = generateInsights(input);
    const b = generateInsights(input);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    expect(a.length).toBeLessThanOrEqual(8);
    expect(a[0].type).toBe('coverage'); // the Oct statement stops at the 10th, today is the 14th
    expect(a[1].type).toBe('budget');
    for (const i of a) {
      expect(i.body.length).toBeGreaterThan(10);
      expect(i.evidence).toBeDefined();
    }
    expect(generateInsights(base({ txns: [], accounts: [] }))).toEqual([]);
  });
});
