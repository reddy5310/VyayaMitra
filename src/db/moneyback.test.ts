import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, ValidationError } from './actions';
import { exportBackup, restoreBackup } from './backup';
import { META_MIGRATIONS, VyayaMitraDB, db, resetDatabaseForTests } from './db';
import {
  allocateCredit,
  closeRefundCase,
  createRefundCase,
  deleteCardPolicy,
  refreshMoneyLinks,
  removeAllocation,
  removeChargeLink,
  reopenRefundCase,
  saveCardPolicy,
  setAdviserPreference,
  setChargeLink,
  updateRefundCase,
} from './moneyback';
import { fakeLink, fakeLinkCharges, fakeProposeRefunds, fileOf, makeAccount, makeParsed, makeRow, makeTxn } from './testkit';
import { commitImport, deleteStatement, prepareImport, reprocessLedger } from '@/engine/import';
import { linkCharges, linkTransactions, proposeRefundAllocations } from '@/engine/match';
import { parseStatement } from '@/parsing';

vi.mock('@/engine/understand', async () => {
  const k = await import('./testkit');
  return {
    understand: vi.fn(k.fakeUnderstand),
    trainLearnedModel: vi.fn(k.fakeTrain),
    buildCalibration: vi.fn(k.fakeCalibration),
    ruleMatches: k.fakeRuleMatches,
    normalizeMerchantKey: (s: string) => s.trim().toLowerCase(),
  };
});
vi.mock('@/engine/match', async () => {
  const k = await import('./testkit');
  return {
    linkTransactions: vi.fn(k.fakeLink),
    proposeRefundAllocations: vi.fn(k.fakeProposeRefunds),
    linkCharges: vi.fn(k.fakeLinkCharges),
  };
});
vi.mock('@/parsing', async () => ({ ...(await import('@/parsing/errors')), parseStatement: vi.fn() }));

const blobOf = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.clearAllMocks();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
  vi.mocked(proposeRefundAllocations).mockImplementation(fakeProposeRefunds);
  vi.mocked(linkCharges).mockImplementation(fakeLinkCharges);
});

async function seed() {
  await db.accounts.add(makeAccount());
  await db.statements.add({
    id: 'st-1', accountId: 'acc-1', fileName: 'x', fileHash: 'h', parserId: 'p', parserVersion: 1,
    totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
    reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 }, warnings: [], rowCount: 3, importedAt: 't',
  });
  await db.transactions.bulkAdd([
    makeTxn({ id: 'buy', rawDescription: 'MYNTRA ORDER', merchant: 'Myntra', merchantKey: 'myntra', amount: 300000 }),
    makeTxn({ id: 'c1', rawDescription: 'MYNTRA REFUND', merchant: 'Myntra', merchantKey: 'myntra', amount: 100000, direction: 'credit' }),
    makeTxn({ id: 'c2', rawDescription: 'GENERIC CREDIT', merchant: 'Misc', merchantKey: 'misc', amount: 100000, direction: 'credit' }),
  ]);
}

describe('schema v3 -> v4 migration', () => {
  it('keeps all v3 data and adds the money-back tables', async () => {
    const name = 'migration-v4-test';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(1).stores({
      accounts: 'id',
      statements: 'id, accountId, fileHash',
      transactions: 'id, accountId, statementId, date, linkId, merchantKey, &[accountId+fingerprint]',
      rules: 'id',
      customCategories: 'id',
      budgets: 'id, &category',
      goals: 'id',
      goalContributions: 'id, goalId',
      recurringDecisions: 'merchantKey',
      savingActions: 'id',
      meta: 'key',
    });
    old.version(2).stores({ templates: 'id, [institution+fileKind], source', feedback: 'id, txnId, merchantKey, at' });
    old.version(3).stores({ insightFeedback: 'id, key, insightId, at', monthReviews: 'month' });
    await old.open();
    await old.table('accounts').add(makeAccount({ id: 'acc' }));
    await old.table('transactions').add(makeTxn({ id: 'keep', accountId: 'acc', fingerprint: 'f', tag: 'planned' }));
    await old.table('insightFeedback').add({ id: 'i', key: 'k', insightId: 'x', action: 'dismissed', at: 't' });
    await old.table('monthReviews').put({ month: '2025-01', status: 'completed', notes: ['n'], nextActionIds: [], updatedAt: 't' });
    await old.table('meta').put({ key: META_MIGRATIONS, value: [{ version: 2, at: 't' }, { version: 3, at: 't' }] });
    old.close();

    const v4 = new VyayaMitraDB(name);
    await v4.open();
    expect(v4.verno).toBe(4);
    expect((await v4.transactions.get('keep'))!.tag).toBe('planned');
    expect(await v4.insightFeedback.count()).toBe(1);
    expect((await v4.monthReviews.get('2025-01'))!.notes).toEqual(['n']);
    expect((await v4.meta.get(META_MIGRATIONS))!.value).toMatchObject([{ version: 2 }, { version: 3 }, { version: 4 }]);
    await v4.refundCases.add({ id: 'c', purchaseTxnIds: ['keep'], merchant: 'm', merchantKey: 'm', expectedSource: 'unknown', state: 'open', createdAt: 't', updatedAt: 't' });
    await v4.refundAllocations.add({ id: 'a', caseId: 'c', creditTxnId: 'x', amount: 1, source: 'user', reason: 'r', createdAt: 't' });
    await v4.chargeLinks.add({ id: 'l', groupId: 'g', txnId: 'keep', chargeType: 'annual_fee', role: 'charge', source: 'user', reason: 'r' });
    await v4.adviserPreferences.put({ category: 'groceries', preference: 'protected', updatedAt: 't' });
    expect(await v4.refundCases.where('state').equals('open').count()).toBe(1);
    expect(await v4.refundAllocations.where('creditTxnId').equals('x').count()).toBe(1);
    expect(await v4.chargeLinks.where('groupId').equals('g').count()).toBe(1);
    v4.close();
    await Dexie.delete(name);
  });
});

describe('refund cases', () => {
  it('creates a case (expectedSource follows the input), updates, closes and reopens', async () => {
    await seed();
    const unknown = await createRefundCase({ purchaseTxnIds: ['buy'] });
    expect(unknown).toMatchObject({ expectedSource: 'unknown', state: 'open', merchantKey: 'myntra', purchaseTxnIds: ['buy'] });
    expect(unknown.expectedAmount).toBeUndefined();
    // a case the matcher opened on its own is adopted, not duplicated
    expect((await createRefundCase({ purchaseTxnIds: ['buy'] })).id).toBe(unknown.id);
    await updateRefundCase(unknown.id, { reason: 'wrong size' });
    await expect(createRefundCase({ purchaseTxnIds: ['buy'] })).rejects.toThrow(/already tracking/);
    await closeRefundCase(unknown.id, 'written_off');
    expect(await db.refundCases.get(unknown.id)).toMatchObject({ state: 'closed', closedReason: 'written_off' });
    await reopenRefundCase(unknown.id);
    const reopened = (await db.refundCases.get(unknown.id))!;
    expect(reopened.state).toBe('open');
    expect('closedReason' in reopened).toBe(false);

    await updateRefundCase(unknown.id, { expectedAmount: 250000, reason: ' wrong size ', promisedDate: '2025-02-10' });
    expect(await db.refundCases.get(unknown.id)).toMatchObject({ expectedAmount: 250000, expectedSource: 'user', reason: 'wrong size', promisedDate: '2025-02-10' });
    await updateRefundCase(unknown.id, { expectedAmount: undefined });
    expect(await db.refundCases.get(unknown.id)).toMatchObject({ expectedSource: 'unknown' });

    await closeRefundCase(unknown.id, 'received');
    const withAmount = await createRefundCase({ purchaseTxnIds: ['buy'], expectedAmount: 120000, reason: 'Returned', notes: 'n' });
    expect(withAmount).toMatchObject({ expectedSource: 'user', expectedAmount: 120000, reason: 'Returned' });
  });

  it('validates', async () => {
    await seed();
    await expect(createRefundCase({ purchaseTxnIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRefundCase({ purchaseTxnIds: ['ghost'] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRefundCase({ purchaseTxnIds: ['c1'] })).rejects.toBeInstanceOf(ValidationError); // a credit is not a purchase
    await expect(createRefundCase({ purchaseTxnIds: ['buy'], expectedAmount: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRefundCase({ purchaseTxnIds: ['buy'], promisedDate: 'soon' })).rejects.toBeInstanceOf(ValidationError);
    await expect(closeRefundCase('ghost', 'received')).rejects.toBeInstanceOf(ValidationError);
    await expect(closeRefundCase((await createRefundCase({ purchaseTxnIds: ['buy'] })).id, 'nope' as 'received')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('allocations', () => {
  it('splits one credit across cases but never over-allocates it', async () => {
    await seed();
    await db.transactions.add(makeTxn({ id: 'buy2', merchantKey: 'ajio', merchant: 'Ajio', amount: 50000 }));
    const a = await createRefundCase({ purchaseTxnIds: ['buy'] });
    const b = await createRefundCase({ purchaseTxnIds: ['buy2'] });
    const first = await allocateCredit({ caseId: a.id, creditTxnId: 'c1', amount: 60000, purchaseTxnId: 'buy' });
    expect(first).toMatchObject({ source: 'user', amount: 60000 });
    await allocateCredit({ caseId: b.id, creditTxnId: 'c1', amount: 40000 });
    await expect(allocateCredit({ caseId: a.id, creditTxnId: 'c1', amount: 1 })).rejects.toThrow(/left to match/);
    expect(await db.refundAllocations.count()).toBe(2);
    await removeAllocation(first.id);
    await allocateCredit({ caseId: a.id, creditTxnId: 'c1', amount: 60000 });
    await expect(allocateCredit({ caseId: a.id, creditTxnId: 'c1', amount: 60001 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects debits, unknown rows and foreign purchases', async () => {
    await seed();
    const c = await createRefundCase({ purchaseTxnIds: ['buy'] });
    await expect(allocateCredit({ caseId: c.id, creditTxnId: 'buy', amount: 1 })).rejects.toThrow(/received/);
    await expect(allocateCredit({ caseId: c.id, creditTxnId: 'ghost', amount: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(allocateCredit({ caseId: 'ghost', creditTxnId: 'c1', amount: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(allocateCredit({ caseId: c.id, creditTxnId: 'c1', amount: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(allocateCredit({ caseId: c.id, creditTxnId: 'c1', amount: 10, purchaseTxnId: 'c2' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('refreshMoneyLinks', () => {
  it('persists auto cases and allocations, is idempotent, and never touches user decisions', async () => {
    await seed();
    const first = await refreshMoneyLinks();
    expect(first.allocations).toBe(1);
    const cases = await db.refundCases.toArray();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ expectedSource: 'unknown', purchaseTxnIds: ['buy'] });
    const allocs = await db.refundAllocations.toArray();
    expect(allocs).toEqual([expect.objectContaining({ caseId: cases[0].id, creditTxnId: 'c1', amount: 100000, source: 'auto' })]);

    const again = await refreshMoneyLinks();
    expect(again.allocations).toBe(0);
    expect(await db.refundAllocations.count()).toBe(1);
    expect(await db.refundCases.count()).toBe(1);
  });

  it('skips a proposal that would over-allocate a credit, with a reason', async () => {
    await seed();
    vi.mocked(proposeRefundAllocations).mockReturnValueOnce({
      allocations: [
        { caseId: 'new', creditTxnId: 'c1', purchaseTxnId: 'buy', amount: 90000, source: 'auto', reason: 'a' },
        { caseId: 'new', creditTxnId: 'c1', purchaseTxnId: 'buy', amount: 90000, source: 'auto', reason: 'b' },
        { caseId: 'new', creditTxnId: 'buy', amount: 1, source: 'auto', reason: 'debit' },
      ],
      newCases: [{ tempKey: 'new', purchaseTxnIds: ['buy'], merchant: 'Myntra', merchantKey: 'myntra', expectedSource: 'unknown', state: 'open' }],
      ambiguous: [],
      unmatched: [],
    });
    const res = await refreshMoneyLinks();
    expect(res.allocations).toBe(1);
    expect(res.skipped.some((s) => /over-allocate/.test(s))).toBe(true);
    expect((await db.refundAllocations.toArray()).reduce((s, a) => s + a.amount, 0)).toBeLessThanOrEqual(100000);
  });

  it('user allocations count against the credit and are kept', async () => {
    await seed();
    const c = await createRefundCase({ purchaseTxnIds: ['buy'] });
    await allocateCredit({ caseId: c.id, creditTxnId: 'c1', amount: 70000 });
    await refreshMoneyLinks();
    const rows = await db.refundAllocations.toArray();
    expect(rows.filter((r) => r.source === 'user')).toHaveLength(1);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeLessThanOrEqual(100000);
  });

  it('a removed automatic allocation is not put straight back', async () => {
    await seed();
    await refreshMoneyLinks();
    const [auto] = await db.refundAllocations.toArray();
    await removeAllocation(auto.id);
    await refreshMoneyLinks();
    expect(await db.refundAllocations.count()).toBe(0);
  });

  it('survives a matcher failure without blocking', async () => {
    await seed();
    vi.mocked(proposeRefundAllocations).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await refreshMoneyLinks();
    warn.mockRestore();
    expect(res.skipped).toContain('Refund matching is unavailable');
  });
});

describe('through the import pipeline', () => {
  const mockParse = vi.mocked(parseStatement);
  const purchaseRows = [makeRow({ date: '2025-03-02', amount: 300000, direction: 'debit', balanceAfter: 700000, description: 'MYNTRA ORDER', reference: 'P1' })];
  const refundRows = [
    makeRow({ date: '2025-03-20', amount: 100000, direction: 'credit', balanceAfter: 800000, description: 'MYNTRA REFUND', reference: 'R1' }),
    makeRow({ date: '2025-03-21', amount: 200000, direction: 'debit', balanceAfter: 600000, description: 'ANNUAL FEE CARD', reference: 'F1' }),
  ];

  async function importRows(name: string, rows: typeof purchaseRows, mask = '1234') {
    mockParse.mockResolvedValueOnce(makeParsed(rows, { accountMask: mask }));
    return commitImport(await prepareImport(fileOf(name, name)), { mode: 'add' });
  }

  it('copies chargeType, links refunds after commit, and cleans up on delete', async () => {
    await importRows('buy.pdf', purchaseRows);
    expect(await db.refundAllocations.count()).toBe(0);
    const refund = await importRows('refund.pdf', refundRows);
    const fee = (await db.transactions.toArray()).find((t) => t.rawDescription === 'ANNUAL FEE CARD')!;
    expect(fee.chargeType).toBe('annual_fee');
    expect(await db.refundAllocations.count()).toBe(1);
    expect(await db.refundCases.count()).toBe(1);
    expect(await db.chargeLinks.toArray()).toEqual([expect.objectContaining({ txnId: fee.id, chargeType: 'annual_fee', source: 'auto' })]);

    await reprocessLedger();
    expect((await db.transactions.get(fee.id))!.chargeType).toBe('annual_fee');
    expect(await db.refundAllocations.count()).toBe(1);

    await deleteStatement(refund.statementId);
    expect(await db.refundAllocations.count()).toBe(0);
    expect(await db.chargeLinks.count()).toBe(0);
    expect(await db.refundCases.count()).toBe(1); // the purchase is still there
  });

  it('deleting the purchase side removes the case and allocation; deleteAccount removes everything', async () => {
    const buy = await importRows('buy.pdf', purchaseRows);
    await importRows('refund.pdf', refundRows);
    await deleteStatement(buy.statementId);
    expect(await db.refundCases.count()).toBe(0);
    expect(await db.refundAllocations.count()).toBe(0);

    const second = await importRows('again.pdf', [makeRow({ date: '2025-04-02', amount: 50000, direction: 'debit', balanceAfter: 1, description: 'MYNTRA ORDER 2', reference: 'P9' })]);
    expect(second.inserted).toBe(1);
    const user = await createRefundCase({ purchaseTxnIds: [(await db.transactions.filter((t) => t.rawDescription === 'MYNTRA ORDER 2').first())!.id] });
    expect(user.id).toBeTruthy();
    await deleteAccount((await db.accounts.toArray())[0].id);
    expect(await db.refundCases.count()).toBe(0);
    expect(await db.chargeLinks.count()).toBe(0);
  });
});

describe('charge links, card policies, adviser preferences', () => {
  it('user links replace automatic ones and survive refresh', async () => {
    await seed();
    await db.transactions.add(makeTxn({ id: 'fee', chargeType: 'annual_fee', rawDescription: 'ANNUAL FEE' }));
    await refreshMoneyLinks();
    expect((await db.chargeLinks.toArray())[0].source).toBe('auto');
    await setChargeLink({ groupId: 'g-user', txnId: 'fee', chargeType: 'fuel_surcharge', role: 'charge', relatedPurchaseTxnId: 'buy' });
    expect(await db.chargeLinks.toArray()).toEqual([expect.objectContaining({ source: 'user', chargeType: 'fuel_surcharge', reason: 'You linked this' })]);
    await refreshMoneyLinks();
    expect(await db.chargeLinks.count()).toBe(1);
    expect((await db.chargeLinks.toArray())[0].source).toBe('user');
    await removeChargeLink((await db.chargeLinks.toArray())[0].id);
    await expect(setChargeLink({ groupId: 'g', txnId: 'ghost', chargeType: 'annual_fee', role: 'charge' })).rejects.toBeInstanceOf(ValidationError);
    await expect(setChargeLink({ groupId: 'g', txnId: 'fee', chargeType: 'nope' as 'annual_fee', role: 'charge' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('removed automatic links are not re-added', async () => {
    await seed();
    await db.transactions.add(makeTxn({ id: 'fee', chargeType: 'annual_fee' }));
    await refreshMoneyLinks();
    await removeChargeLink((await db.chargeLinks.toArray())[0].id);
    await refreshMoneyLinks();
    expect(await db.chargeLinks.count()).toBe(0);
  });

  it('saves and validates card policies', async () => {
    await seed();
    const p = await saveCardPolicy({ accountId: 'acc-1', chargeType: 'fuel_surcharge', summary: ' 1% waived on 400 to 4000 ', waiverMinPurchase: 40000, waiverMaxPurchase: 400000, cycleCap: 10000, taxReversed: null });
    expect(p.summary).toBe('1% waived on 400 to 4000');
    const updated = await saveCardPolicy({ id: p.id, accountId: 'acc-1', chargeType: 'fuel_surcharge', summary: 'updated', taxReversed: true });
    expect(updated).toMatchObject({ id: p.id, createdAt: p.createdAt, taxReversed: true });
    expect(updated.cycleCap).toBeUndefined();
    await expect(saveCardPolicy({ accountId: 'ghost', chargeType: 'annual_fee', summary: 's', taxReversed: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveCardPolicy({ accountId: 'acc-1', chargeType: 'annual_fee', summary: 's', waiverMinPurchase: 500, waiverMaxPurchase: 100, taxReversed: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveCardPolicy({ accountId: 'acc-1', chargeType: 'annual_fee', summary: '  ', taxReversed: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveCardPolicy({ id: 'ghost', accountId: 'acc-1', chargeType: 'annual_fee', summary: 's', taxReversed: null })).rejects.toBeInstanceOf(ValidationError);
    await deleteCardPolicy(p.id);
    expect(await db.cardPolicies.count()).toBe(0);
  });

  it('sets and clears adviser preferences, one per category', async () => {
    await setAdviserPreference('groceries', 'protected');
    await setAdviserPreference('groceries', 'adjustable');
    expect(await db.adviserPreferences.toArray()).toEqual([expect.objectContaining({ category: 'groceries', preference: 'adjustable' })]);
    await expect(setAdviserPreference('nope', 'fixed')).rejects.toBeInstanceOf(ValidationError);
    await expect(setAdviserPreference('groceries', 'bad' as 'fixed')).rejects.toBeInstanceOf(ValidationError);
    await setAdviserPreference('groceries', null);
    expect(await db.adviserPreferences.count()).toBe(0);
  });
});

describe('backup v4', () => {
  it('round-trips refund cases, allocations (user and auto), charge links, policies and preferences', async () => {
    await seed();
    await db.transactions.add(makeTxn({ id: 'fee', chargeType: 'annual_fee' }));
    await refreshMoneyLinks();
    const c = await createRefundCase({ purchaseTxnIds: ['buy'], expectedAmount: 120000 });
    await allocateCredit({ caseId: c.id, creditTxnId: 'c2', amount: 40000 });
    await setChargeLink({ groupId: 'g', txnId: 'fee', chargeType: 'annual_fee', role: 'charge', reason: 'mine' });
    await saveCardPolicy({ accountId: 'acc-1', chargeType: 'annual_fee', summary: 'waived above 1L spend', taxReversed: false });
    await setAdviserPreference('groceries', 'protected');
    const snap = async () => ({
      cases: await db.refundCases.toArray(),
      allocs: await db.refundAllocations.toArray(),
      links: await db.chargeLinks.toArray(),
      policies: await db.cardPolicies.toArray(),
      prefs: await db.adviserPreferences.toArray(),
      fee: await db.transactions.get('fee'),
    });
    const before = await snap();
    expect(before.allocs.map((a) => a.source).sort()).toEqual(['auto', 'user']);
    for (const passphrase of [undefined, 'pw']) {
      const blob = await exportBackup({ passphrase });
      await resetDatabaseForTests();
      const res = await restoreBackup(blob, { mode: 'replace', passphrase });
      expect(res.counts).toMatchObject({ refundCases: 1, refundAllocations: 2, chargeLinks: 1, cardPolicies: 1, adviserPreferences: 1 });
      expect(await snap()).toEqual(before);
    }
    const again = await restoreBackup(await exportBackup(), { mode: 'merge' });
    expect(again.counts).toMatchObject({ refundCases: 0, refundAllocations: 0, chargeLinks: 0, cardPolicies: 0, adviserPreferences: 0 });
  });

  it('still restores v1-v3 backups and rejects an over-allocated credit', async () => {
    const base = { accounts: [makeAccount({ id: 'old' })], statements: [], transactions: [], rules: [], customCategories: [], budgets: [], goals: [], goalContributions: [], recurringDecisions: [], savingActions: [] };
    for (const [v, extra] of [[1, {}], [2, { templates: [], feedback: [] }], [3, { templates: [], feedback: [], insightFeedback: [], monthReviews: [] }]] as const) {
      const res = await restoreBackup(blobOf({ format: 'vyayamitra-backup', schemaVersion: v, appVersion: 'x', createdAt: 't', data: { ...base, ...extra } }), { mode: 'replace' });
      expect(res.counts).toMatchObject({ accounts: 1, refundCases: 0, chargeLinks: 0 });
    }

    await seed();
    await refreshMoneyLinks();
    const good = JSON.parse(await (await exportBackup()).text());
    good.data.refundAllocations.push({ ...good.data.refundAllocations[0], id: 'extra', amount: 100000 });
    const before = await db.refundAllocations.count();
    await expect(restoreBackup(blobOf(good), { mode: 'replace' })).rejects.toThrow(/more than its amount/);
    expect(await db.refundAllocations.count()).toBe(before);
  });
});
