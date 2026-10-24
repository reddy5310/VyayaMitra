import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Transaction } from '@/domain/types';
import type { CardDue, DataStatus, Insight, LedgerSummary } from '@/engine/analytics';
import { addMonths, formatDate, monthKey, todayIso } from '@/lib/dates';
import { PrivacyContext, ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useBudgets: vi.fn(),
  useRecurringDecisions: vi.fn(),
  useSavingActions: vi.fn(),
}));
vi.mock('@/db/hooks', () => hooks);

const actions = vi.hoisted(() => ({ createSavingAction: vi.fn(), upsertBudget: vi.fn() }));
vi.mock('@/db/actions', () => actions);

const review = vi.hoisted(() => ({
  useInsightFeedback: vi.fn(),
  useMonthReviews: vi.fn(),
  recordInsightFeedback: vi.fn(),
  clearInsightFeedback: vi.fn(),
}));
vi.mock('@/db/review', () => review);

const moneyback = vi.hoisted(() => ({
  useRefundCases: vi.fn(() => []),
  useRefundAllocations: vi.fn(() => []),
  useChargeLinks: vi.fn(() => []),
  useCardPolicies: vi.fn(() => []),
  useAdviserPreferences: vi.fn(() => []),
  setAdviserPreference: vi.fn(),
}));
vi.mock('@/db/moneyback', () => moneyback);

const sample = vi.hoisted(() => ({ sampleDataAvailable: true, startSample: vi.fn() }));
vi.mock('./sample', () => sample);

vi.mock('@/app/period', () => ({
  usePeriod: () => ({ period: { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' } }),
}));

const analytics = vi.hoisted(() => ({
  applyQuery: vi.fn(),
  summarize: vi.fn(),
  generateInsights: vi.fn(),
  categoryBaselines: vi.fn(),
  upcomingCardDues: vi.fn(),
  dataStatus: vi.fn(),
  spendingPlan: vi.fn(),
  cumulativeSpending: vi.fn(),
  compareSpending: vi.fn(),
  detectRecurring: vi.fn(),
  recommendations: vi.fn(),
  moneyBack: vi.fn(),
  feesSummary: vi.fn(),
}));
vi.mock('@/engine/analytics', () => analytics);

import OverviewPage from './OverviewPage';

function summaryFixture(over: Partial<LedgerSummary> = {}): LedgerSummary {
  return {
    start: '2025-09-01',
    end: '2025-09-30',
    income: 8_000_000,
    spending: 5_000_000,
    refunds: 120_000,
    invested: 1_000_000,
    netSavings: 3_000_000,
    savingsRate: 37.5,
    peopleIn: 200_000,
    peopleOut: 450_000,
    neutral: { selfTransfers: 700_000, cardPayments: 900_000, reversals: 0, loanReceived: 0 },
    cashFlow: { inflow: 8_000_000, outflow: 6_000_000, net: 2_000_000 },
    byCategory: [
      { category: 'food_dining', group: 'lifestyle', amount: 1_200_000, count: 20, share: 0.24 },
      { category: 'groceries', group: 'essentials', amount: 800_000, count: 10, share: 0.16 },
    ],
    byGroup: [],
    counts: { total: 40, needsReview: 3, debits: 30, credits: 10 },
    coverage: { start: '2025-09-01', end: '2025-09-30', accounts: [], complete: true, incomeCoverage: 'full', notes: [] },
    ...over,
  };
}

const statusFixture = (over: Partial<DataStatus> = {}): DataStatus => ({
  dataThrough: '2025-09-30',
  accountCount: 2,
  statementCount: 3,
  needsReview: 4,
  extractionIssues: 0,
  evidence: 'bank_and_card',
  completeMonths: ['2025-07', '2025-08', '2025-09'],
  latestCompleteMonth: '2025-09',
  ...over,
});

const txn = (id: string, over: Partial<Transaction> = {}) =>
  ({ id, needsReview: false, merchantKey: 'm1', merchant: 'Demo Shop', date: '2025-09-20', amount: 25_000, direction: 'debit', ...over }) as Transaction;

const series = {
  points: [
    { date: '2025-09-01', actual: 100_000, plan: 100_000, covered: true },
    { date: '2025-09-02', actual: null, plan: 200_000, covered: false },
    { date: '2025-09-03', actual: 400_000, plan: 300_000, covered: true },
  ],
  total: 400_000,
  planTotal: 3_000_000,
  dataThrough: '2025-09-03',
};

function setup(
  o: {
    transactions?: Transaction[];
    summary?: LedgerSummary;
    status?: DataStatus;
    insights?: Insight[];
    ready?: boolean;
    dues?: CardDue[];
    accounts?: Account[];
    plan?: { monthlyLimit: number; categories: string[] } | null;
    comparison?: unknown;
    reviews?: unknown[];
    recs?: unknown[];
    money?: unknown;
    fees?: unknown;
    hide?: boolean;
  } = {},
) {
  hooks.useLedger.mockReturnValue({
    ready: o.ready ?? true,
    accounts: o.accounts ?? [],
    statements: [],
    transactions: o.transactions ?? [txn('t1')],
    customCategories: [],
  });
  review.useInsightFeedback.mockReturnValue([{ id: 'fb1', key: 'category_change:food', insightId: 'ins-food', action: 'expected', at: '' }]);
  review.useMonthReviews.mockReturnValue(o.reviews ?? [{ month: '2025-09', status: 'completed', notes: [], nextActionIds: [], updatedAt: '' }]);
  hooks.useBudgets.mockReturnValue([]);
  hooks.useRecurringDecisions.mockReturnValue([]);
  hooks.useSavingActions.mockReturnValue([]);
  analytics.applyQuery.mockImplementation((t: Transaction[]) => t);
  analytics.summarize.mockReturnValue(o.summary ?? summaryFixture());
  analytics.dataStatus.mockReturnValue(o.status ?? statusFixture());
  analytics.spendingPlan.mockReturnValue(o.plan === undefined ? { monthlyLimit: 3_000_000, categories: ['food_dining', 'groceries'] } : o.plan);
  analytics.cumulativeSpending.mockReturnValue(series);
  analytics.compareSpending.mockReturnValue(o.comparison ?? { comparable: false, current: { total: 0, label: '' }, previous: { total: 0, label: '' } });
  analytics.generateInsights.mockReturnValue(o.insights ?? []);
  analytics.upcomingCardDues.mockReturnValue(o.dues ?? []);
  analytics.detectRecurring.mockReturnValue([]);
  analytics.recommendations.mockReturnValue(o.recs ?? []);
  analytics.moneyBack.mockReturnValue(o.money ?? { received: [], cases: [], needsMatching: [], totals: { receivedInPeriod: 0, expectedOutstanding: 0, openCases: 0, amountToConfirm: 0 } });
  analytics.feesSummary.mockReturnValue(o.fees ?? { events: [], byMonth: [], totals: { charged: 0, tax: 0, reversed: 0, net: 0 }, recurring: [] });
  analytics.categoryBaselines.mockReturnValue([{ category: 'food_dining', monthlyAverage: 1_500_000, monthsUsed: 3 }]);
  return render(
    <ToastProvider>
      <PrivacyContext.Provider value={{ hideAmounts: o.hide ?? false }}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </PrivacyContext.Provider>
    </ToastProvider>,
  );
}

const foodInsight: Insight = {
  id: 'ins-food',
  key: 'category_change:food',
  type: 'category_change',
  severity: 'warning',
  title: 'Food & dining is up',
  body: 'You spent more on food than usual.',
  evidence: { txnIds: ['a', 'b'], figures: [{ label: 'This period', value: '₹12,000' }] },
  action: { type: 'category_limit', label: 'Set a limit', category: 'food_dining', suggestedTarget: 1_200_000 },
  estimatedMonthlySaving: 300_000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Overview first screen', () => {
  it('shows data status, recorded spending and what remains in the plan, without a "safe to spend" claim', () => {
    setup();
    const strip = screen.getByLabelText('Data status');
    expect(strip).toHaveTextContent(`Data through ${formatDate('2025-09-30', { short: true })} · 2 accounts`);
    expect(within(strip).getByRole('link', { name: /4 to review/ })).toHaveAttribute('href', '/activity?review=1');
    expect(screen.getByText('Spending recorded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your spending plan' })).toBeInTheDocument();
    // plan 30,000 minus 20,000 spent in budgeted categories
    expect(screen.getByText(/Counts 2 budgeted categories only/)).toBeInTheDocument();
    expect(screen.queryByText(/safe to spend/i)).not.toBeInTheDocument();
  });

  it('has one primary chart with a table alternative and no category breakdown', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Is your spending on pace with your plan?' })).toBeInTheDocument();
    expect(screen.getByText('Show as a table')).toBeInTheDocument();
    expect(screen.queryByText('Where your money went')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See where it went/ })).toHaveAttribute('href', '/explore?view=categories');
  });

  it('marks an incomplete period as provisional', () => {
    setup({
      summary: summaryFixture({
        coverage: { start: '2025-09-01', end: '2025-09-30', accounts: [], complete: false, incomeCoverage: 'partial', notes: ['ICICI Savings has no statement for 15-30 Sep'] },
      }),
    });
    expect(screen.getByText(`Provisional: statements through ${formatDate('2025-09-30')}`)).toBeInTheDocument();
    expect(screen.getByText('ICICI Savings has no statement for 15-30 Sep')).toBeInTheDocument();
    expect(screen.getByText(/Days without a statement are left blank/)).toBeInTheDocument();
  });

  it('explains a suppressed savings rate', () => {
    setup({ summary: summaryFixture({ savingsRate: null, savingsRateNote: 'Only a credit-card statement is imported for this period.' }) });
    expect(screen.getByText('Only a credit-card statement is imported for this period.')).toBeInTheDocument();
  });

  it('uses purchase wording and no income or savings rate for card-only evidence', () => {
    setup({ status: statusFixture({ evidence: 'cards_only' }) });
    expect(screen.getByText('Card purchases recorded')).toBeInTheDocument();
    expect(screen.getByText('Credit-card statements only')).toBeInTheDocument();
    expect(screen.queryByText('Savings rate')).not.toBeInTheDocument();
  });

  it('asks to pick one month when the period spans several', () => {
    setup({ plan: null });
    expect(screen.getByText(/No spending plan yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set budgets' })).toHaveAttribute('href', '/plan?tab=budgets');
  });
});

describe('Overview story: comparison and plan meter', () => {
  const cmp = (comparable: boolean, cur: number, prev: number) => ({
    comparable,
    current: { total: cur, label: 'September 2025' },
    previous: { total: prev, label: 'August 2025' },
  });

  it('adds one comparison line, linking to Explore, only when comparable', () => {
    setup({ comparison: cmp(true, 5_000_000, 4_680_000) });
    expect(screen.getByText(/more than August 2025/)).toHaveTextContent('₹3,200 more than August 2025');
    expect(screen.getByRole('link', { name: /Explain/ })).toHaveAttribute('href', '/explore?view=compare');
  });

  it('says nothing about a change when the periods are not comparable', () => {
    setup({ comparison: cmp(false, 5_000_000, 4_680_000) });
    expect(screen.queryByText(/more than|less than/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Explain/ })).not.toBeInTheDocument();
  });

  it('shows the plan as a meter with the amount under the plan and data-through date', () => {
    setup({ plan: { monthlyLimit: 4_000_000, categories: ['food_dining', 'groceries'] } });
    expect(screen.getByRole('meter', { name: 'Spending against your plan' })).toBeInTheDocument();
    expect(screen.getByText(/under your plan/)).toHaveTextContent(`₹20,000 of ₹40,000 · ₹20,000 under your plan · data through ${formatDate('2025-09-30')}`);
  });

  it('shows the excess when over the plan', () => {
    setup({ plan: { monthlyLimit: 1_500_000, categories: ['food_dining', 'groceries'] } });
    expect(screen.getByText(/over your plan/)).toHaveTextContent('₹5,000 over your plan');
  });
});

describe('Overview first run and sample data', () => {
  it('offers guided import and sample data when nothing is imported', async () => {
    sample.startSample.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ transactions: [] });
    expect(screen.getByText(/Your statements are read on this device\. Nothing is uploaded\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Import your first statement/ })).toHaveAttribute('href', '/import');
    await user.click(screen.getByRole('button', { name: 'Explore sample data' }));
    expect(sample.startSample).toHaveBeenCalled();
    expect(analytics.summarize).not.toHaveBeenCalled();
  });

  it('keeps the page and shows skeletons while the ledger loads', () => {
    setup({ ready: false });
    expect(screen.getByLabelText('Loading your overview')).toBeInTheDocument();
  });
});

describe('Overview action card', () => {
  it('shows only the first insight and starts a saving action from it', async () => {
    actions.createSavingAction.mockResolvedValue({});
    actions.upsertBudget.mockResolvedValue({});
    const user = userEvent.setup();
    setup({ insights: [foodInsight, { ...foodInsight, id: 'second', title: 'Second insight' }] });
    expect(screen.getByText('Food & dining is up')).toBeInTheDocument();
    expect(screen.queryByText('Second insight')).not.toBeInTheDocument();
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See 2 transactions' })).toHaveAttribute('href', '/activity?ids=a%2Cb');

    await user.click(screen.getByRole('button', { name: 'Set a limit' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start action' }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'category_limit',
        category: 'food_dining',
        baselineMonthly: 1_500_000,
        targetMonthly: 1_200_000,
        startMonth: addMonths(monthKey(todayIso()), 1),
        insightId: 'ins-food',
      }),
    );
    expect(actions.upsertBudget).toHaveBeenCalledWith('food_dining', 1_200_000);
  });

  it('falls back to a review task that links to the Learning centre', () => {
    const pending = ['a', 'a', 'a', 'b'].map((m, i) => txn(`r${i}`, { needsReview: true, merchantKey: m, merchant: m }));
    setup({ transactions: pending });
    expect(screen.getByRole('link', { name: 'Review transactions' })).toHaveAttribute('href', '/activity?review=1');
    expect(screen.getByRole('link', { name: 'Teach VyayaMitra 2 merchants to fix 4 transactions' })).toHaveAttribute('href', '/learning');
  });

  it('routes other insight actions to the right screen', () => {
    setup({ insights: [{ id: 'r', type: 'recurring', severity: 'info', title: 'Subs', body: 'b', evidence: { txnIds: [], figures: [] }, action: { type: 'review_recurring', label: 'Review subscriptions' } }] });
    expect(screen.getByRole('link', { name: 'Review subscriptions' })).toHaveAttribute('href', '/plan?tab=recurring');
  });
});

describe('Overview review prompt and insight feedback', () => {
  it('replaces the action card with "Your next review" when the latest complete month has no completed review', () => {
    setup({ reviews: [], insights: [foodInsight] });
    expect(screen.getByRole('heading', { name: 'Your next review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start review' })).toHaveAttribute('href', '/review?month=2025-09');
    expect(screen.queryByText('Food & dining is up')).not.toBeInTheDocument();
  });

  it('offers to continue an in-progress review', () => {
    setup({ reviews: [{ month: '2025-09', status: 'in_progress', notes: [], nextActionIds: [], updatedAt: '' }] });
    expect(screen.getByRole('link', { name: 'Continue review' })).toHaveAttribute('href', '/review?month=2025-09');
  });

  it('keeps the insight card once the review is completed, and passes saved feedback to generateInsights', () => {
    setup({ insights: [foodInsight] });
    expect(screen.queryByRole('heading', { name: 'Your next review' })).not.toBeInTheDocument();
    expect(screen.getByText('Food & dining is up')).toBeInTheDocument();
    expect(analytics.generateInsights).toHaveBeenCalledWith(expect.objectContaining({ feedback: [expect.objectContaining({ id: 'fb1' })] }));
  });

  it('records Expected / Not relevant / Dismiss and can undo from the toast', async () => {
    review.recordInsightFeedback.mockResolvedValue(undefined);
    review.clearInsightFeedback.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ insights: [foodInsight] });
    await user.click(screen.getByRole('button', { name: /^Expected/ }));
    expect(review.recordInsightFeedback).toHaveBeenCalledWith({ key: 'category_change:food', insightId: 'ins-food', action: 'expected' });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(review.clearInsightFeedback).toHaveBeenCalledWith('fb1');
    await user.click(screen.getByRole('button', { name: /^Not relevant/ }));
    expect(review.recordInsightFeedback).toHaveBeenLastCalledWith({ key: 'category_change:food', insightId: 'ins-food', action: 'irrelevant' });
    await user.click(screen.getByRole('button', { name: /^Dismiss\s*:/ }));
    expect(review.recordInsightFeedback).toHaveBeenLastCalledWith({ key: 'category_change:food', insightId: 'ins-food', action: 'dismissed' });
  });
});

const rec = (over: Record<string, unknown> = {}) => ({
  id: 'rec-food',
  key: 'reduce_frequency:food',
  title: 'Try two fewer delivery orders next month',
  happened: ['You ordered delivery 14 times, spending ', { paise: 560_000 }, '.'],
  evidence: { txnIds: ['a', 'b'], basis: 'Last 3 months' },
  change: ['Two fewer orders would be about ', { paise: 80_000 }, ' a month.'],
  estimatedEffect: 80_000,
  assumptions: ['replacement meals also cost money'],
  check: 'Compare the next complete month with your target',
  category: 'food_dining',
  suggestedTarget: 480_000,
  factors: { effect: 0.5, evidence: 0.5, urgency: 0.2, effort: 0.3 },
  kind: 'reduce_frequency',
  ...over,
});

describe('Overview suggested actions', () => {
  it('shows the top three recommendations, with urgent refund and fee items always included', () => {
    const recs = [rec({ id: 'r1', title: 'One' }), rec({ id: 'r2', title: 'Two' }), rec({ id: 'r3', title: 'Three' }), rec({ id: 'r4', title: 'Four' }), rec({ id: 'r5', title: 'Chase the hotel refund', kind: 'chase_refund' })];
    setup({ recs });
    expect(screen.getByRole('heading', { name: 'Suggested actions' })).toBeInTheDocument();
    expect(screen.getByText('Chase the hotel refund')).toBeInTheDocument();
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.queryByText('Three')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Money back' })).toHaveAttribute('href', '/money-back');
  });

  it('labels the effect as an estimate and states assumptions', () => {
    setup({ recs: [rec()] });
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByText(/Assumes: replacement meals also cost money/)).toBeInTheDocument();
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View purchases/ })).toHaveAttribute('href', '/activity?ids=a%2Cb');
  });

  it('stays visible when a month-end review is due', () => {
    setup({ recs: [rec()], reviews: [] });
    expect(screen.getByRole('heading', { name: 'Your next review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Suggested actions' })).toBeInTheDocument();
  });

  it('"Choose a target" stores scope, assumptions and outcome kind', async () => {
    actions.createSavingAction.mockResolvedValue({});
    const user = userEvent.setup();
    setup({ recs: [rec()] });
    await user.click(screen.getByRole('button', { name: /Choose a target/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Monthly target (₹)')).toHaveValue('4800');
    await user.click(within(dialog).getByRole('button', { name: 'Choose this target' }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'category_limit',
        category: 'food_dining',
        targetMonthly: 480_000,
        baselineMonthly: 560_000,
        insightId: 'rec-food',
        scope: expect.objectContaining({ categories: ['food_dining'] }),
        assumptions: ['replacement meals also cost money'],
        outcomeKind: 'purchase_reduction',
      }),
    );
  });

  it('"Keep this spending" protects the category', async () => {
    moneyback.setAdviserPreference.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ recs: [rec()] });
    await user.click(screen.getByRole('button', { name: /Keep this spending/ }));
    expect(moneyback.setAdviserPreference).toHaveBeenCalledWith('food_dining', 'protected');
  });

  it('masks amounts inside advice text when "Hide amounts" is on', () => {
    setup({ recs: [rec()], hide: true });
    expect(screen.queryByText(/5,600/)).not.toBeInTheDocument();
    expect(screen.queryByText(/800/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Amount hidden').length).toBeGreaterThan(0);
  });

  it('masks rupee amounts in preformatted insight text too', () => {
    setup({ hide: true, insights: [{ id: 'x', type: 'budget', severity: 'info', title: 'You spent ₹12,500 on food', body: 'That is ₹3,200 more.', evidence: { txnIds: [], figures: [{ label: 'Total', value: '₹12,500' }] } }] });
    expect(screen.getByText('You spent ₹ •••• on food')).toBeInTheDocument();
    expect(screen.queryByText(/12,500/)).not.toBeInTheDocument();
  });
});

describe('Overview money back, fees and unresolved movements', () => {
  it('shows compact Money back and Fees summaries linking to their pages', () => {
    setup({
      money: { received: [], cases: [], needsMatching: [{ creditTxnId: 'c1' }], totals: { receivedInPeriod: 0, expectedOutstanding: 450_000, openCases: 2, amountToConfirm: 0 } },
      fees: { events: [{ status: 'not_reversed' }, { status: 'reversed' }], byMonth: [], totals: { charged: 0, tax: 0, reversed: 0, net: 59_000 }, recurring: [] },
    });
    expect(screen.getByRole('link', { name: /Open Money back/ })).toHaveAttribute('href', '/money-back');
    expect(screen.getByRole('link', { name: /Open Fees/ })).toHaveAttribute('href', '/fees');
    expect(screen.getByText('Open cases').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Not reversed').nextSibling).toHaveTextContent('1');
  });

  it('flags unresolved money movements with amounts out and in', () => {
    setup({ summary: { ...summaryFixture(), unresolved: { out: 250_000, in: 120_000 } } as LedgerSummary });
    const note = screen.getByText(/Unresolved money movements/).closest('div')!.parentElement!;
    expect(note).toHaveTextContent('₹2,500 out · ₹1,200 in');
    expect(within(note).getByRole('link', { name: 'classify' })).toHaveAttribute('href', '/activity?review=1');
  });

  it('shows no unresolved note when nothing is unresolved', () => {
    setup();
    expect(screen.queryByText(/Unresolved money movements/)).not.toBeInTheDocument();
  });
});

describe('Overview below the fold', () => {
  it('lists upcoming card bills, recent activity and a trends teaser', () => {
    setup({
      accounts: [{ id: 'cc1', name: 'Demo Card ••1234' } as Account],
      transactions: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => txn(id)),
      dues: [{ accountId: 'cc1', statementId: 's1', dueDate: addIso(), totalDue: 1_250_000, paidSoFar: 0, status: 'due', daysLeft: 5 }],
    });
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeInTheDocument();
    expect(screen.getByText('Demo Card ••1234 bill')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Demo Shop/ })).toHaveLength(5);
    expect(screen.getByRole('link', { name: /Explore trends/ })).toHaveAttribute('href', '/explore?view=trends');
  });

  it('hides the trends teaser with fewer than three complete months', () => {
    setup({ status: statusFixture({ completeMonths: ['2025-09'] }) });
    expect(screen.queryByRole('link', { name: /Explore trends/ })).not.toBeInTheDocument();
  });
});

function addIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return todayIso(d);
}
