import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyPoint } from '@/engine/analytics';
import { formatMonth, formatMonthShort } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { Card, CardHeader, Money, chartColor, usePrivacy } from '@/ui';

const INCOME_COLOR = chartColor(1);
const SPENDING_COLOR = chartColor(3);

interface Row {
  month: string;
  label: string;
  income: number;
  spending: number;
  complete: boolean;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-card">
      <p className="font-medium text-fg">{formatMonth(row.month)}</p>
      <p className="text-fg-muted">Income {formatINR(row.income, { whole: true })}</p>
      <p className="text-fg-muted">Spending {formatINR(row.spending, { whole: true })}</p>
      {!row.complete && <p className="mt-1 text-warning">Statements do not cover this whole month</p>}
    </div>
  );
}

/**
 * Income vs spending for the last few months. Months not fully covered by statements are hatched
 * so a low bar is never mistaken for good news. A data table duplicates the chart for screen readers.
 */
export function TrendChart({ series }: { series: MonthlyPoint[] }) {
  const { hideAmounts } = usePrivacy();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const incomeHatch = `hatch-income-${uid}`;
  const spendingHatch = `hatch-spending-${uid}`;

  const rows: Row[] = series.map((p) => ({
    month: p.month,
    label: formatMonthShort(p.month),
    income: p.income,
    spending: p.spending,
    complete: p.complete,
  }));
  const hasIncomplete = rows.some((r) => !r.complete);
  const last = rows[rows.length - 1];

  return (
    <Card>
      <CardHeader title="Income vs spending" subtitle={`Last ${rows.length} months`} />
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-fg-muted">Not enough data for a trend yet.</p>
      ) : (
        <>
          <p className="mb-2 text-sm text-fg-muted">
            {formatMonth(last.month)}: income <Money value={last.income} whole className="text-fg" />, spending{' '}
            <Money value={last.spending} whole className="text-fg" />
            {last.complete ? '.' : ' (statements do not cover the whole month, so these figures may be low).'}
          </p>
          <div role="img" aria-label="Bar chart of monthly income and spending. The same figures are in the data table below." className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 224 }}>
              <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
                <defs>
                  {[
                    [incomeHatch, INCOME_COLOR],
                    [spendingHatch, SPENDING_COLOR],
                  ].map(([id, color]) => (
                    <pattern key={id} id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" style={{ fill: color, fillOpacity: 0.18 }} />
                      <rect width="2.5" height="6" style={{ fill: color }} />
                    </pattern>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="rgb(var(--chart-grid))" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }} />
                {hideAmounts ? (
                  <YAxis hide />
                ) : (
                  <YAxis
                    width={44}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'rgb(var(--chart-axis))', fontSize: 12 }}
                    tickFormatter={(v: number) => formatINR(v, { compact: true })}
                  />
                )}
                {!hideAmounts && <Tooltip content={<TrendTooltip />} cursor={{ fill: 'rgb(var(--chart-grid))', fillOpacity: 0.4 }} />}
                <Bar dataKey="income" name="Income" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.month} fill={r.complete ? INCOME_COLOR : `url(#${incomeHatch})`} stroke={INCOME_COLOR} strokeWidth={r.complete ? 0 : 1} />
                  ))}
                </Bar>
                <Bar dataKey="spending" name="Spending" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {rows.map((r) => (
                    <Cell key={r.month} fill={r.complete ? SPENDING_COLOR : `url(#${spendingHatch})`} stroke={SPENDING_COLOR} strokeWidth={r.complete ? 0 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Chart legend">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCOME_COLOR }} /> Income
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SPENDING_COLOR }} /> Spending
            </li>
            {hasIncomplete && (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-sm border"
                  style={{ borderColor: SPENDING_COLOR, backgroundImage: `repeating-linear-gradient(45deg, ${SPENDING_COLOR} 0 2px, transparent 2px 4px)` }}
                />
                Hatched = statements do not cover the whole month
              </li>
            )}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="min-h-touch cursor-pointer py-2 font-medium text-primary">View data table</summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-sm">
                <caption className="sr-only">Monthly income and spending</caption>
                <thead className="text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Month</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Income</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Spending</th>
                    <th scope="col" className="py-1.5 font-medium">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <th scope="row" className="py-1.5 pr-3 font-normal text-fg">{formatMonth(r.month)}</th>
                      <td className="py-1.5 pr-3 text-right"><Money value={r.income} whole /></td>
                      <td className="py-1.5 pr-3 text-right"><Money value={r.spending} whole /></td>
                      <td className="py-1.5 text-fg-muted">{r.complete ? 'Complete' : 'Incomplete'}</td>
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
