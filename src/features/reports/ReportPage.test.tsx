import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';
import { makeAccount, makeStatement, makeTxn } from '../activity/testUtils';

const mocks = vi.hoisted(() => ({
  usePeriod: vi.fn(),
  useLedger: vi.fn(),
  useRecurringDecisions: vi.fn(),
  applyQuery: vi.fn(),
  summarize: vi.fn(),
  monthlySeries: vi.fn(),
  detectRecurring: vi.fn(),
}));

vi.mock('@/app/period', () => ({ usePeriod: mocks.usePeriod }));
vi.mock('@/db/hooks', () => ({ useLedger: mocks.useLedger, useRecurringDecisions: mocks.useRecurringDecisions }));
vi.mock('@/engine/analytics', () => ({
  applyQuery: mocks.applyQuery,
  summarize: mocks.summarize,
  monthlySeries: mocks.monthlySeries,
  detectRecurring: mocks.detectRecurring,
}));

import ReportPage from './ReportPage';

const XSS = '<img src=x onerror=alert(1)>';

const SUMMARY = {
  income: 5_000_000,
  spending: 1_234_500,
  refunds: 0,
  invested: 100_000,
  netSavings: 3_765_500,
  savingsRate: 75.3,
  peopleIn: 0,
  peopleOut: 0,
  neutral: { selfTransfers: 0, cardPayments: 0, reversals: 0, loanReceived: 0 },
  cashFlow: { inflow: 0, outflow: 0, net: 0 },
  byCategory: [{ category: 'groceries', group: 'essentials', amount: 1_234_500, count: 4, share: 1 }],
  byGroup: [{ group: 'essentials', amount: 1_234_500, share: 1 }],
  counts: { total: 4, needsReview: 1, debits: 4, credits: 0 },
  coverage: { complete: false, notes: ['Demo Savings has no statement for 1-14 Sep'], accounts: [], incomeCoverage: 'partial' },
};

function ledger(transactions: Transaction[]) {
  return { ready: true, accounts: [makeAccount()], statements: [makeStatement()], transactions, customCategories: [] };
}

function period(start: string, end: string, label: string) {
  return { period: { preset: 'custom', start, end, label }, setPreset: vi.fn(), setCustom: vi.fn(), stepMonth: vi.fn() };
}

beforeEach(() => {
  mocks.usePeriod.mockReturnValue(period('2025-09-01', '2025-09-30', 'September 2025'));
  mocks.applyQuery.mockImplementation((t: Transaction[]) => t);
  mocks.summarize.mockReturnValue(SUMMARY);
  mocks.monthlySeries.mockReturnValue([
    { month: '2025-09', income: 5_000_000, spending: 1_234_500, invested: 0, netSavings: 3_765_500, complete: false },
  ]);
  mocks.useRecurringDecisions.mockReturnValue([]);
  mocks.detectRecurring.mockReturnValue([]);
});
afterEach(() => vi.clearAllMocks());

const tree = () => (
  <MemoryRouter>
    <ReportPage />
  </MemoryRouter>
);

describe('ReportPage', () => {
  it('renders hostile statement text as plain text, never as markup', () => {
    mocks.useLedger.mockReturnValue(
      ledger([makeTxn({ merchant: XSS, rawDescription: XSS, amount: 900_000 }), makeTxn({ merchant: 'Safe Shop', rawDescription: `UPI/${XSS}` })]),
    );
    const { container } = render(tree());

    expect(screen.getAllByText(XSS).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('shows period, coverage warning, KPIs, tables and the largest expense first', () => {
    mocks.useLedger.mockReturnValue(
      ledger([
        makeTxn({ merchant: 'Small', amount: 1_000 }),
        makeTxn({ merchant: 'Big', amount: 900_000 }),
        makeTxn({ merchant: 'Salary', direction: 'credit', kind: 'income', amount: 5_000_000 }),
      ]),
    );
    render(tree());

    expect(screen.getAllByText(/September 2025/).length).toBeGreaterThan(0);
    expect(screen.getByText('Demo Savings has no statement for 1-14 Sep')).toBeInTheDocument();
    expect(screen.getByText('75.3%')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Spending by category' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Spending by group' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Month by month' })).toBeInTheDocument();
    const top = screen.getByRole('table', { name: 'Ten largest expenses' });
    const rows = within(top).getAllByRole('row');
    expect(within(rows[1]).getByText('Big')).toBeInTheDocument();
    expect(within(top).queryByText('Salary')).not.toBeInTheDocument(); // income is not an expense
  });

  it('lists only confirmed recurring commitments', () => {
    mocks.useLedger.mockReturnValue(ledger([makeTxn()]));
    const series = (merchant: string, status: 'confirmed' | 'suggested') => ({
      merchantKey: merchant,
      merchant,
      category: 'subscriptions',
      cadence: 'monthly',
      intervalDays: 30,
      typicalAmount: 19_900,
      monthlyCost: 19_900,
      occurrences: 4,
      lastDate: '2025-09-05',
      nextExpected: '2025-10-05',
      confidence: 0.9,
      status,
      txnIds: [],
      overdue: false,
    });
    mocks.detectRecurring.mockReturnValue([series('Streamly', 'confirmed'), series('Maybe Co', 'suggested')]);
    render(tree());
    const table = screen.getByRole('table', { name: 'Confirmed recurring commitments' });
    expect(within(table).getByText('Streamly')).toBeInTheDocument();
    expect(within(table).queryByText('Maybe Co')).not.toBeInTheDocument();
  });

  it('recomputes for the current period on every render (no stale report)', () => {
    mocks.useLedger.mockReturnValue(ledger([makeTxn()]));
    const { rerender } = render(tree());
    expect(mocks.applyQuery).toHaveBeenLastCalledWith(expect.anything(), { start: '2025-09-01', end: '2025-09-30' });

    mocks.usePeriod.mockReturnValue(period('2025-08-01', '2025-08-31', 'August 2025'));
    rerender(tree());
    expect(mocks.applyQuery).toHaveBeenLastCalledWith(expect.anything(), { start: '2025-08-01', end: '2025-08-31' });
    expect(screen.getByText(/August 2025/)).toBeInTheDocument();
  });

  it('prints through the browser and hides its controls from print output', async () => {
    mocks.useLedger.mockReturnValue(ledger([makeTxn()]));
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { container } = render(tree());
    await userEvent.click(screen.getByRole('button', { name: /print \/ save as pdf/i }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-print-hide]')).not.toBeNull();
    expect(screen.getByRole('link', { name: /back to overview/i })).toHaveAttribute('href', '/');
    print.mockRestore();
  });
});
