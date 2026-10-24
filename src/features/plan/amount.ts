import type { Paise } from '@/domain/types';
import { parseAmountToPaise } from '@/lib/money';

export type AmountResult = { ok: true; paise: Paise } | { ok: false; error: string };

/**
 * Turns what a person typed into rupees ("1,250.50", "₹ 400", "75000") into exact paise, without float math.
 * Rejects empty, malformed, zero and negative input with a message fit to show under the field.
 */
export function parseRupeeInput(text: string): AmountResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Enter an amount.' };
  const paise = parseAmountToPaise(trimmed);
  if (paise === null) return { ok: false, error: 'Enter an amount like 1,250.50 (up to 2 decimal places).' };
  if (paise <= 0) return { ok: false, error: 'Amount must be more than ₹0.' };
  return { ok: true, paise };
}

/** Paise → editable rupee text without float math: 125050 → "1250.50", 400000 → "4000". */
export function paiseToInput(paise: Paise): string {
  const whole = Math.trunc(paise / 100);
  const frac = Math.abs(paise % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}
