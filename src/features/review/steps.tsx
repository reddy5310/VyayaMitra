import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FlaskConical, Upload } from 'lucide-react';
import { createSavingAction } from '@/db/actions';
import { setTransactionsTag, recordInsightFeedback } from '@/db/review';
import type { ExpenseTag, Paise, SavingAction, Transaction } from '@/domain/types';
import type { Insight, MonthReviewData } from '@/engine/analytics';
import { ROUTES, activityLink, exploreLink } from '@/app/routes';
import { addMonths, formatDate, formatMonth } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { Badge, Button, Card, CardHeader, MeterBar, Money, Notice, useToast } from '@/ui';
import { categoryName } from '@/domain/categories';
import { ActionStages } from './stages';
import { LinkButton } from './LinkButton';

const linkClass = 'inline-flex min-h-touch items-center font-medium text-primary hover:underline';

function msg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.';
}

function Step({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

// ─── 1. Complete the month's imports ─────────────────────────────────────────

export function ImportsStep({ data, month }: { data: MonthReviewData; month: string }) {
  const { missing, coverageComplete } = data.readiness;
  return (
    <Step title="Complete the month's imports" subtitle={`A review is only as good as the statements behind ${formatMonth(month)}.`}>
      {coverageComplete && missing.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-positive">
          <CheckCircle2 className="h-5 w-5" aria-hidden /> Your statements cover the whole month.
        </p>
      ) : (
        <>
          <Notice tone="warning" title="Something is missing">
            <ul className="list-disc pl-4">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
          <LinkButton to={ROUTES.import} variant="primary" icon={<Upload className="h-4 w-4" aria-hidden />}>
            Import a statement
          </LinkButton>
          <p className="text-xs text-fg-muted">You can carry on without it. Anything that depends on the gap will be marked as uncertain.</p>
        </>
      )}
    </Step>
  );
}

// ─── 2. Resolve uncertainties ────────────────────────────────────────────────

export function UncertaintyStep({ data }: { data: MonthReviewData }) {
  const { extractionIssues, needsReview } = data.readiness;
  return (
    <Step title="Resolve uncertainties" subtitle="Wrong amounts first, then categories we were unsure about.">
      {extractionIssues > 0 && (
        <Notice tone="negative" title={`${extractionIssues} ${extractionIssues === 1 ? 'row has' : 'rows have'} an amount or direction we could not verify`}>
          <Link to={activityLink({ review: true })} className={linkClass}>
            Check them in Activity
          </Link>
        </Notice>
      )}
      {needsReview > 0 ? (
        <p className="text-sm text-fg-muted">
          {needsReview} {needsReview === 1 ? 'transaction needs' : 'transactions need'} a category or type.{' '}
          <Link to={activityLink({ review: true })} className={linkClass}>
            Review them
          </Link>{' '}
          or{' '}
          <Link to={ROUTES.learning} className={linkClass}>
            teach VyayaMitra a merchant at a time
          </Link>
          .
        </p>
      ) : extractionIssues === 0 ? (
        <p className="flex items-center gap-2 text-sm text-positive">
          <CheckCircle2 className="h-5 w-5" aria-hidden /> Nothing needs checking.
        </p>
      ) : null}
      {data.uncertain.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-fg-muted">
          {data.uncertain.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
    </Step>
  );
}

// ─── 3. Understand changes ───────────────────────────────────────────────────

const TAGS: { tag: ExpenseTag; label: string }[] = [
  { tag: 'planned', label: 'Planned' },
  { tag: 'exceptional', label: 'Exceptional' },
  { tag: 'reimbursable', label: 'Reimbursable' },
];

export function ChangesStep({ data, large, insights }: { data: MonthReviewData; large: Transaction[]; insights: Insight[] }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function tag(t: Transaction, next: ExpenseTag | null) {
    setBusy(t.id);
    try {
      await setTransactionsTag([t.id], next);
    } catch (e) {
      toast(msg(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }
  async function feedback(i: Insight, action: 'expected' | 'irrelevant') {
    try {
      await recordInsightFeedback({ key: i.key ?? i.id, insightId: i.id, action });
      toast(action === 'expected' ? 'Marked as expected.' : 'We will not show this again.', { tone: 'success' });
    } catch (e) {
      toast(msg(e), { tone: 'error' });
    }
  }

  const ch = data.changes;
  return (
    <Step title="Understand what changed" subtitle="What moved, why, and what you already expected.">
      {ch && ch.comparable ? (
        <>
          <p className="text-base font-medium text-fg">{ch.headline}</p>
          <ul className="divide-y divide-border">
            {ch.merchants.slice(0, 5).map((m) => (
              <li key={m.merchantKey} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{m.merchant}</p>
                  <p className="text-xs text-fg-muted">{m.sentence}</p>
                  {m.txnIdsCurrent.length > 0 && (
                    <Link to={activityLink({ ids: m.txnIdsCurrent })} className="text-xs font-medium text-primary hover:underline">
                      See {m.txnIdsCurrent.length} {m.txnIdsCurrent.length === 1 ? 'transaction' : 'transactions'}
                    </Link>
                  )}
                </div>
                <Money value={m.delta} direction={m.delta >= 0 ? 'debit' : 'credit'} className="shrink-0 text-sm" />
              </li>
            ))}
          </ul>
          <Link to={exploreLink('compare')} className={linkClass}>
            Compare in detail in Explore
          </Link>
        </>
      ) : (
        <Notice tone="info" title="No fair comparison this month">
          {ch?.comparison.note ?? 'There is no earlier month with matching statements to compare against, so changes are not explained.'}
        </Notice>
      )}

      <div>
        <h3 className="text-sm font-semibold text-fg">Largest expenses</h3>
        <p className="text-xs text-fg-muted">Label one-offs so they stay in your totals without raising alarms.</p>
        {large.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">No large expenses this month.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {large.map((t) => (
              <li key={t.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium text-fg">
                    {t.merchant || t.rawDescription} <span className="font-normal text-fg-muted">· {formatDate(t.date, { short: true })}</span>
                  </p>
                  <Money value={t.amount} className="shrink-0 text-sm" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Label ${t.merchant || 'expense'}`}>
                  {TAGS.map(({ tag: v, label }) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={t.tag === v}
                      disabled={busy === t.id}
                      onClick={() => tag(t, t.tag === v ? null : v)}
                      className={`min-h-touch rounded-full border px-3 text-sm font-medium ${t.tag === v ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-fg-muted hover:bg-surface-2'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {insights.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-fg">Things the review noticed</h3>
          <ul className="mt-2 space-y-2">
            {insights.map((i) => (
              <li key={i.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium text-fg">{i.title}</p>
                <p className="text-xs text-fg-muted">{i.body}</p>
                {data.expectedInsightIds.includes(i.id) ? (
                  <Badge tone="info" className="mt-1">
                    Marked as expected
                  </Badge>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button size="md" variant="secondary" onClick={() => feedback(i, 'expected')}>
                      Expected<span className="sr-only"> : {i.title}</span>
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => feedback(i, 'irrelevant')}>
                      Not relevant<span className="sr-only"> : {i.title}</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Step>
  );
}

// ─── 4. Review the plan ──────────────────────────────────────────────────────

export function PlanStep({ data, month }: { data: MonthReviewData; month: string }) {
  return (
    <Step title="Review your plan" subtitle={`How ${formatMonth(month)} went against your budgets, and what happened to last month's adjustments.`}>
      {data.budgets.length === 0 ? (
        <p className="text-sm text-fg-muted">
          You have no budgets yet.{' '}
          <Link to={`${ROUTES.plan}?tab=budgets`} className={linkClass}>
            Set some in Plan
          </Link>
        </p>
      ) : (
        <ul className="space-y-3">
          {data.budgets.map((b) => {
            const name = categoryName(b.budget.category);
            const over = b.spent - b.budget.monthlyLimit;
            return (
              <li key={b.budget.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-fg">{name}</span>
                  <span className={over > 0 ? 'font-medium text-negative' : 'text-fg-muted'}>
                    {over > 0 ? (
                      <>
                        <Money value={over} whole /> over
                      </>
                    ) : (
                      <>
                        <Money value={-over} whole /> under
                      </>
                    )}
                  </span>
                </div>
                <MeterBar className="mt-1" value={b.spent} target={b.budget.monthlyLimit} label={`${name} budget`} />
                {!b.coverageComplete && <p className="text-xs text-warning">Not every account is covered, so spending may be higher.</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <h3 className="text-sm font-semibold text-fg">Last month&apos;s adjustments</h3>
        {data.actions.length === 0 ? (
          <p className="mt-1 text-sm text-fg-muted">You had no adjustments planned for this month.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {data.actions.map((o) => (
              <li key={o.action.id} className="py-3 first:pt-1 last:pb-0">
                <p className="text-sm font-medium text-fg">{o.action.title}</p>
                <ActionStages action={o.action} outcome={o} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Step>
  );
}

// ─── 5. Choose next month's adjustment ───────────────────────────────────────

type NewAction = Omit<SavingAction, 'id' | 'createdAt' | 'updatedAt'>;

function toAction(i: Insight, nextMonth: string): NewAction | null {
  const a = i.action;
  if (!a || (a.type !== 'category_limit' && a.type !== 'review_recurring' && a.type !== 'goal_contribution' && a.type !== 'custom')) return null;
  const est = i.estimatedMonthlySaving ?? 0;
  const target: Paise = a.type === 'review_recurring' ? 0 : (a.suggestedTarget ?? 0);
  if (a.type === 'category_limit' && (a.suggestedTarget === undefined || a.suggestedTarget <= 0)) return null;
  return {
    type: a.type,
    title: a.label || i.title,
    category: a.category,
    merchantKey: a.merchantKey,
    baselineMonthly: target + est,
    targetMonthly: target,
    startMonth: nextMonth,
    status: 'active',
    insightId: i.id,
  };
}

export function NextStep({
  data,
  month,
  chosen,
  onChosen,
}: {
  data: MonthReviewData;
  month: string;
  chosen: { id: string; title: string }[];
  onChosen: (a: { id: string; title: string }) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const nextMonth = addMonths(month, 1);
  const picks = data.suggestions.slice(0, 3);

  async function choose(i: Insight, input: NewAction) {
    setBusy(i.id);
    try {
      const created = await createSavingAction(input);
      onChosen({ id: created.id, title: input.title });
      toast('Planned for next month.', { tone: 'success' });
    } catch (e) {
      toast(msg(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Step title="Choose next month's adjustment" subtitle="Pick up to three. These are plans; the result is recorded only from complete months.">
      {picks.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing stands out enough to suggest an adjustment. You can still set limits yourself.</p>
      ) : (
        <ul className="space-y-3">
          {picks.map((i) => {
            const input = toAction(i, nextMonth);
            const done = chosen.some((c) => c.title === (input?.title ?? ''));
            return (
              <li key={i.id} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-fg">{i.title}</p>
                <p className="text-sm text-fg-muted">{i.body}</p>
                {i.estimatedMonthlySaving !== undefined && i.estimatedMonthlySaving > 0 && (
                  <p className="mt-1 text-xs text-fg-muted">
                    <Badge tone="info" className="mr-1">
                      Opportunity
                    </Badge>
                    Up to {formatINR(i.estimatedMonthlySaving, { whole: true })} a month. Not saved yet.
                  </p>
                )}
                <div className="mt-2">
                  {done ? (
                    <Badge tone="positive">Planned for {formatMonth(nextMonth)}</Badge>
                  ) : input ? (
                    <Button variant="secondary" loading={busy === i.id} onClick={() => choose(i, input)}>
                      Plan this adjustment<span className="sr-only"> : {i.title}</span>
                    </Button>
                  ) : (
                    <Link to={`${ROUTES.plan}?tab=budgets`} className={linkClass}>
                      Set it up in Plan
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <LinkButton to={`${ROUTES.plan}?tab=budgets&scenario=1`} variant="outline" icon={<FlaskConical className="h-4 w-4" aria-hidden />}>
        Open the scenario editor
      </LinkButton>
    </Step>
  );
}
