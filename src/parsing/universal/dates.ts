/**
 * Flexible date reading for statements from any bank.
 *
 * A date cell is read into a DateTok (day, month, optional year). Numeric day/month order is decided
 * per document by voting (a value above 12 settles it), year-less dates ("12 Jul", "12/07") get their
 * year from the statement end date, including the Dec to Jan rollover. Nothing here uses Date#toISOString.
 */
import type { IsoDate } from '@/domain/types';
import { daysBetween, makeIsoDate } from '@/lib/dates';

export type DateOrder = 'DMY' | 'MDY' | 'YMD';

export interface DateTok {
  d: number;
  m: number;
  /** Full four-digit year, undefined for year-less dates. */
  y?: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const TIME_ONLY = /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp][Mm])?$/;
const TIME_TAIL = /[\sT]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AaPp][Mm])?$/;

function year(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function valid(d: number, m: number, y?: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const maxDay = [31, y !== undefined && (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : y === undefined ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= maxDay;
}

/** Numeric forms need the order; named-month forms do not. */
export function parseDateTok(raw: string, order: DateOrder = 'DMY'): DateTok | null {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s || s.length > 28 || !/\d/.test(s)) return null;
  s = s.replace(TIME_TAIL, '');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(d, mo, y) ? { d, m: mo, y } : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = year(m[3]);
    const [d, mo] = order === 'MDY' ? [b, a] : [a, b];
    return valid(d, mo, y) ? { d, m: mo, y } : null;
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?[- /.,]*([A-Za-z]{3,9})\.?[- /.,]*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const d = Number(m[1]);
    const y = year(m[3]);
    return mo && valid(d, mo, y) ? { d, m: mo, y } : null;
  }
  m = /^([A-Za-z]{3,9})\.?[- /.]*(\d{1,2})(?:st|nd|rd|th)?[, /.-]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = year(m[3]);
    return mo && valid(d, mo, y) ? { d, m: mo, y } : null;
  }
  // year-less: "12 Jul", "Jul 12", "12th July"
  m = /^(\d{1,2})(?:st|nd|rd|th)?[- /.]*([A-Za-z]{3,9})\.?$/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    const d = Number(m[1]);
    return mo && valid(d, mo) ? { d, m: mo } : null;
  }
  m = /^([A-Za-z]{3,9})\.?[- /.]*(\d{1,2})(?:st|nd|rd|th)?$/.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    return mo && valid(d, mo) ? { d, m: mo } : null;
  }
  // year-less numeric "12/07" (only meaningful inside a date column)
  m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [d, mo] = order === 'MDY' ? [b, a] : [a, b];
    return valid(d, mo) ? { d, m: mo } : null;
  }
  return null;
}

/** Leading date inside a longer cell ("05-06-2024 CMS TRANSACTION"). */
const LEADING = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?=\s|$)/,
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?=\s|$)/,
  /^\d{1,2}(?:st|nd|rd|th)?[- ][A-Za-z]{3,9}\.?[- ,]+\d{2,4}(?=\s|$)/,
];

export function leadingDateText(text: string, order: DateOrder): { dateText: string; rest: string } | null {
  for (const re of LEADING) {
    const m = re.exec(text);
    if (m && parseDateTok(m[0], order)) {
      const rest = text.slice(m[0].length).trim();
      // a trailing clock time belongs to the date cell, not to the description
      if (TIME_ONLY.test(rest)) return null;
      return { dateText: m[0], rest };
    }
  }
  return null;
}

/** Decide numeric day/month order from every numeric date cell in the document. */
export function inferDateOrder(texts: Iterable<string>): DateOrder {
  let dmy = 0;
  let mdy = 0;
  let ymd = 0;
  for (const t of texts) {
    const s = t.trim().replace(TIME_TAIL, '');
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) {
      ymd++;
      continue;
    }
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s) ?? /^(\d{1,2})[-/](\d{1,2})$/.exec(s);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (ymd > 0 && dmy === 0 && mdy === 0) return 'YMD';
  if (mdy > dmy) return 'MDY';
  return 'DMY';
}

/** Year for a year-less date: the latest occurrence that is not after `end` (statement end / date). */
export function resolveDate(tok: DateTok, end?: IsoDate): IsoDate | null {
  if (tok.y !== undefined) return makeIsoDate(tok.y, tok.m, tok.d);
  if (!end) return null;
  const endYear = Number(end.slice(0, 4));
  // the latest real occurrence of this day and month that is not after the statement end
  for (let y = endYear; y >= endYear - 4; y--) {
    const iso = makeIsoDate(y, tok.m, tok.d);
    if (iso && iso <= end) return iso;
  }
  return null;
}

/** Readers for one document. */
export interface DateReader {
  order: DateOrder;
  /** Whole-cell date; year-less results carry no `y`. */
  tok(text: string): DateTok | null;
  /** True when the cell is a date (with or without a year). */
  is(text: string): boolean;
}

export function dateReader(order: DateOrder): DateReader {
  return {
    order,
    tok: (t) => parseDateTok(t, order),
    is: (t) => parseDateTok(t, order) !== null,
  };
}

/** Days between two ISO dates, re-exported for the engine. */
export { daysBetween };

export function tokToIso(tok: DateTok, end?: IsoDate): IsoDate | null {
  return resolveDate(tok, end);
}
