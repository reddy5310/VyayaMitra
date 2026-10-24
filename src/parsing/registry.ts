import type { ParsedStatement, StatementTemplate, TemplateDraft } from '@/domain/types';
import { UnsupportedStatementError } from './errors';
import { parseUniversal } from './universal/engine';
import type { AnyParser, CsvParser, CsvTable, Detection, ParseContext, PdfParser } from './core/types';
import type { LayoutDoc } from './pdf/types';
import { csvParser } from './parsers/csv';
import { dbsSavingsParser } from './parsers/dbsSavings';
import { iciciCreditCardParser } from './parsers/iciciCreditCard';
import { iciciSavingsParser } from './parsers/iciciSavings';
import { universalParser } from './parsers/universal';

/** A parser is only used when it is at least this sure the file is in its format. */
export const DETECTION_THRESHOLD = 0.5;

export const PDF_PARSERS: PdfParser[] = [iciciSavingsParser, dbsSavingsParser, iciciCreditCardParser, universalParser];
export const CSV_PARSERS: CsvParser[] = [csvParser];
export const ALL_PARSERS: AnyParser[] = [...PDF_PARSERS, ...CSV_PARSERS];

export interface Candidate<P extends AnyParser> {
  parser: P;
  detection: Detection;
}

export function rank<P extends AnyParser>(parsers: P[], detect: (p: P) => Detection): Candidate<P>[] {
  return parsers
    .map((parser) => {
      let detection: Detection;
      try {
        detection = detect(parser);
      } catch {
        detection = { confidence: 0, reasons: ['Detection failed'] };
      }
      return { parser, detection };
    })
    .filter((c) => c.detection.confidence >= DETECTION_THRESHOLD)
    .sort((a, b) => b.detection.confidence - a.detection.confidence);
}

const PDF_HINTS = [
  'Download the e-statement PDF from net banking or the bank app (not a photo or a scan).',
  'Supported: ICICI savings and credit-card, DBS savings, and PDFs with Date / Narration / Debit / Credit / Balance columns.',
  'A CSV or Excel-exported CSV of the same statement also works.',
];
const CSV_HINTS = [
  'The file needs a header row with a Date column and either Debit and Credit columns or an Amount column.',
  'Amounts must have a decimal part (for example 1,250.00) or be plain numbers like 1250.5.',
];

/**
 * Run the best matching parser. If it throws or finds no rows, the next candidate is tried.
 * Zero rows overall is an UnsupportedStatementError, never a "successful" empty import.
 */
function runCandidates<P extends AnyParser, I>(
  candidates: Candidate<P>[],
  input: I,
  ctx: ParseContext,
  call: (p: P, input: I, ctx: ParseContext) => ParsedStatement,
  hints: string[],
  what: string,
): ParsedStatement {
  if (candidates.length === 0) {
    throw new UnsupportedStatementError(`This ${what} is not in a format VyayaMitra can read yet.`, hints);
  }
  const notes: string[] = [];
  for (const c of candidates) {
    try {
      const st = call(c.parser, input, ctx);
      if (st.rows.length > 0) return { ...st, detection: c.detection };
      notes.push(`${c.parser.label}: recognised the layout but found no transactions.`);
    } catch (e) {
      notes.push(`${c.parser.label}: could not read it (${e instanceof Error ? e.message : 'unknown error'}).`);
    }
  }
  throw new UnsupportedStatementError(`No transactions could be read from this ${what}.`, [...notes, ...hints]);
}

export interface LayoutOptions {
  templates?: readonly StatementTemplate[];
  template?: StatementTemplate | TemplateDraft;
}

function dedicatedOrUniversal(doc: LayoutDoc, ctx: ParseContext): ParsedStatement {
  const candidates = rank(PDF_PARSERS, (p) => p.detect(doc));
  const st = runCandidates(candidates, doc, ctx, (p, d, c) => p.parse(d, c), PDF_HINTS, 'PDF');
  return st.template ? st : { ...st, template: { source: 'builtin' } };
}

/**
 * Parse a text-layer document. A forced template wins; a stored template that fits and does not
 * reconcile badly wins over the built-in readers; otherwise the best-detected parser runs.
 */
export function parseLayout(doc: LayoutDoc, ctx: ParseContext, opts: LayoutOptions = {}): ParsedStatement {
  if (opts.template) return parseUniversal(doc, { fileName: ctx.fileName, fileKind: 'pdf', template: opts.template });
  let base: ParsedStatement | null = null;
  let baseError: unknown;
  try {
    base = dedicatedOrUniversal(doc, ctx);
  } catch (e) {
    baseError = e;
  }
  if (opts.templates && opts.templates.length > 0) {
    try {
      const viaTemplate = parseUniversal(doc, { fileName: ctx.fileName, fileKind: 'pdf', templates: opts.templates });
      if (viaTemplate.template?.id && viaTemplate.reconciliation.status !== 'mismatch') return viaTemplate;
      if (!base) return viaTemplate;
    } catch {
      /* fall through to the built-in result */
    }
  }
  if (base) return base;
  throw baseError;
}

export function parseCsvTable(table: CsvTable, ctx: ParseContext): ParsedStatement {
  const candidates = rank(CSV_PARSERS, (p) => p.detect(table));
  return runCandidates(candidates, table, ctx, (p, t, c) => p.parse(t, c), CSV_HINTS, 'CSV file');
}
