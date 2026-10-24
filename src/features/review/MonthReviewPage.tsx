import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBudgets, useGoalContributions, useGoals, useLedger, useRecurringDecisions, useSavingActions } from '@/db/hooks';
import { saveMonthReview, useInsightFeedback, useMonthReviews } from '@/db/review';
import { usePageChrome } from '@/app/chrome';
import { ROUTES, exploreLink } from '@/app/routes';
import { dataStatus, monthReviewData, type Insight } from '@/engine/analytics';
import { addMonths, formatMonth, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, Money, Skeleton, cn, useToast } from '@/ui';
import { ChangesStep, ImportsStep, NextStep, PlanStep, UncertaintyStep } from './steps';
import { MaskedText } from '@/features/overview/InsightText';
import { LinkButton } from './LinkButton';

const STEPS = ['Imports', 'Uncertainties', 'Changes', 'Plan', 'Next month'] as const;
const STORE = (m: string) => `vm-review-step-${m}`;

function readStep(month: string): number {
  try {
    const n = Number(localStorage.getItem(STORE(month)));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}
function writeStep(month: string, step: number) {
  try {
    localStorage.setItem(STORE(month), String(step));
  } catch {
    /* private mode: resuming at the first step is fine */
  }
}

export default function MonthReviewPage() {
  const [params, setParams] = useSearchParams();
  const { toast } = useToast();
  const { ready, accounts, statements, transactions } = useLedger();
  const budgets = useBudgets();
  const actions = useSavingActions();
  const goals = useGoals();
  const contributions = useGoalContributions();
  const decisions = useRecurringDecisions();
  const feedback = useInsightFeedback();
  const reviews = useMonthReviews();
  const today = useMemo(() => todayIso(), []);

  const loaded = ready && budgets && actions && goals && contributions && decisions && feedback && reviews;
  const requested = params.get('month');
  const month = useMemo(() => {
    if (requested && /^\d{4}-\d{2}$/.test(requested)) return requested;
    if (!ready) return addMonths(monthKey(today), -1);
    return dataStatus(accounts, statements, transactions, today).latestCompleteMonth ?? addMonths(monthKey(today), -1);
  }, [requested, ready, accounts, statements, transactions, today]);

  usePageChrome({ title: `Review ${formatMonth(month)}`, subtitle: 'Five short steps: check, understand, plan.' });

  const existing = reviews?.find((r) => r.month === month);
  const stepParam = Number(params.get('step'));
  const [step, setStepState] = useState<number>(() => (Number.isInteger(stepParam) && stepParam >= 1 && stepParam <= 5 ? stepParam - 1 : readStep(month)));
  const [chosen, setChosen] = useState<{ id: string; title: string }[]>([]);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const showSummary = finished || (existing?.status === 'completed' && params.get('redo') !== '1');

  const data = useMemo(
    () =>
      loaded
        ? monthReviewData(transactions, {
            accounts,
            statements,
            budgets: budgets ?? [],
            actions: actions ?? [],
            goals: goals ?? [],
            contributions: contributions ?? [],
            recurringDecisions: decisions ?? [],
            feedback: feedback ?? [],
            month,
            today,
          })
        : null,
    [loaded, transactions, accounts, statements, budgets, actions, goals, contributions, decisions, feedback, month, today],
  );

  const monthTxns = useMemo(() => transactions.filter((t) => t.date.startsWith(month)), [transactions, month]);
  const large = useMemo(
    () =>
      monthTxns
        .filter((t) => t.direction === 'debit' && (t.kind === 'expense' || t.kind === 'p2p_out' || t.kind === 'unknown'))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    [monthTxns],
  );
  const insights: Insight[] = data?.suggestions ?? [];

  const nextActionIds = useMemo(() => [...new Set([...(existing?.nextActionIds ?? []), ...chosen.map((c) => c.id)])], [existing, chosen]);

  function go(n: number) {
    setStepState(n);
    writeStep(month, n);
    setParams({ month, step: String(n + 1) }, { replace: true });
  }

  async function next() {
    // Save progress so the review can be resumed and Overview can say "continue".
    try {
      if (existing?.status !== 'completed') await saveMonthReview({ month, status: 'in_progress', notes: existing?.notes ?? [], nextActionIds });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your progress.', { tone: 'error' });
    }
    go(Math.min(STEPS.length - 1, step + 1));
  }

  async function finish() {
    setBusy(true);
    try {
      await saveMonthReview({ month, status: 'completed', notes: existing?.notes ?? [], nextActionIds, completedAt: new Date().toISOString() });
      setFinished(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not finish the review.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4" aria-busy="true" aria-label="Loading your review">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6">
      {showSummary ? (
        <SummaryCard data={data} month={month} chosen={chosen} existingCount={existing?.nextActionIds.length ?? 0} onRedo={() => { setFinished(false); setParams({ month, redo: '1' }, { replace: true }); go(0); }} />
      ) : (
        <>
          <nav aria-label="Review steps">
            <ol className="flex gap-1">
              {STEPS.map((label, i) => (
                <li key={label} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cn(
                      'flex min-h-touch w-full flex-col items-center justify-center rounded-xl px-1 text-center text-xs font-medium',
                      i === step ? 'bg-primary-soft text-primary' : i < step ? 'text-fg hover:bg-surface-2' : 'text-fg-muted hover:bg-surface-2',
                    )}
                  >
                    <span className={cn('mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs', i < step ? 'bg-primary text-primary-fg' : 'border border-border-strong')}>
                      {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                    </span>
                    <span className="max-w-full truncate">{label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <p className="sr-only" aria-live="polite">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>

          {step === 0 && <ImportsStep data={data} month={month} />}
          {step === 1 && <UncertaintyStep data={data} />}
          {step === 2 && <ChangesStep data={data} large={large} insights={insights} />}
          {step === 3 && <PlanStep data={data} month={month} />}
          {step === 4 && <NextStep data={data} month={month} chosen={chosen} onChosen={(c) => setChosen((x) => [...x, c])} />}

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" icon={<ChevronLeft className="h-4 w-4" aria-hidden />} onClick={() => go(step - 1)} disabled={step === 0}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next}>
                Next <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={finish} loading={busy}>
                Finish review
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  data,
  month,
  chosen,
  existingCount,
  onRedo,
}: {
  data: NonNullable<ReturnType<typeof monthReviewData>>;
  month: string;
  chosen: { id: string; title: string }[];
  existingCount: number;
  onRedo: () => void;
}) {
  const ch = data.changes;
  const tagged = Object.entries(data.tagged.byTag).filter(([, v]) => (v ?? 0) > 0);
  const followed = data.actions.filter((o) => o.state === 'achieved' || o.state === 'on_track').length;
  return (
    <Card>
      <CardHeader title={`${formatMonth(month)} review complete`} subtitle="Here is the short version." action={<Badge tone="positive">Done</Badge>} />
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-fg">What changed</dt>
          <dd className="text-fg-muted">{ch && ch.comparable ? <MaskedText text={ch.headline} /> : 'No fair comparison was possible this month.'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-fg">What you expected</dt>
          <dd className="text-fg-muted">
            {tagged.length === 0 && data.expectedInsightIds.length === 0 ? (
              'Nothing was labelled as expected.'
            ) : (
              <>
                {tagged.map(([k, v]) => (
                  <span key={k} className="mr-2">
                    <Money value={v ?? 0} whole /> {k}
                  </span>
                ))}
                {data.expectedInsightIds.length > 0 && `${data.expectedInsightIds.length} ${data.expectedInsightIds.length === 1 ? 'insight' : 'insights'} marked expected.`}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-fg">Adjustments followed</dt>
          <dd className="text-fg-muted">
            {data.actions.length === 0
              ? 'You had no adjustments planned for this month.'
              : `${followed} of ${data.actions.length} ${data.actions.length === 1 ? 'adjustment is' : 'adjustments are'} on track in the recorded months. Statements show the change, not what caused it.`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-fg">What remains uncertain</dt>
          <dd className="text-fg-muted">
            {data.uncertain.length === 0 ? (
              'Nothing flagged.'
            ) : (
              <ul className="list-disc pl-5">
                {data.uncertain.map((u) => (
                  <li key={u}>
                    <MaskedText text={u} />
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-fg">Next month&apos;s choice</dt>
          <dd className="text-fg-muted">
            {chosen.length > 0 ? (
              <ul className="list-disc pl-5">
                {chosen.map((c) => (
                  <li key={c.id}>
                    <MaskedText text={c.title} />
                  </li>
                ))}
              </ul>
            ) : existingCount > 0 ? (
              `${existingCount} ${existingCount === 1 ? 'adjustment' : 'adjustments'} planned.`
            ) : (
              'No adjustment chosen.'
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton to={`${ROUTES.plan}?tab=actions`} variant="primary">
          See my actions
        </LinkButton>
        <LinkButton to={ROUTES.overview} variant="outline">
          Back to Overview
        </LinkButton>
        <Button variant="ghost" onClick={onRedo}>
          Go through it again
        </Button>
        <Link to={exploreLink('trends')} className="inline-flex min-h-touch items-center px-2 text-sm font-medium text-primary hover:underline">
          Explore trends
        </Link>
      </div>
    </Card>
  );
}
