import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Transaction } from '@/domain/types';
import { ROUTES, activityLink } from '@/app/routes';
import { formatDate } from '@/lib/dates';
import { Card, CardHeader, Money } from '@/ui';

/** The five most recent rows, each opening its detail in Activity. */
export function RecentActivity({ transactions }: { transactions: readonly Transaction[] }) {
  const rows = transactions.slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Recent activity" />
      <ul className="divide-y divide-border">
        {rows.map((t) => (
          <li key={t.id}>
            <Link to={activityLink({ txn: t.id })} className="-mx-2 flex min-h-touch items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{t.merchant || t.rawDescription}</span>
                <span className="block text-xs text-fg-muted">{formatDate(t.date)}</span>
              </span>
              <Money value={t.amount} direction={t.direction} tone="direction" className="shrink-0 text-sm" />
            </Link>
          </li>
        ))}
      </ul>
      <Link to={ROUTES.activity} className="mt-1 inline-flex min-h-touch items-center gap-1 text-sm font-medium text-primary hover:underline">
        See all activity <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}
