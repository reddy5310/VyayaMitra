/**
 * The in-thread implementations of parseStatement / inspectStatement. The public API (index.ts) runs
 * these in a Web Worker in the browser and calls them directly everywhere else (tests, Node, the worker itself).
 */
import type { ParsedStatement } from '@/domain/types';
import { UnsupportedStatementError } from './errors';
import type { ParseOptions, StatementFile, StatementInspection } from './index';
import { parseLayout } from './registry';
import { readSource } from './source';
import { parseTables } from './tables';
import { inspectDocument } from './universal/inspect';
import { sheetToLayout } from './universal/sheet';

/**
 * Parse a statement file.
 * @throws PasswordRequiredError | IncorrectPasswordError | ScannedPdfError | UnsupportedStatementError
 * Never returns a ParsedStatement with zero rows — that throws UnsupportedStatementError instead.
 */
export async function parseDirect(file: StatementFile, opts: ParseOptions = {}): Promise<ParsedStatement> {
  const ctx = { fileName: file.name };
  const source = await readSource(file, opts);
  opts.onProgress?.({ stage: 'parsing', done: 0, total: 1 });
  const layoutOpts = { templates: opts.templates, template: opts.template };
  let st: ParsedStatement;
  if (source.kind === 'pdf') {
    st = parseLayout(source.doc, ctx, layoutOpts);
    if (source.ocr) st = { ...st, warnings: [...st.warnings, 'This PDF was a scan; its text was recognised on this device and may contain small errors. Check the amounts.'] };
  } else {
    st = parseTables(source.tables, ctx, layoutOpts);
    if (source.meta?.accountType) st = { ...st, accountType: source.meta.accountType };
    if (source.meta?.accountMask) st = { ...st, accountMask: source.meta.accountMask };
  }
  opts.onProgress?.({ stage: 'parsing', done: 1, total: 1 });
  return st;
}

/** Analyse a statement's table structure without committing to an interpretation (teach flow). */
export async function inspectDirect(
  file: StatementFile,
  opts: Pick<ParseOptions, 'password' | 'ocr' | 'onProgress'> = {},
): Promise<StatementInspection> {
  const source = await readSource(file, opts);
  if (source.kind === 'pdf') return inspectDocument(source.doc, 'pdf');
  // the sheet with the most dated rows is the one worth teaching
  const scored = source.tables.map((t) => ({ t, n: t.records.filter((r) => r.length > 2).length }));
  scored.sort((x, y) => y.n - x.n);
  const table = scored[0]?.t;
  if (!table) throw new UnsupportedStatementError('The file has no table to read.', []);
  return inspectDocument(sheetToLayout(table.records), 'sheet');
}

