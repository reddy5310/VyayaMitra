import { beforeEach, describe, expect, it } from 'vitest';
import type { CardPolicy, ChargeLink, InsightFeedback, RefundAllocation, RefundCase, SavingAction } from '@/domain/types';
import { actionTotals, feesSummary, moneyBack, recommendations } from './index';
import type { ActionOutcome } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const t = (date: string, rupees: number, extra: Record<string, unknown> = {}) =>
  makeTxn({ accountId: 'card', date, rupees, ...extra } as Parameters<typeof makeTxn>[0]);
const mkCase = (over: Partial<RefundCase> = {}): RefundCase => ({
  id: 'c1', purchaseTxnIds: ['p1'], merchant: 'Gadget Store', merchantKey: 'gadgetstore', expectedSource: 'full_purchase', state: 'open', createdAt: '2025-09-01T00:00:00Z', updatedAt: '2025-09-01T00:00:00Z', ...over,
});
const alloc = (over: Partial<RefundAllocation> & { creditTxnId: string }): RefundAllocation => ({ id: `al${over.creditTxnId}`, caseId: 'c1', amount: 0, source: 'user', reason: 'x', createdAt: 'x', ...over });

describe('moneyBack', () => {
  const purchase = () => t('2025-08-01', 1000, { id: 'p1', merchant: 'Gadget Store', merchantKey: 'gadgetstore' });
  const credit = (rupees: number, id = 'r1', date = '2025-08-20') => t(date, rupees, { id, direction: 'credit', kind: 'refund', category: 'refunds', merchant: 'Gadget Store', merchantKey: 'gadgetstore' });

  it('tracks expected, received and outstanding with a timeline', () => {
    const r = moneyBack([purchase(), credit(400)], { cases: [mkCase({ promisedDate: '2025-08-31' })], allocations: [alloc({ creditTxnId: 'r1', amount: 40_000 })], today: '2025-09-10' });
    const c = r.cases[0];
    expect(c).toMatchObject({ purchaseTotal: 100_000, expected: 100_000, received: 40_000, outstanding: 60_000, status: 'partially_received', overdue: true, ageDays: 10 });
    expect(c.timeline.map((x) => x.kind)).toEqual(['purchase', 'credit', 'promised']);
    expect(r.totals).toMatchObject({ receivedInPeriod: 40_000, expectedOutstanding: 60_000, openCases: 1, amountToConfirm: 0 });
    expect(r.needsMatching).toEqual([]); // the whole credit is allocated
  });

  it('is received when fully allocated, over_received beyond, closed when closed', () => {
    const base = { allocations: [alloc({ creditTxnId: 'r1', amount: 100_000 })], today: '2025-09-10' };
    const all = [purchase(), credit(1000)];
    expect(moneyBack(all, { ...base, cases: [mkCase()] }).cases[0]).toMatchObject({ status: 'received', overdue: false, ageDays: 0 });
    expect(moneyBack(all, { ...base, cases: [mkCase({ expectedAmount: 80_000, expectedSource: 'user' })] }).cases[0].status).toBe('over_received');
    expect(moneyBack(all, { ...base, cases: [mkCase({ state: 'closed', closedReason: 'received' })] }).cases[0].status).toBe('closed');
    expect(moneyBack(all, { ...base, cases: [mkCase({ state: 'closed' })] }).needsMatching).toEqual([]);
  });

  it('shows "amount to confirm" when the expected amount is unknown, and ages open cases', () => {
    const r = moneyBack([purchase()], { cases: [mkCase({ expectedSource: 'unknown' })], allocations: [], today: '2025-09-10' });
    expect(r.cases[0]).toMatchObject({ status: 'amount_to_confirm', ageDays: 40, overdue: true });
    expect(r.cases[0].outstanding).toBeUndefined();
    expect(r.totals.amountToConfirm).toBe(1);
    const fresh = moneyBack([purchase()], { cases: [mkCase()], allocations: [], today: '2025-08-20' });
    expect(fresh.cases[0]).toMatchObject({ status: 'expected', overdue: false, ageDays: 19 });
  });

  it('lists refund-like credits that are not fully allocated, with candidate purchases', () => {
    const r = moneyBack([purchase(), credit(300, 'r2'), credit(100, 'r3', '2025-08-22')], { cases: [], allocations: [alloc({ creditTxnId: 'r3', amount: 5_000 })], today: '2025-09-10' });
    expect(r.needsMatching.map((n) => n.creditTxnId).sort()).toEqual(['r2', 'r3']);
    expect(r.needsMatching[0].candidatePurchaseIds).toEqual(['p1']);
    expect(r.received.find((x) => x.creditTxnId === 'r3')).toMatchObject({ allocated: 5_000, unallocated: 5_000 });
    const ranged = moneyBack([purchase(), credit(300, 'r2')], { cases: [], allocations: [], start: '2025-09-01', today: '2025-09-10' });
    expect(ranged.received).toEqual([]);
  });
});

describe('feesSummary', () => {
  const acct = makeAccount({ id: 'card', type: 'credit_card' });
  const link = (groupId: string, txnId: string, role: ChargeLink['role'], extra: Partial<ChargeLink> = {}): ChargeLink => ({ id: `${groupId}${txnId}`, groupId, txnId, chargeType: 'fuel_surcharge', role, source: 'auto', reason: 'x', ...extra });
  const txns = [
    t('2025-09-05', 1500, { id: 'fuel1', merchant: 'Fuel Stop' }),
    t('2025-09-05', 15, { id: 'sc1', kind: 'fee' }),
    t('2025-09-05', 2.7, { id: 'gst1', kind: 'fee' }),
    t('2025-09-07', 15, { id: 'rv1', direction: 'credit', kind: 'refund' }),
    t('2025-10-03', 1200, { id: 'fuel2', merchant: 'Fuel Stop' }),
    t('2025-10-03', 12, { id: 'sc2', kind: 'fee' }),
    t('2025-10-20', 500, { id: 'late1', kind: 'fee' }),
    t('2025-09-20', 500, { id: 'late0', kind: 'fee' }),
  ];
  const links = [
    link('g1', 'sc1', 'charge', { relatedPurchaseTxnId: 'fuel1' }), link('g1', 'gst1', 'tax'), link('g1', 'rv1', 'reversal'),
    link('g2', 'sc2', 'charge', { relatedPurchaseTxnId: 'fuel2' }),
    link('g3', 'late0', 'charge', { chargeType: 'late_payment_fee' }), link('g4', 'late1', 'charge', { chargeType: 'late_payment_fee' }),
  ];

  it('builds events with charge, tax, reversal and net, plus monthly totals and recurring charges', () => {
    const f = feesSummary(txns, { links, policies: [], accounts: [acct] });
    const g1 = f.events.find((e) => e.groupId === 'g1');
    expect(g1).toMatchObject({ charge: 1_500, tax: 270, reversed: 1_500, net: 270, status: 'partly_reversed', relatedPurchaseTxnId: 'fuel1', accountId: 'card', date: '2025-09-05' });
    expect(f.events.find((e) => e.groupId === 'g2')).toMatchObject({ net: 1_200, status: 'not_reversed' });
    expect(f.totals).toEqual({ charged: 1_500 + 1_200 + 50_000 + 50_000, tax: 270, reversed: 1_500, net: 1_500 + 270 - 1_500 + 1_200 + 100_000 });
    expect(f.byMonth.map((m) => m.month)).toEqual(['2025-09', '2025-10']);
    expect(f.byMonth[0].byType.late_payment_fee).toBe(50_000);
    expect(f.recurring.map((r) => [r.chargeType, r.months])).toEqual([['late_payment_fee', 2], ['fuel_surcharge', 2]]);
    expect(feesSummary(txns, { links, policies: [], accounts: [acct], start: '2025-10-01' }).events).toHaveLength(2);
  });

  it('never infers eligibility: unknown without a matching user policy', () => {
    const f = feesSummary(txns, { links, policies: [], accounts: [acct] });
    expect(f.events.every((e) => e.eligibility.state === 'unknown' && /Check your card's terms/.test(e.eligibility.note))).toBe(true);
    const policy: CardPolicy = { id: 'pol', accountId: 'card', chargeType: 'fuel_surcharge', summary: '1% waived on 400-4,000', waiverMinPurchase: 40_000, waiverMaxPurchase: 400_000, taxReversed: null, createdAt: 'x', updatedAt: 'x' };
    const g = feesSummary(txns, { links, policies: [policy], accounts: [acct] });
    expect(g.events.find((e) => e.groupId === 'g2')?.eligibility).toMatchObject({ state: 'likely', policyId: 'pol' });
    expect(g.events.find((e) => e.groupId === 'g2')?.eligibility.note).toMatch(/Might qualify.*Check your card's terms/);
    const tight = feesSummary(txns, { links, policies: [{ ...policy, waiverMaxPurchase: 100_000 }], accounts: [acct] });
    expect(tight.events.find((e) => e.groupId === 'g2')?.eligibility.state).toBe('unlikely');
    const other = feesSummary(txns, { links, policies: [{ ...policy, accountId: 'elsewhere' }], accounts: [acct] });
    expect(other.events.find((e) => e.groupId === 'g2')?.eligibility.state).toBe('unknown');
  });
});

describe('actionTotals', () => {
  const act = (id: string, over: Partial<SavingAction>): SavingAction => ({ id, type: 'category_limit', title: id, baselineMonthly: 1_000_000, targetMonthly: 700_000, startMonth: '2025-09', status: 'active', createdAt: 'x', updatedAt: 'x', ...over });
  const out = (action: SavingAction, achieved: number | null): ActionOutcome => ({ action, monthsEvaluated: achieved === null ? [] : ['2025-09'], actualMonthly: achieved === null ? null : action.baselineMonthly - achieved, achievedMonthlySaving: achieved, state: 'on_track', txnIds: [] });

  it('keeps purchase reduction, goals, refunds and fees apart and counts overlapping scopes once', () => {
    const cat = act('cat', { category: 'food_dining' });
    const rec = act('rec', { type: 'review_recurring', category: 'food_dining', merchantKey: 'pizza', baselineMonthly: 300_000, targetMonthly: 0 });
    const other = act('other', { category: 'shopping', baselineMonthly: 500_000, targetMonthly: 400_000 });
    const goal = act('goal', { type: 'goal_contribution', goalId: 'g', baselineMonthly: 100_000, targetMonthly: 300_000 });
    const totals = actionTotals([out(cat, 200_000), out(rec, 150_000), out(other, -50_000), out(goal, 150_000)], {
      actions: [cat, rec, other, goal],
      moneyBack: { received: [], cases: [], needsMatching: [], totals: { receivedInPeriod: 40_000, expectedOutstanding: 0, openCases: 0, amountToConfirm: 0 } },
      fees: { events: [], byMonth: [], totals: { charged: 0, tax: 0, reversed: 1_500, net: 0 }, recurring: [] },
    });
    expect(totals.purchaseReduction).toEqual({ planned: 300_000 + 100_000, observed: 200_000 - 50_000, overlappingActionIds: [['cat', 'rec']] });
    expect(totals.goalContributions).toEqual({ planned: 200_000, observed: 150_000 });
    expect(totals.refundsReceived).toBe(40_000);
    expect(totals.feesReversed).toBe(1_500);
    expect(totals.definition).toMatch(/negative figure means spending went up/);
  });

  it('keeps observed null until something is measured', () => {
    const a = act('a', { category: 'food_dining' });
    const totals = actionTotals([out(a, null)], { actions: [a] });
    expect(totals.purchaseReduction).toMatchObject({ planned: 300_000, observed: null });
    expect(totals.goalContributions.observed).toBeNull();
    expect(totals.refundsReceived).toBe(0);
  });
});

describe('recommendations', () => {
  const bank = makeAccount({ id: 'bank', name: 'Bank' });
  const statements = [makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-09-30' })];
  const b = (date: string, rupees: number, extra: Record<string, unknown> = {}) =>
    makeTxn({ accountId: 'bank', date, rupees, ...extra } as Parameters<typeof makeTxn>[0]);
  const orders = (month: string, n: number, merchant = 'Quickbite', category = 'food_dining') =>
    Array.from({ length: n }, (_, i) => b(`2025-${month}-${String(i + 1).padStart(2, '0')}`, 450, { merchant, merchantKey: merchant.toLowerCase(), category }));
  const ctx = (over: Record<string, unknown> = {}) => ({
    accounts: [bank], statements, budgets: [], actions: [], preferences: [], feedback: [], cases: [], allocations: [], chargeLinks: [], policies: [], today: '2025-10-05', ...over,
  });
  const txns = [...orders('07', 8), ...orders('08', 8), ...orders('09', 8)];

  it('suggests fewer orders as a scenario with assumptions, a check and structured amounts', () => {
    const [r] = recommendations(txns, ctx());
    expect(r).toMatchObject({ kind: 'reduce_frequency', key: 'reduce_frequency:quickbite', category: 'food_dining', estimatedEffect: 90_000, merchantKey: 'quickbite' });
    expect(r.title).toBe('Try two fewer Quickbite orders next month');
    expect(r.change).toContainEqual({ paise: 90_000 });
    expect(r.change.filter((x) => typeof x === 'string').join('')).toMatch(/before any replacement costs/);
    expect(r.assumptions.length).toBeGreaterThan(0);
    expect(r.check).toMatch(/next complete month/);
    expect(r.evidence.txnIds.length).toBeGreaterThan(0);
    expect(r.factors.effect).toBeGreaterThan(0);
    expect(r.suggestedTarget).toBe(3 * 0 + 360_000 - 90_000);
  });

  it('respects preferences: protected is never cut, essential asks first, fixed only reviews recurring', () => {
    const pref = (category: string, preference: 'protected' | 'essential' | 'fixed' | 'adjustable') => ({ category, preference, updatedAt: 'x' });
    expect(recommendations(txns, ctx({ preferences: [pref('food_dining', 'protected')] }))).toEqual([]);
    expect(recommendations(txns, ctx({ preferences: [pref('food_dining', 'essential')] }))[0]).toMatchObject({ kind: 'ask_context', key: 'ask_context:food_dining' });
    expect(recommendations(txns, ctx({ preferences: [pref('food_dining', 'fixed')] }))).toEqual([]); // no recurring payment found
    const health = [...orders('07', 2, 'Clinic', 'healthcare'), ...orders('08', 2, 'Clinic', 'healthcare'), ...orders('09', 2, 'Clinic', 'healthcare')].map((x) => ({ ...x, amount: 300_000 }));
    expect(recommendations(health, ctx())[0].kind).toBe('ask_context');
    const rent = ['07', '08', '09'].map((m) => b(`2025-${m}-05`, 15000, { merchant: 'Landlord', merchantKey: 'landlord', category: 'rent_housing' }));
    const r = recommendations(rent, ctx({ today: '2025-10-05' }));
    expect(r[0]).toMatchObject({ kind: 'review_recurring', merchantKey: 'landlord' });
  });

  it('skips dismissed or irrelevant keys, falls back to a limit, and honours the limit', () => {
    const fb = (action: InsightFeedback['action']): InsightFeedback => ({ id: 'f', key: 'reduce_frequency:quickbite', insightId: 'x', action, at: 'x' });
    for (const a of ['dismissed', 'irrelevant'] as const) {
      expect(recommendations(txns, ctx({ feedback: [fb(a)] }))[0]?.kind).toBe('set_limit');
    }
    const rare = [...orders('07', 2), ...orders('08', 2), ...orders('09', 2)].map((x) => ({ ...x, amount: 500_000 }));
    expect(recommendations(rare, ctx())[0]).toMatchObject({ kind: 'set_limit', key: 'set_limit:food_dining' });
    expect(recommendations(txns, ctx({ limit: 1 }))).toHaveLength(1);
    expect(recommendations([], ctx())).toEqual([]);
  });

  it('suggests chasing an overdue refund and avoiding recurring late fees', () => {
    const card = makeAccount({ id: 'card', type: 'credit_card' });
    const p = b('2025-08-01', 2000, { id: 'p1', merchant: 'Gadget Store', merchantKey: 'gadgetstore', category: 'shopping' });
    const chase = recommendations([p], ctx({ cases: [mkCase()], today: '2025-09-20' }));
    expect(chase[0]).toMatchObject({ kind: 'chase_refund', key: 'chase_refund:gadgetstore', estimatedEffect: 200_000 });
    expect(chase[0].factors.urgency).toBe(1);

    const lates = [b('2025-08-20', 500, { id: 'l1', kind: 'fee', category: 'fees_charges', accountId: 'card' }), b('2025-09-20', 500, { id: 'l2', kind: 'fee', category: 'fees_charges', accountId: 'card' })];
    const chargeLinks: ChargeLink[] = lates.map((l, i) => ({ id: `cl${i}`, groupId: `g${i}`, txnId: l.id, chargeType: 'late_payment_fee', role: 'charge', source: 'auto', reason: 'x' }));
    const r = recommendations(lates, ctx({ accounts: [card], chargeLinks, today: '2025-09-25' }));
    expect(r[0]).toMatchObject({ kind: 'avoid_fee', key: 'avoid_fee:late_payment_fee', estimatedEffect: 50_000 });
    expect(r[0].title).toBe('Avoid repeat late payment fees');
  });
});

describe('detectRecurring on busy merchants', () => {
  it('still finds a regular tail after a long irregular history', async () => {
    const { detectRecurring } = await import('./index');
    const noisy = Array.from({ length: 200 }, (_, i) => makeTxn({ merchant: 'Busy', merchantKey: 'busy', date: `2024-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + ((i * 7) % 28)).padStart(2, '0')}`, rupees: 100 + (i % 9) * 40 }));
    const tail = ['2025-05-05', '2025-06-05', '2025-07-05', '2025-08-05'].map((date) => makeTxn({ merchant: 'Busy', merchantKey: 'busy', date, rupees: 999 }));
    const [s] = detectRecurring([...noisy, ...tail], [], '2025-08-10');
    expect(s).toMatchObject({ merchantKey: 'busy', cadence: 'monthly', typicalAmount: 99_900, occurrences: 4 });
  });
});
