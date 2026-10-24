import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { activityLink } from '@/app/routes';
import { spendingCalendar, type HeatDay } from '@/engine/analytics';
import { formatDate, weekday } from '@/lib/dates';
import { ChartFrame, cn } from '@/ui';
import { tableCell, tableHead, tableNum } from './shared';
import { useExploreData, useFmt } from './useExploreData';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Monday = 0. */
const dow = (d: string) => (weekday(d) + 6) % 7;

/** Diagonal hatching marks days that no statement covers: unknown, which is not the same as ₹0. */
const HATCH = 'repeating-linear-gradient(45deg, transparent 0 4px, rgb(var(--border-strong)) 4px 5px)';

interface Cell extends HeatDay {
  level: number;
  ids: string[];
}

export default function PatternsView() {
  const fmt = useFmt();
  const { accounts, statements, periodTxns, period, scope } = useExploreData();

  const { cells, weeks, quartiles } = useMemo(() => {
    const days = spendingCalendar(periodTxns, { accounts, statements, start: period.start, end: period.end });
    const idsByDay = new Map<string, string[]>();
    for (const t of periodTxns) {
      if (t.direction !== 'debit') continue;
      const list = idsByDay.get(t.date);
      if (list) list.push(t.id);
      else idsByDay.set(t.date, [t.id]);
    }
    const amounts = days.filter((d) => d.covered && d.amount > 0).map((d) => d.amount).sort((a, b) => a - b);
    const q = [0.25, 0.5, 0.75].map((p) => amounts[Math.min(amounts.length - 1, Math.floor(p * amounts.length))] ?? 0);
    const withLevel: Cell[] = days.map((d) => ({
      ...d,
      ids: idsByDay.get(d.date) ?? [],
      level: !d.covered || d.amount <= 0 ? 0 : d.amount <= q[0] ? 1 : d.amount <= q[1] ? 2 : d.amount <= q[2] ? 3 : 4,
    }));
    // week rows, Monday first; days outside the period are padding
    const rows: Array<Array<Cell | null>> = [];
    let row: Array<Cell | null> = [];
    for (const c of withLevel) {
      if (row.length === 0) for (let i = 0; i < dow(c.date); i++) row.push(null);
      row.push(c);
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return { cells: withLevel, weeks: rows, quartiles: q };
  }, [periodTxns, accounts, statements, period.start, period.end]);

  const spansYears = period.start.slice(0, 4) !== period.end.slice(0, 4);
  const uncovered = cells.filter((c) => !c.covered).length;
  const spendDays = cells.filter((c) => c.covered && c.amount > 0);
  const busiest = spendDays.reduce<Cell | null>((a, b) => (!a || b.amount > a.amount ? b : a), null);
  const verifiedZero = cells.filter((c) => c.covered && c.amount === 0).length;
  const takeaway = busiest
    ? `Busiest day: ${formatDate(busiest.date)} (${fmt(busiest.amount, { whole: true })}). ${verifiedZero} day${verifiedZero === 1 ? '' : 's'} with verified zero spending${uncovered ? `; ${uncovered} day${uncovered === 1 ? '' : 's'} not covered by any statement` : ''}.`
    : undefined;

  const shade = (level: number) => (level === 0 ? undefined : { background: `rgb(var(--primary) / ${[0, 0.2, 0.4, 0.65, 0.9][level]})` });
  const label = (c: Cell) =>
    !c.covered
      ? `${formatDate(c.date)}: no statement covers this day, spending unknown`
      : c.amount === 0
        ? `${formatDate(c.date)}: verified ₹0 spent`
        : `${formatDate(c.date)}: ${fmt(c.amount, { whole: true })} in ${c.count} payment${c.count === 1 ? '' : 's'}. See transactions`;

  return (
    <ChartFrame
      question="On which days do you spend the most?"
      scope={scope}
      takeaway={takeaway}
      status={uncovered > 0 ? 'incomplete' : 'complete'}
      statusNote={`${uncovered} day${uncovered === 1 ? ' is' : 's are'} not covered by any statement; they are hatched, not shown as ₹0.`}
      empty={cells.length === 0 ? 'No days to show for this period.' : undefined}
      table={
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>Date</th>
              <th className={`${tableHead} text-right`}>Spent</th>
              <th className={`${tableHead} text-right`}>Payments</th>
              <th className={tableHead}>Data</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.date}>
                <td className={tableCell}>{c.ids.length ? <Link className="text-primary hover:underline" to={activityLink({ ids: c.ids })}>{formatDate(c.date)}</Link> : formatDate(c.date)}</td>
                <td className={tableNum}>{c.covered ? fmt(c.amount) : '—'}</td>
                <td className={tableNum}>{c.covered ? c.count : '—'}</td>
                <td className={tableCell}>{c.covered ? (c.amount === 0 ? 'Verified zero' : 'Covered') : 'No statement'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div role="group" aria-label="Spending calendar, one row per week" className="overflow-x-auto">
        <div className="grid min-w-[18rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-1 text-xs">
          <span aria-hidden />
          {DOW.map((d) => (
            <span key={d} className="text-center text-fg-muted">
              {d}
            </span>
          ))}
          {weeks.map((w) => {
            const first = w.find((c): c is Cell => !!c);
            return (
              <div key={first?.date} className="contents">
                <span className="self-center text-fg-muted">{first ? formatDate(first.date, { short: !spansYears }) : ''}</span>
                {w.map((c, i) => {
                  if (!c) return <span key={i} aria-hidden />;
                  const base = 'flex aspect-square min-h-8 items-center justify-center rounded-md text-[11px] tabular-nums';
                  if (!c.covered) {
                    return (
                      <span key={c.date} role="img" aria-label={label(c)} data-day={c.date} data-state="uncovered" className={cn(base, 'border border-dashed border-border-strong text-fg-muted')} style={{ background: HATCH }}>
                        {c.date.slice(8)}
                      </span>
                    );
                  }
                  if (c.amount === 0 || c.ids.length === 0) {
                    return (
                      <span key={c.date} role="img" aria-label={label(c)} data-day={c.date} data-state="zero" className={cn(base, 'border border-border bg-surface text-fg-muted')}>
                        {c.date.slice(8)}
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={c.date}
                      to={activityLink({ ids: c.ids })}
                      aria-label={label(c)}
                      data-day={c.date}
                      data-state="spend"
                      className={cn(base, 'text-fg ring-primary hover:ring-2 focus-visible:outline focus-visible:outline-2', c.level >= 3 && 'text-primary-fg')}
                      style={shade(c.level)}
                    >
                      {c.date.slice(8)}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded border border-border bg-surface" aria-hidden /> Verified ₹0
        </li>
        {[1, 2, 3, 4].map((l) => (
          <li key={l} className="flex items-center gap-1.5">
            <span className="h-4 w-4 rounded" style={shade(l)} aria-hidden />
            {l === 1 ? `up to ${fmt(quartiles[0], { whole: true })}` : l === 4 ? `over ${fmt(quartiles[2], { whole: true })}` : l === 2 ? `to ${fmt(quartiles[1], { whole: true })}` : `to ${fmt(quartiles[2], { whole: true })}`}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded border border-dashed border-border-strong" style={{ background: HATCH }} aria-hidden /> No statement (unknown)
        </li>
      </ul>
    </ChartFrame>
  );
}
