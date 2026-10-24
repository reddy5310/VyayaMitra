import type { SavingAction } from '@/domain/types';
import type { ActionOutcome } from '@/engine/analytics';
import { Money } from '@/ui';

/** Potential saving per month if the target is met. Contributions work the other way round. */
// eslint-disable-next-line react-refresh/only-export-components
export function potentialMonthly(a: SavingAction): number {
  const diff = a.type === 'goal_contribution' ? a.targetMonthly - a.baselineMonthly : a.baselineMonthly - a.targetMonthly;
  return Math.max(0, diff);
}

/**
 * Three stages, kept apart on purpose: Opportunity (what could be saved), Planned adjustment (what the
 * user chose) and Recorded result (what complete months show). The result is an observation; it is never
 * presented as caused by VyayaMitra.
 */
export function ActionStages({ action: a, outcome }: { action: SavingAction; outcome?: ActionOutcome }) {
  const achieved = outcome?.achievedMonthlySaving ?? null;
  return (
    <ol className="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Opportunity, planned adjustment and recorded result">
      <li className="rounded-xl bg-info-soft px-3 py-2 text-info">
        <p className="text-xs font-medium">1 · Opportunity</p>
        <p className="text-sm font-medium">
          Up to <Money value={potentialMonthly(a)} whole /> a month
        </p>
        <p className="text-xs opacity-90">If spending reaches the target.</p>
      </li>
      <li className="rounded-xl bg-surface-2 px-3 py-2">
        <p className="text-xs font-medium text-fg-muted">2 · Planned adjustment</p>
        <p className="text-sm text-fg">
          <Money value={a.targetMonthly} whole /> a month
        </p>
        <p className="text-xs text-fg-muted">
          {a.type === 'goal_contribution' ? 'Extra for the goal' : <>Down from <Money value={a.baselineMonthly} whole /></>}
        </p>
      </li>
      <li className="rounded-xl bg-surface-2 px-3 py-2">
        <p className="text-xs font-medium text-fg-muted">3 · Recorded result</p>
        {achieved === null ? (
          <p className="text-sm text-fg-muted">Waiting for a full month of data</p>
        ) : (
          <>
            <p className="text-sm font-medium text-fg">
              {achieved > 0 ? (
                <>
                  <Money value={achieved} whole /> a month lower
                </>
              ) : (
                'No drop so far'
              )}
            </p>
            <p className="text-xs text-fg-muted">
              {outcome && outcome.actualMonthly !== null && (
                <>
                  Now <Money value={outcome.actualMonthly} whole /> a month ·{' '}
                </>
              )}
              {outcome?.monthsEvaluated.length} complete {outcome?.monthsEvaluated.length === 1 ? 'month' : 'months'}. Statements show the change, not why.
            </p>
          </>
        )}
      </li>
    </ol>
  );
}
