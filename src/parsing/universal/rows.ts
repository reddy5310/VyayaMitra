/**
 * The universal row builder: turns the lines of a LayoutDoc plus per-page column models into
 * draft transactions. It handles date-first, serial-first and description-first tables, wrapped
 * descriptions below / above / centred on the date line, page-break stitching, year-less dates,
 * add-on card sections and signed / Dr-Cr / split amount styles.
 */
import type { Direction, IsoDate, Paise, RowWarning, SkippedLine, SourceRef } from '@/domain/types';
import { attributeBlocks, type BlockDateLine } from '../core/blocks';
import { matchRole, type Role } from '../core/header';
import type { DraftRow } from '../core/reconcile';
import { assignAmountColumn, type AmountColumn } from '../core/table';
import { collapse, decimalStringToPaise, joinWrapped, readMoney, type Money, type WrappedLine } from '../core/text';
import type { LayoutDoc, LayoutItem, LayoutLine } from '../pdf/types';
import { leadingDateText, parseDateTok, resolveDate, type DateOrder, type DateTok } from './dates';
import { findForeign, type ForeignAmount } from './foreign';
import { cardMaskOf } from './knowledge';
import { findPeriod } from '../core/meta';
import { MONEY_ROLES, type PageModel, type UCol } from './model';

export type DescMode = 'single' | 'below' | 'above' | 'centered';

export interface BuildCtx {
  order: DateOrder;
  /** Statement end date, used to give year-less dates a year. */
  end?: IsoDate;
  /** Sheet documents: columns are exact, numbers may lack decimals, no wrap limit. */
  sheet: boolean;
  /** "page:index" of lines to ignore (page furniture). */
  skipLines: ReadonlySet<string>;
  mode: 'auto' | Exclude<DescMode, 'single'>;
}

export interface RowSignal {
  negative: boolean;
  plus: boolean;
}

export interface BuildResult {
  rows: DraftRow[];
  /** Parallel to rows: sign information for rows whose direction the columns did not state. */
  signals: (RowSignal | null)[];
  skipped: SkippedLine[];
  opening?: Paise;
  closing?: Paise;
  totals?: { debits?: Paise; credits?: Paise };
  mode: DescMode;
  cardMasks: string[];
  usedAmountColumn: boolean;
  /** Some amount carried a CR / DR suffix. */
  usedIndicator: boolean;
  hasBalance: boolean;
  yearless: number;
  unresolvedYears: number;
  dateTexts: string[];
  /** Average centring error (points) of the centred layout, for diagnostics. */
  centredCost: number;
}

const OPENING = /^(opening balance|balance b\/?f|b\/f|brought forward|previous balance|opening bal)\b/i;
const CLOSING = /^(closing balance|balance c\/?f|c\/f|carried forward|closing bal)\b/i;
const TOTAL = /^(grand )?total\b/i;
const TERMINATOR =
  /^(statement summary|summary of|end of statement|\*+\s*end|legends?|important|disclaimer|this is a computer|registered office|notes?:|account related|abbreviations|transaction total|nomination)/i;
/** Section headings on card statements that must never be read as a wrapped description. */
const SECTION =
  /^(domestic|international|foreign)( transactions?)?$|^(transactions?|purchases?|payments?|installments?|instalments?|cash|fees?|charges?|taxes|credits?|reversals?|refunds?|card transactions?|summary|continued|account summary|opening balance)( ?(&|and|-) ?(installments?|instalments?|charges?|fees?|credits?|reversals?|emis?|cash|payments?|purchases?))*( details| summary)?( for .*)?$|^(primary|add-?on) card|interest rate|rate applicable|p\.m\.|p\.a\./i;
/** A dated line that is really a summary row ("15SEP NET OUTSTANDING BALANCE 506,515.57"), never a transaction. */
export const SUMMARY_ROW = /^(net )?(outstanding|closing|opening) balance|^total (purchase|cash|balance|outstanding|amount|payment|due|credit|debit)|^(minimum|credit limit|available (credit|limit)|statement (date|period)|previous balance|payment due)/i;
const END_OF_STATEMENT = /end of (the )?statement/i;
const PERIOD_BANNER = /statement period|billing period|period\s*:/i;
const DRCR_WORD = /^(dr|cr|debit|credit|d|c)\.?$/i;

type Kind = 'D' | 'C' | 'X';

interface PItem {
  item: LayoutItem;
  role: Role | null;
}

interface PLine {
  line: LayoutLine;
  page: number;
  kind: Kind;
  text: string;
  items: LayoutItem[];
  textItems: PItem[];
  dates: { tok: DateTok; item: LayoutItem }[];
  money: { col: AmountColumn; money: Money; item: LayoutItem }[];
  card?: string;
  drcrWord?: string;
  foreign?: ForeignAmount;
}

interface PageSeq {
  page: number;
  model: PageModel;
  lines: PLine[];
  descLo: number;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** The text column an item belongs to: largest horizontal overlap, else the nearest centre within reach. */
function textColOf(item: LayoutItem, cols: UCol[]): UCol | null {
  let best: UCol | null = null;
  let bestOv = 0;
  for (const c of cols) {
    const ov = overlap(item.x0, item.x1, c.x0, c.x1);
    if (ov > bestOv) {
      bestOv = ov;
      best = c;
    }
  }
  if (best) return best;
  const cx = (item.x0 + item.x1) / 2;
  let near: UCol | null = null;
  let nearD = 24;
  for (const c of cols) {
    const d = Math.abs(cx - (c.x0 + c.x1) / 2);
    if (d < nearD) {
      nearD = d;
      near = c;
    }
  }
  return near;
}

function lenientMoney(text: string): Money | null {
  const strict = readMoney(text);
  if (strict) return strict;
  const m = /^(.*?)(?:\s*\(?\s*(cr|dr)\s*\)?\.?)?$/i.exec(text.trim());
  if (!m) return null;
  const body = m[1].trim().replace(/^(₹|`|Rs\.?|INR)\s*/i, '');
  if (!/^[+-]?\(?\d[\d,]*(\.\d+)?\)?$/.test(body)) return null;
  const neg = /^-|^\(.*\)$/.test(body);
  const paise = decimalStringToPaise(body.replace(/[()]/g, '').replace(/^\+/, ''));
  if (paise === null) return null;
  return {
    paise: Math.abs(paise),
    indicator: m[2] ? (m[2].toUpperCase() as 'CR' | 'DR') : undefined,
    negative: neg || paise < 0,
    plus: body.startsWith('+') || undefined,
  };
}

function explodeLeadingDates(items: LayoutItem[], order: DateOrder): LayoutItem[] {
  const out: LayoutItem[] = [];
  for (const item of items) {
    const lead = leadingDateText(item.text, order);
    if (!lead || lead.rest === '') {
      out.push(item);
      continue;
    }
    const total = item.text.length || 1;
    const width = item.x1 - item.x0;
    const cut = item.x0 + (width * lead.dateText.length) / total;
    out.push({ text: lead.dateText, x0: item.x0, x1: cut });
    out.push({ text: lead.rest, x0: item.x0 + (width * (item.text.length - lead.rest.length)) / total, x1: item.x1 });
  }
  return out;
}

function isHeaderish(items: LayoutItem[]): boolean {
  if (items.length < 2) return false;
  const hits = items.filter((i) => matchRole(i.text) !== null).length;
  return hits >= 2 && hits >= items.length * 0.6;
}

function classify(line: LayoutLine, model: PageModel, ctx: BuildCtx): PLine {
  const dateCol = model.cols.find((c) => c.role === 'date');
  const valueCol = model.cols.find((c) => c.role === 'valueDate');
  const moneyCols = model.cols.filter((c) => MONEY_ROLES.includes(c.role));
  const textCols = model.cols.filter((c) => !MONEY_ROLES.includes(c.role) && c.role !== 'foreign');
  const base: PLine = { line, page: line.page, kind: 'X', text: line.text, items: [], textItems: [], dates: [], money: [] };

  let items = line.items;
  const leftOfDate = dateCol ? model.cols.filter((c) => c !== dateCol && c.role !== 'serial' && c.x1 <= dateCol.x0 + 2) : [];
  if (dateCol && !ctx.sheet && leftOfDate.length === 0) {
    // the left sidebar (spend charts, offers) lies left of the date column
    const serialCol = model.cols.find((c) => c.role === 'serial');
    const cutoff = (serialCol ? Math.min(serialCol.x0, dateCol.x0) : dateCol.x0) - 6;
    items = items.filter((i) => i.x1 > cutoff);
  }
  items = explodeLeadingDates(items, ctx.order);
  // an original foreign-currency amount ("25 USD") is kept apart from the INR amount and the description
  const fx = findForeign(items);
  if (fx) {
    base.foreign = fx.foreign;
    items = items.filter((i) => !fx.used.includes(i));
  }
  base.items = items;
  base.text = collapse(items.map((i) => i.text).join(' '));
  if (items.length === 0) return base;

  const firstOnLine = items[0];
  for (const item of items) {
    const col = textColOf(item, [...textCols, ...moneyCols, ...model.cols.filter((c) => c.role === 'foreign')]);
    const role = col?.role ?? null;
    // foreign-currency amounts and ignored columns
    if (role === 'foreign') continue;
    if (role === 'serial') continue;
    // dates
    const tok = parseDateTok(item.text, ctx.order);
    if (tok && !(readMoney(item.text) && tok.y === undefined)) {
      const inDateCol = role === 'date' || role === 'valueDate';
      if (tok.y !== undefined || inDateCol || (!dateCol && item === firstOnLine)) {
        base.dates.push({ tok, item });
        continue;
      }
    }
    // money
    let money = readMoney(item.text);
    if (!money && ctx.sheet && col && MONEY_ROLES.includes(col.role)) money = lenientMoney(item.text);
    if (money) {
      const amountCol = assignAmountColumn(item, model.layout);
      if (amountCol) {
        // a foreign column that is closer than the assigned one takes the token
        const dAssigned = Math.abs(item.x1 - amountCol.expected);
        if (model.foreign.some((f) => Math.abs(item.x1 - f) < dAssigned)) continue;
        base.money.push({ col: amountCol, money, item });
        continue;
      }
      if (role === 'skip' || model.foreign.some((f) => Math.abs(item.x1 - f) <= model.layout.tolerance)) continue;
      const first = model.layout.columns[0];
      if (first && item.x1 > first.expected - model.layout.tolerance * 2) {
        base.money.push({ col: { role: 'amount', x0: item.x0, x1: item.x1, expected: item.x1 }, money, item });
        (base.money[base.money.length - 1] as { stray?: boolean }).stray = true;
        continue;
      }
    }
    // a Dr / Cr marker sitting in a money or type column
    const rightmostMoney = moneyCols.length > 0 ? Math.max(...moneyCols.map((c) => c.x1)) : Infinity;
    if (DRCR_WORD.test(item.text.trim()) && (role === 'type' || (col && MONEY_ROLES.includes(col.role)) || item.x0 >= rightmostMoney - 2)) {
      base.drcrWord = item.text.trim();
      continue;
    }
    if (col && MONEY_ROLES.includes(col.role)) continue;
    base.textItems.push({ item, role });
  }
  void valueCol;
  return base;
}

function isStray(m: PLine['money'][number]): boolean {
  return (m as { stray?: boolean }).stray === true;
}

/** Sort dates into transaction date and value date by column, else by position. */
function pickDates(dates: PLine['dates'], model: PageModel): { main: DateTok; value?: DateTok } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort((a, b) => a.item.x0 - b.item.x0);
  const valueCol = model.cols.find((c) => c.role === 'valueDate');
  const dateCol = model.cols.find((c) => c.role === 'date');
  if (valueCol && dateCol) {
    const inValue = sorted.find((d) => overlap(d.item.x0, d.item.x1, valueCol.x0, valueCol.x1) > 0);
    const inDate = sorted.find((d) => d !== inValue && overlap(d.item.x0, d.item.x1, dateCol.x0, dateCol.x1) > 0);
    const main = inDate ?? sorted.find((d) => d !== inValue) ?? sorted[0];
    const value = inValue && inValue !== main ? inValue : sorted.find((d) => d !== main);
    return { main: main.tok, value: value?.tok };
  }
  return { main: sorted[0].tok, value: sorted[1]?.tok };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
}

export function buildRows(doc: LayoutDoc, modelFor: (page: number) => PageModel | null, ctx: BuildCtx): BuildResult {
  const skipped: SkippedLine[] = [];
  const cardMasks: string[] = [];
  let opening: Paise | undefined;
  let closing: Paise | undefined;
  let totals: BuildResult['totals'];
  let currentCard: string | undefined;
  let seenRow = false;
  const dateTexts: string[] = [];
  const seqs: PageSeq[] = [];
  let ended = false;

  // ── pass 1: classify every line ──────────────────────────────────────────────
  for (const page of doc.pages) {
    if (ended) break;
    const model = modelFor(page.page);
    if (!model) continue;
    const plines: PLine[] = [];
    let stop = false;
    for (const line of page.lines) {
      if (stop) break;
      if (line.index <= model.skipThrough) continue;
      if (ctx.skipLines.has(`${page.page}:${line.index}`)) continue;
      const pl = classify(line, model, ctx);
      if (pl.items.length === 0) continue;
      if (pl.dates.length === 0 && isHeaderish(pl.items)) continue;
      const text = pl.text;
      const hasDate = pl.dates.length > 0;
      const stray = pl.money.some(isStray);
      const real = pl.money.filter((m) => !isStray(m));

      if (!hasDate) {
        const bal = real.find((m) => m.col.role === 'balance') ?? real[real.length - 1];
        if (OPENING.test(text) && bal) {
          const v = bal.money.indicator === 'DR' || bal.money.negative ? -bal.money.paise : bal.money.paise;
          // before the first row the nearest opening-balance line wins; afterwards the first one does
          if (!seenRow) opening = v;
          else opening ??= v;
          continue;
        }
        const armed = seenRow || model.skipThrough >= 0;
        if (armed && CLOSING.test(text) && bal) {
          closing = bal.money.indicator === 'DR' || bal.money.negative ? -bal.money.paise : bal.money.paise;
          stop = true;
          continue;
        }
        if (armed && TOTAL.test(text) && real.length > 0) {
          const d = real.find((m) => m.col.role === 'debit');
          const c = real.find((m) => m.col.role === 'credit');
          totals = { debits: d?.money.paise, credits: c?.money.paise };
          const tb = real.find((m) => m.col.role === 'balance');
          if (tb && closing === undefined) closing = tb.money.indicator === 'DR' || tb.money.negative ? -tb.money.paise : tb.money.paise;
          stop = true;
          continue;
        }
        if (END_OF_STATEMENT.test(text) && pl.money.length === 0) {
          ended = true;
          stop = true;
          continue;
        }
        if (armed && TERMINATOR.test(text)) {
          stop = true;
          continue;
        }
        const mask = pl.money.length === 0 && (pl.textItems.length <= 3 || /card/i.test(text)) ? cardMaskOf(text) : undefined;
        if (mask) {
          currentCard = mask;
          if (!cardMasks.includes(mask)) cardMasks.push(mask);
          continue;
        }
        // the statement-period banner above the first row is metadata, never description text
        if (PERIOD_BANNER.test(text) || (pl.money.length === 0 && findPeriod(text))) continue;
        if (pl.money.length === 0 && pl.textItems.length > 0 && !SECTION.test(text)) {
          pl.kind = 'C';
          plines.push(pl);
        }
        continue;
      }

      // dated line
      const amountTokens = real.filter((m) => m.col.role !== 'balance');
      const skipLine = (reason: string) => skipped.push({ page: page.page, line: line.index, text, reason });
      if (stray) {
        skipLine('An amount on this line does not sit under any amount column');
        continue;
      }
      if (real.length === 0) continue;
      const byRole = new Map<string, number>();
      for (const m of real) byRole.set(m.col.role, (byRole.get(m.col.role) ?? 0) + 1);
      if ([...byRole.values()].some((n) => n > 1)) {
        skipLine('More than one amount in the same column');
        continue;
      }
      if (amountTokens.length === 0) {
        if (OPENING.test(pl.textItems.map((t) => t.item.text).join(' '))) {
          const b = real[0];
          opening ??= b.money.indicator === 'DR' || b.money.negative ? -b.money.paise : b.money.paise;
        } else {
          skipLine('Dated line with a balance but no debit or credit amount');
        }
        continue;
      }
      if (amountTokens.length > 1 && amountTokens.some((m) => m.col.role === 'debit') && amountTokens.some((m) => m.col.role === 'credit')) {
        skipLine('Both a debit and a credit amount are printed on this line');
        continue;
      }
      if (amountTokens[0].money.paise === 0) {
        skipLine('Zero amount');
        continue;
      }
      const descText = collapse(pl.textItems.filter((t) => t.role === null || t.role === 'description').map((t) => t.item.text).join(' '));
      if (SUMMARY_ROW.test(descText)) continue;
      pl.kind = 'D';
      seenRow = true;
      pl.card = currentCard;
      for (const d of pl.dates) dateTexts.push(d.item.text);
      plines.push(pl);
    }
    seqs.push({ page: page.page, model, lines: plines, descLo: Number.NEGATIVE_INFINITY });
  }

  // description zone per page: left edge from the date lines' own description text
  for (const s of seqs) {
    const xs: number[] = [];
    for (const l of s.lines) {
      if (l.kind !== 'D') continue;
      const d = l.textItems.filter((t) => t.role === 'description' || t.role === null);
      if (d.length > 0) xs.push(Math.min(...d.map((t) => t.item.x0)));
    }
    if (xs.length > 0) s.descLo = median(xs) - 10;
    else {
      const desc = s.model.cols.find((c) => c.role === 'description');
      s.descLo = desc ? desc.x0 - 12 : Number.NEGATIVE_INFINITY;
    }
  }

  // continuation lines must sit in the description zone and near other lines
  for (const s of seqs) {
    for (const l of s.lines) {
      if (l.kind !== 'C') continue;
      const first = l.textItems[0].item;
      const last = l.textItems[l.textItems.length - 1].item;
      const inZone =
        first.x0 >= s.descLo - 4 &&
        (s.model.descHi === Number.POSITIVE_INFINITY || last.x1 <= s.model.descHi + 12) &&
        l.textItems.every((t) => t.role === 'description' || t.role === null || t.role === 'reference');
      if (!inZone) l.kind = 'X';
    }
    s.lines = s.lines.filter((l) => l.kind !== 'X');
    // orphans: a run of continuation lines must connect (line to line, close spacing) to a transaction row
    const kept: PLine[] = [];
    let run: PLine[] = [];
    const flush = () => {
      if (run.some((l) => l.kind === 'D')) kept.push(...run);
      run = [];
    };
    for (const l of s.lines) {
      const prev = run[run.length - 1];
      if (prev && l.line.y - prev.line.y > 2.3 * Math.max(l.line.height, prev.line.height) + 4) flush();
      run.push(l);
    }
    flush();
    s.lines = kept;
  }

  // ── description layout ───────────────────────────────────────────────────────
  type Gap = PLine[];
  const pageGaps = seqs.map((s) => {
    const ds: PLine[] = [];
    const gaps: Gap[] = [[]];
    for (const l of s.lines) {
      if (l.kind === 'D') {
        ds.push(l);
        gaps.push([]);
      } else gaps[gaps.length - 1].push(l);
    }
    return { ds, gaps };
  });
  const anyContinuation = pageGaps.some((p) => p.gaps.some((g) => g.length > 0));
  let mode: DescMode = 'single';
  let centredCost = 0;
  if (anyContinuation) {
    // centred test: how well can every row's text block be centred on its date line?
    let costSum = 0;
    let rowN = 0;
    for (const p of pageGaps) {
      if (p.ds.length === 0) continue;
      const dl: BlockDateLine[] = p.ds.map((d) => ({ y: d.line.y, hasText: d.textItems.length > 0 }));
      const r = attributeBlocks(dl, p.gaps.map((g) => g.map((l) => l.line.y)));
      const withLines = p.ds.filter((_, i) => r.above[i] + r.below[i] > 0).length;
      costSum += r.cost;
      rowN += Math.max(withLines, 1);
    }
    centredCost = rowN > 0 ? costSum / rowN : 0;
    let belowN = 0;
    let aboveN = 0;
    for (const p of pageGaps) {
      for (let g = 1; g < p.gaps.length - 1; g++) {
        const gap = p.gaps[g];
        if (gap.length === 0) continue;
        const dFirst = gap[0].line.y - p.ds[g - 1].line.y;
        const dLast = p.ds[g].line.y - gap[gap.length - 1].line.y;
        if (dFirst < dLast - 1) belowN++;
        else if (dLast < dFirst - 1) aboveN++;
      }
      // trailing / leading gaps carry the same information
      const lead = p.gaps[0];
      if (lead.length > 0 && p.ds.length > 0) aboveN++;
      const tail = p.gaps[p.gaps.length - 1];
      if (tail.length > 0 && p.ds.length > 0) belowN++;
    }
    const estimate: DescMode =
      centredCost <= 1.6 && belowN > 0 && aboveN > 0 ? 'centered' : belowN >= aboveN ? 'below' : 'above';
    mode = ctx.mode === 'auto' ? estimate : ctx.mode;
  }

  // ── attribution + assembly ───────────────────────────────────────────────────
  interface RowAcc {
    d: PLine;
    above: PLine[];
    below: PLine[];
    uncertain: boolean;
  }
  const accs: RowAcc[] = [];
  let carry: PLine[] = []; // above-mode lines at the end of a page, belonging to the next page's first row
  let lastRowPrevPage: RowAcc | null = null;
  seqs.forEach((s, si) => {
    const { ds, gaps } = pageGaps[si];
    const pageAccs: RowAcc[] = ds.map((d) => ({ d, above: [], below: [], uncertain: false }));
    if (ds.length > 0 && mode !== 'single') {
      if (mode === 'below') {
        for (let g = 1; g < gaps.length; g++) pageAccs[g - 1].below.push(...gaps[g]);
        if (lastRowPrevPage && gaps[0].length > 0) lastRowPrevPage.below.push(...gaps[0]);
      } else if (mode === 'above') {
        for (let g = 0; g < gaps.length - 1; g++) pageAccs[g].above.push(...gaps[g]);
        if (carry.length > 0) pageAccs[0].above.unshift(...carry);
        carry = gaps[gaps.length - 1];
        // carry only applies when a next page exists; harmless otherwise
      } else {
        const dl: BlockDateLine[] = ds.map((d) => ({ y: d.line.y, hasText: d.textItems.length > 0 }));
        const r = attributeBlocks(dl, gaps.map((g) => g.map((l) => l.line.y)));
        ds.forEach((_, i) => {
          pageAccs[i].above = gaps[i].slice(gaps[i].length - r.above[i]);
          pageAccs[i].below = gaps[i + 1].slice(0, r.below[i]);
          pageAccs[i].uncertain = r.uncertain[i];
        });
      }
    }
    if (mode !== 'above') carry = [];
    accs.push(...pageAccs);
    lastRowPrevPage = pageAccs.length > 0 ? pageAccs[pageAccs.length - 1] : lastRowPrevPage;
    void s;
  });

  // right edge of lines that were cut at the column width
  let limit = 0;
  if (!ctx.sheet) {
    for (const a of accs) {
      const parts = [...a.above, a.d, ...a.below];
      for (let i = 0; i < parts.length - 1; i++) {
        const items = parts[i].kind === 'D' ? parts[i].textItems.map((t) => t.item) : parts[i].textItems.map((t) => t.item);
        if (items.length > 0) limit = Math.max(limit, Math.max(...items.map((x) => x.x1)));
      }
    }
  }

  const rows: DraftRow[] = [];
  const signals: (RowSignal | null)[] = [];
  let usedAmountColumn = false;
  let usedIndicator = false;
  let hasBalance = false;
  let yearless = 0;
  let unresolvedYears = 0;

  for (const a of accs) {
    const d = a.d;
    const model = seqs.find((s) => s.page === d.page)!.model;
    const picked = pickDates(d.dates, model);
    if (!picked) continue;
    if (picked.main.y === undefined) yearless++;
    const date = resolveDate(picked.main, ctx.end);
    if (!date) {
      unresolvedYears++;
      skipped.push({ page: d.page, line: d.line.index, text: d.text, reason: 'The date has no year and the statement period is unknown' });
      continue;
    }
    const valueDate = picked.value ? (resolveDate(picked.value, ctx.end) ?? undefined) : undefined;

    const real = d.money.filter((m) => !isStray(m));
    const debit = real.find((m) => m.col.role === 'debit');
    const credit = real.find((m) => m.col.role === 'credit');
    const single = real.find((m) => m.col.role === 'amount');
    const bal = real.find((m) => m.col.role === 'balance');
    const tok = debit ?? credit ?? single!;
    let direction: Direction | undefined;
    let signal: RowSignal | null = null;
    if (debit) direction = 'debit';
    else if (credit) direction = 'credit';
    else {
      usedAmountColumn = true;
      if (tok.money.indicator) {
        usedIndicator = true;
        direction = tok.money.indicator === 'CR' ? 'credit' : 'debit';
      }
      else if (d.drcrWord) direction = /^(cr|credit|c)\.?$/i.test(d.drcrWord) ? 'credit' : 'debit';
      else signal = { negative: tok.money.negative, plus: tok.money.plus === true };
    }

    // description text on the date line, mode suffix and reference
    const descItems = d.textItems.filter((t) => t.role === 'description' || t.role === null).map((t) => t.item);
    const refItems = d.textItems.filter((t) => t.role === 'reference').map((t) => t.item);
    const modeItems = d.textItems.filter((t) => t.role === 'mode').map((t) => t.item);
    const categoryItems = d.textItems.filter((t) => t.role === 'category').map((t) => t.item);
    const typeItems = d.textItems.filter((t) => t.role === 'type');
    if (!direction && typeItems.length > 0) {
      const w = typeItems.map((t) => t.item.text).join(' ');
      if (/^(cr|credit|c)\.?$/i.test(w.trim())) direction = 'credit';
      else if (/^(dr|debit|d)\.?$/i.test(w.trim())) direction = 'debit';
      if (direction) signal = null;
    }
    const lineParts: WrappedLine[] = [];
    const wl = (l: PLine): WrappedLine => ({
      text: collapse(l.textItems.map((t) => t.item.text).join(' ')),
      x1: Math.max(...l.textItems.map((t) => t.item.x1)),
    });
    for (const l of a.above) lineParts.push(wl(l));
    if (descItems.length > 0) lineParts.push({ text: collapse(descItems.map((i) => i.text).join(' ')), x1: Math.max(...descItems.map((i) => i.x1)) });
    for (const l of a.below) lineParts.push(wl(l));
    let description = joinWrapped(lineParts, ctx.sheet ? undefined : limit || undefined);
    const modeText = collapse(modeItems.map((i) => i.text).join(' '));
    if (modeText) description = description ? `${description} [${modeText}]` : `[${modeText}]`;

    const involved = [...a.above, d, ...a.below];
    const idx = involved.map((l) => l.line.index);
    const source: SourceRef = {
      page: d.page,
      lineStart: Math.min(...idx),
      lineEnd: Math.max(...idx),
      rawLines: involved.map((l) => l.text),
    };
    const warnings: RowWarning[] = [];
    if (a.uncertain) warnings.push('description_merged');
    if (bal) hasBalance = true;
    rows.push({
      date,
      valueDate,
      amount: tok.money.paise,
      direction,
      balanceAfter: bal ? (bal.money.indicator === 'DR' || bal.money.negative ? -bal.money.paise : bal.money.paise) : undefined,
      description,
      reference: refItems.length > 0 ? collapse(refItems.map((i) => i.text).join('')) : undefined,
      cardMask: d.card,
      bankCategory: categoryItems.length > 0 ? collapse(categoryItems.map((i) => i.text).join(' ')) : undefined,
      foreign: d.foreign,
      source,
      warnings,
    });
    signals.push(signal);
  }

  return {
    rows,
    signals,
    skipped,
    opening,
    closing,
    totals,
    mode,
    cardMasks,
    usedAmountColumn,
    usedIndicator,
    hasBalance,
    yearless,
    unresolvedYears,
    dateTexts,
    centredCost,
  };
}
