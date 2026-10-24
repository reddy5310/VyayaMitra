import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatementTemplate, Transaction } from '@/domain/types';
import type { LearningStats } from '@/engine/analytics';
import { ToastProvider } from '@/ui';

const hooks = vi.hoisted(() => ({ useLedger: vi.fn(), useRules: vi.fn() }));
vi.mock('@/db/hooks', () => hooks);

const learning = vi.hoisted(() => ({
  useTemplates: vi.fn(),
  useFeedback: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  exportTemplates: vi.fn(),
  importTemplates: vi.fn(),
  resetLearning: vi.fn(),
}));
vi.mock('@/db/learning', () => learning);

const analytics = vi.hoisted(() => ({ learningStats: vi.fn() }));
vi.mock('@/engine/analytics', () => analytics);

const understand = vi.hoisted(() => ({ reviewPriority: vi.fn() }));
vi.mock('@/engine/understand', () => understand);

import LearningPage from './LearningPage';

const template = (over: Partial<StatementTemplate> = {}): StatementTemplate => ({
  id: 'tpl1',
  name: 'Demo Bank savings (PDF)',
  institution: 'HDFC',
  accountType: 'savings',
  fileKind: 'pdf',
  signature: { markers: ['demo bank'], headerTokens: ['date', 'narration'], columnCount: 6 },
  columns: [],
  amountStyle: 'split',
  source: 'auto',
  verifiedCount: 4,
  useCount: 5,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...over,
});

const stats: LearningStats = {
  totalTransactions: 1200,
  autoUnderstoodShare: 0.874,
  needsReview: 40,
  bySource: {},
  rules: 7,
  templates: { total: 2, auto: 1, user: 1, imported: 0 },
  corrections: 31,
  accuracyTrend: [
    { month: '2025-08', accuracy: null, corrections: 0, decisions: 0 },
    { month: '2025-09', accuracy: 0.9, corrections: 4, decisions: 40 },
  ],
  topTaught: [{ merchantKey: 'demo cafe', merchant: 'Demo Cafe', rows: 12 }],
};

const reviewTxn = { id: 'tx1', merchant: 'Unknown Store', rawDescription: 'POS UNKNOWN', date: '2025-09-10', amount: 45_000, direction: 'debit', needsReview: true } as Transaction;

function setup(over: { templates?: StatementTemplate[] | undefined; stats?: LearningStats } = {}) {
  hooks.useLedger.mockReturnValue({ ready: true, accounts: [], statements: [], transactions: [reviewTxn], customCategories: [] });
  hooks.useRules.mockReturnValue([{ id: 'r1' }]);
  learning.useTemplates.mockReturnValue('templates' in over ? over.templates : [template(), template({ id: 'tpl2', name: 'My taught layout', source: 'user', useCount: 1, verifiedCount: 1 })]);
  learning.useFeedback.mockReturnValue([]);
  analytics.learningStats.mockReturnValue(over.stats ?? stats);
  understand.reviewPriority.mockReturnValue([{ txnId: 'tx1', score: 9, sameMerchantCount: 2, reason: 'Unknown merchant' }]);
  return render(
    <ToastProvider>
      <MemoryRouter>
        <LearningPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Learning centre', () => {
  it('renders the headline stat, accuracy table, taught merchants and review suggestions', () => {
    setup();
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText(/of your 1,200 transactions were understood without asking you/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Monthly accuracy of automatic decisions' });
    expect(within(table).getByText('Not measured')).toBeInTheDocument();
    expect(within(table).getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Demo Cafe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage rules in Settings' })).toHaveAttribute('href', '/settings');
    const teach = screen.getByRole('link', { name: /Unknown Store/ });
    expect(teach).toHaveAttribute('href', '/activity?txn=tx1');
    expect(teach).toHaveTextContent('Fixing this fixes 2 more');
    expect(screen.getByText(/never contains names, account numbers, amounts or descriptions/)).toBeInTheDocument();
  });

  it('lists learned formats with source, usage and verification', () => {
    setup();
    expect(screen.getByText('Demo Bank savings (PDF)')).toBeInTheDocument();
    expect(screen.getByText('Learned automatically')).toBeInTheDocument();
    expect(screen.getByText('Taught by you')).toBeInTheDocument();
    expect(screen.getByText('Used 5 times')).toBeInTheDocument();
    expect(screen.getByText('4 verified')).toBeInTheDocument();
  });

  it('explains an empty state when nothing has been imported', () => {
    setup({ stats: { ...stats, totalTransactions: 0, accuracyTrend: [], topTaught: [] }, templates: [] });
    expect(screen.getByText('Nothing to learn from yet')).toBeInTheDocument();
    expect(screen.getByText('No formats learned yet')).toBeInTheDocument();
  });

  it('deletes a format only after confirmation', async () => {
    learning.deleteTemplate.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Delete Demo Bank savings (PDF)' }));
    expect(learning.deleteTemplate).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete format' }));
    expect(learning.deleteTemplate).toHaveBeenCalledWith('tpl1');
  });

  it('renames a format', async () => {
    learning.updateTemplate.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Rename Demo Bank savings (PDF)' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Salary account');
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(learning.updateTemplate).toHaveBeenCalledWith('tpl1', { name: 'Salary account' });
  });

  it('export hands the file to the browser as a download', async () => {
    learning.exportTemplates.mockResolvedValue(new Blob(['{}'], { type: 'application/json' }));
    const createUrl = vi.fn(() => 'blob:demo');
    const revokeUrl = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Export formats' }));
    expect(learning.exportTemplates).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('imports a formats file and reports what happened', async () => {
    learning.importTemplates.mockResolvedValue({ added: 2, merged: 1 });
    const user = userEvent.setup();
    setup();
    const file = new File(['{"templates":[]}'], 'formats.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Choose a formats file to import'), file);
    expect(learning.importTemplates).toHaveBeenCalledWith(file);
    expect(await screen.findByText(/2 new, 1 merged/)).toBeInTheDocument();
  });

  it('reset requires confirmation, and a full reset requires typing RESET', async () => {
    learning.resetLearning.mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Forget what I taught it' }));
    expect(learning.resetLearning).not.toHaveBeenCalled();
    expect(screen.getByText(/Your transactions, imported statements, remembered rules and learned formats are not touched/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Forget corrections' }));
    expect(learning.resetLearning).toHaveBeenCalledWith('model');

    await user.click(screen.getByRole('button', { name: 'Reset all learning' }));
    const dialog = screen.getAllByRole('dialog').find((d) => d.hasAttribute('open'))!;
    const confirm = within(dialog).getByRole('button', { name: 'Reset all learning' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Type RESET to confirm'), 'RESET');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(learning.resetLearning).toHaveBeenLastCalledWith('all');
  });
});
