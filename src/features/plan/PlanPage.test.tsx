import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavingAction, SavingsGoal } from '@/domain/types';
import type { ActionOutcome, GoalProgress, RecurringSeries } from '@/engine/analytics';
import { addMonths, monthEnd, monthKey, todayIso } from '@/lib/dates';
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

const periodMock = vi.hoisted(() => ({
  period: { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
}));
vi.mock('@/app/period', () => ({ usePeriod: () => periodMock }));

const analytics = vi.hoisted(() => ({
  budgetStatuses: vi.fn(),
  categoryBaselines: vi.fn(),
  dataRange: vi.fn(),
  detectRecurring: vi.fn(),
  isSeriesActive: vi.fn(() => true),
  goalProgress: vi.fn(),
  evaluateSavingActions: vi.fn(),
  upcomingCardDues: vi.fn(),
  dataStatus: vi.fn(),
  planScenario: vi.fn<(input: Parameters<typeof import('@/engine/analytics').planScenario>[0]) => import('@/engine/analytics').ScenarioResult>(() => ({
    currentPlanTotal: 2_000_000,
    scenarioPlanTotal: 1_800_000,
    plannedReduction: 200_000,
    perCategory: [{ category: 'food_dining', baseline: 900_000, current: 800_000, scenario: 600_000, reduction: 200_000, kept: false }],
    goalImpact: [],
    notes: ['This is a scenario, not a prediction.'],
  })),
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
  analytics.dataStatus.mockReturnValue({ dataThrough: '2025-09-24' });
  periodMock.period = { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' };
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
    expect(screen.getByText('Within budget')).toBeInTheDocument();
    expect(screen.getByText(/do not fully cover this month/)).toBeInTheDocument();
    expect(screen.getByText(/used/)).toHaveTextContent(/₹6,000 of ₹10,000 used · ₹4,000 remaining · data through 24 Sep/);
    expect(screen.getByRole('link', { name: 'See 3 transactions' })).toHaveAttribute('href', '/activity?ids=t1%2Ct2%2Ct3');
  });
});

describe('Budget pace', () => {
  const budget = { id: 'b1', category: 'groceries', monthlyLimit: 1_000_000, createdAt: '', updatedAt: '' };
  const status = (spent: number, expected: number) => ({
    budget,
    month: monthKey(todayIso()),
    spent,
    remaining: 1_000_000 - spent,
    usage: spent / 1_000_000,
    expectedByToday: expected,
    state: 'watch',
    coverageComplete: true,
    txnIds: [],
  });
  const thisMonth = () => {
    const m = monthKey(todayIso());
    periodMock.period = { preset: 'this_month', start: `${m}-01`, end: monthEnd(m), label: 'This month' };
  };

  it('does not warn at 80% used when that matches the pace', () => {
    thisMonth();
    hooks.useBudgets.mockReturnValue([budget]);
    analytics.budgetStatuses.mockReturnValue([status(800_000, 780_000)]);
    renderPlan();
    expect(screen.getByText('On pace')).toBeInTheDocument();
  });

  it('warns when well ahead of pace, and shows the over amount when over', () => {
    thisMonth();
    hooks.useBudgets.mockReturnValue([budget]);
    analytics.budgetStatuses.mockReturnValue([status(500_000, 200_000)]);
    const { unmount } = renderPlan();
    expect(screen.getByText('Ahead of pace')).toBeInTheDocument();
    unmount();
    analytics.budgetStatuses.mockReturnValue([status(1_250_000, 900_000)]);
    renderPlan();
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    expect(screen.getByText(/₹2,500 over|over$/)).toBeInTheDocument();
  });
});

describe('Scenario editor', () => {
  const budget = { id: 'b1', category: 'groceries', monthlyLimit: 1_000_000, createdAt: '', updatedAt: '' };
  const result = (over = {}) => ({
    currentPlanTotal: 1_000_000,
    scenarioPlanTotal: 800_000,
    plannedReduction: 200_000,
    perCategory: [],
    surplusNow: 300_000,
    surplusScenario: 500_000,
    goalImpact: [{ goalId: 'g1', name: 'Emergency fund', extraPerMonth: 200_000, monthsSooner: 2 }],
    notes: ['Limits are not added on top of money already planned for goals.'],
    ...over,
  });

  beforeEach(() => {
    hooks.useBudgets.mockReturnValue([budget]);
    analytics.planScenario.mockImplementation(() => result());
  });

  it('opens from the deep link and shows the current plan beside the scenario, labelled as not a prediction', () => {
    renderPlan('/plan?tab=budgets&scenario=1');
    expect(screen.getByText('Scenario — not a prediction')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your plan now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scenario' })).toBeInTheDocument();
    expect(screen.getByText(/Emergency fund: ₹2,000 more a month, about 2 months sooner/)).toBeInTheDocument();
    expect(screen.getByText(/not added on top/)).toBeInTheDocument();
  });

  it('sends edited limits and kept expenses to planScenario', async () => {
    const user = userEvent.setup();
    renderPlan('/plan?tab=budgets&scenario=1');
    const input = screen.getByLabelText('Groceries limit (₹)');
    await user.clear(input);
    await user.type(input, '8,000');
    await user.click(screen.getByLabelText(/Keep this expense/));
    const last = analytics.planScenario.mock.calls.at(-1)![0];
    expect(last.changes).toEqual([{ category: 'groceries', monthlyLimit: 800_000 }]);
    expect(last.keep).toEqual(['groceries']);
  });

  it('prefills a single new limit from ?category=&target= (paise)', () => {
    renderPlan('/plan?tab=budgets&category=food_dining&target=600000');
    expect(screen.getByLabelText('Food & dining limit (₹)')).toHaveValue('6000');
    const last = analytics.planScenario.mock.calls.at(-1)![0];
    expect(last.changes).toContainEqual({ category: 'food_dining', monthlyLimit: 600_000 });
  });

  it('saves limits and creates planned saving actions for reductions', async () => {
    actions.upsertBudget.mockResolvedValue({});
    actions.createSavingAction.mockResolvedValue({});
    const user = userEvent.setup();
    renderPlan('/plan?tab=budgets&scenario=1');
    const input = screen.getByLabelText('Groceries limit (₹)');
    await user.clear(input);
    await user.type(input, '8000');
    await user.click(screen.getByRole('button', { name: 'Save as my plan' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/planned, not observed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save plan' }));
    expect(actions.upsertBudget).toHaveBeenCalledWith('groceries', 800_000);
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'category_limit', category: 'groceries', baselineMonthly: expect.any(Number), targetMonthly: 800_000, status: 'active' }),
    );
  });

  it('puts the planned difference toward a chosen goal as a goal_contribution action', async () => {
    hooks.useGoals.mockReturnValue([goal]);
    actions.createSavingAction.mockResolvedValue({});
    const user = userEvent.setup();
    renderPlan('/plan?tab=budgets&scenario=1');
    await user.selectOptions(screen.getByLabelText('Put the difference toward a goal'), 'g1');
    await user.click(screen.getByRole('button', { name: 'Plan this contribution' }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'goal_contribution', goalId: 'g1', targetMonthly: 200_000, status: 'active' }),
    );
  });

  it('rejects an invalid scenario amount inline and blocks saving', async () => {
    const user = userEvent.setup();
    renderPlan('/plan?tab=budgets&scenario=1');
    const input = screen.getByLabelText('Groceries limit (₹)');
    await user.clear(input);
    await user.type(input, 'abc');
    expect(screen.getByText(/Enter an amount like/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as my plan' })).toBeDisabled();
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

  it('asks for target, deadline and monthly plan before name, icon and colour', async () => {
    const user = userEvent.setup();
    renderPlan('/plan?tab=goals');
    await user.click(screen.getByRole('button', { name: 'New goal' }));
    const dialog = screen.getByRole('dialog');
    const order = ['Target amount (₹)', 'Target date (optional)', 'Monthly contribution (optional)', 'Name'].map((l) => within(dialog).getByLabelText(l));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(order[3].compareDocumentPosition(within(dialog).getByRole('radiogroup', { name: 'Goal icon' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('suggests a monthly amount from the deadline', async () => {
    const user = userEvent.setup();
    renderPlan('/plan?tab=goals');
    await user.click(screen.getByRole('button', { name: 'New goal' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Target amount (₹)'), '120000');
    fireEvent.change(within(dialog).getByLabelText('Target date (optional)'), { target: { value: monthEnd(addMonths(monthKey(todayIso()), 12)) } });
    expect(await within(dialog).findByText(/set aside about/)).toHaveTextContent('₹10,000');
  });

  it('shows a progress ring and behind-schedule wording against the deadline', () => {
    hooks.useGoals.mockReturnValue([{ ...goal, targetDate: '2035-01-01' }]);
    renderPlan('/plan?tab=goals');
    expect(screen.getByRole('progressbar', { name: 'Emergency fund progress' })).toBeInTheDocument();
    expect(screen.getByText('Behind schedule')).toBeInTheDocument();
    expect(screen.getByText(/By today you planned to have/)).toHaveTextContent(/so you are .* behind/);
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
    await user.click(screen.getByRole('button', { name: 'Record cancellation requested for Netflix' }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'review_recurring',
        title: 'Cancellation requested: Netflix',
        merchantKey: 'netflix',
        baselineMonthly: 64_900,
        targetMonthly: 0,
        startMonth: addMonths(monthKey(todayIso()), 1),
        status: 'active',
      }),
    );
  });
});

describe('Commitment timeline', () => {
  it('lists unpaid card bills and confirmed recurring payments for the next 60 days', () => {
    const soon = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return todayIso(d);
    };
    hooks.useLedger.mockReturnValue({
      ready: true,
      accounts: [{ id: 'cc1', name: 'Demo Card ••1234' }],
      statements: [],
      transactions: [],
      customCategories: [],
    });
    analytics.upcomingCardDues.mockReturnValue([
      { accountId: 'cc1', statementId: 's1', dueDate: soon(3), totalDue: 1_250_000, minimumDue: 62_500, paidSoFar: 0, status: 'due', daysLeft: 3 },
      { accountId: 'cc1', statementId: 's0', dueDate: soon(-27), totalDue: 900_000, paidSoFar: 900_000, status: 'paid', daysLeft: -27 },
    ]);
    analytics.detectRecurring.mockReturnValue([{ ...series, status: 'confirmed', nextExpected: soon(10) }]);
    renderPlan('/plan?tab=recurring');
    expect(screen.getByRole('heading', { name: 'Next 60 days' })).toBeInTheDocument();
    expect(screen.getByText('Demo Card ••1234 bill')).toBeInTheDocument();
    expect(screen.getByText('In 3 days')).toBeInTheDocument();
    expect(screen.queryByText(/Paid/)).not.toBeInTheDocument();
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
    expect(screen.getByText('1 · Opportunity')).toBeInTheDocument();
    expect(screen.getByText('2 · Planned adjustment')).toBeInTheDocument();
    expect(screen.getByText('3 · Recorded result')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for a full month of data').length).toBeGreaterThan(0);
    expect(screen.queryByText(/a month lower/)).not.toBeInTheDocument();
  });

  it('shows achieved savings only once complete months exist, and can mark completed', async () => {
    hooks.useSavingActions.mockReturnValue([action]);
    analytics.evaluateSavingActions.mockReturnValue([
      outcome({ monthsEvaluated: ['2025-10'], actualMonthly: 1_100_000, achievedMonthlySaving: 400_000, state: 'achieved' }),
    ]);
    actions.updateSavingAction.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPlan('/plan?tab=actions');
    expect(screen.getAllByText(/a month lower/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not why|not what caused it/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: `Mark ${action.title} completed` }));
    expect(actions.updateSavingAction).toHaveBeenCalledWith('a1', { status: 'completed' });
  });
});
