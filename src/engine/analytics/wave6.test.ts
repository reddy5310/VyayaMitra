import { beforeEach, describe, expect, it } from 'vitest';
import type { Budget, SavingsGoal } from '@/domain/types';
import { applyQuery, explainChange, planScenario } from './index';
import { makeAccount, makeStatement, makeTxn, resetIds } from './testData';

beforeEach(() => resetIds());

const t = (date: string, rupees: number, extra: Record<string, unknown> = {}) =>
  makeTxn({ accountId: 'bank', date, rupees, ...extra } as Parameters<typeof makeTxn>[0]);

describe('LedgerQuery additions', () => {
  const txns = [
    t('2025-09-01', 100, { id: 'a', merchantKey: 'swiggy', statementId: 's1' }),
    t('2025-09-02', 1250, { id: 'b', merchantKey: 'zomato', statementId: 's2' }),
    t('2025-09-03', 500, { id: 'c', kind: 'income', direction: 'credit', statementId: 's1' }),
    t('2025-09-04', 700, { id: 'd', kind: 'self_transfer', statementId: 's1' }),
    t('2025-09-05', 20, { id: 'e', kind: 'refund', direction: 'credit' }),
    t('2025-09-06', 900, { id: 'f', kind: 'investment' }),
    t('2025-09-07', 300, { id: 'g', kind: 'p2p_out' }),
    t('2025-09-08', 40, { id: 'h', kind: 'unknown' }),
    t('2025-09-09', 40, { id: 'i', kind: 'unknown', direction: 'credit' }),
    t('2025-09-10', 60, { id: 'j', kind: 'fee' }),
  ];
  const ids = (q: Parameters<typeof applyQuery>[1]) => applyQuery(txns, q).map((x) => x.id);

  it('filters by amount bounds (inclusive), merchants and statements', () => {
    expect(ids({ minAmount: 100_000, maxAmount: 125_000 })).toEqual(['b']);
    expect(ids({ minAmount: 10_000, maxAmount: 10_000 })).toEqual(['a']);
    expect(ids({ minAmount: 125_001 })).toEqual([]);
    expect(ids({ merchantKeys: ['swiggy', 'zomato'] })).toEqual(['a', 'b']);
    expect(ids({ statementIds: ['s2'] })).toEqual(['b']);
    expect(ids({ statementIds: ['s1'], maxAmount: 10_000 })).toEqual(['a']);
  });

  it('filters by kind group', () => {
    expect(ids({ kindGroup: 'spending' })).toEqual(['a', 'b', 'h', 'j']);
    expect(ids({ kindGroup: 'income' })).toEqual(['c']);
    expect(ids({ kindGroup: 'transfer' })).toEqual(['d']);
    expect(ids({ kindGroup: 'refund' })).toEqual(['e']);
    expect(ids({ kindGroup: 'saving' })).toEqual(['f']);
    expect(ids({ kindGroup: 'people' })).toEqual(['g']);
    expect(ids({ kindGroup: 'spending', minAmount: 5_000 })).toEqual(['a', 'b', 'j']);
  });
});

describe('explainChange', () => {
  const accounts = [makeAccount({ id: 'bank', name: 'Bank' })];
  const statements = [makeStatement({ accountId: 'bank', periodStart: '2025-08-01', periodEnd: '2025-09-30' })];
  const food = (date: string, rupees: number, merchant: string, extra = {}) => t(date, rupees, { merchant, merchantKey: merchant.toLowerCase(), category: 'food_dining', ...extra });
  const base = { accounts, statements, current: { start: '2025-09-01', end: '2025-09-30' }, today: '2025-10-05' };
  const dates = (month: string, n: number) => Array.from({ length: n }, (_, i) => `2025-${month}-${String(i + 1).padStart(2, '0')}`);

  it('splits a merchant change into more orders vs bigger orders, and finds new and stopped ones', () => {
    const txns = [
      ...dates('08', 4).map((d) => food(d, 350, 'Pizza Place')),
      ...dates('09', 10).map((d) => food(d, 350, 'Pizza Place')),
      ...dates('08', 3).map((d) => food(d, 100, 'Cafe')),
      ...dates('09', 3).map((d) => food(d, 280, 'Cafe')),
      food('2025-08-20', 500, 'Old Haunt'),
      food('2025-09-20', 400, 'Brand New'),
    ];
    const r = explainChange(txns, base);
    expect(r.comparable).toBe(true);
    const by = (m: string) => r.merchants.find((x) => x.merchant === m);
    const pizza = by('Pizza Place');
    expect(pizza).toMatchObject({ driver: 'more_often', delta: 210_000, frequencyEffect: 210_000, sizeEffect: 0 });
    expect(pizza?.sentence).toBe('6 more orders than August (₹2,100)');
    expect(pizza?.current).toEqual({ count: 10, total: 350_000, average: 35_000 });
    const cafe = by('Cafe');
    expect(cafe).toMatchObject({ driver: 'bigger_purchases', delta: 54_000, frequencyEffect: 0, sizeEffect: 54_000 });
    expect(cafe?.sentence).toBe('About the same number of orders, but each was ₹180 larger on average');
    expect(by('Old Haunt')?.driver).toBe('stopped');
    expect(by('Brand New')?.driver).toBe('new');
    expect(by('Brand New')?.sentence).toMatch(/^New this period/);
    for (const m of r.merchants) expect(m.frequencyEffect + m.sizeEffect).toBe(m.delta);
    expect(r.merchants[0].merchant).toBe('Pizza Place');
    expect(r.headline).toContain('higher than in August 2025');
    expect(r.headline).toContain('Pizza Place');
    expect(r.suggestedAction).toMatchObject({ category: 'food_dining', suggestedTarget: 140_000 + 30_000 + 50_000 });
  });

  it('can focus on one category, limit merchants, and handles mixed and fewer-orders drivers', () => {
    const txns = [
      ...dates('08', 6).map((d) => food(d, 100, 'Mixed')),
      ...dates('09', 8).map((d) => food(d, 140, 'Mixed')),
      ...dates('08', 8).map((d) => food(d, 100, 'Fewer')),
      ...dates('09', 4).map((d) => food(d, 100, 'Fewer')),
      t('2025-09-05', 9999, { category: 'shopping', merchant: 'Other', merchantKey: 'other' }),
    ];
    const r = explainChange(txns, { ...base, category: 'food_dining', maxMerchants: 2 });
    expect(r.merchants).toHaveLength(2);
    expect(r.merchants.every((m) => m.category === 'food_dining')).toBe(true);
    expect(r.merchants.find((m) => m.merchant === 'Mixed')?.driver).toBe('mixed');
    const fewer = r.merchants.find((m) => m.merchant === 'Fewer');
    expect(fewer).toMatchObject({ driver: 'less_often', delta: -40_000 });
    expect(fewer?.sentence).toBe('4 fewer orders than August (₹400)');
    expect(r.headline).toMatch(/^Food & dining in September 2025 is ₹/);
  });

  it('says periods cannot be compared when coverage is missing', () => {
    const partial = [makeStatement({ accountId: 'bank', periodStart: '2025-08-01', periodEnd: '2025-09-15' })];
    const r = explainChange([food('2025-08-02', 100, 'A'), food('2025-09-02', 300, 'A')], { ...base, statements: partial });
    expect(r.comparable).toBe(false);
    expect(r.headline).toMatch(/cannot be compared/);
    expect(r.suggestedAction).toBeUndefined();
    expect(r.merchants).toHaveLength(1);
  });
});

describe('planScenario', () => {
  const budget = (category: string, monthlyLimit: number): Budget => ({ id: category, category, monthlyLimit, createdAt: 'x', updatedAt: 'x' });
  const goal = (id: string, extra: Partial<SavingsGoal> = {}): SavingsGoal => ({ id, name: `Goal ${id}`, target: 1_000_000, icon: 'x', color: 'x', archived: false, createdAt: 'x', ...extra });
  const input = {
    budgets: [budget('food_dining', 800_000), budget('shopping', 500_000)],
    baselines: [
      { category: 'food_dining', monthlyAverage: 1_000_000 },
      { category: 'shopping', monthlyAverage: 400_000 },
      { category: 'transport', monthlyAverage: 300_000 },
    ],
    changes: [{ category: 'food_dining', monthlyLimit: 700_000 }, { category: 'transport', monthlyLimit: 250_000 }, { category: 'shopping', monthlyLimit: 450_000 }],
    keep: [] as string[],
    goals: [],
  };

  it('measures reductions against the baseline, never negative', () => {
    const r = planScenario(input);
    const by = (c: string) => r.perCategory.find((x) => x.category === c);
    expect(by('food_dining')).toMatchObject({ baseline: 1_000_000, current: 800_000, scenario: 700_000, reduction: 300_000, kept: false });
    expect(by('shopping')?.reduction).toBe(0); // limit is above the typical spend
    expect(by('transport')).toMatchObject({ reduction: 50_000, scenario: 250_000 });
    expect(by('transport')?.current).toBeUndefined();
    expect(r.plannedReduction).toBe(350_000);
    expect(r.currentPlanTotal).toBe(1_300_000);
    expect(r.scenarioPlanTotal).toBe(1_400_000);
    expect(r.surplusNow).toBeUndefined();
    expect(r.notes[0]).toMatch(/not a prediction/);
  });

  it('keeps categories unchanged, counts a category once, and removes limits', () => {
    const r = planScenario({
      ...input,
      keep: ['food_dining'],
      changes: [{ category: 'transport', monthlyLimit: 250_000 }, { category: 'transport', monthlyLimit: 200_000 }, { category: 'shopping', monthlyLimit: null }],
    });
    expect(r.perCategory.filter((c) => c.category === 'transport')).toHaveLength(1);
    expect(r.perCategory.find((c) => c.category === 'food_dining')).toMatchObject({ reduction: 0, kept: true });
    expect(r.perCategory.find((c) => c.category === 'transport')?.reduction).toBe(100_000);
    expect(r.perCategory.find((c) => c.category === 'shopping')?.scenario).toBeUndefined();
    expect(r.perCategory.find((c) => c.category === 'shopping')?.reduction).toBe(0);
    expect(r.plannedReduction).toBe(100_000);
    expect(r.notes.join(' ')).toMatch(/changed more than once/);
    expect(r.notes.join(' ')).toMatch(/choose to keep|chose to keep/);
  });

  it('adds surplus only with income, and allocates the reduction to the first unfinished goal', () => {
    const goals = [
      { goal: goal('done', { targetDate: '2026-01-01' }), monthlyNeeded: null, recentMonthlyPace: 0 },
      { goal: goal('old', { archived: true }), monthlyNeeded: 100, recentMonthlyPace: 0 },
      { goal: goal('trip', { targetDate: '2026-06-01' }), monthlyNeeded: 200_000, recentMonthlyPace: 100_000, remaining: 1_200_000 },
    ];
    const r = planScenario({ ...input, goals, incomeMonthly: 3_000_000 });
    expect(r.surplusNow).toBe(3_000_000 - 1_700_000);
    expect(r.surplusScenario).toBe(1_300_000 + 350_000);
    expect(r.goalImpact).toEqual([{ goalId: 'trip', name: 'Goal trip', extraPerMonth: 350_000, monthsSooner: 12 - 3 }]);
    expect(r.notes.join(' ')).toMatch(/first unfinished goal/);
    expect(planScenario({ ...input, goals: [{ goal: goal('x'), monthlyNeeded: null, recentMonthlyPace: 0 }] }).goalImpact[0].monthsSooner).toBeNull();
  });
});
