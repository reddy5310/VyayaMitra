/**
 * CONTRACT — owned by the transaction-intelligence module.
 * Cross-transaction understanding: links the two legs of self transfers and card bill payments,
 * refunds to their original purchase, and reversals to the failed debit.
 * Pure and synchronous. Never overrides decisions whose kindSource is 'user' or 'user_rule'.
 *
 * Stages run in this order, each greedy, one-to-one and closest-date-first:
 *   1. card "Refund Amt Transfer to Bank Acc" debit  ↔ bank credit        → self_transfer pair
 *   2. own-account debit ↔ own-account credit (±3 days, same amount, with a hint) → self_transfer pair;
 *      a weak hint (only p2p_out ↔ p2p_in) needs the same or next day and ≥ ₹500
 *   3. bank debit ↔ credit-card credit (±5 days, same amount)             → card_payment pair
 *   4. same-account debit ↔ later credit (≤ 2 days, same amount & merchantKey)     → reversal pair
 *   6. (flag only) three or more ₹40,000+ near-limit card payments through gateways within a week get a review reason
 *   5. credit with refund signals / on a card ↔ earlier debit at the same merchant (≤ 90 days,
 *      credit ≤ debit)                                                    → refund_of / refunded_by
 *
 * A transaction is only touched if it has no link yet and its kindSource is not 'user'/'user_rule', so a
 * second run over the patched ledger returns no updates.
 */
import { KIND_DEFAULT_CATEGORY, UNCATEGORIZED } from '@/domain/categories';
import type { Account, CategorySource, LinkRole, Transaction, TxnKind } from '@/domain/types';
import { daysBetween } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { GATEWAY_PREFIX } from '@/engine/understand/grammars';

export type LinkPatch = Partial<
  Pick<
    Transaction,
    | 'kind'
    | 'kindSource'
    | 'category'
    | 'categorySource'
    | 'confidence'
    | 'linkId'
    | 'linkRole'
    | 'linkedTxnId'
    | 'reasons'
    | 'needsReview'
    | 'reviewReasons'
  >
>;

export interface LinkUpdate {
  txnId: string;
  patch: LinkPatch;
}

const SELF_WINDOW_DAYS = 3;
/** Weak hint (p2p_out ↔ p2p_in only): same or next day, and at least ₹500. */
const WEAK_HINT_WINDOW_DAYS = 1;
const WEAK_HINT_MIN_AMOUNT = 50_000;
const CARD_PAYMENT_WINDOW_DAYS = 5;
const REVERSAL_WINDOW_DAYS = 2;
const REFUND_WINDOW_DAYS = 90;
const PAIR_CONFIDENCE = 0.9;

/** Review flag for bursts of large, near-limit card payments through payment gateways (no judgement, just a flag). */
export const GATEWAY_BURST_REASON = 'Several large gateway payments close together';
const GATEWAY_BURST_MIN_AMOUNT = 4_000_000; // ₹40,000
const GATEWAY_BURST_ENDINGS: ReadonlySet<number> = new Set([99, 98, 97, 95]);
const GATEWAY_BURST_WINDOW_DAYS = 7;
const GATEWAY_BURST_MIN_ROWS = 3;

const REFUND_SIGNAL = /\b(?:REFUND(?:ED)?|REVERS(?:AL|ED|E)|CASH ?BACK|CHARGEBACK|FAILED|RETURN(?:ED)?|CANCEL(?:L?ED)?|REV)\b/i;
const REVERSAL_SIGNAL = /\b(?:REVERS(?:AL|ED|E)|REFUND(?:ED)?|FAILED|RETURN(?:ED)?|CANCEL(?:L?ED)?|REV|UNSUCCESS(?:FUL)?)\b/i;
const CARD_REFUND_TRANSFER = /REFUND AMT TRANSFER|AMT TRANSFER TO BANK|CREDIT BALANCE REFUND|REFUND TO BANK/i;

const SPENDING_DEBIT_KINDS: ReadonlySet<TxnKind> = new Set<TxnKind>(['expense', 'p2p_out', 'unknown', 'fee']);

interface Candidate {
  /** the debit (or first) leg */
  a: Transaction;
  /** the credit (or second) leg */
  b: Transaction;
  gap: number;
  /** higher is better; breaks ties between equally distant candidates */
  strength: number;
}

function isLocked(t: Transaction): boolean {
  return t.kindSource === 'user' || t.kindSource === 'user_rule';
}

function compareCandidates(x: Candidate, y: Candidate): number {
  return x.gap - y.gap || y.strength - x.strength || (x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0) || (x.b.id < y.b.id ? -1 : x.b.id > y.b.id ? 1 : 0);
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function linkTransactions(txns: readonly Transaction[], accounts: readonly Account[]): LinkUpdate[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const typeOf = (t: Transaction) => accountById.get(t.accountId)?.type;
  const nameOf = (t: Transaction) => accountById.get(t.accountId)?.name ?? 'another account';
  const used = new Set<string>();
  const patches = new Map<string, LinkPatch>();

  const free = (t: Transaction) => !used.has(t.id) && !t.linkId && !isLocked(t);
  const pool = txns.filter((t) => !t.linkId && !isLocked(t));
  const debits = pool.filter((t) => t.direction === 'debit');
  const credits = pool.filter((t) => t.direction === 'credit');

  /** Greedy one-to-one assignment, closest first. */
  function assign(candidates: Candidate[], apply: (c: Candidate) => void): void {
    candidates.sort(compareCandidates);
    for (const c of candidates) {
      if (!free(c.a) || !free(c.b)) continue;
      used.add(c.a.id);
      used.add(c.b.id);
      apply(c);
    }
  }

  function linkIdOf(a: Transaction, b: Transaction): string {
    return `link:${[a.id, b.id].sort().join(':')}`;
  }

  function neutralPair(kind: TxnKind, c: Candidate, roleA: LinkRole, roleB: LinkRole, reasonA: string, reasonB: string): void {
    const linkId = linkIdOf(c.a, c.b);
    const legs: Array<[Transaction, Transaction, LinkRole, string]> = [
      [c.a, c.b, roleA, reasonA],
      [c.b, c.a, roleB, reasonB],
    ];
    for (const [self, other, role, reason] of legs) {
      patches.set(self.id, {
        kind,
        kindSource: 'match',
        category: KIND_DEFAULT_CATEGORY[kind],
        categorySource: 'kind_default',
        confidence: PAIR_CONFIDENCE,
        linkId,
        linkRole: role,
        linkedTxnId: other.id,
        reasons: [...self.reasons, reason],
        needsReview: false,
        reviewReasons: [],
      });
    }
  }

  // ── 1. card "Refund Amt Transfer to Bank Acc" ↔ bank credit ─────────────────────────────────
  {
    const cardDebits = debits.filter(
      (t) => typeOf(t) === 'credit_card' && (t.kind === 'self_transfer' || CARD_REFUND_TRANSFER.test(t.rawDescription)),
    );
    const bankCredits = credits.filter((t) => {
      const type = typeOf(t);
      return type !== undefined && type !== 'credit_card' && ['self_transfer', 'p2p_in', 'unknown', 'refund', 'card_payment'].includes(t.kind);
    });
    const byAmount = groupBy(bankCredits, (t) => t.amount);
    const cands: Candidate[] = [];
    for (const d of cardDebits) {
      for (const c of byAmount.get(d.amount) ?? []) {
        const gap = Math.abs(daysBetween(d.date, c.date));
        if (gap <= CARD_PAYMENT_WINDOW_DAYS) cands.push({ a: d, b: c, gap, strength: c.kind === 'self_transfer' ? 2 : 1 });
      }
    }
    assign(cands, (c) =>
      neutralPair(
        'self_transfer',
        c,
        'transfer_out',
        'transfer_in',
        `Card balance refunded to ${nameOf(c.b)} (matching ${formatINR(c.a.amount)} credit)`,
        `Card balance refund received from ${nameOf(c.a)}`,
      ),
    );
  }

  // ── 2. self transfer between two of the user's own (non-card) accounts ──────────────────────
  {
    const outLike: ReadonlySet<TxnKind> = new Set<TxnKind>(['self_transfer', 'p2p_out', 'unknown']);
    const inLike: ReadonlySet<TxnKind> = new Set<TxnKind>(['self_transfer', 'p2p_in', 'unknown']);
    const eligible = (t: Transaction) => {
      const type = typeOf(t);
      return type !== undefined && type !== 'credit_card';
    };
    const byAmount = groupBy(credits.filter(eligible), (t) => t.amount);
    const cands: Candidate[] = [];
    for (const d of debits.filter(eligible)) {
      for (const c of byAmount.get(d.amount) ?? []) {
        if (c.accountId === d.accountId) continue;
        const gap = Math.abs(daysBetween(d.date, c.date));
        if (gap > SELF_WINDOW_DAYS) continue;
        let strength = 0;
        if (d.counterparty.type === 'own_account' || c.counterparty.type === 'own_account') strength = 3;
        else if (d.kind === 'self_transfer' || c.kind === 'self_transfer') strength = 2;
        else if (outLike.has(d.kind) && inLike.has(c.kind)) strength = 1;
        if (strength === 0) continue;
        // Person-to-person legs with nothing else tying them together are too easy to coincide
        // (two friends, same amount): demand the same or next day and a non-trivial amount.
        if (strength === 1 && (gap > WEAK_HINT_WINDOW_DAYS || d.amount < WEAK_HINT_MIN_AMOUNT)) continue;
        cands.push({ a: d, b: c, gap, strength });
      }
    }
    assign(cands, (c) =>
      neutralPair(
        'self_transfer',
        c,
        'transfer_out',
        'transfer_in',
        `Moved to ${nameOf(c.b)} (same ${formatINR(c.a.amount)} within ${c.gap} day${c.gap === 1 ? '' : 's'})`,
        `Received from ${nameOf(c.a)} (same ${formatINR(c.a.amount)} within ${c.gap} day${c.gap === 1 ? '' : 's'})`,
      ),
    );
  }

  // ── 3. credit-card bill: bank debit ↔ card credit ───────────────────────────────────────────
  {
    const cardCredits = credits.filter((t) => typeOf(t) === 'credit_card' && ['card_payment', 'unknown', 'refund'].includes(t.kind));
    const bankDebits = debits.filter((t) => {
      const type = typeOf(t);
      if (type === undefined || type === 'credit_card') return false;
      if (t.kind === 'card_payment' || t.kind === 'unknown') return true;
      // a debit that was read as a purchase/transfer only counts when nothing specific explained it
      return ['expense', 'p2p_out', 'self_transfer'].includes(t.kind) && (t.categorySource === 'none' || t.categorySource === 'kind_default');
    });
    const byAmount = groupBy(bankDebits, (t) => t.amount);
    const cands: Candidate[] = [];
    for (const c of cardCredits) {
      for (const d of byAmount.get(c.amount) ?? []) {
        const gap = Math.abs(daysBetween(d.date, c.date));
        if (gap > CARD_PAYMENT_WINDOW_DAYS) continue;
        const textual = c.kind === 'card_payment' || d.kind === 'card_payment';
        const bothUnknown = c.kind === 'unknown' && d.kind === 'unknown';
        if (!textual && !bothUnknown) continue;
        cands.push({ a: d, b: c, gap, strength: (c.kind === 'card_payment' ? 1 : 0) + (d.kind === 'card_payment' ? 1 : 0) });
      }
    }
    assign(cands, (c) =>
      neutralPair(
        'card_payment',
        c,
        'card_payment_out',
        'card_payment_in',
        `Paid ${formatINR(c.a.amount)} towards ${nameOf(c.b)}`,
        `Bill payment of ${formatINR(c.a.amount)} received from ${nameOf(c.a)}`,
      ),
    );
  }

  // ── 4. reversal: debit then the same amount back within two days ────────────────────────────
  {
    const creditKinds: ReadonlySet<TxnKind> = new Set<TxnKind>(['refund', 'reversal', 'unknown', 'p2p_in']);
    const byKey = groupBy(
      debits.filter((t) => SPENDING_DEBIT_KINDS.has(t.kind) || t.kind === 'cash_withdrawal'),
      (t) => `${t.accountId}|${t.amount}|${t.merchantKey}`,
    );
    const cands: Candidate[] = [];
    for (const c of credits) {
      if (!c.merchantKey || !creditKinds.has(c.kind)) continue;
      for (const d of byKey.get(`${c.accountId}|${c.amount}|${c.merchantKey}`) ?? []) {
        const gap = daysBetween(d.date, c.date);
        if (gap < 0 || gap > REVERSAL_WINDOW_DAYS) continue;
        const person = d.counterparty.type === 'person' || c.counterparty.type === 'person';
        if (person && !REVERSAL_SIGNAL.test(c.rawDescription)) continue;
        cands.push({ a: d, b: c, gap, strength: REVERSAL_SIGNAL.test(c.rawDescription) || c.kind === 'refund' || c.kind === 'reversal' ? 1 : 0 });
      }
    }
    assign(cands, (c) =>
      neutralPair(
        'reversal',
        c,
        'reversal',
        'reversal',
        `Reversed: the same ${formatINR(c.a.amount)} came back after ${c.gap} day${c.gap === 1 ? '' : 's'}`,
        `Reverses the ${formatINR(c.a.amount)} debit of ${c.a.date}`,
      ),
    );
  }

  // ── 5. refund: credit ↔ earlier purchase at the same merchant ───────────────────────────────
  {
    const refundCredits = credits.filter((t) => {
      if (!t.merchantKey) return false;
      if (t.kind === 'refund' || t.kind === 'unknown') return true;
      if (typeOf(t) === 'credit_card' && t.kind !== 'card_payment' && t.kind !== 'self_transfer') return true;
      return REFUND_SIGNAL.test(t.rawDescription) && ['p2p_in', 'income'].includes(t.kind);
    });
    const byKey = groupBy(
      debits.filter((t) => SPENDING_DEBIT_KINDS.has(t.kind) && t.merchantKey),
      (t) => `${t.accountId}|${t.merchantKey}`,
    );
    const cands: Candidate[] = [];
    for (const c of refundCredits) {
      for (const d of byKey.get(`${c.accountId}|${c.merchantKey}`) ?? []) {
        const gap = daysBetween(d.date, c.date);
        if (gap < 0 || gap > REFUND_WINDOW_DAYS || d.amount < c.amount) continue;
        // exact-amount refunds first, then the smallest remaining difference
        const strength = 1000000 - Math.min(999999, d.amount - c.amount);
        cands.push({ a: d, b: c, gap, strength });
      }
    }
    assign(cands, (cand) => {
      const { a: original, b: credit } = cand;
      const linkId = linkIdOf(original, credit);
      const copyCategory = original.category !== UNCATEGORIZED;
      const category = copyCategory ? original.category : credit.category !== UNCATEGORIZED ? credit.category : KIND_DEFAULT_CATEGORY.refund;
      const categorySource: CategorySource = copyCategory
        ? original.categorySource === 'user_txn' || original.categorySource === 'none'
          ? 'kind_default'
          : original.categorySource
        : credit.categorySource;
      const partial = credit.amount < original.amount ? 'partial ' : '';
      patches.set(credit.id, {
        kind: 'refund',
        kindSource: 'match',
        category,
        categorySource,
        confidence: Math.max(credit.confidence, 0.85),
        linkId,
        linkRole: 'refund_of',
        linkedTxnId: original.id,
        reasons: [...credit.reasons, `${partial}refund of the ${formatINR(original.amount)} purchase on ${original.date} (${original.merchant || 'same merchant'})`],
        needsReview: category === UNCATEGORIZED,
        reviewReasons: category === UNCATEGORIZED ? ['No category matched'] : [],
      });
      patches.set(original.id, {
        linkId,
        linkRole: 'refunded_by',
        linkedTxnId: credit.id,
      });
    });
  }

  // ── 6. flag bursts of large near-limit gateway payments on a card (review reason only) ───────
  {
    const suspects = txns.filter(
      (t) =>
        t.direction === 'debit' &&
        typeOf(t) === 'credit_card' &&
        !patches.has(t.id) &&
        t.amount >= GATEWAY_BURST_MIN_AMOUNT &&
        GATEWAY_BURST_ENDINGS.has(Math.floor(t.amount / 100) % 100) &&
        GATEWAY_PREFIX.test(t.rawDescription.trim()),
    );
    const byAccount = groupBy(suspects, (t) => t.accountId);
    for (const rows of byAccount.values()) {
      for (const t of rows) {
        const near = rows.filter((o) => Math.abs(daysBetween(t.date, o.date)) <= GATEWAY_BURST_WINDOW_DAYS);
        if (isLocked(t) || near.length < GATEWAY_BURST_MIN_ROWS || t.reviewReasons.includes(GATEWAY_BURST_REASON)) continue;
        patches.set(t.id, { needsReview: true, reviewReasons: [...t.reviewReasons, GATEWAY_BURST_REASON] });
      }
    }
  }

  return txns.filter((t) => patches.has(t.id)).map((t) => ({ txnId: t.id, patch: patches.get(t.id)! }));
}
