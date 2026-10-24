/** Small shared helpers for the analytics module. Pure. */
import type { IsoDate, MonthKey, Paise, Transaction } from '@/domain/types';
import { UNCATEGORIZED } from '@/domain/categories';
import { metricBucket, signedContribution } from '@/domain/kinds';
import type { MetricBucket } from '@/domain/kinds';
import { formatINR } from '@/lib/money';
import { addMonths, daysInMonth, formatDate, formatMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';

/** A p2p_in the user categorised as 'refunds' is a confirmed reimbursement: it offsets spending. */
function isReimbursement(t: Transaction): boolean {
  return t.kind === 'p2p_in' && t.category === 'refunds';
}

/** metricBucket, except that a confirmed reimbursement (p2p_in in 'refunds') belongs to spending. */
export function effectiveBucket(t: Transaction): MetricBucket {
  return isReimbursement(t) ? 'spending' : metricBucket(t.kind, t.direction);
}

/** Signed contribution of a transaction to its own bucket (see src/domain/kinds.ts). */
export function contribution(t: Transaction): Paise {
  if (isReimbursement(t)) return t.direction === 'credit' ? -t.amount : t.amount;
  return signedContribution(t.kind, t.direction, t.amount);
}

/**
 * Counts toward spending. Unclassified p2p_out (still in 'sent_to_people') is NOT spending: it is
 * "unresolved" until the user says what it was.
 */
export function isSpending(t: Transaction): boolean {
  return effectiveBucket(t) === 'spending' && !isUnclassifiedOut(t);
}

export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Net spending (debits minus refund credits) of the given transactions. */
export function netSpending(txns: readonly Transaction[]): Paise {
  let total = 0;
  for (const t of txns) if (isSpending(t)) total += contribution(t);
  return total;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Returns a function giving the category a transaction counts under.
 * A linked refund counts under the original purchase's category (so it reduces that
 * category) when the refund itself only carries the generic 'refunds'/'uncategorized'
 * category and the original is among `all`. An unlinked refund keeps 'refunds'.
 */
export function categoryResolver(all: readonly Transaction[]): (t: Transaction) => string {
  const byId = new Map<string, Transaction>();
  for (const t of all) byId.set(t.id, t);
  return (t) => {
    if ((t.kind === 'refund' || t.kind === 'p2p_in') && t.direction === 'credit' && t.linkedTxnId && (t.category === 'refunds' || t.category === UNCATEGORIZED)) {
      const original = byId.get(t.linkedTxnId);
      if (original && original.category && original.category !== 'refunds') return original.category;
    }
    return t.category || UNCATEGORIZED;
  };
}

/** Transactions with date inside [start,end] inclusive. */
export function inRange(txns: readonly Transaction[], start: IsoDate, end: IsoDate): Transaction[] {
  return txns.filter((t) => t.date >= start && t.date <= end);
}

/** 'Sep' from '2025-09'. */
export function shortMonthName(m: MonthKey): string {
  return formatMonth(m).replace(/\s*\d{4}$/, '').slice(0, 3);
}

/** 'Sep 2025' */
export function shortMonthYear(m: MonthKey): string {
  return `${shortMonthName(m)} ${m.slice(0, 4)}`;
}

/** "1–14 Oct 2025", "28 Sep – 3 Oct 2025", "14 Oct 2025", "28 Dec 2024 – 3 Jan 2025". */
export function formatRange(start: IsoDate, end: IsoDate): string {
  if (start === end) return formatDate(start);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${shortMonthName(monthKey(end))} ${ey}`;
  if (sy === ey) return `${sd} ${shortMonthName(monthKey(start))} – ${ed} ${shortMonthName(monthKey(end))} ${ey}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Calendar-date day-of-month. */
export function dayOf(d: IsoDate): number {
  return Number(d.slice(8, 10));
}

/** The same day-of-month in another month, clamped to that month's length. */
export function sameDayInMonth(d: IsoDate, m: MonthKey): IsoDate {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(Math.min(dayOf(d), daysInMonth(y, mo))).padStart(2, '0')}`;
}

/** Add n calendar months to a date, clamping the day. */
export function addMonthsToDate(d: IsoDate, n: number): IsoDate {
  return sameDayInMonth(d, addMonths(monthKey(d), n));
}

/** True when [start,end] is exactly one whole calendar month. */
export function isWholeMonth(start: IsoDate, end: IsoDate): boolean {
  return monthKey(start) === monthKey(end) && start === monthStart(monthKey(start)) && end === monthEnd(monthKey(end));
}

/** Small deterministic string hash (FNV-1a, 32-bit) rendered as base-36. */
export function hashId(...parts: string[]): string {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

/** Default categories that mark a people flow as not yet classified by the user or a rule. */
export const UNCLASSIFIED_OUT = 'sent_to_people';
export const UNCLASSIFIED_IN = 'received_from_people';

export function isUnclassifiedOut(t: Transaction): boolean {
  return t.kind === 'p2p_out' && t.category === UNCLASSIFIED_OUT;
}

export function isUnclassifiedIn(t: Transaction): boolean {
  return t.kind === 'p2p_in' && t.category === UNCLASSIFIED_IN;
}

// ─── Amount markers: text that can be rendered either as plain rupees or as masked <Money> parts ─────

const MARK_RE = /(-?\d+)/g;

/** Embeds an amount in a string; `renderMarked` / `partsOf` turn it into text or structured parts. */
export function mk(paise: Paise): string {
  return `${Math.round(paise)}`;
}

export function renderMarked(s: string): string {
  return s.replace(MARK_RE, (_m, p: string) => formatINR(Number(p), { whole: true }));
}

/** Splits a marked string into plain strings and `{ paise }` parts. */
export function partsOf(s: string): (string | { paise: Paise })[] {
  const out: (string | { paise: Paise })[] = [];
  let last = 0;
  for (const m of s.matchAll(MARK_RE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ paise: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** The amount when the whole string is exactly one marked amount. */
export function soleAmount(s: string): Paise | undefined {
  const m = /^(-?\d+)$/.exec(s);
  return m ? Number(m[1]) : undefined;
}
