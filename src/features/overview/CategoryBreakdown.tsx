import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORY_GROUP_LABELS, categoryById } from '@/domain/categories';
import type { CategoryGroup, CustomCategory } from '@/domain/types';
import type { LedgerSummary } from '@/engine/analytics';
import { activityLink } from '@/app/routes';
import { Card, CardHeader, CategoryIcon, Money, chartColor } from '@/ui';

const SPENDING_GROUPS: CategoryGroup[] = ['essentials', 'lifestyle', 'people', 'commitments', 'fees', 'cash'];
const COLLAPSED_COUNT = 7;

function pct(share: number): string {
  const v = share * 100;
  return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
}

/** Category list as accessible horizontal bars; every row opens Activity filtered to that category. */
export function CategoryBreakdown({
  summary,
  customCategories,
}: {
  summary: LedgerSummary;
  customCategories: readonly CustomCategory[];
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = summary.byCategory.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const groups = summary.byGroup.filter((g) => SPENDING_GROUPS.includes(g.group) && g.amount > 0);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <Card>
      <CardHeader title="Where your money went" subtitle="Tap a category to see its transactions" />
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">No spending recorded in this period.</p>
      ) : (
        <>
          {groups.length > 0 && (
            <ul aria-label="Spending by group" className="mb-3 flex flex-wrap gap-2">
              {groups.map((g) => (
                <li key={g.group} className="rounded-xl bg-surface-2 px-3 py-1.5 text-sm">
                  <span className="text-fg-muted">{CATEGORY_GROUP_LABELS[g.group]}</span>{' '}
                  <Money value={g.amount} whole className="font-medium text-fg" />{' '}
                  <span className="text-fg-subtle">{pct(g.share)}</span>
                </li>
              ))}
            </ul>
          )}
          <ul className="divide-y divide-border">
            {visible.map((c) => {
              const def = categoryById(c.category, customCategories);
              return (
                <li key={c.category}>
                  <Link
                    to={activityLink({ category: c.category })}
                    className="-mx-2 flex min-h-touch items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2"
                  >
                    <CategoryIcon category={c.category} custom={customCategories} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{def.name}</span>
                        <span className="shrink-0 text-sm text-fg">
                          <Money value={c.amount} whole />
                          <span className="ml-2 inline-block w-9 text-right text-xs text-fg-muted">{pct(c.share)}</span>
                        </span>
                      </span>
                      <span aria-hidden className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.max(2, Math.min(100, c.share * 100))}%`, backgroundColor: chartColor(def.colorIndex) }}
                        />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {rows.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              aria-expanded={showAll}
              className="mt-2 min-h-touch w-full rounded-xl text-sm font-medium text-primary hover:bg-surface-2"
            >
              {showAll ? 'Show fewer' : `Show all ${rows.length} categories`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
