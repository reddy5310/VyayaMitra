import type { Account, IsoDate, Paise, Statement, Transaction } from '@/domain/types';
import { categoryName } from '@/domain/categories';
import { formatMonth, monthKey } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import type { SpendingComparison } from './index';
import { applyQuery } from './query';
import { compareSpending } from './review';
import { categoryResolver, contribution, isSpending, median, isWholeMonth } from './util';

export interface MerchantChange {
  merchantKey: string;
  merchant: string;
  category: string;
  current: { count: number; total: Paise; average: Paise };
  previous: { count: number; total: Paise; average: Paise };
  /** current total - previous total (positive = spent more). */
  delta: Paise;
  /** (n1 - n0) x previous average: the part due to the number of orders. */
  frequencyEffect: Paise;
  /** The rest of the delta: the part due to order size (equals n1 x (avg1 - avg0)). */
  sizeEffect: Paise;
  driver: 'more_often' | 'less_often' | 'bigger_purchases' | 'smaller_purchases' | 'new' | 'stopped' | 'mixed';
  sentence: string;
  txnIdsCurrent: string[];
  txnIdsPrevious: string[];
}

export interface ChangeExplanation {
  comparison: SpendingComparison;
  merchants: MerchantChange[];
  headline: string;
  comparable: boolean;
  suggestedAction?: { category: string; suggestedTarget: Paise; label: string };
  /**
   * Drill-down figures behind the change. They describe the number of purchases, their average size, which
   * merchants appeared or disappeared, one-off purchases and refunds. They never imply that prices changed.
   */
  drivers?: {
    purchases: { current: number; previous: number };
    averageSize: { current: Paise; previous: Paise };
    merchantMix: { newMerchants: Paise; stoppedMerchants: Paise; newCount: number; stoppedCount: number };
    /** Tagged planned/exceptional, or single purchases of at least 3x the median purchase of their category. */
    oneOffs: { total: Paise; txnIds: string[] };
    refunds: { current: Paise; previous: Paise };
  };
}

const inr = (p: Paise): string => formatINR(Math.round(Math.abs(p)), { whole: true });

interface Agg {
  merchant: string;
  category: string;
  n: number;
  total: Paise;
  ids: string[];
}

function aggregate(range: readonly Transaction[], catOf: (t: Transaction) => string, category?: string): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const t of range) {
    if (!isSpending(t)) continue;
    const cat = catOf(t);
    if (category && cat !== category) continue;
    const key = t.merchantKey || t.counterparty.vpa || t.merchant;
    const a = m.get(key) ?? { merchant: t.merchant, category: cat, n: 0, total: 0, ids: [] };
    if (t.direction === 'debit') a.n++;
    a.total += contribution(t);
    a.ids.push(t.id);
    m.set(key, a);
  }
  return m;
}

const avg = (a: Agg | undefined): Paise => (a && a.n > 0 ? Math.round(a.total / a.n) : 0);

/**
 * Why spending changed, merchant by merchant. Per merchant, delta = current total - previous total
 * (refunds net), split into frequencyEffect = (n1 - n0) x avg0 and sizeEffect = delta - frequencyEffect.
 * Merchants with n0 = 0 are 'new', with n1 = 0 'stopped' (all of the delta is frequency). Unresolved
 * people transfers are not spending and are left out here.
 * `comparable` follows compareSpending: when false the numbers are still returned, but the headline says
 * the periods cannot be compared.
 */
export function explainChange(
  txns: readonly Transaction[],
  ctx: {
    accounts: readonly Account[];
    statements: readonly Statement[];
    current: { start: IsoDate; end: IsoDate };
    previous?: { start: IsoDate; end: IsoDate };
    today: IsoDate;
    category?: string;
    maxMerchants?: number;
  },
): ChangeExplanation {
  const comparison = compareSpending(txns, ctx);
  const catOf = categoryResolver(txns);
  const cur = aggregate(applyQuery(txns, comparison.current), catOf, ctx.category);
  const prev = aggregate(applyQuery(txns, comparison.previous), catOf, ctx.category);
  const prevName = isWholeMonth(comparison.previous.start, comparison.previous.end) ? formatMonth(monthKey(comparison.previous.start)).split(' ')[0] : comparison.previous.label;

  const all: MerchantChange[] = [];
  for (const key of new Set([...cur.keys(), ...prev.keys()])) {
    const c = cur.get(key);
    const p = prev.get(key);
    const n1 = c?.n ?? 0;
    const n0 = p?.n ?? 0;
    const delta = (c?.total ?? 0) - (p?.total ?? 0);
    if (delta === 0) continue;
    const frequencyEffect = n0 > 0 ? Math.round(((n1 - n0) * (p?.total ?? 0)) / n0) : delta;
    const sizeEffect = delta - frequencyEffect;
    const a0 = avg(p);
    const a1 = avg(c);
    const merchant = (c ?? p)?.merchant ?? key;
    let driver: MerchantChange['driver'];
    let sentence: string;
    const orders = (n: number): string => `${n} order${n === 1 ? '' : 's'}`;
    if (n0 === 0) {
      driver = 'new';
      sentence = `New this period: ${orders(n1)} (${inr(delta)})`;
    } else if (n1 === 0) {
      driver = 'stopped';
      sentence = `No orders this period, compared with ${orders(n0)} in ${prevName} (${inr(delta)})`;
    } else if (Math.abs(frequencyEffect) >= 2 * Math.abs(sizeEffect)) {
      driver = n1 > n0 ? 'more_often' : 'less_often';
      sentence = `${Math.abs(n1 - n0)} ${n1 > n0 ? 'more' : 'fewer'} orders than ${prevName} (${inr(frequencyEffect)})`;
    } else if (Math.abs(sizeEffect) >= 2 * Math.abs(frequencyEffect)) {
      driver = sizeEffect > 0 ? 'bigger_purchases' : 'smaller_purchases';
      const size = `${inr(a1 - a0)} ${a1 >= a0 ? 'larger' : 'smaller'} on average`;
      sentence = n1 === n0 ? `About the same number of orders, but each was ${size}` : `Each order was ${size} (${orders(n1)} vs ${n0})`;
    } else {
      driver = 'mixed';
      sentence = `${orders(n1)} averaging ${inr(a1)}, against ${orders(n0)} averaging ${inr(a0)} in ${prevName}`;
    }
    all.push({
      merchantKey: key,
      merchant,
      category: (c ?? p)?.category ?? '',
      current: { count: n1, total: c?.total ?? 0, average: a1 },
      previous: { count: n0, total: p?.total ?? 0, average: a0 },
      delta,
      frequencyEffect,
      sizeEffect,
      driver,
      sentence,
      txnIdsCurrent: c?.ids ?? [],
      txnIdsPrevious: p?.ids ?? [],
    });
  }
  all.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.merchantKey.localeCompare(b.merchantKey));
  const merchants = all.slice(0, ctx.maxMerchants ?? 5);

  const scope = ctx.category ? categoryName(ctx.category) : 'Spending';
  const curTotal = ctx.category ? sumTotals(cur) : comparison.current.total;
  const prevTotal = ctx.category ? sumTotals(prev) : comparison.previous.total;
  const diff = curTotal - prevTotal;
  const lead = merchants[0] ? `, mostly ${merchants[0].merchant} (${inr(merchants[0].delta)})` : '';
  const headline = !comparison.comparable
    ? `${comparison.current.label} and ${comparison.previous.label} cannot be compared yet because statements are missing for part of them.`
    : diff === 0
      ? `${scope} in ${comparison.current.label} is the same as in ${comparison.previous.label}.`
      : `${scope} in ${comparison.current.label} is ${inr(diff)} ${diff > 0 ? 'higher' : 'lower'} than in ${comparison.previous.label}${lead}.`;

  const out: ChangeExplanation = { comparison, merchants, headline, comparable: comparison.comparable, drivers: driversOf(txns, comparison, cur, prev, catOf, ctx.category) };
  const target = ctx.category ?? comparison.steps.find((s) => s.delta > 0)?.category;
  if (comparison.comparable && target && isWholeMonth(comparison.previous.start, comparison.previous.end)) {
    const base = ctx.category ? prevTotal : categoryTotal(target, txns, comparison.previous, catOf);
    if (base > 0 && (ctx.category ? diff > 0 : true)) {
      out.suggestedAction = { category: target, suggestedTarget: base, label: `Set a ${categoryName(target)} limit of ${inr(base)} a month` };
    }
  }
  return out;
}

function sumTotals(m: Map<string, Agg>): Paise {
  let t = 0;
  for (const a of m.values()) t += a.total;
  return t;
}

/** Previous-period spending in one category (all merchants, unclassified people flows excluded). */
function categoryTotal(category: string, txns: readonly Transaction[], range: { start: IsoDate; end: IsoDate }, catOf: (t: Transaction) => string): Paise {
  return sumTotals(aggregate(applyQuery(txns, range), catOf, category));
}

function driversOf(
  txns: readonly Transaction[],
  comparison: SpendingComparison,
  cur: Map<string, Agg>,
  prev: Map<string, Agg>,
  catOf: (t: Transaction) => string,
  category?: string,
): NonNullable<ChangeExplanation['drivers']> {
  const count = (m: Map<string, Agg>): number => [...m.values()].reduce((n, a) => n + a.n, 0);
  const gross = (m: Map<string, Agg>): Paise => [...m.values()].reduce((n, a) => n + a.total, 0);
  const n1 = count(cur);
  const n0 = count(prev);
  let newMerchants = 0;
  let stoppedMerchants = 0;
  let newCount = 0;
  let stoppedCount = 0;
  for (const [k, a] of cur) {
    if (prev.has(k) || a.n === 0) continue;
    newMerchants += a.total;
    newCount++;
  }
  for (const [k, a] of prev) {
    if (cur.has(k) || a.n === 0) continue;
    stoppedMerchants += a.total;
    stoppedCount++;
  }

  const scoped = (range: { start: IsoDate; end: IsoDate }): Transaction[] =>
    applyQuery(txns, range).filter((t) => isSpending(t) && (!category || catOf(t) === category));
  const curTx = scoped(comparison.current);
  const prevTx = scoped(comparison.previous);
  const byCat = new Map<string, number[]>();
  for (const t of [...curTx, ...prevTx]) {
    if (t.direction !== 'debit') continue;
    const c = catOf(t);
    byCat.set(c, [...(byCat.get(c) ?? []), t.amount]);
  }
  const medians = new Map<string, number>();
  for (const [c, list] of byCat) if (list.length >= 3) medians.set(c, median(list));
  const one = curTx.filter(
    (t) => t.direction === 'debit' && (t.tag === 'planned' || t.tag === 'exceptional' || t.amount >= 3 * (medians.get(catOf(t)) ?? Infinity)),
  );
  const refunds = (list: Transaction[]): Paise => list.filter((t) => t.direction === 'credit').reduce((n, t) => n + t.amount, 0);
  return {
    purchases: { current: n1, previous: n0 },
    averageSize: { current: n1 > 0 ? Math.round(gross(cur) / n1) : 0, previous: n0 > 0 ? Math.round(gross(prev) / n0) : 0 },
    merchantMix: { newMerchants, stoppedMerchants, newCount, stoppedCount },
    oneOffs: { total: one.reduce((n, t) => n + t.amount, 0), txnIds: one.map((t) => t.id) },
    refunds: { current: refunds(curTx), previous: refunds(prevTx) },
  };
}
