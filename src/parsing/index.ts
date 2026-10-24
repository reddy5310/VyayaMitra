/**
 * CONTRACT — owned by the parsing module.
 * Turns a statement file (PDF or CSV) into a ParsedStatement, entirely on-device.
 */
import type {
  AccountType,
  ColumnRole,
  Institution,
  ParsedStatement,
  StatementTemplate,
  TemplateDraft,
} from '@/domain/types';
import { UnsupportedStatementError } from './errors';
import { ALL_PARSERS, parseLayout } from './registry';
import { readSource } from './source';
import { parseTables } from './tables';
import { draftFromInspection, inspectDocument } from './universal/inspect';
import { sheetToLayout } from './universal/sheet';

export * from './errors';
export { setPdfjsLoader } from './pdf/loader';

export interface StatementFile {
  name: string;
  bytes: Uint8Array;
  /** MIME type if known, e.g. 'application/pdf' or 'text/csv'. */
  type?: string;
}

export interface SupportedFormat {
  id: string;
  label: string;
  institution: Institution;
  accountType: AccountType | 'any';
  fileTypes: ('pdf' | 'csv' | 'xlsx' | 'xls' | 'ofx')[];
  notes?: string;
}

// ─── Universal engine + self-training contract (wave 2) ──────────────────────

export interface ParseProgress {
  stage: 'reading' | 'ocr' | 'parsing';
  done: number;
  total: number;
  message?: string;
}

export interface ParseOptions {
  password?: string;
  /** Stored templates (learned, taught or imported). A template whose signature matches is tried first. */
  templates?: readonly StatementTemplate[];
  /** Parse with exactly this template (the "teach this format" flow). */
  template?: StatementTemplate | TemplateDraft;
  /** Allow on-device OCR when a PDF has no text layer. Off by default: OCR is slow and loads ~15 MB once. */
  ocr?: boolean;
  onProgress?: (p: ParseProgress) => void;
}

export interface InspectedColumn {
  id: string;
  header?: string;
  /** PDF geometry in points (numbers align by right edge). */
  x0?: number;
  x1?: number;
  /** Sheet/CSV column index. */
  index?: number;
  /** A few example cell values, top to bottom. */
  samples: string[];
  guessedRole: ColumnRole;
  /** 0..1 confidence in guessedRole. */
  confidence: number;
}

/** What the universal engine sees in a statement, for the "Teach VyayaMitra this format" screen. */
export interface StatementInspection {
  fileKind: 'pdf' | 'sheet';
  institutionGuess: Institution;
  accountTypeGuess: AccountType;
  /** Lower-case marker phrases found (bank name, domain, card brand) — no personal data. */
  markers: string[];
  headerTokens: string[];
  columns: InspectedColumn[];
  /** Up to ~40 table rows in reading order; cells keyed by column id. */
  previewRows: { page?: number; cells: Record<string, string> }[];
  guesses: {
    dateOrder: 'DMY' | 'MDY' | 'YMD';
    descriptionLayout: 'single' | 'below' | 'above' | 'centered';
    amountStyle: 'split' | 'signed' | 'drcr_suffix' | 'drcr_column';
  };
}

export interface TemplateMapping {
  /** Role for every inspected column id (unlisted columns are ignored). */
  roles: Record<string, ColumnRole>;
  dateOrder?: StatementInspection['guesses']['dateOrder'];
  descriptionLayout?: StatementInspection['guesses']['descriptionLayout'];
  amountStyle?: StatementInspection['guesses']['amountStyle'];
  institution?: Institution;
  accountType?: AccountType;
  name?: string;
}

/**
 * Parse a statement file.
 * @throws PasswordRequiredError | IncorrectPasswordError | ScannedPdfError | UnsupportedStatementError
 * Never returns a ParsedStatement with zero rows — that throws UnsupportedStatementError instead.
 */
export async function parseStatement(file: StatementFile, opts: ParseOptions = {}): Promise<ParsedStatement> {
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

/** Formats with dedicated parsers, plus the universal readers, for the Import screen's list. */
export function listSupportedFormats(): SupportedFormat[] {
  const dedicated = ALL_PARSERS.filter((p) => p.id !== 'universal').map((p) => ({
    id: p.id,
    label: p.label,
    institution: p.institution,
    accountType: p.accountType,
    fileTypes: p.fileTypes as SupportedFormat['fileTypes'],
    notes: p.notes,
  }));
  const universal: SupportedFormat[] = [
    {
      id: 'universal',
      label: 'Universal: any bank or credit-card statement PDF',
      institution: 'OTHER',
      accountType: 'any',
      fileTypes: ['pdf'],
      notes:
        'Reads the transaction table of any bank (private, public, small finance, payments, co-operative, foreign) or any credit card, with or without printed headers, English or Hindi. Scanned PDFs can be read with on-device OCR.',
    },
    {
      id: 'universal-sheet',
      label: 'Universal: Excel, OpenDocument, CSV or OFX/QFX export',
      institution: 'OTHER',
      accountType: 'any',
      fileTypes: ['xlsx', 'xls', 'csv', 'ofx'],
      notes: 'Spreadsheet and CSV exports from net banking, including HTML tables saved as .xls, and OFX/QFX files.',
    },
  ];
  return [...dedicated, ...universal];
}

/** Analyse a statement's table structure without committing to an interpretation (teach flow). */
export async function inspectStatement(
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

/** Turn the user's column mapping into a reusable template draft (no personal data). */
export function draftTemplate(inspection: StatementInspection, mapping: TemplateMapping): TemplateDraft {
  return draftFromInspection(inspection, mapping);
}

/** File types the Import picker should accept. */
export const ACCEPTED_FILE_TYPES =
  '.pdf,application/pdf,.csv,text/csv,.xls,.xlsx,.xlsm,.ods,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.ofx,.qfx,.txt';
