import { Users } from 'lucide-react';
import type { LedgerSummary } from '@/engine/analytics';
import { activityLink } from '@/app/routes';
import { Card, CardHeader, Money } from '@/ui';
import { LinkButton } from './LinkButton';

/** Money sent to and received from people. Received money is shown here, never counted as income. */
export function PeopleCard({ summary, showReview = true }: { summary: LedgerSummary; showReview?: boolean }) {
  if (summary.peopleOut <= 0 && summary.peopleIn <= 0) return null;
  return (
    <Card>
      <CardHeader title="People" subtitle="Friends, family and anyone who is not a shop" />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted">Sent</dt>
          <dd className="mt-0.5 text-lg font-semibold text-fg">
            <Money value={summary.peopleOut} whole />
          </dd>
          <dd className="text-xs text-fg-subtle">Counted in spending</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Received</dt>
          <dd className="mt-0.5 text-lg font-semibold text-fg">
            <Money value={summary.peopleIn} whole />
          </dd>
          <dd className="text-xs text-fg-subtle">Not counted as income</dd>
        </div>
      </dl>
      {showReview && summary.peopleOut > 0 && (
        <div className="mt-3">
          <LinkButton to={activityLink({ kind: 'p2p_out' })} icon={<Users className="h-4 w-4" aria-hidden />}>
            Review<span className="sr-only"> money sent to people</span>
          </LinkButton>
        </div>
      )}
    </Card>
  );
}
