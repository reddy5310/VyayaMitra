import { beforeEach, describe, expect, it } from 'vitest';
import type { Budget, GoalContribution, RecurringDecision, SavingAction, SavingsGoal } from '@/domain/types';
import { budgetStatuses, categoryBaselines, detectRecurring, evaluateSavingActions, goalProgress } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

describe('detectRecurring', () => {
  const sub = (merchant: string, dates: string[], rupees: number | number[], extra: Partial<Parameters<typeof makeTxn>[0]> = {}) =>
    dates.map((date, i) => makeTxn({ merchant, date, rupees: Array.isArray(rupees) ? rupees[i] : rupees, category: 'subscriptions', ...extra }));

  it('finds a 3-month ₹199 series as monthly', () => {
    const txns = sub('Streamly', ['2025-07-05', '2025-08-05', '2025-09-05'], 199);
    const [s] = detectRecurring(txns, [], '2025-09-20');
    expect(s).toMatchObject({
      merchantKey: 'streamly', cadence: 'monthly', typicalAmount: 19_900, monthlyCost: 19_900, occurrences: 3,
      lastDate: '2025-09-05', status: 'suggested', overdue: false,
    });
    expect(s.intervalDays).toBe(31);
    expect(s.nextExpected).toBe('2025-10-06');
    expect(s.confidence).toBeGreaterThan(0.7);
    expect(s.txnIds).toHaveLength(3);
  });

  it('does NOT call two equal payments 21 months apart recurring', () => {
    const txns = sub('Odd Shop', ['2023-12-05', '2025-09-05'], 199);
    expect(detectRecurring(txns, [], '2025-09-20')).toEqual([]);
  });

  it('allows two exact monthly payments at low confidence, but not two varying ones', () => {
    const exact = detectRecurring(sub('Streamly', ['2025-08-05', '2025-09-05'], 199), [], '2025-09-20');
    expect(exact).toHaveLength(1);
    expect(exact[0].confidence).toBeLessThanOrEqual(0.45);
    expect(detectRecurring(sub('Streamly', ['2025-08-05', '2025-09-05'], [199, 250]), [], '2025-09-20')).toEqual([]);
    expect(detectRecurring(sub('Weekly Thing', ['2025-09-01', '2025-09-08'], 100), [], '2025-09-20')).toEqual([]);
  });

  it('detects weekly, quarterly and yearly cadences with monthly-equivalent cost', () => {
    const weekly = detectRecurring(sub('Milk', ['2025-09-01', '2025-09-08', '2025-09-15', '2025-09-22'], 120), [], '2025-09-23');
    expect(weekly[0]).toMatchObject({ cadence: 'weekly', monthlyCost: Math.round((12_000 * 52) / 12) });
    const quarterly = detectRecurring(sub('Insure', ['2025-01-10', '2025-04-10', '2025-07-10'], 3000), [], '2025-07-20');
    expect(quarterly[0]).toMatchObject({ cadence: 'quarterly', monthlyCost: 100_000 });
    const yearly = detectRecurring(sub('Domain', ['2023-03-01', '2024-03-01', '2025-03-01'], 1200), [], '2025-03-10');
    expect(yearly[0]).toMatchObject({ cadence: 'yearly', monthlyCost: 10_000 });
  });

  it('rejects irregular intervals and unstable amounts', () => {
    expect(detectRecurring(sub('Random', ['2025-06-01', '2025-06-20', '2025-08-30', '2025-09-02'], 100), [], '2025-09-10')).toEqual([]);
    expect(detectRecurring(sub('Wobbly', ['2025-07-05', '2025-08-05', '2025-09-05'], [100, 900, 300]), [], '2025-09-10')).toEqual([]);
  });

  it('tolerates one missed cycle but not more', () => {
    const one = sub('Gym', ['2025-04-05', '2025-05-05', '2025-07-05', '2025-08-05'], 500);
    expect(detectRecurring(one, [], '2025-08-10')[0]).toMatchObject({ cadence: 'monthly', occurrences: 4 });
  });

  it('uses amount stability within a tolerance (variable bills)', () => {
    const bill = sub('Power Board', ['2025-07-10', '2025-08-10', '2025-09-10'], [1000, 1080, 950]);
    expect(detectRecurring(bill, [], '2025-09-12')).toHaveLength(1);
  });

  it('marks overdue only more than 5 days after the expected date', () => {
    const txns = sub('Streamly', ['2025-07-05', '2025-08-05', '2025-09-05'], 199);
    expect(detectRecurring(txns, [], '2025-10-11')[0].overdue).toBe(false);
    expect(detectRecurring(txns, [], '2025-10-12')[0].overdue).toBe(true);
  });

  it('only considers outgoing payments of the recurring kinds, and falls back to the VPA', () => {
    const credits = sub('Employer', ['2025-07-01', '2025-08-01', '2025-09-01'], 5000, { direction: 'credit', kind: 'income' });
    const selfT = sub('Own', ['2025-07-01', '2025-08-01', '2025-09-01'], 500, { kind: 'self_transfer' });
    const byVpa = ['2025-07-03', '2025-08-03', '2025-09-03'].map((date) =>
      makeTxn({ date, rupees: 300, merchantKey: '', counterparty: { type: 'merchant', vpa: 'club@upi' } }),
    );
    const out = detectRecurring([...credits, ...selfT, ...byVpa], [], '2025-09-10');
    expect(out.map((s) => s.merchantKey)).toEqual(['club@upi']);
  });

  it('applies decisions: confirmed stays without a recent month, dismissed is marked', () => {
    const txns = sub('Streamly', ['2025-05-05', '2025-06-05', '2025-07-05'], 199);
    const confirmed: RecurringDecision[] = [{ merchantKey: 'streamly', status: 'confirmed', updatedAt: '2025-09-01T00:00:00Z' }];
    const dismissed: RecurringDecision[] = [{ merchantKey: 'streamly', status: 'dismissed', updatedAt: '2025-09-01T00:00:00Z' }];
    expect(detectRecurring(txns, confirmed, '2025-12-01')[0]).toMatchObject({ status: 'confirmed', overdue: true });
    expect(detectRecurring(txns, dismissed, '2025-12-01')[0].status).toBe('dismissed');

    const two = sub('Rare', ['2025-01-01', '2025-09-01'], 700);
    expect(detectRecurring(two, [], '2025-09-02')).toEqual([]);
    const fromDecision = detectRecurring(two, [{ merchantKey: 'rare', status: 'confirmed', cadence: 'quarterly', expectedAmount: 70_000, updatedAt: 'x' }], '2025-09-02');
    expect(fromDecision[0]).toMatchObject({ status: 'confirmed', cadence: 'quarterly', typicalAmount: 70_000 });
  });
});

describe('budgets', () => {
  const bank = makeAccount({ id: 'bank', name: 'Bank' });
  const full = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-10-31' });
  const budget: Budget = { id: 'b1', category: 'food_dining', monthlyLimit: 1_000_000, createdAt: 'x', updatedAt: 'x' };
  const ctx = (month: string, today: string) => ({ month, today, accounts: [bank], statements: [full] });
  const food = (date: string, rupees: number, extra = {}) => makeTxn({ accountId: 'bank', date, rupees, category: 'food_dining', ...extra });

  it('uses the calendar month with inclusive boundaries', () => {
    const txns = [food('2025-09-30', 7000), food('2025-10-01', 1000), food('2025-10-31', 2000), food('2025-11-01', 5000)];
    const [s] = budgetStatuses([budget], txns, ctx('2025-10', '2025-12-01'));
    expect(s.spent).toBe(300_000);
    expect(s.remaining).toBe(700_000);
    expect(s.usage).toBeCloseTo(0.3);
    expect(s.state).toBe('ok');
    expect(s.expectedByToday).toBeUndefined();
    expect(s.coverageComplete).toBe(true);
    expect(s.txnIds).toHaveLength(2);
  });

  it('nets a linked refund into the original category', () => {
    const buy = food('2025-10-03', 6000, { id: 'buy' });
    const refund = makeTxn({
      accountId: 'bank', date: '2025-10-08', rupees: 2500, direction: 'credit', kind: 'refund', category: 'refunds',
      linkedTxnId: 'buy', linkRole: 'refund_of',
    });
    const [s] = budgetStatuses([budget], [buy, refund], ctx('2025-10', '2025-10-20'));
    expect(s.spent).toBe(350_000);
  });

  it('goes over only when spent exceeds the limit', () => {
    const at = budgetStatuses([budget], [food('2025-10-02', 10000)], ctx('2025-10', '2025-11-02'))[0];
    expect(at.state).toBe('watch');
    const over = budgetStatuses([budget], [food('2025-10-02', 10000.01)], ctx('2025-10', '2025-11-02'))[0];
    expect(over.state).toBe('over');
  });

  it('watches at 80% usage or when well ahead of an even pace (current month only)', () => {
    const eighty = budgetStatuses([budget], [food('2025-10-02', 8000)], ctx('2025-10', '2025-10-31'))[0];
    expect(eighty.state).toBe('watch');
    // Day 10 of 31: even pace = 10,000 * 10 / 31 = 3,225.81; 15% above = 3,709.68
    const ahead = budgetStatuses([budget], [food('2025-10-02', 3800)], ctx('2025-10', '2025-10-10'))[0];
    expect(ahead.expectedByToday).toBe(322_581);
    expect(ahead.state).toBe('watch');
    const onPace = budgetStatuses([budget], [food('2025-10-02', 3600)], ctx('2025-10', '2025-10-10'))[0];
    expect(onPace.state).toBe('ok');
    // the same spend in a past month has no pace test
    expect(budgetStatuses([budget], [food('2025-09-02', 3800)], ctx('2025-09', '2025-10-10'))[0].state).toBe('ok');
  });

  it('flags incomplete month coverage', () => {
    const half = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-14' });
    const [s] = budgetStatuses([budget], [], { month: '2025-10', today: '2025-10-14', accounts: [bank], statements: [half] });
    expect(s.coverageComplete).toBe(false);
  });

  it('averages baselines over the last N complete months only', () => {
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-06-01', periodEnd: '2025-09-30' });
    const partial = makeStatement({ accountId: 'bank', periodStart: '2025-10-01', periodEnd: '2025-10-10' });
    const txns = [
      food('2025-06-10', 9999), // oldest month: outside the last 3
      food('2025-07-10', 3000),
      food('2025-08-10', 6000),
      food('2025-09-10', 9000),
      food('2025-10-05', 50000), // incomplete month: ignored
      makeTxn({ accountId: 'bank', date: '2025-08-12', rupees: 600, category: 'transport' }),
    ];
    const base = categoryBaselines(txns, { accounts: [bank], statements: [st, partial], today: '2025-10-10' });
    expect(base.find((b) => b.category === 'food_dining')).toEqual({ category: 'food_dining', monthlyAverage: 600_000, monthsUsed: 3 });
    expect(base.find((b) => b.category === 'transport')).toEqual({ category: 'transport', monthlyAverage: 20_000, monthsUsed: 3 });
    expect(base[0].category).toBe('food_dining');
    expect(categoryBaselines(txns, { accounts: [bank], statements: [st, partial], today: '2025-10-10', months: 1 })[0].monthlyAverage).toBe(900_000);
    expect(categoryBaselines(txns, { accounts: [bank], statements: [], today: '2025-10-10' })).toEqual([]);
  });
});

describe('goalProgress', () => {
  const goal: SavingsGoal = { id: 'g1', name: 'Laptop', target: 6_000_000, targetDate: '2026-03-15', icon: 'x', color: 'x', archived: false, createdAt: 'x' };
  const c = (date: string, rupees: number, type: GoalContribution['type'] = 'deposit', linkedTxnId?: string): GoalContribution => ({
    id: `c${date}${type}${rupees}`, goalId: 'g1', date, amount: rupees * 100, type, createdAt: `${date}T00:00:00Z`, ...(linkedTxnId ? { linkedTxnId } : {}),
  });

  it('is never negative and caps the verified part at what is saved', () => {
    const p = goalProgress(goal, [c('2025-08-01', 1000), c('2025-09-01', 5000, 'withdrawal', 'tx9')], '2025-09-15');
    expect(p.saved).toBe(0);
    expect(p.verified).toBe(0);
    expect(p.progress).toBe(0);
    expect(p.remaining).toBe(6_000_000);
  });

  it('separates the transaction-backed (verified) portion', () => {
    const p = goalProgress(goal, [c('2025-07-10', 10000, 'deposit', 'tx1'), c('2025-08-10', 5000), c('2025-09-10', 2000, 'withdrawal', 'tx2')], '2025-09-15');
    expect(p.saved).toBe(1_300_000);
    expect(p.verified).toBe(800_000);
    expect(p.remaining).toBe(4_700_000);
    expect(p.progress).toBeCloseTo(13 / 60);
    expect(p.contributions.map((x) => x.date)).toEqual(['2025-07-10', '2025-08-10', '2025-09-10']);
  });

  it('works out monthly need, recent pace, projection and on-track', () => {
    const deposits = [c('2025-07-10', 3000), c('2025-08-10', 3000), c('2025-09-10', 3000)];
    const p = goalProgress(goal, deposits, '2025-09-15');
    expect(p.saved).toBe(900_000);
    expect(p.monthlyNeeded).toBe(Math.ceil(5_100_000 / 6));
    expect(p.recentMonthlyPace).toBe(300_000);
    expect(p.projectedCompletion).toBe('2027-02-15');
    expect(p.onTrack).toBe(false);
    const fast = goalProgress(goal, [c('2025-09-10', 30000), c('2025-08-10', 30000)], '2025-09-15');
    expect(fast.onTrack).toBe(true);
    expect(fast.recentMonthlyPace).toBe(2_000_000);
  });

  it('handles no date, reached goals and other goals contributions', () => {
    const open = { ...goal, targetDate: undefined };
    expect(goalProgress(open, [], '2025-09-15')).toMatchObject({ monthlyNeeded: null, onTrack: null, saved: 0 });
    const done = goalProgress(goal, [c('2025-09-01', 70000)], '2025-09-15');
    expect(done).toMatchObject({ remaining: 0, progress: 1, monthlyNeeded: null, onTrack: true });
    const other = { ...c('2025-09-01', 100), goalId: 'other' };
    expect(goalProgress(goal, [other], '2025-09-15').saved).toBe(0);
    const late = goalProgress({ ...goal, targetDate: '2025-09-01' }, [c('2025-08-01', 100)], '2025-09-15');
    expect(late.onTrack).toBe(false);
  });
});

describe('evaluateSavingActions', () => {
  const bank = makeAccount({ id: 'bank', name: 'Bank' });
  const action: SavingAction = {
    id: 'a1', type: 'category_limit', title: 'Cap dining', category: 'food_dining', baselineMonthly: 800_000, targetMonthly: 600_000,
    startMonth: '2025-09', status: 'active', createdAt: 'x', updatedAt: 'x',
  };
  const goals: SavingsGoal[] = [];
  const dine = (date: string, rupees: number) => makeTxn({ accountId: 'bank', date, rupees, category: 'food_dining' });

  it('waits for a fully covered month', () => {
    const partial = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-20' });
    const [o] = evaluateSavingActions([action], [dine('2025-09-05', 1000)], { accounts: [bank], statements: [partial], goals, contributions: [], today: '2025-09-25' });
    expect(o).toMatchObject({ state: 'waiting_for_data', actualMonthly: null, achievedMonthlySaving: null, monthsEvaluated: [] });
  });

  it('measures only fully covered months since the start month', () => {
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-08-01', periodEnd: '2025-10-20' });
    const txns = [dine('2025-08-05', 99999), dine('2025-09-05', 5000), dine('2025-09-25', 2000), dine('2025-10-05', 99999)];
    const [o] = evaluateSavingActions([action], txns, { accounts: [bank], statements: [st], goals, contributions: [], today: '2025-10-15' });
    expect(o.monthsEvaluated).toEqual(['2025-09']);
    expect(o.actualMonthly).toBe(700_000);
    expect(o.achievedMonthlySaving).toBe(100_000);
    expect(o.state).toBe('on_track');
    expect(o.txnIds).toHaveLength(2);
  });

  it('reports achieved when under target and off_track when not improving', () => {
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
    const ctx = { accounts: [bank], statements: [st], goals, contributions: [], today: '2025-10-05' };
    expect(evaluateSavingActions([action], [dine('2025-09-05', 5000)], ctx)[0].state).toBe('achieved');
    const worse = evaluateSavingActions([action], [dine('2025-09-05', 9000)], ctx)[0];
    expect(worse.state).toBe('off_track');
    expect(worse.achievedMonthlySaving).toBe(-100_000);
  });

  it('evaluates a recurring review by merchant, and goal contributions from contributions', () => {
    const st = makeStatement({ accountId: 'bank', periodStart: '2025-09-01', periodEnd: '2025-09-30' });
    const rec: SavingAction = { ...action, id: 'a2', type: 'review_recurring', category: undefined, merchantKey: 'streamly', baselineMonthly: 19_900, targetMonthly: 0 };
    const txns = [makeTxn({ accountId: 'bank', date: '2025-09-05', rupees: 199, merchant: 'Streamly' }), dine('2025-09-06', 400)];
    const [o] = evaluateSavingActions([rec], txns, { accounts: [bank], statements: [st], goals, contributions: [], today: '2025-10-05' });
    expect(o.actualMonthly).toBe(19_900);
    expect(o.state).toBe('off_track');
    expect(evaluateSavingActions([{ ...rec, merchantKey: 'cancelled' }], txns, { accounts: [bank], statements: [st], goals, contributions: [], today: '2025-10-05' })[0].state).toBe('achieved');

    const goalAction: SavingAction = { ...action, id: 'a3', type: 'goal_contribution', category: undefined, goalId: 'g1', baselineMonthly: 100_000, targetMonthly: 300_000 };
    const contributions: GoalContribution[] = [
      { id: 'x1', goalId: 'g1', date: '2025-09-10', amount: 200_000, type: 'deposit', createdAt: 'x' },
    ];
    const [g] = evaluateSavingActions([goalAction], [], { accounts: [bank], statements: [st], goals, contributions, today: '2025-10-05' });
    expect(g).toMatchObject({ actualMonthly: 200_000, achievedMonthlySaving: 100_000, state: 'on_track' });
    const [early] = evaluateSavingActions([goalAction], [], { accounts: [bank], statements: [st], goals, contributions, today: '2025-09-20' });
    expect(early.state).toBe('waiting_for_data');
  });
});
