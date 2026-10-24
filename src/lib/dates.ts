import type { IsoDate, MonthKey } from '@/domain/types';

/**
 * Date-only helpers. Everything works on 'YYYY-MM-DD' strings and UTC-noon Date objects
 * internally, so no value ever shifts across a timezone boundary.
 * NEVER use Date#toISOString() on a local Date to produce a calendar date.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

export function makeIsoDate(year: number, month: number, day: number): IsoDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function isIsoDate(s: string): s is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return makeIsoDate(y, m, d) !== null;
}

/**
 * Parse the date formats Indian statements use:
 * "03-06-2024", "03/06/2024", "03.06.2024", "14-Sep-2025", "14 Sep 2025", "14-Sep-25",
 * "June 03, 2024", "Jul 20, 2024", "2024-06-03". Day-first for numeric forms.
 */
export function parseStatementDate(text: string): IsoDate | null {
  const s = text.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return makeIsoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) return makeIsoDate(expandYear(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? makeIsoDate(expandYear(+m[3]), month, +m[1]) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? makeIsoDate(+m[3], month, +m[2]) : null;
  }
  return null;
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtc(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

function fromUtc(d: Date): IsoDate {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today's calendar date in the user's local timezone. */
export function todayIso(now: Date = new Date()): IsoDate {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function monthKey(d: IsoDate): MonthKey {
  return d.slice(0, 7);
}

export function monthStart(m: MonthKey): IsoDate {
  return `${m}-01`;
}

export function monthEnd(m: MonthKey): IsoDate {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(daysInMonth(y, mo))}`;
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number);
  const idx = y * 12 + (mo - 1) + n;
  return `${pad(Math.floor(idx / 12), 4)}-${pad((idx % 12) + 1)}`;
}

/** Inclusive list of months from a to b. */
export function monthsBetween(a: MonthKey, b: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

const monthLabelFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayShortFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "September 2025" */
export function formatMonth(m: MonthKey): string {
  return monthLabelFmt.format(toUtc(monthStart(m)));
}

/** "Sep 25" */
export function formatMonthShort(m: MonthKey): string {
  return shortMonthFmt.format(toUtc(monthStart(m)));
}

/** "14 Sep 2025" or, with short, "14 Sep" */
export function formatDate(d: IsoDate, opts: { short?: boolean } = {}): string {
  return (opts.short ? dayShortFmt : dayFmt).format(toUtc(d));
}

/** Day of week 0=Sunday..6=Saturday for a calendar date. */
export function weekday(d: IsoDate): number {
  return toUtc(d).getUTCDay();
}
