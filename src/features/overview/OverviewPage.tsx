import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, GraduationCap } from 'lucide-react';
import { useBudgets, useLedger, useRecurringDecisions, useSavingActions } from '@/db/hooks';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { ROUTES, activityLink, exploreLink } from '@/app/routes';
import {
  applyQuery,
  categoryBaselines,
  cumulativeSpending,
  dataStatus,
  detectRecurring,
  generateInsights,
  spendingPlan,
  summarize,
  upcomingCardDues,
  type Insight,
} from '@/engine/analytics';
import { monthKey, todayIso } from '@/lib/dates';
import { Card, CardHeader, Notice, Skeleton, useToast } from '@/ui';
import { buildCommitments } from './commitments';
import { CommitmentTimeline } from './CommitmentTimeline';
import { FirstRun } from './FirstRun';
import { InsightsSection } from './InsightsSection';
import { LinkButton } from './LinkButton';
import { RecentActivity } from './RecentActivity';
import { sampleDataAvailable, startSample } from './sample';
import { SpendingPlanChart } from './SpendingPlanChart';
import { MainSummary, StatusStrip } from './Summary';

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your overview" className="space-y-4">
      <Skeleton className="h-10" />
      <Skeleton className="h-52" />
      <Skeleton className="h-64" />
    </div>
  );
}

export default function OverviewPage() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const budgets = useBudgets();
  const decisions = useRecurringDecisions();
  const actions = useSavingActions();
  const { period } = usePeriod();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const [sampleBusy, setSampleBusy] = useState(false);

  const hasData = ready && transactions.length > 0;
  usePageChrome({ title: 'Overview', showPeriod: hasData });

  const status = useMemo(() => (hasData ? dataStatus(accounts, statements, transactions, today) : null), [hasData, accounts, statements, transactions, today]);

  const periodTxns = useMemo(
    () => (hasData ? applyQuery(transactions, { start: period.start, end: period.end }) : []),
    [hasData, transactions, period.start, period.end],
  );
  const summary = useMemo(
    () => (hasData ? summarize(periodTxns, { accounts, statements, customCategories, start: period.start, end: period.end, today }) : null),
    [hasData, periodTxns, accounts, statements, customCategories, period.start, period.end, today],
  );

  const plan = useMemo(() => (budgets ? spendingPlan(budgets) : null), [budgets]);
  const singleMonth = monthKey(period.start) === monthKey(period.end);
  const planMonthly = plan && singleMonth ? plan.monthlyLimit : undefined;

  const series = useMemo(
    () =>
      hasData
        ? cumulativeSpending(transactions, { accounts, statements, start: period.start, end: period.end, today, planMonthly })
        : null,
    [hasData, transactions, accounts, statements, period.start, period.end, today, planMonthly],
  );

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

  const commitments = useMemo(() => {
    if (!hasData || decisions === undefined) return [];
    const dues = upcomingCardDues(accounts, statements, transactions, today);
    return buildCommitments(dues, detectRecurring(transactions, decisions, today), accounts, today, 60);
  }, [hasData, decisions, accounts, statements, transactions, today]);

  // Merchants behind the review queue: teaching one fixes all its rows.
  const teach = useMemo(() => {
    const pending = periodTxns.filter((t) => t.needsReview);
    return { rows: pending.length, merchants: new Set(pending.map((t) => t.merchantKey || t.merchant)).size };
  }, [periodTxns]);

  async function onSample() {
    setSampleBusy(true);
    try {
      await startSample();
      toast('Sample data loaded. Everything here is invented.', { tone: 'success' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the sample data.', { tone: 'error' });
    } finally {
      setSampleBusy(false);
    }
  }

  const firstRun = ready && transactions.length === 0;
  const periodEmpty = hasData && periodTxns.length === 0;
  const firstInsight = insights.slice(0, 1);
  const needsReview = status?.needsReview ?? 0;
  const accountsLabel = `${status?.accountCount ?? 0} ${status?.accountCount === 1 ? 'account' : 'accounts'}`;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      {!ready ? (
        <OverviewSkeleton />
      ) : firstRun ? (
        <FirstRun onSample={sampleDataAvailable ? onSample : undefined} sampleBusy={sampleBusy} />
      ) : (
        summary &&
        status && (
          <>
            <StatusStrip status={status} />

            {status.evidence === 'cards_only' && (
              <Notice tone="info" title="Credit-card statements only">
                This is an analysis of card purchases. Add a bank statement to see income, savings and how your card bills were paid.
              </Notice>
            )}
            {!summary.coverage.complete && summary.coverage.notes.length > 0 && (
              <Notice tone="warning" title="Some of this period is not covered by your statements">
                <ul className="list-disc pl-4">
                  {summary.coverage.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <Link to={ROUTES.import} className="mt-1 inline-flex min-h-touch items-center font-medium underline">
                  Import a statement
                </Link>
              </Notice>
            )}

            {periodEmpty ? (
              <Card>
                <h2 className="text-base font-semibold text-fg">No transactions in this period</h2>
                <p className="mt-1 text-sm text-fg-muted">Pick another period, or import a statement that covers these dates.</p>
                <div className="mt-3">
                  <LinkButton to={ROUTES.import} variant="primary">
                    Import a statement
                  </LinkButton>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
                <div className="space-y-4 lg:col-span-2">
                  <MainSummary summary={summary} status={status} plan={plan} singleMonth={singleMonth} />
                  <SpendingPlanChart
                    series={series}
                    scope={`${period.label} · ${accountsLabel}`}
                    incomplete={!summary.coverage.complete}
                    hasPlan={planMonthly !== undefined}
                  />
                </div>

                <div className="space-y-4">
                  {firstInsight.length > 0 ? (
                    <InsightsSection
                      insights={firstInsight}
                      actions={actions ?? []}
                      baselines={baselines}
                      customCategories={customCategories}
                      today={today}
                      title="Your next step"
                      subtitle="The most useful thing to look at right now"
                    />
                  ) : needsReview > 0 ? (
                    <Card>
                      <CardHeader title="Your next step" subtitle="Check what we were unsure about" />
                      <p className="text-sm text-fg-muted">
                        {needsReview} {needsReview === 1 ? 'item needs' : 'items need'} a quick look. Fixing them makes every total more accurate.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
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
                  ) : null}

                  {commitments.length > 0 && (
                    <Card>
                      <CardHeader title="Coming up" subtitle="Next 60 days: card bills and recurring payments" action={<Link to={`${ROUTES.plan}?tab=recurring`} className="text-sm font-medium text-primary hover:underline">See all</Link>} />
                      <CommitmentTimeline items={commitments.slice(0, 5)} />
                    </Card>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <RecentActivity transactions={transactions} />
              {status.completeMonths.length >= 3 && (
                <Card>
                  <CardHeader title="Trends are ready" subtitle={`${status.completeMonths.length} complete months of statements`} />
                  <p className="text-sm text-fg-muted">Compare months, find what changed and see where your money went in Explore.</p>
                  <Link to={exploreLink('trends')} className="mt-2 inline-flex min-h-touch items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Explore trends <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Card>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
