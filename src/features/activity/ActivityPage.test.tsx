import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';
import { ToastProvider } from '@/ui';
import { makeAccount, makeStatement, makeTxn } from './testUtils';

const mocks = vi.hoisted(() => ({
  useLedger: vi.fn(),
  useTransaction: vi.fn(),
  applyQuery: vi.fn(),
  summarize: vi.fn(),
  reviewPriority: vi.fn(),
  suggestCategories: vi.fn(),
  setTransactionCategory: vi.fn(),
  setTransactionKind: vi.fn(),
  renameMerchant: vi.fn(),
  setTransactionNote: vi.fn(),
  markReviewed: vi.fn(),
  resetTransaction: vi.fn(),
}));

vi.mock('@/app/period', () => ({
  usePeriod: () => ({
    period: { preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
    setPreset: vi.fn(),
    setCustom: vi.fn(),
    stepMonth: vi.fn(),
  }),
  PeriodPicker: () => null,
}));
vi.mock('@/db/hooks', () => ({
  useLedger: mocks.useLedger,
  useTransaction: mocks.useTransaction,
  useRules: () => [],
  useSettings: () => ({ p2pReviewThreshold: 500_000 }),
}));
vi.mock('@/db/actions', () => ({
  setTransactionCategory: mocks.setTransactionCategory,
  setTransactionKind: mocks.setTransactionKind,
  renameMerchant: mocks.renameMerchant,
  setTransactionNote: mocks.setTransactionNote,
  markReviewed: mocks.markReviewed,
  resetTransaction: mocks.resetTransaction,
}));
vi.mock('@/engine/analytics', () => ({ applyQuery: mocks.applyQuery, summarize: mocks.summarize }));
vi.mock('@/engine/understand', () => ({ reviewPriority: mocks.reviewPriority, suggestCategories: mocks.suggestCategories }));

import ActivityPage from './ActivityPage';

const account = makeAccount();
const swiggy = (over: Partial<Transaction> = {}) =>
  makeTxn({ merchant: 'Swiggy', merchantKey: 'swiggy', category: 'food_dining', ...over });

function ledger(transactions: Transaction[], ready = true) {
  return { ready, accounts: [account], statements: [makeStatement()], transactions, customCategories: [] };
}

function Probe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.search}</output>;
}

function renderPage(url: string) {
  const tree = (
    <ToastProvider>
      <MemoryRouter initialEntries={[url]}>
        <ActivityPage />
        <Probe />
      </MemoryRouter>
    </ToastProvider>
  );
  return { ...render(tree), tree };
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  mocks.applyQuery.mockImplementation((txns: Transaction[]) => txns);
  mocks.summarize.mockReturnValue({ spending: 123_400, income: 500_000 });
  mocks.useTransaction.mockReturnValue(undefined);
  // By default the ranking keeps the given order and offers no suggestions.
  mocks.reviewPriority.mockImplementation((txns: Transaction[]) =>
    txns.map((t, i) => ({ txnId: t.id, score: 100 - i, sameMerchantCount: 0, reason: '' })),
  );
  mocks.suggestCategories.mockReturnValue([]);
});
afterEach(() => vi.clearAllMocks());

describe('ActivityPage', () => {
  it('turns URL params and the shared period into one LedgerQuery', () => {
    const txns = [swiggy(), swiggy()];
    mocks.useLedger.mockReturnValue(ledger(txns));
    renderPage('/activity?category=food_dining&account=acc1&kind=expense&review=1&q=swiggy');

    expect(mocks.applyQuery).toHaveBeenCalledWith(txns, {
      start: '2025-09-01',
      end: '2025-09-30',
      accountIds: ['acc1'],
      categories: ['food_dining'],
      kinds: ['expense'],
      needsReview: true,
      search: 'swiggy',
    });
    // The header totals use the very same filtered set.
    expect(mocks.summarize).toHaveBeenLastCalledWith(txns, expect.objectContaining({ start: '2025-09-01', end: '2025-09-30' }));
    expect(screen.getByRole('searchbox', { name: /search transactions/i })).toHaveValue('swiggy');
    expect(screen.getByRole('list', { name: /active filters/i })).toBeInTheDocument();
  });

  it('shows exactly the ids from an insight with a banner', () => {
    const a = swiggy();
    const b = swiggy();
    mocks.useLedger.mockReturnValue(ledger([a, b]));
    mocks.applyQuery.mockReturnValue([a]);
    renderPage(`/activity?ids=${a.id},zzz`);

    expect(mocks.applyQuery).toHaveBeenCalledWith(expect.anything(), { ids: [a.id, 'zzz'] });
    expect(screen.getByText('Showing 1 transaction from an insight')).toBeInTheDocument();
  });

  it('renders every row (no 50-row cap) up to the first page, then offers Show more', () => {
    const many = Array.from({ length: 130 }, () => swiggy());
    mocks.useLedger.mockReturnValue(ledger(many));
    renderPage('/activity');
    expect(screen.getAllByTestId('txn-row')).toHaveLength(60);
    expect(screen.getByRole('button', { name: /show more \(70 remaining\)/i })).toBeInTheDocument();
  });

  it('keeps the search input mounted, focused and filled while data loads and updates', async () => {
    const user = userEvent.setup();
    mocks.useLedger.mockReturnValue(ledger([], false));
    const { rerender, tree } = renderPage('/activity');

    const input = screen.getByRole('searchbox', { name: /search transactions/i });
    await user.type(input, 'chai');
    expect(input).toHaveFocus();

    // Data arrives, then changes again.
    mocks.useLedger.mockReturnValue(ledger([swiggy()]));
    rerender(tree);
    mocks.useLedger.mockReturnValue(ledger([swiggy(), swiggy()]));
    rerender(tree);

    const same = screen.getByRole('searchbox', { name: /search transactions/i });
    expect(same).toBe(input);
    expect(same).toHaveFocus();
    expect(same).toHaveValue('chai');
    // The debounced value reaches the URL (and therefore the query).
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('q=chai'));
    expect(mocks.applyQuery).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ search: 'chai' }));
  });

  it('asks "just this" vs "always" and calls setTransactionCategory with merchant scope', async () => {
    const user = userEvent.setup();
    const target = swiggy({ id: 'target', categorySource: 'builtin_rule' });
    const others = [swiggy(), swiggy(), makeTxn({ merchantKey: 'other', merchant: 'Other' })];
    mocks.useLedger.mockReturnValue(ledger([target, ...others]));
    mocks.useTransaction.mockImplementation((id?: string) => (id === 'target' ? target : undefined));
    mocks.setTransactionCategory.mockResolvedValue({ updated: 3, ruleId: 'r1' });
    renderPage('/activity?txn=target');

    const dialog = await screen.findByRole('dialog');
    // Kind and category each show their own source line.
    expect(within(dialog).getAllByText(/Built-in rule · 90% confident/)).toHaveLength(2);
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'shopping');

    // Nothing is written until the scope is chosen.
    expect(mocks.setTransactionCategory).not.toHaveBeenCalled();
    expect(within(dialog).getByText('2 other transactions match')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /always for “swiggy”/i }));

    expect(mocks.setTransactionCategory).toHaveBeenCalledWith('target', 'shopping', 'merchant');
    expect(await screen.findByText('Updated 3 transactions and remembered for Swiggy')).toBeInTheDocument();
  });

  it('"Just this transaction" uses scope this', async () => {
    const user = userEvent.setup();
    const target = swiggy({ id: 'target' });
    mocks.useLedger.mockReturnValue(ledger([target]));
    mocks.useTransaction.mockImplementation((id?: string) => (id === 'target' ? target : undefined));
    mocks.setTransactionKind.mockResolvedValue({ updated: 1 });
    renderPage('/activity?txn=target');

    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'p2p_out');
    await user.click(within(dialog).getByRole('button', { name: /just this transaction/i }));
    expect(mocks.setTransactionKind).toHaveBeenCalledWith('target', 'p2p_out', 'this');
  });

  it('review mode shows one card at a time with quick category chips', async () => {
    const user = userEvent.setup();
    const a = swiggy({ id: 'a', needsReview: true, category: 'uncategorized', categorySource: 'none', reviewReasons: ['Merchant not recognised'] });
    const b = swiggy({ id: 'b', needsReview: true });
    mocks.useLedger.mockReturnValue(ledger([a, b]));
    mocks.markReviewed.mockResolvedValue(undefined);
    renderPage('/activity?review=1');

    const card = screen.getByRole('group', { name: /other categories/i });
    expect(within(card).getAllByRole('button').length).toBeGreaterThan(2);
    expect(screen.getByText('2 left to review')).toBeInTheDocument();
    expect(screen.getByText('Merchant not recognised')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /looks right/i }));
    expect(mocks.markReviewed).toHaveBeenCalledWith(['a']);

    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.getByText('1 left to review')).toBeInTheDocument();
  });
  it('orders the review queue by reviewPriority, not by date', async () => {
    const user = userEvent.setup();
    const small = swiggy({ id: 'small', merchant: 'Small Shop', merchantKey: 'small shop', needsReview: true });
    const big = swiggy({ id: 'big', merchant: 'Big Spender', merchantKey: 'big spender', needsReview: true });
    mocks.useLedger.mockReturnValue(ledger([small, big]));
    mocks.reviewPriority.mockReturnValue([
      { txnId: 'big', score: 90, sameMerchantCount: 4, reason: 'Largest impact' },
      { txnId: 'small', score: 10, sameMerchantCount: 0, reason: '' },
    ]);
    renderPage('/activity?review=1');

    const card = screen.getByRole('region', { name: /review transaction/i });
    expect(within(card).getByText('Big Spender')).toBeInTheDocument();
    expect(within(card).getByText('Fixing this also fixes 4 more')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(within(screen.getByRole('region', { name: /review transaction/i })).getByText('Small Shop')).toBeInTheDocument();
    expect(screen.queryByText(/also fixes/)).not.toBeInTheDocument();
  });

  it('a suggestion chip answers with merchant scope and moves past the other rows of that merchant', async () => {
    const user = userEvent.setup();
    const a = swiggy({ id: 'a', needsReview: true, category: 'uncategorized', categorySource: 'none' });
    const b = swiggy({ id: 'b', needsReview: true, category: 'uncategorized', categorySource: 'none' });
    const other = swiggy({ id: 'c', merchant: 'Chai Point', merchantKey: 'chai point', needsReview: true });
    mocks.useLedger.mockReturnValue(ledger([a, b, other]));
    mocks.reviewPriority.mockReturnValue([
      { txnId: 'a', score: 3, sameMerchantCount: 1, reason: '' },
      { txnId: 'b', score: 2, sameMerchantCount: 1, reason: '' },
      { txnId: 'c', score: 1, sameMerchantCount: 0, reason: '' },
    ]);
    mocks.suggestCategories.mockReturnValue([
      { category: 'food_dining', probability: 0.72, source: 'learned', reason: 'You chose this for similar merchants' },
      { category: 'groceries', probability: 0.2, source: 'builtin_rule', reason: 'Built-in knowledge' },
    ]);
    mocks.setTransactionCategory.mockResolvedValue({ updated: 2, ruleId: 'r1' });
    mocks.markReviewed.mockResolvedValue(undefined);
    renderPage('/activity?review=1');

    const group = screen.getByRole('group', { name: /suggested categories/i });
    expect(within(group).getByText('72%')).toBeInTheDocument();
    expect(within(group).getByText('You chose this for similar merchants')).toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: /food & dining, 72% likely/i }));
    expect(mocks.setTransactionCategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /always for “swiggy”/i }));

    expect(mocks.setTransactionCategory).toHaveBeenCalledWith('a', 'food_dining', 'merchant');
    // The other Swiggy row (b) is skipped past even though the mocked data has not changed.
    await waitFor(() => expect(within(screen.getByRole('region', { name: /review transaction/i })).getByText('Chai Point')).toBeInTheDocument());
  });
});
