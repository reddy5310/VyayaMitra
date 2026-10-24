import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetDatabaseForTests } from '@/db/db';
import { fakeLink, fakeRuleMatches, fakeTrain, fakeUnderstand, fileOf, makeAccount, makeParsed, makeRow, makeTxn } from '@/db/testkit';
import { linkTransactions } from '@/engine/match';
import { IncorrectPasswordError, PasswordRequiredError, parseStatement } from '@/parsing';
import {
  commitImport,
  deleteStatement,
  prepareImport,
  reprocessLedger,
  retargetPreview,
  rowFingerprint,
  computeFingerprints,
} from './index';

vi.mock('@/parsing', async () => ({
  ...(await import('@/parsing/errors')),
  parseStatement: vi.fn(),
  listSupportedFormats: () => [],
  ACCEPTED_FILE_TYPES: '.pdf',
}));
vi.mock('@/engine/understand', async () => {
  const k = await import('@/db/testkit');
  return {
    understand: vi.fn(k.fakeUnderstand),
    trainLearnedModel: vi.fn(k.fakeTrain),
    buildCalibration: vi.fn(k.fakeCalibration),
    ruleMatches: k.fakeRuleMatches,
    normalizeMerchantKey: (s: string) => s.toLowerCase(),
  };
});
vi.mock('@/engine/match', async () => {
  const k = await import('@/db/testkit');
  return { linkTransactions: vi.fn(k.fakeLink) };
});

const mockParse = vi.mocked(parseStatement);

/** A small bank statement: rows carry running balances and SerNo references. */
function bankRows(spec: [string, number, 'debit' | 'credit', number, string][]) {
  return spec.map(([date, amount, direction, balanceAfter, description], i) =>
    makeRow({ date, amount, direction, balanceAfter, description, reference: `S${date}${i}` }),
  );
}

const JAN = bankRows([
  ['2025-01-02', 25000, 'debit', 975000, 'SWIGGY ORDER 1'],
  ['2025-01-05', 100000, 'credit', 1075000, 'ACME SALARY'],
  ['2025-01-09', 4300, 'debit', 1070700, 'COFFEE SHOP'],
]);

async function counts() {
  return {
    accounts: await db.accounts.count(),
    statements: await db.statements.count(),
    transactions: await db.transactions.count(),
  };
}

async function importFile(name: string, rows = JAN, mode: 'add' | 'replace' = 'add', replaceStatementId?: string) {
  mockParse.mockResolvedValueOnce(makeParsed(rows));
  const preview = await prepareImport(fileOf(name, `bytes:${name}`));
  return commitImport(preview, { mode, replaceStatementId });
}

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.clearAllMocks();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

describe('rowFingerprint', () => {
  const row = makeRow({ date: '2025-01-02', amount: 4300, description: 'Coffee  Shop', balanceAfter: 5000, reference: 'R1' });

  it('is deterministic, synchronous and hex', () => {
    const a = rowFingerprint('acc', row, 0);
    expect(a).toBe(rowFingerprint('acc', row, 0));
    expect(a).toMatch(/^[0-9a-f]{28}$/);
  });

  it('changes with account, occurrence, balance and reference but not description spacing/case', () => {
    const base = rowFingerprint('acc', row, 0);
    expect(rowFingerprint('other', row, 0)).not.toBe(base);
    expect(rowFingerprint('acc', row, 1)).not.toBe(base);
    expect(rowFingerprint('acc', { ...row, balanceAfter: 5001 }, 0)).not.toBe(base);
    expect(rowFingerprint('acc', { ...row, reference: 'R2' }, 0)).not.toBe(base);
    expect(rowFingerprint('acc', { ...row, description: 'COFFEE SHOP' }, 0)).toBe(base);
  });

  it('numbers identical rows by occurrence', () => {
    const rows = [row, makeRow({ ...row }), makeRow({ ...row, amount: 999 })];
    const fps = computeFingerprints('acc', rows);
    expect(new Set(fps).size).toBe(3);
    expect(fps[0]).toBe(rowFingerprint('acc', row, 0));
    expect(fps[1]).toBe(rowFingerprint('acc', row, 1));
    expect(fps[2]).toBe(rowFingerprint('acc', rows[2], 0));
  });
});

describe('prepareImport', () => {
  it('writes nothing and proposes a new account when none matches', async () => {
    mockParse.mockResolvedValueOnce(makeParsed(JAN, { cardMasks: ['1234', '9999'] }));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    expect(await counts()).toEqual({ accounts: 0, statements: 0, transactions: 0 });
    expect(preview.account.existingAccountId).toBeUndefined();
    expect(preview.account.proposed).toMatchObject({
      name: 'ICICI Savings ••1234',
      institution: 'ICICI',
      type: 'savings',
      mask: '1234',
      extraMasks: ['9999'],
      holderName: 'TEST HOLDER',
    });
    expect(preview.stats).toMatchObject({ total: 3, new: 3, duplicates: 0, debits: 29300, credits: 100000 });
    expect(preview.file.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches an existing account by mask or extra mask and reports other candidates', async () => {
    await db.accounts.bulkAdd([
      makeAccount({ id: 'a', mask: '1111', extraMasks: ['1234'] }),
      makeAccount({ id: 'b', mask: '2222' }),
    ]);
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    expect(preview.account.existingAccountId).toBe('a');
    expect(preview.candidateAccountIds).toEqual(['b']);
  });

  it('understands rows against own accounts and user rules', async () => {
    await db.accounts.add(makeAccount());
    await db.rules.add({ id: 'r', match: { field: 'merchantKey', op: 'equals', value: 'coffee' }, set: { category: 'food_dining' }, enabled: true, createdAt: '2025-01-01T00:00:00.000Z' });
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    expect(preview.rows[2].understanding.categorySource).toBe('user_rule');
    expect(preview.stats.needsReview).toBe(0);
  });

  it('lists overlapping statements of the account', async () => {
    await importFile('jan.pdf');
    mockParse.mockResolvedValueOnce(makeParsed(bankRows([['2025-01-08', 100, 'debit', 5, 'X']]), { periodStart: '2025-01-08', periodEnd: '2025-02-07' }));
    const preview = await prepareImport(fileOf('feb.pdf', 'feb'));
    expect(preview.overlapping).toHaveLength(1);
    expect(preview.overlapping[0].fileName).toBe('jan.pdf');
  });

  it('retargets to another account without writing', async () => {
    await db.accounts.bulkAdd([makeAccount({ id: 'a' }), makeAccount({ id: 'b', mask: '7777', name: 'Other' })]);
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    const moved = await retargetPreview(preview, { accountId: 'b' });
    expect(moved.account.existingAccountId).toBe('b');
    const fresh = await retargetPreview(preview, { newAccount: { name: 'Fresh', institution: 'HDFC', type: 'savings', currency: 'INR' } });
    expect(fresh.account.existingAccountId).toBeUndefined();
    expect(fresh.account.proposed.name).toBe('Fresh');
    expect(await db.transactions.count()).toBe(0);
  });
});

describe('failed imports can never lose data', () => {
  it('1. a password failure during prepare leaves existing data intact', async () => {
    await importFile('jan.pdf');
    const before = await counts();
    const snapshot = await db.transactions.toArray();

    mockParse.mockRejectedValueOnce(new PasswordRequiredError());
    await expect(prepareImport(fileOf('feb.pdf', 'feb'))).rejects.toBeInstanceOf(PasswordRequiredError);
    mockParse.mockRejectedValueOnce(new IncorrectPasswordError());
    await expect(prepareImport(fileOf('feb.pdf', 'feb'), { password: 'nope' })).rejects.toBeInstanceOf(IncorrectPasswordError);

    expect(await counts()).toEqual(before);
    expect(await db.transactions.toArray()).toEqual(snapshot);
  });

  it('2. a throw midway through commit leaves the database unchanged (new account, add mode)', async () => {
    await importFile('jan.pdf');
    const before = await counts();
    mockParse.mockResolvedValueOnce(makeParsed(bankRows([['2025-02-02', 500, 'debit', 1, 'UBER TRIP']]), { accountMask: '5555' }));
    const preview = await prepareImport(fileOf('other.pdf', 'other'));
    vi.mocked(linkTransactions).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(commitImport(preview, { mode: 'add' })).rejects.toThrow('boom');
    expect(await counts()).toEqual(before);
  });

  it('2b. a throw during a replace restores the old statement and its rows', async () => {
    const first = await importFile('jan.pdf');
    const before = await db.transactions.toArray();
    mockParse.mockResolvedValueOnce(makeParsed(bankRows([['2025-01-03', 777, 'debit', 1, 'UBER TRIP']])));
    const preview = await prepareImport(fileOf('jan-v2.pdf', 'jan v2'));
    vi.mocked(linkTransactions).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(commitImport(preview, { mode: 'replace', replaceStatementId: first.statementId })).rejects.toThrow('boom');
    expect(await db.statements.count()).toBe(1);
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  });

  it('2c. a unique-index violation aborts everything', async () => {
    const first = await importFile('jan.pdf');
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan-again.pdf', 'again'));
    // Simulate the database rejecting the insert after the old statement was already deleted.
    const spy = vi.spyOn(db.transactions, 'bulkAdd').mockRejectedValueOnce(new Error('ConstraintError'));
    await expect(commitImport({ ...preview }, { mode: 'replace', replaceStatementId: first.statementId })).rejects.toThrow('ConstraintError');
    spy.mockRestore();
    expect(await db.statements.count()).toBe(1);
    expect(await db.transactions.count()).toBe(3);
  });
});

describe('de-duplication', () => {
  it('3. importing the same file twice inserts 0 the second time and reports alreadyImported', async () => {
    const first = await importFile('jan.pdf');
    expect(first).toMatchObject({ inserted: 3, skippedDuplicates: 0 });

    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'bytes:jan.pdf'));
    expect(preview.alreadyImported).toMatchObject({ statementId: first.statementId, accountId: first.accountId });
    expect(preview.stats).toMatchObject({ new: 0, duplicates: 3 });
    expect(preview.rows.every((r) => r.duplicateOf)).toBe(true);

    const second = await commitImport(preview, { mode: 'add' });
    expect(second).toMatchObject({ inserted: 0, skippedDuplicates: 3, statementId: first.statementId });
    expect(await counts()).toEqual({ accounts: 1, statements: 1, transactions: 3 });
  });

  it('4. two identical rows in one statement are both inserted, and re-import dedupes both', async () => {
    const rows = [
      makeRow({ date: '2025-01-04', amount: 4300, description: 'COFFEE SHOP' }),
      makeRow({ date: '2025-01-04', amount: 4300, description: 'COFFEE SHOP' }),
      makeRow({ date: '2025-01-04', amount: 4300, description: 'COFFEE SHOP' }),
    ];
    const r = await importFile('coffee.pdf', rows);
    expect(r.inserted).toBe(3);
    expect(new Set((await db.transactions.toArray()).map((t) => t.fingerprint)).size).toBe(3);

    const again = await importFile('coffee-copy.pdf', rows);
    expect(again).toMatchObject({ inserted: 0, skippedDuplicates: 3 });
    expect(await db.transactions.count()).toBe(3);
  });

  it('5. overlapping statements dedupe only the shared rows', async () => {
    await importFile('jan.pdf');
    const febRows = bankRows([
      ['2025-01-05', 100000, 'credit', 1075000, 'ACME SALARY'], // shared (same running balance + reference pattern)
      ['2025-01-09', 4300, 'debit', 1070700, 'COFFEE SHOP'], // shared
      ['2025-01-20', 4300, 'debit', 1066400, 'COFFEE SHOP'], // same amount, different day: new
      ['2025-01-22', 12000, 'debit', 1054400, 'UBER TRIP'], // new
    ]);
    // References differ by index in bankRows(); align the shared ones with the January file.
    febRows[0].reference = JAN[1].reference;
    febRows[1].reference = JAN[2].reference;
    mockParse.mockResolvedValueOnce(makeParsed(febRows));
    const preview = await prepareImport(fileOf('jan-feb.pdf', 'jan-feb'));
    expect(preview.stats).toMatchObject({ total: 4, new: 2, duplicates: 2 });
    expect(preview.overlapping).toHaveLength(1);
    const res = await commitImport(preview, { mode: 'add' });
    expect(res).toMatchObject({ inserted: 2, skippedDuplicates: 2 });
    expect(await db.transactions.count()).toBe(5);
    expect(await db.statements.count()).toBe(2);
  });

  it('commit re-checks the database, not only the preview', async () => {
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const stale = await prepareImport(fileOf('jan.pdf', 'jan'));
    await importFile('jan-other-copy.pdf'); // lands after the preview was staged
    const res = await commitImport(stale, { mode: 'add' });
    expect(res).toMatchObject({ inserted: 0, skippedDuplicates: 3 });
    expect(await db.transactions.count()).toBe(3);
  });

  it('keepDuplicateIndexes inserts chosen duplicates with a distinct fingerprint; others stay skipped', async () => {
    await importFile('jan.pdf');
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan-again.pdf', 'again'));
    expect(preview.rows.every((r) => r.duplicateOf)).toBe(true);
    const res = await commitImport(preview, { mode: 'add', keepDuplicateIndexes: [1] });
    expect(res).toMatchObject({ inserted: 1, skippedDuplicates: 2 });
    const all = await db.transactions.toArray();
    expect(all).toHaveLength(4);
    const kept = all.filter((t) => t.fingerprint.includes(':kept:'));
    expect(kept).toHaveLength(1);
    expect(kept[0].rawDescription).toBe('ACME SALARY');

    // re-importing the same file adds nothing, and keeping it again gets a fresh identity
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const again = await prepareImport(fileOf('jan-3.pdf', 'third'));
    expect(await commitImport(again, { mode: 'add' })).toMatchObject({ inserted: 0, skippedDuplicates: 3 });
    expect(await db.transactions.count()).toBe(4);
    const twice = await commitImport(again, { mode: 'add', keepDuplicateIndexes: [1] });
    expect(twice.inserted).toBe(1);
    expect(new Set((await db.transactions.toArray()).map((t) => t.fingerprint)).size).toBe(5);
  });

  it('honours excluded rows', async () => {
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    const res = await commitImport(preview, { mode: 'add', excludeRowIndexes: [1] });
    expect(res.inserted).toBe(2);
    expect((await db.transactions.toArray()).some((t) => t.rawDescription === 'ACME SALARY')).toBe(false);
  });
});

describe('commit', () => {
  it('stores full transactions with understanding, source and statement totals', async () => {
    const res = await importFile('jan.pdf');
    const st = (await db.statements.get(res.statementId))!;
    expect(st).toMatchObject({ fileName: 'jan.pdf', rowCount: 3, totals: { debits: 29300, credits: 100000, debitCount: 2, creditCount: 1 } });
    const t = (await db.transactions.where('statementId').equals(res.statementId).toArray()).find((x) => x.rawDescription === 'SWIGGY ORDER 1')!;
    expect(t).toMatchObject({ accountId: res.accountId, merchantKey: 'swiggy', category: 'food_dining', categorySource: 'builtin_rule', amount: 25000, balanceAfter: 975000 });
    expect(t.source.rawLines).toEqual(['SWIGGY ORDER 1']);
    expect(res.needsReview).toBe(1); // the coffee shop is unrecognised
  });

  it('adds new card masks to the matched account', async () => {
    await db.accounts.add(makeAccount());
    mockParse.mockResolvedValueOnce(makeParsed(JAN, { cardMasks: ['1234', '4444'] }));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    await commitImport(preview, { mode: 'add' });
    expect((await db.accounts.get('acc-1'))!.extraMasks).toEqual(['4444']);
  });

  it('links across the ledger in the same transaction', async () => {
    const res = await importFile('x.pdf', bankRows([
      ['2025-01-02', 5000, 'debit', 1, 'XFEROUT TO SELF'],
      ['2025-01-02', 5000, 'credit', 2, 'XFERIN FROM SELF'],
    ]));
    expect(res.linked).toBe(2);
    const all = await db.transactions.toArray();
    expect(all.every((t) => t.kind === 'self_transfer' && t.linkId)).toBe(true);
  });

  it('6. replace mode swaps the statement atomically', async () => {
    const first = await importFile('jan.pdf');
    const corrected = bankRows([
      ['2025-01-02', 25000, 'debit', 975000, 'SWIGGY ORDER 1'],
      ['2025-01-12', 9900, 'debit', 965100, 'UBER TRIP'],
    ]);
    const res = await importFile('jan-corrected.pdf', corrected, 'replace', first.statementId);
    expect(res.inserted).toBe(2);
    expect(await db.statements.get(first.statementId)).toBeUndefined();
    expect(await db.statements.count()).toBe(1);
    const txns = await db.transactions.toArray();
    expect(txns).toHaveLength(2);
    expect(txns.every((t) => t.statementId === res.statementId)).toBe(true);
  });

  it('replace mode rejects a statement of another account and a missing id', async () => {
    const first = await importFile('jan.pdf');
    mockParse.mockResolvedValueOnce(makeParsed(JAN, { accountMask: '8888' }));
    const preview = await prepareImport(fileOf('other.pdf', 'other'));
    await expect(commitImport(preview, { mode: 'replace', replaceStatementId: first.statementId })).rejects.toThrow(/different account/);
    await expect(commitImport(preview, { mode: 'replace' })).rejects.toThrow(/which statement/);
    expect(await counts()).toEqual({ accounts: 1, statements: 1, transactions: 3 });
  });

  it('replace clears links that pointed at removed rows', async () => {
    const first = await importFile('pair.pdf', bankRows([
      ['2025-01-02', 5000, 'debit', 1, 'XFEROUT TO SELF'],
      ['2025-01-02', 5000, 'credit', 2, 'XFERIN FROM SELF'],
    ]));
    // A second statement (same account) holds a different row; make its row a partner of the first via manual link.
    const other = await importFile('x.pdf', bankRows([['2025-01-20', 111, 'debit', 3, 'UBER TRIP']]));
    const survivor = (await db.transactions.where('statementId').equals(other.statementId).first())!;
    const outLeg = (await db.transactions.where('statementId').equals(first.statementId).toArray()).find((t) => t.direction === 'debit')!;
    await db.transactions.update(survivor.id, { linkId: outLeg.linkId, linkRole: 'refund_of', linkedTxnId: outLeg.id, kind: 'refund', kindSource: 'match' });
    await importFile('pair-v2.pdf', bankRows([['2025-01-02', 7, 'debit', 9, 'UBER TRIP']]), 'replace', first.statementId);
    const after = (await db.transactions.get(survivor.id))!;
    expect(after.linkId).toBeUndefined();
    expect(after.linkedTxnId).toBeUndefined();
    expect(after.kind).toBe('expense'); // automatic kind restored
  });

  it('refuses an empty selection for a new account without creating it', async () => {
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    await expect(commitImport(preview, { mode: 'add', excludeRowIndexes: [0, 1, 2] })).rejects.toThrow(/Nothing to import/);
    expect(await counts()).toEqual({ accounts: 0, statements: 0, transactions: 0 });
  });

  it('rejects an invalid new account before writing', async () => {
    mockParse.mockResolvedValueOnce(makeParsed(JAN));
    const preview = await prepareImport(fileOf('jan.pdf', 'jan'));
    await expect(
      commitImport(preview, { mode: 'add', newAccount: { name: '  ', institution: 'ICICI', type: 'savings', currency: 'INR' } }),
    ).rejects.toThrow(/Account name/);
    expect(await counts()).toEqual({ accounts: 0, statements: 0, transactions: 0 });
  });
});

describe('deleteStatement and reprocessLedger', () => {
  it('deleteStatement removes rows and un-links their partners', async () => {
    const pair = await importFile('pair.pdf', bankRows([
      ['2025-01-02', 5000, 'debit', 1, 'XFEROUT TO SELF'],
      ['2025-01-02', 5000, 'credit', 2, 'XFERIN FROM SELF'],
    ]));
    expect((await db.transactions.toArray()).every((t) => t.linkId)).toBe(true);
    // Move the credit leg into a second statement so only one leg is deleted.
    const inLeg = (await db.transactions.toArray()).find((t) => t.direction === 'credit')!;
    await db.statements.add({ ...(await db.statements.get(pair.statementId))!, id: 'st-other', fileHash: 'h2' });
    await db.transactions.update(inLeg.id, { statementId: 'st-other' });

    await deleteStatement(pair.statementId);
    expect(await db.statements.get(pair.statementId)).toBeUndefined();
    const left = await db.transactions.toArray();
    expect(left).toHaveLength(1);
    expect(left[0].linkId).toBeUndefined();
    expect(left[0].kind).toBe('income');
  });

  it('deleteStatement of an unknown id throws and changes nothing', async () => {
    await importFile('jan.pdf');
    await expect(deleteStatement('nope')).rejects.toThrow();
    expect(await db.transactions.count()).toBe(3);
  });

  it('reprocessLedger re-understands automatic decisions and keeps user_txn', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'auto', rawDescription: 'SWIGGY ORDER', category: 'shopping', categorySource: 'builtin_rule' }),
      makeTxn({ id: 'mine', rawDescription: 'SWIGGY ORDER', category: 'travel', categorySource: 'user_txn', reasons: ['You set this'] }),
      makeTxn({ id: 'kind', rawDescription: 'SWIGGY ORDER', kind: 'investment', kindSource: 'user', category: 'investments', categorySource: 'kind_default', reasons: ['You set this'] }),
    ]);
    const changed = await reprocessLedger();
    expect(changed).toBe(1);
    expect((await db.transactions.get('auto'))!.category).toBe('food_dining');
    expect((await db.transactions.get('mine'))!.category).toBe('travel');
    const k = (await db.transactions.get('kind'))!;
    expect(k.kind).toBe('investment');
    expect(k.kindSource).toBe('user');
    // idempotent
    expect(await reprocessLedger()).toBe(0);
  });

  it('exposes the fakes used by this suite (sanity)', () => {
    expect(fakeRuleMatches).toBeTypeOf('function');
    expect(fakeTrain([])).toBeNull();
    expect(fakeUnderstand).toBeTypeOf('function');
  });
});
