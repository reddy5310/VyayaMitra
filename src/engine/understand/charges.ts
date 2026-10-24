/**
 * Fee subtypes: what kind of charge a fee row is, and how it is labelled.
 * GST / IGST / CGST / SGST rows that tax a fee carry the fee's chargeType (merchant "GST on <fee>").
 */
import type { ChargeType } from '@/domain/types';

export const CHARGE_LABELS: Record<ChargeType, string> = {
  fuel_surcharge: 'Fuel surcharge',
  annual_fee: 'Annual fee',
  joining_fee: 'Joining fee',
  late_payment_fee: 'Late payment fee',
  finance_charge: 'Finance charge',
  forex_markup: 'Forex markup',
  atm_charge: 'ATM charge',
  cash_advance_fee: 'Cash advance fee',
  processing_fee: 'Processing fee',
  convenience_fee: 'Convenience fee',
  overlimit_fee: 'Overlimit fee',
  bank_charge: 'Bank charge',
  other_fee: 'Other fee',
};

const TYPE_PATTERNS: Array<[ChargeType, RegExp]> = [
  ['fuel_surcharge', /\bFUEL\b.*\b(?:SURCHARGE|FEE|CHARGES?)\b|\bSURCHARGE\b.*\bFUEL\b|\bFEE ON FUEL\b/],
  ['joining_fee', /\bJOINING\b|\bWELCOME (?:FEE|CHARGES?)\b/],
  ['annual_fee', /\bANNUAL (?:FEE|CHARGES?|MEMBERSHIP)\b|\bMEMBERSHIP FEE\b|\bRENEWAL FEE\b|\bANNIVERSARY\b/],
  ['late_payment_fee', /\bLATE\b|\bPENAL\b|\bPENALTY\b/],
  ['overlimit_fee', /\bOVER ?LIMIT\b/],
  ['cash_advance_fee', /\bCASH ADV/],
  ['atm_charge', /\bATM\b|\bCASH WITHDRAWAL (?:FEES?|CHARGES?)\b/],
  ['forex_markup', /\bFOREX\b|\bMARK ?UP\b|\bCURRENCY CONVERSION\b|\bCROSS CURRENCY\b|\bDCC\b|\bFOREIGN CURRENCY\b/],
  ['finance_charge', /\bFINANCE CHARGES?\b|\bINTEREST\b/],
  ['processing_fee', /\bPROCESSING\b/],
  ['convenience_fee', /\bCONVENIENCE\b/],
];

const GST_ROW = /\b(?:I|C|S|UT)?GST\b|\bTAX ON\b|\bSERVICE TAX\b|\bCESS\b/;

export interface ChargeInfo {
  chargeType: ChargeType;
  /** True when the row is the tax on a fee rather than the fee itself. */
  tax: boolean;
}

/** Classify a fee row from its upper-case text; `isCard` picks the fallback for unspecific fees. */
export function classifyCharge(upper: string, isCard: boolean): ChargeInfo {
  const tax = GST_ROW.test(upper) && !/\bGST\s*(?:PAYMENT|CHALLAN)\b/.test(upper);
  // for tax rows prefer what follows "ON" ("GST ON FUEL SURCHARGE")
  const scope = tax ? (/\b(?:ON|FOR)\b(.*)$/.exec(upper)?.[1] ?? upper) : upper;
  for (const [type, re] of TYPE_PATTERNS) if (re.test(scope)) return { chargeType: type, tax };
  if (tax) for (const [type, re] of TYPE_PATTERNS) if (re.test(upper)) return { chargeType: type, tax };
  return { chargeType: isCard ? 'other_fee' : 'bank_charge', tax };
}

export function chargeLabel(info: ChargeInfo, reversed: boolean): { label: string; key: string } {
  const name = CHARGE_LABELS[info.chargeType];
  // A tax row on its own can't tell which fee it taxes; the charge linker pairs it later.
  const generic = info.chargeType === 'other_fee' || info.chargeType === 'bank_charge';
  const base = info.tax ? (generic ? 'GST on charges' : `GST on ${name.toLowerCase()}`) : name;
  return { label: reversed ? `${base} reversed` : base, key: info.tax ? `charge:gst:${info.chargeType}` : `charge:${info.chargeType}` };
}
