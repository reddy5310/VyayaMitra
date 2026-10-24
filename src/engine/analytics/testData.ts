/** Test-data builders with invented data only. Used by the analytics tests. */
import type { Account, IsoDate, Statement, Transaction } from '@/domain/types';

let counter = 0;

export function resetIds(): void {
  counter = 0;
}

export function makeAccount(over: Partial<Account> = {}): Account {
  counter++;
  return {
    id: `acc${counter}`,
    name: 'Test Savings',
    institution: 'OTHER',
    type: 'savings',
    currency: 'INR',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeStatement(over: Partial<Statement> & { accountId: string }): Statement {
  counter++;
  return {
    id: `st${counter}`,
    fileName: 'statement.pdf',
    fileHash: `hash${counter}`,
    parserId: 'test',
    parserVersion: 1,
    totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
    reconciliation: { status: 'unverified', checks: [], rowBalanceBreaks: 0 },
    warnings: [],
    rowCount: 0,
    importedAt: '2025-10-01T00:00:00.000Z',
    ...over,
  };
}

/** Amounts are given in RUPEES for readability and stored as paise. */
export function makeTxn(
  over: Partial<Omit<Transaction, 'amount'>> & { rupees?: number; amount?: number; date: IsoDate },
): Transaction {
  counter++;
  const { rupees, ...rest } = over;
  const merchant = rest.merchant ?? 'Test Merchant';
  return {
    id: `t${counter}`,
    accountId: 'acc1',
    statementId: 'st1',
    amount: rest.amount ?? Math.round((rupees ?? 100) * 100),
    direction: 'debit',
    rawDescription: `UPI/${merchant}`,
    channel: 'UPI',
    counterparty: { type: 'merchant', name: merchant },
    merchant,
    merchantKey: merchant.toLowerCase().replace(/\s+/g, ''),
    kind: 'expense',
    kindSource: 'rule',
    category: 'shopping',
    categorySource: 'builtin_rule',
    confidence: 0.9,
    reasons: [],
    needsReview: false,
    reviewReasons: [],
    fingerprint: `fp${counter}`,
    source: { page: 1, lineStart: 0, lineEnd: 0, rawLines: [] },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...rest,
  } as Transaction;
}
