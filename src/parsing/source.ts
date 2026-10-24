/**
 * Turn any supported file into something the engines read: a text-layer LayoutDoc (PDF, or OCR of a
 * scanned PDF) or one or more tables (spreadsheets, OFX, CSV).
 */
import type { LayoutDoc } from './pdf/types';
import type { ParseProgress, StatementFile } from './index';
import { decodeCsvBytes, readCsv } from './csv/readCsv';
import { ScannedPdfError, UnsupportedStatementError } from './errors';
import { isOfx, isSpreadsheet, ocrPdf, readOfx, readSpreadsheet, type SheetTable } from './adapters';
import { extractLayout } from './pdf/extract';

export interface SourceOptions {
  password?: string;
  ocr?: boolean;
  onProgress?: (p: ParseProgress) => void;
}

export type Source =
  | { kind: 'pdf'; doc: LayoutDoc; ocr: boolean }
  | { kind: 'tables'; tables: SheetTable[]; meta?: { accountType?: 'savings' | 'current' | 'credit_card'; accountMask?: string } };

export function isPdfFile(file: StatementFile): boolean {
  const b = file.bytes;
  const head = String.fromCharCode(...b.subarray(0, Math.min(1024, b.length)));
  if (head.includes('%PDF-')) return true;
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isCsvLike(file: StatementFile): boolean {
  return file.type === 'text/csv' || /\.(csv|txt|tsv)$/i.test(file.name) || file.type === 'application/vnd.ms-excel';
}

export async function readSource(file: StatementFile, opts: SourceOptions = {}): Promise<Source> {
  opts.onProgress?.({ stage: 'reading', done: 0, total: 1 });
  if (isPdfFile(file)) {
    try {
      const doc = await extractLayout(file.bytes, { password: opts.password });
      return { kind: 'pdf', doc, ocr: false };
    } catch (e) {
      if (e instanceof ScannedPdfError && opts.ocr) {
        const doc = await ocrPdf(file, { password: opts.password, onProgress: opts.onProgress });
        return { kind: 'pdf', doc, ocr: true };
      }
      throw e;
    }
  }
  if (isOfx(file)) {
    const o = await readOfx(file);
    return { kind: 'tables', tables: [o.table], meta: { accountType: o.accountType, accountMask: o.accountMask } };
  }
  if (isSpreadsheet(file)) {
    const tables = await readSpreadsheet(file, { password: opts.password });
    return { kind: 'tables', tables };
  }
  if (file.bytes.length === 0) {
    throw new UnsupportedStatementError('The file is empty.', ['Choose the e-statement from your bank.']);
  }
  const text = decodeCsvBytes(file.bytes);
  if (!isCsvLike(file) && !/[,\t;|]/.test(text.slice(0, 4000))) {
    throw new UnsupportedStatementError('This file is not a PDF, spreadsheet, OFX or CSV statement.', [
      'Choose the e-statement PDF from your bank, or a CSV / Excel export of your transactions.',
    ]);
  }
  return { kind: 'tables', tables: [{ name: 'CSV', records: readCsv(text).records }] };
}
