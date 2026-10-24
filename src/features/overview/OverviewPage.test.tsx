import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDue, Insight, LedgerSummary } from '@/engine/analytics';
import type { Account, Transaction } from '@/domain/types';
import { addMonths, monthKey, todayIso } from '@/lib/dates';
import { ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useBudgets: vi.fn(),
  useRecurringDecisions: vi.fn(),
  useSavingActions: vi.fn(),
}));
vi.mock('@/db/hooks', () => hooks);

const actions = vi.hoisted(() => ({
  createSavingAction: vi.fn(),
  upsertBudget: vi.fn(),
}));
vi.mock('@/db/actions', () => actions);

vi.mock('@/app/period', () => ({
  usePeriod: () => ({
    period: { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
  }),
}));

const analytics = vi.hoisted(() => ({
  applyQuery: vi.fn(),
  summarize: vi.fn(),
  monthlySeries: vi.fn(),
  generateInsights: vi.fn(),
  categoryBaselines: vi.fn(),
  upcomingCardDues: vi.fn(),
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
    byGroup: [
      { group: 'lifestyle', amount: 1_200_000, share: 0.24 },
      { group: 'essentials', amount: 800_000, share: 0.16 },
    ],
    counts: { total: 40, needsReview: 3, debits: 30, credits: 10 },
    coverage: { start: '2025-09-01', end: '2025-09-30', accounts: [], complete: true, incomeCoverage: 'full', notes: [] },
    ...over,
  };
}

const txn = { id: 't1', needsReview: false, merchantKey: 'm1', merchant: 'M1' } as Transaction;

function setup(
  opts: { transactions?: Transaction[]; summary?: LedgerSummary; insights?: Insight[]; ready?: boolean; dues?: CardDue[]; accounts?: Account[] } = {},
) {
  hooks.useLedger.mockReturnValue({
    ready: opts.ready ?? true,
    accounts: opts.accounts ?? [],
    statements: [],
    transactions: opts.transactions ?? [txn],
    customCategories: [],
  });
  hooks.useBudgets.mockReturnValue([]);
  hooks.useRecurringDecisions.mockReturnValue([]);
  hooks.useSavingActions.mockReturnValue([]);
  analytics.applyQuery.mockImplementation((t: Transaction[]) => t);
  analytics.summarize.mockReturnValue(opts.summary ?? summaryFixture());
  analytics.monthlySeries.mockReturnValue([
    { month: '2025-08', income: 7_000_000, spending: 4_000_000, invested: 0, netSavings: 3_000_000, complete: true },
    { month: '2025-09', income: 8_000_000, spending: 5_000_000, invested: 0, netSavings: 3_000_000, complete: false },
  ]);
  analytics.generateInsights.mockReturnValue(opts.insights ?? []);
  analytics.upcomingCardDues.mockReturnValue(opts.dues ?? []);
  analytics.categoryBaselines.mockReturnValue([{ category: 'food_dining', monthlyAverage: 1_500_000, monthsUsed: 3 }]);
  return render(
    <ToastProvider>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Overview', () => {
  it('shows the privacy-first welcome when nothing is imported', () => {
    setup({ transactions: [] });
    expect(screen.getByText(/Your statements are read on this device\. Nothing is uploaded\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Import your first statement/ })).toHaveAttribute('href', '/import');
    expect(analytics.summarize).not.toHaveBeenCalled();
  });

  it('keeps the page and shows skeletons while the ledger loads', () => {
    setup({ ready: false });
    // The page heading lives in the app shell (usePageChrome); here the loading region must render in place.
    expect(screen.getByLabelText('Loading your overview')).toBeInTheDocument();
  });

  it('shows the reason when the savings rate is suppressed', () => {
    setup({
      summary: summaryFixture({ savingsRate: null, savingsRateNote: 'Only a credit-card statement is imported for this period.' }),
    });
    expect(screen.getByText('Only a credit-card statement is imported for this period.')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the coverage banner with notes and an import link when coverage is incomplete', () => {
    setup({
      summary: summaryFixture({
        coverage: {
          start: '2025-09-01',
          end: '2025-09-30',
          accounts: [],
          complete: false,
          incomeCoverage: 'partial',
          notes: ['ICICI Savings has no statement for 1-14 Sep'],
        },
      }),
    });
    expect(screen.getByText('ICICI Savings has no statement for 1-14 Sep')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/import');
  });

  it('hides the coverage banner when coverage is complete', () => {
    setup();
    expect(screen.queryByText(/not covered by your statements/)).not.toBeInTheDocument();
  });

  it('lists categories as links into Activity and has a trend data table', () => {
    setup();
    const link = screen.getByRole('link', { name: /Food & dining/ });
    expect(link).toHaveAttribute('href', '/activity?category=food_dining');
    expect(screen.getByRole('table', { name: 'Monthly income and spending' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review money sent to people' })).toHaveAttribute('href', '/activity?kind=p2p_out');
    expect(screen.getByRole('link', { name: 'Review transactions' })).toHaveAttribute('href', '/activity?review=1');
  });

  it('starts a saving action from a category_limit insight and offers the budget', async () => {
    const insight: Insight = {
      id: 'ins-food',
      type: 'category_change',
      severity: 'warning',
      title: 'Food & dining is up',
      body: 'You spent more on food than usual.',
      evidence: { txnIds: ['a', 'b'], figures: [{ label: 'This period', value: '₹12,000' }] },
      action: { type: 'category_limit', label: 'Set a limit', category: 'food_dining', suggestedTarget: 1_200_000 },
      estimatedMonthlySaving: 300_000,
    };
    actions.createSavingAction.mockResolvedValue({});
    actions.upsertBudget.mockResolvedValue({});
    const user = userEvent.setup();
    setup({ insights: [insight] });

    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See 2 transactions' })).toHaveAttribute('href', '/activity?ids=a%2Cb');

    await user.click(screen.getByRole('button', { name: 'Set a limit' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Start action' }));

    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'category_limit',
        category: 'food_dining',
        baselineMonthly: 1_500_000,
        targetMonthly: 1_200_000,
        startMonth: addMonths(monthKey(todayIso()), 1),
        status: 'active',
        insightId: 'ins-food',
      }),
    );
    expect(actions.upsertBudget).toHaveBeenCalledWith('food_dining', 1_200_000);
  });

  it('shows the error inline when starting the action fails', async () => {
    const insight: Insight = {
      id: 'ins-food',
      type: 'category_change',
      severity: 'info',
      title: 'Food',
      body: 'b',
      evidence: { txnIds: [], figures: [] },
      action: { type: 'category_limit', label: 'Set a limit', category: 'food_dining', suggestedTarget: 1_200_000 },
    };
    actions.createSavingAction.mockRejectedValue(new Error('Disk is full'));
    const user = userEvent.setup();
    setup({ insights: [insight] });
    await user.click(screen.getByRole('button', { name: 'Set a limit' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start action' }));
    expect(await within(screen.getByRole('dialog')).findByText('Disk is full')).toBeInTheDocument();
    expect(actions.upsertBudget).not.toHaveBeenCalled();
  });

  it('routes other insight actions to the right screen', () => {
    setup({
      insights: [
        { id: 'r', type: 'recurring', severity: 'info', title: 'Subs', body: 'b', evidence: { txnIds: [], figures: [] }, action: { type: 'review_recurring', label: 'Review subscriptions' } },
        { id: 'c', type: 'coverage', severity: 'warning', title: 'Gap', body: 'b', evidence: { txnIds: [], figures: [] }, action: { type: 'import_statement', label: 'Import now' } },
      ],
    });
    expect(screen.getByRole('link', { name: 'Review subscriptions' })).toHaveAttribute('href', '/plan?tab=recurring');
    expect(screen.getByRole('link', { name: 'Import now' })).toHaveAttribute('href', '/import');
  });

  it('links to the Learning centre with the number of merchants and rows behind the review queue', () => {
    const pending = ['a', 'a', 'a', 'b'].map((m, i) => ({ id: `r${i}`, needsReview: true, merchantKey: m, merchant: m }) as Transaction);
    setup({ transactions: pending });
    const link = screen.getByRole('link', { name: 'Teach VyayaMitra 2 merchants to fix 4 transactions' });
    expect(link).toHaveAttribute('href', '/learning');
  });

  it('shows upcoming card bills with status and days left', () => {
    setup({
      accounts: [{ id: 'cc1', name: 'Demo Card ••1234' } as Account],
      dues: [
        { accountId: 'cc1', statementId: 's1', dueDate: '2025-10-05', totalDue: 1_250_000, minimumDue: 62_500, paidSoFar: 0, status: 'overdue', daysLeft: -2 },
      ],
    });
    expect(screen.getByRole('heading', { name: 'Card bills' })).toBeInTheDocument();
    expect(screen.getByText('Demo Card ••1234')).toBeInTheDocument();
    expect(screen.getByText('2 days overdue')).toBeInTheDocument();
  });

  it('hides the card bills section when no card has a due date', () => {
    setup();
    expect(screen.queryByRole('heading', { name: 'Card bills' })).not.toBeInTheDocument();
  });

  it('shows Spending and Sent to people side by side when the summary splits them', () => {
    setup({ summary: { ...summaryFixture(), consumption: 4_550_000 } as LedgerSummary });
    const spending = screen.getByRole('button', { name: /^Spending/ });
    expect(spending).toHaveTextContent('₹45,500');
    expect(screen.getByRole('button', { name: /^Sent to people/ })).toHaveTextContent('₹4,500');
    // a single review link for money sent to people (the tile's), not two
    expect(screen.getAllByRole('link', { name: 'Review money sent to people' })).toHaveLength(1);
  });

  it('keeps the four classic tiles when the summary has no consumption figure', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Sent to people/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Spending/ })).toHaveTextContent('₹50,000');
  });
});
