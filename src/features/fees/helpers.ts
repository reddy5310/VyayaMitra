import type { ChargeType } from '@/domain/types';
import type { ChargeEvent } from '@/engine/analytics';
import type { Tone } from '@/ui';

export const CHARGE_LABELS: Record<ChargeType, string> = {
  fuel_surcharge: 'Fuel surcharge',
  annual_fee: 'Annual fee',
  joining_fee: 'Joining fee',
  late_payment_fee: 'Late payment fee',
  finance_charge: 'Interest / finance charge',
  forex_markup: 'Foreign currency markup',
  atm_charge: 'ATM charge',
  cash_advance_fee: 'Cash advance fee',
  processing_fee: 'Processing fee',
  convenience_fee: 'Convenience fee',
  overlimit_fee: 'Over-limit fee',
  bank_charge: 'Bank charge',
  other_fee: 'Other fee',
};
export const CHARGE_TYPES = Object.keys(CHARGE_LABELS) as ChargeType[];

export const STATUS_INFO: Record<ChargeEvent['status'], { label: string; tone: Tone }> = {
  reversed: { label: 'Reversed', tone: 'positive' },
  partly_reversed: { label: 'Partly reversed', tone: 'warning' },
  not_reversed: { label: 'Not reversed', tone: 'neutral' },
};

/**
 * What to say about a possible reversal. It only ever comes from terms the user recorded, and it never states a
 * rule as fact: no policy (or no match) means "check your card's terms".
 */
export function eligibilityText(e: ChargeEvent): string {
  if (e.status === 'reversed') return 'This charge was reversed.';
  if (e.eligibility.state === 'likely' && e.eligibility.policyId) {
    return 'Might qualify for reversal under the terms you recorded. Check with your bank.';
  }
  return 'Check your card’s terms.';
}
