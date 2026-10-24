import type { ExploreView } from '@/app/routes';

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

