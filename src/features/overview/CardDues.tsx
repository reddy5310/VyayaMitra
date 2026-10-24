import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import type { Account } from '@/domain/types';
import type { CardDue } from '@/engine/analytics';
import { activityLink } from '@/app/routes';
import { formatDate } from '@/lib/dates';
import { Badge, Money, cn, type Tone } from '@/ui';

const RANK: Record<CardDue['status'], number> = { overdue: 0, due: 1, partly_paid: 2, paid: 3 };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Status label and tone for one card bill, in plain words with the days left. */
function dueStatus(d: CardDue): { label: string; tone: Tone } {
  switch (d.status) {
    case 'paid':
      return { label: 'Paid', tone: 'positive' };
    case 'overdue':
      return { label: `${plural(Math.abs(d.daysLeft), 'day', 'days')} overdue`, tone: 'negative' };
    case 'partly_paid':
      return { label: 'Partly paid', tone: 'warning' };
    case 'due':
      return d.daysLeft <= 0
        ? { label: 'Due today', tone: 'warning' }
        : { label: `Due in ${plural(d.daysLeft, 'day', 'days')}`, tone: d.daysLeft <= 3 ? 'warning' : 'info' };
  }
}

function sortDues(dues: readonly CardDue[]): CardDue[] {
  return [...dues].sort((a, b) => RANK[a.status] - RANK[b.status] || (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/** Compact list of credit-card bills with status. Presentational; callers fetch the dues. */
export function CardDuesList({ dues, accounts, className }: { dues: readonly CardDue[]; accounts: readonly Account[]; className?: string }) {
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Credit card';
  return (
    <ul className={cn('divide-y divide-border', className)}>
      {sortDues(dues).map((d) => {
        const st = dueStatus(d);
        const left = Math.max(0, d.totalDue - d.paidSoFar);
        return (
          <li key={d.statementId} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-fg-subtle" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{nameOf(d.accountId)}</p>
                <p className="text-xs text-fg-muted">Due {formatDate(d.dueDate)}</p>
                {d.status === 'partly_paid' && (
                  <p className="text-xs text-fg-muted">
                    <Money value={d.paidSoFar} whole /> paid, <Money value={left} whole /> still to pay
                  </p>
                )}
                {d.minimumDue !== undefined && d.status !== 'paid' && (
                  <p className="text-xs text-fg-subtle">
                    Minimum due <Money value={d.minimumDue} whole />
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-fg">
                  <Money value={d.totalDue} whole />
                </p>
                <Badge tone={st.tone} className="mt-0.5">
                  {st.label}
                </Badge>
              </div>
            </div>
            <Link
              to={activityLink({ account: d.accountId })}
              className="ml-8 inline-flex min-h-touch items-center text-xs font-medium text-primary hover:underline"
              aria-label={`See ${nameOf(d.accountId)} transactions`}
            >
              See transactions
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
