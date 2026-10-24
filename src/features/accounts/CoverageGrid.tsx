import { useMemo, useState } from 'react';
import { Check, CircleDashed, Minus, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES, accountLink } from '@/app/routes';
import type { Account, Statement } from '@/domain/types';
import { coverageGrid, type CoverageCell } from '@/engine/analytics';
import { formatDate, formatMonth, formatMonthShort } from '@/lib/dates';
import { Sheet, cn } from '@/ui';
import { missingDayRanges } from './accountInfo';

const STATE_INFO: Record<CoverageCell['state'], { label: string; icon: typeof Check; cls: string }> = {
  full: { label: 'Full month imported', icon: Check, cls: 'bg-positive-soft text-positive' },
  partial: { label: 'Part of the month imported', icon: CircleDashed, cls: 'bg-warning-soft text-warning' },
  missing: { label: 'No statement for this month', icon: X, cls: 'bg-negative-soft text-negative' },
  before_tracking: { label: 'Before you started tracking', icon: Minus, cls: 'bg-surface-2 text-fg-subtle' },
};

/** Accounts × months. State is shown with an icon and a word (never colour alone); tapping a cell opens that account's statements. */
export function CoverageGrid({ accounts, statements, months }: { accounts: readonly Account[]; statements: readonly Statement[]; months: string[] }) {
  const navigate = useNavigate();
  const [partial, setPartial] = useState<{ account: Account; month: string } | null>(null);
  const cells = useMemo(() => coverageGrid(accounts, statements, months), [accounts, statements, months]);
  const byKey = useMemo(() => new Map(cells.map((c) => [`${c.accountId}|${c.month}`, c])), [cells]);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Statement coverage by account and month</caption>
          <thead className="bg-surface-2 text-fg-muted">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface-2 px-3 py-2 text-left font-medium">
                Account
              </th>
              {months.map((m) => (
                <th key={m} scope="col" className="px-1 py-2 text-center font-medium">
                  {formatMonthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id}>
                <th scope="row" className="sticky left-0 max-w-[9rem] truncate bg-surface px-3 py-1.5 text-left font-medium text-fg">
                  {a.name}
                </th>
                {months.map((m) => {
                  const cell = byKey.get(`${a.id}|${m}`);
                  const info = STATE_INFO[cell?.state ?? 'missing'];
                  const Icon = info.icon;
                  const state = cell?.state ?? 'missing';
                  const cls = cn('inline-flex h-9 w-9 items-center justify-center rounded-lg', info.cls);
                  const label = `${a.name}, ${formatMonthShort(m)}: ${info.label}`;
                  return (
                    <td key={m} className="p-0.5 text-center">
                      {state === 'missing' ? (
                        <Link
                          to={`${ROUTES.import}?account=${encodeURIComponent(a.id)}&month=${m}`}
                          aria-label={`${label}. Import your ${a.name} statement for ${formatMonth(m)}`}
                          className={cls}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => (state === 'partial' ? setPartial({ account: a, month: m }) : navigate(accountLink(a.id)))}
                          aria-label={state === 'partial' ? `${label}. See which days are missing` : `${label}. Open statements`}
                          className={cls}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
        {(Object.keys(STATE_INFO) as CoverageCell['state'][]).map((s) => {
          const Icon = STATE_INFO[s].icon;
          return (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded', STATE_INFO[s].cls)}>
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              {STATE_INFO[s].label}
            </li>
          );
        })}
      </ul>
      <PartialMonthSheet partial={partial} statements={statements} onClose={() => setPartial(null)} />
    </div>
  );
}

function PartialMonthSheet({ partial, statements, onClose }: { partial: { account: Account; month: string } | null; statements: readonly Statement[]; onClose: () => void }) {
  const ranges = partial ? missingDayRanges(partial.account.id, partial.month, statements) : [];
  const covering = partial
    ? statements.filter(
        (s) => s.accountId === partial.account.id && s.periodStart && s.periodEnd && s.periodStart <= `${partial.month}-31` && s.periodEnd >= `${partial.month}-01`,
      )
    : [];
  return (
    <Sheet
      open={partial !== null}
      onClose={onClose}
      title={partial ? `${partial.account.name}: ${formatMonth(partial.month)}` : 'Partly covered'}
      description="Only part of this month is covered by the statements you imported."
    >
      {partial && (
        <div className="space-y-4 text-sm">
          <section aria-label="Days with no statement">
            <h3 className="mb-1 font-semibold text-fg">Days with no statement</h3>
            {ranges.length === 0 ? (
              <p className="text-fg-muted">Every day of the month falls inside an imported statement period.</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {ranges.map((r) => (
                  <li key={r.start}>
                    {r.start === r.end ? formatDate(r.start) : `${formatDate(r.start, { short: true })} to ${formatDate(r.end)}`} ({r.days} day{r.days === 1 ? '' : 's'})
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Statements covering this month">
            <h3 className="mb-1 font-semibold text-fg">Covered by</h3>
            <ul className="list-disc space-y-0.5 pl-5">
              {covering.map((s) => (
                <li key={s.id}>
                  {s.fileName} ({formatDate(s.periodStart!, { short: true })} to {formatDate(s.periodEnd!)})
                </li>
              ))}
            </ul>
          </section>
          <Link
            to={`${ROUTES.import}?account=${encodeURIComponent(partial.account.id)}&month=${partial.month}`}
            className="inline-flex min-h-touch items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90"
          >
            Import the missing statement
          </Link>
        </div>
      )}
    </Sheet>
  );
}
