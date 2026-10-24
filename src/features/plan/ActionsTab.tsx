import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Flag } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { SavingAction } from '@/domain/types';
import { updateSavingAction } from '@/db/actions';
import { useGoalContributions, useGoals, useLedger, useSavingActions } from '@/db/hooks';
import { activityLink } from '@/app/routes';
import { evaluateSavingActions, type ActionOutcome } from '@/engine/analytics';
import { formatMonth, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, EmptyState, Money, useToast, type Tone } from '@/ui';
import { errorMessage } from './errors';
import { ConfirmSheet, ListSkeleton } from './planUi';

const TYPE_LABEL: Record<SavingAction['type'], string> = {
  category_limit: 'Spending limit',
  review_recurring: 'Review a subscription',
  goal_contribution: 'Goal contribution',
  custom: 'Custom',
};

const STATE: Record<ActionOutcome['state'], { label: string; tone: Tone }> = {
  waiting_for_data: { label: 'Waiting for data', tone: 'neutral' },
  on_track: { label: 'On track', tone: 'info' },
  off_track: { label: 'Off track', tone: 'warning' },
  achieved: { label: 'Target reached', tone: 'positive' },
};

/** What the action would save per month if the user hits the target. Always an estimate. */
function estimatedMonthly(a: SavingAction): number {
  const diff = a.type === 'goal_contribution' ? a.targetMonthly - a.baselineMonthly : a.baselineMonthly - a.targetMonthly;
  return Math.max(0, diff);
}

export function ActionsTab() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const actions = useSavingActions();
  const goals = useGoals();
  const contributions = useGoalContributions();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const [confirmDrop, setConfirmDrop] = useState<SavingAction | null>(null);

  const active = useMemo(() => (actions ?? []).filter((a) => a.status === 'active'), [actions]);
  const closed = useMemo(() => (actions ?? []).filter((a) => a.status !== 'active'), [actions]);

  const outcomes = useMemo(() => {
    if (!ready || !goals || !contributions || active.length === 0) return new Map<string, ActionOutcome>();
    const list = evaluateSavingActions(active, transactions, { accounts, statements, goals, contributions, today });
    return new Map(list.map((o) => [o.action.id, o]));
  }, [ready, goals, contributions, active, transactions, accounts, statements, today]);

  const estimatedTotal = active.reduce((s, a) => s + estimatedMonthly(a), 0);
  const achievedList = [...outcomes.values()].filter((o) => o.achievedMonthlySaving !== null);
  const achievedTotal = achievedList.reduce((s, o) => s + Math.max(0, o.achievedMonthlySaving ?? 0), 0);

  async function setStatus(a: SavingAction, status: 'completed' | 'dropped') {
    await updateSavingAction(a.id, { status });
    toast(status === 'completed' ? `${a.title} marked as completed.` : `${a.title} dropped.`, { tone: 'success' });
  }

  async function complete(a: SavingAction) {
    try {
      await setStatus(a, 'completed');
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  }

  if (!ready || actions === undefined || goals === undefined || contributions === undefined) return <ListSkeleton />;

  if (actions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Flag className="h-6 w-6" aria-hidden />}
          title="No saving actions yet"
          body="When an insight on the Overview suggests a way to spend less, start it from there. We will check it against later complete months and show what you really saved."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <Card>
          <h2 className="sr-only">Saving totals</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-info-soft px-3 py-2.5 text-info">
              <dt className="text-sm font-medium">Potential, if every target is met</dt>
              <dd className="text-xl font-semibold">
                <Money value={estimatedTotal} whole /> <span className="text-sm font-normal">a month</span>
              </dd>
              <dd className="text-xs opacity-90">A possibility, not money saved.</dd>
            </div>
            <div className="rounded-xl bg-surface-2 px-3 py-2.5">
              <dt className="text-sm font-medium text-fg-muted">Observed in complete months</dt>
              <dd className="text-xl font-semibold text-fg">
                {achievedList.length > 0 ? (
                  <>
                    <Money value={achievedTotal} whole /> <span className="text-sm font-normal">a month lower</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dd className="text-xs text-fg-muted">
                {achievedList.length > 0
                  ? `Measured on ${achievedList.length} of ${active.length} actions. Statements show the change, not what caused it.`
                  : 'Waiting for a full month of data.'}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <section aria-labelledby="act-active">
        <Card>
          <CardHeader title={<span id="act-active">Active actions</span>} />
          {active.length === 0 ? (
            <p className="text-sm text-fg-muted">No active actions.</p>
          ) : (
            <ul className="divide-y divide-border">
              {active.map((a) => (
                <ActionItem
                  key={a.id}
                  action={a}
                  outcome={outcomes.get(a.id)}
                  customCategories={customCategories}
                  onComplete={() => complete(a)}
                  onDrop={() => setConfirmDrop(a)}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      {closed.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface px-4 py-1">
          <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium text-fg">Completed and dropped ({closed.length})</summary>
          <ul className="divide-y divide-border pb-2">
            {closed.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-fg">{a.title}</span>
                <Badge tone={a.status === 'completed' ? 'positive' : 'neutral'}>{a.status === 'completed' ? 'Completed' : 'Dropped'}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirmDrop && (
        <ConfirmSheet
          title="Drop this action?"
          body={`"${confirmDrop.title}" will stop being tracked. You can always start a new one from an insight.`}
          confirmLabel="Drop action"
          onClose={() => setConfirmDrop(null)}
          onConfirm={() => setStatus(confirmDrop, 'dropped')}
        />
      )}
    </div>
  );
}

function ActionItem({
  action: a,
  outcome,
  customCategories,
  onComplete,
  onDrop,
}: {
  action: SavingAction;
  outcome: ActionOutcome | undefined;
  customCategories: Parameters<typeof categoryName>[1];
  onComplete: () => void;
  onDrop: () => void;
}) {
  const state = outcome ? STATE[outcome.state] : STATE.waiting_for_data;
  const achieved = outcome?.achievedMonthlySaving ?? null;
  const est = estimatedMonthly(a);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-fg">{a.title}</h3>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="text-xs text-fg-subtle">
        {TYPE_LABEL[a.type]}
        {a.category && <> · {categoryName(a.category, customCategories)}</>} · from {formatMonth(a.startMonth)}
      </p>

      <dl className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-info-soft px-3 py-2 text-info">
          <dt className="text-xs font-medium">Potential</dt>
          <dd className="text-sm font-medium">
            Up to <Money value={est} whole /> a month
          </dd>
          <dd className="text-xs opacity-90">If spending reaches the target.</dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs font-medium text-fg-muted">Planned</dt>
          <dd className="text-sm text-fg">
            <Money value={a.targetMonthly} whole /> a month
          </dd>
          <dd className="text-xs text-fg-muted">
            Down from <Money value={a.baselineMonthly} whole />
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <dt className="text-xs font-medium text-fg-muted">Observed</dt>
          {achieved === null ? (
            <dd className="text-sm text-fg-muted">Waiting for a full month of data</dd>
          ) : (
            <>
              <dd className="text-sm font-medium text-fg">
                {achieved > 0 ? (
                  <>
                    <Money value={achieved} whole /> a month lower
                  </>
                ) : (
                  'No drop so far'
                )}
              </dd>
              <dd className="text-xs text-fg-muted">
                {outcome && outcome.actualMonthly !== null && (
                  <>
                    Now <Money value={outcome.actualMonthly} whole /> a month ·{' '}
                  </>
                )}
                {outcome?.monthsEvaluated.length} complete {outcome?.monthsEvaluated.length === 1 ? 'month' : 'months'}. Statements show the change, not why.
              </dd>
            </>
          )}
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="md" variant="secondary" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} aria-label={`Mark ${a.title} completed`} onClick={onComplete}>
          Mark completed
        </Button>
        <Button size="md" variant="ghost" aria-label={`Drop ${a.title}`} onClick={onDrop}>
          Drop
        </Button>
        {outcome && outcome.txnIds.length > 0 && (
          <Link
            to={activityLink({ ids: outcome.txnIds })}
            className="inline-flex min-h-touch items-center rounded-xl px-2 text-sm font-medium text-primary hover:underline"
          >
            See {outcome.txnIds.length} {outcome.txnIds.length === 1 ? 'transaction' : 'transactions'}
          </Link>
        )}
      </div>
    </li>
  );
}
