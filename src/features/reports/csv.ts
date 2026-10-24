import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { Account, CustomCategory, IsoDate, Paise, Statement, Transaction } from '@/domain/types';

export const CSV_BOM = '﻿';

export const CSV_HEADERS = [
  'Date',
  'Account',
  'Description',
  'Merchant',
  'Kind',
  'Category',
  'Direction',
  'Amount (INR)',
  'Balance (INR)',
  'Reference',
  'Needs review',
  'Category source',
  'Confidence',
  'Statement file',
  'Page',
] as const;

export interface CsvOptions {
  accounts: readonly Account[];
  customCategories?: readonly CustomCategory[];
  /** Optional: lets the "Statement file" column show the file name. */
  statements?: readonly Statement[];
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (or tab / CR) as formulas.
 * Text cells starting with those characters get a leading apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A text cell: formula-neutralised, then RFC 4180 quoted when needed. */
export function csvText(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return quote(safe);
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Integer paise → "-1250.50" using integer maths only (no float rounding). */
export function paiseToCsvNumber(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

export function transactionsToCsv(txns: readonly Transaction[], opts: CsvOptions): string {
  const accountName = new Map(opts.accounts.map((a) => [a.id, a.name]));
  const statementFile = new Map((opts.statements ?? []).map((s) => [s.id, s.fileName]));
  const lines: string[] = [CSV_HEADERS.map(csvText).join(',')];

  for (const t of txns) {
    const signed = t.direction === 'debit' ? -t.amount : t.amount;
    const cells = [
      csvText(t.date),
      csvText(accountName.get(t.accountId) ?? t.accountId),
      csvText(t.rawDescription),
      csvText(t.merchant),
      csvText(KIND_LABELS[t.kind] ?? t.kind),
      csvText(categoryName(t.category, opts.customCategories)),
      csvText(t.direction === 'debit' ? 'Debit' : 'Credit'),
      // Numeric columns are generated here, never user text, so they stay unprefixed numbers.
      paiseToCsvNumber(signed),
      t.balanceAfter === undefined ? '' : paiseToCsvNumber(t.balanceAfter),
      csvText(t.reference ?? ''),
      csvText(t.needsReview ? 'Yes' : 'No'),
      csvText(t.categorySource),
      (Math.round(t.confidence * 100) / 100).toFixed(2),
      csvText(statementFile.get(t.statementId) ?? ''),
      String(t.source.page),
    ];
    lines.push(cells.join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

export function csvFilename(start: IsoDate, end: IsoDate): string {
  return `vyayamitra-transactions-${start}-to-${end}.csv`;
}

/** Trigger a browser download of CSV text. Works fully offline. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
