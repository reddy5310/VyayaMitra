import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { FeesSummary, MoneyBack } from '@/engine/analytics';
import { ROUTES } from '@/app/routes';
import { Card, CardHeader, Money } from '@/ui';

const more = 'mt-2 inline-flex min-h-touch items-center gap-1 text-sm font-medium text-primary hover:underline';

/** Compact "Money back" summary: open cases, expected outstanding and credits that still need matching. */
export function MoneyBackSummary({ data }: { data: MoneyBack }) {
  const { openCases, expectedOutstanding } = data.totals;
  const matching = data.needsMatching.length;
  if (openCases === 0 && matching === 0 && data.totals.receivedInPeriod === 0) return null;
  return (
    <Card>
      <CardHeader title="Money back" subtitle="Refunds you are waiting for or have received" />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted">Open cases</dt>
          <dd className="font-semibold text-fg tabular">{openCases}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Expected</dt>
          <dd className="font-semibold text-fg">
            <Money value={expectedOutstanding} whole />
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Needs matching</dt>
          <dd className="font-semibold text-fg tabular">{matching}</dd>
        </div>
      </dl>
      <Link to={ROUTES.moneyBack} className={more}>
        Open Money back <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}

/** Compact "Fees & charges" summary for the period: what they cost net of reversals, and what has not been reversed. */
export function FeesSummaryCard({ data }: { data: FeesSummary }) {
  if (data.events.length === 0) return null;
  const unreversed = data.events.filter((e) => e.status === 'not_reversed').length;
  return (
    <Card>
      <CardHeader title="Fees & charges" subtitle="What they cost this period, after any reversals" />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted">Net fees</dt>
          <dd className="font-semibold text-fg">
            <Money value={data.totals.net} whole />
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Not reversed</dt>
          <dd className="font-semibold text-fg tabular">{unreversed}</dd>
        </div>
      </dl>
      <Link to={ROUTES.fees} className={more}>
        Open Fees &amp; charges <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}
