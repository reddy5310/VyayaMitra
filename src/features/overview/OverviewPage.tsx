import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, GraduationCap, Upload } from 'lucide-react';
import { useBudgets, useLedger, useRecurringDecisions, useSavingActions } from '@/db/hooks';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { ROUTES, activityLink } from '@/app/routes';
import {
  applyQuery,
  categoryBaselines,
  generateInsights,
  monthlySeries,
  summarize,
  upcomingCardDues,
  type Insight,
} from '@/engine/analytics';
import { addMonths, minIso, monthKey, monthsBetween, todayIso } from '@/lib/dates';
import { Card, CardHeader, Money, Notice, Skeleton } from '@/ui';
import { CardDuesList } from './CardDues';
import { CategoryBreakdown } from './CategoryBreakdown';
import { FirstRun } from './FirstRun';
import { InsightsSection } from './InsightsSection';
import { KpiTiles } from './KpiTiles';
import { LinkButton } from './LinkButton';
import { PeopleCard } from './PeopleCard';
import { TrendChart } from './TrendChart';

const TREND_MONTHS = 6;

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your overview" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-56" />
    </div>
  );
}

export default function OverviewPage() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const budgets = useBudgets();
  const decisions = useRecurringDecisions();
  const actions = useSavingActions();
  const { period } = usePeriod();
  const today = useMemo(() => todayIso(), []);

  const hasData = ready && transactions.length > 0;
  usePageChrome({ title: 'Overview', showPeriod: hasData });

  const periodTxns = useMemo(
    () => (hasData ? applyQuery(transactions, { start: period.start, end: period.end }) : []),
    [hasData, transactions, period.start, period.end],
  );

  const summary = useMemo(
    () => (hasData ? summarize(periodTxns, { accounts, statements, customCategories, start: period.start, end: period.end, today }) : null),
    [hasData, periodTxns, accounts, statements, customCategories, period.start, period.end, today],
  );

  const series = useMemo(() => {
    if (!hasData) return [];
    const endMonth = monthKey(minIso(period.end, today));
    const months = monthsBetween(addMonths(endMonth, -(TREND_MONTHS - 1)), endMonth);
    const points = monthlySeries(transactions, { accounts, statements, months });
    // Drop leading months that predate the user's data so the chart does not open on empty bars.
    const firstWithData = points.findIndex((p) => p.complete || p.income > 0 || p.spending > 0);
    return firstWithData <= 0 ? points : points.slice(firstWithData);
  }, [hasData, transactions, accounts, statements, period.end, today]);

  const insightsReady = hasData && budgets !== undefined && decisions !== undefined && actions !== undefined;
  const insights: Insight[] = useMemo(
    () =>
      insightsReady
        ? generateInsights({
            txns: transactions,
            accounts,
            statements,
            budgets: budgets ?? [],
            recurringDecisions: decisions ?? [],
            actions: actions ?? [],
            start: period.start,
            end: period.end,
            today,
          })
        : [],
    [insightsReady, transactions, accounts, statements, budgets, decisions, actions, period.start, period.end, today],
  );

  const baselines = useMemo(
    () => (hasData ? categoryBaselines(transactions, { accounts, statements, today, months: 3 }) : []),
    [hasData, transactions, accounts, statements, today],
  );

  const cardDues = useMemo(
    () => (hasData ? upcomingCardDues(accounts, statements, transactions, today) : []),
    [hasData, accounts, statements, transactions, today],
  );

  // How many distinct merchants sit behind the transactions that need review: teaching one fixes its rows.
  const teach = useMemo(() => {
    const pending = periodTxns.filter((t) => t.needsReview);
    return { rows: pending.length, merchants: new Set(pending.map((t) => t.merchantKey || t.merchant)).size };
  }, [periodTxns]);

  const firstRun = ready && transactions.length === 0;
  const periodEmpty = ready && !firstRun && periodTxns.length === 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      {!ready ? (
        <OverviewSkeleton />
      ) : firstRun ? (
        <FirstRun />
      ) : (
        summary && (
          <>
            {!summary.coverage.complete && (
              <Notice
                tone="warning"
                title="Some of this period is not covered by your statements"
                action={
                  <LinkButton to={ROUTES.import} variant="outline" icon={<Upload className="h-4 w-4" aria-hidden />}>
                    Import
                  </LinkButton>
                }
              >
                <ul className="list-disc pl-4">
                  {summary.coverage.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <p className="mt-1">Totals below only include what has been imported, so they may look better or worse than reality.</p>
              </Notice>
            )}

            {periodEmpty ? (
              <Card>
                <h2 className="text-base font-semibold text-fg">No transactions in this period</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Pick another period, or import a statement that covers these dates.
                </p>
                <div className="mt-3">
                  <LinkButton to={ROUTES.import} variant="primary" icon={<Upload className="h-4 w-4" aria-hidden />}>
                    Import a statement
                  </LinkButton>
                </div>
              </Card>
            ) : (
              <KpiTiles summary={summary} />
            )}

            <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
              <div className="space-y-4 lg:col-start-3 lg:row-start-1">
                {cardDues.length > 0 && (
                  <Card>
                    <CardHeader title="Card bills" subtitle="Latest statement for each credit card" />
                    <CardDuesList dues={cardDues} accounts={accounts} />
                  </Card>
                )}
                <InsightsSection insights={insights} actions={actions ?? []} baselines={baselines} customCategories={customCategories} today={today} />
                {summary.counts.needsReview > 0 && (
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-fg">Needs review</h2>
                        <p className="text-sm text-fg-muted">
                          {summary.counts.needsReview} {summary.counts.needsReview === 1 ? 'transaction' : 'transactions'} we are not sure about. Fixing them makes every total more accurate.
                        </p>
                      </div>
                      <LinkButton to={activityLink({ review: true })} variant="primary" icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}>
                        Review<span className="sr-only"> transactions</span>
                      </LinkButton>
                    </div>
                    {teach.rows > 0 && (
                      <Link
                        to={ROUTES.learning}
                        className="mt-3 flex min-h-touch items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary hover:opacity-90"
                      >
                        <GraduationCap className="h-4 w-4 shrink-0" aria-hidden />
                        <span>
                          Teach VyayaMitra {teach.merchants} {teach.merchants === 1 ? 'merchant' : 'merchants'} to fix {teach.rows}{' '}
                          {teach.rows === 1 ? 'transaction' : 'transactions'}
                        </span>
                      </Link>
                    )}
                  </Card>
                )}
              </div>

              <div className="space-y-4 lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
                {!periodEmpty && <CategoryBreakdown summary={summary} customCategories={customCategories} />}
                <TrendChart series={series} />
              </div>

              <div className="lg:col-start-3 lg:row-start-2">
                <PeopleCard summary={summary} showReview={(summary as { consumption?: number }).consumption === undefined} />
              </div>
            </div>

            {!periodEmpty && (
              <p className="text-xs text-fg-subtle">
                Not included in any total: <Money value={summary.neutral.selfTransfers} whole /> moved between your own accounts and{' '}
                <Money value={summary.neutral.cardPayments} whole /> of credit-card bill payments. Counting them would double up money you
                already spent or still own.
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
