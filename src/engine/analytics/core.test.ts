import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyQuery,
  computeCoverage,
  dailySpending,
  dataRange,
  defaultPeriod,
  merchantBreakdown,
  monthlySeries,
  resolvePeriod,
  summarize,
} from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

describe('applyQuery', () => {
  const txns = [
    makeTxn({ id: 'a', date: '2025-10-01', amount: 125050, merchant: 'Cafe One', rawDescription: 'UPI/cafeone@okaxis/ref99', reference: 'RRN778899' }),
    makeTxn({ id: 'b', date: '2025-10-15', amount: 125000, merchant: 'Gym', category: 'fitness', note: 'yearly plan' }),
    makeTxn({ id: 'c', date: '2025-10-31', amount: 12500, merchant: 'Taxi', direction: 'credit', kind: 'refund', category: 'transport', needsReview: true }),
    makeTxn({ id: 'd', date: '2025-11-01', amount: 99900, merchant: 'Books', counterparty: { type: 'merchant', name: 'Book Hub', vpa: 'bookhub@upi' } }),
  ];
  const ids = (q: Parameters<typeof applyQuery>[1]) => applyQuery(txns, q).map((t) => t.id);

  it('treats start/end as inclusive calendar bounds', () => {
    expect(ids({ start: '2025-10-01', end: '2025-10-31' })).toEqual(['a', 'b', 'c']);
    expect(ids({ start: '2025-10-31', end: '2025-11-01' })).toEqual(['c', 'd']);
  });

  it('ANDs every criterion', () => {
    expect(ids({ start: '2025-10-01', end: '2025-10-31', categories: ['fitness'], direction: 'debit' })).toEqual(['b']);
    expect(ids({ categories: ['fitness'], direction: 'credit' })).toEqual([]);
    expect(ids({ needsReview: true })).toEqual(['c']);
    expect(ids({ kinds: ['refund'] })).toEqual(['c']);
    expect(ids({ buckets: ['spending'], direction: 'credit' })).toEqual(['c']);
    expect(ids({ ids: ['a', 'd'], start: '2025-10-02' })).toEqual(['d']);
  });

  it('searches text fields case-insensitively', () => {
    expect(ids({ search: 'CAFE' })).toEqual(['a']);
    expect(ids({ search: 'okaxis' })).toEqual(['a']);
    expect(ids({ search: 'rrn7788' })).toEqual(['a']);
    expect(ids({ search: 'yearly' })).toEqual(['b']);
    expect(ids({ search: 'bookhub@upi' })).toEqual(['d']);
    expect(ids({ search: 'book hub' })).toEqual(['d']);
    expect(ids({ search: 'nothing-like-this' })).toEqual([]);
  });

  it('searches amounts: "1,250", "1250" and "1250.50"', () => {
    expect(ids({ search: '1,250' })).toEqual(['a', 'b']);
    expect(ids({ search: '1250' })).toEqual(['a', 'b']);
    expect(ids({ search: '₹1250' })).toEqual(['a', 'b']);
    expect(ids({ search: '1250.50' })).toEqual(['a']);
    expect(ids({ search: '1,250.00' })).toEqual(['b']);
    expect(ids({ search: '125' })).toEqual(['c']);
  });

  it('keeps summary and list in agreement for the same query', () => {
    const acc = makeAccount({ id: 'acc1' });
    const st = makeStatement({ accountId: 'acc1', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
    const q = { start: '2025-10-01', end: '2025-10-31', search: '1250' };
    const list = applyQuery(txns, q);
    const s = summarize(list, { accounts: [acc], statements: [st], start: q.start, end: q.end });
    expect(s.counts.total).toBe(list.length);
    expect(s.spending).toBe(125050 + 125000);
  });
});

describe('periods', () => {
  it('resolves calendar-month presets with inclusive bounds and nice labels', () => {
    const today = '2025-09-14';
    expect(resolvePeriod('this_month', { today })).toMatchObject({ start: '2025-09-01', end: '2025-09-30', label: 'September 2025' });
    expect(resolvePeriod('last_month', { today })).toMatchObject({ start: '2025-08-01', end: '2025-08-31', label: 'August 2025' });
    expect(resolvePeriod('last_3_months', { today })).toMatchObject({ start: '2025-07-01', end: '2025-09-30', label: 'Jul – Sep 2025' });
    expect(resolvePeriod('last_3_months', { today: '2025-01-10' }).label).toBe('Nov 2024 – Jan 2025');
    expect(resolvePeriod('last_12_months', { today })).toMatchObject({ start: '2024-10-01', end: '2025-09-30' });
    expect(resolvePeriod('this_year', { today })).toMatchObject({ start: '2025-01-01', end: '2025-12-31', label: '2025' });
    expect(resolvePeriod('last_month', { today: '2025-03-10' })).toMatchObject({ start: '2025-02-01', end: '2025-02-28' });
  });

  it('labels all-time and custom ranges', () => {
    const p = resolvePeriod('all', { today: '2025-09-30', dataRange: { min: '2024-06-03', max: '2025-09-20' } });
    expect(p.label).toBe('All time (Jun 2024 – Sep 2025)');
    expect(p.start).toBe('2024-06-03');
    expect(resolvePeriod('custom', { today: '2025-09-30', custom: { start: '2025-10-01', end: '2025-10-31' } }).label).toBe('October 2025');
    expect(resolvePeriod('custom', { today: '2025-09-30', custom: { start: '2025-10-03', end: '2025-10-17' } }).label).toBe('3 Oct 2025 – 17 Oct 2025');
  });

  it('defaults to the month of the latest transaction', () => {
    const txns = [makeTxn({ date: '2025-03-04' }), makeTxn({ date: '2025-05-31' })];
    expect(dataRange(txns)).toEqual({ min: '2025-03-04', max: '2025-05-31' });
    expect(defaultPeriod(txns, '2025-09-14')).toMatchObject({ start: '2025-05-01', end: '2025-05-31', label: 'May 2025' });
    expect(defaultPeriod([], '2025-09-14').label).toBe('September 2025');
    expect(dataRange([])).toBeNull();
  });
});

describe('computeCoverage', () => {
  it('reports gaps and plain-language notes', () => {
    const acc = makeAccount({ id: 'ic', name: 'ICICI Savings' });
    const earlier = makeStatement({ accountId: 'ic', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
    const st = makeStatement({ accountId: 'ic', periodStart: '2025-10-15', periodEnd: '2025-10-31' });
    const cov = computeCoverage([acc], [earlier, st], '2025-10-01', '2025-10-31');
    expect(cov.complete).toBe(false);
    expect(cov.accounts[0]).toMatchObject({ accountId: 'ic', coveredDays: 17, totalDays: 31, complete: false });
    expect(cov.accounts[0].gaps).toEqual([{ start: '2025-10-01', end: '2025-10-14' }]);
    expect(cov.notes).toEqual(['No ICICI Savings statement covers 1–14 Oct 2025']);
    expect(cov.incomeCoverage).toBe('partial');
  });

  it('unions back-to-back statements and clips to the range', () => {
    const acc = makeAccount({ id: 'ic', name: 'ICICI Savings' });
    const s1 = makeStatement({ accountId: 'ic', periodStart: '2025-09-15', periodEnd: '2025-10-14' });
    const s2 = makeStatement({ accountId: 'ic', periodStart: '2025-10-15', periodEnd: '2025-11-14' });
    const cov = computeCoverage([acc], [s1, s2], '2025-10-01', '2025-10-31');
    expect(cov.complete).toBe(true);
    expect(cov.incomeCoverage).toBe('full');
    expect(cov.notes).toEqual([]);
  });

  it('finds a gap in the middle, and ignores archived or statement-less accounts', () => {
    const ic = makeAccount({ id: 'ic', name: 'ICICI Savings' });
    const old = makeAccount({ id: 'old', name: 'Old Account', archived: true });
    const empty = makeAccount({ id: 'empty', name: 'Never Imported' });
    const s1 = makeStatement({ accountId: 'ic', periodStart: '2025-10-01', periodEnd: '2025-10-10' });
    const s2 = makeStatement({ accountId: 'ic', periodStart: '2025-10-20', periodEnd: '2025-10-31' });
    const s3 = makeStatement({ accountId: 'old', periodStart: '2025-01-01', periodEnd: '2025-01-31' });
    const cov = computeCoverage([ic, old, empty], [s1, s2, s3], '2025-10-01', '2025-10-31');
    expect(cov.accounts.map((a) => a.accountId)).toEqual(['ic']);
    expect(cov.accounts[0].gaps).toEqual([{ start: '2025-10-11', end: '2025-10-19' }]);
    expect(cov.notes[0]).toBe('No ICICI Savings statement covers 11–19 Oct 2025');
  });

  it('only expects an account from its earliest statement onward (not before it was tracked)', () => {
    const icici = makeAccount({ id: 'ic', name: 'ICICI Savings' });
    const dbs = makeAccount({ id: 'dbs', name: 'DBS Savings' });
    const ic = makeStatement({ accountId: 'ic', periodStart: '2024-06-01', periodEnd: '2024-12-31' });
    const db = makeStatement({ accountId: 'dbs', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
    const nov = computeCoverage([icici, dbs], [ic, db], '2024-11-01', '2024-11-30');
    expect(nov.complete).toBe(true);
    expect(nov.incomeCoverage).toBe('full');
    expect(nov.notes).toEqual([]);
    expect(nov.accounts.map((a) => a.accountId)).toEqual(['ic']);
    // once DBS is tracked, a month after its latest statement is flagged
    const oct25 = computeCoverage([icici, dbs], [ic, db], '2025-10-01', '2025-10-31');
    expect(oct25.notes).toContain('No DBS Savings statement covers 1–31 Oct 2025');
    expect(oct25.complete).toBe(false);
    // a gap between two statements of the same account is still missing
    const db2 = makeStatement({ accountId: 'dbs', periodStart: '2025-11-01', periodEnd: '2025-11-30' });
    const gap = computeCoverage([dbs], [db, db2], '2025-09-01', '2025-11-30');
    expect(gap.accounts[0].gaps).toEqual([{ start: '2025-10-01', end: '2025-10-31' }]);
    expect(gap.complete).toBe(false);
    // before any account was tracked nothing is known
    const before = computeCoverage([icici, dbs], [ic, db], '2023-01-01', '2023-01-31');
    expect(before.complete).toBe(false);
    expect(before.incomeCoverage).toBe('none');
    // the savings rate is not suppressed for November 2024
    const s = summarize([makeTxn({ accountId: 'ic', date: '2024-11-01', rupees: 50000, direction: 'credit', kind: 'income' })], { accounts: [icici, dbs], statements: [ic, db], start: '2024-11-01', end: '2024-11-30' });
    expect(s.savingsRate).toBe(100);
  });

  it('gives incomeCoverage "none" for credit-card-only data, and is never complete with no statements', () => {
    const card = makeAccount({ id: 'cc', type: 'credit_card', name: 'Test Card' });
    const st = makeStatement({ accountId: 'cc', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
    const cov = computeCoverage([card], [st], '2025-10-01', '2025-10-31');
    expect(cov.complete).toBe(true);
    expect(cov.incomeCoverage).toBe('none');
    const none = computeCoverage([card], [], '2025-10-01', '2025-10-31');
    expect(none.complete).toBe(false);
    expect(none.notes.length).toBeGreaterThan(0);
  });

  it('falls back to row dates when a statement has no printed period', () => {
    const acc = makeAccount({ id: 'ic', name: 'ICICI Savings' });
    const st = makeStatement({ id: 'sx', accountId: 'ic' });
    const rows = [makeTxn({ statementId: 'sx', date: '2025-10-01' }), makeTxn({ statementId: 'sx', date: '2025-10-31' })];
    expect(computeCoverage([acc], [st], '2025-10-01', '2025-10-31', rows).complete).toBe(true);
    expect(computeCoverage([acc], [st], '2025-10-01', '2025-10-31').complete).toBe(false);
  });
});

describe('summarize', () => {
  const bank = makeAccount({ id: 'bank', type: 'savings', name: 'Bank' });
  const card = makeAccount({ id: 'card', type: 'credit_card', name: 'Card' });
  const stBank = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
  const stCard = makeStatement({ accountId: 'card', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
  const ctx = { accounts: [bank, card], statements: [stBank, stCard], start: '2025-10-01', end: '2025-10-31' };

  it('counts salary 10,000, card purchase 1,000 and the card bill only once: income 10,000, spending 1,000, rate 90%', () => {
    const txns = [
      makeTxn({ accountId: 'bank', date: '2025-10-01', rupees: 10000, direction: 'credit', kind: 'income', category: 'salary' }),
      makeTxn({ accountId: 'card', date: '2025-10-03', rupees: 1000, kind: 'expense', category: 'shopping' }),
      makeTxn({ accountId: 'bank', date: '2025-10-10', rupees: 1000, kind: 'card_payment', category: 'card_payment' }),
      makeTxn({ accountId: 'card', date: '2025-10-10', rupees: 1000, direction: 'credit', kind: 'card_payment', category: 'card_payment' }),
    ];
    const s = summarize(txns, ctx);
    expect(s.income).toBe(1_000_000);
    expect(s.spending).toBe(100_000);
    expect(s.netSavings).toBe(900_000);
    expect(s.savingsRate).toBe(90);
    expect(s.savingsRateNote).toBeUndefined();
    expect(s.neutral.cardPayments).toBe(100_000);
    // The bank paying the card bill IS real cash leaving the bank account.
    expect(s.cashFlow).toEqual({ inflow: 1_000_000, outflow: 100_000, net: 900_000 });
    expect(s.counts).toEqual({ total: 4, needsReview: 0, debits: 2, credits: 2 });
  });

  it('withholds the savings rate with a note for credit-card-only data', () => {
    const only = { accounts: [card], statements: [stCard], start: '2025-10-01', end: '2025-10-31' };
    const s = summarize([makeTxn({ accountId: 'card', date: '2025-10-03', rupees: 1000 })], only);
    expect(s.savingsRate).toBeNull();
    expect(s.savingsRateNote).toMatch(/credit-card/);
    expect(s.coverage.incomeCoverage).toBe('none');
  });

  it('withholds the rate when the bank statement is partial or income is zero', () => {
    const partial = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-14' });
    const income = makeTxn({ accountId: 'bank', date: '2025-10-10', rupees: 5000, direction: 'credit', kind: 'income' });
    const s = summarize([income], { ...ctx, statements: [partial, stCard] });
    expect(s.savingsRate).toBeNull();
    expect(s.savingsRateNote).toMatch(/missing/);
    const noIncome = summarize([makeTxn({ accountId: 'bank', date: '2025-10-20', rupees: 50 })], ctx);
    expect(noIncome.savingsRate).toBeNull();
    expect(noIncome.savingsRateNote).toMatch(/No regular income/);
  });

  it('nets a linked refund into the original category and shows an unlinked refund as its own negative line', () => {
    const buy = makeTxn({ id: 'buy', accountId: 'card', date: '2025-10-02', rupees: 1000, category: 'food_dining' });
    const linked = makeTxn({
      accountId: 'card', date: '2025-10-05', rupees: 400, direction: 'credit', kind: 'refund', category: 'refunds',
      linkedTxnId: 'buy', linkRole: 'refund_of',
    });
    const loose = makeTxn({ accountId: 'card', date: '2025-10-06', rupees: 150, direction: 'credit', kind: 'refund', category: 'refunds' });
    const s = summarize([buy, linked, loose], ctx);
    expect(s.spending).toBe(45_000);
    expect(s.refunds).toBe(55_000);
    const food = s.byCategory.find((c) => c.category === 'food_dining');
    expect(food?.amount).toBe(60_000);
    expect(s.byCategory.find((c) => c.category === 'refunds')?.amount).toBe(-15_000);
    expect(s.byCategory.map((c) => c.amount)).toEqual([...s.byCategory.map((c) => c.amount)].sort((a, b) => b - a));
  });

  it('nets unclassified people flows into spending and never counts money from people as income', () => {
    const txns = [
      makeTxn({ accountId: 'bank', date: '2025-10-02', rupees: 2000, kind: 'p2p_out', category: 'sent_to_people' }),
      makeTxn({ accountId: 'bank', date: '2025-10-03', rupees: 500, kind: 'expense', category: 'groceries' }),
      makeTxn({ accountId: 'bank', date: '2025-10-04', rupees: 700, direction: 'credit', kind: 'p2p_in', category: 'received_from_people' }),
      makeTxn({ accountId: 'bank', date: '2025-10-05', rupees: 300, kind: 'self_transfer', category: 'self_transfer' }),
      makeTxn({ accountId: 'bank', date: '2025-10-05', rupees: 300, direction: 'credit', kind: 'self_transfer', category: 'self_transfer' }),
      makeTxn({ accountId: 'bank', date: '2025-10-06', rupees: 900, direction: 'credit', kind: 'loan_disbursal', category: 'loan_received' }),
      makeTxn({ accountId: 'bank', date: '2025-10-07', rupees: 1500, kind: 'investment', category: 'investments' }),
    ];
    const s = summarize(txns, ctx);
    // unclassified people flows are netted: 2,000 out - 700 in = 1,300 counts, plus 500 groceries
    expect(s.spending).toBe(180_000);
    expect(s.peopleOut).toBe(200_000);
    expect(s.peopleIn).toBe(70_000);
    expect(s.peopleNetOut).toBe(130_000);
    expect(s.consumption).toBe(50_000);
    expect(s.income).toBe(0);
    expect(s.invested).toBe(150_000);
    expect(s.neutral).toEqual({ selfTransfers: 30_000, cardPayments: 0, reversals: 0, loanReceived: 90_000 });
    expect(s.cashFlow.inflow).toBe(70_000 + 90_000);
    expect(s.cashFlow.outflow).toBe(200_000 + 50_000 + 150_000);
    expect(s.byGroup[0].group).toBe('people');
    expect(s.byCategory[0]).toMatchObject({ category: 'sent_to_people', amount: 130_000 });
    expect(s.byCategory[0].share).toBeCloseTo(130 / 180);
  });

  it('caps the coverage window at today when given', () => {
    const half = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-14' });
    const s = summarize([], { accounts: [bank], statements: [half], start: '2025-10-01', end: '2025-10-31', today: '2025-10-14' });
    expect(s.coverage.complete).toBe(true);
  });
});

describe('monthlySeries, dailySpending, merchantBreakdown', () => {
  const bank = makeAccount({ id: 'bank', name: 'Bank' });
  const st = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-10-14' });

  it('marks months complete only when fully covered', () => {
    const txns = [
      makeTxn({ accountId: 'bank', date: '2025-09-05', rupees: 1000 }),
      makeTxn({ accountId: 'bank', date: '2025-09-06', rupees: 5000, direction: 'credit', kind: 'income' }),
      makeTxn({ accountId: 'bank', date: '2025-10-05', rupees: 200 }),
    ];
    const pts = monthlySeries(txns, { accounts: [bank], statements: [st], months: ['2025-08', '2025-09', '2025-10'] });
    expect(pts.map((p) => p.complete)).toEqual([false, true, false]);
    expect(pts[1]).toMatchObject({ month: '2025-09', income: 500_000, spending: 100_000, netSavings: 400_000 });
    expect(pts[2].spending).toBe(20_000);
  });

  it('zero-fills daily spending and nets refunds', () => {
    const txns = [
      makeTxn({ date: '2025-10-01', rupees: 100 }),
      makeTxn({ date: '2025-10-03', rupees: 50 }),
      makeTxn({ date: '2025-10-03', rupees: 20, direction: 'credit', kind: 'refund' }),
      makeTxn({ date: '2025-10-10', rupees: 999 }),
    ];
    expect(dailySpending(txns, '2025-10-01', '2025-10-04')).toEqual([
      { date: '2025-10-01', amount: 10_000 },
      { date: '2025-10-02', amount: 0 },
      { date: '2025-10-03', amount: 3_000 },
      { date: '2025-10-04', amount: 0 },
    ]);
    expect(dailySpending(txns, '2025-10-02', '2025-10-01')).toEqual([]);
  });

  it('ranks spending merchants net of refunds', () => {
    const txns = [
      makeTxn({ merchant: 'Alpha', date: '2025-10-01', rupees: 300, category: 'shopping' }),
      makeTxn({ merchant: 'Alpha', date: '2025-10-05', rupees: 100, category: 'shopping' }),
      makeTxn({ merchant: 'Alpha', date: '2025-10-06', rupees: 50, direction: 'credit', kind: 'refund' }),
      makeTxn({ merchant: 'Beta', date: '2025-10-02', rupees: 360 }),
      makeTxn({ merchant: 'Gamma', date: '2025-10-02', rupees: 80 }),
      makeTxn({ merchant: 'Gamma', date: '2025-10-03', rupees: 80, direction: 'credit', kind: 'refund' }),
      makeTxn({ merchant: 'Salary Co', date: '2025-10-01', rupees: 9000, direction: 'credit', kind: 'income' }),
    ];
    const out = merchantBreakdown(txns);
    expect(out.map((m) => [m.merchant, m.total])).toEqual([
      ['Beta', 36_000],
      ['Alpha', 35_000],
    ]);
    expect(out[1]).toMatchObject({ count: 2, average: 17_500, lastDate: '2025-10-06', category: 'shopping' });
    expect(merchantBreakdown(txns, 1)).toHaveLength(1);
  });
});
