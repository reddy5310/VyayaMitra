import type { Account, CategoryGroup, IsoDate, MonthKey, Paise, Statement, Transaction } from '@/domain/types';
import { categoryById } from '@/domain/categories';
import { metricBucket, signedContribution } from '@/domain/kinds';
import { addDays, daysBetween, monthEnd, monthStart } from '@/lib/dates';
import { computeCoverage } from './coverage';
import type { CategoryTotal, LedgerSummary, MerchantStat, MonthlyPoint, SummaryContext } from './index';
import { categoryResolver, contribution, isSpending, isUnclassifiedIn, isUnclassifiedOut, minDate, UNCLASSIFIED_OUT } from './util';

export interface BucketTotals {
  income: Paise;
  /** Spending after people netting (see summarize). */
  spending: Paise;
  /** Spending bucket total before people netting. */
  rawSpending: Paise;
  refunds: Paise;
  invested: Paise;
  peopleIn: Paise;
  peopleOut: Paise;
  peopleUnclassifiedOut: Paise;
  peopleUnclassifiedIn: Paise;
  peopleNetOut: Paise;
}

/** Headline totals computed straight from metricBucket + signedContribution. */
export function bucketTotals(txns: readonly Transaction[]): BucketTotals {
  const out: BucketTotals = {
    income: 0,
    spending: 0,
    rawSpending: 0,
    refunds: 0,
    invested: 0,
    peopleIn: 0,
    peopleOut: 0,
    peopleUnclassifiedOut: 0,
    peopleUnclassifiedIn: 0,
    peopleNetOut: 0,
  };
  for (const t of txns) {
    const bucket = metricBucket(t.kind, t.direction);
    const c = signedContribution(t.kind, t.direction, t.amount);
    switch (bucket) {
      case 'income':
        out.income += c;
        break;
      case 'spending':
        out.rawSpending += c;
        if (t.kind === 'refund' && t.direction === 'credit') out.refunds += t.amount;
        if (t.kind === 'p2p_out') out.peopleOut += c;
        if (isUnclassifiedOut(t)) out.peopleUnclassifiedOut += c;
        break;
      case 'invested':
        out.invested += c;
        break;
      case 'people_in':
        out.peopleIn += c;
        if (isUnclassifiedIn(t)) out.peopleUnclassifiedIn += c;
        break;
      case 'neutral':
        break;
    }
  }
  out.peopleNetOut = Math.max(0, out.peopleUnclassifiedOut - out.peopleUnclassifiedIn);
  out.spending = out.rawSpending - out.peopleUnclassifiedOut + out.peopleNetOut;
  return out;
}

/** Below this (or 5% of spending) income is too small to give a meaningful savings rate. */
const MIN_INCOME = 100_000;
const NO_REGULAR_INCOME =
  'No regular income found in this period — money arrived as transfers from your own accounts or from people.';

function savingsRateFor(
  income: Paise,
  spending: Paise,
  netSavings: Paise,
  inflow: Paise,
  cov: LedgerSummary['coverage'],
  accounts: readonly Account[],
): { savingsRate: number | null; savingsRateNote?: string } {
  if (cov.incomeCoverage === 'none') {
    const relevantIds = new Set(cov.accounts.map((c) => c.accountId));
    const types = accounts.filter((a) => relevantIds.has(a.id)).map((a) => a.type);
    const note =
      types.length === 0
        ? 'No statements are imported for this period, so income is unknown.'
        : types.every((t) => t === 'credit_card')
          ? 'Only a credit-card statement is imported for this period, so income is unknown.'
          : 'No savings or current account statement covers this period, so income is unknown.';
    return { savingsRate: null, savingsRateNote: note };
  }
  if (cov.incomeCoverage === 'partial') {
    return {
      savingsRate: null,
      savingsRateNote: 'A savings or current account statement is missing for part of this period, so income may be incomplete.',
    };
  }
  if (income < Math.max(MIN_INCOME, spending * 0.05)) return { savingsRate: null, savingsRateNote: NO_REGULAR_INCOME };
  const rate = (netSavings / income) * 100;
  if (Math.abs(rate) > 100 && income < inflow * 0.25) return { savingsRate: null, savingsRateNote: NO_REGULAR_INCOME };
  return { savingsRate: Math.round(rate * 10) / 10 };
}

/**
 * Headline numbers for one filtered set of transactions.
 *
 * - income/spending/invested/peopleIn come from `metricBucket` + `signedContribution`.
 *   Spending is net of refunds; a linked refund reduces the original's category, an unlinked
 *   one appears as its own negative 'refunds' line in `byCategory`.
 * - `peopleOut` is the p2p_out part OF spending; `peopleIn` is separate and is NOT income.
 * - `neutral.*` is the amount that moved (the larger of the debit-side and credit-side totals,
 *   so a transfer with both legs in view is counted once).
 * - `cashFlow` covers non-credit-card accounts only and excludes self_transfer and reversal
 *   legs. Credit-card bill payments from the bank ARE real cash outflow (the money did leave
 *   the bank account) so they are included here, even though they are neutral for `spending`
 *   (the purchases were already counted on the card). cashFlow therefore differs from
 *   income - spending by design.
 * - `savingsRate` is null (with a note) unless income coverage is 'full' and income > 0.
 *
 * `ctx.today` (optional) caps the coverage window so future days of the current month are not
 * reported as missing.
 */
export function summarize(txns: readonly Transaction[], ctx: SummaryContext): LedgerSummary {
  const totals = bucketTotals(txns);
  const netSavings = totals.income - totals.spending;

  const catOf = categoryResolver(txns);
  const byCat = new Map<string, { amount: Paise; count: number }>();
  const acctType = new Map(ctx.accounts.map((a) => [a.id, a.type]));
  const moved = {
    self: { d: 0, c: 0 },
    card: { d: 0, c: 0 },
    rev: { d: 0, c: 0 },
    loan: 0,
  };
  let inflow = 0;
  let outflow = 0;
  let needsReview = 0;
  let debits = 0;
  let credits = 0;

  for (const t of txns) {
    if (t.needsReview) needsReview++;
    if (t.direction === 'debit') debits++;
    else credits++;

    if (isSpending(t)) {
      const key = catOf(t);
      const cur = byCat.get(key) ?? { amount: 0, count: 0 };
      cur.amount += contribution(t);
      cur.count++;
      byCat.set(key, cur);
    }

    const side = t.direction === 'debit' ? 'd' : 'c';
    if (t.kind === 'self_transfer') moved.self[side] += t.amount;
    else if (t.kind === 'card_payment') moved.card[side] += t.amount;
    else if (t.kind === 'reversal') moved.rev[side] += t.amount;
    else if (t.kind === 'loan_disbursal' && t.direction === 'credit') moved.loan += t.amount;

    if (acctType.get(t.accountId) !== 'credit_card' && t.kind !== 'self_transfer' && t.kind !== 'reversal') {
      if (t.direction === 'credit') inflow += t.amount;
      else outflow += t.amount;
    }
  }

  const people = byCat.get(UNCLASSIFIED_OUT);
  if (people) {
    people.amount += totals.peopleNetOut - totals.peopleUnclassifiedOut;
    if (people.amount === 0) byCat.delete(UNCLASSIFIED_OUT);
  }

  const share = (amount: number): number => (totals.spending > 0 ? amount / totals.spending : 0);
  const byCategory: CategoryTotal[] = [...byCat.entries()]
    .map(([category, v]) => ({
      category,
      group: categoryById(category, ctx.customCategories).group,
      amount: v.amount,
      count: v.count,
      share: share(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));

  const groups = new Map<CategoryGroup, number>();
  for (const c of byCategory) groups.set(c.group, (groups.get(c.group) ?? 0) + c.amount);
  const byGroup = [...groups.entries()]
    .map(([group, amount]) => ({ group, amount, share: share(amount) }))
    .sort((a, b) => b.amount - a.amount || a.group.localeCompare(b.group));

  const capped = ctx.today && ctx.today >= ctx.start ? minDate(ctx.end, ctx.today) : ctx.end;
  const coverage = computeCoverage(ctx.accounts, ctx.statements, ctx.start, capped, txns);
  const rate = savingsRateFor(totals.income, totals.spending, netSavings, inflow, coverage, ctx.accounts);

  return {
    start: ctx.start,
    end: ctx.end,
    income: totals.income,
    spending: totals.spending,
    consumption: totals.rawSpending - totals.peopleOut,
    peopleNetOut: totals.peopleNetOut,
    peopleUnclassifiedOut: totals.peopleUnclassifiedOut,
    peopleUnclassifiedIn: totals.peopleUnclassifiedIn,
    refunds: totals.refunds,
    invested: totals.invested,
    netSavings,
    savingsRate: rate.savingsRate,
    ...(rate.savingsRateNote ? { savingsRateNote: rate.savingsRateNote } : {}),
    peopleIn: totals.peopleIn,
    peopleOut: totals.peopleOut,
    neutral: {
      selfTransfers: Math.max(moved.self.d, moved.self.c),
      cardPayments: Math.max(moved.card.d, moved.card.c),
      reversals: Math.max(moved.rev.d, moved.rev.c),
      loanReceived: moved.loan,
    },
    cashFlow: { inflow, outflow, net: inflow - outflow },
    byCategory,
    byGroup,
    counts: { total: txns.length, needsReview, debits, credits },
    coverage,
  };
}

/** One point per requested month; `complete` = every active account's statements cover the whole month. */
export function monthlySeries(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; statements: readonly Statement[]; months: MonthKey[] },
): MonthlyPoint[] {
  const byMonth = new Map<MonthKey, Transaction[]>();
  for (const t of txns) {
    const m = t.date.slice(0, 7);
    const list = byMonth.get(m);
    if (list) list.push(t);
    else byMonth.set(m, [t]);
  }
  return ctx.months.map((month) => {
    const b = bucketTotals(byMonth.get(month) ?? []);
    const cov = computeCoverage(ctx.accounts, ctx.statements, monthStart(month), monthEnd(month), txns);
    return {
      month,
      income: b.income,
      spending: b.spending,
      invested: b.invested,
      netSavings: b.income - b.spending,
      complete: cov.complete,
    };
  });
}

/** Daily spending (bucket 'spending', net) for every day in [start,end], zeros included. */
export function dailySpending(txns: readonly Transaction[], start: IsoDate, end: IsoDate): { date: IsoDate; amount: Paise }[] {
  if (end < start) return [];
  const byDate = new Map<IsoDate, number>();
  for (const t of txns) {
    if (t.date < start || t.date > end || !isSpending(t)) continue;
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + contribution(t));
  }
  const days = daysBetween(start, end);
  const out: { date: IsoDate; amount: Paise }[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i);
    out.push({ date, amount: byDate.get(date) ?? 0 });
  }
  return out;
}

/**
 * Spending merchants ranked by net total (refunds subtract). Merchants netting to zero or
 * less are omitted. `count` and `average` are per purchase (debit).
 */
export function merchantBreakdown(txns: readonly Transaction[], limit?: number): MerchantStat[] {
  const catOf = categoryResolver(txns);
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (!isSpending(t)) continue;
    const key = t.merchantKey || t.counterparty.vpa || t.merchant;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const stats: MerchantStat[] = [];
  for (const [merchantKey, list] of groups) {
    const total = list.reduce((s, t) => s + contribution(t), 0);
    if (total <= 0) continue;
    const debits = list.filter((t) => t.direction === 'debit');
    const count = debits.length || list.length;
    const biggest = (debits.length ? debits : list).reduce((a, b) => (b.amount > a.amount ? b : a));
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    stats.push({
      merchantKey,
      merchant: latest.merchant || biggest.merchant,
      category: catOf(biggest),
      count,
      total,
      average: Math.round(total / count),
      lastDate: latest.date,
      txnIds: list.map((t) => t.id),
    });
  }
  stats.sort((a, b) => b.total - a.total || a.merchantKey.localeCompare(b.merchantKey));
  return limit !== undefined ? stats.slice(0, limit) : stats;
}
