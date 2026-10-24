import type { Paise } from '@/domain/types';

/**
 * Parse an Indian-formatted amount string to integer paise.
 * Accepts "1,27,102.63", "₹4,807.32", "`23,273.56", "250", "1,657.82 CR", "(500.00)", "-42.98".
 * Returns null when the text is not a clean amount (so reference numbers are never mistaken for money
 * by callers that require a decimal part — see `requireDecimals`).
 */
export function parseAmountToPaise(
  text: string,
  opts: { requireDecimals?: boolean } = {},
): Paise | null {
  let s = text.trim();
  if (!s) return null;
  let negative = false;
  s = s.replace(/^(₹|`|Rs\.?|INR)\s*/i, '');
  s = s.replace(/\s*(CR|DR|Cr|Dr)\.?$/, '');
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const pattern = opts.requireDecimals ? /^\d{1,3}(,\d{2,3})*\.\d{2}$|^\d+\.\d{2}$/ : /^(\d{1,3}(,\d{2,3})*|\d+)(\.\d{1,2})?$/;
  if (!pattern.test(s)) return null;
  const [whole, frac = ''] = s.replace(/,/g, '').split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrWholeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inrCompactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** "₹1,27,102.63". `whole` drops paise ("₹1,27,103"); `compact` gives "₹1.3L". */
export function formatINR(paise: Paise, opts: { whole?: boolean; compact?: boolean; signed?: boolean } = {}): string {
  const rupees = paise / 100;
  const f = opts.compact ? inrCompactFormatter : opts.whole ? inrWholeFormatter : inrFormatter;
  const out = f.format(Math.abs(rupees));
  if (paise < 0) return `−${out}`;
  if (opts.signed && paise > 0) return `+${out}`;
  return out;
}

/** Sum paise safely (integers only). */
export function sumPaise(values: Iterable<Paise>): Paise {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Percentage helper that returns null instead of dividing by zero. */
export function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return (part / whole) * 100;
}
