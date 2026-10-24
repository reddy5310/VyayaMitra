import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, restoreBackup } from './backup';
import { db, resetDatabaseForTests } from './db';
import { mergeMerchants, recordInsightFeedback, saveMonthReview, setTransactionsTag } from './review';
import { fakeLink, makeAccount, makeTxn } from './testkit';
import { linkTransactions } from '@/engine/match';

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
  return { linkTransactions: vi.fn(k.fakeLink) };
});
vi.mock('@/parsing', async () => ({ ...(await import('@/parsing/errors')), parseStatement: vi.fn() }));

const blobOf = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

async function seed() {
  await db.accounts.add(makeAccount());
  await db.transactions.bulkAdd([
    makeTxn({ id: 'a', rawDescription: 'SWIGGY ORDER 1' }),
    makeTxn({ id: 'b', rawDescription: 'SWIGGY ORDER 2' }),
    makeTxn({ id: 'z', rawDescription: 'UBER TRIP', merchant: 'Uber', merchantKey: 'uber', counterparty: { type: 'merchant', name: 'UBER' }, category: 'transport' }),
  ]);
}

describe('backup v3', () => {
  it('round-trips tags, insight feedback, month reviews and merchant aliases', async () => {
    await db.statements.add({
      id: 'st-1', accountId: 'acc-1', fileName: 'x', fileHash: 'h', parserId: 'p', parserVersion: 1,
      totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
      reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 }, warnings: [], rowCount: 1, importedAt: 't',
    });
    await seed();
    await setTransactionsTag(['a'], 'reimbursable');
    await mergeMerchants(['swiggy'], { merchantKey: 'food', name: 'Food' });
    await recordInsightFeedback({ key: 'k', insightId: 'i', action: 'expected' });
    await saveMonthReview({ month: '2025-05', status: 'completed', notes: ['ok'], nextActionIds: ['x'] });
    const before = {
      txn: await db.transactions.get('a'),
      rules: await db.rules.toArray(),
      ins: await db.insightFeedback.toArray(),
      rev: await db.monthReviews.toArray(),
    };
    for (const passphrase of [undefined, 'pw']) {
      const blob = await exportBackup({ passphrase });
      await resetDatabaseForTests();
      const res = await restoreBackup(blob, { mode: 'replace', passphrase });
      expect(res.counts).toMatchObject({ insightFeedback: 1, monthReviews: 1 });
      expect(await db.transactions.get('a')).toEqual(before.txn);
      expect(await db.rules.toArray()).toEqual(before.rules);
      expect(await db.insightFeedback.toArray()).toEqual(before.ins);
      expect(await db.monthReviews.toArray()).toEqual(before.rev);
    }
    const again = await restoreBackup(await exportBackup(), { mode: 'merge' });
    expect(again.counts).toMatchObject({ insightFeedback: 0, monthReviews: 0 });
  });

  it('still restores v1 and v2 backups', async () => {
    const base = { accounts: [makeAccount({ id: 'old' })], statements: [], transactions: [], rules: [], customCategories: [], budgets: [], goals: [], goalContributions: [], recurringDecisions: [], savingActions: [] };
    await restoreBackup(blobOf({ format: 'vyayamitra-backup', schemaVersion: 1, appVersion: '1.0.0', createdAt: 't', data: base }), { mode: 'replace' });
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['old']);
    const v2 = { ...base, accounts: [makeAccount({ id: 'old2' })], templates: [], feedback: [] };
    const res = await restoreBackup(blobOf({ format: 'vyayamitra-backup', schemaVersion: 2, appVersion: '1.1.0', createdAt: 't', data: v2 }), { mode: 'replace' });
    expect(res.counts).toMatchObject({ accounts: 1, insightFeedback: 0, monthReviews: 0 });
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['old2']);
  });
});
