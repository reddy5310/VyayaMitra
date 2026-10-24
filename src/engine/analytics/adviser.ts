import type {
  Account,
  AdviserPreference,
  Budget,
  CardPolicy,
  CategoryPreference,
  ChargeLink,
  InsightFeedback,
  IsoDate,
  MonthKey,
  Paise,
  RefundAllocation,
  RefundCase,
  SavingAction,
  Statement,
  Transaction,
} from '@/domain/types';
import { categoryName } from '@/domain/categories';
import { monthEnd, monthKey, monthStart } from '@/lib/dates';
import { computeCoverage } from './coverage';
import { chargeTypeLabel, feesSummary } from './fees';
import type { ActionOutcome, ActionTotals, FeesSummary, InsightText, MoneyBack, Recommendation } from './index';
import { moneyBack } from './moneyBack';
import { detectRecurring, isSeriesActive } from './recurring';
import { categoryResolver, contribution, hashId, isSpending, mk, partsOf, renderMarked } from './util';

// ─── actionTotals ────────────────────────────────────────────────────────────

/**
 * Splits what saving actions achieved into separate figures, never one "You saved".
 * Purchase actions (category limits, recurring reviews) are measured ONCE over the union of overlapping
 * scopes: two actions overlap when they share a category or a merchant, and each overlap group counts its
 * broadest member (largest baseline) once. Observed is the net change vs the baseline, so a month that went
 * the wrong way pulls the total down (it can be negative). Goal contributions, refunds received and fees
 * reversed are reported on their own.
 */
export function actionTotals(
  outcomes: readonly ActionOutcome[],
  ctx: { actions: readonly SavingAction[]; moneyBack?: MoneyBack; fees?: FeesSummary },
): ActionTotals {
  const purchase = outcomes.filter((o) => o.action.type !== 'goal_contribution');
  const goals = outcomes.filter((o) => o.action.type === 'goal_contribution');

  // union-find over overlapping scopes
  const parent = purchase.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byCat = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  purchase.forEach((o, i) => {
    for (const [map, key] of [[byCat, o.action.category], [byMerchant, o.action.merchantKey]] as const) {
      if (!key) continue;
      const seen = map.get(key);
      if (seen === undefined) map.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  const groups = new Map<number, ActionOutcome[]>();
  purchase.forEach((o, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i)))?.push(o));

  let planned = 0;
  let observed: number | null = null;
  const overlapping: string[][] = [];
  for (const members of groups.values()) {
    const broadest = members.reduce((a, b) => (b.action.baselineMonthly > a.action.baselineMonthly ? b : a));
    planned += Math.max(0, broadest.action.baselineMonthly - broadest.action.targetMonthly);
    if (broadest.achievedMonthlySaving !== null) observed = (observed ?? 0) + broadest.achievedMonthlySaving;
    if (members.length > 1) overlapping.push(members.map((m) => m.action.id));
  }

  const goalPlanned = goals.reduce((s, o) => s + Math.max(0, o.action.targetMonthly - o.action.baselineMonthly), 0);
  const goalObserved = goals.some((o) => o.achievedMonthlySaving !== null)
    ? goals.reduce((s, o) => s + (o.achievedMonthlySaving ?? 0), 0)
    : null;

  return {
    purchaseReduction: { planned, observed, overlappingActionIds: overlapping },
    goalContributions: { planned: goalPlanned, observed: goalObserved },
    refundsReceived: ctx.moneyBack?.totals.receivedInPeriod ?? 0,
    feesReversed: ctx.fees?.totals.reversed ?? 0,
    definition:
      'Purchase reduction compares your monthly spending in fully covered months with the starting point you chose, counting overlapping actions once; a negative figure means spending went up. Goal contributions, refunds received and fees reversed are separate and are not added to it.',
  };
}

// ─── recommendations ─────────────────────────────────────────────────────────

const DEFAULT_ASK = new Set(['healthcare', 'education', 'family_support']);
const DEFAULT_FIXED = new Set(['loan_emi', 'rent_housing', 'insurance']);
const MIN_CATEGORY_MONTHLY: Paise = 200_000;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const text = (s: string): InsightText => partsOf(s);

export interface RecommendationContext {
  accounts: readonly Account[];
  statements: readonly Statement[];
  budgets: readonly Budget[];
  actions: readonly SavingAction[];
  preferences: readonly AdviserPreference[];
  feedback: readonly InsightFeedback[];
  cases: readonly RefundCase[];
  allocations: readonly RefundAllocation[];
  chargeLinks: readonly ChargeLink[];
  policies: readonly CardPolicy[];
  today: IsoDate;
  limit?: number;
}

/**
 * About three explainable, preference-aware suggestions. Each candidate gets factors (effect, evidence,
 * urgency, effort; all 0..1) and the list is ranked by 0.4 effect + 0.25 evidence + 0.25 urgency + 0.1 effort.
 * Protected categories are never cut; essential ones (and health, education, family support by default) get
 * an 'ask_context' question first; fixed ones (and rent, EMIs, insurance by default) only get a recurring
 * review. Keys the user dismissed or marked irrelevant are skipped. Everything is a scenario, never "saved".
 * Work is one pass over the last three complete months plus one pass for recurring payments.
 */
export function recommendations(
  txns: readonly Transaction[],
  ctx: RecommendationContext,
): Recommendation[] {
  const { today } = ctx;
  const skip = new Set(ctx.feedback.filter((f) => f.action === 'dismissed' || f.action === 'irrelevant').map((f) => f.key));
  const prefs = new Map<string, CategoryPreference>(ctx.preferences.map((p: AdviserPreference) => [p.category, p.preference]));
  const out: Recommendation[] = [];
  const push = (r: Omit<Recommendation, 'id'>): void => {
    if (!skip.has(r.key)) out.push({ ...r, id: `rec-${hashId(r.key, today.slice(0, 7))}` });
  };

  // 1. Money back that is overdue
  const mb = moneyBack(txns, { cases: ctx.cases, allocations: ctx.allocations, today });
  for (const c of mb.cases) {
    if (!c.overdue) continue;
    const owed = c.outstanding ?? c.purchaseTotal;
    push({
      key: `chase_refund:${c.case.merchantKey}`,
      kind: 'chase_refund',
      title: `Follow up on money back from ${c.case.merchant}`,
      happened: text(`You expected money back from ${c.case.merchant}${c.outstanding !== undefined ? `, ${mk(c.outstanding)} is still outstanding` : ' and the amount is not confirmed'}; it has been open for ${c.ageDays} days.`),
      evidence: { txnIds: c.purchases.map((p) => p.txnId), basis: 'From the money-back case you created and the credits matched to it.' },
      change: text('Contact the merchant or your card issuer with the purchase details and ask for a status.'),
      ...(c.outstanding !== undefined ? { estimatedEffect: c.outstanding } : {}),
      assumptions: ['The merchant has agreed to pay this amount.'],
      check: 'When the credit arrives in a statement, match it to this case.',
      merchantKey: c.case.merchantKey,
      factors: { effect: clamp01(owed / 500_000), evidence: 0.9, urgency: 1, effort: 0.5 },
    });
  }

  // 2. Fees worth avoiding
  const fees = feesSummary(txns, { links: ctx.chargeLinks, policies: ctx.policies, accounts: ctx.accounts });
  for (const r of fees.recurring) {
    if (r.chargeType !== 'late_payment_fee' && r.chargeType !== 'finance_charge' && r.chargeType !== 'overlimit_fee') continue;
    const label = chargeTypeLabel(r.chargeType);
    const monthly = Math.round(r.total / r.months);
    push({
      key: `avoid_fee:${r.chargeType}`,
      kind: 'avoid_fee',
      title: `Avoid repeat ${label.toLowerCase()}s`,
      happened: text(`${label} showed up in ${r.months} of the last 3 months, about ${mk(monthly)} a month.`),
      evidence: { txnIds: fees.events.filter((e) => e.chargeType === r.chargeType).flatMap((e) => e.txnIds).slice(-6), basis: 'Charges linked as fees on your statements.' },
      change: text('Set a reminder a few days before the due date, or an auto-pay for at least the minimum due.'),
      estimatedEffect: monthly,
      assumptions: ['The bill is paid on time from now on.'],
      check: 'Check next month\'s statement for the same charge.',
      factors: { effect: clamp01(monthly / 200_000), evidence: clamp01(r.months / 3), urgency: 0.7, effort: 0.8 },
    });
  }
  for (const e of fees.events) {
    if (e.status === 'reversed' || e.eligibility.state !== 'likely') continue;
    push({
      key: `avoid_fee:${e.chargeType}:${e.groupId}`,
      kind: 'avoid_fee',
      title: `Ask about reversing a ${chargeTypeLabel(e.chargeType).toLowerCase()}`,
      happened: text(`A ${chargeTypeLabel(e.chargeType).toLowerCase()} of ${mk(e.net)} was not reversed. ${e.eligibility.note}`),
      evidence: { txnIds: e.txnIds, basis: 'A card policy you recorded matches this charge.' },
      change: text("Check your card's terms and ask the issuer to reverse it if it applies."),
      estimatedEffect: e.net,
      assumptions: ['Your recorded card terms are current and apply to this purchase.'],
      check: 'Look for a reversal credit on a following statement.',
      factors: { effect: clamp01(e.net / 100_000), evidence: 0.7, urgency: 0.6, effort: 0.7 },
    });
  }

  // 3. Spending: last three complete months, one pass
  const byMonth = new Map<MonthKey, Transaction[]>();
  for (const t of txns) (byMonth.get(monthKey(t.date)) ?? byMonth.set(monthKey(t.date), []).get(monthKey(t.date)))?.push(t);
  const months = [...byMonth.keys()].sort().filter((m) => monthEnd(m) <= today);
  const complete: MonthKey[] = [];
  for (let i = months.length - 1; i >= 0 && complete.length < 3; i--) {
    if (computeCoverage(ctx.accounts, ctx.statements, monthStart(months[i]), monthEnd(months[i]), txns).complete) complete.unshift(months[i]);
  }
  if (complete.length > 0) {
    const used = complete.length;
    const rows = complete.flatMap((m) => byMonth.get(m) ?? []).filter((t) => !t.tag);
    const catOf = categoryResolver(txns);
    const cats = new Map<string, { total: Paise; merchants: Map<string, { merchant: string; n: number; total: Paise; ids: string[] }> }>();
    for (const t of rows) {
      if (!isSpending(t)) continue;
      const c = catOf(t);
      const entry = cats.get(c) ?? { total: 0, merchants: new Map() };
      entry.total += contribution(t);
      if (t.direction === 'debit') {
        const key = t.merchantKey || t.merchant;
        const m = entry.merchants.get(key) ?? { merchant: t.merchant, n: 0, total: 0, ids: [] };
        m.n++;
        m.total += t.amount;
        m.ids.push(t.id);
        entry.merchants.set(key, m);
      }
      cats.set(c, entry);
    }
    const ranked = [...cats.entries()].filter(([c, v]) => c !== 'uncategorized' && c !== 'refunds' && v.total / used >= MIN_CATEGORY_MONTHLY).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
    let series: ReturnType<typeof detectRecurring> | undefined;
    const basis = `Based on ${used} fully covered month${used === 1 ? '' : 's'}.`;
    for (const [category, v] of ranked) {
      const avg = Math.round(v.total / used);
      const name = categoryName(category);
      const explicit = prefs.get(category);
      const pref: CategoryPreference = explicit ?? (DEFAULT_ASK.has(category) ? 'essential' : DEFAULT_FIXED.has(category) ? 'fixed' : 'adjustable');
      if (pref === 'protected') continue;
      const evidenceFactor = clamp01(used / 3);
      const top = [...v.merchants.entries()].sort((a, b) => b[1].total - a[1].total)[0];
      const ids = (top?.[1].ids ?? []).slice(-10);
      if (pref === 'essential') {
        push({
          key: `ask_context:${category}`,
          kind: 'ask_context',
          title: `Tell us what is normal for ${name}`,
          happened: text(`You spend about ${mk(avg)} a month on ${name}.`),
          evidence: { txnIds: ids, basis },
          change: text('Before suggesting any change, tell us whether this is expected, so we do not suggest cutting something you need.'),
          assumptions: [],
          check: 'Mark it as expected or protected in your preferences.',
          category,
          factors: { effect: clamp01(avg / 2_000_000), evidence: evidenceFactor, urgency: 0.2, effort: 0.9 },
        });
      } else if (pref === 'fixed') {
        series ??= detectRecurring(txns, [], today).filter((s) => isSeriesActive(s, today));
        const s = series.find((x) => x.category === category && x.status !== 'dismissed');
        if (!s) continue;
        push({
          key: `review_recurring:${s.merchantKey}`,
          kind: 'review_recurring',
          title: `Review the ${s.merchant} payment`,
          happened: text(`${s.merchant} looks like a ${s.cadence} payment of about ${mk(s.typicalAmount)}, roughly ${mk(s.monthlyCost)} a month.`),
          evidence: { txnIds: s.txnIds.slice(-6), basis: `${s.occurrences} payments at a regular interval.` },
          change: text('Check whether the plan or amount still fits what you use.'),
          estimatedEffect: s.monthlyCost,
          assumptions: ['The commitment can be changed or renegotiated.'],
          check: 'See the next statement for the new amount.',
          category,
          merchantKey: s.merchantKey,
          factors: { effect: clamp01(s.monthlyCost / 1_000_000), evidence: clamp01(s.confidence), urgency: 0.3, effort: 0.4 },
        });
      } else if (top && top[1].n / used >= 4 && !skip.has(`reduce_frequency:${top[0]}`)) {
        const [key, m] = top;
        const avgOrder = Math.round(m.total / m.n);
        const effect = avgOrder * 2;
        push({
          key: `reduce_frequency:${key}`,
          kind: 'reduce_frequency',
          title: `Try two fewer ${m.merchant} orders next month`,
          happened: text(`You made about ${Math.round(m.n / used)} ${m.merchant} orders a month, around ${mk(avgOrder)} each, ${mk(Math.round(m.total / used))} a month in ${name}.`),
          evidence: { txnIds: m.ids.slice(-10), basis },
          change: text(`Two fewer orders is about ${mk(effect)} less, before any replacement costs.`),
          estimatedEffect: effect,
          assumptions: ['Orders are about the usual size.', 'Replacement purchases (for example other food) are not counted.'],
          check: `Compare ${m.merchant} orders in the next complete month with this average.`,
          category,
          merchantKey: key,
          suggestedTarget: Math.max(0, Math.round(v.total / used) - effect),
          factors: { effect: clamp01(effect / 300_000), evidence: evidenceFactor, urgency: 0.3, effort: 0.6 },
        });
      } else {
        const target = Math.round((avg * 0.9) / 10_000) * 10_000;
        push({
          key: `set_limit:${category}`,
          kind: 'set_limit',
          title: `Set a ${name} limit`,
          happened: text(`${name} averaged ${mk(avg)} a month.`),
          evidence: { txnIds: ids, basis },
          change: text(`A limit of ${mk(target)} a month would be ${mk(avg - target)} below your average, as a scenario to try.`),
          estimatedEffect: avg - target,
          assumptions: ['Spending follows the limit you set.'],
          check: 'Compare the next complete month with the limit.',
          category,
          suggestedTarget: target,
          factors: { effect: clamp01((avg - target) / 300_000), evidence: evidenceFactor, urgency: 0.3, effort: 0.7 },
        });
      }
    }
  }

  const score = (r: Omit<Recommendation, 'id'>): number => 0.4 * r.factors.effect + 0.25 * r.factors.evidence + 0.25 * r.factors.urgency + 0.1 * r.factors.effort;
  out.sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
  const seen = new Set<string>();
  const picked: Recommendation[] = [];
  for (const r of out) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    picked.push(r);
    if (picked.length >= (ctx.limit ?? 3)) break;
  }
  // The titles/changes are plain text; render marked amounts in any string fields too.
  return picked.map((r) => ({ ...r, title: renderMarked(r.title), check: renderMarked(r.check), assumptions: r.assumptions.map(renderMarked) }));
}
