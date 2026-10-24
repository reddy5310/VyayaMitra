import type { Direction, IsoDate, Paise, RowWarning, SkippedLine, SourceRef } from '@/domain/types';
import type { LayoutDoc, LayoutItem, LayoutLine } from '../pdf/types';
import { cellOf, findHeader, isHeaderLine, type Role, type TableHeader } from './header';
import type { DraftRow } from './reconcile';
import { layoutAmountColumns, splitLine, type AmountRole } from './table';
import { collapse, joinWrapped } from './text';

export interface ColumnarOptions {
  /** Pull a reference out of the joined description, when the bank embeds one. */
  referenceFrom?: (description: string) => string | undefined;
}

export interface ColumnarResult {
  rows: DraftRow[];
  skipped: SkippedLine[];
  openingBalance?: Paise;
  closingBalance?: Paise;
  printedTotals?: { debits?: Paise; credits?: Paise };
  /** Roles present in the header(s) found. */
  roles: Role[];
  headerPages: number[];
  /** Some rows come from a single unsigned amount column, whose direction needs the balance. */
  singleAmountColumn: boolean;
}

const PAGE_FOOTER = /^(page\s+\d+(\s+of\s+\d+)?|\d+\s+of\s+\d+)$/i;
const OPENING = /^(opening balance|balance b\/?f|b\/f|brought forward|previous balance)\b/i;
const CLOSING = /^(closing balance|balance c\/?f|c\/f|carried forward)\b/i;
const TOTAL = /^(grand )?total\b/i;
const TERMINATOR =
  /^(statement summary|summary of|end of statement|\*+\s*end|legends?|important|disclaimer|this is a computer|registered office|notes?:|account related)/i;

interface Pending {
  date: IsoDate;
  valueDate?: IsoDate;
  amount?: Paise;
  direction?: Direction;
  rawSingle?: { negative: boolean };
  balance?: Paise;
  descLines: { text: string; x1: number }[];
  reference?: string;
  page: number;
  lineStart: number;
  lineEnd: number;
  rawLines: string[];
  warnings: RowWarning[];
  lastY: number;
  lastHeight: number;
}

const TYPE_TEXT = /^(dr|cr|debit|credit|d|c)\.?$/i;

function dirFromText(t: string): Direction | undefined {
  const u = t.trim().toLowerCase();
  if (u === 'dr' || u === 'debit' || u === 'd') return 'debit';
  if (u === 'cr' || u === 'credit' || u === 'c') return 'credit';
  return undefined;
}

/**
 * Parse a "date-first" columnar statement (one date line per transaction, wrapped description
 * lines below it). Used by the DBS parser and by the generic columnar parser.
 *
 * Every amount is placed by its position relative to the page's own header row: right-aligned
 * amounts are matched to the column whose (offset-corrected) right edge is nearest. Reference
 * numbers never qualify because an amount must have exactly two decimals.
 */
export function parseColumnar(doc: LayoutDoc, opts: ColumnarOptions = {}): ColumnarResult {
  const rows: DraftRow[] = [];
  const skipped: SkippedLine[] = [];
  const roles = new Set<Role>();
  const headerPages: number[] = [];
  let opening: Paise | undefined;
  let closing: Paise | undefined;
  let totals: { debits?: Paise; credits?: Paise } | undefined;
  let singleAmount = false;

  // Pass 1: collect pending rows
  const pendings: Pending[] = [];
  let lastHeader: TableHeader | null = null;

  for (const page of doc.pages) {
    const found = findHeader(page);
    const header: TableHeader | null = found ?? lastHeader;
    if (!header) continue;
    if (found) {
      headerPages.push(page.page);
      for (const c of found.cells) roles.add(c.role);
    }
    lastHeader = header;
    const body: LayoutLine[] = page.lines.filter((l) => (found ? l.index > found.lastLineIndex : true) && !isHeaderLine(found, l));
    const layout = layoutAmountColumns(header, body);
    const refCell = cellOf(header, 'reference');
    const typeCell = cellOf(header, 'type');
    const hasValueDate = !!cellOf(header, 'valueDate');
    let current: Pending | null = null;

    for (const line of body) {
      const text = line.text;
      if (PAGE_FOOTER.test(text)) continue;
      const cells = splitLine(line, layout);

      if (cells.dates.length === 0) {
        const bal = cells.amounts.find((a) => a.col.role === 'balance') ?? cells.amounts[cells.amounts.length - 1];
        if (OPENING.test(text) && bal) {
          opening ??= bal.money.indicator === 'DR' || bal.money.negative ? -bal.money.paise : bal.money.paise;
          current = null;
          continue;
        }
        if (CLOSING.test(text) && bal) {
          closing = bal.money.indicator === 'DR' || bal.money.negative ? -bal.money.paise : bal.money.paise;
          break;
        }
        if (TOTAL.test(text) && cells.amounts.length > 0) {
          const d = cells.amounts.find((a) => a.col.role === 'debit');
          const c = cells.amounts.find((a) => a.col.role === 'credit');
          totals = { debits: d?.money.paise, credits: c?.money.paise };
          break;
        }
        if (TERMINATOR.test(text)) break;
        if (
          current &&
          cells.amounts.length === 0 &&
          cells.strayMoney.length === 0 &&
          line.y - current.lastY <= 2.3 * Math.max(current.lastHeight, line.height) + 4
        ) {
          const parts = cells.text.filter((i) => !(refCell && inCol(i, refCell)) && !(typeCell && inCol(i, typeCell)));
          if (parts.length > 0) {
            const t = collapse(parts.map((p) => p.text).join(' '));
            current.descLines.push({ text: t, x1: Math.max(...parts.map((p) => p.x1)) });
          }
          const refPart = refCell ? cells.text.filter((i) => inCol(i, refCell)) : [];
          if (refPart.length > 0 && !current.reference) current.reference = collapse(refPart.map((p) => p.text).join(''));
          current.lineEnd = line.index;
          current.rawLines.push(text);
          current.lastY = line.y;
          current.lastHeight = line.height;
        }
        continue;
      }

      // ---- a dated line: start a new transaction ----
      const date = cells.dates[0].iso;
      const valueDate = cells.dates.length > 1 || hasValueDate ? cells.dates[1]?.iso : undefined;
      const byRole = new Map<AmountRole, (typeof cells.amounts)[number][]>();
      for (const a of cells.amounts) {
        const arr = byRole.get(a.col.role) ?? [];
        arr.push(a);
        byRole.set(a.col.role, arr);
      }
      const reasonSkip = (reason: string) =>
        skipped.push({ page: page.page, line: line.index, text, reason });

      if (cells.strayMoney.length > 0) {
        reasonSkip('An amount on this line does not sit under any amount column');
        current = null;
        continue;
      }
      const debit = byRole.get('debit');
      const credit = byRole.get('credit');
      const single = byRole.get('amount');
      const balance = byRole.get('balance');
      if ((debit?.length ?? 0) > 1 || (credit?.length ?? 0) > 1 || (single?.length ?? 0) > 1 || (balance?.length ?? 0) > 1) {
        reasonSkip('More than one amount in the same column');
        current = null;
        continue;
      }
      if (debit && credit) {
        reasonSkip('Both a debit and a credit amount are printed on this line');
        current = null;
        continue;
      }
      const amtTok = debit?.[0] ?? credit?.[0] ?? single?.[0];
      if (amtTok && amtTok.money.paise === 0) {
        reasonSkip('Zero amount');
        current = null;
        continue;
      }
      if (!amtTok) {
        // A dated line with only a balance is an opening-balance style row, not a transaction.
        if (balance?.[0] && cells.text.some((t) => OPENING.test(t.text))) {
          opening ??= balance[0].money.indicator === 'DR' ? -balance[0].money.paise : balance[0].money.paise;
        } else if (balance?.[0]) {
          reasonSkip('Dated line with a balance but no debit or credit amount');
        }
        current = null;
        continue;
      }

      let direction: Direction | undefined;
      let rawSingle: Pending['rawSingle'];
      if (debit) direction = 'debit';
      else if (credit) direction = 'credit';
      else if (amtTok) {
        singleAmount = true;
        direction = amtTok.money.indicator ? (amtTok.money.indicator === 'CR' ? 'credit' : 'debit') : undefined;
        if (!direction && typeCell) {
          const tt = cells.text.find((i) => inCol(i, typeCell) && TYPE_TEXT.test(i.text.trim()));
          if (tt) direction = dirFromText(tt.text);
        }
        if (!direction) rawSingle = { negative: amtTok.money.negative };
      }

      const descItems: LayoutItem[] = [];
      let reference: string | undefined;
      const refParts: LayoutItem[] = [];
      for (const it of cells.text) {
        if (typeCell && inCol(it, typeCell) && TYPE_TEXT.test(it.text.trim())) continue;
        if (refCell && inCol(it, refCell) && !/\s/.test(it.text) && it.text.length >= 3) {
          refParts.push(it);
          continue;
        }
        descItems.push(it);
      }
      if (refParts.length > 0) reference = collapse(refParts.map((p) => p.text).join(' '));

      const bal = balance?.[0]?.money;
      current = {
        date,
        valueDate,
        amount: amtTok.money.paise,
        direction,
        rawSingle,
        balance: bal ? (bal.indicator === 'DR' || bal.negative ? -bal.paise : bal.paise) : undefined,
        descLines:
          descItems.length > 0
            ? [{ text: collapse(descItems.map((d) => d.text).join(' ')), x1: Math.max(...descItems.map((d) => d.x1)) }]
            : [],
        reference,
        page: page.page,
        lineStart: line.index,
        lineEnd: line.index,
        rawLines: [text],
        warnings: [],
        lastY: line.y,
        lastHeight: line.height,
      };
      pendings.push(current);
    }
  }

  // Signed single-column statements: a minus sign (or brackets) marks debits.
  const anyNegative = pendings.some((p) => p.rawSingle?.negative);
  for (const p of pendings) {
    if (p.rawSingle && anyNegative) {
      p.direction = p.rawSingle.negative ? 'debit' : 'credit';
    }
  }

  // Description right-edge limit (to recognise lines cut at the column width)
  let limit = 0;
  for (const p of pendings) for (const d of p.descLines.slice(0, -1)) limit = Math.max(limit, d.x1);

  for (const p of pendings) {
    const description = joinWrapped(p.descLines, limit || undefined);
    const source: SourceRef = { page: p.page, lineStart: p.lineStart, lineEnd: p.lineEnd, rawLines: p.rawLines };
    rows.push({
      date: p.date,
      valueDate: p.valueDate,
      amount: p.amount ?? 0,
      direction: p.direction,
      balanceAfter: p.balance,
      description,
      reference: p.reference ?? opts.referenceFrom?.(description),
      source,
      warnings: p.warnings,
    });
  }

  return {
    rows,
    skipped,
    openingBalance: opening,
    closingBalance: closing,
    printedTotals: totals,
    roles: [...roles],
    headerPages,
    singleAmountColumn: singleAmount,
  };
}

function inCol(item: LayoutItem, cell: { x0: number; x1: number }): boolean {
  return item.x0 < cell.x1 + 6 && item.x1 > cell.x0 - 6;
}

