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
 *   4. same-account debit ↔ later credit (≤ 2 days, same amount & merchantKey) AND evidence of failure/reversal
 *      (FAILED, REVERSAL, REV, declined, or the same reference)           → reversal pair. No evidence → a refund.
 *   6. (flag only) three or more ₹40,000+ near-limit card payments through gateways within a week get a review reason
 *   5. credit with refund signals / on a card, with a purchase at the same merchant in the previous 120 days
 *      → kind 'refund' + the purchase's category. NO link fields: refunds are many-to-many and owned by
 *      `proposeRefundAllocations` (RefundAllocation), not by one-to-one links.
 *
 * A transaction is only touched if it has no link yet and its kindSource is not 'user'/'user_rule', so a
 * second run over the patched ledger returns no updates.
 */
import { KIND_DEFAULT_CATEGORY, UNCATEGORIZED } from '@/domain/categories';
import type { Account, CategorySource, ChargeLink, ChargeType, LinkRole, RefundAllocation, RefundCase, Transaction, TxnKind } from '@/domain/types';
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
const REFUND_WINDOW_DAYS = 120;
const PAIR_CONFIDENCE = 0.9;

/** Review flag for bursts of large, near-limit card payments through payment gateways (no judgement, just a flag). */
export const GATEWAY_BURST_REASON = 'Several large gateway payments close together';
const GATEWAY_BURST_MIN_AMOUNT = 4_000_000; // ₹40,000
const GATEWAY_BURST_ENDINGS: ReadonlySet<number> = new Set([99, 98, 97, 95]);
const GATEWAY_BURST_WINDOW_DAYS = 7;
const GATEWAY_BURST_MIN_ROWS = 3;

const REFUND_SIGNAL = /\b(?:REFUND(?:ED)?|REVERS(?:AL|ED|E)|CASH ?BACK|CHARGEBACK|FAILED|RETURN(?:ED)?|CANCEL(?:L?ED)?|REV)\b/i;
/** Evidence that a credit undoes a failed/reversed debit (a plain "refund" is NOT evidence: that is money back). */
const REVERSAL_EVIDENCE = /\b(?:REVERS(?:AL|ED|E)|FAILED|REV|DECLINED|UNSUCCESS(?:FUL)?|AUTO ?REV)\b/i;
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

  // ── 4. reversal: debit then the same amount back within two days, WITH evidence ─────────────
  // Evidence = failure/reversal wording, or the same bank reference on both legs. A plain next-day credit
  // from the same merchant (a genuine refund) is not a reversal; stage 5 treats it as a refund.
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
        const sameRef = !!d.reference && d.reference === c.reference;
        const wording = REVERSAL_EVIDENCE.test(c.rawDescription) || REVERSAL_EVIDENCE.test(d.rawDescription);
        if (!sameRef && !wording) continue;
        cands.push({ a: d, b: c, gap, strength: (sameRef ? 2 : 0) + (wording ? 1 : 0) });
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

  // ── 5. refund: credit with an earlier purchase at the same merchant → kind 'refund' + category ─
  // Many-to-many: no exclusivity and no link fields. Which purchase a credit settles is decided by
  // proposeRefundAllocations. A credit already marked by this stage is left alone (idempotent).
  {
    const refundCredits = txns.filter((t) => {
      if (t.direction !== 'credit' || !t.merchantKey || isLocked(t) || patches.has(t.id)) return false;
      if (t.linkId || (t.kind === 'refund' && t.kindSource === 'match')) return false;
      if (t.kind === 'refund' || t.kind === 'unknown') return true;
      if (typeOf(t) === 'credit_card' && t.kind !== 'card_payment' && t.kind !== 'self_transfer') return true;
      return REFUND_SIGNAL.test(t.rawDescription) && ['p2p_in', 'income'].includes(t.kind);
    });
    const byKey = groupBy(
      txns.filter((t) => t.direction === 'debit' && SPENDING_DEBIT_KINDS.has(t.kind) && t.merchantKey),
      (t) => `${t.accountId}|${t.merchantKey}`,
    );
    for (const credit of refundCredits) {
      const purchases = (byKey.get(`${credit.accountId}|${credit.merchantKey}`) ?? []).filter((d) => {
        const gap = daysBetween(d.date, credit.date);
        return gap >= 0 && gap <= REFUND_WINDOW_DAYS;
      });
      const total = purchases.reduce((s, d) => s + d.amount, 0);
      if (purchases.length === 0 || credit.amount > total) continue;
      // the purchase that best explains the credit: smallest purchase that covers it, else the largest
      const covering = purchases.filter((d) => d.amount >= credit.amount).sort((x, y) => x.amount - y.amount || y.date.localeCompare(x.date));
      const original = covering[0] ?? [...purchases].sort((x, y) => y.amount - x.amount)[0];
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
        reasons: [...credit.reasons, `${partial}refund of a ${formatINR(original.amount)} purchase on ${original.date} (${original.merchant || 'same merchant'})`],
        needsReview: category === UNCATEGORIZED,
        reviewReasons: category === UNCATEGORIZED ? ['No category matched'] : [],
      });
    }
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

// ─── Wave 8: money back & charges (contracts) ────────────────────────────────

export interface RefundProposal {
  /** New auto allocations (never over-allocating a credit or a case). */
  allocations: Omit<RefundAllocation, 'id' | 'createdAt'>[];
  /** Cases to create for credits matched to a purchase with no case yet (expectedSource 'unknown'). */
  newCases: (Omit<RefundCase, 'id' | 'createdAt' | 'updatedAt'> & { tempKey: string })[];
  /** For newCases, allocations reference `tempKey` in caseId. */
  /** Refund credits with several plausible purchases: the user must choose. */
  ambiguous: { creditTxnId: string; candidatePurchaseIds: string[]; reason: string }[];
  /** Refund-like credits with no plausible purchase in the imported statements. */
  unmatched: string[];
}

/** Credits can settle a purchase up to this many days after it. */
const ALLOCATION_WINDOW_DAYS = 120;
const PURCHASE_KINDS: ReadonlySet<TxnKind> = new Set<TxnKind>(['expense', 'unknown']);

/** Combinations (2 or 3 items) whose remaining amounts add up exactly to `target`. */
function sumTo(target: number, items: readonly { id: string; left: number }[]): string[][] {
  const out: string[][] = [];
  const walk = (start: number, picked: string[], sum: number) => {
    if (sum === target && picked.length >= 2) out.push([...picked]);
    if (picked.length >= 3 || sum >= target) return;
    for (let i = start; i < items.length; i++) walk(i + 1, [...picked, items[i].id], sum + items[i].left);
  };
  walk(0, [], 0);
  return out;
}

/**
 * Many-to-many refund matching: several credits can settle one purchase, one credit can be split across
 * purchases only when the sums are exact. Existing allocations (user or auto) are kept and counted, so a
 * credit amount is never used twice and a purchase is never over-allocated.
 */
export function proposeRefundAllocations(
  txns: readonly Transaction[],
  ctx: { cases: readonly RefundCase[]; allocations: readonly RefundAllocation[] },
): RefundProposal {
  const creditUsed = new Map<string, number>();
  const purchaseUsed = new Map<string, number>();
  for (const a of ctx.allocations) {
    creditUsed.set(a.creditTxnId, (creditUsed.get(a.creditTxnId) ?? 0) + a.amount);
    if (a.purchaseTxnId) purchaseUsed.set(a.purchaseTxnId, (purchaseUsed.get(a.purchaseTxnId) ?? 0) + a.amount);
  }
  const caseOfPurchase = new Map<string, string>();
  for (const c of ctx.cases) for (const id of c.purchaseTxnIds) if (!caseOfPurchase.has(id)) caseOfPurchase.set(id, c.id);

  const purchasesByKey = groupBy(
    txns.filter((t) => t.direction === 'debit' && PURCHASE_KINDS.has(t.kind) && t.merchantKey && t.category !== 'fees_charges'),
    (t) => t.merchantKey,
  );
  const credits = txns
    .filter((t) => {
      if (t.direction !== 'credit' || !t.merchantKey || t.linkRole === 'reversal' || t.kind === 'reversal') return false;
      if (t.category === 'fees_charges') return false;
      if (t.kind === 'refund' || t.kind === 'unknown') return true;
      return REFUND_SIGNAL.test(t.rawDescription) && ['p2p_in', 'income'].includes(t.kind);
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.id < b.id ? -1 : 1));

  const out: RefundProposal = { allocations: [], newCases: [], ambiguous: [], unmatched: [] };
  const newCaseFor = new Map<string, string>();
  const left = (p: Transaction) => p.amount - (purchaseUsed.get(p.id) ?? 0);

  function allocate(credit: Transaction, purchase: Transaction, amount: number, why: string): void {
    let caseId = caseOfPurchase.get(purchase.id) ?? newCaseFor.get(purchase.id);
    if (!caseId) {
      caseId = `new:${purchase.id}`;
      newCaseFor.set(purchase.id, caseId);
      out.newCases.push({
        tempKey: caseId,
        purchaseTxnIds: [purchase.id],
        merchant: purchase.merchant,
        merchantKey: purchase.merchantKey,
        expectedSource: 'unknown',
        state: 'open',
      });
    }
    out.allocations.push({
      caseId,
      creditTxnId: credit.id,
      purchaseTxnId: purchase.id,
      amount,
      source: 'auto',
      reason: `${formatINR(amount)} of the ${formatINR(purchase.amount)} ${purchase.merchant || 'purchase'} on ${purchase.date}: ${why}`,
    });
    creditUsed.set(credit.id, (creditUsed.get(credit.id) ?? 0) + amount);
    purchaseUsed.set(purchase.id, (purchaseUsed.get(purchase.id) ?? 0) + amount);
  }

  for (const credit of credits) {
    const remaining = credit.amount - (creditUsed.get(credit.id) ?? 0);
    if (remaining <= 0) continue;
    const candidates = (purchasesByKey.get(credit.merchantKey) ?? []).filter((p) => {
      const gap = daysBetween(p.date, credit.date);
      return gap >= 0 && gap <= ALLOCATION_WINDOW_DAYS && left(p) > 0;
    });
    if (candidates.length === 0) {
      out.unmatched.push(credit.id);
      continue;
    }
    const fits = candidates.filter((p) => left(p) >= remaining);
    if (fits.length === 1) {
      allocate(credit, fits[0], remaining, 'same merchant, credited after the purchase');
      continue;
    }
    if (fits.length > 1) {
      const exact = fits.filter((p) => left(p) === remaining);
      if (exact.length === 1) allocate(credit, exact[0], remaining, 'exact amount');
      else
        out.ambiguous.push({
          creditTxnId: credit.id,
          candidatePurchaseIds: fits.map((p) => p.id),
          reason: `${formatINR(remaining)} from ${credit.merchant || 'this merchant'} could settle any of ${fits.length} purchases: choose which one`,
        });
      continue;
    }
    // no single purchase can take it all: only an exact sum of purchases is strong enough to split
    const sums = sumTo(remaining, candidates.map((p) => ({ id: p.id, left: left(p) })));
    if (sums.length === 1) {
      for (const id of sums[0]) {
        const p = candidates.find((x) => x.id === id)!;
        allocate(credit, p, left(p), 'the credit equals these purchases exactly');
      }
    } else if (sums.length > 1) {
      out.ambiguous.push({
        creditTxnId: credit.id,
        candidatePurchaseIds: [...new Set(sums.flat())],
        reason: `${formatINR(remaining)} matches several combinations of purchases: choose how to split it`,
      });
    } else {
      out.unmatched.push(credit.id);
    }
  }
  // A purchase whose credits now cover it in full needs no confirmation: it was refunded in full.
  const txnById = new Map(txns.map((t) => [t.id, t]));
  for (const nc of out.newCases) {
    const purchase = txnById.get(nc.purchaseTxnIds[0]);
    if (purchase && left(purchase) <= 0) {
      nc.expectedSource = 'full_purchase';
      nc.expectedAmount = purchase.amount;
      nc.state = 'closed';
      nc.closedReason = 'received';
    }
  }
  return out;
}

const GST_RATE = 0.18;

function isTaxRow(t: Transaction): boolean {
  return t.merchantKey.startsWith('charge:gst:') || /^GST on /i.test(t.merchant) || /\b(?:I|C|S|UT)?GST\b/i.test(t.rawDescription);
}
const taxFits = (charge: number, tax: number): boolean => Math.abs(tax - Math.round(charge * GST_RATE)) <= 1;

/**
 * Group fee components into charge events: charge ↔ its tax ↔ reversal(s) ↔ related purchase
 * (e.g. fuel purchase → 1% surcharge → GST on surcharge → surcharge reversed). Keeps user links:
 * transactions already linked are never regrouped, and a group the user built is left as is.
 * Returns only NEW links (a repeat run over the result returns []).
 */
export function linkCharges(txns: readonly Transaction[], existing: readonly ChargeLink[]): Omit<ChargeLink, 'id'>[] {
  const linked = new Set(existing.map((l) => l.txnId));
  const groupOf = new Map(existing.map((l) => [l.txnId, l.groupId]));
  const userGroups = new Set(existing.filter((l) => l.source === 'user').map((l) => l.groupId));
  const rows = txns.filter((t) => t.chargeType && !linked.has(t.id));
  const used = new Set<string>();
  const out: Omit<ChargeLink, 'id'>[] = [];
  const byDate = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date) || (a.id < b.id ? -1 : 1);

  const charges = rows.filter((t) => t.direction === 'debit' && !isTaxRow(t)).sort(byDate);
  const taxes = rows.filter((t) => t.direction === 'debit' && isTaxRow(t)).sort(byDate);
  const reversals = rows.filter((t) => t.direction === 'credit' && !isTaxRow(t)).sort(byDate);
  const taxReversals = rows.filter((t) => t.direction === 'credit' && isTaxRow(t)).sort(byDate);
  // a tax row carries the fee's type; a plain "IGST" row (generic type) can tax any fee on the same account
  const sameKind = (a: Transaction, b: Transaction) =>
    a.accountId === b.accountId && (a.chargeType === b.chargeType || b.merchantKey === 'charge:gst:other_fee' || b.merchantKey === 'charge:gst:bank_charge');
  const take = (list: Transaction[], ok: (t: Transaction) => boolean): Transaction | undefined => {
    const hit = list.find((t) => !used.has(t.id) && ok(t));
    if (hit) used.add(hit.id);
    return hit;
  };
  const push = (groupId: string, t: Transaction, chargeType: ChargeType, role: ChargeLink['role'], reason: string): Omit<ChargeLink, 'id'> => {
    const link: Omit<ChargeLink, 'id'> = { groupId, txnId: t.id, chargeType, role, source: 'auto', reason };
    out.push(link);
    return link;
  };
  const within = (from: string, to: string, max: number) => {
    const g = daysBetween(from, to);
    return g >= 0 && g <= max;
  };

  for (const charge of charges) {
    if (used.has(charge.id)) continue;
    used.add(charge.id);
    const type = charge.chargeType!;
    const existingGroup = groupOf.get(charge.id);
    if (existingGroup && userGroups.has(existingGroup)) continue;
    const groupId = existingGroup ?? `charge:${charge.id}`;

    const head = push(groupId, charge, type, 'charge', `${formatINR(charge.amount)} ${charge.merchant || type} on ${charge.date}`);

    const tax = take(taxes, (t) => sameKind(charge, t) && within(charge.date, t.date, 1) && taxFits(charge.amount, t.amount));
    if (tax) push(groupId, tax, type, 'tax', `GST ${formatINR(tax.amount)} is about 18% of the ${formatINR(charge.amount)} charge`);

    const rev = take(reversals, (t) => sameKind(charge, t) && within(charge.date, t.date, 90) && t.amount <= charge.amount);
    if (rev) {
      push(groupId, rev, type, 'reversal', `${formatINR(rev.amount)} of the ${formatINR(charge.amount)} charge was reversed on ${rev.date}`);
      if (tax) {
        const taxRev = take(taxReversals, (t) => sameKind(charge, t) && within(tax.date, t.date, 90) && taxFits(rev.amount, t.amount));
        if (taxRev) push(groupId, taxRev, type, 'tax_reversal', `GST of ${formatINR(taxRev.amount)} was reversed on ${taxRev.date}`);
      }
    }

    if (type === 'fuel_surcharge') {
      // the fuel purchase this ~1% surcharge belongs to: same or previous day, same account, one clear match
      const near = txns.filter(
        (p) =>
          p.direction === 'debit' &&
          !p.chargeType &&
          p.kind === 'expense' &&
          p.accountId === charge.accountId &&
          within(p.date, charge.date, 1) &&
          Math.abs(charge.amount - Math.round(p.amount * 0.01)) <= 2,
      );
      const sameDay = near.filter((p) => p.date === charge.date);
      const pick = sameDay.length > 0 ? sameDay : near;
      if (pick.length === 1) {
        head.relatedPurchaseTxnId = pick[0].id;
        head.reason += `, about 1% of the ${formatINR(pick[0].amount)} purchase at ${pick[0].merchant}`;
      }
    }
  }

  // tax or reversal rows with no charge to attach to still form their own group
  for (const t of [...taxes, ...reversals, ...taxReversals]) {
    if (used.has(t.id)) continue;
    used.add(t.id);
    const tax = isTaxRow(t);
    const role: ChargeLink['role'] = t.direction === 'debit' ? 'tax' : tax ? 'tax_reversal' : 'reversal';
    push(`charge:${t.id}`, t, t.chargeType!, role, 'No matching charge found in the imported statements');
  }
  return out;
}
