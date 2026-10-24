import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { activityLink } from '@/app/routes';
import { CATEGORY_GROUP_LABELS, categoryById, categoryName } from '@/domain/categories';
import type { CategoryGroup } from '@/domain/types';
import { summarize } from '@/engine/analytics';
import { ChartFrame, Money, SegmentedControl, chartColor, cn } from '@/ui';
import { SeeTransactions, tableCell, tableHead, tableNum } from './shared';
import { useExploreData, useFmt } from './useExploreData';

const GROUP_SLOT: Record<CategoryGroup, number> = {
  essentials: 1,
  lifestyle: 9,
  people: 7,
  commitments: 3,
  fees: 10,
  cash: 2,
  income: 4,
  saving: 5,
  transfer: 8,
  other: 0,
};

interface Slice {
  key: string;
  label: string;
  amount: number;
  share: number;
  color: string;
}

/** Composition donut: plain SVG arcs, so it works without a measured container. */
function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  const fmt = useFmt();
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <svg viewBox="0 0 200 200" className="h-48 w-48 shrink-0 -rotate-90" role="img" aria-label={`Spending by broad group, total ${fmt(total, { whole: true })}`}>
        {slices.map((s) => {
          const len = s.share * c;
          const el = <circle key={s.key} cx="100" cy="100" r={r} fill="none" stroke={s.color} strokeWidth="34" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <ul className="w-full space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="tabular-nums text-fg-muted">
              <Money value={s.amount} whole /> · {Math.round(s.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CategoriesView() {
  const fmt = useFmt();
  const { accounts, statements, customCategories, period, today, scope, periodTxns } = useExploreData();
  const [params] = useSearchParams();
  const focus = params.get('category') ?? undefined;
  const [mode, setMode] = useState<'bars' | 'groups'>('bars');

  const summary = useMemo(
    () => summarize(periodTxns, { accounts, statements, customCategories, start: period.start, end: period.end, today }),
    [periodTxns, accounts, statements, customCategories, period.start, period.end, today],
  );
  const rows = useMemo(() => summary.byCategory.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount), [summary]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const max = rows[0]?.amount ?? 1;
  const groups: Slice[] = useMemo(
    () =>
      summary.byGroup
        .filter((g) => g.amount > 0)
        .map((g) => ({ key: g.group, label: CATEGORY_GROUP_LABELS[g.group], amount: g.amount, share: g.share, color: chartColor(GROUP_SLOT[g.group]) }))
        .sort((a, b) => b.amount - a.amount),
    [summary],
  );
  const top = rows[0];
  const takeaway = top
    ? `${categoryName(top.category, customCategories)} took the most: ${fmt(top.amount, { whole: true })}, ${Math.round(top.share * 100)}% of ${fmt(total, { whole: true })} spent.`
    : undefined;
  const incomplete = !summary.coverage.complete;

  return (
    <ChartFrame
      question="Which categories took most of your spending?"
      scope={scope}
      takeaway={takeaway}
      status={incomplete ? 'incomplete' : 'complete'}
      statusNote={summary.coverage.notes[0] ?? 'Some accounts have no statement for part of this period.'}
      empty={rows.length === 0 ? 'No spending recorded in this period.' : undefined}
      actions={
        <SegmentedControl
          label="Chart type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'bars', label: 'Ranked bars' },
            { value: 'groups', label: 'Broad groups' },
          ]}
        />
      }
      table={
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>Category</th>
              <th className={cn(tableHead, 'text-right')}>Spent</th>
              <th className={cn(tableHead, 'text-right')}>Share</th>
              <th className={cn(tableHead, 'text-right')}>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <td className={tableCell}>
                  <Link className="text-primary underline-offset-2 hover:underline" to={activityLink({ category: r.category })}>
                    {categoryName(r.category, customCategories)}
                  </Link>
                </td>
                <td className={tableNum}>{fmt(r.amount)}</td>
                <td className={tableNum}>{Math.round(r.share * 100)}%</td>
                <td className={tableNum}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {mode === 'bars' ? (
        <ol aria-label="Spending by category, largest first" className="space-y-1">
          {rows.map((r) => {
            const def = categoryById(r.category, customCategories);
            const isFocus = focus === r.category;
            return (
              <li key={r.category}>
                <Link
                  to={activityLink({ category: r.category })}
                  aria-current={isFocus ? 'true' : undefined}
                  aria-label={`${def.name}: ${fmt(r.amount, { whole: true })}, ${Math.round(r.share * 100)}% of spending. See transactions`}
                  className={cn('block rounded-xl px-2 py-1.5 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2', isFocus && 'bg-primary-soft')}
                >
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-fg">{def.name}</span>
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      <Money value={r.amount} whole /> · {Math.round(r.share * 100)}%
                    </span>
                  </span>
                  <span className="mt-1 block h-3 rounded-full bg-surface-2" aria-hidden>
                    <span className="block h-3 rounded-full" style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, background: chartColor(def.colorIndex) }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <Donut slices={groups} total={total} />
      )}
      <div className="mt-2">
        <SeeTransactions to={activityLink({ kind: 'expense' })}>All spending transactions</SeeTransactions>
      </div>
    </ChartFrame>
  );
}
