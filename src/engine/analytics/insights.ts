import type { Account, IsoDate, MonthKey, Paise, SavingAction, Transaction } from '@/domain/types';
import { categoryName } from '@/domain/categories';
import { addDays, addMonths, formatDate, formatMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';
import { evaluateSavingActions } from './actions';
import { averagesOverMonths, budgetStatuses, completeMonths, spendingByMonthCategory } from './budgets';
import { upcomingCardDues } from './cardDues';
import { computeCoverage } from './coverage';
import type { Coverage, Insight, InsightInput } from './index';
import { applyQuery } from './query';
import { detectRecurring, isSeriesActive } from './recurring';
import { bucketTotals, summarize } from './summary';
import { categoryResolver, mk, partsOf, renderMarked, soleAmount, formatRange, hashId, isSpending, isWholeMonth, median, minDate, sameDayInMonth, shortMonthYear } from './util';

const MAX_INSIGHTS = 8;
const inr = (p: Paise): string => mk(p);

/** Renders amount markers to plain rupees and adds structured parts so the UI can mask every amount. */
function finalize(i: Insight): Insight {
  const hasMark = (v: string): boolean => v.includes('');
  return {
    ...i,
    title: renderMarked(i.title),
    body: renderMarked(i.body),
    ...(hasMark(i.title) ? { titleParts: partsOf(i.title) } : {}),
    ...(hasMark(i.body) ? { bodyParts: partsOf(i.body) } : {}),
    ...(i.basis ? { basis: renderMarked(i.basis) } : {}),
    ...(i.action ? { action: { ...i.action, label: renderMarked(i.action.label) } } : {}),
    evidence: {
      ...i.evidence,
      figures: i.evidence.figures.map((f) => {
        const amount = soleAmount(f.value);
        return { label: renderMarked(f.label), value: renderMarked(f.value), ...(amount !== undefined ? { amount } : {}) };
      }),
    },
  };
}

interface Scored {
  score: number;
  insight: Insight;
}

/** id -> period-free key (type + subject), filled by makeId and read by `add`. */
const keyById = new Map<string, string>();

function makeId(type: Insight['type'], subject: string, period: string, keySubject: string = subject): string {
  const id = `${type}-${hashId(type, subject, period)}`;
  keyById.set(id, `${type}:${keySubject}`);
  return id;
}

/** "September 2025", "Jul – Sep 2025" or "1–14 Oct 2025" for a date range. */
function periodLabel(start: IsoDate, end: IsoDate): string {
  if (isWholeMonth(start, end)) return formatMonth(monthKey(start));
  return formatRange(start, end);
}

/** Label for the "Import your Oct ICICI Savings statement" call to action, from the first gap found. */
function importLabel(cov: Coverage, accounts: readonly Account[]): string {
  for (const ac of cov.accounts) {
    const gap = ac.gaps[0];
    if (!gap) continue;
    const name = accounts.find((a) => a.id === ac.accountId)?.name ?? 'bank';
    const m = monthKey(gap.start);
    return `Import your ${formatMonth(m).slice(0, 3)} ${name} statement to see the full month`;
  }
  if (cov.accounts.length === 0 && accounts.length > 0) return `Import a statement for ${formatMonth(monthKey(cov.start))}`;
  return 'Import a statement to get started';
}

/** Largest few spending transactions, as evidence. */
function topIds(txns: readonly Transaction[], n: number): string[] {
  return [...txns]
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((t) => t.id);
}

/**
 * Plain-language insights, most important first (at most 8).
 *
 * Every insight states what changed (real rupee figures), what supports it (evidence txnIds
 * and figures), what to do (action) and its basis. Rules that keep it honest:
 *  - spending is only compared between whole months that are fully covered, or between equivalent
 *    day ranges (1-N against 1-N of the previous month) that are fully covered; the basis says which.
 *    When coverage is missing no "up/down" claim is made - a coverage insight is emitted instead;
 *  - category changes compare with the average of up to 3 fully covered earlier months;
 *  - wording is tentative ("looks like", "may", "at least") unless coverage of the period is complete;
 *  - ids are a hash of type + subject + the viewed period, so they are stable between renders.
 * The focal month is the calendar month of min(end, today); days after `today` are never analysed.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const { txns, accounts, statements, budgets, recurringDecisions, actions, start, today } = input;
  const effEnd = minDate(input.end, today);
  if (effEnd < start) return [];
  if (txns.length === 0 && accounts.length === 0) return [];

  const periodKey = `${start}..${input.end}`;
  const periodTxns = applyQuery(txns, { start, end: effEnd });
  const cov = computeCoverage(accounts, statements, start, effEnd, txns);
  const tentative = !cov.complete;
  const label = periodLabel(start, effEnd);
  const catOf = categoryResolver(txns);
  const untagged = txns.filter((t) => !t.tag);
  const expectedBack = periodTxns.filter((t) => t.tag === 'reimbursable' && t.direction === 'debit' && isSpending(t)).reduce((n, t) => n + t.amount, 0);
  const backNote = expectedBack > 0 ? ` ${inr(expectedBack)} of this is tagged as expected back.` : '';
  const scored: Scored[] = [];
  const add = (score: number, insight: Insight): void => {
    scored.push({ score, insight: finalize({ ...insight, key: keyById.get(insight.id) ?? insight.type }) });
  };

  const focal: MonthKey = monthKey(effEnd);
  const curStart = start > monthStart(focal) ? start : monthStart(focal);
  const curEnd = effEnd;
  const whole = curStart === monthStart(focal) && curEnd === monthEnd(focal);
  const focalLabel = periodLabel(curStart, curEnd);

  // ── Spending change (complete months or equivalent days only) ────────────────────────────
  const prevM = addMonths(focal, -1);
  const prevStart = whole ? monthStart(prevM) : sameDayInMonth(curStart, prevM);
  const prevEnd = whole ? monthEnd(prevM) : sameDayInMonth(curEnd, prevM);
  const prevLabel = periodLabel(prevStart, prevEnd);
  const covCur = computeCoverage(accounts, statements, curStart, curEnd, txns);
  const covPrev = computeCoverage(accounts, statements, prevStart, prevEnd, txns);
  const prevTxns = applyQuery(txns, { start: prevStart, end: prevEnd });
  const curTxns = applyQuery(txns, { start: curStart, end: curEnd });
  const curSpend = bucketTotals(curTxns).spending;
  const prevSpend = bucketTotals(prevTxns).spending;
  const hasPrevData = txns.some((t) => t.date <= prevEnd);

  let comparisonBlocked: Coverage | null = null;
  if (covCur.complete && covPrev.complete) {
    if (prevSpend > 0 && curSpend >= 0) {
      const diff = curSpend - prevSpend;
      const pct = Math.round((Math.abs(diff) / prevSpend) * 100);
      const flat = pct < 3;
      const dir = diff < 0 ? 'down' : 'up';
      const basis = whole
        ? `Comparing ${focalLabel} with ${prevLabel}. Both months are fully covered by your imported statements.`
        : `Comparing ${focalLabel} with ${prevLabel} (equivalent days). Both ranges are fully covered by your imported statements.`;
      add(
        flat ? 40 : diff > 0 ? 80 : 45,
        {
          id: makeId('spending_change', focal, periodKey, 'spending'),
          type: 'spending_change',
          severity: flat ? 'info' : diff < 0 ? 'positive' : pct >= 20 ? 'warning' : 'info',
          title: flat ? `Spending is about the same as ${prevLabel}` : `Spending is ${dir} ${pct}% compared with ${prevLabel}`,
          body: flat
            ? `You spent ${inr(curSpend)} in ${focalLabel} and ${inr(prevSpend)} in ${prevLabel}.`
            : `You spent ${inr(curSpend)} in ${focalLabel}, ${inr(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than the ${inr(prevSpend)} spent in ${prevLabel}.${backNote}`,
          evidence: {
            txnIds: topIds(curTxns.filter(isSpending), 5),
            figures: [
              { label: focalLabel, value: inr(curSpend) },
              { label: prevLabel, value: inr(prevSpend) },
              { label: 'Change', value: `${diff < 0 ? '−' : '+'}${inr(Math.abs(diff))} (${pct}%)` },
            ],
          },
          basis,
          ...(diff > 0 && !flat ? { action: { type: 'review_transactions' as const, label: `See what you spent in ${focalLabel}` } } : {}),
        },
      );
    }
  } else if (hasPrevData) {
    comparisonBlocked = covCur.complete ? covPrev : covCur;
  }

  // ── Coverage ─────────────────────────────────────────────────────────────────────────────
  const hasStatements = statements.length > 0;
  if (!cov.complete) {
    const notes = cov.notes.slice(0, 2);
    add(95, {
      id: makeId('coverage', 'period', periodKey),
      type: 'coverage',
      severity: 'warning',
      title: hasStatements ? 'Some of your statements are missing' : 'No statements imported yet',
      body: hasStatements
        ? `${notes.join('. ')}. Until they are imported, totals for ${label} may leave out some spending, so VyayaMitra is not comparing this period with earlier ones yet.`
        : 'Import a bank or credit-card statement to see where your money goes. Everything stays on this device.',
      evidence: { txnIds: [], figures: cov.accounts.map((a) => ({ label: accounts.find((x) => x.id === a.accountId)?.name ?? a.accountId, value: `${a.coveredDays} of ${a.totalDays} days covered` })) },
      basis: `Statement coverage for ${label}`,
      action: { type: 'import_statement', label: importLabel(cov, accounts) },
    });
  } else if (comparisonBlocked) {
    const notes = comparisonBlocked.notes.slice(0, 2);
    add(50, {
      id: makeId('coverage', `compare-${prevM}`, periodKey, 'compare'),
      type: 'coverage',
      severity: 'info',
      title: `Can't compare with ${prevLabel} yet`,
      body: `${notes.join('. ')}. Import it to compare ${focalLabel} with ${prevLabel}.`,
      evidence: { txnIds: [], figures: [] },
      basis: `Statement coverage for ${prevLabel}`,
      action: { type: 'import_statement', label: importLabel(comparisonBlocked, accounts) },
    });
  }

  // ── Category change against the 3-complete-month baseline ────────────────────────────────
  const baseMonths = completeMonths(txns, { accounts, statements, today }, focal).slice(-3);
  if (baseMonths.length > 0) {
    const base = averagesOverMonths(untagged, baseMonths);
    const baseMap = new Map(base.map((b) => [b.category, b.monthlyAverage]));
    const byCat = spendingByMonthCategory(curTxns.filter((t) => !t.tag)).get(focal) ?? new Map<string, { amount: Paise; ids: string[] }>();
    const changes: { category: string; cur: Paise; baseline: Paise; ids: string[] }[] = [];
    for (const [category, v] of byCat) {
      const baseline = baseMap.get(category) ?? 0;
      if (category === 'uncategorized' || category === 'refunds' || category === 'sent_to_people' || baseline <= 0) continue;
      if (v.amount >= baseline * 1.3 && v.amount - baseline >= 100_000) changes.push({ category, cur: v.amount, baseline, ids: v.ids });
    }
    changes.sort((a, b) => b.cur - b.baseline - (a.cur - a.baseline));
    const monthsText = baseMonths.map(shortMonthYear).join(', ');
    for (const c of changes.slice(0, 2)) {
      const name = categoryName(c.category);
      const over = c.cur - c.baseline;
      const pct = Math.round((over / c.baseline) * 100);
      const partial = !whole;
      const tent = !covCur.complete;
      const lead = tent
        ? `${name} may be running above your usual: at least ${inr(c.cur)} in ${focalLabel} against an average of ${inr(c.baseline)} a month.`
        : partial
          ? `${name} is already ${inr(c.cur)} in ${focalLabel}, ${inr(over)} (${pct}%) above your usual ${inr(c.baseline)} for a whole month.`
          : `${name} was ${inr(c.cur)} in ${focalLabel}, ${inr(over)} (${pct}%) above your usual ${inr(c.baseline)} a month.`;
      const catTxns = curTxns.filter((t) => !t.tag && isSpending(t) && catOf(t) === c.category);
      add(75 + Math.min(10, Math.floor(over / 500_000)), {
        id: makeId('category_change', c.category, periodKey),
        type: 'category_change',
        severity: pct >= 100 ? 'warning' : 'info',
        title: `${name} is up ${pct}% on your usual`,
        body: `${lead}${backNote}`,
        evidence: {
          txnIds: topIds(catTxns, 6),
          figures: [
            { label: focalLabel, value: inr(c.cur) },
            { label: `Usual monthly average (${baseMonths.length} month${baseMonths.length === 1 ? '' : 's'})`, value: inr(c.baseline) },
            { label: 'Difference', value: `+${inr(over)}` },
          ],
        },
        basis: `Compared with your average for ${monthsText}: ${baseMonths.length} fully covered month${baseMonths.length === 1 ? '' : 's'}.`,
        action: { type: 'category_limit', label: `Set a ${name} limit of ${inr(c.baseline)} a month`, category: c.category, suggestedTarget: c.baseline },
        estimatedMonthlySaving: over,
      });
    }
  }

  // ── Budgets for the focal month ──────────────────────────────────────────────────────────
  if (budgets.length > 0) {
    const statuses = budgetStatuses(budgets, txns, { month: focal, today, accounts, statements });
    for (const s of statuses) {
      if (s.state === 'ok') continue;
      const name = categoryName(s.budget.category);
      const limit = s.budget.monthlyLimit;
      const monthText = formatMonth(focal);
      const partialNote = s.coverageComplete ? '' : ' Some statements are missing, so the real figure may be higher.';
      if (s.state === 'over') {
        add(90, {
          id: makeId('budget', s.budget.category, periodKey),
          type: 'budget',
          severity: 'critical',
          title: `${name} is over its budget`,
          body: `You have spent ${s.coverageComplete ? '' : 'at least '}${inr(s.spent)} on ${name} in ${monthText} against a limit of ${inr(limit)}, ${inr(s.spent - limit)} over.${partialNote}`,
          evidence: {
            txnIds: topIds(s.txnIds.map((id) => txns.find((t) => t.id === id)).filter((t): t is Transaction => !!t), 8),
            figures: [
              { label: 'Spent', value: inr(s.spent) },
              { label: 'Monthly limit', value: inr(limit) },
            ],
          },
          basis: `Calendar month ${monthText}, net of refunds.`,
          action: { type: 'review_transactions', label: `Review ${name} spending`, category: s.budget.category },
        });
      } else {
        const pace =
          s.expectedByToday !== undefined && s.spent > s.expectedByToday * 1.15
            ? ` That is faster than an even pace (about ${inr(s.expectedByToday)} by today).`
            : '';
        add(68, {
          id: makeId('budget', s.budget.category, periodKey),
          type: 'budget',
          severity: 'warning',
          title: `${name} may go over its budget`,
          body: `You have spent ${inr(s.spent)} of the ${inr(limit)} ${name} budget for ${monthText} (${Math.round(s.usage * 100)}%).${pace}${partialNote}`,
          evidence: {
            txnIds: topIds(s.txnIds.map((id) => txns.find((t) => t.id === id)).filter((t): t is Transaction => !!t), 8),
            figures: [
              { label: 'Spent', value: inr(s.spent) },
              { label: 'Monthly limit', value: inr(limit) },
              ...(s.expectedByToday !== undefined ? [{ label: 'Even pace by today', value: inr(s.expectedByToday) }] : []),
            ],
          },
          basis: `Calendar month ${monthText}, net of refunds.`,
          action: { type: 'review_transactions', label: `Review ${name} spending`, category: s.budget.category },
        });
      }
    }
  }

  // ── Recurring payments ───────────────────────────────────────────────────────────────────
  const series = detectRecurring(txns, recurringDecisions, today).filter((s) => isSeriesActive(s, today));
  if (series.length > 0) {
    const total = series.reduce((s, x) => s + x.monthlyCost, 0);
    const anySuggested = series.some((s) => s.status === 'suggested');
    const top = series.slice(0, 3);
    add(50, {
      id: makeId('recurring', 'total', periodKey),
      type: 'recurring',
      severity: 'info',
      title: `About ${inr(total)} a month goes to ${series.length} recurring payment${series.length === 1 ? '' : 's'}`,
      body: `${anySuggested ? 'These look like regular payments: ' : 'Your regular payments: '}${top
        .map((s) => `${s.merchant} (${inr(s.typicalAmount)} ${s.cadence})`)
        .join(', ')}${series.length > top.length ? ` and ${series.length - top.length} more` : ''}. Together that is roughly ${inr(total)} a month.`,
      evidence: {
        txnIds: top.flatMap((s) => s.txnIds.slice(-1)),
        figures: top.map((s) => ({ label: s.merchant, value: `${inr(s.monthlyCost)} a month` })),
      },
      basis: 'Payments that repeat at a regular interval with a steady amount in your imported statements.',
      action: { type: 'review_recurring', label: 'Review recurring payments', merchantKey: top[0].merchantKey, suggestedTarget: 0 },
    });
    const fresh = series.filter((s) => s.status === 'suggested' && s.confidence >= 0.5).slice(0, 2);
    for (const s of fresh) {
      add(55, {
        id: makeId('recurring', s.merchantKey, periodKey),
        type: 'recurring',
        severity: 'info',
        title: `${s.merchant} looks like a ${s.cadence} payment`,
        body: `${s.occurrences} payments of about ${inr(s.typicalAmount)}, most recently on ${formatDate(s.lastDate)}. That is roughly ${inr(s.monthlyCost)} a month. Confirm it if you still use it, or dismiss it if it is not a repeat.`,
        evidence: {
          txnIds: s.txnIds,
          figures: [
            { label: 'Typical amount', value: inr(s.typicalAmount) },
            { label: 'Payments found', value: String(s.occurrences) },
            { label: 'Next expected', value: formatDate(s.nextExpected) },
          ],
        },
        basis: `${s.occurrences} payments roughly every ${s.intervalDays} days.`,
        action: { type: 'review_recurring', label: `Check whether you still need ${s.merchant}`, merchantKey: s.merchantKey, suggestedTarget: 0 },
        estimatedMonthlySaving: s.monthlyCost,
      });
    }
  }

  // ── Large transaction ────────────────────────────────────────────────────────────────────
  {
    const windowStart = addDays(effEnd, -89);
    const sample = txns.filter((t) => t.direction === 'debit' && isSpending(t) && t.date >= windowStart && t.date <= effEnd);
    if (sample.length >= 5) {
      const med = median(sample.map((t) => t.amount));
      const threshold = Math.max(med * 3, 500_000);
      const big = periodTxns
        .filter((t) => !t.tag && t.direction === 'debit' && ['expense', 'p2p_out', 'cash_withdrawal', 'fee', 'unknown'].includes(t.kind) && t.amount > threshold)
        .sort((a, b) => b.amount - a.amount);
      if (big.length > 0) {
        const t = big[0];
        const times = med > 0 ? Math.round((t.amount / med) * 10) / 10 : 0;
        add(70, {
          id: makeId('large_transaction', t.id, periodKey, t.merchantKey || t.merchant),
          type: 'large_transaction',
          severity: 'info',
          title: `Large payment: ${inr(t.amount)} to ${t.merchant}`,
          body: `On ${formatDate(t.date)}, ${inr(t.amount)} went to ${t.merchant}, about ${times}× your typical purchase of ${inr(med)}.${big.length > 1 ? ` ${big.length - 1} other large payment${big.length === 2 ? '' : 's'} also stand out.` : ''}`,
          evidence: {
            txnIds: big.slice(0, 5).map((x) => x.id),
            figures: [
              { label: 'Amount', value: inr(t.amount) },
              { label: 'Typical purchase (last 90 days)', value: inr(med) },
            ],
          },
          basis: `Compared with the median spending transaction of the 90 days to ${formatDate(effEnd)} (${sample.length} transactions).`,
          action: { type: 'review_transactions', label: 'Check this payment' },
        });
      }
    }
  }

  // ── Sent to people (unresolved: not spending, not income, until classified) ──────────────
  {
    const totals = bucketTotals(periodTxns);
    const out = totals.peopleUnclassifiedOut;
    const inn = totals.peopleUnclassifiedIn;
    if (totals.rawSpending > 0 && out >= 200_000 && out / totals.rawSpending >= 0.3) {
      const outs = periodTxns.filter((t) => t.kind === 'p2p_out' && t.category === 'sent_to_people' && t.direction === 'debit');
      const ins = periodTxns.filter((t) => t.kind === 'p2p_in' && t.category === 'received_from_people');
      add(65, {
        id: makeId('people_out', 'p2p', periodKey),
        type: 'people_out',
        severity: 'info',
        title: `${inr(out)} unresolved: classify transfers to people`,
        body: `${inr(out)} sent to and ${inr(inn)} received from people in ${label} is unresolved, so it is not counted as spending or income. Classify each person (for example rent or family support) so it counts correctly.${tentative ? ' Some statements are missing, so these figures may be incomplete.' : ''}`,
        evidence: {
          txnIds: [...topIds(outs, 6), ...topIds(ins, 4)],
          figures: [
            { label: 'Sent to people, unresolved', value: inr(out) },
            { label: 'Received from people, unresolved', value: inr(inn) },
          ],
        },
        basis: `People transfers in ${label} still in the default Sent to people / Received from people categories.`,
        action: { type: 'review_transactions', label: 'Classify transfers to people' },
      });
    }
  }

  // ── Needs review ─────────────────────────────────────────────────────────────────────────
  {
    const nr = periodTxns.filter((t) => t.needsReview);
    if (nr.length > 0) {
      const value = nr.reduce((s, t) => s + t.amount, 0);
      add(58, {
        id: makeId('needs_review', 'all', periodKey),
        type: 'needs_review',
        severity: nr.length >= 10 ? 'warning' : 'info',
        title: `${nr.length} transaction${nr.length === 1 ? '' : 's'} need${nr.length === 1 ? 's' : ''} a quick look`,
        body: `${nr.length} transaction${nr.length === 1 ? '' : 's'} worth ${inr(value)} in ${label} may be filed under the wrong kind or category, which can shift your totals.`,
        evidence: { txnIds: nr.slice(0, 10).map((t) => t.id), figures: [{ label: 'Transactions to review', value: String(nr.length) }, { label: 'Value', value: inr(value) }] },
        basis: `Transactions flagged for review in ${label}.`,
        action: { type: 'review_transactions', label: 'Review them now' },
      });
    }
  }

  // ── Savings rate (income coverage must be full) ──────────────────────────────────────────
  {
    const sum = summarize(periodTxns, { accounts, statements, start, end: input.end, today });
    if (sum.coverage.incomeCoverage === 'full' && sum.savingsRate !== null) {
      const r = sum.savingsRate;
      add(r < 0 ? 85 : 62, {
        id: makeId('savings_rate', 'rate', periodKey),
        type: 'savings_rate',
        severity: r >= 20 ? 'positive' : r >= 0 ? 'info' : 'warning',
        title: r < 0 ? 'You spent more than you earned' : `You kept ${r}% of your income`,
        body:
          r < 0
            ? `${inr(sum.income)} came in and ${inr(sum.spending)} went out in ${label}, ${inr(sum.spending - sum.income)} more than your income.`
            : `${inr(sum.income)} came in and ${inr(sum.spending)} went out in ${label}, leaving ${inr(sum.netSavings)} (${r}% of income).`,
        evidence: {
          txnIds: [],
          figures: [
            { label: 'Income', value: inr(sum.income) },
            { label: 'Spending', value: inr(sum.spending) },
            { label: 'Savings rate', value: `${r}%` },
          ],
        },
        basis: `Income and spending from your savings/current account statements for ${label}; card payments, own-account transfers and reversals are not counted.`,
        ...(r < 0 ? { action: { type: 'review_transactions' as const, label: 'See where the money went' } } : {}),
      });
    }
  }

  // ── Credit-card bills due soon or overdue ────────────────────────────────────────────────
  for (const due of upcomingCardDues(accounts, statements, txns, today)) {
    if (due.status === 'paid' || due.daysLeft > 7) continue;
    const card = accounts.find((a) => a.id === due.accountId)?.name ?? 'Credit card';
    const remaining = Math.max(0, due.totalDue - due.paidSoFar);
    const overdue = due.status === 'overdue';
    const paidText = due.paidSoFar > 0 ? `${inr(due.paidSoFar)} paid so far, ${inr(remaining)} left.` : 'No payment found yet in your imported statements.';
    const when = overdue
      ? `was due on ${formatDate(due.dueDate)} (${-due.daysLeft} day${-due.daysLeft === 1 ? '' : 's'} ago)`
      : due.daysLeft === 0
        ? 'is due today'
        : `is due on ${formatDate(due.dueDate)} (in ${due.daysLeft} day${due.daysLeft === 1 ? '' : 's'})`;
    const stmt = statements.find((x) => x.id === due.statementId);
    const cut = stmt?.cardSummary?.statementDate ?? stmt?.periodEnd ?? '';
    const payments = txns.filter((t) => t.accountId === due.accountId && t.kind === 'card_payment' && t.direction === 'credit' && t.date > cut);
    add(overdue ? 92 : 88, {
      id: makeId('card_due', due.accountId, `${due.statementId}`),
      type: 'card_due',
      severity: overdue ? 'critical' : 'warning',
      title: overdue ? `${card} bill is overdue` : `${card} bill is due soon`,
      body: `Your ${card} bill of ${inr(due.totalDue)} ${when}. ${paidText} Payments made from accounts you have not imported cannot be seen here.`,
      evidence: {
        txnIds: payments.map((t) => t.id),
        figures: [
          { label: 'Total due', value: inr(due.totalDue) },
          ...(due.minimumDue !== undefined ? [{ label: 'Minimum due', value: inr(due.minimumDue) }] : []),
          { label: 'Paid so far', value: inr(due.paidSoFar) },
          { label: 'Due date', value: formatDate(due.dueDate) },
        ],
      },
      basis: 'Due date and amount printed on your latest imported card statement; payments are the card bill payments found after it.',
      action: { type: 'review_transactions', label: 'See card payments' },
    });
  }

  // ── Teach a few merchants to fix many rows ───────────────────────────────────────────────
  {
    const pending = txns.filter((t) => t.needsReview);
    if (pending.length >= 10) {
      const groups = new Map<string, Transaction[]>();
      for (const t of pending) {
        const key = t.merchantKey || t.counterparty.vpa || t.merchant;
        const list = groups.get(key);
        if (list) list.push(t);
        else groups.set(key, [t]);
      }
      const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).slice(0, 3);
      const rows = top.reduce((n, [, list]) => n + list.length, 0);
      if (rows >= 10) {
        const k = top.length;
        add(57, {
          id: makeId('learning', top.map(([key]) => key).join(','), periodKey, 'merchants'),
          type: 'learning',
          severity: 'info',
          title: `Teach ${k} merchant${k === 1 ? '' : 's'} to fix ${rows} rows`,
          body: `${rows} of your ${pending.length} rows that need review come from just ${k} merchant${k === 1 ? '' : 's'}: ${top.map(([, list]) => `${list[0].merchant} (${list.length})`).join(', ')}. Set each one once and the rest follow.`,
          evidence: {
            txnIds: top.flatMap(([, list]) => list.slice(0, 4).map((t) => t.id)),
            figures: top.map(([, list]) => ({ label: list[0].merchant, value: `${list.length} rows` })),
          },
          basis: 'Rows currently flagged for review, grouped by merchant.',
          action: { type: 'review_transactions', label: 'Review these merchants' },
        });
      }
    }
  }

  // ── Outcomes of active saving actions ────────────────────────────────────────────────────
  {
    const active = actions.filter((a: SavingAction) => a.status === 'active' && a.type !== 'goal_contribution');
    if (active.length > 0) {
      const outcomes = evaluateSavingActions(active, txns, { accounts, statements, goals: [], contributions: [], today });
      for (const o of outcomes) {
        const a = o.action;
        const id = makeId('action_outcome', a.id, periodKey);
        if (o.state === 'waiting_for_data') {
          add(30, {
            id,
            type: 'action_outcome',
            severity: 'info',
            title: `Waiting to check "${a.title}"`,
            body: `Results appear once a full month from ${formatMonth(a.startMonth)} is covered by your statements. Your starting point was ${inr(a.baselineMonthly)} a month.`,
            evidence: { txnIds: [], figures: [{ label: 'Starting point', value: `${inr(a.baselineMonthly)} a month` }, { label: 'Target', value: `${inr(a.targetMonthly)} a month` }] },
            basis: 'Only months fully covered by your statements are counted.',
          });
          continue;
        }
        const actual = o.actualMonthly ?? 0;
        const saving = o.achievedMonthlySaving ?? 0;
        const months = o.monthsEvaluated.map(shortMonthYear).join(', ');
        const body =
          o.state === 'achieved'
            ? `"${a.title}" is on target: ${inr(actual)} a month against ${inr(a.baselineMonthly)} before${saving > 0 ? `, ${inr(saving)} less` : ''}.`
            : o.state === 'on_track'
              ? `"${a.title}" is moving the right way: ${inr(actual)} a month against ${inr(a.baselineMonthly)} before, but the target is ${inr(a.targetMonthly)}.`
              : `"${a.title}" has not worked yet: ${inr(actual)} a month against ${inr(a.baselineMonthly)} before and a target of ${inr(a.targetMonthly)}.`;
        add(o.state === 'off_track' ? 72 : o.state === 'achieved' ? 66 : 60, {
          id,
          type: 'action_outcome',
          severity: o.state === 'off_track' ? 'warning' : 'positive',
          title: o.state === 'achieved' ? `"${a.title}" is working` : o.state === 'on_track' ? `"${a.title}" is on track` : `"${a.title}" is off track`,
          body,
          evidence: {
            txnIds: o.txnIds.slice(0, 10),
            figures: [
              { label: 'Before', value: `${inr(a.baselineMonthly)} a month` },
              { label: 'Now', value: `${inr(actual)} a month` },
              { label: 'Target', value: `${inr(a.targetMonthly)} a month` },
            ],
          },
          basis: `Average of ${o.monthsEvaluated.length} fully covered month${o.monthsEvaluated.length === 1 ? '' : 's'} (${months}).`,
          ...(o.state === 'off_track' ? { action: { type: 'review_transactions' as const, label: 'See the transactions', ...(a.category ? { category: a.category } : {}) } } : {}),
        });
      }
    }
  }

  const fb = input.feedback ?? [];
  const hiddenIds = new Set(fb.filter((f) => f.action === 'dismissed' || f.action === 'expected').map((f) => f.insightId));
  const hiddenKeys = new Set(fb.filter((f) => f.action === 'irrelevant').map((f) => f.key));
  const dismissals = new Map<string, number>();
  for (const f of fb) if (f.action === 'dismissed') dismissals.set(f.key, (dismissals.get(f.key) ?? 0) + 1);
  for (const [k, n] of dismissals) if (n >= 3) hiddenKeys.add(k);
  const visible = scored.filter((s) => !hiddenIds.has(s.insight.id) && !hiddenKeys.has(s.insight.key ?? ''));
  visible.sort((a, b) => b.score - a.score || a.insight.id.localeCompare(b.insight.id));
  return visible.slice(0, MAX_INSIGHTS).map((s) => s.insight);
}
