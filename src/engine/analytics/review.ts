/** Wave 5: guided-review analytics (data status, plan, cumulative, comparison, calendar, pareto, flow, grid, card cycles). */
import type { Account, Budget, IsoDate, MonthKey, Paise, Statement, Transaction } from '@/domain/types';
import { BUDGETABLE_GROUPS, CATEGORY_GROUP_LABELS, categoryById, categoryName } from '@/domain/categories';
import { metricBucket } from '@/domain/kinds';
import { addDays, addMonths, daysBetween, daysInMonth, formatMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';
import { computeCoverage } from './coverage';
import type {
  CardCycle,
  CoverageCell,
  CumulativePoint,
  CumulativeSeries,
  DataStatus,
  FlowLink,
  FlowNode,
  HeatDay,
  ParetoRow,
  SpendingComparison,
  WaterfallStep,
} from './index';
import { applyQuery } from './query';
import { bucketTotals, merchantBreakdown } from './summary';
import { categoryResolver, contribution, formatRange, isSpending, isUnclassifiedIn, isUnclassifiedOut, isWholeMonth, peopleNetOut, sum, UNCLASSIFIED_OUT } from './util';

const BANK_TYPES: ReadonlySet<Account['type']> = new Set(['savings', 'current', 'wallet']);

function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** Earliest date any active, statement-backed account is tracked from. */
function trackedFrom(accounts: readonly Account[], statements: readonly Statement[], txns: readonly Transaction[]): IsoDate | null {
  const ids = new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  let min: IsoDate | null = null;
  for (const s of statements) {
    if (!ids.has(s.accountId)) continue;
    let d = s.periodStart ?? s.periodEnd;
    if (!d) for (const t of txns) if (t.statementId === s.id && (!d || t.date < d)) d = t.date;
    if (d && (min === null || d < min)) min = d;
  }
  return min;
}

/** Is a day inside statement coverage? False for every day when nothing is tracked, and before tracking began. */
function coveredPredicate(
  accounts: readonly Account[],
  statements: readonly Statement[],
  start: IsoDate,
  end: IsoDate,
  txns: readonly Transaction[],
): (d: IsoDate) => boolean {
  const cov = computeCoverage(accounts, statements, start, end, txns);
  const from = trackedFrom(accounts, statements, txns);
  if (cov.accounts.length === 0 || from === null) return () => false;
  const gaps = cov.accounts.flatMap((a) => a.gaps);
  return (d) => d >= from && !gaps.some((g) => d >= g.start && d <= g.end);
}

// ─── dataStatus ──────────────────────────────────────────────────────────────

/** Rows flagged for review whose reasons talk about balances, ambiguous amounts or inferred direction. */
const EXTRACTION_RE = /balance|ambiguous|direction|amount/i;

/**
 * extractionIssues = rows with needsReview whose reviewReasons mention a balance break, an ambiguous
 * amount or a direction inferred from balance (matched by /balance|ambiguous|direction|amount/).
 * completeMonths = finished months, from the first tracked statement, covered for every tracked account.
 */
export function dataStatus(accounts: readonly Account[], statements: readonly Statement[], txns: readonly Transaction[], today: IsoDate): DataStatus {
  const active = accounts.filter((a) => !a.archived);
  const withStatements = active.filter((a) => statements.some((s) => s.accountId === a.id));
  const ends = statements.map((s) => s.periodEnd).filter((d): d is IsoDate => !!d);
  let dataThrough: IsoDate | null = ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
  if (dataThrough === null) for (const t of txns) if (dataThrough === null || t.date > dataThrough) dataThrough = t.date;

  const hasBank = withStatements.some((a) => BANK_TYPES.has(a.type));
  const hasCard = withStatements.some((a) => a.type === 'credit_card');
  const evidence: DataStatus['evidence'] = hasBank && hasCard ? 'bank_and_card' : hasBank ? 'bank_only' : hasCard ? 'cards_only' : 'none';

  const completeMonths: MonthKey[] = [];
  const from = trackedFrom(accounts, statements, txns);
  if (from) {
    for (let m = monthKey(from); m <= monthKey(today); m = addMonths(m, 1)) {
      if (monthEnd(m) > today) break;
      if (computeCoverage(accounts, statements, monthStart(m), monthEnd(m), txns).complete) completeMonths.push(m);
    }
  }
  return {
    dataThrough,
    accountCount: active.length,
    statementCount: statements.length,
    needsReview: txns.filter((t) => t.needsReview).length,
    extractionIssues: txns.filter((t) => t.needsReview && t.reviewReasons.some((r) => EXTRACTION_RE.test(r))).length,
    evidence,
    completeMonths,
    latestCompleteMonth: completeMonths.length ? completeMonths[completeMonths.length - 1] : null,
  };
}

// ─── spendingPlan ────────────────────────────────────────────────────────────

export function spendingPlan(budgets: readonly Budget[]): { monthlyLimit: Paise; categories: string[] } | null {
  const used = budgets.filter((b) => BUDGETABLE_GROUPS.has(categoryById(b.category).group) && b.monthlyLimit > 0);
  if (used.length === 0) return null;
  return { monthlyLimit: sum(used.map((b) => b.monthlyLimit)), categories: used.map((b) => b.category) };
}

// ─── cumulativeSpending ──────────────────────────────────────────────────────

/**
 * Running total of spending (people flows netted cumulatively, so the last point equals the summary's
 * spending). `actual` is null on uncovered days and on days after `today`. The plan line paces each calendar
 * month evenly. A projection (average daily pace x remaining days) is added only for the current month with
 * at least 10 covered days and 5 spending transactions, and only after the last covered day.
 */
export function cumulativeSpending(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; statements: readonly Statement[]; start: IsoDate; end: IsoDate; today: IsoDate; planMonthly?: Paise },
): CumulativeSeries {
  const { start, end, today } = ctx;
  const inRange = applyQuery(txns, { start, end });
  const covered = coveredPredicate(ctx.accounts, ctx.statements, start, end, txns);
  const byDay = new Map<IsoDate, { other: number; out: number; inn: number }>();
  for (const t of inRange) {
    const d = byDay.get(t.date) ?? { other: 0, out: 0, inn: 0 };
    if (isUnclassifiedOut(t)) d.out += contribution(t);
    else if (isUnclassifiedIn(t)) d.inn += t.amount;
    else if (isSpending(t)) d.other += contribution(t);
    byDay.set(t.date, d);
  }
  const P = ctx.planMonthly;
  const paced = (day: number, month: MonthKey): number => Math.round(((P as number) * day) / daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))));
  const startM = monthKey(start);
  const base = P === undefined ? 0 : paced(Number(start.slice(8)) - 1, startM);
  const plan = (d: IsoDate): number | undefined => {
    if (P === undefined) return undefined;
    let total = paced(Number(d.slice(8)), monthKey(d)) - base;
    for (let k = startM; k < monthKey(d); k = addMonths(k, 1)) total += P;
    return total;
  };

  let other = 0;
  let out = 0;
  let inn = 0;
  const points: CumulativePoint[] = [];
  for (const date of eachDay(start, end)) {
    const d = byDay.get(date);
    if (d) {
      other += d.other;
      out += d.out;
      inn += d.inn;
    }
    const cum = other + Math.max(0, out - inn);
    const isCovered = covered(date) && date <= today;
    const p = plan(date);
    points.push({ date, actual: isCovered ? cum : null, covered: isCovered, ...(p !== undefined ? { plan: p } : {}) });
  }
  const total = other + Math.max(0, out - inn);
  const coveredPts = points.filter((p) => p.covered);
  const last = coveredPts.length ? coveredPts[coveredPts.length - 1] : undefined;

  const result: CumulativeSeries = {
    points,
    total,
    dataThrough: last ? last.date : null,
    ...(plan(end) !== undefined ? { planTotal: plan(end) } : {}),
  };

  const isCurrentMonth = monthKey(start) === monthKey(end) && monthKey(start) === monthKey(today) && start === monthStart(monthKey(start));
  const spendTxns = inRange.filter((t) => isSpending(t) && t.direction === 'debit').length;
  if (!isCurrentMonth) result.projectionNote = 'A projection is only shown for the current calendar month.';
  else if (coveredPts.length < 10) result.projectionNote = `Only ${coveredPts.length} day${coveredPts.length === 1 ? '' : 's'} of this month ${coveredPts.length === 1 ? 'is' : 'are'} covered by statements so far; a projection needs at least 10.`;
  else if (spendTxns < 5) result.projectionNote = `Only ${spendTxns} spending transaction${spendTxns === 1 ? '' : 's'} so far; a projection needs at least 5.`;
  else if (last) {
    const avg = (last.actual as number) / coveredPts.length;
    for (const p of points) if (p.date > last.date) p.projected = Math.round((last.actual as number) + avg * daysBetween(last.date, p.date));
    result.projectedTotal = points[points.length - 1].projected ?? last.actual ?? 0;
    result.projectionNote = `Projection assumes the average pace of the ${coveredPts.length} covered days continues; it is an estimate, not recorded spending.`;
  }
  return result;
}

// ─── compareSpending ─────────────────────────────────────────────────────────

function periodLabel(start: IsoDate, end: IsoDate): string {
  if (isWholeMonth(start, end)) return formatMonth(monthKey(start));
  if (start === monthStart(monthKey(start)) && end === monthEnd(monthKey(end))) return `${formatMonth(monthKey(start))} – ${formatMonth(monthKey(end))}`;
  return formatRange(start, end);
}

/** Net spending per category (linked refunds reduce the original; unclassified people flows netted). */
function categoryNet(range: readonly Transaction[], catOf: (t: Transaction) => string): Map<string, { amount: Paise; ids: string[] }> {
  const m = new Map<string, { amount: Paise; ids: string[] }>();
  for (const t of range) {
    if (!isSpending(t)) continue;
    const c = catOf(t);
    const cur = m.get(c) ?? { amount: 0, ids: [] };
    cur.amount += contribution(t);
    cur.ids.push(t.id);
    m.set(c, cur);
  }
  const people = m.get(UNCLASSIFIED_OUT);
  if (people) {
    const f = peopleNetOut(range);
    people.amount += f.netOut - f.out;
    for (const t of range) if (isUnclassifiedIn(t)) people.ids.push(t.id);
    if (people.amount === 0) m.delete(UNCLASSIFIED_OUT);
  }
  return m;
}

export function compareSpending(
  txns: readonly Transaction[],
  ctx: {
    accounts: readonly Account[];
    statements: readonly Statement[];
    current: { start: IsoDate; end: IsoDate };
    previous?: { start: IsoDate; end: IsoDate };
    today: IsoDate;
    maxSteps?: number;
  },
): SpendingComparison {
  const cur = ctx.current;
  let prev = ctx.previous;
  if (!prev) {
    const wholeMonths = cur.start === monthStart(monthKey(cur.start)) && cur.end === monthEnd(monthKey(cur.end));
    if (wholeMonths) {
      const idx = (m: MonthKey): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
      const k = idx(monthKey(cur.end)) - idx(monthKey(cur.start)) + 1;
      const pm = addMonths(monthKey(cur.start), -k);
      prev = { start: monthStart(pm), end: monthEnd(addMonths(pm, k - 1)) };
    } else {
      const len = daysBetween(cur.start, cur.end) + 1;
      prev = { start: addDays(cur.start, -len), end: addDays(cur.start, -1) };
    }
  }
  const catOf = categoryResolver(txns);
  const curTx = applyQuery(txns, cur);
  const prevTx = applyQuery(txns, prev);
  const curCat = categoryNet(curTx, catOf);
  const prevCat = categoryNet(prevTx, catOf);
  const cats = new Set([...curCat.keys(), ...prevCat.keys()]);
  const all: WaterfallStep[] = [...cats]
    .map((category) => ({
      key: category,
      label: categoryName(category),
      category,
      delta: (curCat.get(category)?.amount ?? 0) - (prevCat.get(category)?.amount ?? 0),
      txnIdsCurrent: curCat.get(category)?.ids ?? [],
      txnIdsPrevious: prevCat.get(category)?.ids ?? [],
    }))
    .filter((s) => s.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
  const max = ctx.maxSteps ?? 5;
  const steps = all.slice(0, max);
  const other = sum(all.slice(max).map((s) => s.delta));

  const covC = computeCoverage(ctx.accounts, ctx.statements, cur.start, cur.end, txns);
  const covP = computeCoverage(ctx.accounts, ctx.statements, prev.start, prev.end, txns);
  const curLabel = periodLabel(cur.start, cur.end);
  const prevLabel = periodLabel(prev.start, prev.end);
  const comparable = covC.complete && covP.complete;
  const out: SpendingComparison = {
    current: { ...cur, label: curLabel, total: bucketTotals(curTx).spending },
    previous: { ...prev, label: prevLabel, total: bucketTotals(prevTx).spending },
    steps,
    other,
    comparable,
    basis: comparable
      ? `Comparing ${curLabel} with ${prevLabel} (both fully covered)`
      : `Comparing ${curLabel} with ${prevLabel} — these cannot be compared because statements are missing for part of ${!covC.complete && !covP.complete ? 'both periods' : !covC.complete ? curLabel : prevLabel}`,
  };
  if (!comparable) out.note = `Not comparable: ${[...(covC.complete ? [] : covC.notes.slice(0, 1)), ...(covP.complete ? [] : covP.notes.slice(0, 1))].join('. ')}. The figures show what was recorded, not a real change.`;
  return out;
}

// ─── spendingCalendar / merchantPareto ───────────────────────────────────────

/** Daily net spending; unclassified people flows are left out (they are netted only over a whole period). */
export function spendingCalendar(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; statements: readonly Statement[]; start: IsoDate; end: IsoDate },
): HeatDay[] {
  const covered = coveredPredicate(ctx.accounts, ctx.statements, ctx.start, ctx.end, txns);
  const byDay = new Map<IsoDate, { amount: number; count: number }>();
  for (const t of applyQuery(txns, { start: ctx.start, end: ctx.end })) {
    if (!isSpending(t)) continue;
    const d = byDay.get(t.date) ?? { amount: 0, count: 0 };
    if (!isUnclassifiedOut(t)) d.amount += contribution(t);
    d.count++;
    byDay.set(t.date, d);
  }
  return eachDay(ctx.start, ctx.end).map((date) => ({ date, amount: byDay.get(date)?.amount ?? 0, count: byDay.get(date)?.count ?? 0, covered: covered(date) }));
}

export function merchantPareto(txns: readonly Transaction[], limit?: number): { rows: ParetoRow[]; total: Paise; merchantsFor80: number } {
  const all = merchantBreakdown(txns);
  const total = sum(all.map((m) => m.total));
  let run = 0;
  let for80 = 0;
  const ranked = all.map((m, i) => {
    run += m.total;
    if (for80 === 0 && total > 0 && run / total >= 0.8) for80 = i + 1;
    return { ...m, cumulativeShare: total > 0 ? run / total : 0 };
  });
  return { rows: limit !== undefined ? ranked.slice(0, limit) : ranked, total, merchantsFor80: for80 };
}

// ─── moneyFlow ───────────────────────────────────────────────────────────────

const FLOW_NOTE =
  'Flows are aggregates for the period. They show where money went in total, not which rupee funded which purchase.';

export function moneyFlow(
  txns: readonly Transaction[],
  ctx: { accounts: readonly Account[]; start: IsoDate; end: IsoDate; view: 'spending' | 'transfers' },
): { nodes: FlowNode[]; links: FlowLink[]; note: string } {
  const range = applyQuery(txns, { start: ctx.start, end: ctx.end });
  const acctById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  const node = (id: string, label: string, kind: FlowNode['kind']): string => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind });
    return id;
  };
  const acctNode = (accountId: string): string => {
    const a = acctById.get(accountId);
    return node(`acct:${accountId}`, a?.name ?? 'Account', a?.type === 'credit_card' ? 'card' : 'account');
  };
  const link = (from: string, to: string, amount: Paise): void => {
    if (amount <= 0) return;
    const k = `${from}>${to}`;
    const cur = links.get(k);
    if (cur) cur.amount += amount;
    else links.set(k, { from, to, amount });
  };

  if (ctx.view === 'transfers') {
    const byId = new Map(range.map((t) => [t.id, t]));
    const unexplained = (): string => node('unexplained', 'Other / not imported', 'unexplained');
    for (const t of range) {
      if (t.kind !== 'self_transfer' && t.kind !== 'card_payment') continue;
      const mate = t.linkedTxnId ? byId.get(t.linkedTxnId) : undefined;
      if (t.direction === 'debit') {
        link(acctNode(t.accountId), mate ? acctNode(mate.accountId) : unexplained(), t.amount);
      } else if (!mate) {
        link(unexplained(), acctNode(t.accountId), t.amount);
      }
    }
    return { nodes: [...nodes.values()], links: [...links.values()], note: `${FLOW_NOTE} Card repayments appear here, never as spending.` };
  }

  const catOf = categoryResolver(txns);
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number): void => void m.set(k, (m.get(k) ?? 0) + v);
  const groupNet = new Map<string, number>(); // `${accountId}|${group}` -> net spending
  const unclassOutByAcct = new Map<string, number>();
  const invested = new Map<string, number>();
  for (const t of range) {
    const isCard = acctById.get(t.accountId)?.type === 'credit_card';
    const bucket = metricBucket(t.kind, t.direction);
    if (!isCard && t.direction === 'credit' && bucket === 'income') {
      link(node('income', 'Income', 'income'), acctNode(t.accountId), t.amount);
      bump(inflow, t.accountId, t.amount);
    } else if (!isCard && t.direction === 'credit' && t.kind === 'p2p_in') {
      link(node('people_in', 'Received from people', 'people_in'), acctNode(t.accountId), t.amount);
      bump(inflow, t.accountId, t.amount);
    } else if (bucket === 'invested' && !isCard) {
      bump(invested, t.accountId, contribution(t));
    } else if (isSpending(t)) {
      if (isUnclassifiedOut(t)) bump(unclassOutByAcct, t.accountId, contribution(t));
      else {
        const g = categoryById(catOf(t)).group;
        bump(groupNet, `${t.accountId}|${g}`, contribution(t));
      }
    }
  }
  for (const [key, amount] of groupNet) {
    const [accountId, group] = key.split('|');
    const gid = node(`group:${group}`, CATEGORY_GROUP_LABELS[group as keyof typeof CATEGORY_GROUP_LABELS] ?? group, 'spending_group');
    link(acctNode(accountId), gid, amount);
    if (acctById.get(accountId)?.type !== 'credit_card') bump(outflow, accountId, amount);
  }
  for (const [accountId, amount] of invested) {
    link(acctNode(accountId), node('saving', 'Saved & invested', 'saving'), amount);
    bump(outflow, accountId, amount);
  }
  // People flows: net out = max(0, unclassified out - unclassified in), shared by each account's gross out.
  const flows = peopleNetOut(range);
  const grossOut = sum(unclassOutByAcct.values());
  let left = flows.netOut;
  const entries = [...unclassOutByAcct.entries()];
  entries.forEach(([accountId, gross], i) => {
    const share = i === entries.length - 1 ? left : Math.round((flows.netOut * gross) / (grossOut || 1));
    left -= share;
    link(acctNode(accountId), node('people_out', 'Sent to people (net)', 'people_out'), share);
    if (acctById.get(accountId)?.type !== 'credit_card') bump(outflow, accountId, share);
  });
  for (const [accountId, out] of outflow) {
    const gap = out - (inflow.get(accountId) ?? 0);
    link(node('unexplained', 'Opening balance / other', 'unexplained'), acctNode(accountId), gap);
  }
  return { nodes: [...nodes.values()], links: [...links.values()], note: `${FLOW_NOTE} Card purchases flow from the card to their category; paying the card bill is shown only in the transfers view.` };
}

// ─── coverageGrid ────────────────────────────────────────────────────────────

export function coverageGrid(accounts: readonly Account[], statements: readonly Statement[], months: MonthKey[]): CoverageCell[] {
  const cells: CoverageCell[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    const own = statements.filter((s) => s.accountId === a.id);
    const starts = own.map((s) => s.periodStart ?? s.periodEnd).filter((d): d is IsoDate => !!d);
    const first = starts.length ? starts.reduce((x, y) => (y < x ? y : x)) : null;
    for (const month of months) {
      const ms = monthStart(month);
      const me = monthEnd(month);
      const totalDays = daysBetween(ms, me) + 1;
      const ids = own.filter((s) => (s.periodStart ?? s.periodEnd ?? '') <= me && (s.periodEnd ?? s.periodStart ?? '9999') >= ms).map((s) => s.id);
      if (first !== null && first > me) {
        cells.push({ accountId: a.id, month, state: 'before_tracking', coveredDays: 0, totalDays, statementIds: [] });
        continue;
      }
      const cov = computeCoverage([a], own, ms, me).accounts[0];
      const coveredDays = cov?.coveredDays ?? 0;
      const expected = cov?.totalDays ?? totalDays;
      cells.push({
        accountId: a.id,
        month,
        state: cov?.complete ? 'full' : coveredDays > 0 ? 'partial' : 'missing',
        coveredDays,
        totalDays: expected,
        statementIds: ids,
      });
    }
  }
  return cells;
}

// ─── cardCycles ──────────────────────────────────────────────────────────────

const INTEREST_RE = /interest|finance charge/i;

/**
 * One cycle per statement of a credit-card account. Figures come from the statement's own rows
 * (purchases = other debits, fees and interest = fee debits split by description, payments = card
 * payment credits). matchedRepayments are the bank legs linked to card-payment credits dated after
 * the statement date (and before the next statement's date). paymentStatus compares what was repaid
 * (card credits or matched bank legs) with totalDue; with no repayment seen it is 'unpaid' only when a
 * later statement exists, otherwise 'unknown'.
 */
export function cardCycles(account: Account, statements: readonly Statement[], txns: readonly Transaction[], _today: IsoDate): CardCycle[] {
  const own = statements
    .filter((s) => s.accountId === account.id)
    .sort((a, b) => (a.cardSummary?.statementDate ?? a.periodEnd ?? '').localeCompare(b.cardSummary?.statementDate ?? b.periodEnd ?? ''));
  const byId = new Map(txns.map((t) => [t.id, t]));
  const cut = (s: Statement): IsoDate | undefined => s.cardSummary?.statementDate ?? s.periodEnd;
  return own.map((s, i) => {
    const rows = txns.filter((t) => t.statementId === s.id);
    const next = own[i + 1];
    const c = cut(s);
    const nextCut = next ? cut(next) : undefined;
    let purchases = 0;
    let refunds = 0;
    let fees = 0;
    let interest = 0;
    let payments = 0;
    for (const t of rows) {
      if (t.kind === 'card_payment') {
        if (t.direction === 'credit') payments += t.amount;
      } else if (t.kind === 'fee' && t.direction === 'debit') {
        if (INTEREST_RE.test(`${t.merchant} ${t.rawDescription}`)) interest += t.amount;
        else fees += t.amount;
      } else if (t.kind === 'refund' && t.direction === 'credit') refunds += t.amount;
      else if (t.direction === 'debit' && t.kind !== 'self_transfer' && t.kind !== 'reversal') purchases += t.amount;
    }
    const after = txns.filter(
      (t) => t.accountId === account.id && t.kind === 'card_payment' && t.direction === 'credit' && c !== undefined && t.date > c && (nextCut === undefined || t.date <= nextCut),
    );
    const matchedRepayments = after.flatMap((t) => {
      const leg = t.linkedTxnId ? byId.get(t.linkedTxnId) : undefined;
      return leg ? [{ txnId: leg.id, amount: leg.amount, date: leg.date, fromAccountId: leg.accountId }] : [];
    });
    const repaid = Math.max(sum(after.map((t) => t.amount)), sum(matchedRepayments.map((m) => m.amount)));
    const totalDue = s.cardSummary?.totalDue;
    let paymentStatus: CardCycle['paymentStatus'] = 'unknown';
    if (totalDue !== undefined) {
      if (totalDue <= 0 || repaid >= totalDue) paymentStatus = 'paid';
      else if (repaid > 0) paymentStatus = 'partly_paid';
      else if (next) paymentStatus = 'unpaid';
    }
    return {
      statementId: s.id,
      ...(s.periodStart ? { periodStart: s.periodStart } : {}),
      ...(s.periodEnd ? { periodEnd: s.periodEnd } : {}),
      ...(s.cardSummary?.statementDate ? { statementDate: s.cardSummary.statementDate } : {}),
      ...(s.cardSummary?.dueDate ? { dueDate: s.cardSummary.dueDate } : {}),
      ...(totalDue !== undefined ? { totalDue } : {}),
      ...(s.cardSummary?.minimumDue !== undefined ? { minimumDue: s.cardSummary.minimumDue } : {}),
      ...(s.cardSummary?.previousBalance !== undefined ? { previousBalance: s.cardSummary.previousBalance } : {}),
      purchases,
      refunds,
      fees,
      interest,
      payments,
      matchedRepayments,
      paymentStatus,
      txnIds: rows.map((t) => t.id),
    };
  });
}
