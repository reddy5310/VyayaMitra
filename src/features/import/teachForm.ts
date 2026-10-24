import { institutionName } from '@/domain/institutions';
import type { AccountType, ColumnRole, IsoDate, Institution } from '@/domain/types';
import { formatDate, makeIsoDate, parseStatementDate } from '@/lib/dates';
import type { StatementInspection, TemplateMapping } from '@/parsing';
import { ACCOUNT_TYPE_LABELS } from './accountTypes';

export type DateOrder = NonNullable<TemplateMapping['dateOrder']>;
export type DescriptionLayout = NonNullable<TemplateMapping['descriptionLayout']>;
export type AmountStyle = NonNullable<TemplateMapping['amountStyle']>;

export interface TeachForm {
  roles: Record<string, ColumnRole>;
  dateOrder: DateOrder;
  descriptionLayout: DescriptionLayout;
  amountStyle: AmountStyle;
  amountStyleTouched: boolean;
  institution: Institution;
  accountType: AccountType;
  name: string;
}

/** Inspection + the user's in-progress answers, kept by the wizard so "Adjust columns" resumes where they left off. */
export interface TeachCache {
  inspection: StatementInspection;
  form: TeachForm;
}

export const ROLE_OPTIONS: { role: ColumnRole; label: string }[] = [
  { role: 'date', label: 'Date' },
  { role: 'value_date', label: 'Value date' },
  { role: 'description', label: 'Description' },
  { role: 'reference', label: 'Reference' },
  { role: 'debit', label: 'Debit / Withdrawal' },
  { role: 'credit', label: 'Credit / Deposit' },
  { role: 'amount', label: 'Amount' },
  { role: 'drcr', label: 'Dr/Cr' },
  { role: 'balance', label: 'Balance' },
  { role: 'ignore', label: 'Ignore' },
];

export const DATE_ORDER_LABELS: Record<DateOrder, string> = {
  DMY: 'Day first (31/12/2025)',
  MDY: 'Month first (12/31/2025)',
  YMD: 'Year first (2025-12-31)',
};

export const LAYOUT_LABELS: Record<DescriptionLayout, string> = {
  single: 'On the same line as the date and amount',
  below: 'Continues on the lines below',
  above: 'Starts on the lines above',
  centered: 'Wraps above and below',
};

export const AMOUNT_STYLE_LABELS: Record<AmountStyle, string> = {
  split: 'Separate Debit and Credit columns',
  signed: 'One Amount column, negative for money out',
  drcr_suffix: 'One Amount column followed by Dr or Cr',
  drcr_column: 'One Amount column and a separate Dr/Cr column',
};

export function columnLabel(col: StatementInspection['columns'][number], position: number): string {
  return col.header?.trim() || `Column ${position + 1}`;
}

export function suggestAmountStyle(roles: Record<string, ColumnRole>, fallback: AmountStyle): AmountStyle {
  const values = Object.values(roles);
  if (values.includes('debit') || values.includes('credit')) return 'split';
  if (values.includes('amount') && values.includes('drcr')) return 'drcr_column';
  return fallback;
}

export function initialForm(inspection: StatementInspection): TeachForm {
  const roles: Record<string, ColumnRole> = {};
  for (const c of inspection.columns) roles[c.id] = c.guessedRole;
  return {
    roles,
    dateOrder: inspection.guesses.dateOrder,
    descriptionLayout: inspection.guesses.descriptionLayout,
    amountStyle: inspection.guesses.amountStyle,
    amountStyleTouched: false,
    institution: inspection.institutionGuess,
    accountType: inspection.accountTypeGuess,
    name: `${institutionName(inspection.institutionGuess)} ${ACCOUNT_TYPE_LABELS[inspection.accountTypeGuess].toLowerCase()}`,
  };
}

/** What still blocks "Try it". Empty when the mapping can be tried. */
export function missingRoles(roles: Record<string, ColumnRole>): string[] {
  const v = Object.values(roles);
  const out: string[] = [];
  if (!v.includes('date')) out.push('a Date column');
  if (!v.includes('description')) out.push('a Description column');
  if (!v.some((r) => r === 'debit' || r === 'credit' || r === 'amount')) out.push('an Amount, Debit or Credit column');
  return out;
}

export function toMapping(form: TeachForm): TemplateMapping {
  return {
    roles: form.roles,
    dateOrder: form.dateOrder,
    descriptionLayout: form.descriptionLayout,
    amountStyle: form.amountStyle,
    institution: form.institution,
    accountType: form.accountType,
    name: form.name.trim() || undefined,
  };
}

/** Parse a printed date under a chosen day/month/year order. Month names make the order irrelevant. */
export function parseDateWithOrder(text: string, order: DateOrder): IsoDate | null {
  const s = text.trim();
  const m = /^(\d{1,4})[-/.\s](\d{1,2})[-/.\s](\d{1,4})$/.exec(s);
  if (!m) return parseStatementDate(s);
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const year = (y: number) => (y < 100 ? 2000 + y : y);
  if (order === 'DMY') return makeIsoDate(year(c), b, a);
  if (order === 'MDY') return makeIsoDate(year(c), a, b);
  return makeIsoDate(year(a), b, c);
}

/** "03/04/2025 → 3 Apr 2025" for up to `limit` sample cells of the date column(s). */
export function dateExamples(
  inspection: StatementInspection,
  roles: Record<string, ColumnRole>,
  order: DateOrder,
  limit = 3,
): { text: string; result: string | null }[] {
  const dateCols = inspection.columns.filter((c) => roles[c.id] === 'date');
  const texts: string[] = [];
  for (const col of dateCols) for (const s of col.samples) if (s.trim() && !texts.includes(s.trim())) texts.push(s.trim());
  return texts.slice(0, limit).map((text) => {
    const iso = parseDateWithOrder(text, order);
    return { text, result: iso ? formatDate(iso) : null };
  });
}
