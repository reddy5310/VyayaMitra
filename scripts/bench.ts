/**
 * Performance benchmark on synthetic ledgers (not part of CI):
 *   npx vite-node scripts/bench.ts [sizes...]      e.g. npx vite-node scripts/bench.ts 5000 20000
 *
 * Generates 5k / 20k / 50k transactions across 4 accounts in fake-indexeddb and times the operations the
 * UI runs on every change: load + sort (useTransactions), applyQuery, summarize, monthlySeries,
 * generateInsights, recommendations (skipped while not implemented) and a full relink (linkTransactions).
 * All data is invented. Numbers are milliseconds, median of 3 runs (the first run of each is cold).
 */
import 'fake-indexeddb/auto';
import type { Account, Statement, Transaction, TxnKind } from '@/domain/types';
import { compareTransactionsNewestFirst } from '@/db/hooks';
import { db } from '@/db/db';
import { linkTransactions } from '@/engine/match';
import { addMonths, monthEnd, monthStart } from '@/lib/dates';
import { applyQuery, generateInsights, monthlySeries, recommendations, summarize } from '@/engine/analytics';

const END_MONTH = '2025-09';
const MONTHS = 36;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const MERCHANTS = Array.from({ length: 300 }, (_, i) => `Merchant ${i + 1}`);
const CATEGORIES = ['groceries', 'food_dining', 'shopping', 'transport', 'utilities', 'entertainment', 'healthcare', 'travel'];

function makeLedger(total: number) {
  const rand = rng(42);
  const accounts: Account[] = [
    { id: 'a1', name: 'Bank One Savings', institution: 'ICICI', type: 'savings', mask: '1111', currency: 'INR', createdAt: '2023-01-01T00:00:00Z' },
    { id: 'a2', name: 'Bank Two Savings', institution: 'DBS', type: 'savings', mask: '2222', currency: 'INR', createdAt: '2023-01-01T00:00:00Z' },
    { id: 'a3', name: 'Card One', institution: 'ICICI', type: 'credit_card', mask: '3333', currency: 'INR', createdAt: '2023-01-01T00:00:00Z' },
    { id: 'a4', name: 'Bank Three Current', institution: 'HDFC', type: 'current', mask: '4444', currency: 'INR', createdAt: '2023-01-01T00:00:00Z' },
  ];
  const months = Array.from({ length: MONTHS }, (_, i) => addMonths(END_MONTH, i - (MONTHS - 1)));
  const statements: Statement[] = [];
  for (const a of accounts) {
    for (const m of months) {
      statements.push({
        id: `st-${a.id}-${m}`,
        accountId: a.id,
        fileName: `${a.id}-${m}.pdf`,
        fileHash: `${a.id}${m}`,
        parserId: 'bench',
        parserVersion: 1,
        periodStart: monthStart(m),
        periodEnd: monthEnd(m),
        totals: { debits: 0, credits: 0, debitCount: 0, creditCount: 0 },
        reconciliation: { status: 'balanced', checks: [], rowBalanceBreaks: 0 },
        warnings: [],
        rowCount: 0,
        importedAt: '2025-10-01T00:00:00Z',
      });
    }
  }
  const txns: Transaction[] = [];
  let n = 0;
  const push = (over: Partial<Transaction> & Pick<Transaction, 'accountId' | 'date' | 'amount' | 'direction' | 'kind'>) => {
    n++;
    const m = MERCHANTS[Math.floor(rand() * MERCHANTS.length)];
    txns.push({
      id: `t${n}`,
      statementId: `st-${over.accountId}-${over.date.slice(0, 7)}`,
      rawDescription: `UPI/${m}/${n}`,
      channel: 'UPI',
      counterparty: { type: 'merchant', name: m },
      merchant: m,
      merchantKey: m.toLowerCase().replace(/\s+/g, ''),
      kindSource: 'rule',
      category: CATEGORIES[n % CATEGORIES.length],
      categorySource: 'builtin_rule',
      confidence: 0.9,
      reasons: ['Known merchant'],
      needsReview: false,
      reviewReasons: [],
      fingerprint: `fp${n}`,
      source: { page: 1 + (n % 5), lineStart: n % 60, lineEnd: n % 60, rawLines: [`line ${n}`] },
      createdAt: '2025-10-01T00:00:00Z',
      updatedAt: '2025-10-01T00:00:00Z',
      ...over,
    });
  };
  const day = () => String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  // Roughly 4% of rows are transfer pairs and card payments so the linker has real work.
  const pairs = Math.floor(total * 0.02);
  for (let i = 0; i < pairs; i++) {
    const m = months[Math.floor(rand() * MONTHS)];
    const date = `${m}-${day()}`;
    const amount = (5000 + Math.floor(rand() * 90) * 1000) * 100;
    const card = i % 2 === 0;
    push({ accountId: 'a1', date, amount, direction: 'debit', kind: card ? 'card_payment' : 'self_transfer' });
    push({ accountId: card ? 'a3' : 'a2', date, amount, direction: 'credit', kind: card ? 'card_payment' : 'self_transfer' });
  }
  while (txns.length < total) {
    const m = months[Math.floor(rand() * MONTHS)];
    const accountId = accounts[Math.floor(rand() * 4)].id;
    const credit = rand() < 0.08;
    const kind: TxnKind = credit ? 'income' : 'expense';
    push({ accountId, date: `${m}-${day()}`, amount: Math.round((50 + rand() * 4000) * 100), direction: credit ? 'credit' : 'debit', kind });
  }
  return { accounts, statements, txns, months };
}

async function time<T>(fn: () => T | Promise<T>, runs = 3): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function main() {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  const rows: Record<string, Record<string, string>> = {};
  for (const size of sizes.length ? sizes : [5000, 20000, 50000]) {
    const { accounts, statements, txns, months } = makeLedger(size);
    await db.delete();
    await db.open();
    await db.accounts.bulkAdd(accounts);
    await db.statements.bulkAdd(statements);
    const seed = await time(() => db.transactions.bulkPut(txns), 1);

    const last = months[months.length - 1];
    const first12 = months[months.length - 12];
    const monthQ = { start: monthStart(last), end: monthEnd(last), accountIds: ['a1', 'a2'] };
    const yearQ = { start: monthStart(first12), end: monthEnd(last) };
    const ctx = (start: string, end: string) => ({ accounts, statements, start, end, today: '2025-09-30' });
    const loaded = (await db.transactions.toArray()).sort(compareTransactionsNewestFirst);
    const monthTxns = applyQuery(loaded, monthQ);
    const yearTxns = applyQuery(loaded, yearQ);

    const r: Record<string, number | null> = {
      'seed (bulkPut)': seed,
      'load + sort (useTransactions)': await time(async () => (await db.transactions.toArray()).sort(compareTransactionsNewestFirst)),
      'applyQuery (1 month, 2 accounts)': await time(() => applyQuery(loaded, monthQ)),
      'applyQuery (search text)': await time(() => applyQuery(loaded, { search: 'merchant 12' })),
      'summarize (1 month)': await time(() => summarize(monthTxns, ctx(monthQ.start, monthQ.end))),
      'summarize (12 months)': await time(() => summarize(yearTxns, ctx(yearQ.start, yearQ.end))),
      'monthlySeries (12 months)': await time(() => monthlySeries(loaded, { accounts, statements, months: months.slice(-12) })),
      generateInsights: await time(() =>
        generateInsights({
          txns: loaded,
          accounts,
          statements,
          budgets: [],
          recurringDecisions: [],
          actions: [],
          start: monthQ.start,
          end: monthQ.end,
          today: '2025-09-30',
        }),
      ),
      'full relink (linkTransactions)': await time(() => linkTransactions(loaded, accounts), 2),
    };
    try {
      r.recommendations = await time(
        () =>
          recommendations(loaded, {
            accounts,
            statements,
            budgets: [],
            actions: [],
            preferences: [],
            feedback: [],
            cases: [],
            allocations: [],
            chargeLinks: [],
            policies: [],
            today: '2025-09-30',
          }),
        2,
      );
    } catch {
      r.recommendations = null; // not implemented yet
    }
    for (const [k, v] of Object.entries(r)) (rows[k] ??= {})[`${size / 1000}k`] = v === null ? 'skipped' : `${v.toFixed(0)} ms`;
  }
  const cols = Object.keys(Object.values(rows)[0]);
  console.log(`| operation | ${cols.join(' | ')} |\n|---|${cols.map(() => '---').join('|')}|`);
  for (const [k, v] of Object.entries(rows)) console.log(`| ${k} | ${cols.map((c) => v[c]).join(' | ')} |`);
  await db.delete();
}

void main().then(() => process.exit(0));
