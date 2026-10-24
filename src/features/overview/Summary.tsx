import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { DataStatus, LedgerSummary } from '@/engine/analytics';
import { ROUTES, activityLink, exploreLink } from '@/app/routes';
import { formatDate } from '@/lib/dates';
import { Badge, Card, Money, cn } from '@/ui';

const linkClass = 'font-medium text-primary underline-offset-2 hover:underline';

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line of data health. Each part links to where it can be acted on. */
export function StatusStrip({ status }: { status: DataStatus }) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 rounded-xl bg-surface-2 px-3 text-sm text-fg-muted"
      aria-label="Data status"
    >
      <Link to={ROUTES.accounts} className={cn(linkClass, 'inline-flex min-h-touch items-center')}>
        {status.dataThrough ? `Statements through ${formatDate(status.dataThrough, { short: true })}` : 'No statements yet'} ·{' '}
        {plural(status.accountCount, 'account', 'accounts')}
      </Link>
      {status.needsReview > 0 && (
        <Link to={activityLink({ review: true })} className={cn(linkClass, 'inline-flex min-h-touch items-center gap-1.5')}>
          <span aria-hidden>·</span>
          {plural(status.needsReview, 'item needs', 'items need')} review
        </Link>
      )}
    </p>
  );
}

interface Props {
  summary: LedgerSummary;
  status: DataStatus;
  plan: { monthlyLimit: number; categories: string[] } | null;
  /** The period is exactly one calendar month, so it can be compared with a monthly plan. */
  singleMonth: boolean;
}

/** The first thing on the page: what was recorded, and how that sits against the plan. Never a "safe to spend" claim. */
export function MainSummary({ summary, status, plan, singleMonth }: Props) {
  const cardsOnly = status.evidence === 'cards_only';
  const through = status.dataThrough ? formatDate(status.dataThrough) : null;
  const planSpent = plan ? summary.byCategory.filter((c) => plan.categories.includes(c.category)).reduce((s, c) => s + c.amount, 0) : 0;
  const remaining = plan ? plan.monthlyLimit - planSpent : 0;
  const showRate = !cardsOnly && summary.savingsRate !== null;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-fg-muted">{cardsOnly ? 'Card purchases recorded' : 'Spending recorded'}</h2>
        {!summary.coverage.complete && <Badge tone="warning">Provisional{through ? `: statements through ${through}` : ''}</Badge>}
      </div>
      <p className="mt-1 text-3xl font-semibold text-fg">
        <Money value={summary.spending} whole />
      </p>
      <p className="mt-0.5 text-xs text-fg-subtle">
        {summary.refunds > 0 && (
          <>
            After <Money value={summary.refunds} whole /> of refunds.{' '}
          </>
        )}
        {(summary.neutral.selfTransfers > 0 || summary.neutral.cardPayments > 0) && (
          <>
            Excludes{' '}
            {summary.neutral.selfTransfers > 0 && (
              <>
                <Money value={summary.neutral.selfTransfers} whole /> moved between your accounts
              </>
            )}
            {summary.neutral.selfTransfers > 0 && summary.neutral.cardPayments > 0 && ' and '}
            {summary.neutral.cardPayments > 0 && (
              <>
                <Money value={summary.neutral.cardPayments} whole /> of card bill payments
              </>
            )}
            , so nothing is counted twice.
          </>
        )}
        {summary.peopleOut > 0 && (
          <>
            {' '}
            Includes <Money value={summary.peopleOut} whole /> sent to people (
            <Link to={activityLink({ kind: 'p2p_out' })} className={linkClass}>
              review<span className="sr-only"> money sent to people</span>
            </Link>
            ).
          </>
        )}
      </p>

      <div className="mt-3 border-t border-border pt-3">
        {plan && singleMonth ? (
          <>
            <p className="text-sm text-fg-muted">Remaining in your spending plan</p>
            <p className={cn('text-xl font-semibold', remaining < 0 ? 'text-negative' : 'text-fg')}>
              {remaining < 0 ? (
                <>
                  <Money value={-remaining} whole /> over
                </>
              ) : (
                <Money value={remaining} whole />
              )}
            </p>
            <p className="text-xs text-fg-subtle">
              <Money value={planSpent} whole /> of <Money value={plan.monthlyLimit} whole /> across {plural(plan.categories.length, 'budgeted category', 'budgeted categories')}
              {through ? ` · data through ${through}` : ''}. Spending in other categories is not counted here.
            </p>
          </>
        ) : plan ? (
          <p className="text-sm text-fg-muted">Choose a single month to compare your spending with your plan.</p>
        ) : (
          <p className="text-sm text-fg-muted">
            No spending plan yet.{' '}
            <Link to={`${ROUTES.plan}?tab=budgets`} className={linkClass}>
              Set budgets
            </Link>{' '}
            to see what is left each month.
          </p>
        )}
      </div>

      {!cardsOnly && (
        <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
          <div>
            <dt className="text-fg-muted">Income</dt>
            <dd className="font-semibold text-fg">{summary.savingsRate === null ? '—' : <Money value={summary.income} whole />}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Saved & invested</dt>
            <dd className="font-semibold text-fg">
              <Money value={summary.invested} whole />
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">Savings rate</dt>
            <dd className={cn('font-semibold', showRate && (summary.savingsRate ?? 0) < 0 ? 'text-negative' : 'text-fg')}>
              {showRate ? `${(summary.savingsRate ?? 0).toFixed(1)}%` : '—'}
            </dd>
          </div>
        </dl>
      )}
      {!cardsOnly && summary.savingsRate === null && (
        <p className="mt-2 text-xs text-fg-muted">{summary.savingsRateNote ?? 'There is no income in this period to compare against.'}</p>
      )}

      <Link to={exploreLink('categories')} className={cn(linkClass, 'mt-2 inline-flex min-h-touch items-center gap-1 text-sm')}>
        See where it went <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}
