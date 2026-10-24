import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargeEvent, FeesSummary } from '@/engine/analytics';
import { ToastProvider } from '@/ui';
import { makeAccount, makeTxn } from '../activity/testUtils';

const mocks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useChargeLinks: vi.fn(),
  useCardPolicies: vi.fn(),
  feesSummary: vi.fn(),
  saveCardPolicy: vi.fn(),
  deleteCardPolicy: vi.fn(),
}));
vi.mock('@/app/period', () => ({ usePeriod: () => ({ period: { preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' } }) }));
vi.mock('@/db/hooks', () => ({ useLedger: mocks.useLedger }));
vi.mock('@/db/moneyback', () => ({
  useChargeLinks: mocks.useChargeLinks,
  useCardPolicies: mocks.useCardPolicies,
  saveCardPolicy: mocks.saveCardPolicy,
  deleteCardPolicy: mocks.deleteCardPolicy,
}));
vi.mock('@/engine/analytics', () => ({ feesSummary: mocks.feesSummary }));

import FeesPage from './FeesPage';

const card = makeAccount({ id: 'card1', name: 'Demo Card ••9999', type: 'credit_card' });
const fuel = makeTxn({ id: 'FUEL', merchant: 'Fuel Stop', amount: 200_000, date: '2025-09-05' });
const charge = makeTxn({ id: 'CH', accountId: 'card1', amount: 2_000, date: '2025-09-06', rawDescription: 'FUEL SURCHARGE', source: { page: 1, lineStart: 1, lineEnd: 1, rawLines: ['06-09-2025 FUEL SURCHARGE 20.00'] } });
const tax = makeTxn({ id: 'TX', accountId: 'card1', amount: 360, date: '2025-09-06', rawDescription: 'GST ON SURCHARGE' });

const event = (over: Partial<ChargeEvent>): ChargeEvent => ({
  groupId: 'g1',
  date: '2025-09-06',
  accountId: 'card1',
  chargeType: 'fuel_surcharge',
  charge: 2_000,
  tax: 360,
  reversed: 0,
  net: 2_360,
  relatedPurchaseTxnId: 'FUEL',
  txnIds: ['CH', 'TX'],
  status: 'not_reversed',
  eligibility: { state: 'likely', note: 'x', policyId: 'pol1' },
  explanation: 'A surcharge and the tax on it, posted a day after a fuel purchase.',
  ...over,
});

const SUMMARY: FeesSummary = {
  events: [
    event({}),
    event({ groupId: 'g2', chargeType: 'annual_fee', charge: 50_000, tax: 9_000, reversed: 59_000, net: 0, status: 'reversed', relatedPurchaseTxnId: undefined, txnIds: [], eligibility: { state: 'unknown', note: '' } }),
    event({ groupId: 'g3', chargeType: 'late_payment_fee', charge: 10_000, tax: 1_800, net: 11_800, status: 'not_reversed', relatedPurchaseTxnId: undefined, txnIds: [], eligibility: { state: 'unknown', note: '' } }),
  ],
  byMonth: [{ month: '2025-09', byType: { fuel_surcharge: 2_000, late_payment_fee: 10_000 }, net: 14_160 }],
  totals: { charged: 62_000, tax: 11_160, reversed: 59_000, net: 14_160 },
  recurring: [{ chargeType: 'fuel_surcharge', months: 3, total: 6_000 }],
};

const renderPage = (url = '/fees') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <FeesPage />
      </MemoryRouter>
    </ToastProvider>,
  );

beforeEach(() => {
  mocks.useLedger.mockReturnValue({ ready: true, accounts: [card], statements: [], transactions: [fuel, charge, tax], customCategories: [] });
  mocks.useChargeLinks.mockReturnValue([]);
  mocks.useCardPolicies.mockReturnValue([]);
  mocks.feesSummary.mockReturnValue(SUMMARY);
});
afterEach(() => vi.clearAllMocks());

describe('FeesPage', () => {
  it('lists every charge with charge, tax, reversed, net, related purchase and status', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Fees and charges' });
    for (const h of ['Date', 'Account', 'Type', 'Charge', 'Tax', 'Reversed', 'Net', 'Related purchase', 'Status']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const row = within(table).getByText('Fuel surcharge').closest('tr') as HTMLElement;
    expect(within(row).getByText('₹20.00')).toBeInTheDocument(); // paise are shown
    expect(within(row).getByText('₹3.60')).toBeInTheDocument();
    expect(within(row).getByText('₹23.60')).toBeInTheDocument();
    expect(within(row).getByText(/Fuel Stop, /)).toBeInTheDocument();
    expect(within(row).getByText('Not reversed')).toBeInTheDocument();
    expect(within(table).getByText('Annual fee').closest('tr')).toHaveTextContent('Reversed');
  });

  it('opens a charge with a waterfall, the statement rows and wording drawn only from recorded terms', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByRole('table', { name: 'Fees and charges' })).getAllByRole('button', { name: /6 Sep/ })[0]);
    const sheet = await screen.findByRole('dialog');
    const steps = within(sheet).getByRole('list', { name: 'How this charge adds up' });
    expect(steps).toHaveTextContent('Charge');
    expect(steps).toHaveTextContent('Tax on it');
    expect(steps).toHaveTextContent('Reversed');
    expect(steps).toHaveTextContent('What it cost');
    expect(within(sheet).getByRole('region', { name: 'Statement rows' })).toHaveTextContent('06-09-2025 FUEL SURCHARGE 20.00');
    expect(within(sheet).getByText('Might qualify for reversal under the terms you recorded. Check with your bank.')).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/per litre|price of fuel|fuel price/i);
  });

  it('without recorded terms it only says to check the card’s terms', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByRole('table', { name: 'Fees and charges' })).getByText('Late payment fee').closest('tr')!.querySelector('button')!);
    expect(await screen.findByText('Check your card’s terms.')).toBeInTheDocument();
  });

  it('opens the charge group for a transaction passed from Activity', async () => {
    renderPage('/fees?txn=TX');
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveTextContent('Fuel surcharge');
  });

  it('shows monthly bars with a table alternative, and recurring charges', () => {
    renderPage();
    expect(screen.getByRole('img', { name: /Stacked bars of charges by month/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charges by month and type' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Recurring charges' })).getByText(/in 3 months/)).toBeInTheDocument();
  });

  it('records card terms in rupees and saves them as paise', async () => {
    const user = userEvent.setup();
    mocks.saveCardPolicy.mockResolvedValue({});
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add card terms' }));
    const form = screen.getByRole('form', { name: 'Card terms form' });
    await user.type(within(form).getByLabelText(/What the terms say/), '1% waived on 400 to 4,000');
    await user.type(within(form).getByLabelText('Smallest purchase (₹)'), '400');
    await user.type(within(form).getByLabelText('Largest purchase (₹)'), '4,000');
    await user.type(within(form).getByLabelText('Cap per cycle (₹)'), '100');
    await user.click(within(form).getByRole('button', { name: 'Save terms' }));
    expect(mocks.saveCardPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'card1',
        chargeType: 'fuel_surcharge',
        summary: '1% waived on 400 to 4,000',
        waiverMinPurchase: 40_000,
        waiverMaxPurchase: 400_000,
        cycleCap: 10_000,
        taxReversed: null,
      }),
    );
  });
});
