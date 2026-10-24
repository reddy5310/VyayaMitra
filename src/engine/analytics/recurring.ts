import type { Cadence, IsoDate, Paise, RecurringDecision, Transaction, TxnKind } from '@/domain/types';
import { addDays, daysBetween } from '@/lib/dates';
import type { RecurringSeries } from './index';
import { median } from './util';

const RECURRING_KINDS: ReadonlySet<TxnKind> = new Set<TxnKind>(['expense', 'fee', 'loan_payment', 'p2p_out', 'investment']);

/** Allowed interval window (days) per cadence, and its nominal length. */
const CADENCES: { cadence: Cadence; lo: number; hi: number; nominal: number }[] = [
  { cadence: 'weekly', lo: 6, hi: 8, nominal: 7 },
  { cadence: 'monthly', lo: 26, hi: 35, nominal: 30 },
  { cadence: 'quarterly', lo: 84, hi: 98, nominal: 91 },
  { cadence: 'yearly', lo: 350, hi: 380, nominal: 365 },
];

/** A confirmed-but-not-detected series falls back on this many days between payments. */
function nominalDays(c: Cadence): number {
  return CADENCES.find((x) => x.cadence === c)?.nominal ?? 30;
}

function monthlyCostOf(cadence: Cadence, amount: Paise): Paise {
  switch (cadence) {
    case 'weekly':
      return Math.round((amount * 52) / 12);
    case 'monthly':
      return amount;
    case 'quarterly':
      return Math.round(amount / 3);
    case 'yearly':
      return Math.round(amount / 12);
  }
}

interface Day {
  date: IsoDate;
  amount: Paise;
  ids: string[];
}

interface Run {
  cadence: Cadence;
  intervalDays: number;
  typicalAmount: Paise;
  confidence: number;
}

/** Does this run of payment days look like one recurring series? */
function evaluateRun(days: readonly Day[]): Run | null {
  const k = days.length;
  if (k < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < k; i++) intervals.push(daysBetween(days[i - 1].date, days[i].date));
  const m = median(intervals);
  const spec = CADENCES.find((c) => m >= c.lo && m <= c.hi);
  if (!spec) return null;

  // Every interval must sit in the window; at most one may be a single missed cycle (about 2x).
  let missed = 0;
  for (const iv of intervals) {
    if (iv >= spec.lo && iv <= spec.hi) continue;
    if (iv >= 2 * spec.lo && iv <= 2 * spec.hi && missed === 0) {
      missed++;
      continue;
    }
    return null;
  }

  const amounts = days.map((d) => d.amount);
  const medAmount = median(amounts);
  if (medAmount <= 0) return null;
  const exact = amounts.every((a) => a === amounts[0]);
  if (k === 2) {
    if (spec.cadence !== 'monthly' || !exact) return null;
  } else {
    const mean = amounts.reduce((s, a) => s + a, 0) / k;
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / k);
    const cv = mean > 0 ? sd / mean : Infinity;
    const within = amounts.every((a) => Math.abs(a - medAmount) <= 0.15 * medAmount);
    if (!(cv <= 0.2 || within)) return null;
  }

  const mean = amounts.reduce((s, a) => s + a, 0) / k;
  const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / k);
  const regularity = Math.max(0, 1 - intervals.reduce((s, iv) => s + Math.abs(iv - m), 0) / intervals.length / m);
  const stability = Math.max(0, 1 - (mean > 0 ? sd / mean : 1));
  const countFactor = Math.min(1, 0.5 + 0.125 * k);
  let confidence = regularity * stability * countFactor;
  if (k === 2) confidence = Math.min(confidence, 0.45);
  return {
    cadence: spec.cadence,
    intervalDays: Math.round(m),
    typicalAmount: Math.round(medAmount),
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
  };
}

/**
 * Finds payments that repeat on a regular cadence.
 *
 * Debits of kind expense/fee/loan_payment/p2p_out/investment are grouped by merchantKey (VPA
 * when the key is empty). Payments on the same day are summed. The most recent run of payments
 * (the longest suffix) that passes all checks becomes a series:
 *  - cadence from the median interval: weekly 6-8, monthly 26-35, quarterly 84-98, yearly 350-380 days;
 *  - every interval inside that window, with at most one missed cycle (about 2x the interval);
 *  - stable amounts (coefficient of variation <= 0.2, or all within +-15% of the median);
 *  - at least 3 occurrences (2 only for a monthly series of identical amounts, at low confidence).
 * Two payments 21 months apart are therefore NOT recurring.
 *
 * `decisions` override status: dismissed series are returned with status 'dismissed'; confirmed
 * series are returned (status 'confirmed') even when detection would no longer find them
 * (e.g. the latest month is missing), using the decision's cadence/amount.
 * `overdue` = today is more than 5 days past `nextExpected`. Series whose next payment is
 * long past (see `isSeriesActive`) are still returned; callers should not count them as current
 * commitments unless confirmed.
 */
export function detectRecurring(
  txns: readonly Transaction[],
  decisions: readonly RecurringDecision[],
  today: IsoDate,
): RecurringSeries[] {
  const decisionByKey = new Map(decisions.map((d) => [d.merchantKey, d]));
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.direction !== 'debit' || !RECURRING_KINDS.has(t.kind)) continue;
    const key = t.merchantKey || t.counterparty.vpa;
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: RecurringSeries[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const decision = decisionByKey.get(key);

    const byDay = new Map<IsoDate, Day>();
    for (const t of list) {
      const d = byDay.get(t.date);
      if (d) {
        d.amount += t.amount;
        d.ids.push(t.id);
      } else byDay.set(t.date, { date: t.date, amount: t.amount, ids: [t.id] });
    }
    const days = [...byDay.values()];

    let run: Run | null = null;
    let used: Day[] = days;
    for (let s = 0; s <= days.length - 2; s++) {
      const r = evaluateRun(days.slice(s));
      if (r) {
        run = r;
        used = days.slice(s);
        break;
      }
    }

    const latest = list[list.length - 1];
    const label = decision?.label?.trim() || latest.merchant;

    if (run) {
      const lastDate = used[used.length - 1].date;
      const nextExpected = addDays(lastDate, run.intervalDays);
      out.push({
        merchantKey: key,
        merchant: label,
        category: latest.category,
        cadence: run.cadence,
        intervalDays: run.intervalDays,
        typicalAmount: run.typicalAmount,
        monthlyCost: monthlyCostOf(run.cadence, run.typicalAmount),
        occurrences: used.length,
        lastDate,
        nextExpected,
        confidence: run.confidence,
        status: decision?.status ?? 'suggested',
        txnIds: used.flatMap((d) => d.ids),
        overdue: today > addDays(nextExpected, 5),
      });
    } else if (decision?.status === 'confirmed') {
      const cadence = decision.cadence ?? 'monthly';
      const interval = nominalDays(cadence);
      const recent = days.slice(-3).map((d) => d.amount);
      const typicalAmount = decision.expectedAmount ?? Math.round(median(recent));
      const lastDate = days[days.length - 1].date;
      const nextExpected = addDays(lastDate, interval);
      out.push({
        merchantKey: key,
        merchant: label,
        category: latest.category,
        cadence,
        intervalDays: interval,
        typicalAmount,
        monthlyCost: monthlyCostOf(cadence, typicalAmount),
        occurrences: days.length,
        lastDate,
        nextExpected,
        confidence: 0.5,
        status: 'confirmed',
        txnIds: days.flatMap((d) => d.ids),
        overdue: today > addDays(nextExpected, 5),
      });
    }
  }
  out.sort((a, b) => b.monthlyCost - a.monthlyCost || a.merchantKey.localeCompare(b.merchantKey));
  return out;
}

/**
 * Is the series still current? Confirmed series always are. Others stop counting once the
 * next payment is more than one missed cycle (plus 5 days) overdue.
 */
export function isSeriesActive(s: RecurringSeries, today: IsoDate): boolean {
  if (s.status === 'dismissed') return false;
  if (s.status === 'confirmed') return true;
  return today <= addDays(s.nextExpected, s.intervalDays + 5);
}
