import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSONAL_DB_NAME, SAMPLE_DB_NAME, SAMPLE_FLAG, VyayaMitraDB, db, resetDatabaseForTests, switchDatabase } from './db';
import { exitSampleData, generateSampleStatements, isSampleMode, startSampleData, useSampleMode } from './sample';
import { makeAccount, makeTxn } from './testkit';

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe('generateSampleStatements', () => {
  const today = '2025-06-20';
  const sample = generateSampleStatements(today);

  it('covers the last 4 complete months plus the current one, a savings account and a card', () => {
    expect(sample.months).toEqual(['2025-02', '2025-03', '2025-04', '2025-05', '2025-06']);
    expect(sample.statements).toHaveLength(10);
    expect(sample.statements.filter((s) => s.parsed.accountType === 'savings')).toHaveLength(5);
    expect(sample.statements.filter((s) => s.parsed.accountType === 'credit_card')).toHaveLength(5);
    expect(new Set(sample.statements.map((s) => s.hash)).size).toBe(10);
  });

  it('reconciles: bank balance chains and card due arithmetic', () => {
    for (const { parsed: p } of sample.statements) {
      expect(p.reconciliation.status).toBe('balanced');
      expect(p.rows.every((r) => r.amount > 0 && r.date <= today)).toBe(true);
      if (p.accountType === 'savings') {
        let bal = p.openingBalance!;
        for (const r of p.rows) {
          bal += r.direction === 'credit' ? r.amount : -r.amount;
          expect(r.balanceAfter).toBe(bal);
          expect(bal).toBeGreaterThanOrEqual(0);
        }
        expect(bal).toBe(p.closingBalance);
      } else {
        const debits = p.rows.filter((r) => r.direction === 'debit').reduce((s, r) => s + r.amount, 0);
        const credits = p.rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + r.amount, 0);
        expect(p.cardSummary!.previousBalance! + debits - credits).toBe(p.cardSummary!.totalDue);
        expect(p.cardSummary!.minimumDue).toBeLessThanOrEqual(p.cardSummary!.totalDue!);
      }
    }
  });

  it('has the expected shape: salary, rent, SIP, card bill pair, refund, annual fee, subscription', () => {
    const all = sample.statements.flatMap((s) => s.parsed.rows.map((r) => ({ type: s.parsed.accountType, ...r })));
    const has = (re: RegExp, type?: string) => all.some((r) => re.test(r.description) && (!type || r.type === type));
    for (const re of [/SALARY/, /RENT/, /MUTUAL FUND-SIP/, /CREDIT CARD PAYMENT/]) expect(has(re, 'savings')).toBe(true);
    for (const re of [/PAYMENT RECEIVED/, /REFUND/, /ANNUAL FEE/, /NETFLIX/, /INDIAN OIL/, /ZOMATO/]) expect(has(re, 'credit_card')).toBe(true);
    // every bank-side card payment has an equal card-side credit on the same date
    const bankPay = all.filter((r) => /CREDIT CARD PAYMENT/.test(r.description));
    const cardPay = all.filter((r) => /PAYMENT RECEIVED/.test(r.description));
    expect(bankPay.map((r) => [r.date, r.amount])).toEqual(cardPay.map((r) => [r.date, r.amount]));
  });

  it('is deterministic and stops at today', () => {
    expect(generateSampleStatements(today)).toEqual(sample);
    const early = generateSampleStatements('2025-06-03');
    const lastMonth = early.statements.at(-1)!.parsed;
    expect(lastMonth.rows.every((r) => r.date <= '2025-06-03')).toBe(true);
    for (const s of early.statements) expect(s.parsed.reconciliation.status).toBe('balanced');
  });
});

describe('sample mode isolation', () => {
  beforeEach(async () => {
    stubStorage();
    await resetDatabaseForTests();
  });
  afterEach(async () => {
    switchDatabase(PERSONAL_DB_NAME);
    await Dexie.delete(SAMPLE_DB_NAME);
    vi.unstubAllGlobals();
  });

  it('starts and exits without ever touching the personal database', async () => {
    await db.accounts.add(makeAccount({ id: 'mine' }));
    await db.transactions.add(makeTxn({ id: 'mine-1', accountId: 'mine', fingerprint: 'mine-fp' }));
    expect(isSampleMode()).toBe(false);

    await startSampleData();
    expect(isSampleMode()).toBe(true);
    expect(useSampleMode()).toBe(true);
    expect(db.name).toBe(SAMPLE_DB_NAME);
    expect(localStorage.getItem(SAMPLE_FLAG)).toBe('1');

    // sample ledger went through the real commit path
    const accounts = await db.accounts.toArray();
    expect(accounts.map((a) => a.type).sort()).toEqual(['credit_card', 'savings']);
    expect(accounts.some((a) => a.id === 'mine')).toBe(false);
    const statements = await db.statements.toArray();
    expect(statements).toHaveLength(10);
    expect(statements.every((s) => s.reconciliation.status === 'balanced')).toBe(true);
    expect(statements.filter((s) => s.cardSummary).length).toBe(5);
    const txns = await db.transactions.toArray();
    expect(txns.length).toBeGreaterThan(80);
    expect(txns.every((t) => t.category && t.kind)).toBe(true);
    expect(txns.some((t) => t.needsReview)).toBe(true);
    expect(txns.some((t) => t.linkId)).toBe(true); // card payments / refund linked
    expect(txns.some((t) => t.kind === 'income')).toBe(true);
    expect(await db.budgets.count()).toBe(2);
    expect(await db.goals.count()).toBe(1);
    expect(await db.goalContributions.count()).toBeGreaterThan(3);
    expect((await db.meta.get('settings'))!.value).toMatchObject({ onboardingDone: true });

    // the personal database is intact and was never mixed with
    const personal = new VyayaMitraDB(PERSONAL_DB_NAME);
    expect((await personal.accounts.toArray()).map((a) => a.id)).toEqual(['mine']);
    expect((await personal.transactions.toArray()).map((t) => t.id)).toEqual(['mine-1']);
    personal.close();

    await exitSampleData();
    expect(isSampleMode()).toBe(false);
    expect(localStorage.getItem(SAMPLE_FLAG)).toBeNull();
    expect(await Dexie.exists(SAMPLE_DB_NAME)).toBe(false);
    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(['mine']);
    expect(await db.transactions.count()).toBe(1);
  });

  it('a failed start restores the personal database and leaves no sample behind', async () => {
    await db.accounts.add(makeAccount({ id: 'mine' }));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined });
    await expect(startSampleData()).rejects.toThrow(/local storage/);
    expect(isSampleMode()).toBe(false);
    expect(await Dexie.exists(SAMPLE_DB_NAME)).toBe(false);
    expect(await db.accounts.count()).toBe(1);
  });

  it('starting twice is a no-op while already in sample mode', async () => {
    await startSampleData();
    const count = await db.transactions.count();
    await startSampleData();
    expect(await db.transactions.count()).toBe(count);
  });
});
