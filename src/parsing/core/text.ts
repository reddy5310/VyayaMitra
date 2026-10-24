import type { IsoDate, Paise } from '@/domain/types';
import { parseAmountToPaise } from '@/lib/money';
import { parseStatementDate } from '@/lib/dates';

export interface Money {
  paise: Paise;
  /** 'CR' / 'DR' printed next to the amount, when any. */
  indicator?: 'CR' | 'DR';
  /** True when the printed amount carried a minus sign or parentheses. */
  negative: boolean;
  /** True when printed with a leading plus sign. */
  plus?: boolean;
}

/**
 * Read a token as money. Only text that is a clean amount WITH exactly two decimals counts, so
 * reference / cheque / UPI / account numbers can never be mistaken for amounts.
 * Accepts "1,27,102.63", "₹4,807.32", "`23,273.56", "1,657.82 CR", "5,000.00(Dr)", "(500.00)", "-42.98".
 */
export function readMoney(text: string): Money | null {
  let s = text.trim();
  if (!s || !/\d/.test(s)) return null;
  // "1,000.00(Dr)" / "1,000.00 (CR)" → "1,000.00 Dr"
  s = s.replace(/\s*\(\s*(cr|dr)\s*\)\s*$/i, (_m, d: string) => ' ' + d.toUpperCase());
  s = s.replace(/(?<=\d)\s*(cr|dr)\.?$/i, (_m, d: string) => ' ' + d.toUpperCase());
  // single-letter C / D suffix used by some card statements ("1,234.00 D")
  s = s.replace(/(?<=\d)\s+([CD])$/, (_m, d: string) => (d === 'C' ? ' CR' : ' DR'));
  const ind = /\s(CR|DR)$/.exec(s);
  const paise = parseAmountToPaise(s, { requireDecimals: true });
  if (paise === null) return null;
  const hasNegSign = /^[^\d]*-/.test(s) || /^\(.*\)/.test(s.replace(/^(₹|`|Rs\.?|INR)\s*/i, ''));
  return {
    paise: Math.abs(paise),
    indicator: ind ? (ind[1] as 'CR' | 'DR') : undefined,
    negative: paise < 0 || hasNegSign,
    plus: /^(₹|`|Rs\.?|INR)?\s*\+/i.test(s) || undefined,
  };
}

/** True when the whole text is a recognised calendar date. */
export function readDate(text: string): IsoDate | null {
  const t = text.trim();
  if (!t || t.length > 20 || !/\d/.test(t)) return null;
  return parseStatementDate(t);
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function lastDigits(s: string, n = 4): string | undefined {
  const d = s.replace(/\D/g, '');
  return d.length >= n ? d.slice(-n) : undefined;
}

/** Lower-case alphanumerics and single spaces; used to compare header labels. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Characters that never need a space next to them when a wrapped line is re-joined. */
const SEP = /[-~/@._:]/;

export interface WrappedLine {
  text: string;
  /** Right edge of the line, for detecting lines that were cut at the column width. */
  x1?: number;
}

/**
 * Re-join description lines that the bank wrapped. Lines are normally joined with a space; a line
 * that was cut mid-token at the column limit (single token reaching the right limit) or that
 * ends/starts with a separator such as "-", "/" or "~" is joined without one.
 */
export function joinWrapped(lines: WrappedLine[], limitX1?: number): string {
  let out = '';
  let prev: WrappedLine | null = null;
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;
    if (!prev) {
      out = t;
    } else {
      const last = out[out.length - 1];
      const first = t[0];
      const atLimit =
        limitX1 !== undefined &&
        prev.x1 !== undefined &&
        prev.x1 >= limitX1 - 7 &&
        !/\s/.test(prev.text.trim()) &&
        /[A-Za-z0-9]/.test(last) &&
        /[A-Za-z0-9]/.test(first) &&
        prev.text.trim().length >= 12;
      const noSpace = SEP.test(last) || SEP.test(first) || atLimit;
      out += noSpace ? t : ' ' + t;
    }
    prev = l;
  }
  return out;
}

/** String-only decimal → paise (rounds half up at the third decimal). For CSV rupee values. */
export function decimalStringToPaise(raw: string): Paise | null {
  const s = raw.trim().replace(/,/g, '').replace(/^(₹|Rs\.?|INR)\s*/i, '');
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? '';
  let paise = Number(m[2]) * 100 + Number((frac + '00').slice(0, 2));
  if (frac.length > 2 && frac.charCodeAt(2) >= 53) paise += 1; // third digit >= '5'
  if (!Number.isSafeInteger(paise)) return null;
  return m[1] === '-' ? -paise : paise;
}

const LEADING_DATE_RES = [
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?=\s|$)/,
  /^\d{1,2}[- ][A-Za-z]{3,9}[- ,]+\d{2,4}(?=\s|$)/,
  /^\d{4}-\d{2}-\d{2}(?=\s|$)/,
];

/** If the text starts with a calendar date, return it and the remainder. */
export function splitLeadingDate(text: string): { date: IsoDate; dateText: string; rest: string } | null {
  for (const re of LEADING_DATE_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const date = readDate(m[0]);
    if (date) return { date, dateText: m[0], rest: text.slice(m[0].length).trim() };
  }
  return null;
}
