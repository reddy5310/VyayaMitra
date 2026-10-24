/**
 * On-device learning from the user's own confirmed choices (never from anything else).
 *
 * Model v2 has two layers:
 *   1. MEMORY — exact counts per merchantKey and per UPI handle ("this QR is always groceries").
 *      Exact memory outranks the statistical layer.
 *   2. Multinomial Naive Bayes with Laplace smoothing over weighted features: word tokens (merchantKey
 *      counts double), character 3-grams (robust to wrapped and truncated names), UPI handle tokens,
 *      an amount bucket and the direction.
 *
 * It is a last resort in the pipeline: consulted when no rule or brand decided, and only trusted above
 * 60% probability when trained on ≥ 8 examples across ≥ 2 categories. v1 models (word tokens only, no
 * memory) still load and predict.
 */
import { UNCATEGORIZED } from '@/domain/categories';
import { nowTimestamp } from '@/lib/ids';
import type { LearnedModel, LearningExample } from './index';

export const MIN_EXAMPLES = 8;
export const MIN_CATEGORIES = 2;
export const MIN_PROBABILITY = 0.6;

type Counts = Record<string, Record<string, number>>;

interface ModelData {
  categories: string[];
  /** log prior per category */
  priors: Record<string, number>;
  /** weighted feature counts per category */
  counts: Counts;
  /** total feature weight per category */
  totals: Record<string, number>;
  vocabSize: number;
  /** v2 only */
  memory?: { key: Record<string, Record<string, number>>; vpa: Record<string, Record<string, number>> };
}

const STOP = new Set([
  'upi', 'imps', 'neft', 'rtgs', 'ach', 'nach', 'mmt', 'bil', 'cms', 'inf', 'pos', 'ecom', 'vps', 'ips', 'payment', 'paid', 'pay', 'from', 'transfer', 'bank', 'ltd', 'limited', 'pvt',
  'private', 'the', 'and', 'for', 'ref', 'txn', 'trf', 'dr', 'cr', 'sbi', 'ybl', 'ibl', 'axl', 'oksbi', 'okaxis', 'okicici', 'okhdfcbank', 'paytm', 'ptys', 'apl', 'axisbank', 'icici', 'hdfc',
  'upiintent', 'online', 'india', 'com',
]);

export function tokenize(text: string, merchantKey = ''): string[] {
  const out: string[] = [];
  const push = (src: string, weight: number) => {
    for (const tok of src.toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length < 3 || /\d/.test(tok) || STOP.has(tok)) continue;
      for (let i = 0; i < weight; i++) out.push(tok);
    }
  };
  push(merchantKey, 2);
  push(text, 1);
  return out;
}

export interface Features {
  text: string;
  merchantKey: string;
  vpa?: string;
  amount?: number;
  direction?: 'debit' | 'credit';
}

/** Local part of a handle, lower-cased, trailing punctuation removed; null for phone numbers and empties. */
export function handleKey(vpa: string | undefined): string | null {
  if (!vpa) return null;
  const local = vpa.toLowerCase().replace(/\s+/g, '').split('@')[0].replace(/[._-]+$/, '');
  if (local.length < 4) return null;
  if (/^(?:\+?91)?[6-9]\d{9}$/.test(local)) return local.slice(-10);
  return local;
}

function amountBucket(paise: number): string {
  const rupees = paise / 100;
  if (rupees < 100) return 'lt100';
  if (rupees < 500) return 'lt500';
  if (rupees < 2000) return 'lt2k';
  if (rupees < 10000) return 'lt10k';
  if (rupees < 50000) return 'lt50k';
  return 'big';
}

/** Weighted features. Word and handle features are strong evidence; trigrams, amount and direction are hints. */
export function featurize(f: Features): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const words = tokenize(f.text, f.merchantKey);
  for (const w of words) out.push([`w:${w}`, 1]);
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 4 || seen.has(w)) continue;
    seen.add(w);
    for (let i = 0; i + 3 <= w.length; i++) out.push([`g:${w.slice(i, i + 3)}`, 0.2]);
  }
  const key = handleKey(f.vpa);
  if (key && !/^\d{10}$/.test(key)) {
    out.push([`vl:${key.replace(/\d+/g, '')}`, 3]);
    for (const seg of key.split(/[^a-z]+/)) if (seg.length >= 3 && !STOP.has(seg)) out.push([`v:${seg}`, 2]);
  }
  if (f.amount !== undefined) out.push([`a:${amountBucket(f.amount)}`, 0.5]);
  if (f.direction) out.push([`d:${f.direction}`, 0.5]);
  return out;
}

function bump(map: Record<string, Record<string, number>>, key: string, category: string): void {
  const row = (map[key] ??= {});
  row[category] = (row[category] ?? 0) + 1;
}

export function trainModel(examples: readonly LearningExample[]): LearnedModel | null {
  const usable = examples.filter((e) => e.category && e.category !== UNCATEGORIZED && featurize(exampleFeatures(e)).some(([t]) => t.startsWith('w:') || t.startsWith('vl:')));
  const categories = [...new Set(usable.map((e) => e.category))].sort();
  if (usable.length < MIN_EXAMPLES || categories.length < MIN_CATEGORIES) return null;

  const counts: Counts = {};
  const totals: Record<string, number> = {};
  const docs: Record<string, number> = {};
  const vocab = new Set<string>();
  const memory = { key: {} as Record<string, Record<string, number>>, vpa: {} as Record<string, Record<string, number>> };
  for (const c of categories) {
    counts[c] = {};
    totals[c] = 0;
    docs[c] = 0;
  }
  for (const ex of usable) {
    docs[ex.category]++;
    for (const [tok, w] of featurize(exampleFeatures(ex))) {
      counts[ex.category][tok] = (counts[ex.category][tok] ?? 0) + w;
      totals[ex.category] += w;
      vocab.add(tok);
    }
    const key = ex.merchantKey.trim().toLowerCase();
    if (key) bump(memory.key, key, ex.category);
    const hk = handleKey(ex.vpa);
    if (hk) bump(memory.vpa, hk, ex.category);
  }
  const priors: Record<string, number> = {};
  for (const c of categories) priors[c] = Math.log((docs[c] + 1) / (usable.length + categories.length));

  const data: ModelData = { categories, priors, counts, totals, vocabSize: vocab.size, memory };
  return { version: 2, trainedAt: nowTimestamp(), exampleCount: usable.length, ...data };
}

function exampleFeatures(e: LearningExample): Features {
  return { text: e.text, merchantKey: e.merchantKey, vpa: e.vpa, amount: e.amount, direction: e.direction };
}

function asData(model: LearnedModel): ModelData | null {
  const m = model as unknown as Partial<ModelData>;
  if (!m.categories || !m.priors || !m.counts || !m.totals || typeof m.vocabSize !== 'number') return null;
  return m as ModelData;
}

/** True when a persisted model is trained well enough to be consulted at all. */
export function isLearnedModelUsable(model: LearnedModel | null | undefined): boolean {
  if (!model) return false;
  const data = asData(model);
  return !!data && model.exampleCount >= MIN_EXAMPLES && data.categories.length >= MIN_CATEGORIES;
}

export interface Prediction {
  category: string;
  probability: number;
  via: 'memory' | 'model';
}

function dominant(row: Record<string, number> | undefined): { category: string; share: number; total: number } | null {
  if (!row) return null;
  let total = 0;
  let best = '';
  let bestN = 0;
  for (const [c, n] of Object.entries(row)) {
    total += n;
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return total ? { category: best, share: bestN / total, total } : null;
}

/** Exact memory: has the user already told us what this handle / merchant is? Handle memory wins. */
export function recall(model: LearnedModel | null | undefined, merchantKey: string, vpa?: string): Prediction | null {
  if (!model || !isLearnedModelUsable(model)) return null;
  const memory = asData(model)?.memory;
  if (!memory) return null;
  const candidates = [dominant(memory.vpa[handleKey(vpa) ?? '']), dominant(memory.key[merchantKey.trim().toLowerCase()])];
  for (const hit of candidates) {
    if (!hit) continue;
    // one agreeing example ≈ 0.67, two ≈ 0.8, mixed history is discounted by its share
    const probability = hit.share * (hit.total / (hit.total + 0.5));
    if (probability >= MIN_PROBABILITY) return { category: hit.category, probability, via: 'memory' };
  }
  return null;
}

/** Distinct merchants the user has taught that share words with `merchantKey` (for "similar merchant" hints). */
export function similarMerchants(model: LearnedModel | null | undefined, merchantKey: string, limit = 3): Array<{ key: string; category: string; overlap: number }> {
  if (!model || !isLearnedModelUsable(model)) return [];
  const memory = asData(model)?.memory;
  if (!memory) return [];
  const mine = new Set(merchantKey.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
  if (mine.size === 0) return [];
  const out: Array<{ key: string; category: string; overlap: number }> = [];
  for (const [key, row] of Object.entries(memory.key)) {
    if (key === merchantKey.toLowerCase()) continue;
    const theirs = new Set(key.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
    let shared = 0;
    for (const t of mine) if (theirs.has(t)) shared++;
    if (!shared) continue;
    const dom = dominant(row);
    if (dom) out.push({ key, category: dom.category, overlap: shared / (mine.size + theirs.size - shared) });
  }
  return out.sort((a, b) => b.overlap - a.overlap).slice(0, limit);
}

/** Ranked categories with posterior probabilities from the statistical layer (null when no feature is known). */
export function rank(model: LearnedModel | null | undefined, f: Features): Array<{ category: string; probability: number }> {
  if (!model) return [];
  const data = asData(model);
  if (!data || !isLearnedModelUsable(model)) return [];
  const feats = featurize(f).filter(([t]) => data.categories.some((c) => data.counts[c][t] !== undefined));
  if (feats.length === 0) return [];
  const logs = data.categories.map((c) => {
    let lp = data.priors[c];
    const denom = data.totals[c] + data.vocabSize;
    for (const [t, w] of feats) lp += w * Math.log(((data.counts[c][t] ?? 0) + 1) / denom);
    return lp;
  });
  const max = Math.max(...logs);
  const exps = logs.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return data.categories.map((category, i) => ({ category, probability: exps[i] / sum })).sort((a, b) => b.probability - a.probability);
}

/**
 * Best category: exact memory first, then Naive Bayes. `null` when neither knows this transaction.
 */
export function predict(model: LearnedModel | null | undefined, text: string, merchantKey = '', extra: Pick<Features, 'vpa' | 'amount' | 'direction'> = {}): Prediction | null {
  const remembered = recall(model, merchantKey, extra.vpa);
  if (remembered) return remembered;
  const top = rank(model, { text, merchantKey, ...extra })[0];
  return top ? { category: top.category, probability: top.probability, via: 'model' } : null;
}
