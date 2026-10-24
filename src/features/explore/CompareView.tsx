import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addDays, addMonths, daysBetween, formatDate, formatMonth, minIso, monthEnd, monthKey, monthStart } from '@/lib/dates';
import { ArrowRight, Target } from 'lucide-react';
import { activityLink } from '@/app/routes';
import { categoryById, categoryName } from '@/domain/categories';
import type { Transaction } from '@/domain/types';
import * as analytics from '@/engine/analytics';
import { ChartFrame, Money, Notice, chartColor, cn } from '@/ui';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData, useFmt, useMask } from './useExploreData';
import { planBudgetLink } from './views';

type Explanation = analytics.ChangeExplanation;
type ExplainCtx = Parameters<typeof analytics.explainChange>[1];

function explain(txns: readonly Transaction[], ctx: ExplainCtx): Explanation {
  return analytics.explainChange(txns, ctx);
}

interface Bar {
  key: string;
  label: string;
  category?: string;
  from: number;
  to: number;
  delta?: number;
  total?: boolean;
  color: string;
  ids?: string[];
}

const sign = (n: number) => (n >= 0 ? '+' : '−');
/** Direction glyph; changes are never coloured as good or bad. */
const Glyph = ({ n }: { n: number }) => <span aria-hidden>{n >= 0 ? '▲ ' : '▼ '}</span>;

type Drivers = NonNullable<analytics.ChangeExplanation['drivers']>;

function DriversSection({ drivers }: { drivers: Drivers }) {
  const { purchases, averageSize, merchantMix, oneOffs, refunds } = drivers;
  const rows: { key: string; node: ReactNode; to?: string }[] = [];
  const d = purchases.current - purchases.previous;
  rows.push({
    key: 'purchases',
    node: (
      <>
        Purchases: {purchases.current} against {purchases.previous} (<Glyph n={d} />
        {sign(d)}
        {Math.abs(d)})
      </>
    ),
  });
  if (purchases.current > 0 && purchases.previous > 0) {
    const a = averageSize.current - averageSize.previous;
    rows.push({
      key: 'avg',
      node: (
        <>
          {a === 0 ? 'Each purchase was about the same size on average' : `Each purchase was ${a > 0 ? 'larger' : 'smaller'} on average`}:{' '}
          <Money value={averageSize.current} whole /> against <Money value={averageSize.previous} whole />
        </>
      ),
    });
  }
  if (merchantMix.newCount > 0 || merchantMix.stoppedCount > 0) {
    rows.push({
      key: 'mix',
      node: (
        <>
          {merchantMix.newCount} new merchant{merchantMix.newCount === 1 ? '' : 's'} (<Money value={merchantMix.newMerchants} whole />),{' '}
          {merchantMix.stoppedCount} you stopped using (<Money value={merchantMix.stoppedMerchants} whole />)
        </>
      ),
    });
  }
  if (refunds.current > 0 || refunds.previous > 0) {
    rows.push({
      key: 'refunds',
      node: (
        <>
          Refunds: <Money value={refunds.current} whole /> against <Money value={refunds.previous} whole />
        </>
      ),
    });
  }
  if (oneOffs.total > 0) {
    rows.push({
      key: 'oneoffs',
      node: (
        <>
          One-off or tagged expenses: <Money value={oneOffs.total} whole /> ({oneOffs.txnIds.length} transaction{oneOffs.txnIds.length === 1 ? '' : 's'})
        </>
      ),
      to: oneOffs.txnIds.length ? activityLink({ ids: oneOffs.txnIds }) : undefined,
    });
  }
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="what-drove-it" className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 id="what-drove-it" className="text-base font-semibold text-fg">
        What drove it
      </h2>
      <ul className="mt-2 divide-y divide-border text-sm">
        {rows.map((r) => (
          <li key={r.key}>
            {r.to ? (
              <Link to={r.to} className="flex min-h-touch items-center justify-between gap-2 py-2 hover:bg-surface-2">
                <span>{r.node}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-label="See transactions" />
              </Link>
            ) : (
              <p className="py-2">{r.node}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CompareView() {
  const fmt = useFmt();
  const mask = useMask();
  const { accounts, statements, transactions, customCategories, period, today, scope } = useExploreData();
  const [focus, setFocus] = useState<string | undefined>();

  // When the selected month is only partly covered, compare equivalent elapsed days (1–24 Oct with 1–24 Sep)
  // instead of stopping at "not comparable" — the review's rule: complete periods, or equivalent elapsed periods.
  const ranges = useMemo(() => {
    const whole = { current: { start: period.start, end: period.end }, previous: undefined as undefined | { start: string; end: string }, elapsed: false };
    if (monthKey(period.start) !== monthKey(period.end)) return whole;
    const through = analytics.dataStatus(accounts, statements, transactions, today).dataThrough;
    if (!through || through < period.start || through >= period.end) return whole;
    const prevMonth = addMonths(monthKey(period.start), -1);
    const prevStart = monthStart(prevMonth);
    const prevEnd = minIso(addDays(prevStart, daysBetween(period.start, through)), monthEnd(prevMonth));
    return { current: { start: period.start, end: through }, previous: { start: prevStart, end: prevEnd }, elapsed: true };
  }, [accounts, statements, transactions, today, period.start, period.end]);

  const exp = useMemo(
    () => explain(transactions, { accounts, statements, current: ranges.current, previous: ranges.previous, today, category: focus, maxMerchants: 8 }),
    [transactions, accounts, statements, ranges, today, focus],
  );
  // The waterfall keeps showing every category so the user can switch focus; only the merchants follow `focus`.
  const cmp = useMemo(
    () => analytics.compareSpending(transactions, { accounts, statements, current: ranges.current, previous: ranges.previous, today, maxSteps: 6 }),
    [transactions, accounts, statements, ranges, today],
  );
  const comparable = cmp.comparable && exp.comparable;

  const bars: Bar[] = useMemo(() => {
    const out: Bar[] = [{ key: 'prev', label: cmp.previous.label, from: 0, to: cmp.previous.total, total: true, color: 'rgb(var(--chart-neutral))' }];
    let run = cmp.previous.total;
    for (const s of cmp.steps) {
      const label = s.category ? categoryName(s.category, customCategories) : s.label;
      const color = s.category ? chartColor(categoryById(s.category, customCategories).colorIndex) : 'rgb(var(--chart-neutral))';
      out.push({ key: s.key, label, category: s.category, from: run, to: run + s.delta, delta: s.delta, color, ids: [...s.txnIdsCurrent, ...s.txnIdsPrevious] });
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
  const focusName = focus ? categoryName(focus, customCategories) : undefined;
  const action = exp.suggestedAction;

  return (
    <div className="space-y-3">
      {ranges.elapsed && comparable && (
        <Notice tone="info">
          {formatMonth(monthKey(period.start))} is only covered through {formatDate(ranges.current.end)}, so this compares the same number of
          days: {formatDate(ranges.current.start, { short: true })}–{formatDate(ranges.current.end, { short: true })} with{' '}
          {formatDate(ranges.previous!.start, { short: true })}–{formatDate(ranges.previous!.end, { short: true })}.
        </Notice>
      )}
      <ChartFrame
        question={`Why did spending change between ${cmp.previous.label} and ${cmp.current.label}?`}
        scope={comparable ? `${scope} · ${cmp.basis}` : scope}
        takeaway={comparable && exp.headline ? mask(exp.headline) : undefined}
        status={comparable ? 'complete' : 'incomplete'}
        statusNote={mask(cmp.note ?? 'At least one of the periods is not fully covered by statements, so a change would be misleading.')}
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
                  <td className={tableCell}>
                    {b.ids?.length ? (
                      <Link className="text-primary hover:underline" to={activityLink({ ids: b.ids })}>
                        {b.label}
                      </Link>
                    ) : (
                      b.label
                    )}
                  </td>
                  <td className={tableNum}>{b.total ? '' : `${(b.delta ?? 0) >= 0 ? '▲' : '▼'} ${sign(b.delta ?? 0)}${fmt(Math.abs(b.delta ?? 0))}`}</td>
                  <td className={tableNum}>{fmt(b.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        {comparable ? (
          <>
            <p className="mb-3 text-sm text-fg-muted">
              Total change{' '}
              <span className="font-semibold tabular-nums text-fg">
                <Glyph n={diff} />
                {sign(diff)}
                <Money value={Math.abs(diff)} whole />
              </span>{' '}
              ({cmp.previous.label} <Money value={cmp.previous.total} whole /> to {cmp.current.label} <Money value={cmp.current.total} whole />). Tap a category to see what drove it.
            </p>
            <ol aria-label="Waterfall from the previous total to the current total" className="space-y-1">
              {bars.map((b) => {
                const left = (Math.min(b.from, b.to) / scale) * 100;
                const width = Math.max(1.5, (Math.abs(b.to - b.from) / scale) * 100);
                const body = (
                  <>
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-fg">{b.label}</span>
                      <span className="shrink-0 tabular-nums text-fg">
                        {b.total ? (
                          <Money value={b.to} whole />
                        ) : (
                          <>
                            <Glyph n={b.delta ?? 0} />
                            {sign(b.delta ?? 0)}
                            <Money value={Math.abs(b.delta ?? 0)} whole />
                          </>
                        )}
                      </span>
                    </span>
                    <span className="relative mt-1 block h-3 rounded-full bg-surface-2" aria-hidden>
                      <span className="absolute top-0 block h-3 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: b.color }} />
                    </span>
                  </>
                );
                const selected = !!b.category && focus === b.category;
                return (
                  <li key={b.key} className="flex items-center gap-1">
                    {b.category ? (
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${b.label}: ${(b.delta ?? 0) >= 0 ? 'up' : 'down'} ${fmt(Math.abs(b.delta ?? 0), { whole: true })}. ${selected ? 'Showing its merchants, tap to show all' : 'Show what drove this'}`}
                        onClick={() => setFocus(selected ? undefined : b.category)}
                        className={cn('block min-h-touch flex-1 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2', selected && 'bg-primary-soft')}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex-1 px-2 py-1.5">{body}</div>
                    )}
                    {b.ids?.length ? (
                      <Link
                        to={activityLink({ ids: b.ids })}
                        aria-label={`See transactions for ${b.label}`}
                        className="flex h-touch w-touch shrink-0 items-center justify-center rounded-lg text-primary hover:bg-surface-2"
                      >
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    ) : (
                      <span className="w-touch shrink-0" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ol>
          </>
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

      {comparable && exp.drivers && <DriversSection drivers={exp.drivers} />}

      {comparable && exp.merchants.length > 0 && (
        <section aria-labelledby="merchant-drivers" className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="merchant-drivers" className="text-base font-semibold text-fg">
              {focusName ? `Which ${focusName} merchants changed most?` : 'Which merchants changed most?'}
            </h2>
            {focus && (
              <button type="button" onClick={() => setFocus(undefined)} className="min-h-touch rounded-lg px-2 text-sm font-medium text-primary hover:bg-surface-2">
                Show all categories
              </button>
            )}
          </div>
          <ol aria-label="Merchants driving the change" className="mt-2 divide-y divide-border">
            {exp.merchants.map((m) => {
              const mids = [...m.txnIdsCurrent, ...m.txnIdsPrevious];
              const dCount = m.current.count - m.previous.count;
              return (
                <li key={`${m.category}:${m.merchant}`}>
                  <Link
                    to={activityLink({ ids: mids })}
                    aria-label={`${m.merchant}: ${mask(m.sentence)} See transactions`}
                    className="block min-h-touch rounded-xl px-1 py-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
                  >
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-fg">{m.merchant}</span>
                      <span className="shrink-0 tabular-nums text-fg">
                        <Glyph n={m.delta} />
                        {sign(m.delta)}
                        <Money value={Math.abs(m.delta)} whole />
                      </span>
                    </span>
                    <span className="mt-0.5 block text-sm text-fg-muted">{mask(m.sentence)}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-fg-muted">
                      <Glyph n={dCount} />
                      {sign(dCount)}
                      {Math.abs(dCount)} order{Math.abs(dCount) === 1 ? '' : 's'} <Money value={Math.abs(m.frequencyEffect)} whole /> · {m.sizeEffect >= 0 ? 'larger' : 'smaller'} orders{' '}
                      <Money value={Math.abs(m.sizeEffect)} whole />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {action && (
              <Link
                to={planBudgetLink({ category: action.category, target: action.suggestedTarget })}
                className="inline-flex min-h-touch items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90"
              >
                <Target className="h-4 w-4" aria-hidden />
                {(action.label && mask(action.label)) ?? `Set a limit for ${categoryName(action.category, customCategories)}`}
              </Link>
            )}
            <Link to={planBudgetLink({ scenario: true })} className="inline-flex min-h-touch items-center rounded-xl border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2">
              Try a scenario
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
