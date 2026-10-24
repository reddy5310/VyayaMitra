/**
 * Spreadsheet adapter: XLS (BIFF), XLSX/XLSM, ODS, SpreadsheetML 2003, and the very common
 * "HTML table saved as .xls" that many Indian banks export. Detection is by content; the file
 * extension is only a hint. The SheetJS library is imported lazily so it stays out of the main bundle.
 */
import type { StatementFile } from '../index';
import { IncorrectPasswordError, PasswordRequiredError, UnsupportedStatementError } from '../errors';
import { containsUtf16, extensionOf, headText, isOle, isPdf, isZip, leadingNonSpace } from './sniff';
import type { SheetTable } from './types';

type XlsxModule = typeof import('xlsx');
type WorkSheet = import('xlsx').WorkSheet;
type CellObject = import('xlsx').CellObject;

const SPREADSHEET_EXT = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'fods']);
const MAX_ROWS = 200_000;
const MAX_COLS = 256;

type Kind = 'zip' | 'ole' | 'html' | 'xml' | null;

/** What kind of spreadsheet container is this, judging by content? */
export function sniffSpreadsheet(file: StatementFile): Kind {
  const b = file.bytes;
  if (b.length < 8 || isPdf(b)) return null;
  const ext = extensionOf(file.name);
  if (isZip(b)) {
    // Local file headers carry entry names in clear text.
    const head = headText(b, 262144);
    const looksOffice =
      head.includes('xl/workbook') ||
      head.includes('xl/_rels') ||
      head.includes('application/vnd.oasis.opendocument.spreadsheet') ||
      (head.includes('[content_types].xml') && head.includes('xl/'));
    return looksOffice || ext === 'xlsx' || ext === 'xlsm' || ext === 'ods' ? 'zip' : null;
  }
  if (isOle(b)) {
    // Legacy workbook streams, or an encrypted OOXML package. Not .doc / .ppt.
    const hit = containsUtf16(b, 'Workbook') || containsUtf16(b, 'EncryptedPackage') || (ext === 'xls' && containsUtf16(b, 'Book'));
    return hit || ext === 'xls' || ext === 'xlsx' ? 'ole' : null;
  }
  const text = leadingNonSpace(headText(b, 262144));
  if (text.startsWith('<')) {
    if (/<table[\s>]/.test(text)) return 'html';
    if (text.includes('urn:schemas-microsoft-com:office:spreadsheet')) return 'xml';
    if (text.includes('<office:document') && text.includes('spreadsheet')) return 'xml';
  }
  return null;
}

export function isSpreadsheet(file: StatementFile): boolean {
  // Extension alone is never enough for non-binary files, but never reject a clear spreadsheet extension on a ZIP/OLE container.
  const ext = extensionOf(file.name);
  if (SPREADSHEET_EXT.has(ext) && (isZip(file.bytes) || isOle(file.bytes))) return true;
  return sniffSpreadsheet(file) !== null;
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // Bank HTML exports are frequently windows-1252; a UTF-8 decode of those leaves replacement characters.
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

/** Number formats Excel stores as "built-in 14" and SheetJS renders US-style (m/d/yy) whatever the bank's locale. */
const US_DATE_FORMATS = new Set(['m/d/yy', 'm/d/yyyy', 'mm-dd-yy', 'mm/dd/yy', 'mm/dd/yyyy', 'm/d/yy h:mm', 'm/d/yyyy h:mm', 'm/d/yy;@', 'm/d/yyyy;@']);

function cellText(X: XlsxModule, cell: CellObject | undefined): string {
  if (!cell || cell.t === 'z' || cell.t === 'e') return '';
  if (cell.t === 'n' && typeof cell.v === 'number' && typeof cell.z === 'string' && US_DATE_FORMATS.has(cell.z.toLowerCase())) {
    // The locale-dependent ambiguity is removed by printing an unambiguous ISO date.
    const d = X.SSF.parse_date_code(cell.v);
    if (d && d.y > 0) return `${String(d.y).padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (cell.t === 'd' && cell.v instanceof Date) {
    const v = cell.v;
    return `${String(v.getUTCFullYear()).padStart(4, '0')}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const raw = cell.w ?? (cell.v === undefined || cell.v === null ? '' : String(cell.v));
  return raw;
}

function clean(s: string): string {
  return s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Sparse sheet → rectangular rows; drops blank rows and fully-blank columns (padding). */
export function sheetToRecords(X: XlsxModule, ws: WorkSheet): string[][] {
  const rows = new Map<number, Map<number, string>>();
  for (const key of Object.keys(ws)) {
    if (key.charAt(0) === '!') continue;
    const { r, c } = X.utils.decode_cell(key);
    if (r >= MAX_ROWS || c >= MAX_COLS) continue;
    const text = clean(cellText(X, ws[key] as CellObject));
    if (text === '') continue;
    let row = rows.get(r);
    if (!row) rows.set(r, (row = new Map()));
    row.set(c, text);
  }
  if (rows.size === 0) return [];
  const usedCols = new Set<number>();
  for (const row of rows.values()) for (const c of row.keys()) usedCols.add(c);
  const cols = [...usedCols].sort((a, b) => a - b);
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const row = rows.get(r)!;
      return cols.map((c) => row.get(c) ?? '');
    });
}

export function mapReadError(e: unknown, hadPassword: boolean): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/password is incorrect/i.test(msg)) throw new IncorrectPasswordError();
  if (/password-protected|ECMA-376|Encryption|encrypted/i.test(msg)) {
    if (!hadPassword && /password-protected/i.test(msg)) throw new PasswordRequiredError();
    throw new UnsupportedStatementError(
      'This workbook is encrypted in a way VyayaMitra cannot open on this device yet.',
      ['Open it in Excel or LibreOffice, save a copy without a password, and import that copy.', 'Or download the statement as PDF or CSV from your net banking.'],
    );
  }
  throw new UnsupportedStatementError('This spreadsheet could not be read.', [msg]);
}

/** @throws PasswordRequiredError / IncorrectPasswordError for protected workbooks. */
export async function readSpreadsheet(file: StatementFile, opts: { password?: string } = {}): Promise<SheetTable[]> {
  const kind = sniffSpreadsheet(file) ?? (isZip(file.bytes) ? 'zip' : isOle(file.bytes) ? 'ole' : null);
  if (!kind) throw new UnsupportedStatementError('This file does not look like a spreadsheet.');
  const X = (await import('xlsx')) as XlsxModule;

  let wb;
  try {
    if (kind === 'html' || kind === 'xml') {
      // raw: keep every cell as the text the bank printed ("01/02/2025", "1,234.50") instead of letting the parser guess types.
      wb = X.read(decodeText(file.bytes), { type: 'string', raw: kind === 'html', cellNF: true, cellText: true });
    } else {
      wb = X.read(new Uint8Array(file.bytes), {
        type: 'array',
        cellNF: true,
        cellText: true,
        cellDates: false,
        password: opts.password,
      });
    }
  } catch (e) {
    mapReadError(e, Boolean(opts.password));
  }

  const tables: SheetTable[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const records = sheetToRecords(X, ws);
    if (records.length > 0) tables.push({ name, records });
  }
  if (tables.length === 0) throw new UnsupportedStatementError('This spreadsheet has no data in it.');
  return tables;
}
