import type {
  AccountType,
  Institution,
  IsoDate,
  Paise,
  ParsedStatement,
  SkippedLine,
} from '@/domain/types';
import { reconcile, type DraftRow, type ReconcileResult } from './reconcile';
import type { Detection } from './types';

export interface FinishArgs {
  parserId: string;
  parserVersion: number;
  institution: Institution;
  accountType: AccountType;
  accountMask?: string;
  cardMasks?: string[];
  holderName?: string;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  openingBalance?: Paise;
  closingBalance?: Paise;
  printedTotals?: ParsedStatement['printedTotals'];
  rows: DraftRow[];
  skipped: SkippedLine[];
  warnings?: string[];
  detection: Detection;
  nature?: 'asset' | 'liability';
}

/** Run the shared reconciliation and assemble the ParsedStatement every parser returns. */
export function finishStatement(a: FinishArgs): ParsedStatement {
  return assembleStatement(a, reconcileFor(a));
}

export function reconcileFor(a: FinishArgs): ReconcileResult {
  return reconcile({
    rows: a.rows,
    openingBalance: a.openingBalance,
    closingBalance: a.closingBalance,
    printedTotals: a.printedTotals,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    nature: a.nature,
  });
}

/** Assemble a ParsedStatement from an already computed reconciliation. */
export function assembleStatement(a: FinishArgs, result: ReconcileResult): ParsedStatement {
  const warnings = [...(a.warnings ?? [])];
  if (result.ambiguousCount > 0) {
    warnings.push(
      `${result.ambiguousCount} rows have one unsigned amount and no balance, so debit vs credit could not be determined. They are marked for review.`,
    );
  }
  if (a.skipped.length > 0) {
    warnings.push(`${a.skipped.length} lines have a date and an amount but could not be turned into transactions.`);
  }
  if (result.reconciliation.status === 'mismatch') {
    warnings.push('The rows do not add up to the balances or totals printed on the statement. Rows marked for review need a check.');
  }
  const merged = result.rows.filter((r) => r.warnings.includes('description_merged')).length;
  if (merged > 0) {
    warnings.push(`${merged} descriptions were assembled from nearby lines and may be incomplete; amounts are unaffected.`);
  }
  const outside = result.rows.filter((r) => r.warnings.includes('date_out_of_period')).length;
  if (outside > 0) warnings.push(`${outside} rows are dated outside the statement period.`);

  return {
    parserId: a.parserId,
    parserVersion: a.parserVersion,
    institution: a.institution,
    accountType: a.accountType,
    accountMask: a.accountMask,
    cardMasks: a.cardMasks,
    holderName: a.holderName,
    periodStart: a.periodStart,
    periodEnd: a.periodEnd,
    openingBalance: a.openingBalance,
    closingBalance: a.closingBalance,
    printedTotals: a.printedTotals,
    rows: result.rows,
    skipped: a.skipped,
    warnings,
    reconciliation: result.reconciliation,
    detection: a.detection,
  };
}
