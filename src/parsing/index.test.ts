import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hdfcLike } from '../../tests/fixtures/parsing/layouts';
import { buildBlankPdf, buildPdf, T } from '../../tests/fixtures/parsing/builders';
import { buildEncryptedPdf } from '../../tests/fixtures/parsing/encrypted';
import { DBS_TXNS, dbsPages, iciciCreditCardPages, iciciSavingsPages } from '../../tests/fixtures/parsing/statements';
import {
  ACCEPTED_FILE_TYPES,
  IncorrectPasswordError,
  PasswordRequiredError,
  ScannedPdfError,
  UnsupportedStatementError,
  isStatementError,
  listSupportedFormats,
  parseStatement,
} from './index';
import { useLegacyPdfjsForNode } from './pdf/node';

// OCR itself (Tesseract) is the adapters module's business; here only the hand-off is checked.
vi.mock('./adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./adapters')>()),
  ocrPdf: vi.fn(async () => hdfcLike()),
}));

beforeAll(() => useLegacyPdfjsForNode());

const file = (name: string, bytes: Uint8Array, type?: string) => ({ name, bytes, type });
const text = (s: string) => new TextEncoder().encode(s);

describe('parseStatement', () => {
  it('parses a PDF end to end and records which parser matched and why', async () => {
    const st = await parseStatement(file('statement.pdf', await buildPdf((await dbsPages()).pages), 'application/pdf'));
    expect(st.parserId).toBe('dbs-savings');
    expect(st.rows).toHaveLength(DBS_TXNS.length);
    expect(st.detection.confidence).toBeGreaterThan(0.9);
    expect(st.detection.reasons.length).toBeGreaterThan(0);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('chooses the right parser for each bank shape', async () => {
    const icici = await parseStatement(file('a.pdf', await buildPdf((await iciciSavingsPages()).pages)));
    const card = await parseStatement(file('b.pdf', await buildPdf((await iciciCreditCardPages()).pages)));
    expect(icici.parserId).toBe('icici-savings');
    expect(card.parserId).toBe('icici-credit-card');
  });

  it('recognises a PDF by its bytes even with a misleading name', async () => {
    const st = await parseStatement(file('statement.txt', await buildPdf((await dbsPages()).pages)));
    expect(st.parserId).toBe('dbs-savings');
  });

  it('parses a CSV by name or MIME type', async () => {
    const csv = text('Date,Description,Type,Amount\n2024-06-01,Shop,DEBIT,10.50\n');
    expect((await parseStatement(file('x.csv', csv))).rows[0].amount).toBe(1_050);
    expect((await parseStatement(file('download', csv, 'text/csv'))).parserId).toBe('csv');
  });

  it('maps a missing or wrong password to the typed errors and opens with the right one', async () => {
    const bytes = buildEncryptedPdf('pw-1234', 'Encrypted statement 100.00');
    await expect(parseStatement(file('locked.pdf', bytes))).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(parseStatement(file('locked.pdf', bytes), { password: 'bad' })).rejects.toBeInstanceOf(IncorrectPasswordError);
    // with the right password the PDF opens; it is not a statement, so it is "unsupported", not a password error
    await expect(parseStatement(file('locked.pdf', bytes), { password: 'pw-1234' })).rejects.toBeInstanceOf(UnsupportedStatementError);
  });

  it('reads a scanned PDF through OCR only when asked to, and says so', async () => {
    const scan = file('scan.pdf', await buildBlankPdf());
    await expect(parseStatement(scan)).rejects.toBeInstanceOf(ScannedPdfError);
    const st = await parseStatement(scan, { ocr: true });
    expect(st.rows).toHaveLength(8);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.warnings.join(' ')).toMatch(/scan/);
  });

  it('rejects a scanned (text-less) PDF with ScannedPdfError', async () => {
    await expect(parseStatement(file('scan.pdf', await buildBlankPdf()))).rejects.toBeInstanceOf(ScannedPdfError);
  });

  it('never returns a successful import with zero rows', async () => {
    const letter = await buildPdf([{ texts: [T(40, 80, 'Dear customer, your account is in good standing.'), T(40, 100, 'Regards, Example Bank')] }]);
    await expect(parseStatement(file('letter.pdf', letter))).rejects.toBeInstanceOf(UnsupportedStatementError);

    const headerOnly = await buildPdf([
      {
        texts: [
          T(40, 100, 'Date'),
          T(100, 100, 'Narration'),
          { x: 420, y: 100, text: 'Debit', right: true },
          { x: 480, y: 100, text: 'Credit', right: true },
          { x: 560, y: 100, text: 'Balance', right: true },
        ],
      },
    ]);
    const err = await parseStatement(file('empty.pdf', headerOnly)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedStatementError);
    expect((err as UnsupportedStatementError).hints.length).toBeGreaterThan(0);

    await expect(parseStatement(file('empty.csv', text('Date,Description,Type,Amount\n')))).rejects.toBeInstanceOf(UnsupportedStatementError);
    await expect(parseStatement(file('empty.bin', new Uint8Array(0)))).rejects.toBeInstanceOf(UnsupportedStatementError);
  });

  it('rejects arbitrary binary data', async () => {
    const junk = Uint8Array.from({ length: 200 }, (_, i) => (i * 37) % 251);
    const err = await parseStatement(file('photo.jpg', junk)).catch((e: unknown) => e);
    expect(isStatementError(err)).toBe(true);
  });
});

describe('listSupportedFormats', () => {
  it('lists every parser with its institution and file types', () => {
    const formats = listSupportedFormats();
    expect(formats.map((f) => f.id)).toEqual(['icici-savings', 'dbs-savings', 'icici-credit-card', 'csv', 'universal', 'universal-sheet']);
    const dbs = formats.find((f) => f.id === 'dbs-savings');
    expect(dbs).toMatchObject({ institution: 'DBS', accountType: 'savings', fileTypes: ['pdf'] });
    expect(formats.find((f) => f.id === 'csv')?.fileTypes).toEqual(['csv']);
    for (const f of formats) expect(f.label.length).toBeGreaterThan(3);
  });

  it('accepts PDF and CSV in the file picker', () => {
    expect(ACCEPTED_FILE_TYPES).toContain('.pdf');
    expect(ACCEPTED_FILE_TYPES).toContain('.csv');
  });
});
