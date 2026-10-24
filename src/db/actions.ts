/**
 * CONTRACT — owned by the ledger module.
 * Every write the UI performs. Each function validates input and runs in a single Dexie transaction.
 * Validation failures throw `ValidationError` with a user-presentable message.
 */
import { BUDGETABLE_GROUPS, UNCATEGORIZED, allCategories } from '@/domain/categories';
import { USER_SELECTABLE_KINDS } from '@/domain/kinds';
import type {
  Account,
  AppSettings,
  Budget,
  CategoryGroup,
  CustomCategory,
  GoalContribution,
  IsoDate,
  Paise,
  RecurringDecision,
  SavingAction,
  SavingsGoal,
  Transaction,
  TxnKind,
  UserRule,
} from '@/domain/types';
import { ruleMatches } from '@/engine/understand';
import { formatINR } from '@/lib/money';
import { newId, nowTimestamp } from '@/lib/ids';
import { META_SETTINGS, db, writeAll } from './db';
import {
  REASON_CONFIRMED,
  REASON_RENAMED,
  REASON_USER_SET,
  categoryAfterKindChange,
  decisionSnapshot,
  readSettings,
  recordFeedback,
  relinkAll,
  reprocessTransactions,
  retrainLearnedModel,
  detachDeleted,
  unlinkGroup,
} from './ledger';
import {
  ValidationError,
  requireDate,
  requireName,
  requireNonNegativePaise,
  requireOneOf,
  requirePositivePaise,
  validateAccountFields,
  validateNewAccount,
} from './validation';

export { ValidationError };

/** 'this' = only this transaction; 'merchant' = remember for this merchant (creates/updates a UserRule and applies it to matching transactions). */
export type CorrectionScope = 'this' | 'merchant';

export interface CorrectionResult {
  updated: number;
  ruleId?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  'essentials',
  'lifestyle',
  'people',
  'commitments',
  'fees',
  'cash',
  'income',
  'saving',
  'transfer',
  'other',
];

async function getTxn(id: string): Promise<Transaction> {
  const txn = typeof id === 'string' ? await db.transactions.get(id) : undefined;
  if (!txn) throw new ValidationError('That transaction no longer exists.');
  return txn;
}

function requireScope(scope: unknown): CorrectionScope {
  return requireOneOf<CorrectionScope>(scope, ['this', 'merchant'], 'Scope');
}

async function requireCategory(category: unknown): Promise<string> {
  if (typeof category !== 'string' || !category) throw new ValidationError('Choose a category.');
  const custom = await db.customCategories.toArray();
  if (!allCategories(custom).some((c) => c.id === category)) throw new ValidationError('That category does not exist.');
  return category;
}

/** Merchant keys too generic to identify a payee on their own — a VPA is a better rule target. */
const GENERIC_KEY_WORDS = new Set([
  'upi', 'neft', 'imps', 'rtgs', 'ach', 'nach', 'ecs', 'atm', 'cash', 'pos', 'card', 'bank', 'transfer',
  'payment', 'unknown', 'self', 'debit', 'credit', 'online', 'purchase', 'withdrawal', 'mob', 'ib', 'bil', 'to', 'by',
]);

export function isGenericMerchantKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (k.length < 3) return true;
  return k.split(/\s+/).every((w) => GENERIC_KEY_WORDS.has(w) || /^\d+$/.test(w));
}

/**
 * A name that does not identify a payee by itself: generic words, a person's name, or a QR/aggregator
 * placeholder ("Paytm Merchant"). For these the VPA is the stable identity.
 */
export function isGenericPayee(txn: Pick<Transaction, 'merchantKey' | 'merchant' | 'counterparty'>): boolean {
  const key = txn.merchantKey?.trim().toLowerCase() ?? '';
  if (!key || isGenericMerchantKey(key)) return true;
  if (txn.counterparty.type === 'person') return true;
  if (/\b(merchant|qr|paytm|bharatpe|phonepe|gpay|googlepay|upi)\b/.test(key)) return true;
  const vpa = txn.counterparty.vpa?.toLowerCase() ?? '';
  return /^(paytmqr|paytm\.s|bharatpe|bpay|q\d{5,}|gpay-|phonepe)/.test(vpa);
}

function ruleMatchFor(txn: Transaction): UserRule['match'] | null {
  const key = txn.merchantKey?.trim().toLowerCase();
  const vpa = txn.counterparty.vpa?.trim().toLowerCase();
  if (key && !(isGenericPayee(txn) && vpa)) return { field: 'merchantKey', op: 'equals', value: key };
  if (vpa) return { field: 'vpa', op: 'equals', value: vpa };
  return null;
}

export async function upsertRule(
  match: UserRule['match'],
  set: UserRule['set'],
  fromTxnId?: string,
): Promise<UserRule> {
  const rules = await db.rules.toArray();
  const existing = rules.find(
    (r) =>
      r.match.field === match.field &&
      r.match.op === match.op &&
      r.match.value.toLowerCase() === match.value.toLowerCase() &&
      r.accountId === undefined &&
      r.direction === undefined,
  );
  if (existing) {
    const updated: UserRule = { ...existing, set: { ...existing.set, ...set }, enabled: true };
    await db.rules.put(updated);
    return updated;
  }
  const rule: UserRule = {
    id: newId(),
    match,
    set,
    ...(fromTxnId ? { createdFromTxnId: fromTxnId } : {}),
    enabled: true,
    createdAt: nowTimestamp(),
  };
  await db.rules.add(rule);
  return rule;
}

/** Transactions a (saved) rule applies to. */
async function matchingTxns(rule: UserRule): Promise<Transaction[]> {
  const all = await db.transactions.toArray();
  return all.filter((t) => ruleMatches(rule, t));
}

function userRuleReason(txn: Transaction): string {
  return `Your rule for ${txn.merchant}`;
}

function keepRenamed(txn: Transaction, reasons: string[]): string[] {
  return txn.reasons.includes(REASON_RENAMED) ? [...reasons, REASON_RENAMED] : reasons;
}

// ─── accounts ────────────────────────────────────────────────────────────────

export async function createAccount(input: Omit<Account, 'id' | 'createdAt'>): Promise<Account> {
  const fields = validateNewAccount(input);
  const account: Account = { ...fields, id: newId(), createdAt: nowTimestamp() };
  await db.accounts.add(account);
  return account;
}

export async function updateAccount(id: string, patch: Partial<Omit<Account, 'id' | 'createdAt'>>): Promise<void> {
  const fields = validateAccountFields(patch);
  await writeAll(async () => {
    const existing = await db.accounts.get(id);
    if (!existing) throw new ValidationError('That account no longer exists.');
    const next: Account = { ...existing, ...fields };
    for (const k of Object.keys(next) as (keyof Account)[]) if (next[k] === undefined) delete next[k];
    await db.accounts.put(next);
  });
}

/** Deletes the account with all its statements and transactions, atomically. */
export async function deleteAccount(id: string): Promise<void> {
  await writeAll(async () => {
    const account = await db.accounts.get(id);
    if (!account) throw new ValidationError('That account no longer exists.');
    const txns = await db.transactions.where('accountId').equals(id).toArray();
    await db.transactions.where('accountId').equals(id).delete();
    await db.statements.where('accountId').equals(id).delete();
    await db.accounts.delete(id);
    await db.rules.filter((r) => r.accountId === id).delete();
    await detachDeleted(txns);
    await retrainLearnedModel();
  });
}

// ─── transaction corrections ─────────────────────────────────────────────────

export async function setTransactionCategory(
  txnId: string,
  category: string,
  scope: CorrectionScope,
): Promise<CorrectionResult> {
  requireScope(scope);
  return writeAll(async () => {
    const txn = await getTxn(txnId);
    const cat = await requireCategory(category);
    const now = nowTimestamp();
    const before = decisionSnapshot(txn);
    const feedback = (scope: CorrectionScope) =>
      recordFeedback([{ txn, action: 'category', scope, before, after: { kind: txn.kind, category: cat } }]);

    const applyThis = async (): Promise<CorrectionResult> => {
      await db.transactions.put({
        ...txn,
        category: cat,
        categorySource: 'user_txn',
        confidence: 1,
        needsReview: false,
        reviewReasons: [],
        reasons: keepRenamed(txn, [REASON_USER_SET]),
        updatedAt: now,
      });
      await feedback('this');
      await retrainLearnedModel();
      return { updated: 1 };
    };

    if (scope === 'this') return applyThis();
    const match = ruleMatchFor(txn);
    if (!match) return applyThis();

    const rule = await upsertRule(match, { category: cat }, txn.id);
    const targets = (await matchingTxns(rule)).filter((t) => t.id !== txn.id && t.categorySource !== 'user_txn');
    targets.push(txn);
    await db.transactions.bulkPut(
      targets.map((t) => ({
        ...t,
        category: cat,
        categorySource: 'user_rule' as const,
        confidence: 1,
        needsReview: false,
        reviewReasons: [],
        reasons: keepRenamed(t, [userRuleReason(t)]),
        updatedAt: now,
      })),
    );
    await feedback('merchant');
    await retrainLearnedModel();
    return { updated: targets.length, ruleId: rule.id };
  });
}

/** Apply a user-chosen kind to a transaction: the category follows the kind unless both are spending (or the user set it). */
function retargetKind(
  t: Transaction,
  kind: TxnKind,
  source: 'user' | 'user_rule',
  custom: readonly CustomCategory[],
  now: string,
): Transaction {
  const cat =
    t.categorySource === 'user_txn'
      ? { category: t.category, categorySource: t.categorySource }
      : categoryAfterKindChange(kind, t, custom);
  return {
    ...t,
    kind,
    kindSource: source,
    category: cat.category,
    categorySource: cat.categorySource,
    confidence: 1,
    needsReview: false,
    reviewReasons: [],
    reasons: keepRenamed(t, [source === 'user' ? REASON_USER_SET : userRuleReason(t)]),
    updatedAt: now,
  };
}

const BULK_MAX = 5000;

export async function loadSelected(txnIds: unknown): Promise<Transaction[]> {
  if (!Array.isArray(txnIds) || txnIds.length === 0) throw new ValidationError('Select at least one transaction.');
  const ids = [...new Set(txnIds.filter((i): i is string => typeof i === 'string'))];
  if (ids.length > BULK_MAX) throw new ValidationError(`Select at most ${BULK_MAX} transactions at a time.`);
  const found = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t);
  if (found.length === 0) throw new ValidationError('Those transactions no longer exist.');
  return found;
}

/** Set one category on every selected transaction (each becomes a user_txn decision; no rule is created). */
export async function setTransactionsCategory(txnIds: string[], category: string): Promise<CorrectionResult> {
  return writeAll(async () => {
    const txns = await loadSelected(txnIds);
    const cat = await requireCategory(category);
    const now = nowTimestamp();
    await db.transactions.bulkPut(
      txns.map((t) => ({
        ...t,
        category: cat,
        categorySource: 'user_txn' as const,
        confidence: 1,
        needsReview: false,
        reviewReasons: [],
        reasons: keepRenamed(t, [REASON_USER_SET]),
        updatedAt: now,
      })),
    );
    await recordFeedback(
      txns.map((t) => ({
        txn: t,
        action: 'category' as const,
        scope: 'this' as const,
        before: decisionSnapshot(t),
        after: { kind: t.kind, category: cat },
      })),
    );
    await retrainLearnedModel();
    return { updated: txns.length };
  });
}

/** Set one kind on every selected transaction (kindSource 'user'), then relink the ledger once. */
export async function setTransactionsKind(txnIds: string[], kind: TxnKind): Promise<CorrectionResult> {
  requireOneOf(kind, USER_SELECTABLE_KINDS, 'Type');
  return writeAll(async () => {
    const txns = await loadSelected(txnIds);
    const custom = await db.customCategories.toArray();
    const now = nowTimestamp();
    const next = txns.map((t) => retargetKind(t, kind, 'user', custom, now));
    await db.transactions.bulkPut(next);
    await unlinkGroup(new Set(next.map((t) => t.id)));
    await relinkAll();
    await recordFeedback(
      txns.map((t, i) => ({
        txn: t,
        action: 'kind' as const,
        scope: 'this' as const,
        before: decisionSnapshot(t),
        after: { kind, category: next[i].category },
      })),
    );
    await retrainLearnedModel();
    return { updated: next.length };
  });
}

export async function setTransactionKind(txnId: string, kind: TxnKind, scope: CorrectionScope): Promise<CorrectionResult> {
  requireScope(scope);
  requireOneOf(kind, USER_SELECTABLE_KINDS, 'Type');
  return writeAll(async () => {
    const txn = await getTxn(txnId);
    const custom = await db.customCategories.toArray();
    const now = nowTimestamp();

    const retarget = (t: Transaction, source: 'user' | 'user_rule'): Transaction =>
      retargetKind(t, kind, source, custom, now);

    let targets: Transaction[];
    let ruleId: string | undefined;
    const match = scope === 'merchant' ? ruleMatchFor(txn) : null;
    if (match) {
      const rule = await upsertRule(match, { kind }, txn.id);
      ruleId = rule.id;
      const others = (await matchingTxns(rule)).filter((t) => t.id !== txn.id && t.kindSource !== 'user');
      targets = [...others.map((t) => retarget(t, 'user_rule')), retarget(txn, 'user_rule')];
    } else {
      targets = [retarget(txn, 'user')];
    }
    await db.transactions.bulkPut(targets);
    await unlinkGroup(new Set(targets.map((t) => t.id)));
    await relinkAll();
    const done = targets.find((t) => t.id === txn.id) ?? targets[0];
    await recordFeedback([
      {
        txn,
        action: 'kind',
        scope: ruleId ? 'merchant' : 'this',
        before: decisionSnapshot(txn),
        after: { kind, category: done.category },
      },
    ]);
    await retrainLearnedModel();
    return ruleId ? { updated: targets.length, ruleId } : { updated: targets.length };
  });
}

export async function renameMerchant(txnId: string, name: string, scope: CorrectionScope): Promise<CorrectionResult> {
  requireScope(scope);
  const merchant = requireName(name, 'Merchant name');
  return writeAll(async () => {
    const txn = await getTxn(txnId);
    const now = nowTimestamp();
    const match = scope === 'merchant' ? ruleMatchFor(txn) : null;
    if (!match) {
      await db.transactions.put({
        ...txn,
        merchant,
        reasons: [...new Set([...txn.reasons, REASON_RENAMED])],
        updatedAt: now,
      });
      await recordFeedback([{ txn, action: 'merchant', scope: 'this', before: decisionSnapshot(txn), after: { kind: txn.kind, category: txn.category } }]);
      return { updated: 1 };
    }
    const rule = await upsertRule(match, { merchant }, txn.id);
    const targets = (await matchingTxns(rule)).filter((t) => t.id !== txn.id && !t.reasons.includes(REASON_RENAMED));
    targets.push(txn);
    await db.transactions.bulkPut(targets.map((t) => ({ ...t, merchant, updatedAt: now })));
    await recordFeedback([{ txn, action: 'merchant', scope: 'merchant', before: decisionSnapshot(txn), after: { kind: txn.kind, category: txn.category } }]);
    return { updated: targets.length, ruleId: rule.id };
  });
}

export async function setTransactionNote(txnId: string, note: string): Promise<void> {
  if (typeof note !== 'string') throw new ValidationError('Note must be text.');
  const text = note.trim();
  if (text.length > 500) throw new ValidationError('Notes can be up to 500 characters.');
  await writeAll(async () => {
    const txn = await getTxn(txnId);
    const next = { ...txn, updatedAt: nowTimestamp() };
    if (text) next.note = text;
    else delete next.note;
    await db.transactions.put(next);
  });
}

/** Clears needsReview (user confirms the current decision is right). */
export async function markReviewed(txnIds: string[]): Promise<void> {
  if (!Array.isArray(txnIds)) throw new ValidationError('Nothing selected.');
  await writeAll(async () => {
    const txns = (await db.transactions.bulkGet(txnIds)).filter((t): t is Transaction => !!t);
    const now = nowTimestamp();
    await db.transactions.bulkPut(
      txns.map((t) => ({
        ...t,
        needsReview: false,
        reviewReasons: [],
        reasons: t.reasons.includes(REASON_CONFIRMED) ? t.reasons : [...t.reasons, REASON_CONFIRMED],
        updatedAt: now,
      })),
    );
    await recordFeedback(
      txns.map((t) => ({
        txn: t,
        action: 'confirm' as const,
        scope: 'this' as const,
        before: decisionSnapshot(t),
        after: { kind: t.kind, category: t.category },
      })),
    );
  });
}

/** Restores the automatic decision for a transaction (drops user_txn override). */
export async function resetTransaction(txnId: string): Promise<void> {
  await writeAll(async () => {
    const txn = await getTxn(txnId);
    await reprocessTransactions(new Set([txnId]), new Set([txnId]));
    const after = (await db.transactions.get(txnId)) ?? txn;
    await recordFeedback([
      { txn, action: 'reset', scope: 'this', before: decisionSnapshot(txn), after: { kind: after.kind, category: after.category } },
    ]);
    await retrainLearnedModel();
  });
}

// ─── rules (reversible) ──────────────────────────────────────────────────────

async function ruleEffectIds(...rules: UserRule[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const all = await db.transactions.toArray();
  for (const rule of rules) {
    for (const t of all) {
      if (ruleMatches(rule, t) || (rule.set.merchantKey && t.merchantKey === rule.set.merchantKey)) ids.add(t.id);
    }
  }
  return ids;
}

export async function updateRule(id: string, patch: Partial<Pick<UserRule, 'enabled' | 'set'>>): Promise<void> {
  await writeAll(async () => {
    const rule = await db.rules.get(id);
    if (!rule) throw new ValidationError('That rule no longer exists.');
    const next: UserRule = { ...rule };
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
    if (patch.set !== undefined) {
      const set: UserRule['set'] = {};
      if (patch.set.category !== undefined) set.category = await requireCategory(patch.set.category);
      if (patch.set.kind !== undefined) set.kind = requireOneOf(patch.set.kind, USER_SELECTABLE_KINDS, 'Type');
      if (patch.set.merchant !== undefined) set.merchant = requireName(patch.set.merchant, 'Merchant name');
      if (!set.category && !set.kind && !set.merchant) throw new ValidationError('A rule must change a category, type or name.');
      next.set = set;
    }
    await db.rules.put(next);
    const ids = await ruleEffectIds(rule, next);
    await reprocessTransactions(ids);
    await retrainLearnedModel();
  });
}

/** Deletes a rule and re-understands the transactions it had changed. */
export async function deleteRule(id: string): Promise<void> {
  await writeAll(async () => {
    const rule = await db.rules.get(id);
    if (!rule) return;
    const all = await db.transactions.toArray();
    const ids = new Set<string>();
    for (const t of all) {
      if (!ruleMatches(rule, t)) continue;
      const changedByRule =
        (rule.set.category !== undefined && t.categorySource === 'user_rule') ||
        (rule.set.kind !== undefined && t.kindSource === 'user_rule') ||
        (rule.set.merchant !== undefined && !t.reasons.includes(REASON_RENAMED)) ||
        rule.set.merchantKey !== undefined;
      if (changedByRule) ids.add(t.id);
    }
    // Rows that were merged under this rule's alias no longer carry the source key.
    if (rule.set.merchantKey) for (const t of all) if (t.merchantKey === rule.set.merchantKey) ids.add(t.id);
    await db.rules.delete(id);
    await reprocessTransactions(ids);
    await retrainLearnedModel();
  });
}

// ─── categories ──────────────────────────────────────────────────────────────

export async function createCustomCategory(name: string, group: CategoryGroup): Promise<CustomCategory> {
  const clean = requireName(name, 'Category name');
  requireOneOf(group, CATEGORY_GROUPS, 'Category group');
  return writeAll(async () => {
    const custom = await db.customCategories.toArray();
    const taken = allCategories(custom).some((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (taken) throw new ValidationError(`A category called "${clean}" already exists.`);
    const category: CustomCategory = { id: `cc_${newId()}`, name: clean, group, createdAt: nowTimestamp() };
    await db.customCategories.add(category);
    return category;
  });
}

// ─── budgets ─────────────────────────────────────────────────────────────────

export async function upsertBudget(category: string, monthlyLimit: Paise): Promise<Budget> {
  const limit = requirePositivePaise(monthlyLimit, 'Budget limit');
  return writeAll(async () => {
    if (category === UNCATEGORIZED) throw new ValidationError('Choose a spending category for the budget.');
    const custom = await db.customCategories.toArray();
    const def = allCategories(custom).find((c) => c.id === category);
    if (!def) throw new ValidationError('That category does not exist.');
    if (!BUDGETABLE_GROUPS.has(def.group)) throw new ValidationError('Budgets can only be set on spending categories.');
    const now = nowTimestamp();
    const existing = await db.budgets.where('category').equals(category).first();
    if (existing) {
      const updated: Budget = { ...existing, monthlyLimit: limit, updatedAt: now };
      await db.budgets.put(updated);
      return updated;
    }
    const budget: Budget = { id: newId(), category, monthlyLimit: limit, createdAt: now, updatedAt: now };
    await db.budgets.add(budget);
    return budget;
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id);
}

// ─── goals ───────────────────────────────────────────────────────────────────

export async function createGoal(input: {
  name: string;
  target: Paise;
  targetDate?: IsoDate;
  icon?: string;
  color?: string;
}): Promise<SavingsGoal> {
  const goal: SavingsGoal = {
    id: newId(),
    name: requireName(input.name, 'Goal name'),
    target: requirePositivePaise(input.target, 'Goal target'),
    icon: input.icon?.trim() || 'Target',
    color: input.color?.trim() || '#0f766e',
    archived: false,
    createdAt: nowTimestamp(),
  };
  if (input.targetDate !== undefined) goal.targetDate = requireDate(input.targetDate, 'Target date');
  await db.goals.add(goal);
  return goal;
}

export async function updateGoal(
  id: string,
  patch: Partial<Pick<SavingsGoal, 'name' | 'target' | 'targetDate' | 'icon' | 'color' | 'archived'>>,
): Promise<void> {
  await writeAll(async () => {
    const goal = await db.goals.get(id);
    if (!goal) throw new ValidationError('That goal no longer exists.');
    const next: SavingsGoal = { ...goal };
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Goal name');
    if (patch.target !== undefined) next.target = requirePositivePaise(patch.target, 'Goal target');
    if ('targetDate' in patch) {
      if (patch.targetDate === undefined) delete next.targetDate;
      else next.targetDate = requireDate(patch.targetDate, 'Target date');
    }
    if (patch.icon !== undefined) next.icon = patch.icon.trim() || goal.icon;
    if (patch.color !== undefined) next.color = patch.color.trim() || goal.color;
    if (patch.archived !== undefined) next.archived = Boolean(patch.archived);
    await db.goals.put(next);
  });
}

/** Deletes the goal and its contribution history. */
export async function deleteGoal(id: string): Promise<void> {
  await writeAll(async () => {
    await db.goalContributions.where('goalId').equals(id).delete();
    await db.goals.delete(id);
  });
}

function savedBalance(contributions: readonly GoalContribution[]): Paise {
  let total = 0;
  for (const c of contributions) total += c.type === 'deposit' ? c.amount : -c.amount;
  return total;
}

export async function addContribution(input: Omit<GoalContribution, 'id' | 'createdAt'>): Promise<GoalContribution> {
  const amount = requirePositivePaise(input.amount, 'Amount');
  const date = requireDate(input.date, 'Date');
  const type = requireOneOf<GoalContribution['type']>(input.type, ['deposit', 'withdrawal'], 'Contribution type');
  const note = input.note?.trim();
  if (note && note.length > 200) throw new ValidationError('Notes can be up to 200 characters.');
  return writeAll(async () => {
    const goal = await db.goals.get(input.goalId);
    if (!goal) throw new ValidationError('That goal no longer exists.');
    if (input.linkedTxnId && !(await db.transactions.get(input.linkedTxnId))) {
      throw new ValidationError('The linked transaction no longer exists.');
    }
    if (type === 'withdrawal') {
      const saved = savedBalance(await db.goalContributions.where('goalId').equals(goal.id).toArray());
      if (amount > saved) {
        throw new ValidationError(`You can only withdraw what is saved. This goal has ${formatINR(Math.max(saved, 0))} saved.`);
      }
    }
    const contribution: GoalContribution = {
      id: newId(),
      goalId: goal.id,
      date,
      amount,
      type,
      createdAt: nowTimestamp(),
    };
    if (input.linkedTxnId) contribution.linkedTxnId = input.linkedTxnId;
    if (note) contribution.note = note;
    await db.goalContributions.add(contribution);
    return contribution;
  });
}

export async function deleteContribution(id: string): Promise<void> {
  await writeAll(async () => {
    const c = await db.goalContributions.get(id);
    if (!c) return;
    if (c.type === 'deposit') {
      const rest = (await db.goalContributions.where('goalId').equals(c.goalId).toArray()).filter((x) => x.id !== id);
      if (savedBalance(rest) < 0) {
        throw new ValidationError('Removing this deposit would leave the goal with a negative balance. Remove the later withdrawal first.');
      }
    }
    await db.goalContributions.delete(id);
  });
}

// ─── recurring & saving actions ──────────────────────────────────────────────

export async function setRecurringDecision(decision: Omit<RecurringDecision, 'updatedAt'>): Promise<void> {
  const merchantKey = requireName(decision.merchantKey, 'Merchant', 120);
  const status = requireOneOf<RecurringDecision['status']>(decision.status, ['confirmed', 'dismissed'], 'Status');
  const record: RecurringDecision = { merchantKey, status, updatedAt: nowTimestamp() };
  if (decision.cadence !== undefined) {
    record.cadence = requireOneOf(decision.cadence, ['weekly', 'monthly', 'quarterly', 'yearly'] as const, 'Cadence');
  }
  if (decision.expectedAmount !== undefined) record.expectedAmount = requirePositivePaise(decision.expectedAmount, 'Expected amount');
  if (decision.label !== undefined && decision.label.trim() !== '') record.label = requireName(decision.label, 'Label');
  await db.recurringDecisions.put(record);
}

function requireMonth(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ValidationError('Start month must look like 2025-09.');
  }
  return value;
}

const SAVING_ACTION_STATUSES: readonly SavingAction['status'][] = ['active', 'completed', 'dropped'];

export async function createSavingAction(
  input: Omit<SavingAction, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SavingAction> {
  const now = nowTimestamp();
  const action: SavingAction = {
    ...input,
    id: newId(),
    title: requireName(input.title, 'Title', 120),
    baselineMonthly: requireNonNegativePaise(input.baselineMonthly, 'Baseline'),
    targetMonthly: requireNonNegativePaise(input.targetMonthly, 'Target'),
    startMonth: requireMonth(input.startMonth),
    status: requireOneOf(input.status, SAVING_ACTION_STATUSES, 'Status'),
    createdAt: now,
    updatedAt: now,
  };
  await db.savingActions.add(action);
  return action;
}

export async function updateSavingAction(
  id: string,
  patch: Partial<Pick<SavingAction, 'status' | 'targetMonthly' | 'title'>>,
): Promise<void> {
  await writeAll(async () => {
    const a = await db.savingActions.get(id);
    if (!a) throw new ValidationError('That action no longer exists.');
    const next: SavingAction = { ...a, updatedAt: nowTimestamp() };
    if (patch.status !== undefined) next.status = requireOneOf(patch.status, SAVING_ACTION_STATUSES, 'Status');
    if (patch.targetMonthly !== undefined) next.targetMonthly = requireNonNegativePaise(patch.targetMonthly, 'Target');
    if (patch.title !== undefined) next.title = requireName(patch.title, 'Title', 120);
    await db.savingActions.put(next);
  });
}

export async function deleteSavingAction(id: string): Promise<void> {
  await db.savingActions.delete(id);
}

// ─── settings & storage ──────────────────────────────────────────────────────

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const clean: Partial<AppSettings> = {};
  if (patch.theme !== undefined) clean.theme = requireOneOf(patch.theme, ['system', 'light', 'dark'] as const, 'Theme');
  if (patch.hideAmounts !== undefined) clean.hideAmounts = Boolean(patch.hideAmounts);
  if (patch.onboardingDone !== undefined) clean.onboardingDone = Boolean(patch.onboardingDone);
  if (patch.p2pReviewThreshold !== undefined) {
    clean.p2pReviewThreshold = requirePositivePaise(patch.p2pReviewThreshold, 'Review threshold');
  }
  await writeAll(async () => {
    const current = await readSettings();
    await db.meta.put({ key: META_SETTINGS, value: { ...current, ...clean } });
  });
}

/** Permanently erases every table on this device. */
export async function deleteAllData(): Promise<void> {
  await writeAll(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

/** Asks the browser not to evict our data. Returns whether storage is now persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageStatus(): Promise<{ persisted: boolean; usageBytes?: number; quotaBytes?: number }> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const out: { persisted: boolean; usageBytes?: number; quotaBytes?: number } = { persisted: false };
  if (!storage) return out;
  try {
    if (storage.persisted) out.persisted = await storage.persisted();
  } catch {
    /* unavailable — report not persisted */
  }
  try {
    if (storage.estimate) {
      const est = await storage.estimate();
      if (est.usage !== undefined) out.usageBytes = est.usage;
      if (est.quota !== undefined) out.quotaBytes = est.quota;
    }
  } catch {
    /* estimate is optional */
  }
  return out;
}
