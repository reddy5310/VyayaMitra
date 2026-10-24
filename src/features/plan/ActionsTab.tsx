import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { SavingAction } from '@/domain/types';
import { updateSavingAction } from '@/db/actions';
import { useBudgets, useGoalContributions, useGoals, useLedger, useSavingActions } from '@/db/hooks';
import { useAdviserPreferences, useCardPolicies, useChargeLinks, useRefundAllocations, useRefundCases } from '@/db/moneyback';
import { useInsightFeedback } from '@/db/review';
import { activityLink } from '@/app/routes';
import { actionTotals, categoryBaselines, evaluateSavingActions, feesSummary, moneyBack, recommendations, type ActionOutcome } from '@/engine/analytics';
import { formatMonth, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, Field, Input, Sheet, useToast, type Tone } from '@/ui';
import { paiseToInput, parseRupeeInput } from './amount';
import { errorMessage } from './errors';
import { MaskedText } from '@/features/overview/InsightText';
import { SuggestionCard } from '@/features/overview/SuggestionCard';
import { pickSuggestions } from '@/features/overview/suggestions';
import { ActionTotalsCard } from './ActionTotalsCard';
import { PreferencesPanel } from './PreferencesPanel';
import { ActionStages } from '@/features/review/stages';
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


export function ActionsTab() {
  const { ready, accounts, statements, transactions, customCategories } = useLedger();
  const actions = useSavingActions();
  const goals = useGoals();
  const contributions = useGoalContributions();
  const budgets = useBudgets();
  const cases = useRefundCases();
  const allocations = useRefundAllocations();
  const chargeLinks = useChargeLinks();
  const policies = useCardPolicies();
  const preferences = useAdviserPreferences();
  const insightFeedback = useInsightFeedback();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const [confirmDrop, setConfirmDrop] = useState<SavingAction | null>(null);
  const [adjusting, setAdjusting] = useState<SavingAction | null>(null);

  const active = useMemo(() => (actions ?? []).filter((a) => a.status === 'active'), [actions]);
  const closed = useMemo(() => (actions ?? []).filter((a) => a.status !== 'active'), [actions]);

  const outcomes = useMemo(() => {
    if (!ready || !goals || !contributions || active.length === 0) return new Map<string, ActionOutcome>();
    const list = evaluateSavingActions(active, transactions, { accounts, statements, goals, contributions, today });
    return new Map(list.map((o) => [o.action.id, o]));
  }, [ready, goals, contributions, active, transactions, accounts, statements, today]);

  const adviserReady = ready && actions !== undefined && budgets !== undefined && cases !== undefined && allocations !== undefined && chargeLinks !== undefined && policies !== undefined && preferences !== undefined;
  const recs = useMemo(
    () =>
      adviserReady
        ? recommendations(transactions, {
            accounts,
            statements,
            budgets: budgets ?? [],
            actions: actions ?? [],
            preferences: preferences ?? [],
            feedback: insightFeedback ?? [],
            cases: cases ?? [],
            allocations: allocations ?? [],
            chargeLinks: chargeLinks ?? [],
            policies: policies ?? [],
            today,
            limit: 8,
          })
        : [],
    [adviserReady, transactions, accounts, statements, budgets, actions, preferences, insightFeedback, cases, allocations, chargeLinks, policies, today],
  );
  const totals = useMemo(() => {
    if (!adviserReady) return null;
    return actionTotals([...outcomes.values()], {
      actions: active,
      moneyBack: moneyBack(transactions, { cases: cases ?? [], allocations: allocations ?? [], today }),
      fees: feesSummary(transactions, { links: chargeLinks ?? [], policies: policies ?? [], accounts }),
    });
  }, [adviserReady, outcomes, active, transactions, cases, allocations, chargeLinks, policies, accounts, today]);
  const baselines = useMemo(() => (ready ? categoryBaselines(transactions, { accounts, statements, today, months: 3 }) : []), [ready, transactions, accounts, statements, today]);

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

  const shown = pickSuggestions(recs, 5);

  return (
    <div className="space-y-4">
      {totals && <ActionTotalsCard totals={totals} />}

      <section aria-labelledby="act-suggestions">
        <Card>
          <CardHeader
            title={<span id="act-suggestions">Suggestions</span>}
            subtitle="Each one moves through Suggestion, Target chosen, Underway, Observed, then Keep or adjust."
          />
          {shown.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing to suggest right now. Suggestions appear as more complete months of statements arrive.</p>
          ) : (
            <ul className="space-y-3">
              {shown.map((r) => (
                <SuggestionCard key={r.id} rec={r} existing={actions} today={today} />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="act-active">
        <Card>
          <CardHeader title={<span id="act-active">Active actions</span>} />
          {active.length === 0 ? (
            <p className="text-sm text-fg-muted">No active actions yet. Choose a target on a suggestion above to start one.</p>
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
                  onAdjust={() => setAdjusting(a)}
                  thisMonth={monthKey(today)}
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

      <PreferencesPanel preferences={preferences ?? []} baselines={baselines} customCategories={customCategories} />

      {adjusting && <AdjustSheet action={adjusting} onClose={() => setAdjusting(null)} />}

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
  onAdjust,
  thisMonth,
}: {
  action: SavingAction;
  outcome: ActionOutcome | undefined;
  customCategories: Parameters<typeof categoryName>[1];
  onComplete: () => void;
  onDrop: () => void;
  onAdjust: () => void;
  thisMonth: string;
}) {
  const state = outcome ? STATE[outcome.state] : STATE.waiting_for_data;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-fg">
          <MaskedText text={a.title} />
        </h3>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="text-xs text-fg-subtle">
        {TYPE_LABEL[a.type]}
        {a.category && <> · {categoryName(a.category, customCategories)}</>} · from {formatMonth(a.startMonth)}
      </p>

      <Lifecycle stage={stageOf(a, outcome, thisMonth)} />
      <ActionStages action={a} outcome={outcome} />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="md" variant="secondary" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} aria-label={`Mark ${a.title} completed`} onClick={onComplete}>
          Mark completed
        </Button>
        <Button size="md" variant="outline" aria-label={`Adjust target for ${a.title}`} onClick={onAdjust}>
          Adjust target
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

const STAGES = ['Suggestion', 'Target chosen', 'Underway', 'Observed', 'Keep or adjust'] as const;

/** Where an active action is in its life. A suggestion becomes an action only once a target is chosen. */
function stageOf(a: SavingAction, o: ActionOutcome | undefined, thisMonth: string): number {
  if (o && o.achievedMonthlySaving !== null) return o.state === 'achieved' || o.state === 'off_track' ? 4 : 3;
  return a.startMonth > thisMonth ? 1 : 2;
}

function Lifecycle({ stage }: { stage: number }) {
  return (
    <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Where this action is">
      {STAGES.map((label, i) => (
        <li key={label} aria-current={i === stage ? 'step' : undefined} className={i === stage ? 'font-semibold text-primary' : i < stage ? 'text-fg' : 'text-fg-subtle'}>
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

function AdjustSheet({ action, onClose }: { action: SavingAction; onClose: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(paiseToInput(action.targetMonthly));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save() {
    const p = text.trim() === '0' ? { ok: true as const, paise: 0 } : parseRupeeInput(text);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setBusy(true);
    try {
      await updateSavingAction(action.id, { targetMonthly: p.paise });
      toast('Target adjusted.', { tone: 'success' });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      title="Adjust target"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" loading={busy} onClick={save}>
            Save target
          </Button>
        </div>
      }
    >
      <Field label="Monthly target (₹)" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input id={id} inputMode="decimal" value={text} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => { setText(e.target.value); setError(undefined); }} />
        )}
      </Field>
    </Sheet>
  );
}
