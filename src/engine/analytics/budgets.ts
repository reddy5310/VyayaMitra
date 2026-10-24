import type { Account, Budget, IsoDate, MonthKey, Paise, Statement, Transaction } from '@/domain/types';
import { addMonths, daysInMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';
import { computeCoverage } from './coverage';
import type { BudgetStatus } from './index';
import { categoryResolver, contribution, isSpending } from './util';

/**
 * Month-by-month net spending per category (via the shared category resolver, so a linked refund
 * reduces the original purchase's category).
 */
export function spendingByMonthCategory(txns: readonly Transaction[]): Map<MonthKey, Map<string, { amount: Paise; ids: string[] }>> {
  const catOf = categoryResolver(txns);
  const out = new Map<MonthKey, Map<string, { amount: Paise; ids: string[] }>>();
  for (const t of txns) {
    const m = monthKey(t.date);
    if (isSpending(t)) {
      let cats = out.get(m);
      if (!cats) out.set(m, (cats = new Map()));
      const c = catOf(t);
      const cur = cats.get(c) ?? { amount: 0, ids: [] };
      cur.amount += contribution(t);
      cur.ids.push(t.id);
      cats.set(c, cur);
    }
  }
  return out;
}

/**
 * Budget status for ONE calendar month (the same month the caller is looking at).
 * spent = net spending in the budget's category that month (refunds subtract; never below 0).
 * `expectedByToday` exists only for the month that contains `today`: limit x day / daysInMonth.
 * state: over when spent > limit; watch when usage >= 0.8 or spent > expectedByToday x 1.15; else ok.
 * `coverageComplete` = every active account's statements cover the whole month.
 */
export function budgetStatuses(
  budgets: readonly Budget[],
  txns: readonly Transaction[],
  ctx: { month: MonthKey; today: IsoDate; accounts: readonly Account[]; statements: readonly Statement[] },
): BudgetStatus[] {
  const start = monthStart(ctx.month);
  const end = monthEnd(ctx.month);
  const monthTxns = txns.filter((t) => t.date >= start && t.date <= end);
  const catOf = categoryResolver(txns);
  const coverageComplete = computeCoverage(ctx.accounts, ctx.statements, start, end, txns).complete;
  const isCurrent = monthKey(ctx.today) === ctx.month;
  const dim = daysInMonth(Number(ctx.month.slice(0, 4)), Number(ctx.month.slice(5, 7)));
  const dayOfMonth = Number(ctx.today.slice(8, 10));

  return budgets.map((budget) => {
    const matching = monthTxns.filter((t) => isSpending(t) && catOf(t) === budget.category);
    const raw = matching.reduce((s, t) => s + contribution(t), 0);
    const spent = Math.max(0, raw);
    const usage = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : spent > 0 ? Infinity : 0;
    const expectedByToday = isCurrent ? Math.round((budget.monthlyLimit * dayOfMonth) / dim) : undefined;
    let state: BudgetStatus['state'] = 'ok';
    if (spent > budget.monthlyLimit) state = 'over';
    else if (usage >= 0.8 || (expectedByToday !== undefined && spent > expectedByToday * 1.15)) state = 'watch';
    return {
      budget,
      month: ctx.month,
      spent,
      remaining: budget.monthlyLimit - spent,
      usage,
      ...(expectedByToday !== undefined ? { expectedByToday } : {}),
      state,
      ...(spent > budget.monthlyLimit ? { overBy: spent - budget.monthlyLimit, overPct: budget.monthlyLimit > 0 ? Math.round(((spent - budget.monthlyLimit) / budget.monthlyLimit) * 1000) / 10 : 0 } : {}),
      coverageComplete,
      txnIds: matching.map((t) => t.id),
    };
  });
}

/** Finished months (oldest first), from the first transaction month, whose whole span is covered by statements. */
export function completeMonths(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; statements: readonly Statement[]; today: IsoDate },
  before?: MonthKey,
): MonthKey[] {
  if (txns.length === 0) return [];
  let first = txns[0].date;
  for (const t of txns) if (t.date < first) first = t.date;
  const out: MonthKey[] = [];
  const last = monthKey(ctx.today);
  for (let m = monthKey(first); m <= last; m = addMonths(m, 1)) {
    if (before && m >= before) break;
    // A month that has not finished yet can never be complete, whatever a statement claims.
    if (monthEnd(m) > ctx.today) continue;
    if (computeCoverage(ctx.accounts, ctx.statements, monthStart(m), monthEnd(m), txns).complete) out.push(m);
  }
  return out;
}

/** Average monthly net spend per category over given complete months (zero-filled). */
export function averagesOverMonths(
  txns: readonly Transaction[],
  months: readonly MonthKey[],
): { category: string; monthlyAverage: Paise; monthsUsed: number }[] {
  if (months.length === 0) return [];
  const byMonth = spendingByMonthCategory(txns);
  const totals = new Map<string, number>();
  for (const m of months) {
    for (const [cat, v] of byMonth.get(m) ?? []) totals.set(cat, (totals.get(cat) ?? 0) + v.amount);
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, monthlyAverage: Math.round(total / months.length), monthsUsed: months.length }))
    .filter((x) => x.monthlyAverage > 0)
    .sort((a, b) => b.monthlyAverage - a.monthlyAverage || a.category.localeCompare(b.category));
}

/**
 * Average monthly spend per category over the last N (default 3) COMPLETE months only.
 * A month is complete when every active account's statements cover all of it; incomplete
 * months (including a partly imported current month) never enter the average.
 */
export function categoryBaselines(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; statements: readonly Statement[]; today: IsoDate; months?: number },
): { category: string; monthlyAverage: Paise; monthsUsed: number }[] {
  const n = ctx.months ?? 3;
  const months = completeMonths(txns, ctx).slice(-n);
  return averagesOverMonths(txns, months);
}
