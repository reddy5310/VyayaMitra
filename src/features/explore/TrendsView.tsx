import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePeriod } from '@/app/period';
import { ROUTES } from '@/app/routes';
import { categoryById } from '@/domain/categories';
import { monthlySeries } from '@/engine/analytics';
import { addMonths, formatMonth, minIso, monthEnd, monthKey, monthStart, monthsBetween } from '@/lib/dates';
import { Button, ChartFrame, chartColor } from '@/ui';
import { monthAxisLabel } from './views';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData, useFmt, useHideAmounts } from './useExploreData';

const MIN_MONTHS = 6;
const MAX_MONTHS = 12;

const SERIES = [
  { key: 'income', label: 'Income', color: chartColor(categoryById('salary').colorIndex) },
  { key: 'spending', label: 'Spending', color: chartColor(categoryById('shopping').colorIndex) },
  { key: 'invested', label: 'Invested', color: chartColor(categoryById('investments').colorIndex) },
] as const;

export default function TrendsView() {
  const fmt = useFmt();
  const hidden = useHideAmounts();
  const { accounts, statements, transactions, period, today, scope } = useExploreData();
  const { setCustom } = usePeriod();

  const points = useMemo(() => {
    const endMonth = monthKey(minIso(period.end, today));
    let startMonth = monthKey(period.start);
    if (monthsBetween(startMonth, endMonth).length < MIN_MONTHS) startMonth = addMonths(endMonth, -(MIN_MONTHS - 1));
    if (monthsBetween(startMonth, endMonth).length > MAX_MONTHS) startMonth = addMonths(endMonth, -(MAX_MONTHS - 1));
    const all = monthlySeries(transactions, { accounts, statements, months: monthsBetween(startMonth, endMonth) });
    // drop months that predate the user's data
    const first = all.findIndex((p) => p.complete || p.income > 0 || p.spending > 0 || p.invested > 0);
    return first <= 0 ? all : all.slice(first);
  }, [transactions, accounts, statements, period.start, period.end, today]);

  const complete = points.filter((p) => p.complete);
  const excluded = points.filter((p) => !p.complete);
  const spansYears = new Set(points.map((p) => p.month.slice(0, 4))).size > 1;
  const monthLabel = (m: string) => monthAxisLabel(m, spansYears, formatMonth);
  const data = complete.map((p) => ({ label: monthLabel(p.month), income: p.income, spending: p.spending, invested: p.invested }));
  const latest = complete[complete.length - 1];
  const takeaway = latest
    ? `${formatMonth(latest.month)}: income ${fmt(latest.income, { whole: true })}, spending ${fmt(latest.spending, { whole: true })}, invested ${fmt(latest.invested, { whole: true })}.`
    : undefined;

  return (
    <ChartFrame
      question="How do income, spending and investing compare month by month?"
      scope={`${scope} · up to ${MAX_MONTHS} months ending ${formatMonth(monthKey(minIso(period.end, today)))}`}
      takeaway={takeaway}
      status={excluded.length > 0 ? 'incomplete' : 'complete'}
      statusNote={
        excluded.length > 0
          ? `Left out because statements do not cover the whole month: ${excluded.map((p) => monthLabel(p.month)).join(', ')}. Showing only complete months so bars are never understated.`
          : undefined
      }
      empty={complete.length === 0 ? 'No month is fully covered by your statements yet, so there is nothing fair to compare.' : undefined}
      table={
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>Month</th>
              {SERIES.map((s) => (
                <th key={s.key} className={`${tableHead} text-right`}>
                  {s.label}
                </th>
              ))}
              <th className={tableHead}>Status</th>
              <th className={tableHead}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month}>
                <td className={tableCell}>{formatMonth(p.month)}</td>
                {SERIES.map((s) => (
                  <td key={s.key} className={tableNum}>
                    {p.complete ? fmt(p[s.key]) : '—'}
                  </td>
                ))}
                <td className={tableCell}>{p.complete ? 'Complete' : 'Incomplete (not charted)'}</td>
                <td className={tableCell}>
                  <Button size="sm" variant="ghost" onClick={() => setCustom(monthStart(p.month), monthEnd(p.month))}>
                    Focus month
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div role="img" aria-label={`Grouped bars of income, spending and invested for ${complete.length} complete months`} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--border))" />
            <XAxis dataKey="label" tickLine={false} />
            <YAxis tickFormatter={(v: number) => (hidden ? '••••' : fmt(v, { compact: true }))} width={56} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} />
            <Legend />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-sm">
        <Link className="font-medium text-primary" to={ROUTES.activity}>
          Open all transactions
        </Link>
        <span className="text-fg-muted"> · use “Focus month” in the table to change the period to one month.</span>
      </p>
    </ChartFrame>
  );
}
