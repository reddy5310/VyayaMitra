import type { Account, GoalContribution, IsoDate, MonthKey, SavingAction, SavingsGoal, Statement, Transaction } from '@/domain/types';
import { addMonths, monthEnd, monthKey, monthStart } from '@/lib/dates';
import { computeCoverage } from './coverage';
import { contributionsByMonth } from './goals';
import type { ActionOutcome } from './index';
import { spendingByMonthCategory } from './budgets';
import { bucketTotals } from './summary';
import { categoryResolver, contribution, isSpending, isUnclassifiedIn, UNCLASSIFIED_OUT } from './util';

/** Months from `from` up to and including the month of `through`. */
function monthsFrom(from: MonthKey, through: IsoDate): MonthKey[] {
  const out: MonthKey[] = [];
  const last = monthKey(through);
  for (let m = from; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * Did a saving action work? Only months fully covered by statements (all active accounts) from
 * `startMonth` onwards count, so a missing import never looks like a saving.
 *
 * - category_limit / review_recurring (and custom): actual monthly spend in the action's
 *   category or merchant, averaged over the evaluated months, compared with `baselineMonthly`.
 *   achievedMonthlySaving = baseline - actual (positive = saved).
 * - goal_contribution: net contributions to the goal in each elapsed month since startMonth
 *   (user-entered, so statement coverage is not required); achievedMonthlySaving = actual - baseline.
 *
 * State: no evaluated month -> 'waiting_for_data' (actual and saving stay null); target met ->
 * 'achieved'; moving the right way -> 'on_track'; otherwise 'off_track'.
 */
export function evaluateSavingActions(
  actions: readonly SavingAction[],
  txns: readonly Transaction[],
  ctx: {
    accounts: readonly Account[];
    statements: readonly Statement[];
    goals: readonly SavingsGoal[];
    contributions: readonly GoalContribution[];
    today: IsoDate;
  },
): ActionOutcome[] {
  const catOf = categoryResolver(txns);
  return actions.map((action): ActionOutcome => {
    const candidates = monthsFrom(action.startMonth, ctx.today);

    if (action.type === 'goal_contribution' && action.goalId) {
      const thisMonth = monthKey(ctx.today);
      const months = candidates.filter((m) => m < thisMonth);
      if (months.length === 0) return waiting(action);
      const byMonth = contributionsByMonth(ctx.contributions, action.goalId);
      const total = months.reduce((s, m) => s + (byMonth.get(m) ?? 0), 0);
      const actual = Math.max(0, Math.round(total / months.length));
      const saving = actual - action.baselineMonthly;
      const linked = ctx.contributions
        .filter((c) => c.goalId === action.goalId && c.linkedTxnId && months.includes(monthKey(c.date)))
        .map((c) => c.linkedTxnId as string);
      const state: ActionOutcome['state'] = actual >= action.targetMonthly ? 'achieved' : saving > 0 ? 'on_track' : 'off_track';
      return { action, monthsEvaluated: months, actualMonthly: actual, achievedMonthlySaving: saving, state, txnIds: linked };
    }

    const months = candidates.filter((m) => monthEnd(m) <= ctx.today && computeCoverage(ctx.accounts, ctx.statements, monthStart(m), monthEnd(m), txns).complete);
    if (months.length === 0) return waiting(action);
    const monthSet = new Set(months);
    const inMonths = txns.filter((t) => monthSet.has(monthKey(t.date)));
    let matching: Transaction[];
    let total: number;
    if (action.merchantKey) {
      matching = inMonths.filter((t) => isSpending(t) && (t.merchantKey || t.counterparty.vpa) === action.merchantKey);
      total = matching.reduce((s, t) => s + contribution(t), 0);
    } else if (action.category) {
      // Same per-month category totals as the baselines (including people netting).
      const byMonth = spendingByMonthCategory(inMonths);
      total = 0;
      for (const m of months) total += byMonth.get(m)?.get(action.category)?.amount ?? 0;
      matching = inMonths.filter((t) => (isSpending(t) && catOf(t) === action.category) || (action.category === UNCLASSIFIED_OUT && isUnclassifiedIn(t)));
    } else {
      matching = inMonths.filter(isSpending);
      total = months.reduce((s, m) => s + bucketTotals(inMonths.filter((t) => monthKey(t.date) === m)).spending, 0);
    }
    const actual = Math.max(0, Math.round(total / months.length));
    const saving = action.baselineMonthly - actual;
    const state: ActionOutcome['state'] = actual <= action.targetMonthly ? 'achieved' : saving > 0 ? 'on_track' : 'off_track';
    return { action, monthsEvaluated: months, actualMonthly: actual, achievedMonthlySaving: saving, state, txnIds: matching.map((t) => t.id) };
  });
}

function waiting(action: SavingAction): ActionOutcome {
  return { action, monthsEvaluated: [], actualMonthly: null, achievedMonthlySaving: null, state: 'waiting_for_data', txnIds: [] };
}
