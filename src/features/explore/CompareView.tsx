import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { activityLink } from '@/app/routes';
import { categoryById, categoryName } from '@/domain/categories';
import { compareSpending, type WaterfallStep } from '@/engine/analytics';
import { formatINR } from '@/lib/money';
import { ChartFrame, Money, Notice, chartColor, cn } from '@/ui';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData } from './useExploreData';

interface Bar {
  key: string;
  label: string;
  from: number;
  to: number;
  delta?: number;
  total?: boolean;
  color: string;
  ids?: string[];
}

function stepIds(s: WaterfallStep): string[] {
  return [...s.txnIdsCurrent, ...s.txnIdsPrevious];
}

export default function CompareView() {
  const { accounts, statements, transactions, customCategories, period, today, scope } = useExploreData();
  const cmp = useMemo(
    () => compareSpending(transactions, { accounts, statements, current: { start: period.start, end: period.end }, today, maxSteps: 6 }),
    [transactions, accounts, statements, period.start, period.end, today],
  );

  const bars: Bar[] = useMemo(() => {
    const out: Bar[] = [{ key: 'prev', label: cmp.previous.label, from: 0, to: cmp.previous.total, total: true, color: 'rgb(var(--chart-neutral))' }];
    let run = cmp.previous.total;
    for (const s of cmp.steps) {
      const label = s.category ? categoryName(s.category, customCategories) : s.label;
      const color = s.category ? chartColor(categoryById(s.category, customCategories).colorIndex) : 'rgb(var(--chart-neutral))';
      out.push({ key: s.key, label, from: run, to: run + s.delta, delta: s.delta, color, ids: stepIds(s) });
      run += s.delta;
    }
    if (cmp.other !== 0) {
      out.push({ key: 'other', label: 'Everything else', from: run, to: run + cmp.other, delta: cmp.other, color: 'rgb(var(--chart-neutral))' });
      run += cmp.other;
    }
    out.push({ key: 'cur', label: cmp.current.label, from: 0, to: cmp.current.total, total: true, color: 'rgb(var(--chart-neutral))' });
    return out;
  }, [cmp, customCategories]);

  const scale = Math.max(1, ...bars.flatMap((b) => [b.from, b.to]));
  const diff = cmp.current.total - cmp.previous.total;
  const biggest = [...cmp.steps].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const takeaway =
    cmp.comparable && cmp.steps.length > 0
      ? `You spent ${formatINR(Math.abs(diff), { whole: true })} ${diff >= 0 ? 'more' : 'less'} than in ${cmp.previous.label}${
          biggest ? `, mostly from ${biggest.category ? categoryName(biggest.category, customCategories) : biggest.label}` : ''
        }.`
      : undefined;

  return (
    <div className="space-y-3">
      {!cmp.comparable && (
        <Notice tone="warning" title="These periods cannot be compared fairly yet">
          {cmp.note ?? 'At least one of the periods is not fully covered by statements, so a change would be misleading.'}
        </Notice>
      )}
      <ChartFrame
        question={`What changed in spending between ${cmp.previous.label} and ${cmp.current.label}?`}
        scope={`${scope} · ${cmp.basis}`}
        takeaway={takeaway}
        status={cmp.comparable ? 'complete' : 'incomplete'}
        statusNote={cmp.note}
        table={
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={tableHead}>Step</th>
                <th className={cn(tableHead, 'text-right')}>Change</th>
                <th className={cn(tableHead, 'text-right')}>Running total</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key}>
                  <td className={tableCell}>{b.ids?.length ? <Link className="text-primary hover:underline" to={activityLink({ ids: b.ids })}>{b.label}</Link> : b.label}</td>
                  <td className={tableNum}>{b.total ? '' : `${(b.delta ?? 0) >= 0 ? '+' : '−'}${formatINR(Math.abs(b.delta ?? 0))}`}</td>
                  <td className={tableNum}>{formatINR(b.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        {cmp.comparable ? (
          <ol aria-label="Waterfall from the previous total to the current total" className="space-y-1">
            {bars.map((b) => {
              const left = (Math.min(b.from, b.to) / scale) * 100;
              const width = Math.max(1.5, (Math.abs(b.to - b.from) / scale) * 100);
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-medium text-fg">{b.label}</span>
                    <span className={cn('shrink-0 tabular-nums', b.total ? 'text-fg' : (b.delta ?? 0) > 0 ? 'text-negative' : 'text-positive')}>
                      {b.total ? <Money value={b.to} whole /> : `${(b.delta ?? 0) >= 0 ? '+' : '−'}${formatINR(Math.abs(b.delta ?? 0), { whole: true })}`}
                    </span>
                  </span>
                  <span className="relative mt-1 block h-3 rounded-full bg-surface-2" aria-hidden>
                    <span className="absolute top-0 block h-3 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: b.color }} />
                  </span>
                </>
              );
              return (
                <li key={b.key}>
                  {b.ids?.length ? (
                    <Link
                      to={activityLink({ ids: b.ids })}
                      aria-label={`${b.label}: ${(b.delta ?? 0) >= 0 ? 'up' : 'down'} ${formatINR(Math.abs(b.delta ?? 0), { whole: true })}. See the transactions behind this step`}
                      className="block rounded-xl px-2 py-1.5 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="px-2 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[cmp.previous, cmp.current].map((p) => (
              <div key={p.label} className="rounded-xl bg-surface-2 p-3">
                <dt className="text-fg-muted">{p.label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  <Money value={p.total} whole />
                </dd>
                <dd className="text-xs text-fg-muted">recorded so far</dd>
              </div>
            ))}
          </dl>
        )}
      </ChartFrame>
    </div>
  );
}
