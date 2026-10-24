import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardCycle, CoverageCell } from '@/engine/analytics';
import { formatDate } from '@/lib/dates';
import { ToastProvider } from '@/ui';
import { makeAccount, makeStatement, makeTxn } from '../activity/testUtils';

const mocks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  coverageGrid: vi.fn(),
  cardCycles: vi.fn(),
  deleteStatement: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock('@/db/hooks', () => ({ useLedger: mocks.useLedger }));
vi.mock('@/engine/analytics', () => ({ coverageGrid: mocks.coverageGrid, cardCycles: mocks.cardCycles }));
vi.mock('@/engine/import', () => ({ deleteStatement: mocks.deleteStatement }));
vi.mock('@/db/actions', () => ({ updateAccount: mocks.updateAccount, deleteAccount: mocks.deleteAccount }));

import AccountDetailPage from './AccountDetailPage';
import AccountsPage from './AccountsPage';

const bank = makeAccount({ id: 'bank1', name: 'Demo Savings ••1234', type: 'savings' });
const card = makeAccount({ id: 'card1', name: 'Demo Card ••9999', type: 'credit_card', mask: '9999' });

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const cell = (accountId: string, month: string, state: CoverageCell['state']): CoverageCell => ({
  accountId,
  month,
  state,
  coveredDays: 0,
  totalDays: 30,
  statementIds: [],
});

beforeEach(() => {
  mocks.useLedger.mockReturnValue({
    ready: true,
    accounts: [bank, card],
    statements: [
      makeStatement({ id: 's1', accountId: 'bank1', periodStart: '2025-08-01', periodEnd: '2025-08-31', rowCount: 12, fileName: 'aug.pdf' }),
      makeStatement({
        id: 's2',
        accountId: 'bank1',
        periodStart: '2025-09-01',
        periodEnd: '2025-09-30',
        rowCount: 9,
        fileName: 'sep.pdf',
        reconciliation: { status: 'mismatch', checks: [], rowBalanceBreaks: 1 },
      }),
    ],
    transactions: [
      makeTxn({ accountId: 'bank1', needsReview: true }),
      makeTxn({ accountId: 'bank1', needsReview: true }),
      makeTxn({ accountId: 'card1' }),
    ],
    customCategories: [],
  });
  mocks.coverageGrid.mockImplementation((accounts: { id: string }[], _s: unknown, months: string[]) =>
    accounts.flatMap((a) => months.map((m, i) => cell(a.id, m, i === months.length - 1 ? 'partial' : i === 0 ? 'before_tracking' : 'full'))),
  );
});
afterEach(() => vi.clearAllMocks());

describe('AccountsPage', () => {
  it('groups accounts, shows data-through and review counts, and links an import action', () => {
    renderAt('/accounts');
    const banks = screen.getByRole('region', { name: 'Bank accounts' });
    expect(within(banks).getByText('Demo Savings ••1234')).toBeInTheDocument();
    expect(within(banks).getByText(new RegExp('Data through ' + formatDate('2025-09-30')))).toBeInTheDocument();
    expect(within(banks).getByText('2 to review')).toBeInTheDocument();
    const cards = screen.getByRole('region', { name: 'Credit cards' });
    expect(within(cards).getByText(/No statements yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /import/i })[0]).toHaveAttribute('href', '/import');
  });

  it('shows a coverage grid with a legend and opens the account when a month is tapped', async () => {
    const user = userEvent.setup();
    renderAt('/accounts');
    const grid = screen.getByRole('table', { name: /statement coverage/i });
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem')).toHaveLength(4);
    const partial = within(grid).getAllByRole('button', { name: /Demo Savings ••1234, .*Part of the month imported/ });
    await user.click(partial[0]);
    expect(screen.getByTestId('where')).toHaveTextContent('/accounts/bank1');
  });
});

describe('AccountDetailPage', () => {
  it('lists statements with reconciliation badges and deletes one only after confirming', async () => {
    const user = userEvent.setup();
    renderAt('/accounts/bank1');
    expect(screen.getByText('Totals do not match')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Statement cycles' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete statement sep.pdf' }));
    expect(mocks.deleteStatement).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete statement' }));
    expect(mocks.deleteStatement).toHaveBeenCalledWith('s2');
  });

  it('shows card cycles with payment status, matched repayments and the cycle-vs-month note', () => {
    const cycle: CardCycle = {
      statementId: 'cs1',
      periodStart: '2025-06-21',
      periodEnd: '2025-07-20',
      statementDate: '2025-07-20',
      dueDate: '2025-08-07',
      totalDue: 1_250_000,
      minimumDue: 62_500,
      purchases: 1_300_000,
      refunds: 20_000,
      fees: 0,
      interest: 0,
      payments: 30_000,
      matchedRepayments: [{ txnId: 'bank-leg', amount: 1_250_000, date: '2025-08-05' }],
      paymentStatus: 'unknown',
      txnIds: ['a', 'b'],
    };
    mocks.cardCycles.mockReturnValue([cycle]);
    renderAt('/accounts/card1');
    const region = screen.getByRole('region', { name: 'Statement cycles' });
    expect(within(region).getByText('Not confirmed yet')).toBeInTheDocument();
    expect(within(region).getByText(/This cycle runs 21 Jun – 20 Jul, so “July” on Overview includes part of it/)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'See the bank payment' })).toHaveAttribute('href', '/activity?txn=bank-leg');
    expect(within(region).getByText('Minimum due')).toBeInTheDocument();
    expect(mocks.cardCycles).toHaveBeenCalledWith(card, expect.anything(), expect.anything(), expect.any(String));
  });

  it('says so when the account does not exist', () => {
    renderAt('/accounts/nope');
    expect(screen.getByText('Account not found')).toBeInTheDocument();
  });
});
