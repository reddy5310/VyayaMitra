import type { MonthKey } from '@/domain/types';
import type { ImportPreview } from '@/engine/import';
import { addMonths, monthEnd, monthKey, monthStart } from '@/lib/dates';

/**
 * The calendar month to show after an import: the latest month the statement period fully covers
 * (e.g. a 3 Jun – 3 Dec statement lands on November), else the month its period ends (card cycles such
 * as 21 Jun – 20 Jul land on July). Rows dated just outside the period never widen it.
 */
export function landingMonth(preview: Pick<ImportPreview, 'parsed' | 'rows'>): MonthKey | null {
  const dates = preview.rows.map((r) => r.row.date).sort();
  const start = preview.parsed.periodStart ?? dates[0];
  const end = preview.parsed.periodEnd ?? dates[dates.length - 1];
  if (!start || !end) return null;
  for (let m = monthKey(end); m >= monthKey(start); m = addMonths(m, -1)) {
    if (monthStart(m) >= start && monthEnd(m) <= end) return m;
  }
  return monthKey(end);
}
