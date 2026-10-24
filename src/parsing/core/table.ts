import type { IsoDate } from '@/domain/types';
import type { LayoutItem, LayoutLine } from '../pdf/types';
import { cellOf, type HeaderCell, type Role, type TableHeader } from './header';
import { readDate, readMoney, splitLeadingDate, type Money } from './text';

/** Money-bearing column roles. */
export type AmountRole = 'debit' | 'credit' | 'amount' | 'balance';

export interface AmountColumn {
  role: AmountRole;
  /** Header right edge. */
  x1: number;
  x0: number;
  /** Expected right edge of the amounts under this header (header edge + page offset). */
  expected: number;
}

export interface AmountLayout {
  columns: AmountColumn[];
  /** Distance an amount token may be from `expected` and still be assigned to the column. */
  tolerance: number;
  offset: number;
}

const AMOUNT_ROLES: AmountRole[] = ['debit', 'credit', 'amount', 'balance'];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** All tokens on a line that read as money (2 decimals) with their items. */
export function moneyItems(line: LayoutLine): { item: LayoutItem; money: Money }[] {
  const out: { item: LayoutItem; money: Money }[] = [];
  for (const item of line.items) {
    const money = readMoney(item.text);
    if (money) out.push({ item, money });
  }
  return out;
}

/**
 * Work out where the amounts of each money column sit on this page.
 *
 * Amounts are right-aligned under their header, but the header can be offset from the amounts (a
 * centred "Debit" label sits well left of a right-aligned 5,000.00). The offset is measured on the
 * page itself from the right-most money column, which is populated on (almost) every row.
 */
export function layoutAmountColumns(header: TableHeader, bodyLines: LayoutLine[]): AmountLayout {
  const cells = header.cells.filter((c): c is HeaderCell & { role: AmountRole } => AMOUNT_ROLES.includes(c.role as AmountRole));
  cells.sort((a, b) => a.x1 - b.x1);
  const last = cells[cells.length - 1];
  let offset = 0;
  if (last) {
    const cx = (last.x0 + last.x1) / 2;
    const rights: number[] = [];
    for (const l of bodyLines) {
      for (const { item } of moneyItems(l)) if (item.x1 >= cx - 3) rights.push(item.x1);
    }
    if (rights.length > 0) {
      const o = median(rights) - last.x1;
      if (Math.abs(o) <= 60) offset = o;
    }
  }
  const columns: AmountColumn[] = cells.map((c) => ({
    role: c.role,
    x0: c.x0,
    x1: c.x1,
    expected: c.x1 + offset,
  }));
  let minGap = Infinity;
  for (let i = 1; i < columns.length; i++) minGap = Math.min(minGap, columns[i].expected - columns[i - 1].expected);
  const tolerance = Number.isFinite(minGap) ? Math.max(6, Math.min(minGap * 0.45, 40)) : 30;
  return { columns, tolerance, offset };
}

/** Which money column does a token belong to? Null when it sits in none (not an amount). */
export function assignAmountColumn(item: LayoutItem, layout: AmountLayout): AmountColumn | null {
  let best: AmountColumn | null = null;
  let bestD = Infinity;
  for (const c of layout.columns) {
    const d = Math.abs(item.x1 - c.expected);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best && bestD <= layout.tolerance) return best;
  // Fallback: the token's centre lies under exactly one header's span.
  const cx = (item.x0 + item.x1) / 2;
  const under = layout.columns.filter((c) => cx >= c.x0 - 12 && cx <= c.x1 + 12);
  return under.length === 1 ? under[0] : null;
}

export interface RowCells {
  dates: { iso: IsoDate; item: LayoutItem }[];
  amounts: { col: AmountColumn; money: Money; item: LayoutItem }[];
  /** Money-looking tokens that sit in no money column. */
  strayMoney: { money: Money; item: LayoutItem }[];
  /** Everything else, left to right. */
  text: LayoutItem[];
}

/**
 * pdf.js sometimes glues neighbouring cells into one item ("05-06-2024 CMS TRANSACTION" or two dates).
 * Split leading dates off such items, estimating x from the character position.
 */
export function explodeDates(items: LayoutItem[]): LayoutItem[] {
  const out: LayoutItem[] = [];
  for (const item of items) {
    let rest = item.text;
    let x0 = item.x0;
    const width = item.x1 - item.x0;
    const total = item.text.length || 1;
    let split = false;
    for (;;) {
      const lead = splitLeadingDate(rest);
      if (!lead || (lead.rest === '' && !split)) break;
      const used = item.text.length - rest.length + lead.dateText.length;
      const x1 = item.x0 + (width * used) / total;
      out.push({ text: lead.dateText, x0, x1 });
      split = true;
      rest = lead.rest;
      x0 = item.x0 + (width * (item.text.length - rest.length)) / total;
      if (rest === '') break;
    }
    if (!split) out.push(item);
    else if (rest !== '') out.push({ text: rest, x0, x1: item.x1 });
  }
  return out;
}

/** Break a line into dates, column-assigned amounts and the remaining text. */
export function splitLine(line: LayoutLine, layout: AmountLayout): RowCells {
  const dates: RowCells['dates'] = [];
  const amounts: RowCells['amounts'] = [];
  const strayMoney: RowCells['strayMoney'] = [];
  const text: LayoutItem[] = [];
  for (const item of explodeDates(line.items)) {
    const iso = readDate(item.text);
    if (iso) {
      dates.push({ iso, item });
      continue;
    }
    const money = readMoney(item.text);
    if (money) {
      const col = assignAmountColumn(item, layout);
      if (col) {
        amounts.push({ col, money, item });
        continue;
      }
      // A money-looking token left of every amount column is part of the description.
      const firstCol = layout.columns[0];
      if (firstCol && item.x1 > firstCol.expected - layout.tolerance * 2) {
        strayMoney.push({ money, item });
        continue;
      }
    }
    text.push(item);
  }
  return { dates, amounts, strayMoney, text };
}

export function roleX(h: TableHeader, role: Role): HeaderCell | undefined {
  return cellOf(h, role);
}
