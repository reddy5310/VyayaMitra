import { useMemo } from 'react';
import { Check, CircleDashed, Minus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { accountLink } from '@/app/routes';
import type { Account, Statement } from '@/domain/types';
import { coverageGrid, type CoverageCell } from '@/engine/analytics';
import { formatMonthShort } from '@/lib/dates';
import { cn } from '@/ui';

const STATE_INFO: Record<CoverageCell['state'], { label: string; icon: typeof Check; cls: string }> = {
  full: { label: 'Full month imported', icon: Check, cls: 'bg-positive-soft text-positive' },
  partial: { label: 'Part of the month imported', icon: CircleDashed, cls: 'bg-warning-soft text-warning' },
  missing: { label: 'No statement for this month', icon: X, cls: 'bg-negative-soft text-negative' },
  before_tracking: { label: 'Before you started tracking', icon: Minus, cls: 'bg-surface-2 text-fg-subtle' },
};

/** Accounts × months. State is shown with an icon and a word (never colour alone); tapping a cell opens that account's statements. */
export function CoverageGrid({ accounts, statements, months }: { accounts: readonly Account[]; statements: readonly Statement[]; months: string[] }) {
  const navigate = useNavigate();
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
                  return (
                    <td key={m} className="p-0.5 text-center">
                      <button
                        type="button"
                        onClick={() => navigate(accountLink(a.id))}
                        aria-label={`${a.name}, ${formatMonthShort(m)}: ${info.label}. Open statements`}
                        className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg', info.cls)}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                      </button>
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
    </div>
  );
}
