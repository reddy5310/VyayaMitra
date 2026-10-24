import { useMemo, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, RotateCcw, Target, Trash2 } from 'lucide-react';
import type { GoalContribution, SavingsGoal } from '@/domain/types';
import { deleteContribution, deleteGoal, updateGoal } from '@/db/actions';
import { useGoalContributions, useGoals, useLedger } from '@/db/hooks';
import { goalProgress, type GoalProgress } from '@/engine/analytics';
import { formatDate, formatMonth, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, IconButton, Money, ProgressBar, useToast, type Tone } from '@/ui';
import { ContributionSheet } from './ContributionSheet';
import { GoalSheet } from './GoalSheet';
import { goalIcon } from './goalStyle';
import { errorMessage } from './errors';
import { ConfirmSheet, ListSkeleton } from './planUi';

type Dialog =
  | { kind: 'goal'; editing: SavingsGoal | null }
  | { kind: 'contribution'; goal: SavingsGoal; type: 'deposit' | 'withdrawal' }
  | { kind: 'delete-goal'; goal: SavingsGoal }
  | { kind: 'delete-contribution'; contribution: GoalContribution };

export function GoalsTab() {
  const { ready, transactions } = useLedger();
  const goals = useGoals();
  const contributions = useGoalContributions();
  const { toast } = useToast();
  const today = useMemo(() => todayIso(), []);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const progress = useMemo(() => {
    if (!goals || !contributions) return [];
    return goals.map((g) =>
      goalProgress(
        g,
        contributions.filter((c) => c.goalId === g.id),
        today,
      ),
    );
  }, [goals, contributions, today]);

  const active = progress.filter((p) => !p.goal.archived);
  const archived = progress.filter((p) => p.goal.archived);

  async function setArchived(goal: SavingsGoal, archivedFlag: boolean) {
    try {
      await updateGoal(goal.id, { archived: archivedFlag });
      toast(archivedFlag ? `${goal.name} archived.` : `${goal.name} restored.`, { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setDialog({ kind: 'goal', editing: null })} disabled={!goals}>
          New goal
        </Button>
      </div>

      {!ready || !goals || !contributions ? (
        <ListSkeleton />
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-6 w-6" aria-hidden />}
            title="No goals yet"
            body="A goal gives your savings a purpose: an emergency fund, a trip, a down payment. Record deposits as you go and see if you are on track."
            action={<Button onClick={() => setDialog({ kind: 'goal', editing: null })}>Create your first goal</Button>}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {active.map((p) => (
            <li key={p.goal.id}>
              <GoalCard
                progress={p}
                onDeposit={() => setDialog({ kind: 'contribution', goal: p.goal, type: 'deposit' })}
                onWithdraw={() => setDialog({ kind: 'contribution', goal: p.goal, type: 'withdrawal' })}
                onEdit={() => setDialog({ kind: 'goal', editing: p.goal })}
                onArchive={() => setArchived(p.goal, true)}
                onDelete={() => setDialog({ kind: 'delete-goal', goal: p.goal })}
                onDeleteContribution={(c) => setDialog({ kind: 'delete-contribution', contribution: c })}
              />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="rounded-2xl border border-border bg-surface px-4 py-1">
          <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium text-fg">Archived goals ({archived.length})</summary>
          <ul className="divide-y divide-border pb-2">
            {archived.map((p) => (
              <li key={p.goal.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-sm text-fg-muted">
                  <span className="block truncate text-fg">{p.goal.name}</span>
                  <Money value={p.saved} whole /> of <Money value={p.goal.target} whole />
                </span>
                <div className="flex shrink-0">
                  <IconButton label={`Restore ${p.goal.name}`} onClick={() => setArchived(p.goal, false)}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Delete ${p.goal.name}`} onClick={() => setDialog({ kind: 'delete-goal', goal: p.goal })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dialog?.kind === 'goal' && <GoalSheet editing={dialog.editing} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'contribution' && (
        <ContributionSheet
          goal={dialog.goal}
          type={dialog.type}
          transactions={transactions}
          existing={contributions ?? []}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete-goal' && (
        <ConfirmSheet
          title={`Delete ${dialog.goal.name}?`}
          body="The goal and its whole deposit and withdrawal history will be removed. This cannot be undone. Archive it instead if you only want it out of the way."
          confirmLabel="Delete goal"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteGoal(dialog.goal.id);
            toast('Goal deleted.', { tone: 'success' });
          }}
        />
      )}
      {dialog?.kind === 'delete-contribution' && (
        <ConfirmSheet
          title="Delete this entry?"
          body={
            <>
              The {dialog.contribution.type} of <Money value={dialog.contribution.amount} /> on {formatDate(dialog.contribution.date)} will be removed from the
              goal&apos;s history.
            </>
          }
          confirmLabel="Delete entry"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteContribution(dialog.contribution.id);
            toast('Entry deleted.', { tone: 'success' });
          }}
        />
      )}
    </div>
  );
}

function trackBadge(p: GoalProgress): { label: string; tone: Tone } {
  if (p.remaining <= 0) return { label: 'Goal reached', tone: 'positive' };
  if (p.onTrack === true) return { label: 'On track', tone: 'positive' };
  if (p.onTrack === false) return { label: 'Behind', tone: 'warning' };
  return { label: 'No target date', tone: 'neutral' };
}

function GoalCard({
  progress: p,
  onDeposit,
  onWithdraw,
  onEdit,
  onArchive,
  onDelete,
  onDeleteContribution,
}: {
  progress: GoalProgress;
  onDeposit: () => void;
  onWithdraw: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDeleteContribution: (c: GoalContribution) => void;
}) {
  const { goal } = p;
  const Icon = goalIcon(goal.icon);
  const badge = trackBadge(p);
  const history = [...p.contributions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const unverified = Math.max(0, p.saved - p.verified);
  return (
    <Card className="h-full">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `color-mix(in srgb, ${goal.color} 16%, transparent)`, color: goal.color }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold text-fg">{goal.name}</h3>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-fg-muted">
            <Money value={p.saved} whole className="font-medium text-fg" /> saved of <Money value={goal.target} whole />
            {goal.targetDate && <> by {formatDate(goal.targetDate)}</>}
          </p>
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0">
          <IconButton label={`Edit ${goal.name}`} onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Archive ${goal.name}`} onClick={onArchive}>
            <Archive className="h-4 w-4" aria-hidden />
          </IconButton>
          <IconButton label={`Delete ${goal.name}`} onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <ProgressBar className="mt-3" value={p.progress} tone={badge.tone === 'neutral' ? 'primary' : badge.tone} label={`${goal.name} progress`} />
      <p className="mt-1 text-xs text-fg-muted">
        {Math.round(Math.min(1, p.progress) * 100)}% · <Money value={p.remaining} whole /> to go
      </p>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Verified by your statements</dt>
          <dd className="text-right text-fg">
            <Money value={p.verified} whole />
          </dd>
        </div>
        {unverified > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Self-reported</dt>
            <dd className="text-right text-fg">
              <Money value={unverified} whole />
            </dd>
          </div>
        )}
        {p.monthlyNeeded !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Needed each month</dt>
            <dd className="text-right text-fg">
              <Money value={p.monthlyNeeded} whole />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Recent pace (3 months)</dt>
          <dd className="text-right text-fg">
            <Money value={p.recentMonthlyPace} whole /> a month
          </dd>
        </div>
        {p.remaining > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">At this pace</dt>
            <dd className="text-right text-fg">
              {p.projectedCompletion ? `Done around ${formatMonth(monthKey(p.projectedCompletion))}` : 'Not enough activity to project'}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="md" icon={<ArrowDownToLine className="h-4 w-4" aria-hidden />} aria-label={`Add deposit to ${goal.name}`} onClick={onDeposit}>
          Add deposit
        </Button>
        <Button
          size="md"
          variant="outline"
          icon={<ArrowUpFromLine className="h-4 w-4" aria-hidden />}
          aria-label={`Withdraw from ${goal.name}`}
          onClick={onWithdraw}
          disabled={p.saved <= 0}
        >
          Withdraw
        </Button>
      </div>

      <details className="mt-3 border-t border-border">
        <summary className="min-h-touch cursor-pointer py-3 text-sm font-medium text-fg">History ({history.length})</summary>
        {history.length === 0 ? (
          <p className="pb-2 text-sm text-fg-muted">No deposits yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0 text-sm">
                  <p className="text-fg">
                    {c.type === 'deposit' ? 'Deposit' : 'Withdrawal'} · {formatDate(c.date)}
                    {c.linkedTxnId && (
                      <Badge tone="positive" className="ml-2">
                        Verified
                      </Badge>
                    )}
                  </p>
                  {c.note && <p className="truncate text-xs text-fg-subtle">{c.note}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <Money value={c.amount} direction={c.type === 'deposit' ? 'credit' : 'debit'} tone="direction" className="text-sm" />
                  <IconButton label={`Delete ${c.type} of ${formatDate(c.date)}`} onClick={() => onDeleteContribution(c)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  );
}
