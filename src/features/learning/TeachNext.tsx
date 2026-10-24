import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import type { Transaction } from '@/domain/types';
import type { ReviewItem } from '@/engine/understand';
import { activityLink } from '@/app/routes';
import { formatDate } from '@/lib/dates';
import { Card, CardHeader, Money } from '@/ui';
import { LinkButton } from './LinkButton';

const MAX_ITEMS = 5;

/** The needs-review transactions where one answer teaches the most. */
export function TeachNext({ items, txnById, totalNeedsReview }: { items: ReviewItem[]; txnById: Map<string, Transaction>; totalNeedsReview: number }) {
  const rows = items.filter((i) => txnById.has(i.txnId)).slice(0, MAX_ITEMS);
  return (
    <Card>
      <CardHeader
        title="Teach next"
        subtitle="Answer these first. Each answer is remembered, so the same merchant is fixed everywhere."
      />
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing needs your attention. Everything has been understood or confirmed.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {rows.map((item) => {
              const t = txnById.get(item.txnId)!;
              const more = item.sameMerchantCount;
              return (
                <li key={item.txnId}>
                  <Link
                    to={activityLink({ txn: item.txnId })}
                    className="-mx-2 flex min-h-touch items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{t.merchant || t.rawDescription}</span>
                      <span className="block text-xs text-fg-muted">
                        {formatDate(t.date)} · {item.reason}
                      </span>
                      <span className="mt-0.5 block text-xs font-medium text-primary">
                        {more > 0 ? `Fixing this fixes ${more} more` : 'Only this one'}
                      </span>
                    </span>
                    <Money value={t.amount} direction={t.direction} tone="direction" className="shrink-0 text-sm" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <LinkButton to={activityLink({ review: true })} variant="outline" icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}>
              Review all {totalNeedsReview}
            </LinkButton>
          </div>
        </>
      )}
    </Card>
  );
}
