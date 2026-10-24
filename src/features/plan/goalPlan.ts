import type { IsoDate, Paise, SavingsGoal } from '@/domain/types';
import { addMonths, daysBetween, monthEnd, monthKey } from '@/lib/dates';

/** Whole months from `today` to `deadline`, at least 1. */
export function monthsUntil(today: IsoDate, deadline: IsoDate): number {
  const [ty, tm] = today.split('-').map(Number);
  const [dy, dm] = deadline.split('-').map(Number);
  return Math.max(1, (dy - ty) * 12 + (dm - tm));
}

/** Monthly amount that reaches `target` by `deadline`, rounded up to a whole paisa. */
export function suggestMonthly(target: Paise, today: IsoDate, deadline: IsoDate): Paise {
  return Math.ceil(target / monthsUntil(today, deadline));
}

/** Month-end date by which `monthly` a month reaches `target`. */
export function finishDateFor(target: Paise, monthly: Paise, today: IsoDate): IsoDate {
  return monthEnd(addMonths(monthKey(today), Math.max(1, Math.ceil(target / monthly))));
}

/**
 * Where an even path from the day the goal was created to its deadline would be today.
 * Null when the goal has no deadline (there is nothing to compare against).
 */
export function expectedSavedByToday(goal: SavingsGoal, today: IsoDate): Paise | null {
  if (!goal.targetDate) return null;
  const start = goal.createdAt.slice(0, 10);
  const total = daysBetween(start, goal.targetDate);
  if (total <= 0) return goal.target;
  const elapsed = Math.max(0, Math.min(total, daysBetween(start, today)));
  return Math.floor((goal.target * elapsed) / total);
}
