import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { activityLink } from '@/app/routes';
import { categoryById, categoryName } from '@/domain/categories';
import { applyQuery, merchantPareto } from '@/engine/analytics';
import { formatINR } from '@/lib/money';
import { ChartFrame, Money, SegmentedControl, chartColor, cn } from '@/ui';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData } from './useExploreData';

const LIMIT = 30;

export default function MerchantsView() {
  const { periodTxns, customCategories, period, scope } = useExploreData();
  const [mode, setMode] = useState<'list' | 'pareto'>('list');

  const spending = useMemo(() => applyQuery(periodTxns, { start: period.start, end: period.end, buckets: ['spending'], direction: 'debit' }), [periodTxns, period.start, period.end]);
  const pareto = useMemo(() => merchantPareto(spending, LIMIT), [spending]);
  const { rows, merchantsFor80, total } = pareto;
  const takeaway =
    rows.length > 0
      ? `${merchantsFor80} merchant${merchantsFor80 === 1 ? '' : 's'} make up 80% of the ${formatINR(total, { whole: true })} you spent with merchants.`
      : undefined;
  const rowLink = (m: (typeof rows)[number]) => (m.txnIds.length > 0 && m.txnIds.length <= 25 ? activityLink({ ids: m.txnIds }) : activityLink({ q: m.merchant }));
  const chartData = rows.slice(0, 15).map((r, i) => ({ n: i + 1, name: r.merchant, spent: r.total, cumulative: Math.round(r.cumulativeShare * 100) }));

  return (
    <ChartFrame
      question="Which merchants account for most of your spending?"
      scope={scope}
      takeaway={takeaway}
      empty={rows.length === 0 ? 'No merchant spending recorded in this period.' : undefined}
      actions={
        <SegmentedControl
          label="Merchants view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'list', label: 'Ranked list' },
            { value: 'pareto', label: 'Pareto chart' },
          ]}
        />
      }
      table={
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>#</th>
              <th className={tableHead}>Merchant</th>
              <th className={cn(tableHead, 'text-right')}>Spent</th>
              <th className={cn(tableHead, 'text-right')}>Payments</th>
              <th className={cn(tableHead, 'text-right')}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.merchantKey}>
                <td className={tableCell}>{i + 1}</td>
                <td className={tableCell}>
                  <Link className="text-primary hover:underline" to={rowLink(r)}>
                    {r.merchant}
                  </Link>
                </td>
                <td className={tableNum}>{formatINR(r.total)}</td>
                <td className={tableNum}>{r.count}</td>
                <td className={tableNum}>{Math.round(r.cumulativeShare * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {mode === 'list' ? (
        <ol aria-label="Merchants by spend, with cumulative share" className="divide-y divide-border">
          {rows.map((r, i) => {
            const crossed = i + 1 === merchantsFor80;
            return (
              <li key={r.merchantKey}>
                <Link
                  to={rowLink(r)}
                  aria-label={`${i + 1}. ${r.merchant}: ${formatINR(r.total, { whole: true })} over ${r.count} payments, cumulative ${Math.round(r.cumulativeShare * 100)}%. See transactions`}
                  className="flex min-h-touch items-center gap-3 px-1 py-2 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
                >
                  <span className="w-6 shrink-0 text-right text-sm tabular-nums text-fg-muted">{i + 1}</span>
                  <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: chartColor(categoryById(r.category, customCategories).colorIndex) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{r.merchant}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {categoryName(r.category, customCategories)} · {r.count} payment{r.count === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums">
                      <Money value={r.total} whole />
                    </span>
                    <span className={cn('block text-xs tabular-nums', crossed ? 'font-semibold text-primary' : 'text-fg-muted')}>
                      {Math.round(r.cumulativeShare * 100)}% cumulative{crossed ? ' · 80% reached' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <div role="img" aria-label={`Pareto chart of the top ${chartData.length} merchants: bars are spend, the line is cumulative share`} className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--border))" />
              <XAxis dataKey="n" tickLine={false} label={{ value: 'Merchant rank', position: 'insideBottom', offset: -2 }} height={36} />
              <YAxis yAxisId="amt" tickFormatter={(v: number) => formatINR(v, { compact: true })} width={56} tickLine={false} axisLine={false} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={40} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number, name: string) => (name === 'Cumulative' ? [`${v}%`, name] : [formatINR(v), name])} labelFormatter={(n: number) => chartData[n - 1]?.name ?? ''} />
              <Bar yAxisId="amt" dataKey="spent" name="Spent" fill={chartColor(categoryById('shopping').colorIndex)} radius={[4, 4, 0, 0]} />
              <Line yAxisId="pct" dataKey="cumulative" name="Cumulative" stroke={chartColor(categoryById('salary').colorIndex)} strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
