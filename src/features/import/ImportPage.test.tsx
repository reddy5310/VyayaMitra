import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedRow, TemplateDraft } from '@/domain/types';
import type { StatementInspection } from '@/parsing';
import type { ImportPreview, ImportResult, PreviewRow } from '@/engine/import';
import { makeAccount } from '../activity/testUtils';

const mocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  setCustom: vi.fn(),
  prepareImport: vi.fn(),
  retargetPreview: vi.fn(),
  commitImport: vi.fn(),
  inspectImport: vi.fn(),
  draftTemplate: vi.fn(),
  saveTemplate: vi.fn(),
}));

vi.mock('@/db/hooks', () => ({ useAccounts: mocks.useAccounts }));
vi.mock('@/db/learning', () => ({ useTemplates: () => [], saveTemplate: mocks.saveTemplate }));
vi.mock('@/app/period', () => ({
  usePeriod: () => ({ setCustom: mocks.setCustom }),
}));
vi.mock('@/engine/import', () => ({
  prepareImport: mocks.prepareImport,
  retargetPreview: mocks.retargetPreview,
  commitImport: mocks.commitImport,
  inspectImport: mocks.inspectImport,
}));
vi.mock('@/parsing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/parsing')>()),
  draftTemplate: mocks.draftTemplate,
  listSupportedFormats: () => [
    { id: 'demo', label: 'Demo Bank savings account', institution: 'OTHER', accountType: 'savings', fileTypes: ['pdf'] },
  ],
}));

import {
  IncorrectPasswordError,
  PasswordRequiredError,
  ScannedPdfError,
  UnsupportedStatementError,
} from '@/parsing';
import ImportPage from './ImportPage';

function parsedRow(over: Partial<ParsedRow> = {}): ParsedRow {
  return {
    date: '2025-09-12',
    amount: 25_000,
    direction: 'debit',
    description: 'UPI/DEMO MART/123',
    source: { page: 1, lineStart: 1, lineEnd: 1, rawLines: ['x'] },
    warnings: [],
    ...over,
  };
}

function previewRow(index: number, over: Partial<PreviewRow> = {}, row: Partial<ParsedRow> = {}): PreviewRow {
  return {
    index,
    row: parsedRow(row),
    fingerprint: `fp${index}`,
    understanding: {
      channel: 'UPI',
      counterparty: { type: 'merchant', name: 'Demo Mart' },
      merchant: `Merchant ${index}`,
      merchantKey: `merchant ${index}`,
      kind: 'expense',
      kindSource: 'rule',
      category: 'groceries',
      categorySource: 'builtin_rule',
      confidence: 0.9,
      reasons: [],
      needsReview: false,
      reviewReasons: [],
    },
    ...over,
  };
}

function makePreview(over: Partial<ImportPreview> = {}): ImportPreview {
  const rows = [previewRow(0), previewRow(1, { duplicateOf: 'old1' }), previewRow(2, {}, { direction: 'credit', amount: 90_000 })];
  return {
    file: { name: 'demo.pdf', size: 3, hash: 'h' },
    parsed: {
      parserId: 'demo',
      parserVersion: 1,
      institution: 'OTHER',
      accountType: 'savings',
      periodStart: '2025-09-01',
      periodEnd: '2025-09-30',
      openingBalance: 1_000_000,
      closingBalance: 1_050_000,
      rows: rows.map((r) => r.row),
      skipped: [{ page: 2, line: 7, text: 'SOME ODD LINE 12.00', reason: 'No date found' }],
      warnings: ['Closing balance was inferred'],
      reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 },
      detection: { confidence: 1, reasons: [] },
    },
    overlapping: [],
    account: {
      existingAccountId: 'acc1',
      proposed: { name: 'Demo Savings', institution: 'OTHER', type: 'savings', mask: '1234', currency: 'INR' },
    },
    candidateAccountIds: ['acc1'],
    rows,
    stats: { total: 3, new: 2, duplicates: 1, needsReview: 1, debits: 50_000, credits: 90_000 },
    ...over,
  };
}

const RESULT: ImportResult = { statementId: 's1', accountId: 'acc1', inserted: 2, skippedDuplicates: 1, linked: 0, needsReview: 1 };

function pdf(name = 'demo.pdf') {
  return new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, file = pdf()) {
  await user.upload(screen.getByLabelText('Choose statement files'), file);
}

beforeEach(() => {
  mocks.useAccounts.mockReturnValue([makeAccount({ id: 'acc1', name: 'Demo Savings ••1234' })]);
});
afterEach(() => vi.clearAllMocks());

describe('ImportPage', () => {
  it('promises on-device reading and lists supported formats', () => {
    renderPage();
    expect(screen.getByText('Read on this device only. Nothing is uploaded.')).toBeInTheDocument();
    expect(screen.getByText('Demo Bank savings account')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose statement files')).toHaveAttribute('accept', expect.stringContaining('.pdf'));
  });

  it('rejects files over 25 MB with a clear message and never parses them', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    const big = pdf('big.pdf');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await pick(user, big);
    expect(await screen.findByText(/over the 25 MB limit/)).toBeInTheDocument();
    expect(mocks.prepareImport).not.toHaveBeenCalled();
  });

  it('asks for the password on PasswordRequiredError, hides it, retries, and clears it', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockRejectedValueOnce(new PasswordRequiredError()).mockResolvedValueOnce(makePreview());
    renderPage();
    await pick(user);

    const field = await screen.findByLabelText('Statement password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await user.type(field, 'S3cret');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: /unlock statement/i }));

    await waitFor(() => expect(mocks.prepareImport).toHaveBeenCalledTimes(2));
    expect(mocks.prepareImport.mock.calls[1][1]).toEqual({ password: 'S3cret' });
    // On to the account step; no password field remains anywhere.
    expect(await screen.findByText('Which account is this?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Statement password')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('S3cret');
  });

  it('shows an error and keeps the password step after a wrong password', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockRejectedValueOnce(new PasswordRequiredError()).mockRejectedValueOnce(new IncorrectPasswordError());
    renderPage();
    await pick(user);
    await user.type(await screen.findByLabelText('Statement password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /unlock statement/i }));
    expect(await screen.findByText('That password did not open the statement')).toBeInTheDocument();
    expect(screen.getByLabelText('Statement password')).toHaveValue('');
  });

  it('offers OCR for scanned PDFs and explains unsupported statements with their hints', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockRejectedValueOnce(new ScannedPdfError());
    renderPage();
    await pick(user);
    expect(await screen.findByText('This looks like a scanned statement')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    mocks.prepareImport.mockRejectedValueOnce(new UnsupportedStatementError('No parser matched', ['Try the CSV export']));
    await pick(user, pdf('other.pdf'));
    expect(await screen.findByText('We could not read this statement')).toBeInTheDocument();
    expect(screen.getByText('Try the CSV export')).toBeInTheDocument();
  });

  it('never calls commitImport before the user confirms, then commits with the chosen rows', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockResolvedValue(makePreview());
    mocks.commitImport.mockResolvedValue(RESULT);
    renderPage();
    await pick(user);

    await user.click(await screen.findByRole('button', { name: /continue to review/i }));
    expect(await screen.findByText(/Every row matches the statement/)).toBeInTheDocument();
    expect(screen.getByText('2 of 3 rows will be imported')).toBeInTheDocument();
    // Duplicates are off by default and locked.
    expect(screen.getByRole('checkbox', { name: /Merchant 1/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Merchant 1/ })).toBeDisabled();
    expect(mocks.commitImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /Merchant 2/ }));
    expect(screen.getByText('1 of 3 rows will be imported')).toBeInTheDocument();
    expect(mocks.commitImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /import 1 transaction/i }));
    await waitFor(() => expect(mocks.commitImport).toHaveBeenCalledTimes(1));
    expect(mocks.commitImport.mock.calls[0][1]).toEqual({ accountId: 'acc1', mode: 'add', excludeRowIndexes: [2] });

    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review 1 transaction' })).toHaveAttribute('href', '/activity?review=1');
    expect(screen.getByRole('link', { name: 'See overview' })).toHaveAttribute('href', '/');
    await user.click(screen.getByRole('button', { name: 'Import another' }));
    expect(screen.getByText('Choose a bank or card statement')).toBeInTheDocument();
  });

  it('cancel resets the wizard and writes nothing', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockResolvedValue(makePreview());
    renderPage();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: /continue to review/i }));
    await screen.findByText('2 of 3 rows will be imported');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Choose a bank or card statement')).toBeInTheDocument();
    expect(mocks.commitImport).not.toHaveBeenCalled();
  });

  it('cancelling at the password step drops the password prompt and file', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockRejectedValueOnce(new PasswordRequiredError());
    renderPage();
    await pick(user);
    await user.type(await screen.findByLabelText('Statement password'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Statement password')).not.toBeInTheDocument();
    expect(screen.getByText('Choose a bank or card statement')).toBeInTheDocument();
    expect(mocks.commitImport).not.toHaveBeenCalled();
  });

  it('offers Replace for an already-imported file and commits in replace mode', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockResolvedValue(
      makePreview({ alreadyImported: { statementId: 'old-st', accountId: 'acc1', importedAt: '2025-09-20T10:00:00.000Z' } }),
    );
    mocks.commitImport.mockResolvedValue(RESULT);
    renderPage();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: /continue to review/i }));

    expect(await screen.findByText('This exact file was imported before')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replace it' }));
    // Replacing includes the rows that were duplicates of the old import.
    expect(screen.getByText('3 of 3 rows will be imported')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /replace and import 3/i }));
    await waitFor(() => expect(mocks.commitImport).toHaveBeenCalled());
    expect(mocks.commitImport.mock.calls[0][1]).toEqual({
      accountId: 'acc1',
      mode: 'replace',
      replaceStatementId: 'old-st',
      excludeRowIndexes: [],
    });
  });

  it('lets the user expand skipped lines and keeps data safe when the commit fails', async () => {
    const user = userEvent.setup();
    mocks.prepareImport.mockResolvedValue(makePreview());
    mocks.commitImport.mockRejectedValue(new Error('Disk is full'));
    renderPage();
    await pick(user);
    await user.click(await screen.findByRole('button', { name: /continue to review/i }));

    await user.click(await screen.findByRole('button', { name: /1 line looked like transactions/i }));
    expect(screen.getByText('SOME ODD LINE 12.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /import 2 transactions/i }));
    const alert = await screen.findByText('Nothing was saved');
    expect(within(alert.closest('[role="alert"]') as HTMLElement).getByText(/Disk is full/)).toBeInTheDocument();
    // Still on the review step with the choices intact, ready to retry.
    expect(screen.getByRole('button', { name: /import 2 transactions/i })).toBeEnabled();
  });

  it('retargets the preview when another account is chosen', async () => {
    const user = userEvent.setup();
    mocks.useAccounts.mockReturnValue([
      makeAccount({ id: 'acc1', name: 'Demo Savings ••1234' }),
      makeAccount({ id: 'acc2', name: 'Other Card ••9999', type: 'credit_card' }),
    ]);
    const first = makePreview();
    const second = makePreview({ account: { existingAccountId: 'acc2', proposed: first.account.proposed } });
    mocks.prepareImport.mockResolvedValue(first);
    mocks.retargetPreview.mockResolvedValue(second);
    renderPage();
    await pick(user);
    await user.selectOptions(await screen.findByLabelText('Account'), 'acc2');
    await waitFor(() => expect(mocks.retargetPreview).toHaveBeenCalledWith(first, { accountId: 'acc2' }));
  });

  describe('scanned statements (OCR)', () => {
    it('asks first, runs OCR with progress, and cancelling drops the result without writing', async () => {
      const user = userEvent.setup();
      let onProgress: ((p: { stage: 'ocr'; done: number; total: number }) => void) | undefined;
      let finish: (p: ImportPreview) => void = () => {};
      mocks.prepareImport.mockRejectedValueOnce(new ScannedPdfError()).mockImplementationOnce(
        (_f: unknown, opts: { onProgress?: typeof onProgress }) => {
          onProgress = opts.onProgress;
          return new Promise<ImportPreview>((resolve) => {
            finish = resolve;
          });
        },
      );
      renderPage();
      await pick(user);

      expect(await screen.findByText('This looks like a scanned statement')).toBeInTheDocument();
      expect(screen.getByText(/runs on this device/i)).toBeInTheDocument();
      expect(screen.getByText(/10 to 40 seconds per page/i)).toBeInTheDocument();
      expect(screen.getByText(/extra review/i)).toBeInTheDocument();
      // Nothing is read with OCR until the user agrees.
      expect(mocks.prepareImport).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Read with OCR' }));
      await waitFor(() => expect(mocks.prepareImport).toHaveBeenCalledTimes(2));
      expect(mocks.prepareImport.mock.calls[1][1]).toEqual(expect.objectContaining({ ocr: true, onProgress: expect.any(Function) }));

      act(() => onProgress?.({ stage: 'ocr', done: 1, total: 3 }));
      expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: 'OCR progress' })).toHaveAttribute('aria-valuenow', '33');

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Choose a bank or card statement')).toBeInTheDocument();
      // The slow OCR finishes afterwards: its result is dropped.
      await act(async () => finish(makePreview()));
      expect(screen.getByText('Choose a bank or card statement')).toBeInTheDocument();
      expect(screen.queryByText('Which account is this?')).not.toBeInTheDocument();
      expect(mocks.commitImport).not.toHaveBeenCalled();
    });

    it('flags OCR rows for extra checking on the review step', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockRejectedValueOnce(new ScannedPdfError()).mockResolvedValueOnce(makePreview());
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: 'Read with OCR' }));
      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      expect(await screen.findByText('Read with OCR')).toBeInTheDocument();
      expect(screen.getByText(/can be wrong/i)).toBeInTheDocument();
    });
  });

  describe('teach this format', () => {
    const inspection: StatementInspection = {
      fileKind: 'pdf',
      institutionGuess: 'OTHER',
      accountTypeGuess: 'savings',
      markers: ['demo bank'],
      headerTokens: ['txn date', 'particulars'],
      columns: [
        { id: 'c0', header: 'Txn Date', x0: 0, x1: 50, samples: ['03/04/2025', '04/04/2025'], guessedRole: 'date', confidence: 0.9 },
        { id: 'c1', header: 'Particulars', x0: 60, x1: 200, samples: ['UPI/DEMO MART'], guessedRole: 'description', confidence: 0.9 },
        { id: 'c2', header: 'Withdrawals', x0: 210, x1: 260, samples: ['250.00'], guessedRole: 'ignore', confidence: 0.2 },
        { id: 'c3', header: 'Deposits', x0: 270, x1: 320, samples: ['900.00'], guessedRole: 'ignore', confidence: 0.2 },
        { id: 'c4', header: 'Balance', x0: 330, x1: 380, samples: ['10,000.00'], guessedRole: 'balance', confidence: 0.9 },
      ],
      previewRows: [{ page: 1, cells: { c0: '03/04/2025', c1: 'UPI/DEMO MART', c2: '250.00', c3: '', c4: '10,000.00' } }],
      guesses: { dateOrder: 'MDY', descriptionLayout: 'single', amountStyle: 'signed' },
    };
    const draft = { name: 'Demo Bank savings account', fileKind: 'pdf', amountStyle: 'split' } as unknown as TemplateDraft;

    beforeEach(() => {
      mocks.inspectImport.mockResolvedValue(inspection);
      mocks.draftTemplate.mockReturnValue(draft);
    });

    it('maps the roles the user picks into a draft, tries it, and saves it after the import', async () => {
      const user = userEvent.setup();
      mocks.prepareImport
        .mockRejectedValueOnce(new UnsupportedStatementError('No parser matched', ['Try a CSV export']))
        .mockResolvedValueOnce(makePreview());
      mocks.commitImport.mockResolvedValue(RESULT);
      renderPage();
      await pick(user);

      await user.click(await screen.findByRole('button', { name: 'Teach VyayaMitra this format' }));
      await waitFor(() => expect(mocks.inspectImport).toHaveBeenCalledTimes(1));
      expect(mocks.inspectImport.mock.calls[0][0]).toEqual(expect.objectContaining({ name: 'demo.pdf' }));

      await user.selectOptions(await screen.findByLabelText('Role of Withdrawals (column 3)'), 'debit');
      await user.selectOptions(screen.getByLabelText('Role of Deposits (column 4)'), 'credit');
      await user.click(screen.getByRole('radio', { name: 'DMY' }));
      // Live examples under the chosen date order.
      expect(screen.getByLabelText('Date examples')).toHaveTextContent('03/04/2025 → 3 Apr 2025');
      await user.clear(screen.getByLabelText('Format name'));
      await user.type(screen.getByLabelText('Format name'), 'My Demo format');
      await user.click(screen.getByRole('button', { name: 'Try it' }));

      await waitFor(() => expect(mocks.draftTemplate).toHaveBeenCalledTimes(1));
      const [passedInspection, mapping] = mocks.draftTemplate.mock.calls[0];
      expect(passedInspection).toBe(inspection);
      expect(mapping).toEqual(
        expect.objectContaining({
          roles: { c0: 'date', c1: 'description', c2: 'debit', c3: 'credit', c4: 'balance' },
          dateOrder: 'DMY',
          amountStyle: 'split',
          name: 'My Demo format',
          institution: 'OTHER',
        }),
      );
      await waitFor(() => expect(mocks.prepareImport).toHaveBeenCalledTimes(2));
      expect(mocks.prepareImport.mock.calls[1][1]).toEqual({ template: draft });

      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      expect(await screen.findByText('VyayaMitra learned this format')).toBeInTheDocument();
      expect(mocks.saveTemplate).not.toHaveBeenCalled(); // only after the user imports

      await user.click(screen.getByRole('button', { name: /import 2 transactions/i }));
      await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledWith(draft, { source: 'user', name: 'My Demo format' }));
      expect(await screen.findByText(/Saved the format/)).toBeInTheDocument();
    });

    it('shows the error and stays on the teach screen when the mapping does not parse', async () => {
      const user = userEvent.setup();
      mocks.prepareImport
        .mockRejectedValueOnce(new UnsupportedStatementError('No parser matched'))
        .mockRejectedValueOnce(new UnsupportedStatementError('No rows with that mapping', ['Check the date order']));
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: 'Teach VyayaMitra this format' }));
      await user.selectOptions(await screen.findByLabelText('Role of Withdrawals (column 3)'), 'debit');
      await user.click(screen.getByRole('button', { name: 'Try it' }));
      expect(await screen.findByText('No rows with that mapping')).toBeInTheDocument();
      expect(screen.getByText('Check the date order')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try it' })).toBeEnabled();
      expect(mocks.commitImport).not.toHaveBeenCalled();
    });

    it('will not try until a date, description and amount column are chosen', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockRejectedValueOnce(new UnsupportedStatementError('No parser matched'));
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: 'Teach VyayaMitra this format' }));
      await screen.findByLabelText('Role of Withdrawals (column 3)');
      expect(screen.getByText(/Still needed: an Amount, Debit or Credit column/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try it' })).toBeDisabled();
    });

    const doubtful = (over: Partial<ImportPreview['parsed']>) => {
      const base = makePreview();
      return makePreview({ parsed: { ...base.parsed, ...over } });
    };

    it('offers teaching when reconciliation mismatches', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockResolvedValue(
        doubtful({ reconciliation: { status: 'mismatch', checks: [{ label: 'Closing balance', ok: false, expected: 100, actual: 90 }], rowBalanceBreaks: 2 } }),
      );
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      expect(await screen.findByText('We are not sure this was read correctly')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Teach VyayaMitra this format' })).toBeEnabled();
    });

    it('offers teaching when detection confidence is below 0.6', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockResolvedValueOnce(doubtful({ detection: { confidence: 0.4, reasons: [] } }));
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      expect(await screen.findByText('We are not sure this was read correctly')).toBeInTheDocument();
    });

    it('stays quiet when the reading is confident, with only a small link to teach', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockResolvedValueOnce(makePreview());
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      await screen.findByText(/Every row matches the statement/);
      expect(screen.queryByText('We are not sure this was read correctly')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /columns look wrong\? teach vyayamitra/i })).toBeInTheDocument();
    });

    it('goes back to the review step when teaching from it is cancelled', async () => {
      const user = userEvent.setup();
      mocks.prepareImport.mockResolvedValueOnce(makePreview());
      renderPage();
      await pick(user);
      await user.click(await screen.findByRole('button', { name: /continue to review/i }));
      await user.click(await screen.findByRole('button', { name: /columns look wrong/i }));
      await screen.findByLabelText('Role of Withdrawals (column 3)');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByText('2 of 3 rows will be imported')).toBeInTheDocument();
      expect(mocks.commitImport).not.toHaveBeenCalled();
    });
  });
});
