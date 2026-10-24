import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Transaction } from '@/domain/types';
import { PrivacyContext, ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({ useLedger: vi.fn() }));
vi.mock('@/db/hooks', () => hooks);
vi.mock('@/app/period', () => ({
  usePeriod: () => ({
    period: { preset: 'last_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
    setCustom: vi.fn(),
  }),
}));

const analytics = vi.hoisted(() => ({
  applyQuery: vi.fn(),
  summarize: vi.fn(),
  monthlySeries: vi.fn(),
  compareSpending: vi.fn(),
  explainChange: vi.fn(),
  spendingCalendar: vi.fn(),
  merchantPareto: vi.fn(),
  moneyFlow: vi.fn(),
  dataStatus: vi.fn(() => ({ dataThrough: null })),
}));
vi.mock('@/engine/analytics', () => analytics);

import ExplorePage from './ExplorePage';
import { FLOW_DISCLAIMER } from './FlowView';

const account = { id: 'a1', name: 'ICICI Savings', institution: 'ICICI', type: 'savings', currency: 'INR', createdAt: '' } as Account;
const txn = (id: string, date: string, amount = 50_000): Transaction =>
  ({ id, date, amount, direction: 'debit', accountId: 'a1', kind: 'expense', category: 'food_dining', merchant: 'Swiggy', merchantKey: 'swiggy' }) as Transaction;
const txns = [txn('t1', '2025-09-03'), txn('t2', '2025-09-03', 20_000), txn('t3', '2025-09-10')];

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function renderAt(url: string, hideAmounts = false) {
  return render(
    <PrivacyContext.Provider value={{ hideAmounts }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <ExplorePage />
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </PrivacyContext.Provider>,
  );
}
const hrefOf = (el: Element) => el.getAttribute('href') ?? '';

const comparison = {
  current: { start: '2025-09-01', end: '2025-09-30', label: 'September', total: 5_000_000 },
  previous: { start: '2025-08-01', end: '2025-08-31', label: 'August', total: 4_000_000 },
  steps: [
    { key: 'food', label: 'Food & dining', category: 'food_dining', delta: 800_000, txnIdsCurrent: ['c1', 'c2'], txnIdsPrevious: ['p1'] },
    { key: 'travel', label: 'Travel & stays', category: 'travel', delta: -200_000, txnIdsCurrent: ['c3'], txnIdsPrevious: ['p2'] },
  ],
  other: 400_000,
  basis: 'Comparing September with August (both fully covered)',
  comparable: true,
};

const summaryFixture = {
  byCategory: [
    { category: 'food_dining', group: 'lifestyle', amount: 1_200_000, count: 12, share: 0.6 },
    { category: 'groceries', group: 'essentials', amount: 800_000, count: 8, share: 0.4 },
  ],
  byGroup: [
    { group: 'lifestyle', amount: 1_200_000, share: 0.6 },
    { group: 'essentials', amount: 800_000, share: 0.4 },
  ],
  coverage: { complete: true, notes: [] as string[] },
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useLedger.mockReturnValue({ ready: true, accounts: [account], statements: [], transactions: txns, customCategories: [] });
  analytics.applyQuery.mockImplementation((all: Transaction[]) => all);
  analytics.summarize.mockReturnValue(summaryFixture);
  analytics.monthlySeries.mockReturnValue([
    { month: '2025-07', income: 9_000_000, spending: 4_000_000, invested: 1_000_000, netSavings: 5_000_000, complete: true },
    { month: '2025-08', income: 9_000_000, spending: 5_000_000, invested: 500_000, netSavings: 4_000_000, complete: false },
    { month: '2025-09', income: 9_500_000, spending: 4_500_000, invested: 800_000, netSavings: 5_000_000, complete: true },
  ]);
  analytics.compareSpending.mockReturnValue(comparison);
  analytics.explainChange.mockImplementation((_t: unknown, ctx: { category?: string }) => ({
    comparison,
    comparable: true,
    headline: ctx.category ? 'Food & dining rose ₹8,000, mostly from Swiggy.' : 'Spending rose ₹10,000, mostly from Food & dining.',
    merchants: [
      {
        merchant: 'Swiggy',
        category: 'food_dining',
        current: { count: 10, total: 500_000, average: 50_000 },
        previous: { count: 4, total: 200_000, average: 50_000 },
        delta: 300_000,
        frequencyEffect: 210_000,
        sizeEffect: 30_000,
        driver: 'frequency',
        sentence: 'You ordered more often: 10 orders against 4.',
        txnIdsCurrent: ['c1'],
        txnIdsPrevious: ['p1'],
      },
    ],
    suggestedAction: { category: 'food_dining', suggestedTarget: 400_000, label: 'Set a limit for Food & dining' },
  }));
  analytics.spendingCalendar.mockReturnValue([
    { date: '2025-09-01', amount: 0, count: 0, covered: false },
    { date: '2025-09-02', amount: 0, count: 0, covered: true },
    { date: '2025-09-03', amount: 70_000, count: 2, covered: true },
    { date: '2025-09-04', amount: 0, count: 0, covered: true },
  ]);
  analytics.merchantPareto.mockReturnValue({
    rows: [
      { merchantKey: 'swiggy', merchant: 'Swiggy', category: 'food_dining', count: 5, total: 600_000, average: 120_000, lastDate: '2025-09-20', txnIds: ['t1', 't2'], cumulativeShare: 0.6 },
      { merchantKey: 'bigbasket', merchant: 'BigBasket', category: 'groceries', count: 3, total: 300_000, average: 100_000, lastDate: '2025-09-18', txnIds: ['t3'], cumulativeShare: 0.9 },
    ],
    total: 1_000_000,
    merchantsFor80: 2,
  });
  analytics.moneyFlow.mockImplementation((_t: unknown, ctx: { view: string }) => ({
    nodes: [
      { id: 'inc', label: 'Salary', kind: 'income' },
      { id: 'acc', label: 'ICICI Savings', kind: 'account' },
      { id: 'inv', label: 'Investments', kind: 'saving' },
    ],
    links: [
      { from: 'inc', to: 'acc', amount: 9_000_000 },
      { from: 'acc', to: 'inv', amount: 1_000_000 },
    ],
    note: ctx.view === 'transfers' ? 'Only moves between your own accounts and card bills.' : 'Recorded inflows only.',
  }));
});

describe('Explore: view switching', () => {
  it('opens on categories and keeps ?view= in sync as the segmented control changes', async () => {
    const user = userEvent.setup();
    renderAt('/explore');
    expect(await screen.findByRole('heading', { name: /Which categories took most/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Merchants' }));
    expect(await screen.findByRole('heading', { name: /Which merchants account for most/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/explore?view=merchants');
    await user.click(screen.getByRole('radio', { name: 'Patterns' }));
    expect(await screen.findByRole('heading', { name: /On which days/ })).toBeInTheDocument();
  });

  it.each([
    ['trends', 'Trends', /How do income, spending and investing compare/],
    ['compare', 'Compare', /Why did spending change between August and September/],
    ['flow', 'Money flow', /Where did the money that came in go/],
  ])('deep link ?view=%s opens that view', async (view, tab, heading) => {
    renderAt(`/explore?view=${view}`);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: tab })).toBeChecked();
  });

  it('falls back to categories for an unknown view', async () => {
    renderAt('/explore?view=bogus');
    expect(await screen.findByRole('heading', { name: /Which categories took most/ })).toBeInTheDocument();
  });

  it('shows an empty state with an import link when there is no data', async () => {
    hooks.useLedger.mockReturnValue({ ready: true, accounts: [], statements: [], transactions: [], customCategories: [] });
    renderAt('/explore');
    expect(await screen.findByText('Nothing to explore yet')).toBeInTheDocument();
    expect(hrefOf(screen.getByRole('link', { name: /Import a statement/ }))).toBe('/import');
  });
});

describe('Explore: categories', () => {
  it('ranks categories and every bar routes to its transactions; the donut is an alternative for broad groups', async () => {
    const user = userEvent.setup();
    renderAt('/explore?view=categories');
    const list = await screen.findByRole('list', { name: /Spending by category, largest first/ });
    const links = within(list).getAllByRole('link');
    expect(hrefOf(links[0])).toBe('/activity?category=food_dining');
    expect(hrefOf(links[1])).toBe('/activity?category=groceries');
    expect(screen.getByText(/took the most/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Broad groups' }));
    expect(screen.getByRole('img', { name: /Spending by broad group/ })).toBeInTheDocument();
  });

  it('marks the category from exploreLink', async () => {
    renderAt('/explore?view=categories&category=groceries');
    const list = await screen.findByRole('list', { name: /Spending by category/ });
    expect(within(list).getAllByRole('link')[1]).toHaveAttribute('aria-current', 'true');
  });

  it('flags incomplete coverage', async () => {
    analytics.summarize.mockReturnValue({ ...summaryFixture, coverage: { complete: false, notes: ['ICICI Savings has no statement for 1-14 Sep'] } });
    renderAt('/explore?view=categories');
    expect(await screen.findByText(/Incomplete data/)).toBeInTheDocument();
  });
});

describe('Explore: trends', () => {
  it('charts only complete months and says which were left out', async () => {
    renderAt('/explore?view=trends');
    expect(await screen.findByText(/Incomplete data/)).toBeInTheDocument();
    expect(screen.getByText(/Left out because statements do not cover the whole month: Aug/)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /August 2025/ });
    expect(within(row).getByText('Incomplete (not charted)')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /July 2025/ })).getByText('Complete')).toBeInTheDocument();
  });
});

describe('Explore: compare, why did spending change', () => {
  it('compares equivalent elapsed days when the month is only partly covered', async () => {
    analytics.dataStatus.mockReturnValueOnce({ dataThrough: '2025-09-24' } as never);
    renderAt('/explore?view=compare');
    await screen.findByText(/compares the same number of days/);
    expect(analytics.explainChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ current: { start: '2025-09-01', end: '2025-09-24' }, previous: { start: '2025-08-01', end: '2025-08-24' } }),
    );
  });

  it('walks headline, total change, waterfall, merchant drivers and planning actions, all linked', async () => {
    renderAt('/explore?view=compare');
    expect(await screen.findByText('Spending rose ₹10,000, mostly from Food & dining.')).toBeInTheDocument();
    expect(screen.getByText(/Total change/)).toBeInTheDocument();
    const wf = screen.getByRole('list', { name: /Waterfall/ });
    expect(hrefOf(within(wf).getByRole('link', { name: 'See transactions for Food & dining' }))).toBe('/activity?ids=c1%2Cc2%2Cp1');
    expect(hrefOf(within(wf).getByRole('link', { name: 'See transactions for Travel & stays' }))).toBe('/activity?ids=c3%2Cp2');
    const merchants = screen.getByRole('list', { name: /Merchants driving the change/ });
    expect(within(merchants).getByText('You ordered more often: 10 orders against 4.')).toBeInTheDocument();
    expect(within(merchants).getByText(/\+6 orders/)).toBeInTheDocument();
    expect(within(merchants).getByText(/larger orders/)).toBeInTheDocument();
    expect(hrefOf(within(merchants).getByRole('link'))).toBe('/activity?ids=c1%2Cp1');
    expect(hrefOf(screen.getByRole('link', { name: /Set a limit for Food & dining/ }))).toBe('/plan?tab=budgets&category=food_dining&target=400000');
    expect(hrefOf(screen.getByRole('link', { name: 'Try a scenario' }))).toBe('/plan?tab=budgets&scenario=1');
  });

  it('tapping a waterfall step focuses that category in explainChange', async () => {
    const user = userEvent.setup();
    renderAt('/explore?view=compare');
    const wf = await screen.findByRole('list', { name: /Waterfall/ });
    await user.click(within(wf).getByRole('button', { name: /Food & dining: up ₹8,000/ }));
    expect(analytics.explainChange).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ category: 'food_dining' }));
    expect(await screen.findByText('Food & dining rose ₹8,000, mostly from Swiggy.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Which Food & dining merchants changed most/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all categories' }));
    expect(analytics.explainChange).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ category: undefined }));
  });

  it('when the periods are not comparable it says so and gives no narrative, merchants or actions', async () => {
    const bad = { ...comparison, previous: { ...comparison.previous, total: 1_000_000 }, steps: [], other: 0, comparable: false, note: 'August has no statement for 1-20 Aug.' };
    analytics.compareSpending.mockReturnValue(bad);
    analytics.explainChange.mockReturnValue({ comparison: bad, comparable: false, headline: 'Should not show', merchants: [], suggestedAction: undefined });
    renderAt('/explore?view=compare');
    expect(await screen.findByText('Incomplete data.')).toBeInTheDocument();
    expect(screen.getAllByText(/August has no statement for 1-20 Aug/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Waterfall/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Try a scenario' })).not.toBeInTheDocument();
  });
});

describe('Explore: merchants', () => {
  it('shows the ranked list with cumulative share first and the 80% takeaway', async () => {
    const user = userEvent.setup();
    renderAt('/explore?view=merchants');
    expect(await screen.findByText(/2 merchants make up 80%/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /Merchants by spend/ });
    expect(within(list).getByText(/60% cumulative/)).toBeInTheDocument();
    expect(within(list).getByText(/90% cumulative · 80% reached/)).toBeInTheDocument();
    expect(hrefOf(within(list).getAllByRole('link')[0])).toBe('/activity?ids=t1%2Ct2');
    await user.click(screen.getByRole('radio', { name: 'Pareto chart' }));
    expect(screen.getByRole('img', { name: /Pareto chart/ })).toBeInTheDocument();
  });
});

describe('Explore: patterns heatmap', () => {
  it('draws days no statement covers differently from verified zero-spend days, and routes spend days to their transactions', async () => {
    const { container } = renderAt('/explore?view=patterns');
    await screen.findByRole('heading', { name: /On which days/ });
    const uncovered = container.querySelector('[data-day="2025-09-01"]')!;
    const zero = container.querySelector('[data-day="2025-09-02"]')!;
    const spend = container.querySelector('[data-day="2025-09-03"]')!;
    expect(uncovered).toHaveAttribute('data-state', 'uncovered');
    expect(uncovered.getAttribute('aria-label')).toMatch(/no statement covers this day, spending unknown/);
    expect(zero).toHaveAttribute('data-state', 'zero');
    expect(zero.getAttribute('aria-label')).toMatch(/verified ₹0 spent/);
    expect(uncovered.className).not.toBe(zero.className);
    expect(spend.tagName).toBe('A');
    expect(hrefOf(spend)).toBe('/activity?ids=t1%2Ct2');
    expect(screen.getByText(/1 day is not covered by any statement; they are hatched, not shown as ₹0/)).toBeInTheDocument();
  });
});

describe('Explore: money flow', () => {
  it('always states that flows do not prove which rupee paid for what, and offers the ranked list for phones', async () => {
    renderAt('/explore?view=flow');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(FLOW_DISCLAIMER);
    expect(note).toHaveTextContent('Recorded inflows only.');
    const list = screen.getByRole('list', { name: /Flows, largest first/ });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(hrefOf(within(list).getAllByRole('link')[1])).toBe('/activity?kind=investment');
  });

  it('has a separate transfers view with its own note', async () => {
    const user = userEvent.setup();
    renderAt('/explore?view=flow');
    await screen.findByRole('note');
    await user.click(screen.getByRole('radio', { name: 'Transfers' }));
    expect(analytics.moneyFlow).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ view: 'transfers' }));
    expect(await screen.findByRole('heading', { name: /How did money move between your own accounts/ })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(FLOW_DISCLAIMER);
    expect(screen.getByRole('note')).toHaveTextContent('Only moves between your own accounts');
  });
});

describe('Explore: hide amounts', () => {
  const rupee = /₹\s?[1-9][\d,]*/;
  it.each(['categories', 'trends', 'compare', 'merchants', 'patterns', 'flow'])('%s view shows no rupee value anywhere when amounts are hidden', async (view) => {
    const { container } = renderAt(`/explore?view=${view}`, true);
    await screen.findAllByRole("heading", { level: 2 });
    expect(container.textContent ?? '').not.toMatch(rupee);
    const labels = [...container.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') ?? '').join(' | ');
    expect(labels).not.toMatch(rupee);
  });

  it('shows the real values when amounts are visible (control)', async () => {
    const { container } = renderAt('/explore?view=categories', false);
    await screen.findAllByRole("heading", { level: 2 });
    expect(container.textContent).toMatch(rupee);
  });
});

describe('Explore: chart honesty', () => {
  it('month labels carry the year when the range spans years', async () => {
    analytics.monthlySeries.mockReturnValue([
      { month: '2024-12', income: 1, spending: 1, invested: 1, netSavings: 0, complete: false },
      { month: '2025-01', income: 1, spending: 1, invested: 1, netSavings: 0, complete: true },
    ]);
    renderAt('/explore?view=trends');
    expect(await screen.findByText(/Left out because statements do not cover the whole month: Dec 2024/)).toBeInTheDocument();
  });
});
