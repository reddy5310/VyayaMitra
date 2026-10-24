import { ROUTES, type ExploreView } from '@/app/routes';
import type { Paise } from '@/domain/types';

export const VIEWS: { value: ExploreView; label: string }[] = [
  { value: 'categories', label: 'Categories' },
  { value: 'trends', label: 'Trends' },
  { value: 'compare', label: 'Compare' },
  { value: 'merchants', label: 'Merchants' },
  { value: 'patterns', label: 'Patterns' },
  { value: 'flow', label: 'Money flow' },
];

export function parseView(raw: string | null): ExploreView {
  return VIEWS.some((v) => v.value === raw) ? (raw as ExploreView) : 'categories';
}


/** Axis/legend label for a month: "Sep" within one year, "Sep 2025" once the range spans years. */
export function monthAxisLabel(month: string, spansYears: boolean, long: (m: string) => string): string {
  const full = long(month); // "September 2025"
  const [name, year] = full.split(' ');
  const short = name.slice(0, 3);
  return spansYears ? `${short} ${year}` : short;
}

/** Plan deep link that opens the budgets tab, optionally with a category and monthly target prefilled. */
export function planBudgetLink(p: { category?: string; target?: Paise; scenario?: boolean }): string {
  const sp = new URLSearchParams({ tab: 'budgets' });
  if (p.category) sp.set('category', p.category);
  if (p.target !== undefined) sp.set('target', String(p.target));
  if (p.scenario) sp.set('scenario', '1');
  return `${ROUTES.plan}?${sp.toString()}`;
}
