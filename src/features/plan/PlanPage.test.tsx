import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavingAction, SavingsGoal } from '@/domain/types';
import type { ActionOutcome, GoalProgress, RecurringSeries } from '@/engine/analytics';
import { addMonths, monthKey, todayIso } from '@/lib/dates';
import { ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useBudgets: vi.fn(),
  useGoals: vi.fn(),
  useGoalContributions: vi.fn(),
  useRecurringDecisions: vi.fn(),
  useSavingActions: vi.fn(),
}));
vi.mock('@/db/hooks', () => hooks);

const actions = vi.hoisted(() => ({
  upsertBudget: vi.fn(),
  deleteBudget: vi.fn(),
  addContribution: vi.fn(),
  deleteContribution: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  setRecurringDecision: vi.fn(),
  createSavingAction: vi.fn(),
  updateSavingAction: vi.fn(),
}));
vi.mock('@/db/actions', () => actions);

vi.mock('@/app/period', () => ({
  usePeriod: () => ({
    period: { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
  }),
}));

const analytics = vi.hoisted(() => ({
  budgetStatuses: vi.fn(),
  categoryBaselines: vi.fn(),
  dataRange: vi.fn(),
  detectRecurring: vi.fn(),
  isSeriesActive: vi.fn(() => true),
  goalProgress: vi.fn(),
  evaluateSavingActions: vi.fn(),
  upcomingCardDues: vi.fn(),
}));
vi.mock('@/engine/analytics', () => analytics);

import PlanPage from './PlanPage';

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPlan(path = '/plan?tab=budgets') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <PlanPage />
        <Where />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const goal: SavingsGoal = {
  id: 'g1',
  name: 'Emergency fund',
  target: 10_000_000,
  icon: 'ShieldCheck',
  color: 'rgb(var(--chart-1))',
  archived: false,
  createdAt: '2025-01-01T00:00:00.000Z',
};

function progressFor(g: SavingsGoal): GoalProgress {
  return {
    goal: g,
    saved: 500_000,
    verified: 200_000,
    remaining: 9_500_000,
    progress: 0.05,
    monthlyNeeded: null,
    recentMonthlyPace: 100_000,
    onTrack: null,
    contributions: [
      { id: 'c1', goalId: g.id, date: '2025-09-02', amount: 500_000, type: 'deposit', createdAt: '2025-09-02T00:00:00.000Z' },
    ],
  };
}

const series: RecurringSeries = {
  merchantKey: 'netflix',
  merchant: 'Netflix',
  category: 'subscriptions',
  cadence: 'monthly',
  intervalDays: 30,
  typicalAmount: 64_900,
  monthlyCost: 64_900,
  occurrences: 4,
  lastDate: '2025-09-05',
  nextExpected: '2025-10-05',
  confidence: 0.9,
  status: 'suggested',
  txnIds: ['t1', 't2'],
  overdue: false,
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useLedger.mockReturnValue({ ready: true, accounts: [], statements: [], transactions: [], customCategories: [] });
  hooks.useBudgets.mockReturnValue([]);
  hooks.useGoals.mockReturnValue([]);
  hooks.useGoalContributions.mockReturnValue([]);
  hooks.useRecurringDecisions.mockReturnValue([]);
  hooks.useSavingActions.mockReturnValue([]);
  analytics.budgetStatuses.mockReturnValue([]);
  analytics.categoryBaselines.mockReturnValue([{ category: 'groceries', monthlyAverage: 800_000, monthsUsed: 3 }]);
  analytics.dataRange.mockReturnValue({ min: '2025-06-01', max: '2025-09-30' });
  analytics.detectRecurring.mockReturnValue([]);
  analytics.goalProgress.mockImplementation((g: SavingsGoal) => progressFor(g));
  analytics.evaluateSavingActions.mockReturnValue([]);
  analytics.upcomingCardDues.mockReturnValue([]);
});

describe('Plan tabs', () => {
  it('persists the selected tab in the URL', async () => {
    const user = userEvent.setup();
    renderPlan('/plan');
    expect(screen.getByRole('tab', { name: 'Budgets' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Goals' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/plan?tab=goals');
    expect(screen.getByRole('tab', { name: 'Goals' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the tab named in the URL', () => {
    renderPlan('/plan?tab=recurring');
    expect(screen.getByRole('tab', { name: 'Recurring' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Budgets', () => {
  it('converts "1,250.50" to 125050 paise when saving', async () => {
    actions.upsertBudget.mockResolvedValue({});
    const user = userEvent.setup();
    renderPlan();
    await user.click(screen.getByRole('button', { name: 'Add budget' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'groceries');
    expect(within(dialog).getByText(/3-month average is/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Monthly limit (₹)'), '1,250.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save budget' }));
    expect(actions.upsertBudget).toHaveBeenCalledWith('groceries', 125050);
  });

  it('rejects an amount of 0 with an inline message and does not save', async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(screen.getByRole('button', { name: 'Add budget' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Monthly limit (₹)'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save budget' }));
    expect(within(dialog).getByText('Amount must be more than ₹0.')).toBeInTheDocument();
    expect(actions.upsertBudget).not.toHaveBeenCalled();
  });

  it('shows status, pace note and coverage warning for a budget', () => {
    const budget = { id: 'b1', category: 'groceries', monthlyLimit: 1_000_000, createdAt: '', updatedAt: '' };
    hooks.useBudgets.mockReturnValue([budget]);
    analytics.budgetStatuses.mockReturnValue([
      {
        budget,
        month: monthKey(todayIso()),
        spent: 600_000,
        remaining: 400_000,
        usage: 0.6,
        expectedByToday: 500_000,
        state: 'watch',
        coverageComplete: false,
        txnIds: ['t1', 't2', 't3'],
      },
    ]);
    renderPlan('/plan?tab=budgets');
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText(/do not fully cover this month/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See 3 transactions' })).toHaveAttribute('href', '/activity?ids=t1%2Ct2%2Ct3');
  });
});

describe('Goals', () => {
  it('shows the action error when a withdrawal is refused', async () => {
    hooks.useGoals.mockReturnValue([goal]);
    const err = new Error('You cannot withdraw more than the ₹5,000.00 saved in this goal.');
    err.name = 'ValidationError';
    actions.addContribution.mockRejectedValue(err);
    const user = userEvent.setup();
    renderPlan('/plan?tab=goals');

    await user.click(screen.getByRole('button', { name: 'Withdraw from Emergency fund' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount (₹)'), '9000');
    await user.click(within(dialog).getByRole('button', { name: 'Record withdrawal' }));

    expect(actions.addContribution).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'g1', type: 'withdrawal', amount: 900_000 }));
    expect(await within(dialog).findByText(/cannot withdraw more than/)).toBeInTheDocument();
  });

  it('rejects a zero deposit before calling the action', async () => {
    hooks.useGoals.mockReturnValue([goal]);
    const user = userEvent.setup();
    renderPlan('/plan?tab=goals');
    await user.click(screen.getByRole('button', { name: 'Add deposit to Emergency fund' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount (₹)'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Add deposit' }));
    expect(within(dialog).getByText('Amount must be more than ₹0.')).toBeInTheDocument();
    expect(actions.addContribution).not.toHaveBeenCalled();
  });

  it('separates verified from self-reported savings', () => {
    hooks.useGoals.mockReturnValue([goal]);
    renderPlan('/plan?tab=goals');
    expect(screen.getByText('Verified by your statements')).toBeInTheDocument();
    expect(screen.getByText('Self-reported')).toBeInTheDocument();
  });
});

describe('Recurring', () => {
  it('confirming a suggestion calls setRecurringDecision', async () => {
    analytics.detectRecurring.mockReturnValue([series]);
    actions.setRecurringDecision.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPlan('/plan?tab=recurring');
    await user.click(screen.getByRole('button', { name: 'Confirm Netflix as recurring' }));
    expect(actions.setRecurringDecision).toHaveBeenCalledWith(
      expect.objectContaining({ merchantKey: 'netflix', status: 'confirmed', cadence: 'monthly', expectedAmount: 64_900 }),
    );
  });

  it('"Not recurring" dismisses the series', async () => {
    analytics.detectRecurring.mockReturnValue([series]);
    actions.setRecurringDecision.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPlan('/plan?tab=recurring');
    await user.click(screen.getByRole('button', { name: 'Netflix is not recurring' }));
    expect(actions.setRecurringDecision).toHaveBeenCalledWith({ merchantKey: 'netflix', status: 'dismissed' });
  });

  it('"Review to save" creates a review_recurring saving action', async () => {
    analytics.detectRecurring.mockReturnValue([{ ...series, status: 'confirmed', overdue: true }]);
    actions.createSavingAction.mockResolvedValue({});
    const user = userEvent.setup();
    renderPlan('/plan?tab=recurring');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review Netflix to save' }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review_recurring',
        merchantKey: 'netflix',
        baselineMonthly: 64_900,
        targetMonthly: 0,
        startMonth: addMonths(monthKey(todayIso()), 1),
        status: 'active',
      }),
    );
  });
});

describe('Card dues', () => {
  it('lists unpaid card bills under "Due soon" with status and days left', () => {
    hooks.useLedger.mockReturnValue({
      ready: true,
      accounts: [{ id: 'cc1', name: 'Demo Card ••1234' }],
      statements: [],
      transactions: [],
      customCategories: [],
    });
    analytics.upcomingCardDues.mockReturnValue([
      { accountId: 'cc1', statementId: 's1', dueDate: '2025-10-05', totalDue: 1_250_000, minimumDue: 62_500, paidSoFar: 0, status: 'due', daysLeft: 3 },
      { accountId: 'cc1', statementId: 's0', dueDate: '2025-09-05', totalDue: 900_000, paidSoFar: 900_000, status: 'paid', daysLeft: -27 },
    ]);
    renderPlan('/plan?tab=recurring');
    expect(screen.getByRole('heading', { name: 'Due soon' })).toBeInTheDocument();
    expect(screen.getByText('Due in 3 days')).toBeInTheDocument();
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
  });
});

describe('Saving actions', () => {
  const action: SavingAction = {
    id: 'a1',
    type: 'category_limit',
    title: 'Keep Food & dining near ₹12,000 a month',
    category: 'food_dining',
    baselineMonthly: 1_500_000,
    targetMonthly: 1_200_000,
    startMonth: '2025-10',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };

  function outcome(over: Partial<ActionOutcome>): ActionOutcome {
    return { action, monthsEvaluated: [], actualMonthly: null, achievedMonthlySaving: null, state: 'waiting_for_data', txnIds: [], ...over };
  }

  it('shows estimates apart from achievement and waits for a complete month', () => {
    hooks.useSavingActions.mockReturnValue([action]);
    analytics.evaluateSavingActions.mockReturnValue([outcome({})]);
    renderPlan('/plan?tab=actions');
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Waiting for a full month of data').length).toBeGreaterThan(0);
    expect(screen.queryByText(/a month saved/)).not.toBeInTheDocument();
  });

  it('shows achieved savings only once complete months exist, and can mark completed', async () => {
    hooks.useSavingActions.mockReturnValue([action]);
    analytics.evaluateSavingActions.mockReturnValue([
      outcome({ monthsEvaluated: ['2025-10'], actualMonthly: 1_100_000, achievedMonthlySaving: 400_000, state: 'achieved' }),
    ]);
    actions.updateSavingAction.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPlan('/plan?tab=actions');
    expect(screen.getByText(/a month saved/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Mark ${action.title} completed` }));
    expect(actions.updateSavingAction).toHaveBeenCalledWith('a1', { status: 'completed' });
  });
});
