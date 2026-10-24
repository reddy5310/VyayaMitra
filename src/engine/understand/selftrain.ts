/**
 * Self-training: calibration from feedback, category suggestions and review prioritisation.
 * Everything here is pure and works only on the user's own corrections.
 */
import { KIND_DEFAULT_CATEGORY, UNCATEGORIZED, categoryName } from '@/domain/categories';
import { KIND_LABELS, SPENDING_KINDS } from '@/domain/kinds';
import type { CategorySource, FeedbackEvent, Transaction } from '@/domain/types';
import { nowTimestamp } from '@/lib/ids';
import { formatINR } from '@/lib/money';
import type { Calibration, CategorySuggestion, ReviewItem, UnderstandContext } from './index';
import { canon } from './brands';
import { findKeyword } from './keywords';
import { handleKey, rank, recall, similarMerchants } from './learned';
import { understandTransaction } from './pipeline';
import { selectRules } from './rules';

// ─── calibration ─────────────────────────────────────────────────────────────────────────────────

/** Minimum feedback events in a bucket before it can move a confidence. */
export const MIN_BUCKET_EVENTS = 5;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 1.15;
const CALIBRATED_SOURCES: ReadonlySet<CategorySource> = new Set<CategorySource>(['builtin_rule', 'learned', 'kind_default']);

interface Tally {
  kept: number;
  total: number;
}

interface CalibrationData {
  /** by categorySource */
  sources: Record<string, Tally>;
  /** by "source|category" and "source@band" */
  buckets: Record<string, Tally>;
}

function band(confidence: number): 'high' | 'mid' | 'low' {
  return confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'mid' : 'low';
}

/** What a source is expected to get right before any feedback exists (the prior). */
function baseline(source: CategorySource, confidence: number): number {
  if (source === 'builtin_rule') return confidence >= 0.8 ? 0.9 : 0.75;
  if (source === 'learned') return 0.8;
  return 0.8;
}

function tally(map: Record<string, Tally>, key: string, kept: boolean): void {
  const t = (map[key] ??= { kept: 0, total: 0 });
  t.total += 1;
  if (kept) t.kept += 1;
}

/**
 * Rebuild calibration from the whole feedback history. An event counts for the automatic decision that
 * preceded it: "kept" when the user confirmed it or corrected nothing, "overridden" otherwise. Decisions
 * the user made themselves (user_txn / user_rule) and renames say nothing about the engine and are ignored.
 */
export function buildCalibration(events: readonly FeedbackEvent[]): Calibration | null {
  const data: CalibrationData = { sources: {}, buckets: {} };
  let used = 0;
  for (const e of events) {
    if (e.action === 'merchant' || e.action === 'reset') continue;
    const source = e.before.categorySource;
    if (!CALIBRATED_SOURCES.has(source)) continue;
    const kept = e.action === 'confirm' || (e.after.category === e.before.category && e.after.kind === e.before.kind);
    tally(data.sources, source, kept);
    tally(data.buckets, `${source}|${e.before.category}`, kept);
    tally(data.buckets, `${source}@${band(e.before.confidence)}`, kept);
    used++;
  }
  if (used === 0) return null;
  return { version: 1, builtAt: nowTimestamp(), eventCount: events.length, ...data };
}

export interface CalibrationResult {
  confidence: number;
  /** multiplier that was applied (1 = untouched) */
  factor: number;
  note?: string;
}

/**
 * Adjust a decision's confidence by how often the user kept similar decisions. Uses the most specific
 * bucket with at least MIN_BUCKET_EVENTS events (source×category, then source×confidence band; a poor record
 * on weak keyword guesses must not lower trust in exact brand matches),
 * a beta-style prior so a few events cannot swing it, and a bounded factor in [0.5, 1.15].
 */
export function calibrateConfidence(cal: Calibration | null | undefined, source: CategorySource, category: string, confidence: number): CalibrationResult {
  const untouched: CalibrationResult = { confidence, factor: 1 };
  if (!cal || !CALIBRATED_SOURCES.has(source) || confidence <= 0) return untouched;
  const data = cal as unknown as Partial<CalibrationData>;
  if (!data.buckets || !data.sources) return untouched;
  const candidates: Array<[Tally | undefined, string]> = [
    [data.buckets[`${source}|${category}`], `like this ${categoryName(category)} decision`],
    [data.buckets[`${source}@${band(confidence)}`], 'of this kind'],
  ];
  const hit = candidates.find(([t]) => t && t.total >= MIN_BUCKET_EVENTS);
  if (!hit || !hit[0]) return untouched;
  const [t, label] = hit;
  const p0 = baseline(source, confidence);
  const accuracy = (t.kept + 2 * p0) / (t.total + 2);
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, accuracy / p0));
  const adjusted = Math.min(0.99, Math.round(confidence * factor * 1000) / 1000);
  const note =
    factor < 0.9 || factor > 1.05
      ? `Your corrections: ${t.kept} of ${t.total} guesses ${label} were kept, so confidence ${factor < 1 ? 'lowered' : 'raised'}`
      : undefined;
  return { confidence: adjusted, factor, note };
}

// ─── suggestions ─────────────────────────────────────────────────────────────────────────────────

type SuggestInput = Pick<Transaction, 'rawDescription' | 'merchantKey' | 'merchant' | 'counterparty' | 'direction' | 'amount' | 'kind' | 'accountId'>;

const INCOME_ALTERNATIVES = ['salary', 'other_income'];

/** A slice of the user's own ledger: lets the suggestions fall back to what they usually do. */
export type SuggestionHistory = ReadonlyArray<Pick<Transaction, 'category' | 'amount' | 'kind' | 'categorySource'> & Partial<Pick<Transaction, 'channel'>>>;

type AmountBand = 'tiny' | 'small' | 'medium' | 'large';

function amountBand(paise: number): AmountBand {
  const rupees = paise / 100;
  return rupees < 150 ? 'tiny' : rupees < 800 ? 'small' : rupees < 3000 ? 'medium' : 'large';
}

/** Fixed prior for everyday Indian spending, by amount; deliberately weak (≤ 0.18). */
const PRIOR: Record<AmountBand, string[]> = {
  tiny: ['food_dining', 'groceries', 'transport', 'personal_care'],
  small: ['food_dining', 'groceries', 'shopping', 'transport'],
  medium: ['groceries', 'shopping', 'healthcare', 'food_dining'],
  large: ['shopping', 'healthcare', 'travel', 'rent_housing'],
};

export function suggest(txn: SuggestInput, ctx: UnderstandContext, k = 3, history?: SuggestionHistory): CategorySuggestion[] {
  const pool = new Map<string, CategorySuggestion[]>();
  const add = (s: CategorySuggestion) => {
    if (s.category === UNCATEGORIZED || s.probability <= 0) return;
    const list = pool.get(s.category) ?? [];
    list.push(s);
    pool.set(s.category, list);
  };

  // Only spending-like kinds have a free choice of category; other kinds follow their meaning.
  if (!SPENDING_KINDS.has(txn.kind)) {
    const own = KIND_DEFAULT_CATEGORY[txn.kind];
    add({ category: own, probability: 0.9, source: 'kind_default', reason: `Typical for "${KIND_LABELS[txn.kind]}"` });
    if (txn.kind === 'income') for (const c of INCOME_ALTERNATIVES) add({ category: c, probability: 0.4, source: 'kind_default', reason: 'Common for money received' });
    return finish(pool, k);
  }

  const key = txn.merchantKey;
  const vpa = txn.counterparty.vpa;

  // 1. the user's own rules
  const rule = selectRules(ctx.rules, { accountId: txn.accountId, direction: txn.direction, merchantKey: key, counterparty: txn.counterparty, rawDescription: txn.rawDescription });
  if (rule.category) add({ category: rule.category.value, probability: 0.98, source: 'user_rule', reason: `Your rule for "${rule.category.rule.match.value}"` });

  // 2. exact memory of earlier confirmations
  const remembered = recall(ctx.learned, key, vpa);
  if (remembered) {
    const what = handleKey(vpa) && !/^\d{10}$/.test(handleKey(vpa) ?? '') ? 'UPI handle' : 'merchant';
    add({ category: remembered.category, probability: remembered.probability, source: 'learned', reason: `You categorised this ${what} before` });
  }

  // 3. statistical model over words, 3-grams, handle, amount and direction
  const ranked = rank(ctx.learned, { text: txn.rawDescription, merchantKey: key, vpa, amount: txn.amount, direction: txn.direction });
  for (const r of ranked.slice(0, 3)) {
    if (r.probability < 0.08 || r.category === remembered?.category) continue; // exact memory outranks the statistics
    add({ category: r.category, probability: r.probability * 0.9, source: 'learned', reason: `Looks like other transactions you filed under ${categoryName(r.category, ctx.customCategories)} (${Math.round(r.probability * 100)}%)` });
  }

  // 4. built-in dictionary and keywords, evaluated WITHOUT the user's model so it is an independent opinion
  const account = ctx.ownAccounts.find((a) => a.id === txn.accountId) ?? ctx.account;
  const dictionary = understandTransaction(
    { description: txn.rawDescription, amount: txn.amount, direction: txn.direction, date: '1970-01-01' },
    { ...ctx, account, rules: [], learned: null, calibration: null },
  );
  if (dictionary.categorySource === 'builtin_rule' && SPENDING_KINDS.has(dictionary.kind)) {
    add({ category: dictionary.category, probability: dictionary.confidence, source: 'builtin_rule', reason: dictionary.reasons.find((r) => /Matched|Keyword|Cut-off|Remark/.test(r)) ?? 'Matches built-in merchant knowledge' });
  }

  // 5. merchants the user already taught that share words with this one
  for (const s of similarMerchants(ctx.learned, key)) {
    add({ category: s.category, probability: Math.min(0.55, 0.2 + s.overlap * 0.6), source: 'similar_merchant', reason: `Similar to "${s.key}", which you filed under ${categoryName(s.category, ctx.customCategories)}` });
  }

  // 6. kind default
  const fallback = KIND_DEFAULT_CATEGORY[txn.kind];
  if (fallback !== UNCATEGORIZED) add({ category: fallback, probability: 0.3, source: 'kind_default', reason: `Typical for "${KIND_LABELS[txn.kind]}"` });

  // Weak signals: never leave the user with an empty list. Each tier only adds what is still missing.
  if (pool.size < k) {
    const channel = dictionary.channel;
    const band = amountBand(txn.amount);

    // (a) a cut-off word that looks like a keyword
    const prefix = findKeyword(canon(txn.merchant || key), { allowPrefix: true });
    if (prefix?.prefix) add({ category: prefix.category, probability: 0.25, source: 'similar_merchant', reason: `Name looks cut off: "${prefix.phrase}"` });

    // (b) what this user usually files at a similar amount (and channel)
    if (history && pool.size < k) {
      const spend = history.filter((h) => SPENDING_KINDS.has(h.kind) && h.category !== UNCATEGORIZED && h.categorySource !== 'none');
      const sameBand = spend.filter((h) => amountBand(h.amount) === band && (!h.channel || h.channel === channel));
      const rows = sameBand.length >= 3 ? sameBand : spend.filter((h) => amountBand(h.amount) === band);
      const pick = rows.length > 0 ? rows : spend;
      const counts = new Map<string, number>();
      for (const h of pick) counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
      const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
      for (const [category, n] of ordered.slice(0, 3)) {
        add({
          category,
          probability: Math.min(0.35, 0.08 + 0.3 * (n / pick.length)),
          source: 'similar_merchant',
          reason: `You filed ${n} of your ${pick.length} ${rows.length > 0 ? 'similar-sized' : 'recent'} payments under ${categoryName(category, ctx.customCategories)}`,
        });
      }
    }

    // (c) fixed prior for everyday spending
    if (pool.size < k) {
      const what = channel === 'UPI' ? (band === 'tiny' || band === 'small' ? 'small UPI payments' : 'UPI payments of this size') : 'payments of this size';
      PRIOR[band].forEach((category, i) => add({ category, probability: 0.18 - i * 0.03, source: 'kind_default', reason: `Common for ${what}` }));
    }
  }

  return finish(pool, k);
}

function finish(pool: Map<string, CategorySuggestion[]>, k: number): CategorySuggestion[] {
  const merged: CategorySuggestion[] = [];
  for (const list of pool.values()) {
    const best = list.reduce((a, b) => (b.probability > a.probability ? b : a));
    // independent agreeing sources reinforce each other (noisy-or, half weight for the extras)
    let miss = 1 - best.probability;
    for (const other of list) if (other !== best) miss *= 1 - other.probability * 0.5;
    const probability = Math.min(0.99, Math.round((1 - miss) * 1000) / 1000);
    merged.push({ ...best, probability, reason: list.length > 1 ? `${best.reason}; ${list.length - 1} more signal${list.length > 2 ? 's' : ''} agree` : best.reason });
  }
  return merged.sort((a, b) => b.probability - a.probability || (a.category < b.category ? -1 : 1)).slice(0, Math.max(0, k));
}

// ─── review priority ─────────────────────────────────────────────────────────────────────────────

function identityKeys(t: Transaction): string[] {
  const keys: string[] = [];
  const hk = handleKey(t.counterparty.vpa);
  if (hk) keys.push(`vpa:${hk}`);
  if (t.merchantKey) keys.push(`key:${t.merchantKey}`);
  return keys;
}

/**
 * Rank the review queue by impact: amount × uncertainty × (1 + other rows that share the merchant or
 * UPI handle). Teaching the top item fixes the most money and the most rows.
 */
export function prioritise(txns: readonly Transaction[]): ReviewItem[] {
  const pending = txns.filter((t) => t.needsReview);
  const groups = new Map<string, number>();
  for (const t of pending) for (const key of identityKeys(t)) groups.set(key, (groups.get(key) ?? 0) + 1);

  const items = pending.map((t) => {
    const sameMerchantCount = Math.max(0, ...identityKeys(t).map((key) => (groups.get(key) ?? 1) - 1));
    const uncertainty = t.kind === 'unknown' ? 1 : Math.max(0.1, 1 - t.confidence);
    const rupees = t.amount / 100;
    const score = Math.round(rupees * uncertainty * (1 + sameMerchantCount) * 100) / 100;
    const more = sameMerchantCount > 0 ? `; fixing it also fixes ${sameMerchantCount} more` : '';
    const reason = `${formatINR(t.amount, { whole: true })}${t.reviewReasons[0] ? `, ${t.reviewReasons[0].toLowerCase()}` : ''}${more}`;
    return { txnId: t.id, score, sameMerchantCount, reason, amount: t.amount };
  });
  items.sort((a, b) => b.score - a.score || b.amount - a.amount || (a.txnId < b.txnId ? -1 : 1));
  return items.map(({ amount: _amount, ...item }) => item);
}
