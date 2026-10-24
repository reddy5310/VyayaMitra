import { isIsoDate } from '@/lib/dates';
import type { Account, AccountType, Institution, IsoDate, Paise } from '@/domain/types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const NAME_MAX = 60;

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'savings',
  'current',
  'credit_card',
  'wallet',
  'loan',
  'investment',
  'cash',
];

/** Positive whole number of paise (> 0). */
export function requirePositivePaise(value: unknown, label: string): Paise {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be greater than zero.`);
  }
  return value;
}

/** Whole number of paise (>= 0). */
export function requireNonNegativePaise(value: unknown, label: string): Paise {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${label} must be zero or more.`);
  }
  return value;
}

/** Trimmed, non-empty, at most `max` characters. */
export function requireName(value: unknown, label: string, max = NAME_MAX): string {
  if (typeof value !== 'string') throw new ValidationError(`${label} is required.`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new ValidationError(`${label} can't be empty.`);
  if (name.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return name;
}

export function requireDate(value: unknown, label: string): IsoDate {
  if (typeof value !== 'string' || !isIsoDate(value)) {
    throw new ValidationError(`${label} must be a valid date (YYYY-MM-DD).`);
  }
  return value;
}

export function requireMask(value: unknown, label = 'Account number'): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) {
    throw new ValidationError(`${label} must be exactly the last 4 digits.`);
  }
  return value;
}

/** Institution ids are open-ended strings (see domain/institutions.ts); only the shape is checked. */
export function requireInstitution(value: unknown): Institution {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_ .&-]{0,39}$/.test(value.trim())) {
    throw new ValidationError('Bank is not valid.');
  }
  return value.trim();
}

export function requireOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${label} is not valid.`);
  }
  return value as T;
}

export function validateAccountFields(input: Partial<Omit<Account, 'id' | 'createdAt'>>): Partial<Omit<Account, 'id' | 'createdAt'>> {
  const out: Partial<Omit<Account, 'id' | 'createdAt'>> = {};
  if ('name' in input) out.name = requireName(input.name, 'Account name');
  if ('institution' in input) out.institution = requireInstitution(input.institution);
  if ('type' in input) out.type = requireOneOf(input.type, ACCOUNT_TYPES, 'Account type');
  if ('mask' in input) out.mask = input.mask === undefined ? undefined : requireMask(input.mask);
  if ('extraMasks' in input) {
    out.extraMasks =
      input.extraMasks === undefined
        ? undefined
        : [...new Set(input.extraMasks.map((m) => requireMask(m, 'Card number')))];
  }
  if ('holderName' in input) {
    out.holderName = input.holderName === undefined || input.holderName === '' ? undefined : requireName(input.holderName, 'Holder name', 80);
  }
  if ('currency' in input && input.currency !== 'INR') throw new ValidationError('Only INR accounts are supported.');
  if ('archived' in input) out.archived = input.archived === undefined ? undefined : Boolean(input.archived);
  return out;
}

/** Validated account fields ready for insertion (used by createAccount and the import commit). */
export function validateNewAccount(input: Omit<Account, 'id' | 'createdAt'>): Omit<Account, 'id' | 'createdAt'> {
  const f = validateAccountFields(input);
  if (!f.name || !f.institution || !f.type) throw new ValidationError('Account name, bank and type are required.');
  const out: Omit<Account, 'id' | 'createdAt'> = { name: f.name, institution: f.institution, type: f.type, currency: 'INR' };
  if (f.mask) out.mask = f.mask;
  if (f.extraMasks && f.extraMasks.length) out.extraMasks = f.extraMasks;
  if (f.holderName) out.holderName = f.holderName;
  if (f.archived) out.archived = true;
  return out;
}
