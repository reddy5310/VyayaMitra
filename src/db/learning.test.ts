import Dexie from 'dexie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markReviewed,
  renameMerchant,
  resetTransaction,
  setTransactionCategory,
  setTransactionKind,
} from './actions';
import { exportBackup, restoreBackup } from './backup';
import { META_CALIBRATION, META_LEARNED_MODEL, META_MIGRATIONS, VyayaMitraDB, db, resetDatabaseForTests } from './db';
import {
  deleteTemplate,
  exportTemplates,
  importTemplates,
  resetLearning,
  saveTemplate,
  updateTemplate,
} from './learning';
import { fakeLink, makeAccount, makeDraft, makeTxn } from './testkit';
import { reprocessLedger } from '@/engine/import';
import { linkTransactions } from '@/engine/match';
import { buildCalibration, understand } from '@/engine/understand';
import { ValidationError } from './validation';

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
vi.mock('@/parsing', async () => ({
  ...(await import('@/parsing/errors')),
  parseStatement: vi.fn(),
  inspectStatement: vi.fn(),
}));

const blobOf = (obj: unknown) => new Blob([JSON.stringify(obj)], { type: 'application/json' });

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.clearAllMocks();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

describe('schema v1 -> v2 migration', () => {
  it('keeps every v1 row, adds the new tables and logs the migration', async () => {
    const name = 'migration-test-db';
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores({
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
    await v1.open();
    await v1.table('accounts').add(makeAccount({ id: 'old-acc' }));
    await v1.table('transactions').bulkAdd([makeTxn({ id: 'old-1', accountId: 'old-acc', fingerprint: 'f1' }), makeTxn({ id: 'old-2', accountId: 'old-acc', fingerprint: 'f2' })]);
    await v1.table('budgets').add({ id: 'b', category: 'groceries', monthlyLimit: 100, createdAt: 't', updatedAt: 't' });
    await v1.table('meta').put({ key: 'settings', value: { theme: 'dark' } });
    v1.close();

    const v2 = new VyayaMitraDB(name);
    await v2.open();
    expect(v2.verno).toBeGreaterThanOrEqual(4);
    expect((await v2.transactions.toArray()).map((t) => t.id).sort()).toEqual(['old-1', 'old-2']);
    expect(await v2.accounts.count()).toBe(1);
    expect((await v2.budgets.get('b'))!.monthlyLimit).toBe(100);
    expect((await v2.meta.get('settings'))!.value).toEqual({ theme: 'dark' });
    expect(await v2.templates.count()).toBe(0);
    expect(await v2.feedback.count()).toBe(0);
    expect((await v2.meta.get(META_MIGRATIONS))!.value).toMatchObject([{ version: 2 }, { version: 3 }, { version: 4 }]);
    // the unique fingerprint index survived the upgrade
    await expect(v2.transactions.add(makeTxn({ id: 'dup', accountId: 'old-acc', fingerprint: 'f1' }))).rejects.toThrow();
    // and the new tables are usable
    await v2.templates.add({ ...makeDraft(), id: 't', source: 'auto', verifiedCount: 0, useCount: 0, createdAt: 't', updatedAt: 't' });
    expect(await v2.templates.where('[institution+fileKind]').equals(['ICICI', 'pdf']).count()).toBe(1);
    v2.close();
    await Dexie.delete(name);
  });
});

describe('templates', () => {
  it('saveTemplate inserts, then merges by signature and counts uses', async () => {
    const a = await saveTemplate(makeDraft(), { source: 'auto' });
    expect(a).toMatchObject({ source: 'auto', useCount: 1, verifiedCount: 1 });
    const b = await saveTemplate(makeDraft({ name: 'other label' }), { source: 'auto' });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ useCount: 2, verifiedCount: 2 });
    expect(await db.templates.count()).toBe(1);

    // a different layout (different header tokens) is a separate template
    await saveTemplate(makeDraft({ signature: { markers: ['test bank'], headerTokens: ['txn date', 'narration'], columnCount: 6 } }), { source: 'auto' });
    expect(await db.templates.count()).toBe(2);
  });

  it('a user-taught definition is not replaced by an automatic one, but the reverse is allowed', async () => {
    await saveTemplate(makeDraft({ amountStyle: 'signed' }), { source: 'auto' });
    const taught = await saveTemplate(makeDraft({ amountStyle: 'split' }), { source: 'user', name: 'My bank' });
    expect(taught).toMatchObject({ source: 'user', amountStyle: 'split', name: 'My bank' });
    const again = await saveTemplate(makeDraft({ amountStyle: 'signed' }), { source: 'auto' });
    expect(again).toMatchObject({ source: 'user', amountStyle: 'split', name: 'My bank' });
    expect(await db.templates.count()).toBe(1);
  });

  it('refuses a draft with nothing to recognise it by', async () => {
    await expect(saveTemplate(makeDraft({ signature: { markers: ['acct 12345678'], headerTokens: [], columnCount: 5 } }), { source: 'user' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('update and delete', async () => {
    const t = await saveTemplate(makeDraft(), { source: 'user' });
    await updateTemplate(t.id, { name: ' Renamed ', institution: 'HDFC', accountType: 'current' });
    expect(await db.templates.get(t.id)).toMatchObject({ name: 'Renamed', institution: 'HDFC', accountType: 'current' });
    await expect(updateTemplate(t.id, { name: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTemplate('ghost', { name: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await deleteTemplate(t.id);
    expect(await db.templates.count()).toBe(0);
  });

  it('export strips ids, counts and source; import scrubs and counts added/merged/rejected', async () => {
    const t = await saveTemplate(makeDraft(), { source: 'user' });
    const out = JSON.parse(await (await exportTemplates([t.id])).text());
    expect(out).toMatchObject({ format: 'vyayamitra-templates', version: 1 });
    expect(out.templates).toHaveLength(1);
    expect(out.templates[0].id).toBeUndefined();
    expect(out.templates[0].useCount).toBeUndefined();
    expect(out.templates[0].source).toBeUndefined();

    await db.templates.clear();
    expect(await importTemplates(blobOf(out))).toEqual({ added: 1, merged: 0, rejected: 0 });
    expect((await db.templates.toArray())[0]).toMatchObject({ source: 'imported', useCount: 0, verifiedCount: 0 });
    expect(await importTemplates(blobOf(out))).toEqual({ added: 0, merged: 1, rejected: 0 });

    // hostile file
    const tooMany = makeDraft({
      signature: { markers: ['too wide'], headerTokens: [], columnCount: 41 },
      columns: Array.from({ length: 41 }, () => ({ role: 'ignore' as const })),
    });
    const hostile = {
      format: 'vyayamitra-templates',
      version: 1,
      templates: [
        makeDraft({
          name: 'Account 123456789 template',
          institution: 'KOTAK',
          signature: {
            markers: ['kotak bank', 'ph 9876543210', 'x'.repeat(61), 'Kotak  Mahindra'],
            headerTokens: ['date', 'narration 2024', 'balance'],
            columnCount: 3,
          },
          columns: [
            { role: 'date', header: 'Date' },
            { role: 'description', header: 'ravi kumar 4021' },
            { role: 'balance', header: 'y'.repeat(80) },
          ],
        }),
        tooMany,
        makeDraft({ institution: 'ICICI', signature: { markers: ['acct 99999999'], headerTokens: [], columnCount: 5 } }),
        { nonsense: true },
      ],
    };
    const res = await importTemplates(blobOf(hostile));
    expect(res).toEqual({ added: 1, merged: 0, rejected: 3 });
    const kotak = (await db.templates.where('institution').equals('KOTAK').toArray().catch(() => db.templates.filter((x) => x.institution === 'KOTAK').toArray()))[0];
    expect(kotak.signature.markers).toEqual(['kotak bank', 'kotak mahindra']);
    expect(kotak.signature.headerTokens).toEqual(['date', 'balance']);
    expect(kotak.columns.map((c) => c.header)).toEqual(['date', undefined, undefined]);
    expect(kotak.name).not.toMatch(/\d{4}/);
    expect(kotak.source).toBe('imported');

    await expect(importTemplates(new Blob(['nope']))).rejects.toBeInstanceOf(ValidationError);
    await expect(importTemplates(blobOf({ format: 'other' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('resetLearning clears model + feedback, and only automatic templates', async () => {
    await saveTemplate(makeDraft(), { source: 'auto' });
    await saveTemplate(makeDraft({ signature: { markers: ['bank two'], headerTokens: ['date'], columnCount: 4 } }), { source: 'user' });
    await db.accounts.add(makeAccount());
    await db.transactions.add(makeTxn({ id: 'a' }));
    await setTransactionCategory('a', 'groceries', 'this');
    expect(await db.feedback.count()).toBe(1);
    expect(await db.meta.get(META_LEARNED_MODEL)).toBeDefined();

    await resetLearning('templates');
    expect((await db.templates.toArray()).map((t) => t.source)).toEqual(['user']);
    expect(await db.feedback.count()).toBe(1);

    await resetLearning('model');
    expect(await db.feedback.count()).toBe(0);
    expect(await db.meta.get(META_LEARNED_MODEL)).toBeUndefined();
    expect(await db.meta.get(META_CALIBRATION)).toBeUndefined();
    await expect(resetLearning('everything' as 'all')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('feedback loop', () => {
  async function seed() {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'a', rawDescription: 'SWIGGY ORDER 1', category: 'food_dining', categorySource: 'builtin_rule', confidence: 0.8, needsReview: true, counterparty: { type: 'merchant', name: 'SWIGGY', vpa: 'swiggy@icici' } }),
      makeTxn({ id: 'b', rawDescription: 'SWIGGY ORDER 2', category: 'food_dining', categorySource: 'builtin_rule' }),
    ]);
  }

  it('records one event per category correction with before = automatic and after = new', async () => {
    await seed();
    await setTransactionCategory('a', 'groceries', 'this');
    const [e] = await db.feedback.toArray();
    expect(e).toMatchObject({
      txnId: 'a',
      merchantKey: 'swiggy',
      vpa: 'swiggy@icici',
      action: 'category',
      scope: 'this',
      before: { kind: 'expense', category: 'food_dining', categorySource: 'builtin_rule', kindSource: 'heuristic', confidence: 0.8 },
      after: { kind: 'expense', category: 'groceries' },
    });
    expect(e.id).toBeTruthy();
    expect(new Date(e.at).getTime()).not.toBeNaN();

    await setTransactionCategory('b', 'shopping', 'merchant');
    const events = await db.feedback.toArray();
    expect(events).toHaveLength(2);
    expect(events.find((x) => x.txnId === 'b')).toMatchObject({ scope: 'merchant', action: 'category', after: { category: 'shopping' } });
  });

  it('records kind, merchant, confirm and reset events', async () => {
    await seed();
    await setTransactionKind('a', 'investment', 'this');
    await renameMerchant('b', 'Swiggy Food', 'this');
    await markReviewed(['a', 'b', 'ghost']);
    await resetTransaction('a');
    const events = await db.feedback.toArray();
    const by = (action: string) => events.filter((e) => e.action === action);
    expect(by('kind')).toHaveLength(1);
    expect(by('kind')[0]).toMatchObject({ before: { kind: 'expense' }, after: { kind: 'investment', category: 'investments' } });
    expect(by('merchant')).toHaveLength(1);
    expect(by('confirm')).toHaveLength(2);
    expect(by('confirm')[0].after).toEqual({ kind: expect.any(String), category: expect.any(String) });
    expect(by('reset')).toHaveLength(1);
    expect(by('reset')[0]).toMatchObject({ txnId: 'a', before: { kind: 'investment', kindSource: 'user' }, after: { kind: 'expense', category: 'food_dining' } });
    expect(events).toHaveLength(5);
  });

  it('rebuilds calibration from all events, stores it in meta and passes it to understand', async () => {
    await seed();
    await setTransactionCategory('a', 'groceries', 'this');
    await setTransactionCategory('b', 'shopping', 'this');
    expect(vi.mocked(buildCalibration)).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ txnId: 'a' }), expect.objectContaining({ txnId: 'b' })]));
    expect((await db.meta.get(META_CALIBRATION))!.value).toMatchObject({ version: 1, eventCount: 2 });

    vi.mocked(understand).mockClear();
    await reprocessLedger();
    const ctxs = vi.mocked(understand).mock.calls.map((c) => c[1]);
    expect(ctxs.length).toBeGreaterThan(0);
    expect(ctxs.every((c) => (c.calibration as { eventCount: number }).eventCount === 2)).toBe(true);
  });

  it('a failing calibration build never blocks the correction', async () => {
    await seed();
    vi.mocked(buildCalibration).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(setTransactionCategory('a', 'groceries', 'this')).resolves.toEqual({ updated: 1 });
    warn.mockRestore();
    expect((await db.transactions.get('a'))!.category).toBe('groceries');
  });

  it('feeds richer learning examples (vpa, amount, direction) to the trainer', async () => {
    const { trainLearnedModel } = await import('@/engine/understand');
    await seed();
    await setTransactionCategory('a', 'groceries', 'this');
    const examples = vi.mocked(trainLearnedModel).mock.calls.at(-1)![0];
    expect(examples).toEqual([expect.objectContaining({ category: 'groceries', vpa: 'swiggy@icici', amount: 10000, direction: 'debit' })]);
  });
});

describe('rules keyed by VPA', () => {
  it('uses the VPA for a person-named or QR payee', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.bulkAdd([
      makeTxn({ id: 'p', rawDescription: 'UPI ravi@okaxis', merchantKey: 'ravi kumar', merchant: 'Ravi Kumar', counterparty: { type: 'person', name: 'Ravi Kumar', vpa: 'ravi@okaxis' } }),
      makeTxn({ id: 'p2', rawDescription: 'UPI ravi@okaxis', merchantKey: 'ravi k', merchant: 'Ravi K', counterparty: { type: 'person', vpa: 'ravi@okaxis' } }),
      makeTxn({ id: 'q', rawDescription: 'UPI paytmqr', merchantKey: 'paytm merchant', merchant: 'Paytm Merchant', counterparty: { type: 'merchant', vpa: 'paytmqr281005@paytm' } }),
    ]);
    const person = await setTransactionCategory('p', 'family_support', 'merchant');
    expect((await db.rules.get(person.ruleId!))!.match).toEqual({ field: 'vpa', op: 'equals', value: 'ravi@okaxis' });
    expect(person.updated).toBe(2); // the same person under two display names
    expect((await db.transactions.get('p2'))!.category).toBe('family_support');

    const qr = await setTransactionCategory('q', 'groceries', 'merchant');
    expect((await db.rules.get(qr.ruleId!))!.match.field).toBe('vpa');
  });

  it('keeps merchantKey rules for named merchants, even when a VPA exists', async () => {
    await db.accounts.add(makeAccount());
    await db.transactions.add(makeTxn({ id: 's', counterparty: { type: 'merchant', name: 'SWIGGY', vpa: 'swiggy@icici' } }));
    const res = await setTransactionCategory('s', 'groceries', 'merchant');
    expect((await db.rules.get(res.ruleId!))!.match).toEqual({ field: 'merchantKey', op: 'equals', value: 'swiggy' });
  });
});

describe('backup with self-training data', () => {
  it('round-trips templates and feedback (plain and encrypted)', async () => {
    await db.accounts.add(makeAccount());
    await db.statements.add({
      id: 'st-1', accountId: 'acc-1', fileName: 'x.pdf', fileHash: 'h', parserId: 'p', parserVersion: 1,
      totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
      reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 },
      warnings: [], rowCount: 1, importedAt: 't', cardSummary: { dueDate: '2025-02-10', totalDue: 123400 }, templateId: 'tpl',
    });
    await db.transactions.add(makeTxn({ id: 'a' }));
    await setTransactionCategory('a', 'groceries', 'this');
    await saveTemplate(makeDraft(), { source: 'user', name: 'Mine' });
    const templates = await db.templates.toArray();
    const feedback = await db.feedback.toArray();

    for (const passphrase of [undefined, 'pw']) {
      const blob = await exportBackup({ passphrase });
      await resetDatabaseForTests();
      const res = await restoreBackup(blob, { mode: 'replace', passphrase });
      expect(res.counts).toMatchObject({ templates: 1, feedback: 1 });
      expect(await db.templates.toArray()).toEqual(templates);
      expect(await db.feedback.toArray()).toEqual(feedback);
      expect((await db.statements.get('st-1'))!.cardSummary).toEqual({ dueDate: '2025-02-10', totalDue: 123400 });
      expect((await db.meta.get(META_CALIBRATION))!.value).toMatchObject({ eventCount: 1 });
    }
  });

  it('merge adds templates with a new signature only', async () => {
    await saveTemplate(makeDraft(), { source: 'auto' });
    await saveTemplate(makeDraft({ signature: { markers: ['bank two'], headerTokens: ['date'], columnCount: 4 } }), { source: 'user' });
    const blob = await exportBackup();
    await db.templates.where('source').equals('user').delete();
    const res = await restoreBackup(blob, { mode: 'merge' });
    expect(res.counts.templates).toBe(1);
    expect(await db.templates.count()).toBe(2);
  });

  it('restores a v1 backup (no templates/feedback keys, closed institution list)', async () => {
    const v1 = {
      format: 'vyayamitra-backup',
      schemaVersion: 1,
      appVersion: '1.0.0',
      createdAt: '2025-01-01T00:00:00.000Z',
      data: {
        accounts: [makeAccount({ id: 'v1-acc' })],
        statements: [],
        transactions: [],
        rules: [],
        customCategories: [],
        budgets: [],
        goals: [],
        goalContributions: [],
        recurringDecisions: [],
        savingActions: [],
        settings: { theme: 'dark' },
      },
    };
    await db.templates.add({ ...makeDraft(), id: 'keep-me', source: 'auto', verifiedCount: 0, useCount: 0, createdAt: 't', updatedAt: 't' });
    const res = await restoreBackup(blobOf(v1), { mode: 'replace' });
    expect(res.counts).toMatchObject({ accounts: 1, templates: 0, feedback: 0 });
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['v1-acc']);
    expect(await db.templates.count()).toBe(0); // replace means replace
    const merged = await restoreBackup(blobOf(v1), { mode: 'merge' });
    expect(merged.counts.accounts).toBe(0);
  });

  it('accepts any institution id in a backup', async () => {
    const env = {
      format: 'vyayamitra-backup',
      schemaVersion: 2,
      appVersion: '1.1.0',
      createdAt: 't',
      data: {
        accounts: [makeAccount({ id: 'x', institution: 'SBI_CARD' })],
        statements: [], transactions: [], rules: [], customCategories: [], budgets: [], goals: [],
        goalContributions: [], recurringDecisions: [], savingActions: [], templates: [], feedback: [],
      },
    };
    await restoreBackup(blobOf(env), { mode: 'replace' });
    expect((await db.accounts.get('x'))!.institution).toBe('SBI_CARD');
  });
});

describe('backup keeps bankCategory', () => {
  it('round-trips the issuer category on transactions', async () => {
    await db.accounts.add(makeAccount());
    await db.statements.add({
      id: 'st-1', accountId: 'acc-1', fileName: 'x.pdf', fileHash: 'h', parserId: 'p', parserVersion: 1,
      totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
      reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 }, warnings: [], rowCount: 1, importedAt: 't',
    });
    await db.transactions.add(makeTxn({ id: 'a', bankCategory: 'Fuel' }));
    const blob = await exportBackup();
    await resetDatabaseForTests();
    await restoreBackup(blob, { mode: 'replace' });
    expect((await db.transactions.get('a'))!.bankCategory).toBe('Fuel');
  });
});
