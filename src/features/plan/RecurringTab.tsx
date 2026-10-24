import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Repeat, X } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { Cadence } from '@/domain/types';
import { createSavingAction, setRecurringDecision } from '@/db/actions';
import { useLedger, useRecurringDecisions, useSavingActions } from '@/db/hooks';
import { activityLink } from '@/app/routes';
import { detectRecurring, isSeriesActive, upcomingCardDues, type RecurringSeries } from '@/engine/analytics';
import { addMonths, formatDate, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, CategoryIcon, EmptyState, Money, Notice, useToast } from '@/ui';
import { CardDuesList } from '@/features/overview/CardDues';
import { errorMessage } from './errors';
import { ListSkeleton } from './planUi';

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
};

function confidenceLabel(c: number): string {
  return c >= 0.8 ? 'Strong match' : c >= 0.55 ? 'Likely' : 'Possible';
}

export function RecurringTab() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const decisions = useRecurringDecisions();
  const actions = useSavingActions();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const series = useMemo(
    () => (ready && decisions ? detectRecurring(transactions, decisions, today) : []),
    [ready, decisions, transactions, today],
  );
  // Card bills still to pay (paid ones are history, not "due soon").
  const dues = useMemo(
    () => (ready ? upcomingCardDues(accounts, statements, transactions, today).filter((d) => d.status !== 'paid') : []),
    [ready, accounts, statements, transactions, today],
  );
  const suggested = series.filter((s) => s.status === 'suggested' && isSeriesActive(s, today));
  const confirmed = series.filter((s) => s.status === 'confirmed');
  const dismissed = series.filter((s) => s.status === 'dismissed');
  const monthlyTotal = confirmed.reduce((sum, s) => sum + s.monthlyCost, 0);
  const reviewing = useMemo(
    () => new Set((actions ?? []).filter((a) => a.type === 'review_recurring' && a.status === 'active').map((a) => a.merchantKey)),
    [actions],
  );

  async function decide(s: RecurringSeries, status: 'confirmed' | 'dismissed') {
    setBusyKey(s.merchantKey);
    try {
      await setRecurringDecision(
        status === 'confirmed'
          ? { merchantKey: s.merchantKey, status, cadence: s.cadence, expectedAmount: s.typicalAmount, label: s.merchant }
          : { merchantKey: s.merchantKey, status },
      );
      toast(status === 'confirmed' ? `${s.merchant} marked as recurring.` : `${s.merchant} will not be suggested again.`, { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusyKey(null);
    }
  }

  async function reviewToSave(s: RecurringSeries) {
    setBusyKey(s.merchantKey);
    try {
      await createSavingAction({
        type: 'review_recurring',
        title: `Review ${s.merchant}`,
        category: s.category,
        merchantKey: s.merchantKey,
        baselineMonthly: s.monthlyCost,
        targetMonthly: 0,
        startMonth: addMonths(monthKey(today), 1),
        status: 'active',
      });
      toast(`Review of ${s.merchant} added to your saving actions.`, { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusyKey(null);
    }
  }

  if (!ready || decisions === undefined || actions === undefined) return <ListSkeleton />;

  if (series.length === 0 && dues.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Repeat className="h-6 w-6" aria-hidden />}
          title="No recurring payments found yet"
          body="Subscriptions, rent and EMIs show up here once the same payment appears in a few months of statements."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {dues.length > 0 && (
        <section aria-labelledby="rec-due-soon">
          <Card>
            <CardHeader
              title={<span id="rec-due-soon">Due soon</span>}
              subtitle="Credit-card bills from your latest statements. Paying the full amount avoids interest."
            />
            <CardDuesList dues={dues} accounts={accounts} />
          </Card>
        </section>
      )}
      {suggested.length > 0 && (
        <section aria-labelledby="rec-suggested">
          <Card>
            <CardHeader
              title={<span id="rec-suggested">Is this recurring?</span>}
              subtitle="These look like regular payments. Confirm the ones that are, so they count towards your commitments."
            />
            <ul className="divide-y divide-border">
              {suggested.map((s) => (
                <li key={s.merchantKey} className="py-3 first:pt-0 last:pb-0">
                  <SeriesSummary series={s} customCategories={customCategories} />
                  <p className="mt-1 text-xs text-fg-subtle">
                    {confidenceLabel(s.confidence)} · seen {s.occurrences} times
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="md"
                      icon={<Check className="h-4 w-4" aria-hidden />}
                      loading={busyKey === s.merchantKey}
                      aria-label={`Confirm ${s.merchant} as recurring`}
                      onClick={() => decide(s, 'confirmed')}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="md"
                      variant="outline"
                      icon={<X className="h-4 w-4" aria-hidden />}
                      disabled={busyKey === s.merchantKey}
                      aria-label={`${s.merchant} is not recurring`}
                      onClick={() => decide(s, 'dismissed')}
                    >
                      Not recurring
                    </Button>
                    <EvidenceLink series={s} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-labelledby="rec-confirmed">
        <Card>
          <CardHeader title={<span id="rec-confirmed">Your recurring payments</span>} />
          {confirmed.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing confirmed yet. Subscriptions, rent and EMIs you confirm are listed here.</p>
          ) : (
            <>
              <div className="mb-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="text-sm text-fg-muted">Monthly commitment</p>
                <p className="text-xl font-semibold text-fg">
                  <Money value={monthlyTotal} whole />
                  <span className="text-sm font-normal text-fg-muted"> a month</span>
                </p>
                <p className="text-xs text-fg-subtle">
                  About <Money value={monthlyTotal * 12} whole /> a year. Weekly, quarterly and yearly payments are converted to a monthly equivalent.
                </p>
              </div>
              <ul className="divide-y divide-border">
                {confirmed.map((s) => (
                  <li key={s.merchantKey} className="py-3 first:pt-0 last:pb-0">
                    <SeriesSummary series={s} customCategories={customCategories} />
                    <p className="mt-1 text-sm text-fg-muted">
                      Next expected {formatDate(s.nextExpected)}
                      {s.overdue && (
                        <Badge tone="warning" className="ml-2">
                          Overdue
                        </Badge>
                      )}
                    </p>
                    {s.overdue && (
                      <p className="mt-0.5 text-xs text-fg-subtle">
                        The last payment we have is {formatDate(s.lastDate)}. It may be missing from your imported statements.
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {reviewing.has(s.merchantKey) ? (
                        <Badge tone="info">Reviewing</Badge>
                      ) : (
                        <Button
                          size="md"
                          variant="secondary"
                          loading={busyKey === s.merchantKey}
                          aria-label={`Review ${s.merchant} to save`}
                          onClick={() => reviewToSave(s)}
                        >
                          Review to save
                        </Button>
                      )}
                      <EvidenceLink series={s} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      {dismissed.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface px-4 py-1">
          <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium text-fg">Marked as not recurring ({dismissed.length})</summary>
          <ul className="divide-y divide-border pb-2">
            {dismissed.map((s) => (
              <li key={s.merchantKey} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-fg-muted">{s.merchant}</span>
                <Button size="md" variant="ghost" aria-label={`Mark ${s.merchant} as recurring`} onClick={() => decide(s, 'confirmed')}>
                  Mark as recurring
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Notice tone="info">Recurring payments are detected from your imported statements only, so a short history can hide some of them.</Notice>
    </div>
  );
}

function SeriesSummary({ series, customCategories }: { series: RecurringSeries; customCategories: Parameters<typeof categoryName>[1] }) {
  return (
    <div className="flex items-start gap-3">
      <CategoryIcon category={series.category} custom={customCategories} size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-fg">{series.merchant}</h3>
        <p className="text-sm text-fg-muted">
          {CADENCE_LABEL[series.cadence]} · <Money value={series.typicalAmount} /> typical
          {series.cadence !== 'monthly' && (
            <>
              {' '}
              (about <Money value={series.monthlyCost} whole /> a month)
            </>
          )}
        </p>
        <p className="text-xs text-fg-subtle">{categoryName(series.category, customCategories)}</p>
      </div>
    </div>
  );
}

function EvidenceLink({ series }: { series: RecurringSeries }) {
  if (series.txnIds.length === 0) return null;
  return (
    <Link
      to={activityLink({ ids: series.txnIds })}
      aria-label={`See ${series.txnIds.length} ${series.merchant} transactions`}
      className="inline-flex min-h-touch items-center rounded-xl px-2 text-sm font-medium text-primary hover:underline"
    >
      See {series.txnIds.length} {series.txnIds.length === 1 ? 'transaction' : 'transactions'}
    </Link>
  );
}
