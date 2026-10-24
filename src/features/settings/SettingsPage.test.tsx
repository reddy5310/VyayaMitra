import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Statement, UserRule } from '@/domain/types';
import { ThemeProvider } from '@/app/theme';
import { ToastProvider } from '@/ui';

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[],
  statements: [] as Statement[],
  rules: [] as UserRule[],
  deleteAllData: vi.fn(async () => {}),
  deleteStatement: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
  deleteRule: vi.fn(async () => {}),
  updateRule: vi.fn(async () => {}),
  updateAccount: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => {}),
  exportBackup: vi.fn(async () => new Blob(['{}'])),
  inspectBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

vi.mock('@/db/hooks', () => ({
  useAccounts: () => mocks.accounts,
  useStatements: () => mocks.statements,
  useRules: () => mocks.rules,
  useCustomCategories: () => [],
  useSettings: () => ({ theme: 'system', hideAmounts: false, p2pReviewThreshold: 500000, onboardingDone: true }),
}));
vi.mock('@/db/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db/actions')>()),
  deleteAllData: mocks.deleteAllData,
  deleteAccount: mocks.deleteAccount,
  deleteRule: mocks.deleteRule,
  updateRule: mocks.updateRule,
  updateAccount: mocks.updateAccount,
  updateSettings: mocks.updateSettings,
  createCustomCategory: vi.fn(),
  getStorageStatus: async () => ({ persisted: false, usageBytes: 2048, quotaBytes: 1024 * 1024 * 100 }),
  requestPersistentStorage: async () => true,
}));
vi.mock('@/db/backup', () => ({
  exportBackup: mocks.exportBackup,
  inspectBackup: mocks.inspectBackup,
  restoreBackup: mocks.restoreBackup,
}));
vi.mock('@/engine/import', () => ({ deleteStatement: mocks.deleteStatement }));

import SettingsPage from './SettingsPage';
import { backupFileName, formatBytes } from './utils';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  name: 'Test Savings',
  institution: 'ICICI',
  type: 'savings',
  mask: '1234',
  currency: 'INR',
  createdAt: '2025-01-01T00:00:00Z',
  ...over,
});

const statement = (over: Partial<Statement> = {}): Statement => ({
  id: 's1',
  accountId: 'a1',
  fileName: 'sample.pdf',
  fileHash: 'x',
  parserId: 'p',
  parserVersion: 1,
  periodStart: '2025-08-01',
  periodEnd: '2025-08-31',
  totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
  reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 },
  warnings: [],
  rowCount: 42,
  importedAt: '2025-09-01T00:00:00Z',
  ...over,
});

const renderPage = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts = [account()];
  mocks.statements = [statement(), statement({ id: 's2', periodStart: '2025-09-01', periodEnd: '2025-09-30', reconciliation: { status: 'mismatch', checks: [{ label: 'Closing balance', ok: false }], rowBalanceBreaks: 1 } })];
  mocks.rules = [];
  localStorage.clear();
});

describe('delete all data', () => {
  const openDanger = async () => {
    await userEvent.click(screen.getByRole('tab', { name: 'Backup' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete all data' }));
    return screen.getByRole('dialog');
  };

  it('stays disabled until the exact word DELETE is typed', async () => {
    renderPage();
    const dialog = await openDanger();
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByLabelText('Type DELETE to confirm');
    await userEvent.type(input, 'delete');
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'DELET');
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(mocks.deleteAllData).not.toHaveBeenCalled();
  });

  it('erases everything once DELETE is typed, and forgets the saved period', async () => {
    localStorage.setItem('vm-period', '{"preset":"all"}');
    renderPage();
    const dialog = await openDanger();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(mocks.deleteAllData).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('vm-period')).toBeNull();
  });

  it('keeps the dialog open and shows the reason when the deletion fails', async () => {
    mocks.deleteAllData.mockRejectedValueOnce(new Error('Database is locked.'));
    renderPage();
    const dialog = await openDanger();
    await userEvent.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete everything' }));
    expect(await within(dialog).findByText('Database is locked.')).toBeInTheDocument();
  });
});

describe('statements', () => {
  it('shows reconciliation status and deletes a statement only after confirmation', async () => {
    renderPage();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
    expect(screen.getByText('Closing balance')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Delete statement 1 Sep/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/removes 42 transactions/)).toBeInTheDocument();
    expect(mocks.deleteStatement).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete statement' }));
    expect(mocks.deleteStatement).toHaveBeenCalledWith('s2');
  });
});

describe('accounts', () => {
  it('lists accounts with only the last 4 digits and validates the mask when editing', async () => {
    renderPage();
    expect(screen.getByText(/••1234/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Savings' }));
    const dialog = screen.getByRole('dialog');
    const mask = within(dialog).getByLabelText('Last 4 digits');
    await userEvent.clear(mask);
    await userEvent.type(mask, '12ab3456789');
    expect(mask).toHaveValue('1234'); // digits only, capped at four
    await userEvent.clear(mask);
    await userEvent.type(mask, '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText(/exactly the last 4 digits/)).toBeInTheDocument();
    expect(mocks.updateAccount).not.toHaveBeenCalled();
  });

  it('explains the cascade before deleting an account', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Test Savings' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete account' }));
    const confirm = screen.getByRole('dialog');
    expect(within(confirm).getByText(/2 statements and about 84 transactions/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete account' }));
    expect(mocks.deleteAccount).toHaveBeenCalledWith('a1');
  });
});

describe('remembered rules', () => {
  it('toggles and deletes a rule, explaining that deletion reverts transactions', async () => {
    mocks.rules = [
      { id: 'r1', match: { field: 'merchantKey', op: 'equals', value: 'zomato' }, set: { category: 'food_dining' }, enabled: true, createdAt: '2025-01-01T00:00:00Z' },
    ];
    renderPage();
    expect(screen.getByText(/When the merchant is “zomato”/)).toBeInTheDocument();
    expect(screen.getByText(/category Food & dining/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: /Pause rule/ }));
    expect(mocks.updateRule).toHaveBeenCalledWith('r1', { enabled: false });

    await userEvent.click(screen.getByRole('button', { name: /Delete rule/ }));
    expect(within(screen.getByRole('dialog')).getByText(/go back to VyayaMitra’s automatic category/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete rule' }));
    expect(mocks.deleteRule).toHaveBeenCalledWith('r1');
  });
});

describe('appearance and privacy', () => {
  it('persists the theme choice', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem('vm-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('saves the p2p review threshold in paise and rejects negatives', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    const field = screen.getByLabelText(/Review money sent to people/);
    expect(field).toHaveValue(5000);
    await userEvent.clear(field);
    await userEvent.type(field, '7500');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({ p2pReviewThreshold: 750000 });

    await userEvent.clear(field);
    await userEvent.type(field, '-5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter an amount of 0 or more.')).toBeInTheDocument();
  });

  it('explains the privacy model', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Preferences' }));
    expect(screen.getByText(/never leave it/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing syncs between your devices/)).toBeInTheDocument();
  });
});

describe('backup & restore', () => {
  it('downloads an unencrypted backup named with the local date', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Backup' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(mocks.exportBackup).toHaveBeenCalledWith({});
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('refuses to export when the two passphrases differ', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Backup' }));
    await userEvent.type(screen.getByLabelText('Passphrase (optional)'), 'abc');
    await userEvent.type(screen.getByLabelText('Repeat passphrase'), 'abd');
    await userEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    expect(screen.getByText('The two passphrases do not match.')).toBeInTheDocument();
    expect(mocks.exportBackup).not.toHaveBeenCalled();
  });

  it('walks through inspect, passphrase, mode and confirmation before restoring', async () => {
    mocks.inspectBackup.mockResolvedValue({ encrypted: true, createdAt: '2025-09-01T10:00:00Z' });
    mocks.restoreBackup.mockResolvedValue({ counts: { transactions: 12 } });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Backup' }));
    const file = new File(['{}'], 'vyayamitra-backup-2025-09-01.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Choose backup file'), file);
    expect(await screen.findByText('Encrypted')).toBeInTheDocument();

    const restore = screen.getByRole('button', { name: 'Restore…' });
    expect(restore).toBeDisabled(); // passphrase required
    await userEvent.type(screen.getByLabelText('Passphrase'), 'secret');
    await userEvent.click(screen.getByRole('radio', { name: 'Replace' }));
    await userEvent.click(restore);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/will be erased and replaced/)).toBeInTheDocument();
    expect(mocks.restoreBackup).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace and restore' }));
    expect(mocks.restoreBackup).toHaveBeenCalledWith(file, { passphrase: 'secret', mode: 'replace' });
  });

  it('shows a clear error when the file is not a backup', async () => {
    mocks.inspectBackup.mockRejectedValue(new Error('That file is not a VyayaMitra backup.'));
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Backup' }));
    await userEvent.upload(screen.getByLabelText('Choose backup file'), new File(['nope'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('That file is not a VyayaMitra backup.')).toBeInTheDocument();
  });
});

describe('utils', () => {
  it('names backups with the local calendar date, not UTC', () => {
    // 23:30 local on 5 Jan is still 5 Jan, whatever the UTC date is.
    expect(backupFileName(new Date(2026, 0, 5, 23, 30))).toBe('vyayamitra-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 11, 31, 0, 5))).toBe('vyayamitra-backup-2026-12-31.json');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
