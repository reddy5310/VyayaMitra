import type { AccountType, Direction, Paise, ParsedStatement, SkippedLine } from '@/domain/types';
import { finishStatement } from '../core/build';
import { matchRole, type Role } from '../core/header';
import type { DraftRow } from '../core/reconcile';
import { decimalStringToPaise, readDate, readMoney } from '../core/text';
import type { CsvParser, CsvTable, Detection, ParseContext } from '../core/types';

export const CSV_ID = 'csv';
const VERSION = 1;

interface CsvLayout {
  headerIndex: number;
  cols: Partial<Record<Role, number>>;
  /** Exactly the legacy SmartSpend export header. */
  legacy: boolean;
}

const LEGACY_HEADER = ['date', 'description', 'category', 'type', 'amount', 'confidence', 'source file'];

function findLayout(table: CsvTable): CsvLayout | null {
  const limit = Math.min(table.records.length, 40);
  for (let i = 0; i < limit; i++) {
    const rec = table.records[i];
    if (rec.length < 3) continue;
    const cols: Partial<Record<Role, number>> = {};
    rec.forEach((cell, idx) => {
      const role = matchRole(cell);
      if (role && cols[role] === undefined) cols[role] = idx;
    });
    const hasMoney = cols.debit !== undefined || cols.credit !== undefined || cols.amount !== undefined;
    if (cols.date !== undefined && hasMoney) {
      const legacy = rec.length === LEGACY_HEADER.length && rec.every((c, k) => c.trim().toLowerCase() === LEGACY_HEADER[k]);
      return { headerIndex: i, cols, legacy };
    }
  }
  return null;
}

/** Date cell → ISO. Tolerates a trailing time ("2024-06-03 10:20:00", "03/06/2024 10:20"). */
function cellDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return readDate(t) ?? readDate(t.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|\s?[AaPp][Mm])?$/, ''));
}

/** Amount cell → paise (always read from text; never through floats). */
function cellAmount(raw: string): { paise: Paise; indicator?: 'CR' | 'DR'; negative: boolean } | null {
  const t = raw.trim();
  if (!t) return null;
  const m = readMoney(t);
  if (m) return { paise: m.paise, indicator: m.indicator, negative: m.negative };
  // Plain numbers from spreadsheets / apps: "1234.5", "1234", "1,234". Reject anything else.
  const plain = decimalStringToPaise(t.replace(/\s*(CR|DR)\.?$/i, '').replace(/^\((.*)\)$/, '-$1'));
  if (plain === null) return null;
  const ind = /\b(CR|DR)\.?$/i.exec(t);
  return { paise: Math.abs(plain), indicator: ind ? (ind[1].toUpperCase() as 'CR' | 'DR') : undefined, negative: plain < 0 };
}

function directionFromText(t: string): Direction | undefined {
  const u = t.trim().toLowerCase();
  if (['debit', 'dr', 'd', 'withdrawal', 'expense', 'debited', 'paid'].includes(u)) return 'debit';
  if (['credit', 'cr', 'c', 'deposit', 'income', 'credited', 'received'].includes(u)) return 'credit';
  return undefined;
}

function detect(table: CsvTable): Detection {
  const layout = findLayout(table);
  if (!layout) return { confidence: 0, reasons: ['No header row with a date column and an amount / debit / credit column'] };
  const data = table.records.slice(layout.headerIndex + 1).filter((r) => r.some((c) => c.trim() !== ''));
  const dated = data.filter((r) => cellDate(r[layout.cols.date ?? 0] ?? '') !== null).length;
  if (dated === 0) return { confidence: 0, reasons: ['Header found but no row has a readable date'] };
  const reasons = [layout.legacy ? 'SmartSpend export header' : 'CSV header with date and amount columns', `${dated} dated rows`];
  return { confidence: layout.legacy ? 0.97 : 0.9, reasons };
}

function accountTypeFromName(name: string): AccountType {
  const n = name.toLowerCase();
  if (/credit|card|\bcc\b/.test(n)) return 'credit_card';
  if (/current/.test(n)) return 'current';
  return 'savings';
}

function parse(table: CsvTable, ctx: ParseContext): ParsedStatement {
  const detection = detect(table);
  const layout = findLayout(table);
  const rows: DraftRow[] = [];
  const skipped: SkippedLine[] = [];
  if (!layout) {
    return finishStatement({
      parserId: CSV_ID,
      parserVersion: VERSION,
      institution: 'OTHER',
      accountType: accountTypeFromName(ctx.fileName),
      rows,
      skipped,
      detection,
    });
  }
  const c = layout.cols;
  const get = (rec: string[], idx: number | undefined) => (idx === undefined ? '' : (rec[idx] ?? '').trim());

  interface Cand extends DraftRow {
    signed?: boolean;
  }
  const cands: Cand[] = [];
  let anyNegativeSingle = false;
  let usedSingle = false;

  for (let r = layout.headerIndex + 1; r < table.records.length; r++) {
    const rec = table.records[r];
    const raw = rec.join(',');
    const date = cellDate(get(rec, c.date));
    const debit = cellAmount(get(rec, c.debit));
    const credit = cellAmount(get(rec, c.credit));
    const single = cellAmount(get(rec, c.amount));
    const hasAmountText = [c.debit, c.credit, c.amount].some((i) => get(rec, i) !== '');
    const skip = (reason: string) => skipped.push({ page: 1, line: r, text: raw, reason });

    if (!date) {
      if (hasAmountText) skip('Amount present but the date could not be read');
      continue;
    }
    if (!debit && !credit && !single) {
      if (hasAmountText) skip('The amount could not be read');
      continue;
    }
    if (debit && credit && debit.paise > 0 && credit.paise > 0) {
      skip('Both a debit and a credit amount are filled in');
      continue;
    }
    const picked = debit && debit.paise > 0 ? debit : credit && credit.paise > 0 ? credit : single;
    if (!picked || picked.paise === 0) {
      skip('Zero amount');
      continue;
    }

    let direction: Direction | undefined;
    let isSingle = false;
    if (picked === debit) direction = 'debit';
    else if (picked === credit) direction = 'credit';
    else {
      isSingle = true;
      usedSingle = true;
      const typeText = get(rec, c.type);
      direction = typeText ? directionFromText(typeText) : undefined;
      if (typeText && !direction) {
        skip(`Unrecognised Type value "${typeText}"`);
        continue;
      }
      if (!direction && picked.indicator) direction = picked.indicator === 'CR' ? 'credit' : 'debit';
      if (picked.negative) anyNegativeSingle = true;
    }

    const balText = get(rec, c.balance);
    const bal = balText ? cellAmount(balText) : null;
    const valueDate = c.valueDate !== undefined ? (cellDate(get(rec, c.valueDate)) ?? undefined) : undefined;
    cands.push({
      date,
      valueDate,
      amount: picked.paise,
      direction,
      balanceAfter: bal ? (bal.indicator === 'DR' || bal.negative ? -bal.paise : bal.paise) : undefined,
      description: get(rec, c.description),
      reference: get(rec, c.reference) || undefined,
      source: { page: 1, lineStart: r, lineEnd: r, rawLines: [raw] },
      warnings: [],
      signed: isSingle && picked.negative,
    });
  }

  // A single signed column: negative = money out, positive = money in (only when the file uses signs).
  for (const cand of cands) {
    if (cand.direction === undefined && usedSingle && anyNegativeSingle) cand.direction = cand.signed ? 'debit' : 'credit';
    delete cand.signed;
    rows.push(cand);
  }

  return finishStatement({
    parserId: CSV_ID,
    parserVersion: VERSION,
    institution: 'OTHER',
    accountType: accountTypeFromName(ctx.fileName),
    rows,
    skipped,
    detection,
  });
}

export const csvParser: CsvParser = {
  kind: 'csv',
  id: CSV_ID,
  version: VERSION,
  label: 'CSV transaction export',
  institution: 'OTHER',
  accountType: 'any',
  fileTypes: ['csv'],
  notes: 'Any CSV with a Date column and Debit/Credit columns, or one Amount column with a Type column or signed amounts. Also reads the old SmartSpend export.',
  detect,
  parse,
};
