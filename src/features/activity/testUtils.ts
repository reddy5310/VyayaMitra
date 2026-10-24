/** Test-only helpers: invented data, never real statement content. */
import type { Account, Statement, Transaction } from '@/domain/types';

export function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'acc1',
    name: 'Demo Savings ••1234',
    institution: 'OTHER',
    type: 'savings',
    mask: '1234',
    currency: 'INR',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeStatement(over: Partial<Statement> = {}): Statement {
  return {
    id: 'st1',
    accountId: 'acc1',
    fileName: 'demo-statement.pdf',
    fileHash: 'abc',
    parserId: 'demo',
    parserVersion: 1,
    totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
    reconciliation: { status: 'unverified', checks: [], rowBalanceBreaks: 0 },
    warnings: [],
    rowCount: 0,
    importedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

let seq = 0;
export function makeTxn(over: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'acc1',
    statementId: 'st1',
    date: '2025-09-12',
    amount: 25_000,
    direction: 'debit',
    rawDescription: 'UPI/DEMO MART/123456',
    channel: 'UPI',
    counterparty: { type: 'merchant', name: 'Demo Mart' },
    merchant: 'Demo Mart',
    merchantKey: 'demo mart',
    kind: 'expense',
    kindSource: 'rule',
    category: 'groceries',
    categorySource: 'builtin_rule',
    confidence: 0.9,
    reasons: ['UPI payment to a merchant'],
    needsReview: false,
    reviewReasons: [],
    fingerprint: `fp${seq}`,
    source: { page: 1, lineStart: 1, lineEnd: 1, rawLines: ['12-09-2025 UPI/DEMO MART/123456 250.00'] },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}
