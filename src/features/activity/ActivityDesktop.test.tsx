import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';
import { ToastProvider } from '@/ui';
import { makeAccount, makeStatement, makeTxn } from './testUtils';

const mocks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useTransaction: vi.fn(),
}));

vi.mock('@/app/period', () => ({
  usePeriod: () => ({ period: { preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' }, setCustom: vi.fn() }),
}));
vi.mock('@/db/hooks', () => ({
  useLedger: mocks.useLedger,
  useTransaction: mocks.useTransaction,
  useRules: () => [],
  useSettings: () => ({ p2pReviewThreshold: 500_000 }),
}));
vi.mock('@/db/actions', () => ({}));
vi.mock('@/engine/analytics', () => ({
  applyQuery: (t: Transaction[]) => t,
  summarize: () => ({ spending: 0, income: 0 }),
}));
vi.mock('@/engine/understand', () => ({ reviewPriority: () => [], suggestCategories: () => [] }));

import ActivityPage from './ActivityPage';

function Probe() {
  return <output data-testid="loc">{useLocation().search}</output>;
}

function setup(path = '/activity') {
  const rows = Array.from({ length: 150 }, (_, i) => makeTxn({ id: `r${i}`, merchant: `Shop ${i}`, merchantKey: `shop ${i}` }));
  mocks.useLedger.mockReturnValue({ ready: true, accounts: [makeAccount()], statements: [makeStatement()], transactions: rows, customCategories: [] });
  mocks.useTransaction.mockImplementation((id?: string) => rows.find((r) => r.id === id));
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <ActivityPage />
        <Probe />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function stubWidth(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: desktop && query.includes('1024'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Activity on a wide screen', () => {
  it('shows the list and the detail side by side instead of a sheet, and Esc closes the detail', async () => {
    stubWidth(true);
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('complementary', { name: 'Transaction details' })).toHaveTextContent('Select a transaction');

    await user.click(screen.getAllByTestId('txn-row')[1]);
    expect(screen.getByTestId('loc')).toHaveTextContent('txn=r1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Transaction details' })).toHaveTextContent('Shop 1');
    expect(screen.getAllByTestId('txn-row')).toHaveLength(60); // the list stays put beside it

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('loc')).not.toHaveTextContent('txn=');
  });

  it('uses a sheet on a phone-sized screen', () => {
    stubWidth(false);
    setup('/activity?txn=r2');
    expect(screen.queryByRole('complementary', { name: 'Transaction details' })).not.toBeInTheDocument();
  });

  it('supports j / k / Enter, / for search and ? for the shortcut help', async () => {
    stubWidth(true);
    const user = userEvent.setup();
    setup();

    await user.keyboard('j');
    await user.keyboard('j');
    await user.keyboard('k');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('loc')).toHaveTextContent('txn=r0'); // j, j, k lands on the first row again... then Enter opens it

    await user.keyboard('/');
    expect(screen.getByRole('searchbox', { name: /search transactions/i })).toHaveFocus();
    // Typing j in the search box must not move the cursor or open anything else.
    await user.keyboard('j');
    expect(screen.getByRole('searchbox', { name: /search transactions/i })).toHaveValue('j');

    await user.click(document.body);
    expect(screen.getByRole('tooltip', { hidden: true })).not.toBeVisible();
    await user.keyboard('?');
    expect(screen.getByRole('tooltip')).toBeVisible();
    expect(screen.getByText('Next / previous transaction')).toBeInTheDocument();
  });

  it('j past the rendered rows renders more of the list', async () => {
    stubWidth(true);
    const user = userEvent.setup();
    setup();
    for (let i = 0; i < 60; i++) await user.keyboard('j');
    expect(screen.getAllByTestId('txn-row').length).toBeGreaterThan(60);
  });
});

describe('Activity remembers where you were', () => {
  it('restores the list length and scroll position after coming back', async () => {
    stubWidth(false);
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const key = 'vm-activity-view:' + JSON.stringify({ q: '', accountId: '', category: '', kind: '', review: false, ids: [] }) + '|2025-09-01|2025-09-30';
    sessionStorage.setItem(key, JSON.stringify({ y: 1234, visible: 120 }));
    setup();
    expect(screen.getAllByTestId('txn-row')).toHaveLength(120);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 1234));
  });

  it('saves the view when leaving', () => {
    stubWidth(false);
    vi.stubGlobal('scrollY', 500);
    const view = setup();
    view.unmount();
    const entry = Object.keys(sessionStorage).find((k) => k.startsWith('vm-activity-view:'));
    expect(entry).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem(entry!)!)).toEqual({ y: 500, visible: 60 });
  });
});
