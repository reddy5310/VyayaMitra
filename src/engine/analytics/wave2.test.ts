import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedbackEvent, StatementTemplate } from '@/domain/types';
import { defaultPeriod, generateInsights, learningStats, summarize, upcomingCardDues } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const fb = (over: Partial<FeedbackEvent> & { txnId: string; at: string }): FeedbackEvent => ({
  id: `f${over.txnId}${over.at}`,
  merchantKey: 'm',
  action: 'confirm',
  scope: 'this',
  before: { kind: 'expense', category: 'shopping', categorySource: 'builtin_rule', kindSource: 'rule', confidence: 0.8 },
  after: { kind: 'expense', category: 'shopping' },
  ...over,
});

const tpl = (source: StatementTemplate['source']): StatementTemplate =>
  ({ id: `tp${source}`, name: 'x', institution: 'OTHER', accountType: 'savings', fileKind: 'pdf', source }) as StatementTemplate;

describe('learningStats', () => {
  it('counts sources, auto-understood share, rules, templates, corrections and taught merchants', () => {
    const txns = [
      makeTxn({ date: '2025-09-01', categorySource: 'builtin_rule', confidence: 0.9 }),
      makeTxn({ date: '2025-09-02', categorySource: 'learned', confidence: 0.6 }),
      makeTxn({ date: '2025-09-03', categorySource: 'none', confidence: 0.2, needsReview: true }),
      makeTxn({ date: '2025-09-04', categorySource: 'builtin_rule', confidence: 0.9, needsReview: true }),
      makeTxn({ date: '2025-09-05', categorySource: 'user_rule', merchant: 'Chai Point', merchantKey: 'chaipoint' }),
      makeTxn({ date: '2025-09-06', categorySource: 'user_rule', merchant: 'Chai Point', merchantKey: 'chaipoint' }),
      makeTxn({ date: '2025-09-07', categorySource: 'user_rule', merchant: 'Gym', merchantKey: 'gym' }),
      makeTxn({ date: '2025-09-08', categorySource: 'user_txn', merchant: 'One-off', merchantKey: 'oneoff' }),
    ];
    const s = learningStats(txns, {
      feedback: [fb({ txnId: 'a', at: '2025-09-10T10:00:00Z', action: 'category' }), fb({ txnId: 'b', at: '2025-09-10T11:00:00Z' })],
      rules: [{ id: 'r1' }, { id: 'r2' }],
      templates: [tpl('auto'), tpl('auto'), tpl('user'), tpl('imported')],
      today: '2025-09-30',
    });
    expect(s.totalTransactions).toBe(8);
    expect(s.needsReview).toBe(2);
    expect(s.autoUnderstoodShare).toBeCloseTo(6 / 8);
    expect(s.bySource).toEqual({ builtin_rule: 2, learned: 1, none: 1, user_rule: 3, user_txn: 1 });
    expect(s.rules).toBe(2);
    expect(s.templates).toEqual({ total: 4, auto: 2, user: 1, imported: 1 });
    expect(s.corrections).toBe(1);
    expect(s.topTaught).toEqual([
      { merchantKey: 'chaipoint', merchant: 'Chai Point', rows: 2 },
      { merchantKey: 'gym', merchant: 'Gym', rows: 1 },
    ]);
  });

  it('builds a monthly accuracy trend over automatic decisions, null when nothing to judge', () => {
    const userBefore = { kind: 'expense' as const, category: 'x', categorySource: 'user_rule' as const, kindSource: 'user_rule' as const, confidence: 1 };
    const feedback = [
      fb({ txnId: 't1', at: '2025-07-02T00:00:00Z' }),
      fb({ txnId: 't2', at: '2025-07-02T00:00:00Z' }),
      fb({ txnId: 't3', at: '2025-07-03T00:00:00Z' }),
      fb({ txnId: 't4', at: '2025-07-03T00:00:00Z', action: 'category' }),
      fb({ txnId: 't5', at: '2025-09-03T00:00:00Z', before: userBefore }), // user's own decision: not an automatic one
      fb({ txnId: 't6', at: '2025-10-03T00:00:00Z', action: 'kind' }),
      fb({ txnId: 't6', at: '2025-10-04T00:00:00Z', action: 'reset' }),
    ];
    const s = learningStats([], { feedback, rules: [], templates: [], today: '2025-10-20' });
    expect(s.accuracyTrend).toEqual([
      { month: '2025-07', accuracy: 0.75, corrections: 1, decisions: 4 },
      { month: '2025-08', accuracy: null, corrections: 0, decisions: 0 },
      { month: '2025-09', accuracy: null, corrections: 0, decisions: 0 },
      { month: '2025-10', accuracy: 0, corrections: 1, decisions: 1 },
    ]);
    expect(s.corrections).toBe(2);
    expect(learningStats([], { feedback: [], rules: [], templates: [], today: '2025-10-20' })).toMatchObject({ accuracyTrend: [], autoUnderstoodShare: 0, topTaught: [] });
  });
});

describe('upcomingCardDues', () => {
  const card = makeAccount({ id: 'cc', type: 'credit_card', name: 'Test Card' });
  const old = makeStatement({ accountId: 'cc', periodStart: '2025-07-15', periodEnd: '2025-08-14', cardSummary: { dueDate: '2025-09-02', totalDue: 111_100 } });
  const latest = makeStatement({
    accountId: 'cc', periodStart: '2025-08-15', periodEnd: '2025-09-14',
    cardSummary: { statementDate: '2025-09-14', dueDate: '2025-10-02', totalDue: 500_000, minimumDue: 25_000 },
  });
  const pay = (date: string, rupees: number) => makeTxn({ accountId: 'cc', date, rupees, direction: 'credit', kind: 'card_payment', category: 'card_payment' });

  it('uses the latest statement and counts only payments after the statement date', () => {
    const txns = [pay('2025-09-14', 999), pay('2025-09-20', 2000), pay('2025-09-25', 1000), makeTxn({ accountId: 'cc', date: '2025-09-30', rupees: 50, direction: 'credit', kind: 'refund' })];
    const [d] = upcomingCardDues([card], [old, latest], txns, '2025-09-28');
    expect(d).toMatchObject({ accountId: 'cc', statementId: latest.id, dueDate: '2025-10-02', totalDue: 500_000, minimumDue: 25_000, paidSoFar: 300_000, status: 'partly_paid', daysLeft: 4 });
  });

  it('reports due, paid and overdue', () => {
    expect(upcomingCardDues([card], [latest], [], '2025-09-20')[0]).toMatchObject({ status: 'due', daysLeft: 12, paidSoFar: 0 });
    expect(upcomingCardDues([card], [latest], [pay('2025-09-30', 5000)], '2025-10-01')[0].status).toBe('paid');
    expect(upcomingCardDues([card], [latest], [], '2025-10-03')[0]).toMatchObject({ status: 'overdue', daysLeft: -1 });
    // minimum covered after the due date: still partly paid, not overdue
    expect(upcomingCardDues([card], [latest], [pay('2025-09-30', 300)], '2025-10-03')[0].status).toBe('partly_paid');
    expect(upcomingCardDues([card], [latest], [pay('2025-09-30', 100)], '2025-10-03')[0].status).toBe('overdue');
  });

  it('skips non-card, archived and undated statements', () => {
    const bank = makeAccount({ id: 'b' });
    const undated = makeStatement({ accountId: 'cc', cardSummary: { totalDue: 100 } });
    expect(upcomingCardDues([bank, { ...card, archived: true }], [latest], [], '2025-09-20')).toEqual([]);
    expect(upcomingCardDues([card], [undated], [], '2025-09-20')).toEqual([]);
  });

  it('surfaces a card_due insight within 7 days or when overdue, not before', () => {
    const bank = makeAccount({ id: 'bank', name: 'Bank' });
    const stBank = makeStatement({ accountId: 'bank', periodStart: '2025-08-01', periodEnd: '2025-10-31' });
    const input = (today: string, txns = [pay('2025-09-20', 1000)]) => ({
      txns, accounts: [bank, card], statements: [stBank, latest], budgets: [], recurringDecisions: [], actions: [],
      start: '2025-09-01', end: '2025-09-30', today,
    });
    const soon = generateInsights(input('2025-09-28')).find((i) => i.type === 'card_due');
    expect(soon?.title).toBe('Test Card bill is due soon');
    expect(soon?.body).toContain('₹5,000');
    expect(soon?.body).toContain('₹1,000 paid so far');
    expect(soon?.evidence.txnIds).toHaveLength(1);
    expect(generateInsights(input('2025-09-20')).some((i) => i.type === 'card_due')).toBe(false);
    const late = generateInsights(input('2025-10-05', [])).find((i) => i.type === 'card_due');
    expect(late?.severity).toBe('critical');
    expect(late?.title).toBe('Test Card bill is overdue');
    expect(generateInsights(input('2025-09-28', [pay('2025-09-20', 5000)])).some((i) => i.type === 'card_due')).toBe(false);
  });
});

describe('learning nudge', () => {
  it('suggests teaching a few merchants when 10+ review rows share them', () => {
    const bank = makeAccount({ id: 'bank', name: 'Bank' });
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
    const rows = (merchant: string, n: number) => Array.from({ length: n }, (_, i) => makeTxn({ accountId: 'bank', date: `2025-09-${String(i + 1).padStart(2, '0')}`, rupees: 50, merchant, needsReview: true }));
    const txns = [...rows('Alpha Stores', 6), ...rows('Beta Mart', 4), ...rows('Gamma', 2), ...rows('Delta', 1)];
    const out = generateInsights({ txns, accounts: [bank], statements: [st], budgets: [], recurringDecisions: [], actions: [], start: '2025-09-01', end: '2025-09-30', today: '2025-10-05' });
    const l = out.find((i) => i.type === 'learning');
    expect(l?.title).toBe('Teach 3 merchants to fix 12 rows');
    expect(l?.action?.type).toBe('review_transactions');
    expect(l?.body).toContain('Alpha Stores (6)');
    const few = generateInsights({ txns: rows('Alpha Stores', 6), accounts: [bank], statements: [st], budgets: [], recurringDecisions: [], actions: [], start: '2025-09-01', end: '2025-09-30', today: '2025-10-05' });
    expect(few.some((i) => i.type === 'learning')).toBe(false);
  });
});

describe('defaultPeriod with statements', () => {
  it('opens on the month of the latest statement end, not a month with 2 stray rows', () => {
    const st = makeStatement({ id: 'big', accountId: 'a', periodStart: '2025-09-01', periodEnd: '2025-09-30', rowCount: 60 });
    const sept = Array.from({ length: 60 }, (_, i) => makeTxn({ statementId: 'big', date: `2025-09-${String((i % 28) + 1).padStart(2, '0')}` }));
    const stray = [makeTxn({ statementId: 'big', date: '2025-10-01' }), makeTxn({ statementId: 'big', date: '2025-10-01' })];
    const p = defaultPeriod([...sept, ...stray], '2026-02-10', [st]);
    expect(p).toMatchObject({ start: '2025-09-01', end: '2025-09-30', label: 'September 2025' });
  });

  it('avoids a nearly empty latest month even without statements, but keeps small ledgers as they are', () => {
    const sept = Array.from({ length: 60 }, (_, i) => makeTxn({ date: `2025-09-${String((i % 28) + 1).padStart(2, '0')}` }));
    const stray = [makeTxn({ date: '2025-10-01' }), makeTxn({ date: '2025-10-01' })];
    expect(defaultPeriod([...sept, ...stray], '2026-02-10').label).toBe('September 2025');
    expect(defaultPeriod([makeTxn({ date: '2025-03-04' }), makeTxn({ date: '2025-05-31' })], '2026-02-10').label).toBe('May 2025');
    const st = makeStatement({ accountId: 'a', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
    expect(defaultPeriod([], '2025-12-01', [st]).label).toBe('October 2025');
    expect(defaultPeriod([], '2025-12-01').label).toBe('December 2025');
  });

  it('falls back to the busier earlier month when the statement-end month has no rows', () => {
    const st = makeStatement({ id: 'x', accountId: 'a', periodStart: '2025-08-01', periodEnd: '2025-10-31', rowCount: 30 });
    const aug = Array.from({ length: 30 }, () => makeTxn({ statementId: 'x', date: '2025-08-10' }));
    expect(defaultPeriod(aug, '2026-01-01', [st]).label).toBe('August 2025');
  });
});

describe('summary consumption', () => {
  it('separates merchant consumption from money sent to people without double counting', () => {
    const bank = makeAccount({ id: 'bank' });
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-31' });
    const txns = [
      makeTxn({ accountId: 'bank', date: '2025-10-02', rupees: 2000, kind: 'p2p_out', category: 'sent_to_people' }),
      makeTxn({ accountId: 'bank', date: '2025-10-03', rupees: 500 }),
    ];
    const s = summarize(txns, { accounts: [bank], statements: [st], start: '2025-10-01', end: '2025-10-31' });
    expect(s.spending).toBe(250_000);
    expect(s.peopleOut).toBe(200_000);
    expect(s.consumption).toBe(50_000);
    expect((s.consumption ?? 0) + (s.peopleNetOut ?? 0)).toBe(s.spending);
  });
});
