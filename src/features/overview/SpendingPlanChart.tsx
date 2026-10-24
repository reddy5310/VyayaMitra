import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CumulativeSeries } from '@/engine/analytics';
import { formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { ChartFrame, Money, chartColor, usePrivacy } from '@/ui';

interface Props {
  series: CumulativeSeries | null;
  scope: string;
  loading?: boolean;
  /** True when some of the period is not covered by statements. */
  incomplete: boolean;
  hasPlan: boolean;
}

/**
 * The one chart on Overview: cumulative recorded spending against an even-pace plan line.
 * Days with no statement coverage are gaps in the actual line (never zero); a projection, when
 * the engine offers one, is a separate dotted line.
 */
export function SpendingPlanChart({ series, scope, loading, incomplete, hasPlan }: Props) {
  const { hideAmounts } = usePrivacy();
  const points = series?.points ?? [];
  const hasProjection = points.some((p) => p.projected !== undefined);
  const covered = points.filter((p) => p.covered && p.actual !== null);
  const last = covered[covered.length - 1];

  const rows = points.map((p) => ({
    label: formatDate(p.date, { short: true }),
    actual: p.actual,
    plan: p.plan ?? null,
    projected: p.projected ?? null,
  }));
  // The table lists about ten evenly spaced covered days plus the last one.
  const step = Math.max(1, Math.ceil(covered.length / 10));
  const tableRows = covered.filter((_, i) => i % step === 0 || i === covered.length - 1);

  const takeaway =
    series && last && last.actual !== null ? (
      <>
        <Money value={last.actual} whole className="font-medium" /> recorded by {formatDate(last.date)}
        {hasPlan && last.plan !== undefined ? (
          <>
            , against about <Money value={last.plan} whole /> if your plan were spread evenly.
          </>
        ) : (
          '.'
        )}
        {!hasPlan && ' Set budgets to add a plan line.'}
        {hasProjection && series.projectionNote ? ` ${series.projectionNote}` : ''}
      </>
    ) : undefined;

  return (
    <ChartFrame
      question="Is your spending on pace with your plan?"
      scope={scope}
      takeaway={takeaway}
      status={incomplete ? 'incomplete' : hasProjection ? 'estimate' : 'complete'}
      statusNote={
        incomplete
          ? 'Days without a statement are left blank, not drawn as zero spending.'
          : 'The dotted line is a projection from your pace so far, not a promise.'
      }
      loading={loading}
      empty={!loading && covered.length === 0 ? 'No covered days in this period yet. Import a statement that includes these dates.' : undefined}
      table={
        <table className="w-full min-w-[18rem] text-left text-sm">
          <caption className="sr-only">Cumulative spending by date</caption>
          <thead className="text-xs text-fg-muted">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">Date</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Spent so far</th>
              <th scope="col" className="py-1.5 text-right font-medium">Plan pace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tableRows.map((p) => (
              <tr key={p.date}>
                <th scope="row" className="py-1.5 pr-3 font-normal text-fg">{formatDate(p.date)}</th>
                <td className="py-1.5 pr-3 text-right"><Money value={p.actual ?? 0} whole /></td>
                <td className="py-1.5 text-right">{p.plan !== undefined ? <Money value={p.plan} whole /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div
        role="img"
        aria-label="Line chart of cumulative spending through the period against your plan. The same figures are in the table below."
        className="h-56 w-full"
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 224 }}>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }} />
            {hideAmounts ? (
              <YAxis hide />
            ) : (
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }}
                tickFormatter={(v: number) => formatINR(v, { compact: true })}
              />
            )}
            {!hideAmounts && (
              <Tooltip
                formatter={(v: number, name: string) => [formatINR(v, { whole: true }), name]}
                contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 12, fontSize: 12 }}
              />
            )}
            {hasPlan && (
              <Line name="Plan pace" dataKey="plan" stroke="rgb(var(--chart-axis))" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
            )}
            {hasProjection && (
              <Line name="Projection" dataKey="projected" stroke={chartColor(3)} strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls isAnimationActive={false} />
            )}
            <Line name="Recorded spending" dataKey="actual" stroke={chartColor(1)} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Chart legend">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-5" style={{ backgroundColor: chartColor(1) }} /> Recorded spending
        </li>
        {hasPlan && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="w-5 border-t-2 border-dashed border-fg-subtle" /> Plan pace
          </li>
        )}
        {hasProjection && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="w-5 border-t-2 border-dotted" style={{ borderColor: chartColor(3) }} /> Projection
          </li>
        )}
      </ul>
    </ChartFrame>
  );
}
