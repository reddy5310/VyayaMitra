import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Period } from '@/engine/analytics';
import type { LedgerQuery } from '@/engine/analytics';
import { KIND_LABELS } from '@/domain/kinds';
import type { TxnKind } from '@/domain/types';
import { parseAmountToPaise } from '@/lib/money';

/** Broader than a single kind: what the money is doing. Resolved by `applyQuery`. */
export type KindGroup = NonNullable<LedgerQuery['kindGroup']>;
export const KIND_GROUP_LABELS: Record<KindGroup, string> = {
  spending: 'Spending',
  income: 'Income',
  transfer: 'Transfers',
  refund: 'Refunds',
  saving: 'Saving & investing',
  people: 'People',
};
export type ActivityQuery = LedgerQuery;

export interface ActivityFilters {
  q: string;
  accountId: string;
  category: string;
  kind: TxnKind | '';
  review: boolean;
  ids: string[];
  kindGroup: KindGroup | '';
  /** Rupees as typed ("1,250"); converted to paise in buildQuery. */
  min: string;
  max: string;
  merchant: string;
  statementId: string;
  recurring: boolean;
}

export const EMPTY_FILTERS: ActivityFilters = { q: '', accountId: '', category: '', kind: '', review: false, ids: [], kindGroup: '', min: '', max: '', merchant: '', statementId: '', recurring: false };

/** Params this page owns (everything except `txn`, which only controls the detail sheet). */
const FILTER_PARAMS = ['q', 'account', 'category', 'kind', 'review', 'ids', 'group', 'min', 'max', 'merchant', 'statement', 'recurring'] as const;

export function filtersFromParams(sp: URLSearchParams): ActivityFilters {
  const kind = sp.get('kind') ?? '';
  const group = sp.get('group') ?? '';
  return {
    kindGroup: group in KIND_GROUP_LABELS ? (group as KindGroup) : '',
    min: sp.get('min') ?? '',
    max: sp.get('max') ?? '',
    merchant: sp.get('merchant') ?? '',
    statementId: sp.get('statement') ?? '',
    recurring: sp.get('recurring') === '1',
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
export function buildQuery(
  f: ActivityFilters,
  period: Pick<Period, 'start' | 'end'>,
  /** merchantKeys of the active recurring series (only needed when the Recurring filter is on). */
  recurringKeys: readonly string[] = [],
): ActivityQuery {
  const q: ActivityQuery = {};
  if (f.ids.length) q.ids = f.ids;
  // The review queue is everything that still needs a look, whatever the period (matches the Overview count).
  else if (!f.review) {
    q.start = period.start;
    q.end = period.end;
  }
  if (f.accountId) q.accountIds = [f.accountId];
  if (f.category) q.categories = [f.category];
  if (f.kind) q.kinds = [f.kind];
  if (f.review) q.needsReview = true;
  const search = f.q.trim();
  if (search) q.search = search;
  if (f.kindGroup) q.kindGroup = f.kindGroup;
  const min = amountToPaise(f.min);
  const max = amountToPaise(f.max);
  if (min !== null) q.minAmount = min;
  if (max !== null) q.maxAmount = max;
  if (f.statementId) q.statementIds = [f.statementId];
  // Recurring and a chosen merchant combine: only merchants that are both. No match means no rows, not all rows.
  let keys: string[] | undefined = f.merchant ? [f.merchant] : undefined;
  if (f.recurring) keys = keys ? keys.filter((k) => recurringKeys.includes(k)) : [...recurringKeys];
  if (keys) q.merchantKeys = keys.length ? keys : ['\u0000none'];
  return q;
}

/** "1,250" or "250.50" rupees → paise; blank or unreadable → null (the filter is simply not applied). */
export function amountToPaise(text: string): number | null {
  if (!text.trim()) return null;
  const paise = parseAmountToPaise(text.replace(/^\s*₹\s*/, ''));
  return paise !== null && paise >= 0 ? paise : null;
}

export function activeFilterCount(f: ActivityFilters): number {
  return (
    (f.q.trim() ? 1 : 0) +
    (f.accountId ? 1 : 0) +
    (f.category ? 1 : 0) +
    (f.kind ? 1 : 0) +
    (f.review ? 1 : 0) +
    (f.kindGroup ? 1 : 0) +
    (f.min.trim() ? 1 : 0) +
    (f.max.trim() ? 1 : 0) +
    (f.merchant ? 1 : 0) +
    (f.statementId ? 1 : 0) +
    (f.recurring ? 1 : 0)
  );
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
          set('group', merged.kindGroup);
          set('min', merged.min.trim());
          set('max', merged.max.trim());
          set('merchant', merged.merchant);
          set('statement', merged.statementId);
          set('recurring', merged.recurring ? '1' : '');
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
