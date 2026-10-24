import type {
  Account,
  Budget,
  ExpenseTag,
  GoalContribution,
  InsightFeedback,
  IsoDate,
  MonthKey,
  Paise,
  RecurringDecision,
  SavingAction,
  SavingsGoal,
  Statement,
  Transaction,
} from '@/domain/types';
import { formatINR } from '@/lib/money';
import { addMonths, formatMonth, monthEnd, monthStart } from '@/lib/dates';
import { evaluateSavingActions } from './actions';
import { budgetStatuses } from './budgets';
import { computeCoverage } from './coverage';
import { explainChange } from './explain';
import type { ChangeExplanation } from './explain';
import { generateInsights } from './insights';
import type { MonthReviewData } from './index';
import { applyQuery } from './query';
import { EXTRACTION_RE } from './review';
import { contribution, isSpending, minDate, sameDayInMonth } from './util';

/**
 * Everything the month-end review needs for one calendar month.
 *
 * readiness: coverage of the WHOLE month (so an unfinished month is never "complete"; its missing
 * sentences cover the elapsed days plus a note that the month is not over). changes: explainChange
 * against the previous month, or against the equivalent elapsed days (1-N of each) when the month is
 * not fully covered yet; null when there is no earlier data. expectedInsightIds: ids of this month's
 * insights the user marked 'expected'. suggestions: up to 3 actionable insights (category limits,
 * recurring reviews, over-budget categories), with feedback applied.
 */
export function monthReviewData(
  txns: readonly Transaction[],
  ctx: {
    accounts: readonly Account[];
    statements: readonly Statement[];
    budgets: readonly Budget[];
    actions: readonly SavingAction[];
    goals: readonly SavingsGoal[];
    contributions: readonly GoalContribution[];
    recurringDecisions: readonly RecurringDecision[];
    feedback: readonly InsightFeedback[];
    month: MonthKey;
    today: IsoDate;
  },
): MonthReviewData {
  const { month, today, accounts, statements } = ctx;
  const start = monthStart(month);
  const end = monthEnd(month);
  const effEnd = minDate(end, today);
  const rows = applyQuery(txns, { start, end });

  const full = computeCoverage(accounts, statements, start, end, txns);
  const upTo = effEnd >= start ? computeCoverage(accounts, statements, start, effEnd, txns) : full;
  const missing = [...upTo.notes];
  if (today < end) missing.push(`${formatMonth(month)} is not over yet, so the month cannot be reviewed in full.`);
  const needsReviewRows = rows.filter((t) => t.needsReview);
  const extraction = needsReviewRows.filter((t) => t.reviewReasons.some((r) => EXTRACTION_RE.test(r))).length;

  // Changes: whole months when covered, equivalent elapsed days otherwise.
  const prevM = addMonths(month, -1);
  const hasEarlier = txns.some((t) => t.date < start);
  let changes: ChangeExplanation | null = null;
  if (hasEarlier && effEnd >= start) {
    const wholeCompare = full.complete;
    const current = { start, end: wholeCompare ? end : effEnd };
    const previous = wholeCompare ? { start: monthStart(prevM), end: monthEnd(prevM) } : { start: monthStart(prevM), end: sameDayInMonth(effEnd, prevM) };
    changes = explainChange(txns, { accounts, statements, current, previous, today });
  }

  const tagged = rows.filter((t) => t.tag && isSpending(t));
  const byTag: Partial<Record<ExpenseTag, Paise>> = {};
  let taggedTotal = 0;
  for (const t of tagged) {
    const c = contribution(t);
    byTag[t.tag as ExpenseTag] = (byTag[t.tag as ExpenseTag] ?? 0) + c;
    taggedTotal += c;
  }

  const insightInput = {
    txns, accounts, statements, budgets: ctx.budgets, recurringDecisions: ctx.recurringDecisions, actions: ctx.actions, start, end, today,
  };
  const expected = new Set(ctx.feedback.filter((f) => f.action === 'expected').map((f) => f.insightId));
  const expectedInsightIds = generateInsights(insightInput).map((i) => i.id).filter((id) => expected.has(id));
  const suggestions = generateInsights({ ...insightInput, feedback: ctx.feedback })
    .filter((i) => i.action && (i.action.type === 'category_limit' || i.action.type === 'review_recurring' || (i.type === 'budget' && i.action.category)))
    .slice(0, 3);

  const active = ctx.actions.filter((a) => a.status === 'active');
  const outcomes = evaluateSavingActions(active, txns, { accounts, statements, goals: ctx.goals, contributions: ctx.contributions, today });
  const budgets = budgetStatuses(ctx.budgets, txns, { month, today, accounts, statements });

  const uncertain: string[] = [...missing];
  if (needsReviewRows.length > 0) {
    const value = needsReviewRows.reduce((n, t) => n + t.amount, 0);
    uncertain.push(`${needsReviewRows.length} transaction${needsReviewRows.length === 1 ? '' : 's'} worth ${formatINR(value, { whole: true })} may be filed under the wrong kind or category.`);
  }
  if (extraction > 0) uncertain.push(`${extraction} row${extraction === 1 ? ' has' : 's have'} an amount or direction that could not be fully verified.`);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  for (const s of statements) {
    if (s.reconciliation.status === 'mismatch' && (s.periodStart ?? start) <= end && (s.periodEnd ?? end) >= start) {
      uncertain.push(`The ${accountName.get(s.accountId) ?? 'account'} statement did not match its printed balances.`);
    }
  }
  if (full.accounts.length > 0 && full.incomeCoverage !== 'full') uncertain.push('Income may be incomplete because a bank statement is missing for part of the month.');

  return {
    month,
    readiness: { coverageComplete: full.complete, missing, needsReview: needsReviewRows.length, extractionIssues: extraction },
    changes,
    tagged: { total: taggedTotal, byTag, txnIds: tagged.map((t) => t.id) },
    expectedInsightIds,
    actions: outcomes,
    budgets,
    uncertain,
    suggestions,
  };
}
