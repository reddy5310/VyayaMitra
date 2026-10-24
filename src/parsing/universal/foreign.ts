/**
 * International card rows print the original amount next to the INR amount:
 * "... SOME SAAS INC 25 USD 2,500.00", "... BERLIN DE USD 38.50 3,210.55", "... USD 12.50".
 * The foreign amount is recognised by its ISO currency code and kept apart from the INR amount.
 */
import type { LayoutItem } from '../pdf/types';

const CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'CHF', 'JPY', 'CNY', 'HKD', 'NZD', 'SEK', 'NOK', 'DKK', 'THB', 'MYR',
  'IDR', 'KRW', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'ZAR', 'TRY', 'RUB', 'PHP', 'VND', 'LKR', 'NPR', 'BDT', 'EGP', 'PLN', 'CZK', 'HUF', 'ILS', 'BRL', 'MXN',
]);
const NO_MINOR_UNITS = new Set(['JPY', 'KRW', 'VND', 'IDR']);

export interface ForeignAmount {
  /** Minor units (cents). */
  amount: number;
  currency: string;
}

export function isCurrencyCode(s: string): boolean {
  return CURRENCIES.has(s);
}

function toMinor(num: string, currency: string): number | null {
  const clean = num.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const digits = NO_MINOR_UNITS.has(currency) ? 0 : 2;
  const minor = Number(whole) * 10 ** digits + (digits ? Number((frac + '00').slice(0, digits)) : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const CODE_FIRST = new RegExp(`^([A-Z]{3})\\s*(${NUM})$`);
const NUM_FIRST = new RegExp(`^(${NUM})\\s*([A-Z]{3})$`);

/** A single cell holding both parts: "25 USD" / "USD 12.50". */
export function foreignFromCell(text: string): ForeignAmount | null {
  const t = text.trim();
  const a = CODE_FIRST.exec(t);
  if (a && CURRENCIES.has(a[1])) {
    const m = toMinor(a[2], a[1]);
    return m === null ? null : { amount: m, currency: a[1] };
  }
  const b = NUM_FIRST.exec(t);
  if (b && CURRENCIES.has(b[2])) {
    const m = toMinor(b[1], b[2]);
    return m === null ? null : { amount: m, currency: b[2] };
  }
  return null;
}

/**
 * Find foreign-amount parts on a line. Returns the items they occupy so callers can leave them out of
 * descriptions and amount detection. Never claims the right-most item (that is the INR amount).
 */
export function findForeign(items: LayoutItem[]): { foreign: ForeignAmount; used: LayoutItem[] } | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cell = foreignFromCell(it.text);
    if (cell && i < items.length - 1) return { foreign: cell, used: [it] };
    // [USD][31.03] and [31.03][USD] as neighbouring cells
    const next = items[i + 1];
    if (next && i + 1 < items.length - 1) {
      if (CURRENCIES.has(it.text.trim()) && /^\d[\d,]*(\.\d+)?$/.test(next.text.trim())) {
        const m = toMinor(next.text.trim(), it.text.trim());
        if (m !== null) return { foreign: { amount: m, currency: it.text.trim() }, used: [it, next] };
      }
      if (CURRENCIES.has(next.text.trim()) && /^\d[\d,]*(\.\d+)?$/.test(it.text.trim())) {
        const m = toMinor(it.text.trim(), next.text.trim());
        if (m !== null) return { foreign: { amount: m, currency: next.text.trim() }, used: [it, next] };
      }
    }
  }
  return null;
}
