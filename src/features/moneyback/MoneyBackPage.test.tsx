import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundCase } from '@/domain/types';
import type { MoneyBack, MoneyBackCase } from '@/engine/analytics';
import { ToastProvider } from '@/ui';
import { makeAccount, makeStatement, makeTxn } from '../activity/testUtils';

const mocks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useRefundCases: vi.fn(),
  useRefundAllocations: vi.fn(),
  moneyBack: vi.fn(),
  allocateCredit: vi.fn(),
  createRefundCase: vi.fn(),
  updateRefundCase: vi.fn(),
  closeRefundCase: vi.fn(),
  reopenRefundCase: vi.fn(),
}));
vi.mock('@/app/period', () => ({ usePeriod: () => ({ period: { preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' } }) }));
vi.mock('@/db/hooks', () => ({ useLedger: mocks.useLedger }));
vi.mock('@/db/moneyback', () => ({
  useRefundCases: mocks.useRefundCases,
  useRefundAllocations: mocks.useRefundAllocations,
  allocateCredit: mocks.allocateCredit,
  createRefundCase: mocks.createRefundCase,
  updateRefundCase: mocks.updateRefundCase,
  closeRefundCase: mocks.closeRefundCase,
  reopenRefundCase: mocks.reopenRefundCase,
}));
vi.mock('@/engine/analytics', () => ({ moneyBack: mocks.moneyBack }));

import MoneyBackPage from './MoneyBackPage';

const purchase = makeTxn({ id: 'P1', merchant: 'Gadget Hub', amount: 100_000, date: '2025-09-02', reference: 'REF123' });
const rawCase = (id: string, merchant: string): RefundCase => ({
  id,
  purchaseTxnIds: ['P1'],
  merchant,
  merchantKey: merchant.toLowerCase(),
  expectedSource: 'user',
  state: 'open',
  createdAt: '2025-09-03T00:00:00.000Z',
  updatedAt: '2025-09-03T00:00:00.000Z',
});
const mbCase = (over: Partial<MoneyBackCase> & { id: string; merchant: string }): MoneyBackCase => ({
  case: rawCase(over.id, over.merchant),
  purchases: [{ txnId: 'P1', date: '2025-09-02', amount: 100_000, merchant: over.merchant }],
  purchaseTotal: 100_000,
  received: 0,
  status: 'expected',
  ageDays: 12,
  overdue: false,
  timeline: [{ date: '2025-09-02', kind: 'purchase', text: 'Purchase', amount: 100_000 }],
  ...over,
});

const partial = mbCase({
  id: 'A',
  merchant: 'Gadget Hub',
  expected: 100_000,
  received: 40_000,
  outstanding: 60_000,
  status: 'partially_received',
  overdue: true,
  timeline: [
    { date: '2025-09-02', kind: 'purchase', text: 'Purchase', amount: 100_000 },
    { date: '2025-09-10', kind: 'credit', text: 'Credit received', amount: 40_000, txnId: 'C1' },
  ],
});
partial.case.promisedDate = '2025-09-15';
const unknown = mbCase({ id: 'B', merchant: 'Mystery Store', status: 'amount_to_confirm' });

const DATA: MoneyBack = {
  received: [{ creditTxnId: 'C1', date: '2025-09-10', amount: 40_000, allocated: 40_000, unallocated: 0, merchant: 'Gadget Hub', caseIds: ['A'] }],
  cases: [partial, unknown],
  needsMatching: [{ creditTxnId: 'C2', date: '2025-09-12', amount: 25_000, merchant: 'Some Refund', candidatePurchaseIds: ['P1'] }],
  totals: { receivedInPeriod: 40_000, expectedOutstanding: 60_000, openCases: 2, amountToConfirm: 1 },
};

function renderAt(url = '/money-back') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <MoneyBackPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  mocks.useLedger.mockReturnValue({
    ready: true,
    accounts: [makeAccount()],
    statements: [makeStatement({ periodEnd: '2025-09-20' })],
    transactions: [purchase],
    customCategories: [],
  });
  mocks.useRefundCases.mockReturnValue([partial.case, unknown.case]);
  mocks.useRefundAllocations.mockReturnValue([]);
  mocks.moneyBack.mockReturnValue(DATA);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('MoneyBackPage', () => {
  it('shows expected refunds with honest status: no percentage or bar when the amount is unknown', () => {
    renderAt();
    const table = screen.getByRole('table', { name: 'Refunds you are tracking' });
    const known = within(table).getByText('Gadget Hub').closest('tr') as HTMLElement;
    const unsure = within(table).getByText('Mystery Store').closest('tr') as HTMLElement;
    expect(within(known).getByText('Partly received')).toBeInTheDocument();
    expect(within(known).getByRole('progressbar', { name: /Refund received for Gadget Hub/ })).toHaveAttribute('aria-valuenow', '40');
    expect(within(known).getByText(/Overdue: promised by/)).toBeInTheDocument();
    expect(within(unsure).getByText('Amount to confirm')).toBeInTheDocument();
    expect(within(unsure).getByText('Needs confirmation')).toBeInTheDocument();
    expect(within(unsure).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(unsure).queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(/Data through 20 Sept? 2025|Data through 20 Sep 2025/)).toBeInTheDocument();
    expect(screen.getByText(/No matching credit found in these statements/)).toBeInTheDocument();
  });

  it('explains the two ways of counting and switches the received list', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByText(/refund counts in the period when the credit posted/i)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Received/ }));
    expect(screen.getByRole('list', { name: 'Credits received' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Purchase' }));
    expect(screen.getByText(/each refund reduces the purchase it belongs to/i)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Refunds you are tracking' })).toBeInTheDocument();
  });

  it('matches a credit, refuses more than is left of it, and shows the error from the ledger', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('tab', { name: /Needs matching/ }));
    await user.click(screen.getByRole('button', { name: 'Match this credit' }));
    const sheet = await screen.findByRole('dialog');
    await user.selectOptions(within(sheet).getByLabelText('Which refund is it for?'), 'A');

    await user.type(within(sheet).getByLabelText(/How much of this credit/), '500');
    expect(within(sheet).getByText(/more than is left of this credit/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Match' })).toBeDisabled();

    await user.clear(within(sheet).getByLabelText(/How much of this credit/));
    await user.type(within(sheet).getByLabelText(/How much of this credit/), '100');
    mocks.allocateCredit.mockRejectedValueOnce(new Error('This credit is already fully allocated.'));
    await user.click(within(sheet).getByRole('button', { name: 'Match' }));
    expect(await within(sheet).findByText('This credit is already fully allocated.')).toBeInTheDocument();

    mocks.allocateCredit.mockResolvedValueOnce({});
    await user.click(within(sheet).getByRole('button', { name: 'Match' }));
    expect(mocks.allocateCredit).toHaveBeenLastCalledWith({ caseId: 'A', creditTxnId: 'C2', amount: 10_000, purchaseTxnId: undefined });
  });

  it('opens a case with its timeline and saves a corrected amount, promised date and closing', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Gadget Hub' }));
    const sheet = await screen.findByRole('dialog');
    const timeline = within(sheet).getByRole('region', { name: 'Timeline' });
    expect(timeline).toHaveTextContent('Purchase');
    expect(timeline).toHaveTextContent('Credit received');

    await user.type(within(sheet).getByLabelText(/Correct the expected amount/), '1,250');
    await user.click(within(sheet).getAllByRole('button', { name: 'Save' })[0]);
    expect(mocks.updateRefundCase).toHaveBeenCalledWith('A', { expectedAmount: 125_000, expectedSource: 'user' });

    await user.click(within(sheet).getByRole('button', { name: 'Close case' }));
    expect(mocks.closeRefundCase).toHaveBeenCalledWith('A', 'received');
  });

  it('prepares follow-up details from the ledger and copies them, with a manual fallback', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Gadget Hub' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Prepare follow-up details' }));
    const text = within(sheet).getByLabelText('Follow-up text') as HTMLTextAreaElement;
    expect(text.value).toContain('Gadget Hub');
    expect(text.value).toContain('reference REF123');
    expect(text.value).toContain('Still outstanding');
    await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(text.value);
    expect(await within(sheet).findByText('Copied.')).toBeInTheDocument();

    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(false);
    await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(await within(sheet).findByText(/Select the text above and copy it/)).toBeInTheDocument();
  });

  it('tracks a refund for a purchase passed from a transaction, leaving the amount to confirm', async () => {
    const user = userEvent.setup();
    mocks.createRefundCase.mockResolvedValue({});
    renderAt('/money-back?track=P1');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Gadget Hub')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Track this refund' }));
    await waitFor(() => expect(mocks.createRefundCase).toHaveBeenCalledWith({ purchaseTxnIds: ['P1'], expectedAmount: undefined, reason: undefined, promisedDate: undefined }));
  });

  it('opens the matching sheet for a credit passed from a transaction', async () => {
    renderAt('/money-back?match=C2');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Some Refund/)).toBeInTheDocument();
  });
});
