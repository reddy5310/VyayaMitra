import type { GoalContribution, IsoDate, SavingsGoal } from '@/domain/types';
import { addDays, monthKey } from '@/lib/dates';
import type { GoalProgress } from './index';
import { addMonthsToDate } from './util';

function signed(c: GoalContribution): number {
  return c.type === 'deposit' ? c.amount : -c.amount;
}

/** Whole calendar months from the month of `from` to the month of `to` (0 when the same month). */
function monthDiff(from: IsoDate, to: IsoDate): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * saved = deposits - withdrawals (never negative). `verified` is the part backed by imported
 * transactions (contributions carrying a linkedTxnId), also floored at 0 and never above `saved`.
 * monthlyNeeded = remaining spread over the calendar months left until targetDate (at least 1),
 * null without a date or once the goal is reached. recentMonthlyPace = net contributions over
 * the last 3 months (the 3 months ending today) / 3. onTrack is null without a targetDate.
 */
export function goalProgress(goal: SavingsGoal, contributions: readonly GoalContribution[], today: IsoDate): GoalProgress {
  const mine = contributions
    .filter((c) => c.goalId === goal.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const net = mine.reduce((s, c) => s + signed(c), 0);
  const saved = Math.max(0, net);
  const verifiedNet = mine.filter((c) => c.linkedTxnId).reduce((s, c) => s + signed(c), 0);
  const verified = Math.min(saved, Math.max(0, verifiedNet));
  const remaining = Math.max(0, goal.target - saved);
  const progress = goal.target > 0 ? Math.min(1, saved / goal.target) : 0;

  const windowStart = addDays(addMonthsToDate(today, -3), 1);
  const recentNet = mine.filter((c) => c.date >= windowStart && c.date <= today).reduce((s, c) => s + signed(c), 0);
  const recentMonthlyPace = Math.max(0, Math.round(recentNet / 3));

  let monthlyNeeded: number | null = null;
  if (goal.targetDate && remaining > 0) {
    const monthsLeft = Math.max(1, monthDiff(today, goal.targetDate));
    monthlyNeeded = Math.ceil(remaining / monthsLeft);
  }

  let projectedCompletion: IsoDate | undefined;
  if (remaining > 0 && recentMonthlyPace > 0) {
    const monthsToGo = Math.ceil(remaining / recentMonthlyPace);
    projectedCompletion = addMonthsToDate(today, monthsToGo);
  }

  let onTrack: boolean | null = null;
  if (goal.targetDate) {
    if (remaining === 0) onTrack = true;
    else if (goal.targetDate <= today) onTrack = false;
    else onTrack = monthlyNeeded !== null && recentMonthlyPace >= monthlyNeeded;
  }

  return {
    goal,
    saved,
    verified,
    remaining,
    progress,
    monthlyNeeded,
    recentMonthlyPace,
    ...(projectedCompletion ? { projectedCompletion } : {}),
    onTrack,
    contributions: mine,
  };
}

/** Net contribution (deposits - withdrawals) to a goal in each calendar month. */
export function contributionsByMonth(contributions: readonly GoalContribution[], goalId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of contributions) {
    if (c.goalId !== goalId) continue;
    const m = monthKey(c.date);
    out.set(m, (out.get(m) ?? 0) + signed(c));
  }
  return out;
}
