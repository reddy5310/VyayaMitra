import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ValidationError,
  addContribution,
  createAccount,
  createCustomCategory,
  createGoal,
  createSavingAction,
  deleteAccount,
  deleteAllData,
  deleteBudget,
  deleteContribution,
  deleteGoal,
  deleteRule,
  getStorageStatus,
  markReviewed,
  renameMerchant,
  requestPersistentStorage,
  resetTransaction,
  setRecurringDecision,
  setTransactionCategory,
  setTransactionKind,
  setTransactionsCategory,
  setTransactionsKind,
  setTransactionNote,
  updateAccount,
  updateGoal,
  updateRule,
  updateSavingAction,
  updateSettings,
  upsertBudget,
} from './actions';
import { META_LEARNED_MODEL, META_SETTINGS, db, resetDatabaseForTests } from './db';
import { fakeLink, makeAccount, makeTxn } from './testkit';
import { reprocessLedger } from '@/engine/import';
import { linkTransactions } from '@/engine/match';
import { trainLearnedModel } from '@/engine/understand';

vi.mock('@/engine/understand', async () => {
  const k = await import('./testkit');
  return {
    understand: vi.fn(k.fakeUnderstand),
    trainLearnedModel: vi.fn(k.fakeTrain),
    buildCalibration: vi.fn(k.fakeCalibration),
    ruleMatches: k.fakeRuleMatches,
    normalizeMerchantKey: (s: string) => s.toLowerCase(),
  };
});
vi.mock('@/engine/match', async () => {
  const k = await import('./testkit');
  return { linkTransactions: vi.fn(k.fakeLink) };
});
vi.mock('@/parsing', async () => ({ ...(await import('@/parsing/errors')), parseStatement: vi.fn() }));

async function seedSwiggy() {
  await db.accounts.add(makeAccount());
  await db.transactions.bulkAdd([
    makeTxn({ id: 'a', rawDescription: 'SWIGGY ORDER 1', category: 'food_dining', categorySource: 'builtin_rule' }),
    makeTxn({ id: 'b', rawDescription: 'SWIGGY ORDER 2', category: 'food_dining', categorySource: 'builtin_rule' }),
    makeTxn({ id: 'c', rawDescription: 'SWIGGY ORDER 3', category: 'travel', categorySource: 'user_txn', reasons: ['You set this'] }),
    makeTxn({ id: 'z', rawDescription: 'UBER TRIP', merchant: 'Uber', merchantKey: 'uber', counterparty: { type: 'merchant', name: 'UBER' }, category: 'transport' }),
  ]);
}

async function expectInvalid(p: Promise<unknown>, message?: RegExp) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ValidationError);
  if (message) expect((err as Error).message).toMatch(message);
}

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

describe('corrections', () => {
  it('7a. scope "this" sets only that transaction as user_txn', async () => {
    await seedSwiggy();
    const res = await setTransactionCategory('a', 'groceries', 'this');
    expect(res).toEqual({ updated: 1 });
    expect(await db.transactions.get('a')).toMatchObject({
      category: 'groceries',
      categorySource: 'user_txn',
      confidence: 1,
      needsReview: false,
      reasons: ['You set this'],
    });
    expect((await db.transactions.get('b'))!.category).toBe('food_dining');
    expect(await db.rules.count()).toBe(0);
  });

  it('7b. scope "merchant" creates a rule and applies it to every non-user_txn match', async () => {
    await seedSwiggy();
    const res = await setTransactionCategory('a', 'groceries', 'merchant');
    expect(res.updated).toBe(2);
    expect(res.ruleId).toBeTruthy();
    const rule = (await db.rules.get(res.ruleId!))!;
    expect(rule).toMatchObject({ match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'groceries' }, enabled: true });
    expect(await db.transactions.get('a')).toMatchObject({ category: 'groceries', categorySource: 'user_rule' });
    expect(await db.transactions.get('b')).toMatchObject({ category: 'groceries', categorySource: 'user_rule' });
    expect(await db.transactions.get('c')).toMatchObject({ category: 'travel', categorySource: 'user_txn' }); // untouched
    expect((await db.transactions.get('z'))!.category).toBe('transport');
  });

  it('merchant scope reuses the existing rule and retrains the learned model', async () => {
    await seedSwiggy();
    const first = await setTransactionCategory('a', 'groceries', 'merchant');
    const second = await setTransactionCategory('a', 'shopping', 'merchant');
    expect(second.ruleId).toBe(first.ruleId);
    expect(await db.rules.count()).toBe(1);
    expect((await db.rules.get(first.ruleId!))!.set.category).toBe('shopping');
    expect(vi.mocked(trainLearnedModel)).toHaveBeenCalled();
    expect((await db.meta.get(META_LEARNED_MODEL))!.value).toMatchObject({ version: 1 });
  });

  it('uses the VPA when the merchant key is generic', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'p', merchantKey: 'upi', merchant: 'UPI', counterparty: { type: 'person', vpa: 'ravi@okaxis' }, rawDescription: 'UPI ravi@okaxis' }),
    ]);
    const res = await setTransactionCategory('p', 'groceries', 'merchant');
    expect((await db.rules.get(res.ruleId!))!.match).toEqual({ field: 'vpa', op: 'equals', value: 'ravi@okaxis' });
  });

  it('rejects unknown categories, unknown transactions and bad scopes', async () => {
    await seedSwiggy();
    await expectInvalid(setTransactionCategory('a', 'nonsense', 'this'), /category/i);
    await expectInvalid(setTransactionCategory('missing', 'groceries', 'this'));
    await expectInvalid(setTransactionCategory('a', 'groceries', 'everyone' as 'this'));
    expect((await db.transactions.get('a'))!.category).toBe('food_dining');
  });

  it('7c. deleting a rule re-understands what it changed (reversible)', async () => {
    await seedSwiggy();
    const { ruleId } = await setTransactionCategory('a', 'groceries', 'merchant');
    await deleteRule(ruleId!);
    expect(await db.rules.count()).toBe(0);
    expect(await db.transactions.get('a')).toMatchObject({ category: 'food_dining', categorySource: 'builtin_rule' });
    expect(await db.transactions.get('b')).toMatchObject({ category: 'food_dining', categorySource: 'builtin_rule' });
    expect((await db.transactions.get('c'))!.category).toBe('travel'); // user_txn survives
  });

  it('disabling and editing a rule is reflected immediately', async () => {
    await seedSwiggy();
    const { ruleId } = await setTransactionCategory('a', 'groceries', 'merchant');
    await updateRule(ruleId!, { enabled: false });
    expect((await db.transactions.get('b'))!.category).toBe('food_dining');
    await updateRule(ruleId!, { enabled: true, set: { category: 'shopping' } });
    expect((await db.transactions.get('b'))!.category).toBe('shopping');
    await expectInvalid(updateRule(ruleId!, { set: {} }));
    await expectInvalid(updateRule('missing', { enabled: true }));
  });

  it('7d. user_txn decisions survive reprocessLedger', async () => {
    await seedSwiggy();
    await setTransactionCategory('a', 'groceries', 'this');
    await reprocessLedger();
    expect(await db.transactions.get('a')).toMatchObject({ category: 'groceries', categorySource: 'user_txn' });
    expect((await db.transactions.get('b'))!.category).toBe('food_dining');
  });

  it('kind change resets the category unless both are spending', async () => {
    await seedSwiggy();
    // expense -> p2p_out: both spending, category kept
    await setTransactionKind('a', 'p2p_out', 'this');
    expect(await db.transactions.get('a')).toMatchObject({ kind: 'p2p_out', kindSource: 'user', category: 'food_dining', confidence: 1, needsReview: false });
    // -> investment: category follows the kind
    await setTransactionKind('a', 'investment', 'this');
    expect(await db.transactions.get('a')).toMatchObject({ kind: 'investment', category: 'investments', categorySource: 'kind_default' });
    // -> cash_withdrawal
    await setTransactionKind('b', 'cash_withdrawal', 'this');
    expect((await db.transactions.get('b'))!.category).toBe('cash');
    await expectInvalid(setTransactionKind('a', 'unknown', 'this'));
  });

  it('kind change with merchant scope creates a kind rule', async () => {
    await seedSwiggy();
    const res = await setTransactionKind('a', 'investment', 'merchant');
    expect(res.updated).toBe(3);
    expect((await db.rules.get(res.ruleId!))!.set).toEqual({ kind: 'investment' });
    expect(await db.transactions.get('b')).toMatchObject({ kind: 'investment', kindSource: 'user_rule' });
    expect((await db.transactions.get('c'))!.category).toBe('travel'); // user_txn category kept
  });

  it('kind change relinks: un-pairs partners and links again via the matcher', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'o', rawDescription: 'XFEROUT TO SELF', amount: 500, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default', linkId: 'L', linkRole: 'transfer_out', linkedTxnId: 'i' }),
      makeTxn({ id: 'i', rawDescription: 'XFERIN FROM SELF', direction: 'credit', amount: 500, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default', linkId: 'L', linkRole: 'transfer_in', linkedTxnId: 'o' }),
    ]);
    await setTransactionKind('o', 'expense', 'this');
    const o = (await db.transactions.get('o'))!;
    const i = (await db.transactions.get('i'))!;
    expect(o.kind).toBe('expense');
    expect(o.linkId).toBeUndefined();
    expect(i.kind).toBe('income'); // partner re-understood
    expect(i.linkId).toBeUndefined();
  });

  it('resetTransaction restores the automatic decision', async () => {
    await seedSwiggy();
    await setTransactionCategory('a', 'groceries', 'this');
    await setTransactionKind('a', 'investment', 'this');
    await resetTransaction('a');
    expect(await db.transactions.get('a')).toMatchObject({ kind: 'expense', kindSource: 'heuristic', category: 'food_dining', categorySource: 'builtin_rule' });
  });

  it('renames a merchant for one transaction (survives reprocess) or for the merchant', async () => {
    await seedSwiggy();
    await renameMerchant('a', 'Swiggy Food', 'this');
    expect((await db.transactions.get('a'))!.merchant).toBe('Swiggy Food');
    expect((await db.transactions.get('b'))!.merchant).toBe('Swiggy');
    await reprocessLedger();
    expect((await db.transactions.get('a'))!.merchant).toBe('Swiggy Food');

    const res = await renameMerchant('b', 'Swiggy Instamart', 'merchant');
    expect(res.updated).toBe(2); // 'a' keeps its own rename
    expect((await db.transactions.get('c'))!.merchant).toBe('Swiggy Instamart');
    expect((await db.transactions.get('a'))!.merchant).toBe('Swiggy Food');
    await expectInvalid(renameMerchant('a', '   ', 'this'));
    await expectInvalid(renameMerchant('a', 'x'.repeat(61), 'this'), /60/);
  });

  it('notes and review confirmation', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.add(makeTxn({ id: 'n', needsReview: true, reviewReasons: ['Category unknown'] }));
    await setTransactionNote('n', '  split with Asha  ');
    expect((await db.transactions.get('n'))!.note).toBe('split with Asha');
    await setTransactionNote('n', '   ');
    expect((await db.transactions.get('n'))!.note).toBeUndefined();
    await expectInvalid(setTransactionNote('n', 'x'.repeat(501)));
    await markReviewed(['n', 'ghost']);
    expect(await db.transactions.get('n')).toMatchObject({ needsReview: false, reviewReasons: [] });
    await reprocessLedger(); // confirmation survives while the decision is unchanged
  });
});

describe('validation', () => {
  it('8a. budgets: positive, one per category, spending categories only', async () => {
    await expectInvalid(upsertBudget('groceries', -100));
    await expectInvalid(upsertBudget('groceries', 0));
    await expectInvalid(upsertBudget('groceries', 12.5));
    await expectInvalid(upsertBudget('groceries', Number.NaN));
    await expectInvalid(upsertBudget('salary', 1000), /spending/);
    await expectInvalid(upsertBudget('nope', 1000));
    const a = await upsertBudget('groceries', 500000);
    const b = await upsertBudget('groceries', 600000);
    expect(b.id).toBe(a.id);
    expect(await db.budgets.count()).toBe(1);
    expect((await db.budgets.get(a.id))!.monthlyLimit).toBe(600000);
    await deleteBudget(a.id);
    expect(await db.budgets.count()).toBe(0);
  });

  it('8b. goals: target > 0, name rules, dates', async () => {
    await expectInvalid(createGoal({ name: 'Trip', target: 0 }));
    await expectInvalid(createGoal({ name: 'Trip', target: -5 }));
    await expectInvalid(createGoal({ name: '   ', target: 100 }));
    await expectInvalid(createGoal({ name: 'x'.repeat(61), target: 100 }));
    await expectInvalid(createGoal({ name: 'Trip', target: 100, targetDate: '2025-13-40' }));
    const g = await createGoal({ name: '  Goa  trip ', target: 1000000, targetDate: '2026-03-01' });
    expect(g).toMatchObject({ name: 'Goa trip', archived: false });
    await expectInvalid(updateGoal(g.id, { target: 0 }));
    await updateGoal(g.id, { target: 2000000, archived: true });
    expect(await db.goals.get(g.id)).toMatchObject({ target: 2000000, archived: true });
  });

  it('8c. contributions: positive; a withdrawal can never exceed the saved balance', async () => {
    const g = await createGoal({ name: 'Emergency', target: 5000000 });
    const dep = { goalId: g.id, date: '2025-02-01', type: 'deposit' as const };
    await expectInvalid(addContribution({ ...dep, amount: -100 }));
    await expectInvalid(addContribution({ ...dep, amount: 0 }));
    await expectInvalid(addContribution({ ...dep, amount: 100, date: 'yesterday' }));
    await expectInvalid(addContribution({ ...dep, amount: 100, goalId: 'ghost' }));
    await addContribution({ ...dep, amount: 10000 }); // ₹100
    // the old bug: ₹100 saved, ₹500 withdrawn -> -₹400
    await expectInvalid(addContribution({ ...dep, type: 'withdrawal', amount: 50000 }), /only withdraw/);
    await addContribution({ ...dep, type: 'withdrawal', amount: 4000 });
    await expectInvalid(addContribution({ ...dep, type: 'withdrawal', amount: 6001 }));
    await addContribution({ ...dep, type: 'withdrawal', amount: 6000 });
    expect(await db.goalContributions.count()).toBe(3);
  });

  it('removing a deposit cannot drive the balance negative; deleting a goal removes its history', async () => {
    const g = await createGoal({ name: 'Bike', target: 100000 });
    const d = await addContribution({ goalId: g.id, date: '2025-02-01', amount: 1000, type: 'deposit' });
    const w = await addContribution({ goalId: g.id, date: '2025-02-02', amount: 600, type: 'withdrawal' });
    await expectInvalid(deleteContribution(d.id));
    await deleteContribution(w.id);
    await deleteContribution(d.id);
    await addContribution({ goalId: g.id, date: '2025-02-03', amount: 5, type: 'deposit' });
    await deleteGoal(g.id);
    expect(await db.goalContributions.count()).toBe(0);
    expect(await db.goals.count()).toBe(0);
  });

  it('accounts, categories, recurring decisions, saving actions', async () => {
    await expectInvalid(createAccount({ name: '', institution: 'ICICI', type: 'savings', currency: 'INR' }));
    await expectInvalid(createAccount({ name: 'A', institution: 'ICICI', type: 'savings', currency: 'INR', mask: '12345' }), /4 digits/);
    await expectInvalid(createAccount({ name: 'A', institution: '' , type: 'savings', currency: 'INR' }));
    const acc = await createAccount({ name: ' Main ', institution: 'HDFC', type: 'savings', currency: 'INR', mask: '4321' });
    expect(acc.name).toBe('Main');
    await updateAccount(acc.id, { name: 'Renamed', extraMasks: ['1111', '1111'] });
    expect(await db.accounts.get(acc.id)).toMatchObject({ name: 'Renamed', extraMasks: ['1111'] });
    await expectInvalid(updateAccount(acc.id, { name: ' ' }));

    const cat = await createCustomCategory('Pets', 'lifestyle');
    expect(cat.id).toMatch(/^cc_/);
    await expectInvalid(createCustomCategory('pets', 'lifestyle'), /already exists/);
    await expectInvalid(createCustomCategory('Groceries', 'lifestyle'), /already exists/);
    await expectInvalid(createCustomCategory('Zoo', 'zoo' as 'other'));
    await upsertBudget(cat.id, 100000); // custom categories are budgetable

    await setRecurringDecision({ merchantKey: 'netflix', status: 'confirmed', cadence: 'monthly', expectedAmount: 64900 });
    await setRecurringDecision({ merchantKey: 'netflix', status: 'dismissed' });
    expect(await db.recurringDecisions.count()).toBe(1);
    await expectInvalid(setRecurringDecision({ merchantKey: 'netflix', status: 'confirmed', expectedAmount: 0 }));

    const sa = await createSavingAction({ type: 'custom', title: 'Cook more', baselineMonthly: 800000, targetMonthly: 500000, startMonth: '2025-02', status: 'active' });
    await updateSavingAction(sa.id, { status: 'completed' });
    expect((await db.savingActions.get(sa.id))!.status).toBe('completed');
    await expectInvalid(updateSavingAction(sa.id, { targetMonthly: -1 }));
    await expectInvalid(createSavingAction({ type: 'custom', title: 'x', baselineMonthly: 1, targetMonthly: 1, startMonth: '2025-13', status: 'active' }));
  });

  it('settings merge and validate', async () => {
    await updateSettings({ theme: 'dark', hideAmounts: true });
    await updateSettings({ p2pReviewThreshold: 100000 });
    expect((await db.meta.get(META_SETTINGS))!.value).toEqual({ theme: 'dark', hideAmounts: true, p2pReviewThreshold: 100000, onboardingDone: false });
    await expectInvalid(updateSettings({ p2pReviewThreshold: 0 }));
    await expectInvalid(updateSettings({ theme: 'neon' as 'dark' }));
  });
});

describe('deletion', () => {
  it('deleteAccount cascades atomically', async () => {
    await db.accounts.bulkAdd([makeAccount({ id: 'a1' }), makeAccount({ id: 'a2', mask: '2222' })]);
    await db.statements.bulkAdd([
      { id: 's1', accountId: 'a1', fileName: 'x', fileHash: 'h1', parserId: 'p', parserVersion: 1, totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 }, reconciliation: { status: 'unverified', checks: [], rowBalanceBreaks: 0 }, warnings: [], rowCount: 1, importedAt: '2025-01-01T00:00:00.000Z' },
    ]);
    await db.transactions.bulkAdd([
      makeTxn({ id: 'x1', accountId: 'a1', statementId: 's1', linkId: 'L', linkRole: 'transfer_out', linkedTxnId: 'x2', kind: 'self_transfer', kindSource: 'match' }),
      makeTxn({ id: 'x2', accountId: 'a2', statementId: 's2', rawDescription: 'XFERIN', direction: 'credit', linkId: 'L', linkRole: 'transfer_in', linkedTxnId: 'x1', kind: 'self_transfer', kindSource: 'match' }),
    ]);
    await db.rules.add({ id: 'r1', match: { field: 'merchantKey', op: 'equals', value: 'q' }, accountId: 'a1', set: { category: 'cash' }, enabled: true, createdAt: 't' });
    await deleteAccount('a1');
    expect(await db.accounts.toArray().then((a) => a.map((x) => x.id))).toEqual(['a2']);
    expect(await db.statements.count()).toBe(0);
    expect(await db.rules.count()).toBe(0);
    const left = await db.transactions.toArray();
    expect(left.map((t) => t.id)).toEqual(['x2']);
    expect(left[0].linkId).toBeUndefined();
    await expectInvalid(deleteAccount('ghost'));
  });

  it('10. deleteAllData erases every table', async () => {
    await seedSwiggy();
    await setTransactionCategory('a', 'groceries', 'merchant');
    await upsertBudget('groceries', 1000);
    await createGoal({ name: 'G', target: 100 });
    await updateSettings({ theme: 'dark' });
    await deleteAllData();
    for (const t of db.tables) expect(await t.count(), t.name).toBe(0);
  });
});

describe('storage', () => {
  it('guards against missing navigator.storage', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    try {
      expect(await requestPersistentStorage()).toBe(false);
      expect(await getStorageStatus()).toEqual({ persisted: false });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  it('reports usage when available', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const storage = {
      persist: vi.fn().mockResolvedValue(true),
      persisted: vi.fn().mockResolvedValue(false),
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }),
    };
    Object.defineProperty(globalThis, 'navigator', { value: { storage }, configurable: true });
    try {
      expect(await requestPersistentStorage()).toBe(true);
      expect(await getStorageStatus()).toEqual({ persisted: false, usageBytes: 10, quotaBytes: 100 });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });
});

describe('bulk selection', () => {
  it('setTransactionsCategory sets user_txn on every selected row with one feedback event each', async () => {
    await seedSwiggy();
    const res = await setTransactionsCategory(['a', 'b', 'z', 'a', 'ghost'], 'groceries');
    expect(res).toEqual({ updated: 3 });
    for (const id of ['a', 'b', 'z']) {
      expect(await db.transactions.get(id)).toMatchObject({ category: 'groceries', categorySource: 'user_txn', confidence: 1, needsReview: false, reasons: ['You set this'] });
    }
    expect((await db.transactions.get('c'))!.category).toBe('travel');
    expect(await db.rules.count()).toBe(0);
    const events = await db.feedback.toArray();
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.action === 'category' && e.scope === 'this' && e.after.category === 'groceries')).toBe(true);
    expect(events.find((e) => e.txnId === 'z')!.before.category).toBe('transport');
    await expectInvalid(setTransactionsCategory([], 'groceries'), /Select/);
    await expectInvalid(setTransactionsCategory(['a'], 'nonsense'), /category/i);
    await expectInvalid(setTransactionsCategory(['ghost'], 'groceries'));
  });

  it('setTransactionsKind applies a user kind, resets categories sensibly and relinks once', async () => {
    await seedSwiggy();
    vi.mocked(linkTransactions).mockClear();
    const res = await setTransactionsKind(['a', 'b', 'z'], 'investment');
    expect(res.updated).toBe(3);
    for (const id of ['a', 'b', 'z']) {
      expect(await db.transactions.get(id)).toMatchObject({ kind: 'investment', kindSource: 'user', category: 'investments', categorySource: 'kind_default', needsReview: false });
    }
    expect(vi.mocked(linkTransactions)).toHaveBeenCalledTimes(1);
    expect(await db.feedback.count()).toBe(3);
    await expectInvalid(setTransactionsKind(['a'], 'unknown'));
    await expectInvalid(setTransactionsKind([], 'expense'));
  });

  it('setTransactionsKind un-pairs previously linked rows', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'o', rawDescription: 'XFEROUT TO SELF', amount: 500, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default', linkId: 'L', linkRole: 'transfer_out', linkedTxnId: 'i' }),
      makeTxn({ id: 'i', rawDescription: 'XFERIN FROM SELF', direction: 'credit', amount: 500, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default', linkId: 'L', linkRole: 'transfer_in', linkedTxnId: 'o' }),
    ]);
    await setTransactionsKind(['o', 'i'], 'expense');
    const rows = await db.transactions.toArray();
    expect(rows.every((r) => r.kind === 'expense' && !r.linkId)).toBe(true);
  });
});
