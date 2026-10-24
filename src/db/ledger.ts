/**
 * Ledger-level helpers shared by the import pipeline and the user actions:
 * building the understanding context from the database, re-understanding stored
 * transactions without losing the user's own decisions, and applying link patches.
 *
 * Every function here only uses Dexie calls (no foreign awaits), so each can run
 * inside the caller's `writeAll` transaction and roll back with it.
 */
import { BUDGETABLE_GROUPS, KIND_DEFAULT_CATEGORY, UNCATEGORIZED, categoryById } from '@/domain/categories';
import { SPENDING_KINDS } from '@/domain/kinds';
import type {
  Account,
  AppSettings,
  CustomCategory,
  Direction,
  FeedbackEvent,
  Transaction,
  TxnKind,
  UserRule,
} from '@/domain/types';
import {
  buildCalibration,
  trainLearnedModel,
  type Calibration,
  understand,
  type LearnedModel,
  type LearningExample,
  type UnderstandContext,
  type Understanding,
} from '@/engine/understand';
import { linkTransactions, type LinkPatch } from '@/engine/match';
import { newId, nowTimestamp } from '@/lib/ids';
import { db, META_CALIBRATION, META_LEARNED_MODEL, META_SETTINGS } from './db';
import { DEFAULT_SETTINGS } from './settings';

/** Markers stored in `Transaction.reasons`, so user decisions survive re-understanding without a schema change. */
export const REASON_USER_SET = 'You set this';
export const REASON_RENAMED = 'You renamed this merchant';
export const REASON_CONFIRMED = 'You confirmed this';

// ─── settings & learned model ────────────────────────────────────────────────

export async function readSettings(): Promise<AppSettings> {
  const rec = await db.meta.get(META_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<AppSettings> | undefined) ?? {}) };
}

/** Learning example with the optional richer features (the model ignores any it does not know). */
export type RichLearningExample = LearningExample & { vpa?: string; amount?: number; direction?: Direction };

export function learningExamples(txns: readonly Transaction[]): RichLearningExample[] {
  const out: RichLearningExample[] = [];
  for (const t of txns) {
    if ((t.categorySource === 'user_txn' || t.categorySource === 'user_rule') && t.category !== UNCATEGORIZED) {
      const ex: RichLearningExample = {
        text: t.rawDescription,
        merchantKey: t.merchantKey,
        category: t.category,
        amount: t.amount,
        direction: t.direction,
      };
      if (t.counterparty.vpa) ex.vpa = t.counterparty.vpa;
      out.push(ex);
    }
  }
  return out;
}

/** Retrain from the user's own confirmed categories and persist into meta (or remove when too few). */
export async function retrainLearnedModel(): Promise<LearnedModel | null> {
  const txns = await db.transactions.toArray();
  const model = trainLearnedModel(learningExamples(txns));
  if (model) await db.meta.put({ key: META_LEARNED_MODEL, value: model });
  else await db.meta.delete(META_LEARNED_MODEL);
  return model;
}

// ─── feedback & calibration ──────────────────────────────────────────────────

/** Rebuild calibration from every stored feedback event and keep it in meta. Derived data: a failure never blocks the user. */
export async function rebuildCalibration(): Promise<Calibration | null> {
  const events = await db.feedback.orderBy('at').toArray();
  let calibration: Calibration | null = null;
  try {
    calibration = events.length > 0 ? buildCalibration(events) : null;
  } catch (e) {
    console.warn('Calibration could not be rebuilt', e);
  }
  if (calibration) await db.meta.put({ key: META_CALIBRATION, value: calibration });
  else await db.meta.delete(META_CALIBRATION);
  return calibration;
}

/** The decision a transaction currently carries, as recorded in feedback. */
export function decisionSnapshot(t: Transaction): FeedbackEvent['before'] {
  return {
    kind: t.kind,
    category: t.category,
    categorySource: t.categorySource,
    kindSource: t.kindSource,
    confidence: t.confidence,
  };
}

export type FeedbackInput = {
  txn: Transaction;
  action: FeedbackEvent['action'];
  scope: FeedbackEvent['scope'];
  before: FeedbackEvent['before'];
  after: FeedbackEvent['after'];
};

/** Store one feedback event per input, then refresh calibration once. */
export async function recordFeedback(inputs: readonly FeedbackInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const at = nowTimestamp();
  const events: FeedbackEvent[] = inputs.map((i) => {
    const e: FeedbackEvent = {
      id: newId(),
      at,
      txnId: i.txn.id,
      merchantKey: i.txn.merchantKey,
      action: i.action,
      scope: i.scope,
      before: i.before,
      after: i.after,
    };
    if (i.txn.counterparty.vpa) e.vpa = i.txn.counterparty.vpa;
    return e;
  });
  await db.feedback.bulkAdd(events);
  await rebuildCalibration();
}

// ─── understanding context ───────────────────────────────────────────────────

export interface LedgerContext {
  calibration: Calibration | null;
  rules: UserRule[];
  accounts: Account[];
  customCategories: CustomCategory[];
  settings: AppSettings;
  learned: LearnedModel | null;
}

/** Reads everything `understand` needs. The learned model comes from meta, or is trained on the fly. */
export async function loadLedgerContext(): Promise<LedgerContext> {
  const [rules, accounts, customCategories, settings, storedModel, storedCalibration] = await Promise.all([
    db.rules.toArray(),
    db.accounts.toArray(),
    db.customCategories.toArray(),
    readSettings(),
    db.meta.get(META_LEARNED_MODEL),
    db.meta.get(META_CALIBRATION),
  ]);
  let learned = (storedModel?.value as LearnedModel | null | undefined) ?? null;
  if (!learned) learned = trainLearnedModel(learningExamples(await db.transactions.toArray()));
  const calibration = (storedCalibration?.value as Calibration | null | undefined) ?? null;
  return { rules, accounts, customCategories, settings, learned, calibration };
}

export function buildUnderstandContext(
  account: Account,
  lc: LedgerContext,
  extraAccounts: readonly Account[] = [],
): UnderstandContext {
  const own = [...lc.accounts, ...extraAccounts].filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
  if (!own.some((a) => a.id === account.id)) own.push(account);
  return {
    account,
    ownAccounts: own,
    rules: lc.rules,
    learned: lc.learned,
    calibration: lc.calibration,
    p2pReviewThreshold: lc.settings.p2pReviewThreshold,
    customCategories: lc.customCategories,
  };
}

export function understandTransaction(
  txn: Pick<Transaction, 'rawDescription' | 'amount' | 'direction' | 'date' | 'reference' | 'balanceAfter' | 'bankCategory'>,
  ctx: UnderstandContext,
): Understanding {
  return understand(
    {
      description: txn.rawDescription,
      amount: txn.amount,
      direction: txn.direction,
      date: txn.date,
      reference: txn.reference,
      balanceAfter: txn.balanceAfter,
      bankCategory: txn.bankCategory,
    },
    ctx,
  );
}

// ─── category / kind coherence ───────────────────────────────────────────────

/** A category that represents consumption (the same set budgets can target). */
export function isSpendingCategory(id: string, custom: readonly CustomCategory[] = []): boolean {
  if (id === 'received_from_people') return false;
  return BUDGETABLE_GROUPS.has(categoryById(id, custom).group);
}

/**
 * When the kind changes, the category follows the kind — unless both the new kind and the
 * current category are about spending (an expense stays "Groceries" if it was "Groceries").
 */
export function categoryAfterKindChange(
  kind: TxnKind,
  current: Pick<Transaction, 'category' | 'categorySource'>,
  custom: readonly CustomCategory[] = [],
): Pick<Transaction, 'category' | 'categorySource'> {
  if (SPENDING_KINDS.has(kind) && isSpendingCategory(current.category, custom)) {
    return { category: current.category, categorySource: current.categorySource };
  }
  return { category: KIND_DEFAULT_CATEGORY[kind], categorySource: 'kind_default' };
}

// ─── re-understanding a stored transaction ───────────────────────────────────

export function clearLinkFields(t: Transaction): Transaction {
  const next = { ...t };
  delete next.linkId;
  delete next.linkRole;
  delete next.linkedTxnId;
  return next;
}

/**
 * Merge a fresh understanding into a stored transaction, keeping the user's own decisions:
 * a user-set kind (kindSource 'user'), a user-set category (categorySource 'user_txn'), a
 * per-transaction merchant rename, and a "confirmed" flag while the decision is unchanged.
 * `force` drops every user override (used by "reset to automatic").
 */
export function applyUnderstanding(
  txn: Transaction,
  u: Understanding,
  opts: { force?: boolean; customCategories?: readonly CustomCategory[] } = {},
): Transaction {
  const force = opts.force === true;
  const userKind = !force && txn.kindSource === 'user';
  const userCategory = !force && txn.categorySource === 'user_txn';
  const renamed = !force && txn.reasons.includes(REASON_RENAMED);
  const confirmed = !force && txn.reasons.includes(REASON_CONFIRMED);

  const kind = userKind ? txn.kind : u.kind;
  const kindSource = userKind ? txn.kindSource : u.kindSource;
  let category: string;
  let categorySource = u.categorySource;
  if (userCategory) {
    category = txn.category;
    categorySource = txn.categorySource;
  } else if (userKind && u.kind !== txn.kind) {
    const c = categoryAfterKindChange(
      kind,
      { category: u.category, categorySource: u.categorySource },
      opts.customCategories,
    );
    category = c.category;
    categorySource = c.categorySource;
  } else {
    category = u.category;
  }

  const userMade = userKind || userCategory;
  const sameDecision = kind === txn.kind && category === txn.category;
  const stillConfirmed = confirmed && sameDecision;

  let reasons = userMade ? [REASON_USER_SET] : [...u.reasons];
  if (stillConfirmed && !userMade) reasons.push(REASON_CONFIRMED);
  if (renamed) reasons.push(REASON_RENAMED);
  reasons = [...new Set(reasons)];

  const reviewed = userMade || stillConfirmed;
  const next: Transaction = {
    ...txn,
    channel: u.channel,
    counterparty: u.counterparty,
    merchant: renamed ? txn.merchant : u.merchant,
    merchantKey: u.merchantKey,
    reference: txn.reference ?? u.reference,
    kind,
    kindSource,
    category,
    categorySource,
    confidence: userKind && userCategory ? 1 : u.confidence,
    reasons,
    needsReview: reviewed ? false : u.needsReview,
    reviewReasons: reviewed ? [] : [...u.reviewReasons],
  };
  if (next.reference === undefined) delete next.reference;
  return next;
}

const STATE_KEYS = [
  'channel',
  'counterparty',
  'merchant',
  'merchantKey',
  'reference',
  'kind',
  'kindSource',
  'category',
  'categorySource',
  'confidence',
  'reasons',
  'needsReview',
  'reviewReasons',
  'linkId',
  'linkRole',
  'linkedTxnId',
] as const;

export function understandingState(t: Transaction): string {
  return JSON.stringify(STATE_KEYS.map((k) => t[k] ?? null));
}

// ─── link patches ────────────────────────────────────────────────────────────

/**
 * Apply patches from `linkTransactions` to an in-memory ledger. Defensive: never lets a patch
 * override a user-set kind or category even if the matcher misbehaves.
 * Returns the ids it touched.
 */
export function applyPatchesInMemory(
  byId: Map<string, Transaction>,
  patches: readonly { txnId: string; patch: LinkPatch }[],
): Set<string> {
  const touched = new Set<string>();
  for (const { txnId, patch } of patches) {
    const cur = byId.get(txnId);
    if (!cur) continue;
    const p: LinkPatch = { ...patch };
    if (cur.kindSource === 'user') {
      delete p.kind;
      delete p.kindSource;
    }
    if (cur.categorySource === 'user_txn') {
      delete p.category;
      delete p.categorySource;
    }
    if (cur.kindSource === 'user' || cur.categorySource === 'user_txn') {
      delete p.confidence;
      delete p.reasons;
      delete p.needsReview;
      delete p.reviewReasons;
    }
    const next = { ...cur, ...p } as Transaction;
    for (const k of Object.keys(p) as (keyof LinkPatch)[]) if (p[k] === undefined) delete next[k];
    byId.set(txnId, next);
    touched.add(txnId);
  }
  return touched;
}

/** Run the matcher over the whole stored ledger and persist its patches. Returns how many rows were linked. */
export async function relinkAll(): Promise<number> {
  const [txns, accounts] = await Promise.all([db.transactions.toArray(), db.accounts.toArray()]);
  const patches = linkTransactions(txns, accounts);
  if (patches.length === 0) return 0;
  const byId = new Map(txns.map((t) => [t.id, t]));
  const touched = applyPatchesInMemory(byId, patches);
  const now = nowTimestamp();
  const changed: Transaction[] = [];
  for (const id of touched) changed.push({ ...byId.get(id)!, updatedAt: now });
  await db.transactions.bulkPut(changed);
  return patches.filter((p) => p.patch.linkId !== undefined).length;
}

/**
 * Re-understand `target` transactions (or all when null) plus anything they are linked to,
 * drop their links, relink the whole ledger and persist what changed.
 * `force` ids lose their user overrides. Returns the number of transactions whose state changed.
 */
export async function reprocessTransactions(
  target: ReadonlySet<string> | null,
  force: ReadonlySet<string> = new Set(),
): Promise<number> {
  const all = await db.transactions.toArray();
  const byId = new Map(all.map((t) => [t.id, t]));
  const group = new Set<string>(target ?? all.map((t) => t.id));
  if (target) {
    const linkIds = new Set<string>();
    for (const id of target) {
      const lid = byId.get(id)?.linkId;
      if (lid) linkIds.add(lid);
    }
    if (linkIds.size > 0) for (const t of all) if (t.linkId && linkIds.has(t.linkId)) group.add(t.id);
  }

  const lc = await loadLedgerContext();
  const accountsById = new Map(lc.accounts.map((a) => [a.id, a]));
  const working = new Map(byId);
  for (const id of group) {
    const t = byId.get(id);
    const account = t && accountsById.get(t.accountId);
    if (!t || !account) continue;
    const u = understandTransaction(t, buildUnderstandContext(account, lc));
    working.set(
      id,
      clearLinkFields(applyUnderstanding(t, u, { force: force.has(id), customCategories: lc.customCategories })),
    );
  }
  const patches = linkTransactions([...working.values()], lc.accounts);
  const touched = applyPatchesInMemory(working, patches);

  const now = nowTimestamp();
  const toWrite: Transaction[] = [];
  for (const id of new Set([...group, ...touched])) {
    const before = byId.get(id);
    const after = working.get(id);
    if (before && after && understandingState(before) !== understandingState(after)) {
      toWrite.push({ ...after, updatedAt: now });
    }
  }
  if (toWrite.length > 0) await db.transactions.bulkPut(toWrite);
  return toWrite.length;
}

/**
 * After transactions were deleted: clear links that pointed at them, re-understand the
 * survivors (their automatic kind came from the link), and detach goal contributions.
 */
export async function detachDeleted(deleted: readonly Transaction[]): Promise<void> {
  if (deleted.length === 0) return;
  const gone = new Set(deleted.map((t) => t.id));
  const linkIds = new Set(deleted.map((t) => t.linkId).filter((x): x is string => !!x));
  const orphans = await db.transactions
    .filter(
      (t) =>
        !gone.has(t.id) && ((!!t.linkId && linkIds.has(t.linkId)) || (!!t.linkedTxnId && gone.has(t.linkedTxnId))),
    )
    .toArray();
  if (orphans.length > 0) {
    const lc = await loadLedgerContext();
    const accountsById = new Map(lc.accounts.map((a) => [a.id, a]));
    const now = nowTimestamp();
    const fixed: Transaction[] = [];
    for (const t of orphans) {
      const account = accountsById.get(t.accountId);
      if (!account) {
        fixed.push({ ...clearLinkFields(t), updatedAt: now });
        continue;
      }
      const u = understandTransaction(t, buildUnderstandContext(account, lc));
      fixed.push({
        ...clearLinkFields(applyUnderstanding(t, u, { customCategories: lc.customCategories })),
        updatedAt: now,
      });
    }
    await db.transactions.bulkPut(fixed);
  }
  await db.goalContributions
    .filter((c) => !!c.linkedTxnId && gone.has(c.linkedTxnId))
    .modify((c) => {
      delete c.linkedTxnId;
    });
}

/**
 * A kind/link-affecting edit was just written for `ids`. Drop their links and the links of
 * everything they were paired with (the partners are re-understood, since their automatic kind
 * came from the pairing). The caller then runs `relinkAll()`.
 */
export async function unlinkGroup(ids: ReadonlySet<string>): Promise<void> {
  const all = await db.transactions.toArray();
  const linkIds = new Set<string>();
  for (const t of all) if (ids.has(t.id) && t.linkId) linkIds.add(t.linkId);
  const partners = all.filter((t) => !!t.linkId && linkIds.has(t.linkId) && !ids.has(t.id));
  const lc = await loadLedgerContext();
  const accountsById = new Map(lc.accounts.map((a) => [a.id, a]));
  const now = nowTimestamp();
  const writes: Transaction[] = [];
  for (const t of all) {
    if (ids.has(t.id)) {
      if (t.linkId || t.linkRole || t.linkedTxnId) writes.push({ ...clearLinkFields(t), updatedAt: now });
    }
  }
  for (const t of partners) {
    const account = accountsById.get(t.accountId);
    if (!account) {
      writes.push({ ...clearLinkFields(t), updatedAt: now });
      continue;
    }
    const u = understandTransaction(t, buildUnderstandContext(account, lc));
    writes.push({
      ...clearLinkFields(applyUnderstanding(t, u, { customCategories: lc.customCategories })),
      updatedAt: now,
    });
  }
  if (writes.length > 0) await db.transactions.bulkPut(writes);
}
