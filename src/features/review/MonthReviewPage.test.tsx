import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';
import type { Insight, MonthReviewData } from '@/engine/analytics';
import { ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useBudgets: vi.fn(),
  useSavingActions: vi.fn(),
  useGoals: vi.fn(),
  useGoalContributions: vi.fn(),
  useRecurringDecisions: vi.fn(),
}));
vi.mock('@/db/hooks', () => hooks);

const review = vi.hoisted(() => ({
  useInsightFeedback: vi.fn(),
  useMonthReviews: vi.fn(),
  saveMonthReview: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined)),
  setTransactionsTag: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined)),
  recordInsightFeedback: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(undefined)),
}));
vi.mock('@/db/review', () => review);

const actions = vi.hoisted(() => ({ createSavingAction: vi.fn() }));
vi.mock('@/db/actions', () => actions);

const analytics = vi.hoisted(() => ({ monthReviewData: vi.fn(), dataStatus: vi.fn() }));
vi.mock('@/engine/analytics', () => analytics);

import MonthReviewPage from './MonthReviewPage';

const suggestion: Insight = {
  id: 'ins-food',
  key: 'category_change:food',
  type: 'category_change',
  severity: 'warning',
  title: 'Food & dining is up',
  body: 'Food spending rose.',
  evidence: { txnIds: [], figures: [] },
  action: { type: 'category_limit', label: 'Keep Food near ₹12,000', category: 'food_dining', suggestedTarget: 1_200_000 },
  estimatedMonthlySaving: 300_000,
};

const data = (over: Partial<MonthReviewData> = {}): MonthReviewData => ({
  month: '2025-09',
  readiness: { coverageComplete: false, missing: ['No Demo Bank savings statement covers 15-30 Sep 2025'], needsReview: 3, extractionIssues: 2 },
  changes: {
    comparison: { comparable: true, note: undefined } as never,
    merchants: [
      {
        merchantKey: 'cafe',
        merchant: 'Demo Cafe',
        category: 'food_dining',
        delta: 250_000,
        sentence: 'You ordered more often.',
        txnIdsCurrent: ['t1', 't2'],
        txnIdsPrevious: [],
      } as never,
    ],
    headline: 'You spent ₹3,200 more than in August, mostly on food.',
    comparable: true,
  },
  tagged: { total: 0, byTag: {}, txnIds: [] },
  expectedInsightIds: [],
  actions: [
    {
      action: { id: 'a1', type: 'category_limit', title: 'Keep Travel low', baselineMonthly: 500_000, targetMonthly: 300_000, startMonth: '2025-09', status: 'active', createdAt: '', updatedAt: '' },
      monthsEvaluated: [],
      actualMonthly: null,
      achievedMonthlySaving: null,
      state: 'waiting_for_data',
      txnIds: [],
    },
  ],
  budgets: [
    {
      budget: { id: 'b1', category: 'groceries', monthlyLimit: 1_000_000, createdAt: '', updatedAt: '' },
      month: '2025-09',
      spent: 960_000,
      remaining: 40_000,
      usage: 0.96,
      state: 'watch',
      coverageComplete: true,
      txnIds: [],
    },
  ],
  uncertain: ['Spending from 15-30 Sep may be missing.'],
  suggestions: [suggestion],
  ...over,
});

const bigTxn = { id: 'big1', merchant: 'Demo Resort', rawDescription: 'RESORT', date: '2025-09-12', amount: 900_000, direction: 'debit', kind: 'expense' } as Transaction;

function setup(opts: { reviews?: unknown[]; d?: MonthReviewData; path?: string } = {}) {
  hooks.useLedger.mockReturnValue({ ready: true, accounts: [], statements: [], transactions: [bigTxn], customCategories: [] });
  hooks.useBudgets.mockReturnValue([]);
  hooks.useSavingActions.mockReturnValue([]);
  hooks.useGoals.mockReturnValue([]);
  hooks.useGoalContributions.mockReturnValue([]);
  hooks.useRecurringDecisions.mockReturnValue([]);
  review.useInsightFeedback.mockReturnValue([]);
  review.useMonthReviews.mockReturnValue(opts.reviews ?? []);
  analytics.monthReviewData.mockReturnValue(opts.d ?? data());
  analytics.dataStatus.mockReturnValue({ latestCompleteMonth: '2025-09' });
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[opts.path ?? '/review?month=2025-09']}>
        <MonthReviewPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Next/ }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Month-end review', () => {
  it('starts with a five-step stepper and the missing-statement sentences with an import link', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Review steps' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(5);
    expect(within(nav).getByRole('button', { name: /Imports/ })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('No Demo Bank savings statement covers 15-30 Sep 2025')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import a statement' })).toHaveAttribute('href', '/import');
  });

  it('puts extraction issues before category review in step 2', async () => {
    const user = userEvent.setup();
    setup();
    await next(user);
    const issues = screen.getByText(/2 rows have an amount or direction we could not verify/);
    const cats = screen.getByText(/3 transactions need a category or type/);
    expect(issues.compareDocumentPosition(cats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Check them in Activity|Review them/ })[0]).toHaveAttribute('href', '/activity?review=1');
    // progress is saved so the review can be resumed
    expect(review.saveMonthReview).toHaveBeenCalledWith(expect.objectContaining({ month: '2025-09', status: 'in_progress' }));
  });

  it('step 3 shows the headline, drivers, tagging and "Expected" on insights', async () => {
    review.setTransactionsTag.mockResolvedValue(undefined);
    review.recordInsightFeedback.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ path: '/review?month=2025-09&step=3' });
    expect(screen.getByText(/spent ₹3,200 more than in August/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compare in detail in Explore' })).toHaveAttribute('href', '/explore?view=compare');
    await user.click(within(screen.getByRole('group', { name: 'Label Demo Resort' })).getByRole('button', { name: 'Exceptional' }));
    expect(review.setTransactionsTag).toHaveBeenCalledWith(['big1'], 'exceptional');
    await user.click(screen.getByRole('button', { name: /^Expected/ }));
    expect(review.recordInsightFeedback).toHaveBeenCalledWith({ key: 'category_change:food', insightId: 'ins-food', action: 'expected' });
  });

  it('step 4 shows budgets and last month\'s adjustments with stage labels, without claiming credit', () => {
    setup({ path: '/review?month=2025-09&step=4' });
    expect(screen.getByRole('meter', { name: 'Groceries budget' })).toBeInTheDocument();
    expect(screen.getByText('1 · Opportunity')).toBeInTheDocument();
    expect(screen.getByText('2 · Planned adjustment')).toBeInTheDocument();
    expect(screen.getByText('3 · Recorded result')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a full month of data')).toBeInTheDocument();
  });

  it('step 5 plans a suggestion, then Finish saves a completed review and shows the summary', async () => {
    actions.createSavingAction.mockResolvedValue({ id: 'new1' });
    review.saveMonthReview.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ path: '/review?month=2025-09&step=5' });
    expect(screen.getByRole('link', { name: 'Open the scenario editor' })).toHaveAttribute('href', '/plan?tab=budgets&scenario=1');
    await user.click(screen.getByRole('button', { name: /Plan this adjustment/ }));
    expect(actions.createSavingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'category_limit', category: 'food_dining', targetMonthly: 1_200_000, baselineMonthly: 1_500_000, startMonth: '2025-10', status: 'active', insightId: 'ins-food' }),
    );
    await user.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(review.saveMonthReview).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2025-09', status: 'completed', nextActionIds: ['new1'] }));
    expect(await screen.findByText('September 2025 review complete')).toBeInTheDocument();
    for (const t of ['What changed', 'What you expected', 'Adjustments followed', 'What remains uncertain', "Next month's choice"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText('Keep Food near ₹12,000')).toBeInTheDocument();
  });

  it('resumes at the saved step and shows the summary for an already completed month', () => {
    localStorage.setItem('vm-review-step-2025-09', '3');
    const { unmount } = setup({ reviews: [{ month: '2025-09', status: 'in_progress', notes: [], nextActionIds: [], updatedAt: '' }] });
    expect(screen.getByRole('button', { name: /Plan/ , current: 'step' })).toBeInTheDocument();
    unmount();
    setup({ reviews: [{ month: '2025-09', status: 'completed', notes: [], nextActionIds: ['x'], updatedAt: '' }] });
    expect(screen.getByText('September 2025 review complete')).toBeInTheDocument();
  });
});
