import { beforeEach, describe, expect, it } from 'vitest';
import { budgetStatuses, categoryBaselines, generateInsights, monthlySeries, summarize } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

describe('people netting and savings-rate sanity', () => {
  const bank = makeAccount({ id: 'bank', name: 'Bank' });
  const st = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
  const ctx = { accounts: [bank], statements: [st], start: '2025-10-01', end: '2025-10-31' };
  const t = (rupees: number, over: Record<string, unknown> = {}) =>
    makeTxn({ accountId: 'bank', date: '2025-10-05', rupees, ...over } as Parameters<typeof makeTxn>[0]);
  const salary = (r: number) => t(r, { direction: 'credit', kind: 'income', category: 'salary' });
  const out = (r: number, category = 'sent_to_people') => t(r, { kind: 'p2p_out', category });
  const inn = (r: number, over: Record<string, unknown> = {}) =>
    t(r, { direction: 'credit', kind: 'p2p_in', category: 'received_from_people', ...over });
  const insightsFor = (txns: ReturnType<typeof t>[]) =>
    generateInsights({ txns, accounts: [bank], statements: [st], budgets: [], recurringDecisions: [], actions: [], start: '2025-10-01', end: '2025-10-31', today: '2025-11-05' });

  it('nets unclassified people flows: 1,96,000 income, 1,03,000 consumption, 2,62,000 out, 2,40,000 in', () => {
    const s = summarize([salary(196000), t(103000, { category: 'groceries' }), out(262000), inn(240000)], ctx);
    expect(s.peopleOut).toBe(26_200_000);
    expect(s.peopleIn).toBe(24_000_000);
    expect(s.peopleUnclassifiedOut).toBe(26_200_000);
    expect(s.peopleUnclassifiedIn).toBe(24_000_000);
    expect(s.peopleNetOut).toBe(2_200_000);
    expect(s.consumption).toBe(10_300_000);
    expect(s.spending).toBe(12_500_000);
    expect(s.income).toBe(19_600_000);
    expect(s.savingsRate).toBe(36.2);
    expect(s.byCategory.find((c) => c.category === 'sent_to_people')?.amount).toBe(2_200_000);
    expect(s.byCategory.reduce((a, c) => a + c.amount, 0)).toBe(s.spending);
  });

  it('never counts a net inflow from people as income or as negative spending', () => {
    const s = summarize([out(1000), inn(5000), salary(20000)], ctx);
    expect(s.peopleNetOut).toBe(0);
    expect(s.spending).toBe(0);
    expect(s.income).toBe(2_000_000);
    expect(s.byCategory.find((c) => c.category === 'sent_to_people')).toBeUndefined();
  });

  it('counts a classified p2p_out in full and lets a p2p_in made income count as income', () => {
    const s = summarize([out(10000, 'family_support'), out(2000), inn(5000), salary(50000)], ctx);
    expect(s.peopleUnclassifiedOut).toBe(200_000);
    expect(s.peopleNetOut).toBe(0);
    expect(s.spending).toBe(1_000_000);
    expect(s.byCategory[0]).toMatchObject({ category: 'family_support', amount: 1_000_000 });
    expect(s.peopleOut).toBe(1_200_000);
    expect(summarize([inn(5000, { kind: 'income', category: 'other_income' })], ctx).income).toBe(500_000);
  });

  it('suppresses a DBS-like month: tiny interest income, the rest from own accounts', () => {
    const txns = [
      t(128, { direction: 'credit', kind: 'interest', category: 'interest_income' }),
      t(250000, { direction: 'credit', kind: 'self_transfer', category: 'self_transfer' }),
      t(240000, { category: 'rent_housing' }),
    ];
    const s = summarize(txns, ctx);
    expect(s.income).toBe(12_800);
    expect(s.savingsRate).toBeNull();
    expect(s.savingsRateNote).toBe('No regular income found in this period — money arrived as transfers from your own accounts or from people.');
    const list = insightsFor(txns);
    expect(list.some((i) => i.type === 'savings_rate')).toBe(false);
    expect(list.some((i) => /spent more than you earned/.test(i.title))).toBe(false);
  });

  it('suppresses a rate beyond 100% when income is small next to the money arriving', () => {
    const arrives = [t(100000, { direction: 'credit', kind: 'p2p_in', category: 'gifts_donations' })];
    const s = summarize([salary(2000), t(40000, { category: 'groceries' }), ...arrives], ctx);
    expect(s.savingsRate).toBeNull();
    expect(s.savingsRateNote).toMatch(/No regular income/);
  });

  it('still reports a genuine overspend when income is regular', () => {
    const s = summarize([salary(10000), t(15000, { category: 'groceries' })], ctx);
    expect(s.savingsRate).toBe(-50);
    expect(insightsFor([salary(10000), t(15000, { category: 'groceries' })]).find((i) => i.type === 'savings_rate')?.title).toBe('You spent more than you earned');
  });

  it('nets unclassified people flows in monthlySeries, budgets and baselines too', () => {
    const txns = [out(5000), inn(3000), t(100, { category: 'groceries' })];
    const [pt] = monthlySeries(txns, { accounts: [bank], statements: [st], months: ['2025-10'] });
    expect(pt.spending).toBe(210_000);
    const budget = { id: 'b', category: 'sent_to_people', monthlyLimit: 1_000_000, createdAt: 'x', updatedAt: 'x' };
    const [b] = budgetStatuses([budget], txns, { month: '2025-10', today: '2025-11-02', accounts: [bank], statements: [st] });
    expect(b.spent).toBe(200_000);
    expect(b.txnIds).toHaveLength(2);
    const base = categoryBaselines(txns, { accounts: [bank], statements: [st], today: '2025-11-02' });
    expect(base.find((x) => x.category === 'sent_to_people')?.monthlyAverage).toBe(200_000);
  });

  it('describes sent, received and net in the people insight', () => {
    const list = insightsFor([salary(196000), t(103000, { category: 'groceries' }), out(262000), inn(240000)]);
    const p = list.find((i) => i.type === 'people_out');
    expect(p?.body).toContain('₹2,62,000 sent and ₹2,40,000 received from people');
    expect(p?.body).toContain('net ₹22,000');
    expect(p?.body).toContain('review who they are');
    expect(list.find((i) => i.type === 'savings_rate')?.title).toBe('You kept 36.2% of your income');
  });
});
