import type {
  Direction,
  IsoDate,
  Paise,
  ParsedRow,
  Reconciliation,
  ReconciliationCheck,
  RowWarning,
} from '@/domain/types';
import { addDays } from '@/lib/dates';
import { formatINR } from '@/lib/money';

/** A parsed row whose direction may still be undecided (decided here, from the running balance). */
export type DraftRow = Omit<ParsedRow, 'direction'> & { direction?: Direction };

export interface ReconcileInput {
  rows: DraftRow[];
  /** Balance before the first row, when printed. */
  openingBalance?: Paise;
  /** Balance after the last row, when printed. */
  closingBalance?: Paise;
  printedTotals?: { debits?: Paise; credits?: Paise; previousBalance?: Paise; totalDue?: Paise };
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  /**
   * 'asset' (bank accounts): closing = opening + credits - debits.
   * 'liability' (credit cards): total due = previous balance + debits - credits.
   */
  nature?: 'asset' | 'liability';
}

export interface ReconcileResult {
  rows: ParsedRow[];
  /** Rows whose direction is not printed and could not be derived from a balance (flagged `ambiguous_amount`). */
  ambiguousCount: number;
  reconciliation: Reconciliation;
}

function add(w: RowWarning[], x: RowWarning): void {
  if (!w.includes(x)) w.push(x);
}

const inr = (p: Paise) => formatINR(p);
const PERIOD_LABEL = 'All rows fall inside the statement period';

/**
 * The shared financial-exactness check used by every parser.
 *
 * 1. Running balance chain: for each row, previous balance +/- amount must equal the printed balance
 *    to the paise. If the printed column says debit but the balance moved up (or vice versa) the
 *    balance wins and the row is flagged `direction_from_balance`. Anything else is a `balance_break`.
 * 2. opening + credits - debits = closing (or the liability form), when those are printed.
 * 3. Printed debit/credit totals equal the sums of the rows, when printed.
 * 4. Rows dated outside the printed period get `date_out_of_period`.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const checks: ReconciliationCheck[] = [];
  const out: ParsedRow[] = [];
  let ambiguousCount = 0;
  let breaks = 0;
  let chainChecked = 0;
  let chainOk = 0;

  let prev: Paise | undefined = input.openingBalance;
  let altPrev: Paise | undefined;
  for (const d of input.rows) {
    const warnings = [...d.warnings];
    let direction = d.direction;
    const bal = d.balanceAfter;

    if (bal !== undefined && prev !== undefined) {
      chainChecked++;
      // Which direction (if any) makes `base ± amount` equal the printed balance?
      const settle = (base: Paise): { dir: Direction; flipped: boolean } | null => {
        const down = base - d.amount;
        const up = base + d.amount;
        if (down === bal && up === bal) return { dir: direction ?? 'debit', flipped: false }; // zero amount
        if (direction === 'debit' && down === bal) return { dir: 'debit', flipped: false };
        if (direction === 'credit' && up === bal) return { dir: 'credit', flipped: false };
        if (down === bal) return { dir: 'debit', flipped: direction !== undefined };
        if (up === bal) return { dir: 'credit', flipped: direction !== undefined };
        return null;
      };
      // After a single misprinted balance, the next row still follows from what it should have been.
      const hit = settle(prev) ?? (altPrev !== undefined ? settle(altPrev) : null);
      if (hit) {
        if (hit.flipped) add(warnings, 'direction_from_balance');
        direction = hit.dir;
        chainOk++;
        altPrev = undefined;
      } else {
        add(warnings, 'balance_break');
        breaks++;
        altPrev = direction === undefined ? undefined : direction === 'debit' ? prev - d.amount : prev + d.amount;
      }
    } else {
      altPrev = undefined;
    }
    prev = bal;

    if (direction === undefined) {
      // Never silently assume: keep the row, flag it, and let the statement-level check fail.
      direction = 'debit';
      add(warnings, 'ambiguous_amount');
      ambiguousCount++;
    }

    if (input.periodStart && input.periodEnd) {
      // Card transactions (foreign currency especially) can post a few days after they happened,
      // so a card row up to 10 days before the period start is not out of period.
      const lower = input.nature === 'liability' ? addDays(input.periodStart, -10) : input.periodStart;
      const inside = (x: IsoDate) => x >= lower && x <= input.periodEnd!;
      // A row posted just after the period but value-dated inside it belongs to the period.
      if (!inside(d.date) && !(d.valueDate && inside(d.valueDate))) add(warnings, 'date_out_of_period');
    }
    out.push({ ...d, direction, warnings });
  }

  if (chainChecked > 0) {
    checks.push({
      label: 'Running balance after every row',
      ok: breaks === 0,
      detail:
        breaks === 0
          ? `${chainOk} of ${chainChecked} rows match the printed balance to the paise` +
            (input.openingBalance === undefined ? ' (the first row has no earlier balance to check against)' : '')
          : `${breaks} of ${chainChecked} rows do not match the printed balance`,
    });
  }

  let debits = 0;
  let credits = 0;
  let debitCount = 0;
  let creditCount = 0;
  for (const r of out) {
    if (r.direction === 'debit') {
      debits += r.amount;
      debitCount++;
    } else {
      credits += r.amount;
      creditCount++;
    }
  }
  const nature = input.nature ?? 'asset';
  const pt = input.printedTotals;

  if (nature === 'asset') {
    if (input.openingBalance !== undefined && input.closingBalance !== undefined) {
      const expected = input.closingBalance;
      const actual = input.openingBalance + credits - debits;
      checks.push({
        label: 'Opening + credits - debits = closing',
        ok: expected === actual,
        expected,
        actual,
        detail:
          expected === actual
            ? `${inr(input.openingBalance)} + ${inr(credits)} - ${inr(debits)} = ${inr(expected)}`
            : `Rows give ${inr(actual)} but the statement closes at ${inr(expected)}`,
      });
    }
  } else if (pt?.previousBalance !== undefined && pt.totalDue !== undefined) {
    const actual = pt.previousBalance + debits - credits;
    // Some issuers print the total due rounded to the whole rupee: accept a difference under one rupee then.
    const diff = Math.abs(pt.totalDue - actual);
    const roundedToRupee = actual !== pt.totalDue && diff < 100 && Math.abs(pt.totalDue) % 100 === 0;
    checks.push({
      label: 'Previous balance + charges - payments = total due',
      ok: actual === pt.totalDue || roundedToRupee,
      expected: pt.totalDue,
      actual,
      detail: roundedToRupee
        ? `Total due is rounded to the rupee (${inr(diff)})`
        : actual === pt.totalDue
          ? `${inr(pt.previousBalance)} + ${inr(debits)} - ${inr(credits)} = ${inr(pt.totalDue)}`
          : `Rows give ${inr(actual)} but the statement shows ${inr(pt.totalDue)} due`,
    });
  }

  if (pt?.debits !== undefined) {
    checks.push({
      label: 'Debits match the printed total',
      ok: pt.debits === debits,
      expected: pt.debits,
      actual: debits,
      detail:
        pt.debits === debits
          ? `${debitCount} debits total ${inr(debits)}`
          : `Rows total ${inr(debits)} vs printed ${inr(pt.debits)}`,
    });
  }
  if (pt?.credits !== undefined) {
    checks.push({
      label: 'Credits match the printed total',
      ok: pt.credits === credits,
      expected: pt.credits,
      actual: credits,
      detail:
        pt.credits === credits
          ? `${creditCount} credits total ${inr(credits)}`
          : `Rows total ${inr(credits)} vs printed ${inr(pt.credits)}`,
    });
  }

  if (input.periodStart && input.periodEnd) {
    // Informational: banks sometimes print a few rows just outside the period. Those rows are
    // flagged individually (and warned about) but do not make the amounts wrong.
    const outside = out.filter((r) => r.warnings.includes('date_out_of_period')).length;
    if (outside === 0) {
      checks.push({ label: PERIOD_LABEL, ok: true, detail: `${input.periodStart} to ${input.periodEnd}` });
    }
  }

  if (ambiguousCount > 0) {
    checks.push({
      label: 'Debit or credit is printed for every row',
      ok: false,
      detail: `${ambiguousCount} rows have a single unsigned amount and no balance to tell debit from credit`,
    });
  }

  const failed = checks.some((c) => !c.ok);
  // The period check alone does not verify amounts: a balance or totals check is needed too.
  const substantive = checks.filter((c) => c.label !== PERIOD_LABEL);
  const status: Reconciliation['status'] = failed ? 'mismatch' : substantive.length > 0 ? 'balanced' : 'unverified';
  if (status === 'unverified') {
    checks.push({
      label: 'No printed balances or totals to check against',
      ok: true,
      detail: 'Rows were imported as printed; review them against your statement',
    });
  }

  return { rows: out, ambiguousCount, reconciliation: { status, checks, rowBalanceBreaks: breaks } };
}
