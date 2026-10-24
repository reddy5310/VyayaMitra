/**
 * Test-only helpers: invented data and deterministic fakes for the modules owned by other
 * engineers (understand / match / parsing). Nothing here ships in the app bundle.
 */
import type {
  Account,
  FeedbackEvent,
  ParsedRow,
  ParsedStatement,
  TemplateDraft,
  Transaction,
  UserRule,
} from '@/domain/types';
import type { Calibration, LearnedModel, LearningExample, UnderstandContext, UnderstandInput, Understanding } from '@/engine/understand';
import type { LinkUpdate } from '@/engine/match';
import type { StatementFile } from '@/parsing';

// ─── fakes ───────────────────────────────────────────────────────────────────

const BUILTIN: Record<string, string> = { swiggy: 'food_dining', amazon: 'shopping', bigbasket: 'groceries', uber: 'transport' };

export function fakeRuleMatches(
  rule: UserRule,
  txn: { accountId: string; direction: string; merchantKey: string; counterparty: { vpa?: string }; rawDescription: string },
): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== txn.accountId) return false;
  if (rule.direction && rule.direction !== txn.direction) return false;
  const value = rule.match.value.toLowerCase();
  const subject =
    rule.match.field === 'merchantKey'
      ? txn.merchantKey
      : rule.match.field === 'vpa'
        ? (txn.counterparty.vpa ?? '')
        : txn.rawDescription;
  const s = subject.toLowerCase();
  return rule.match.op === 'equals' ? s === value : s.includes(value);
}

/** Deterministic stand-in for `understand`: first word is the merchant; a few built-in merchants; user rules win. */
export function fakeUnderstand(input: UnderstandInput, ctx: UnderstandContext): Understanding {
  const word = /[A-Za-z]+/.exec(input.description)?.[0] ?? 'unknown';
  const key = word.toLowerCase();
  const vpa = /([a-z0-9.]+@[a-z]+)/i.exec(input.description)?.[1]?.toLowerCase();
  const u: Understanding = {
    channel: 'UPI',
    counterparty: { type: 'merchant', name: word, ...(vpa ? { vpa } : {}) },
    merchant: word[0].toUpperCase() + word.slice(1).toLowerCase(),
    merchantKey: key,
    reference: input.reference,
    kind: input.direction === 'debit' ? 'expense' : 'income',
    kindSource: 'heuristic',
    category: BUILTIN[key] ?? 'uncategorized',
    categorySource: BUILTIN[key] ? 'builtin_rule' : 'none',
    confidence: BUILTIN[key] ? 0.9 : 0.3,
    reasons: [BUILTIN[key] ? `Known merchant ${word}` : 'Unrecognised merchant'],
    needsReview: !BUILTIN[key],
    reviewReasons: BUILTIN[key] ? [] : ['Category unknown'],
  };
  if (input.direction === 'credit') {
    u.category = 'other_income';
    u.categorySource = 'kind_default';
    u.needsReview = false;
    u.reviewReasons = [];
  }
  const probe = { accountId: ctx.account.id, direction: input.direction, merchantKey: key, counterparty: u.counterparty, rawDescription: input.description };
  for (const rule of ctx.rules) {
    if (!fakeRuleMatches(rule, probe)) continue;
    if (rule.set.category) {
      u.category = rule.set.category;
      u.categorySource = 'user_rule';
      u.needsReview = false;
      u.reviewReasons = [];
      u.reasons = ['Your rule'];
    }
    if (rule.set.kind) {
      u.kind = rule.set.kind;
      u.kindSource = 'user_rule';
    }
    if (rule.set.merchant) u.merchant = rule.set.merchant;
    if (rule.set.merchantKey) u.merchantKey = rule.set.merchantKey;
  }
  return u;
}

export function fakeTrain(examples: readonly LearningExample[]): LearnedModel | null {
  if (examples.length === 0) return null;
  return { version: 1, trainedAt: '2025-01-01T00:00:00.000Z', exampleCount: examples.length };
}

export function fakeCalibration(events: readonly FeedbackEvent[]): Calibration | null {
  return events.length === 0 ? null : { version: 1, builtAt: '2025-01-01T00:00:00.000Z', eventCount: events.length };
}

/** Invented statement layout (no personal data) for template tests. */
export function makeDraft(over: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: 'Test bank savings (PDF)',
    institution: 'ICICI',
    accountType: 'savings',
    fileKind: 'pdf',
    signature: { markers: ['test bank', 'testbank.example'], headerTokens: ['date', 'particulars', 'withdrawals', 'deposits', 'balance'], columnCount: 5 },
    columns: [
      { role: 'date', header: 'date', x0: 10, x1: 60 },
      { role: 'description', header: 'particulars', x0: 70, x1: 250 },
      { role: 'debit', header: 'withdrawals', x0: 260, x1: 320 },
      { role: 'credit', header: 'deposits', x0: 330, x1: 390 },
      { role: 'balance', header: 'balance', x0: 400, x1: 470 },
    ],
    dateOrder: 'DMY',
    descriptionLayout: 'below',
    amountStyle: 'split',
    ...over,
  };
}

/** Fake matcher: links a 'XFEROUT' debit with the 'XFERIN' credit of the same amount. Idempotent. */
export function fakeLink(txns: readonly Transaction[]): LinkUpdate[] {
  const out: LinkUpdate[] = [];
  const free = (t: Transaction) => !t.linkId && t.kindSource !== 'user';
  for (const o of txns.filter((t) => free(t) && /XFEROUT/i.test(t.rawDescription))) {
    const i = txns.find((t) => free(t) && t.id !== o.id && /XFERIN/i.test(t.rawDescription) && t.amount === o.amount);
    if (!i) continue;
    const linkId = `link-${o.id}`;
    out.push({ txnId: o.id, patch: { linkId, linkRole: 'transfer_out', linkedTxnId: i.id, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default' } });
    out.push({ txnId: i.id, patch: { linkId, linkRole: 'transfer_in', linkedTxnId: o.id, kind: 'self_transfer', kindSource: 'match', category: 'self_transfer', categorySource: 'kind_default' } });
  }
  return out;
}

// ─── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;

export function makeRow(over: Partial<ParsedRow> & Pick<ParsedRow, 'date' | 'amount' | 'description'>): ParsedRow {
  seq++;
  return {
    direction: 'debit',
    source: { page: 1, lineStart: seq, lineEnd: seq, rawLines: [over.description] },
    warnings: [],
    ...over,
  };
}

export function makeParsed(rows: ParsedRow[], over: Partial<ParsedStatement> = {}): ParsedStatement {
  return {
    parserId: 'test',
    parserVersion: 1,
    institution: 'ICICI',
    accountType: 'savings',
    accountMask: '1234',
    holderName: 'TEST HOLDER',
    periodStart: rows[0]?.date,
    periodEnd: rows[rows.length - 1]?.date,
    rows,
    skipped: [],
    warnings: [],
    reconciliation: { status: 'unverified', checks: [], rowBalanceBreaks: 0 },
    detection: { confidence: 1, reasons: [] },
    ...over,
  };
}

export function fileOf(name: string, content: string): StatementFile {
  return { name, bytes: new TextEncoder().encode(content), type: 'application/pdf' };
}

export function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'ICICI Savings ••1234',
    institution: 'ICICI',
    type: 'savings',
    mask: '1234',
    currency: 'INR',
    createdAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeTxn(over: Partial<Transaction> = {}): Transaction {
  seq++;
  return {
    id: `t-${seq}`,
    accountId: 'acc-1',
    statementId: 'st-1',
    date: '2025-01-10',
    amount: 10000,
    direction: 'debit',
    rawDescription: 'SWIGGY ORDER',
    channel: 'UPI',
    counterparty: { type: 'merchant', name: 'SWIGGY' },
    merchant: 'Swiggy',
    merchantKey: 'swiggy',
    kind: 'expense',
    kindSource: 'heuristic',
    category: 'food_dining',
    categorySource: 'builtin_rule',
    confidence: 0.9,
    reasons: ['Known merchant Swiggy'],
    needsReview: false,
    reviewReasons: [],
    fingerprint: `fp-${seq}`,
    source: { page: 1, lineStart: seq, lineEnd: seq, rawLines: [] },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}
