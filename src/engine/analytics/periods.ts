import type { IsoDate, MonthKey, Statement, Transaction } from '@/domain/types';
import { addMonths, formatDate, formatMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';
import type { Period, PeriodPreset } from './index';
import { shortMonthName } from './util';

/** "Sep 2025" */
function monthYear(m: MonthKey): string {
  return `${shortMonthName(m)} ${m.slice(0, 4)}`;
}

/** "Sep 2025" for one month; "Jul – Sep 2025" within a year; "Nov 2024 – Feb 2025" across years. */
export function monthRangeLabel(first: MonthKey, last: MonthKey): string {
  if (first === last) return formatMonth(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${shortMonthName(first)} – ${monthYear(last)}`;
  return `${monthYear(first)} – ${monthYear(last)}`;
}

function monthsPeriod(preset: PeriodPreset, first: MonthKey, last: MonthKey): Period {
  return { preset, start: monthStart(first), end: monthEnd(last), label: monthRangeLabel(first, last) };
}

function customLabel(start: IsoDate, end: IsoDate): string {
  const wholeMonths = start === monthStart(monthKey(start)) && end === monthEnd(monthKey(end));
  if (wholeMonths) return monthRangeLabel(monthKey(start), monthKey(end));
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

/**
 * Month-based presets cover whole calendar months with inclusive bounds (1st .. last day),
 * so Oct 1 and Oct 31 are both inside October. "Last N months" ends with the current month.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  opts: { today: IsoDate; custom?: { start: IsoDate; end: IsoDate }; dataRange?: { min: IsoDate; max: IsoDate } },
): Period {
  const cur = monthKey(opts.today);
  switch (preset) {
    case 'this_month':
      return monthsPeriod(preset, cur, cur);
    case 'last_month': {
      const m = addMonths(cur, -1);
      return monthsPeriod(preset, m, m);
    }
    case 'last_3_months':
      return monthsPeriod(preset, addMonths(cur, -2), cur);
    case 'last_6_months':
      return monthsPeriod(preset, addMonths(cur, -5), cur);
    case 'last_12_months':
      return monthsPeriod(preset, addMonths(cur, -11), cur);
    case 'this_year': {
      const y = cur.slice(0, 4);
      return { preset, start: `${y}-01-01`, end: `${y}-12-31`, label: y };
    }
    case 'all': {
      const r = opts.dataRange;
      if (!r) return { preset, start: monthStart(cur), end: monthEnd(cur), label: 'All time' };
      const a = monthKey(r.min);
      const b = monthKey(r.max);
      return { preset, start: r.min, end: r.max, label: `All time (${monthYear(a)} – ${monthYear(b)})` };
    }
    case 'custom': {
      if (!opts.custom) return monthsPeriod(preset, cur, cur);
      const { start, end } = opts.custom;
      const [s, e] = start <= end ? [start, end] : [end, start];
      return { preset, start: s, end: e, label: customLabel(s, e) };
    }
  }
}

export function dataRange(txns: readonly Transaction[]): { min: IsoDate; max: IsoDate } | null {
  if (txns.length === 0) return null;
  let min = txns[0].date;
  let max = txns[0].date;
  for (const t of txns) {
    if (t.date < min) min = t.date;
    if (t.date > max) max = t.date;
  }
  return { min, max };
}

/**
 * The month the app should open on. It is the calendar month of the latest statement `periodEnd`
 * (a few rows dated just after a statement closes must not pull the view into a nearly empty month),
 * falling back to the latest transaction month. If that month holds under 5% of the rows of the
 * latest statement (or, without statements, of the busiest month), the latest earlier month with
 * enough rows is used instead, when one exists.
 */
export function defaultPeriod(txns: readonly Transaction[], today: IsoDate, statements: readonly Statement[] = []): Period {
  const r = dataRange(txns);
  const ends = statements.map((s) => s.periodEnd).filter((d): d is IsoDate => !!d);
  const latestEnd = ends.length > 0 ? ends.reduce((a, b) => (b > a ? b : a)) : undefined;
  if (!r && !latestEnd) return resolvePeriod('this_month', { today });

  const counts = new Map<MonthKey, number>();
  for (const t of txns) counts.set(monthKey(t.date), (counts.get(monthKey(t.date)) ?? 0) + 1);

  let month = latestEnd ? monthKey(latestEnd) : monthKey((r as { max: IsoDate }).max);
  let reference = Math.max(0, ...counts.values());
  if (latestEnd) {
    const latestStatements = statements.filter((s) => s.periodEnd === latestEnd);
    const rows = Math.max(0, ...latestStatements.map((s) => txns.filter((t) => t.statementId === s.id).length || s.rowCount));
    if (rows > 0) reference = rows;
  }
  const enough = (m: MonthKey): boolean => (counts.get(m) ?? 0) >= reference * 0.05;
  if (reference > 0 && !enough(month)) {
    const better = [...counts.keys()].filter((m) => m <= month && enough(m)).sort();
    if (better.length > 0) month = better[better.length - 1];
  }
  if (month === monthKey(today)) return resolvePeriod('this_month', { today });
  return { preset: 'custom', start: monthStart(month), end: monthEnd(month), label: formatMonth(month) };
}
