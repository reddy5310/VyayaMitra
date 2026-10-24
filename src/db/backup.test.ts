import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupError, backupFileName, exportBackup, inspectBackup, restoreBackup } from './backup';
import { createGoal, addContribution, updateSettings, upsertBudget } from './actions';
import { META_SETTINGS, db, resetDatabaseForTests } from './db';
import { makeAccount, makeTxn } from './testkit';

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

const STATEMENT = {
  id: 'st-1',
  accountId: 'acc-1',
  fileName: 'jan.pdf',
  fileHash: 'abc',
  parserId: 'p',
  parserVersion: 1,
  totals: { debits: 1, credits: 0, debitCount: 1, creditCount: 0 },
  reconciliation: { status: 'balanced' as const, checks: [{ label: 'x', ok: true }], rowBalanceBreaks: 0 },
  warnings: [],
  rowCount: 2,
  importedAt: '2025-01-31T00:00:00.000Z',
};

async function seed() {
  await db.accounts.add(makeAccount());
  await db.statements.add(STATEMENT);
  await db.transactions.bulkAdd([
    makeTxn({ id: 't1', balanceAfter: 5000, reference: 'R1', valueDate: '2025-01-11', note: 'hello' }),
    makeTxn({ id: 't2', direction: 'credit', linkId: 'L', linkRole: 'refund_of', linkedTxnId: 't1' }),
  ]);
  await db.rules.add({ id: 'r1', match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'groceries' }, enabled: true, createdAt: 't' });
  await upsertBudget('groceries', 500000);
  const g = await createGoal({ name: 'Trip', target: 1000000, targetDate: '2026-01-01' });
  await addContribution({ goalId: g.id, date: '2025-02-01', amount: 1000, type: 'deposit', linkedTxnId: 't1' });
  await db.recurringDecisions.put({ merchantKey: 'netflix', status: 'confirmed', cadence: 'monthly', expectedAmount: 64900, updatedAt: 't' });
  await db.savingActions.add({ id: 'sa', type: 'custom', title: 'Cook', baselineMonthly: 1, targetMonthly: 1, startMonth: '2025-02', status: 'active', createdAt: 't', updatedAt: 't' });
  await db.customCategories.add({ id: 'cc_1', name: 'Pets', group: 'lifestyle', createdAt: 't' });
  await updateSettings({ theme: 'dark' });
}

async function dump() {
  const out: Record<string, unknown> = {};
  for (const t of db.tables) if (t.name !== 'meta') out[t.name] = (await t.toArray()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  out.settings = (await db.meta.get(META_SETTINGS))?.value;
  return out;
}

const blobOf = (obj: unknown) => new Blob([JSON.stringify(obj)], { type: 'application/json' });

beforeEach(async () => {
  await resetDatabaseForTests();
});

describe('backup', () => {
  it('9a. plain round trip restores everything exactly', async () => {
    await seed();
    const before = await dump();
    const blob = await exportBackup();
    const env = JSON.parse(await blob.text());
    expect(env).toMatchObject({ format: 'vyayamitra-backup', schemaVersion: 4 });
    expect(env.encrypted).toBeUndefined();
    expect(env.appVersion).toBeTypeOf('string');
    expect(new Date(env.createdAt).getTime()).not.toBeNaN();
    expect(Object.keys(env.data)).toEqual(expect.arrayContaining(['accounts', 'statements', 'transactions', 'rules', 'customCategories', 'budgets', 'goals', 'goalContributions', 'recurringDecisions', 'savingActions', 'settings']));

    await db.transactions.clear();
    await db.accounts.clear();
    const res = await restoreBackup(blob, { mode: 'replace' });
    expect(res.counts).toMatchObject({ accounts: 1, statements: 1, transactions: 2, rules: 1, budgets: 1, goals: 1, goalContributions: 1 });
    expect(await dump()).toEqual(before);
  });

  it('9b. encrypted round trip uses PBKDF2 + AES-GCM and hides the data', async () => {
    await seed();
    const before = await dump();
    const blob = await exportBackup({ passphrase: 'correct horse battery' });
    const text = await blob.text();
    const env = JSON.parse(text);
    expect(env).toMatchObject({
      format: 'vyayamitra-backup',
      encrypted: true,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 },
      cipher: { name: 'AES-GCM' },
    });
    expect(env.kdf.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(env.cipher.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(env.data).toBeUndefined();
    expect(text).not.toContain('SWIGGY');
    expect(text).not.toContain('acc-1');

    await db.transactions.clear();
    await restoreBackup(blob, { mode: 'replace', passphrase: 'correct horse battery' });
    expect(await dump()).toEqual(before);
  });

  it('9c. a wrong or missing passphrase gives a clear error and changes nothing', async () => {
    await seed();
    const blob = await exportBackup({ passphrase: 'right' });
    await db.transactions.add(makeTxn({ id: 'extra' }));
    const before = await dump();

    const wrong = await restoreBackup(blob, { mode: 'replace', passphrase: 'wrong' }).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(BackupError);
    expect((wrong as BackupError).code).toBe('wrong_passphrase');
    expect((wrong as Error).message).toMatch(/passphrase/i);

    const missing = await restoreBackup(blob, { mode: 'replace' }).catch((e: unknown) => e);
    expect((missing as BackupError).code).toBe('passphrase_required');
    expect(await dump()).toEqual(before);
  });

  it('inspects without changing anything', async () => {
    await seed();
    const plain = await inspectBackup(await exportBackup());
    expect(plain).toMatchObject({ encrypted: false, schemaVersion: 4, counts: { accounts: 1, transactions: 2, goals: 1 } });
    const enc = await exportBackup({ passphrase: 'pw' });
    const locked = await inspectBackup(enc);
    expect(locked).toMatchObject({ encrypted: true, schemaVersion: 4 });
    expect(locked.counts).toBeUndefined();
    expect((await inspectBackup(enc, { passphrase: 'pw' })).counts).toMatchObject({ transactions: 2 });
  });

  it('rejects garbage, foreign files, newer versions and inconsistent data before touching the db', async () => {
    await seed();
    const before = await dump();
    const good = JSON.parse(await (await exportBackup()).text());

    const cases: [string, Blob, string][] = [
      ['not json', new Blob(['hello']), 'invalid_file'],
      ['foreign json', blobOf({ hello: 1 }), 'invalid_file'],
      ['newer version', blobOf({ ...good, schemaVersion: 99 }), 'unsupported_version'],
      ['bad amount', blobOf({ ...good, data: { ...good.data, transactions: [{ ...good.data.transactions[0], amount: -5 }] } }), 'invalid_file'],
      ['missing table', blobOf({ ...good, data: { accounts: [] } }), 'invalid_file'],
      ['orphan txn', blobOf({ ...good, data: { ...good.data, accounts: [] } }), 'invalid_file'],
      ['dup budget category', blobOf({ ...good, data: { ...good.data, budgets: [good.data.budgets[0], { ...good.data.budgets[0], id: 'other' }] } }), 'invalid_file'],
    ];
    for (const [name, blob, code] of cases) {
      const err = await restoreBackup(blob, { mode: 'replace' }).catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(BackupError);
      expect((err as BackupError).code, name).toBe(code);
    }
    expect(await dump()).toEqual(before);
  });

  it('a failure inside the restore transaction rolls back (replace is atomic)', async () => {
    await seed();
    const blob = await exportBackup();
    const before = await dump();
    const spy = vi.spyOn(db.transactions, 'bulkAdd').mockRejectedValueOnce(new Error('disk full'));
    await expect(restoreBackup(blob, { mode: 'replace' })).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await dump()).toEqual(before);
  });

  it('merge adds only records this device does not have', async () => {
    await seed();
    const blob = await exportBackup();
    await db.transactions.delete('t2');
    await db.budgets.clear();
    await db.accounts.update('acc-1', { name: 'Renamed locally' });
    await db.transactions.add(makeTxn({ id: 'local' }));
    await updateSettings({ theme: 'light' });

    const res = await restoreBackup(blob, { mode: 'merge' });
    expect(res.counts).toMatchObject({ accounts: 0, transactions: 1, budgets: 1, goals: 0 });
    expect((await db.accounts.get('acc-1'))!.name).toBe('Renamed locally');
    expect((await db.transactions.toArray()).map((t) => t.id).sort()).toEqual(['local', 't1', 't2']);
    expect((await db.meta.get(META_SETTINGS))!.value).toMatchObject({ theme: 'light' }); // local settings win
  });

  it('merge skips transactions whose fingerprint already exists', async () => {
    await seed();
    const blob = await exportBackup();
    const t1 = (await db.transactions.get('t1'))!;
    await db.transactions.delete('t1');
    await db.transactions.add({ ...t1, id: 'same-row-other-id' });
    const res = await restoreBackup(blob, { mode: 'merge' });
    expect(res.counts.transactions).toBe(0);
    expect(await db.transactions.count()).toBe(2);
  });

  it('names the download', () => {
    expect(backupFileName('2025-09-14')).toBe('vyayamitra-backup-2025-09-14.json');
  });
});
