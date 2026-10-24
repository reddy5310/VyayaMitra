import { beforeEach, describe, expect, it } from 'vitest';
import {
  cardCycles,
  compareSpending,
  coverageGrid,
  cumulativeSpending,
  dataStatus,
  merchantPareto,
  moneyFlow,
  spendingCalendar,
  spendingPlan,
} from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const bank = () => makeAccount({ id: 'bank', name: 'Bank' });
const card = () => makeAccount({ id: 'card', type: 'credit_card', name: 'Card' });
const stmt = (accountId: string, periodStart: string, periodEnd: string, extra = {}) => makeStatement({ accountId, periodStart, periodEnd, ...extra });
const spend = (date: string, rupees: number, extra: Record<string, unknown> = {}) =>
  makeTxn({ accountId: 'bank', date, rupees, category: 'shopping', ...extra } as Parameters<typeof makeTxn>[0]);

describe('dataStatus and spendingPlan', () => {
  it('reports evidence, data-through, complete months and extraction issues', () => {
    const accounts = [bank(), card()];
    const statements = [stmt('bank', '2025-08-10', '2025-10-14'), stmt('card', '2025-09-01', '2025-09-30')];
    const txns = [
      spend('2025-09-02', 10, { needsReview: true, reviewReasons: ['Running balance does not reconcile'] }),
      spend('2025-09-03', 10, { needsReview: true, reviewReasons: ['Unknown merchant'] }),
      spend('2025-09-04', 10),
    ];
    const s = dataStatus(accounts, statements, txns, '2025-10-20');
    expect(s).toMatchObject({ dataThrough: '2025-10-14', accountCount: 2, statementCount: 2, needsReview: 2, extractionIssues: 1, evidence: 'bank_and_card' });
    // Aug is partial for the bank (tracked from the 10th, so Aug 10-31 is covered: complete), Sep complete, Oct partial
    expect(s.completeMonths).toEqual(['2025-08', '2025-09']);
    expect(s.latestCompleteMonth).toBe('2025-09');
    expect(dataStatus([bank()], [], [], '2025-10-20')).toMatchObject({ evidence: 'none', dataThrough: null, latestCompleteMonth: null });
    expect(dataStatus([card()], [stmt('card', '2025-09-01', '2025-09-30')], [], '2025-10-20').evidence).toBe('cards_only');
    expect(dataStatus([bank()], [stmt('bank', '2025-09-01', '2025-09-30')], [], '2025-10-20').evidence).toBe('bank_only');
  });

  it('sums budgetable limits, or null', () => {
    const b = (category: string, monthlyLimit: number) => ({ id: category, category, monthlyLimit, createdAt: 'x', updatedAt: 'x' });
    expect(spendingPlan([])).toBeNull();
    expect(spendingPlan([b('groceries', 500_000), b('food_dining', 300_000), b('salary', 999)])).toEqual({ monthlyLimit: 800_000, categories: ['groceries', 'food_dining'] });
  });
});

describe('cumulativeSpending', () => {
  const accounts = [bank()];
  it('is cumulative, null on uncovered days, with an even-pace plan and no projection for past months', () => {
    const statements = [stmt('bank', '2025-09-01', '2025-09-20')];
    const txns = [spend('2025-09-02', 100), spend('2025-09-05', 50), spend('2025-09-05', 20, { direction: 'credit', kind: 'refund' })];
    const r = cumulativeSpending(txns, { accounts, statements, start: '2025-09-01', end: '2025-09-30', today: '2025-10-05', planMonthly: 3_000_000 });
    expect(r.points).toHaveLength(30);
    expect(r.points[0]).toMatchObject({ actual: 0, covered: true, plan: 100_000 });
    expect(r.points[4].actual).toBe(13_000);
    expect(r.points[19].covered).toBe(true);
    expect(r.points[20]).toMatchObject({ actual: null, covered: false });
    expect(r.points[29].plan).toBe(3_000_000);
    expect(r.planTotal).toBe(3_000_000);
    expect(r.total).toBe(13_000);
    expect(r.dataThrough).toBe('2025-09-20');
    expect(r.projectedTotal).toBeUndefined();
    expect(r.points.every((p) => p.projected === undefined)).toBe(true);
    expect(r.projectionNote).toMatch(/current calendar month/);
  });

  it('projects only for the current month with 10+ covered days and 5+ spending txns, after the last covered day', () => {
    const statements = [stmt('bank', '2025-10-01', '2025-10-12')];
    const txns = Array.from({ length: 6 }, (_, i) => spend(`2025-10-0${i + 1}`, 100));
    const base = { accounts, statements, start: '2025-10-01', end: '2025-10-31', today: '2025-10-12' };
    const r = cumulativeSpending(txns, base);
    expect(r.points[11].projected).toBeUndefined();
    expect(r.points[12].projected).toBe(60_000 + Math.round((60_000 / 12) * 1));
    expect(r.projectedTotal).toBe(60_000 + Math.round((60_000 / 12) * 19));
    expect(r.dataThrough).toBe('2025-10-12');
    // too few days
    const few = cumulativeSpending(txns, { ...base, statements: [stmt('bank', '2025-10-01', '2025-10-08')], today: '2025-10-08' });
    expect(few.projectedTotal).toBeUndefined();
    expect(few.projectionNote).toMatch(/needs at least 10/);
    // too few transactions
    const sparse = cumulativeSpending(txns.slice(0, 3), base);
    expect(sparse.projectedTotal).toBeUndefined();
    expect(sparse.projectionNote).toMatch(/at least 5/);
  });

  it('paces the plan per month across multi-month periods', () => {
    const r = cumulativeSpending([], { accounts, statements: [stmt('bank', '2025-01-01', '2025-03-31')], start: '2025-01-01', end: '2025-02-28', today: '2025-03-05', planMonthly: 100_000 });
    expect(r.points.find((p) => p.date === '2025-01-31')?.plan).toBe(100_000);
    expect(r.points.find((p) => p.date === '2025-02-14')?.plan).toBe(150_000);
    expect(r.planTotal).toBe(200_000);
  });
});

describe('compareSpending', () => {
  const accounts = [bank()];
  const statements = [stmt('bank', '2025-08-01', '2025-09-30')];
  const mk = () => [
    spend('2025-08-05', 1000, { category: 'groceries' }),
    spend('2025-08-06', 500, { category: 'food_dining' }),
    spend('2025-08-07', 200, { category: 'transport' }),
    spend('2025-09-05', 600, { category: 'groceries' }),
    spend('2025-09-06', 1500, { category: 'food_dining' }),
    spend('2025-09-07', 250, { category: 'transport' }),
    spend('2025-09-08', 80, { category: 'fitness' }),
    spend('2025-09-09', 30, { category: 'fitness', direction: 'credit', kind: 'refund' }),
  ];
  const ctx = { accounts, statements, current: { start: '2025-09-01', end: '2025-09-30' }, today: '2025-10-05' };

  it('defaults to the previous month and explains the change by category, largest first', () => {
    const c = compareSpending(mk(), ctx);
    expect(c.previous).toMatchObject({ start: '2025-08-01', end: '2025-08-31', label: 'August 2025', total: 170_000 });
    expect(c.current).toMatchObject({ label: 'September 2025', total: 240_000 });
    expect(c.comparable).toBe(true);
    expect(c.basis).toBe('Comparing September 2025 with August 2025 (both fully covered)');
    expect(c.steps.map((s) => [s.key, s.delta])).toEqual([['food_dining', 100_000], ['groceries', -40_000], ['fitness', 5_000], ['transport', 5_000]]);
    expect(c.steps[0].txnIdsCurrent).toHaveLength(1);
    expect(c.steps.reduce((a, s) => a + s.delta, 0) + c.other).toBe(c.current.total - c.previous.total);
  });

  it('folds the remainder into other and uses an equal-length preceding period for custom ranges', () => {
    const c = compareSpending(mk(), { ...ctx, maxSteps: 2 });
    expect(c.steps).toHaveLength(2);
    expect(c.other).toBe(10_000);
    const custom = compareSpending(mk(), { ...ctx, current: { start: '2025-09-05', end: '2025-09-09' } });
    expect(custom.previous).toMatchObject({ start: '2025-08-31', end: '2025-09-04' });
  });

  it('is not comparable when either period is not fully covered, and says so', () => {
    const c = compareSpending(mk(), { ...ctx, statements: [stmt('bank', '2025-08-01', '2025-09-15')] });
    expect(c.comparable).toBe(false);
    expect(c.basis).toMatch(/cannot be compared/);
    expect(c.note).toMatch(/Not comparable/);
    expect(c.steps.length).toBeGreaterThan(0);
  });

  it('nets unclassified people flows like the summary does', () => {
    const txns = [
      spend('2025-09-05', 1000, { kind: 'p2p_out', category: 'sent_to_people' }),
      spend('2025-09-06', 400, { kind: 'p2p_in', category: 'received_from_people', direction: 'credit' }),
    ];
    const c = compareSpending(txns, ctx);
    expect(c.current.total).toBe(60_000);
    expect(c.steps[0]).toMatchObject({ key: 'sent_to_people', delta: 60_000 });
  });
});

describe('spendingCalendar and merchantPareto', () => {
  it('returns every date with coverage flags', () => {
    const days = spendingCalendar([spend('2025-09-02', 100), spend('2025-09-02', 50), spend('2025-09-03', 10, { direction: 'credit', kind: 'refund' })], {
      accounts: [bank()], statements: [stmt('bank', '2025-09-02', '2025-09-04')], start: '2025-09-01', end: '2025-09-05',
    });
    expect(days.map((d) => [d.date, d.amount, d.count, d.covered])).toEqual([
      ['2025-09-01', 0, 0, false],
      ['2025-09-02', 15_000, 2, true],
      ['2025-09-03', -1_000, 1, true],
      ['2025-09-04', 0, 0, true],
      ['2025-09-05', 0, 0, false],
    ]);
  });

  it('ranks merchants with cumulative share and the count needed for 80%', () => {
    const txns = [
      spend('2025-09-01', 500, { merchant: 'A', merchantKey: 'a' }),
      spend('2025-09-01', 300, { merchant: 'B', merchantKey: 'b' }),
      spend('2025-09-01', 100, { merchant: 'C', merchantKey: 'c' }),
      spend('2025-09-01', 100, { merchant: 'D', merchantKey: 'd' }),
    ];
    const p = merchantPareto(txns);
    expect(p.total).toBe(100_000);
    expect(p.merchantsFor80).toBe(2);
    expect(p.rows.map((r) => r.cumulativeShare)).toEqual([0.5, 0.8, 0.9, 1]);
    expect(merchantPareto(txns, 1).rows).toHaveLength(1);
    expect(merchantPareto([])).toEqual({ rows: [], total: 0, merchantsFor80: 0 });
  });
});

describe('moneyFlow', () => {
  const accounts = [bank(), card(), makeAccount({ id: 'sav', name: 'Savings 2' })];
  const range = { start: '2025-09-01', end: '2025-09-30' };
  const txns = [
    spend('2025-09-01', 50000, { direction: 'credit', kind: 'income', category: 'salary' }),
    spend('2025-09-02', 1000, { kind: 'p2p_in', category: 'received_from_people', direction: 'credit' }),
    spend('2025-09-03', 3000, { category: 'groceries' }),
    spend('2025-09-04', 5000, { kind: 'investment', category: 'investments' }),
    spend('2025-09-05', 2500, { kind: 'p2p_out', category: 'sent_to_people' }),
    makeTxn({ accountId: 'card', date: '2025-09-06', rupees: 800, category: 'shopping' }),
    spend('2025-09-10', 800, { id: 'pay-b', kind: 'card_payment', category: 'card_payment', linkedTxnId: 'pay-c' }),
    makeTxn({ id: 'pay-c', accountId: 'card', date: '2025-09-10', rupees: 800, direction: 'credit', kind: 'card_payment', category: 'card_payment', linkedTxnId: 'pay-b' }),
    spend('2025-09-12', 2000, { id: 'st-b', kind: 'self_transfer', category: 'self_transfer', linkedTxnId: 'st-s' }),
    makeTxn({ id: 'st-s', accountId: 'sav', date: '2025-09-12', rupees: 2000, direction: 'credit', kind: 'self_transfer', category: 'self_transfer', linkedTxnId: 'st-b' }),
  ];
  const get = (links: { from: string; to: string; amount: number }[], from: string, to: string) => links.find((l) => l.from === from && l.to === to)?.amount;

  it('spending view: income and people in, to accounts, to groups, saving and net people out; no card repayment', () => {
    const f = moneyFlow(txns, { accounts, ...range, view: 'spending' });
    expect(get(f.links, 'income', 'acct:bank')).toBe(5_000_000);
    expect(get(f.links, 'people_in', 'acct:bank')).toBe(100_000);
    expect(get(f.links, 'acct:bank', 'group:essentials')).toBe(300_000);
    expect(get(f.links, 'acct:card', 'group:lifestyle')).toBe(80_000);
    expect(get(f.links, 'acct:bank', 'saving')).toBe(500_000);
    expect(get(f.links, 'acct:bank', 'people_out')).toBe(150_000); // 2,500 sent - 1,000 received
    expect(f.links.some((l) => l.to === 'acct:card')).toBe(false);
    expect(f.links.some((l) => l.from === 'acct:sav' || l.to === 'acct:sav')).toBe(false);
    expect(f.nodes.find((n) => n.id === 'acct:card')?.kind).toBe('card');
    expect(f.nodes.find((n) => n.id === 'group:essentials')?.label).toBe('Essentials');
    expect(f.note).toMatch(/not which rupee funded which purchase/);
  });

  it('adds an unexplained source only when outflows exceed recorded inflows', () => {
    const f = moneyFlow([spend('2025-09-03', 3000, { category: 'groceries' })], { accounts, ...range, view: 'spending' });
    expect(get(f.links, 'unexplained', 'acct:bank')).toBe(300_000);
  });

  it('transfers view: own-account moves and card repayments only', () => {
    const f = moneyFlow(txns, { accounts, ...range, view: 'transfers' });
    expect(f.links).toEqual(expect.arrayContaining([
      { from: 'acct:bank', to: 'acct:card', amount: 80_000 },
      { from: 'acct:bank', to: 'acct:sav', amount: 200_000 },
    ]));
    expect(f.links).toHaveLength(2);
    expect(f.nodes.some((n) => n.kind === 'spending_group')).toBe(false);
    const orphan = moneyFlow([spend('2025-09-12', 700, { kind: 'self_transfer', category: 'self_transfer' })], { accounts, ...range, view: 'transfers' });
    expect(orphan.links).toEqual([{ from: 'acct:bank', to: 'unexplained', amount: 70_000 }]);
  });
});

describe('coverageGrid', () => {
  it('labels months before tracking, full, partial and missing', () => {
    const accounts = [bank()];
    const statements = [stmt('bank', '2025-08-15', '2025-09-30'), stmt('bank', '2025-11-01', '2025-11-10')];
    const cells = coverageGrid(accounts, statements, ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11']);
    expect(cells.map((c) => c.state)).toEqual(['before_tracking', 'full', 'full', 'missing', 'partial']);
    expect(cells[1]).toMatchObject({ coveredDays: 17, totalDays: 17 });
    expect(cells[4]).toMatchObject({ coveredDays: 10, totalDays: 30 });
    expect(cells[2].statementIds).toHaveLength(1);
    expect(coverageGrid([{ ...bank(), archived: true }], statements, ['2025-09'])).toEqual([]);
  });
});

describe('cardCycles', () => {
  const acct = card();
  const s1 = makeStatement({ id: 's1', accountId: 'card', periodStart: '2025-08-15', periodEnd: '2025-09-14', cardSummary: { statementDate: '2025-09-14', dueDate: '2025-10-02', totalDue: 100_000, minimumDue: 5_000, previousBalance: 20_000 } });
  const s2 = makeStatement({ id: 's2', accountId: 'card', periodStart: '2025-09-15', periodEnd: '2025-10-14', cardSummary: { statementDate: '2025-10-14', dueDate: '2025-11-02', totalDue: 30_000 } });
  const row = (statementId: string, date: string, rupees: number, extra: Record<string, unknown> = {}) =>
    makeTxn({ accountId: 'card', statementId, date, rupees, ...extra } as Parameters<typeof makeTxn>[0]);
  const txns = [
    row('s1', '2025-08-20', 600),
    row('s1', '2025-08-21', 100, { direction: 'credit', kind: 'refund' }),
    row('s1', '2025-09-01', 50, { kind: 'fee', category: 'fees_charges', merchant: 'Annual fee' }),
    row('s1', '2025-09-02', 30, { kind: 'fee', category: 'fees_charges', rawDescription: 'FINANCE CHARGES' }),
    row('s1', '2025-08-25', 200, { direction: 'credit', kind: 'card_payment' }),
    row('s2', '2025-09-20', 300),
    row('s2', '2025-09-25', 700, { id: 'cp1', direction: 'credit', kind: 'card_payment', linkedTxnId: 'bp1' }),
    makeTxn({ id: 'bp1', accountId: 'bank', statementId: 'b', date: '2025-09-24', rupees: 700, kind: 'card_payment', linkedTxnId: 'cp1' }),
  ];

  it('splits each cycle and matches repayments to bank legs', () => {
    const [c1, c2] = cardCycles(acct, [s2, s1], txns, '2025-10-20');
    expect(c1).toMatchObject({ statementId: 's1', dueDate: '2025-10-02', totalDue: 100_000, minimumDue: 5_000, previousBalance: 20_000, purchases: 60_000, refunds: 10_000, fees: 5_000, interest: 3_000, payments: 20_000 });
    expect(c1.matchedRepayments).toEqual([{ txnId: 'bp1', amount: 70_000, date: '2025-09-24', fromAccountId: 'bank' }]);
    expect(c1.paymentStatus).toBe('partly_paid');
    expect(c2.purchases).toBe(30_000);
    expect(c2.matchedRepayments).toEqual([]);
    expect(c2.paymentStatus).toBe('unknown');
  });

  it('is paid when repayments cover the bill, unpaid when a later statement shows none, unknown otherwise', () => {
    const more = [...txns, row('s2', '2025-09-26', 300, { direction: 'credit', kind: 'card_payment' })];
    expect(cardCycles(acct, [s1, s2], more, '2025-10-20')[0].paymentStatus).toBe('paid');
    const none = txns.filter((t) => t.id !== 'cp1' && t.id !== 'bp1');
    expect(cardCycles(acct, [s1, s2], none, '2025-10-20')[0].paymentStatus).toBe('unpaid');
    expect(cardCycles(acct, [s1], none, '2025-10-20')[0].paymentStatus).toBe('unknown');
    expect(cardCycles(acct, [], txns, '2025-10-20')).toEqual([]);
  });
});
