import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Period } from '@/engine/analytics';
import type { LedgerQuery } from '@/engine/analytics';
import { KIND_LABELS } from '@/domain/kinds';
import type { TxnKind } from '@/domain/types';

export interface ActivityFilters {
  q: string;
  accountId: string;
  category: string;
  kind: TxnKind | '';
  review: boolean;
  ids: string[];
}

export const EMPTY_FILTERS: ActivityFilters = { q: '', accountId: '', category: '', kind: '', review: false, ids: [] };

/** Params this page owns (everything except `txn`, which only controls the detail sheet). */
const FILTER_PARAMS = ['q', 'account', 'category', 'kind', 'review', 'ids'] as const;

export function filtersFromParams(sp: URLSearchParams): ActivityFilters {
  const kind = sp.get('kind') ?? '';
  return {
    q: sp.get('q') ?? '',
    accountId: sp.get('account') ?? '',
    category: sp.get('category') ?? '',
    kind: kind in KIND_LABELS ? (kind as TxnKind) : '',
    review: sp.get('review') === '1',
    ids: (sp.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * The ONE query used by the list, the totals header, the review queue and the CSV export.
 * An explicit `ids` list means "exactly these transactions", so the period does not narrow it.
 */
export function buildQuery(f: ActivityFilters, period: Pick<Period, 'start' | 'end'>): LedgerQuery {
  const q: LedgerQuery = {};
  if (f.ids.length) q.ids = f.ids;
  else {
    q.start = period.start;
    q.end = period.end;
  }
  if (f.accountId) q.accountIds = [f.accountId];
  if (f.category) q.categories = [f.category];
  if (f.kind) q.kinds = [f.kind];
  if (f.review) q.needsReview = true;
  const search = f.q.trim();
  if (search) q.search = search;
  return q;
}

export function activeFilterCount(f: ActivityFilters): number {
  return (f.q.trim() ? 1 : 0) + (f.accountId ? 1 : 0) + (f.category ? 1 : 0) + (f.kind ? 1 : 0) + (f.review ? 1 : 0);
}

/** Filters live in the URL so deep links work and the back button behaves. */
export function useActivityFilters() {
  const [params, setParams] = useSearchParams();
  // Keyed by the filter values only, so opening a detail sheet (?txn=) does not rebuild the query or reset the list.
  const filterKey = JSON.stringify(filtersFromParams(params));
  const filters = useMemo(() => JSON.parse(filterKey) as ActivityFilters, [filterKey]);

  const update = useCallback(
    (patch: Partial<ActivityFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...filtersFromParams(prev), ...patch };
          const set = (key: string, value: string) => (value ? next.set(key, value) : next.delete(key));
          set('q', merged.q);
          set('account', merged.accountId);
          set('category', merged.category);
          set('kind', merged.kind);
          set('review', merged.review ? '1' : '');
          set('ids', merged.ids.join(','));
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clearAll = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of FILTER_PARAMS) next.delete(key);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return { filters, filterKey, update, clearAll };
}
