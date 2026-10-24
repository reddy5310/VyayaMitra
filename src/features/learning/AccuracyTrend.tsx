import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LearningStats } from '@/engine/analytics';
import { formatMonth, formatMonthShort } from '@/lib/dates';
import { Card, CardHeader, chartColor } from '@/ui';

type Point = LearningStats['accuracyTrend'][number];

const pct = (v: number | null) => (v === null ? null : Math.round(v * 100));

/**
 * Monthly share of automatic decisions the user did not have to change. Months with no feedback are
 * gaps, not zeros: no corrections means nothing was measured, which is not the same as being right.
 */
export function AccuracyTrend({ trend }: { trend: Point[] }) {
  const rows = trend.map((p) => ({ ...p, label: formatMonthShort(p.month), percent: pct(p.accuracy) }));
  const measured = rows.filter((r) => r.percent !== null);
  const latest = measured[measured.length - 1];

  return (
    <Card>
      <CardHeader
        title="How often VyayaMitra got it right"
        subtitle="Share of automatic decisions you did not need to change, by month"
      />
      {measured.length === 0 ? (
        <p className="py-2 text-sm text-fg-muted">
          Nothing to measure yet. Accuracy appears once you have confirmed or corrected some transactions.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-fg-muted">
            {formatMonth(latest.month)}: {latest.percent}% right, with {latest.corrections}{' '}
            {latest.corrections === 1 ? 'correction' : 'corrections'} in {latest.decisions} reviewed decisions.
          </p>
          <div role="img" aria-label="Line chart of monthly accuracy. The same figures are in the data table below." className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 192 }}>
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }} />
                <YAxis
                  width={40}
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, 'Accuracy']}
                  contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 12, fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="percent"
                  stroke={chartColor(1)}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColor(1) }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-3 text-sm">
            <summary className="min-h-touch cursor-pointer py-2 font-medium text-primary">View data table</summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-sm">
                <caption className="sr-only">Monthly accuracy of automatic decisions</caption>
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Month</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Accuracy</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Corrections</th>
                    <th scope="col" className="py-1.5 text-right font-medium">Decisions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <th scope="row" className="py-1.5 pr-3 font-normal text-fg">{formatMonth(r.month)}</th>
                      <td className="py-1.5 pr-3 text-right tabular">{r.percent === null ? 'Not measured' : `${r.percent}%`}</td>
                      <td className="py-1.5 pr-3 text-right tabular">{r.corrections}</td>
                      <td className="py-1.5 text-right tabular">{r.decisions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
