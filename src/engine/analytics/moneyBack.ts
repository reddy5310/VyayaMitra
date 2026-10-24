import type { IsoDate, Paise, RefundAllocation, RefundCase, Transaction } from '@/domain/types';
import { daysBetween } from '@/lib/dates';
import type { MoneyBack, MoneyBackCase } from './index';
import { sum } from './util';

const DEFAULT_OVERDUE_DAYS = 30;

function isRefundLike(t: Transaction): boolean {
  return t.direction === 'credit' && (t.kind === 'refund' || (t.kind === 'p2p_in' && t.category === 'refunds'));
}

/**
 * Money the user expects back versus money that actually arrived.
 *
 * Expected comes from the user (or the full purchase, when the case says so); with neither the case is
 * 'amount_to_confirm', never a percentage. Received is only what has been ALLOCATED to the case from a real
 * credit. A case is overdue when its promised date has passed, or (no promise) 30 days after the latest
 * purchase, while it is open and still outstanding. `needsMatching` lists refund-like credits that are not
 * fully allocated (and not already linked to a purchase), with same-merchant purchases as candidates.
 * `start`/`end` limit the credits listed, not the cases.
 */
export function moneyBack(
  txns: readonly Transaction[],
  ctx: { cases: readonly RefundCase[]; allocations: readonly RefundAllocation[]; start?: IsoDate; end?: IsoDate; today: IsoDate },
): MoneyBack {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const allocByCase = new Map<string, RefundAllocation[]>();
  const allocByCredit = new Map<string, RefundAllocation[]>();
  for (const a of ctx.allocations) {
    (allocByCase.get(a.caseId) ?? allocByCase.set(a.caseId, []).get(a.caseId))?.push(a);
    (allocByCredit.get(a.creditTxnId) ?? allocByCredit.set(a.creditTxnId, []).get(a.creditTxnId))?.push(a);
  }

  const cases: MoneyBackCase[] = ctx.cases.map((c) => {
    const purchases = c.purchaseTxnIds
      .map((id) => byId.get(id))
      .filter((t): t is Transaction => !!t)
      .map((t) => ({ txnId: t.id, date: t.date, amount: t.amount, merchant: t.merchant }));
    const purchaseTotal = sum(purchases.map((p) => p.amount));
    const allocs = allocByCase.get(c.id) ?? [];
    const received = sum(allocs.map((a) => a.amount));
    const expected: Paise | undefined = c.expectedAmount !== undefined ? c.expectedAmount : c.expectedSource === 'full_purchase' ? purchaseTotal : undefined;
    const outstanding = expected !== undefined ? Math.max(0, expected - received) : undefined;
    let status: MoneyBackCase['status'];
    if (c.state === 'closed') status = 'closed';
    else if (expected === undefined) status = 'amount_to_confirm';
    else if (received > expected) status = 'over_received';
    else if (received === expected) status = 'received';
    else if (received > 0) status = 'partially_received';
    else status = 'expected';

    const waiting = c.state === 'open' && (outstanding === undefined ? received === 0 : outstanding > 0);
    const latestPurchase = purchases.reduce<IsoDate | undefined>((m, p) => (m === undefined || p.date > m ? p.date : m), undefined);
    const base = c.promisedDate ?? latestPurchase;
    const ageDays = waiting && base ? Math.max(0, daysBetween(base, ctx.today)) : 0;
    const overdue = waiting && (c.promisedDate ? ctx.today > c.promisedDate : latestPurchase !== undefined && daysBetween(latestPurchase, ctx.today) > DEFAULT_OVERDUE_DAYS);

    const timeline: MoneyBackCase['timeline'] = [
      ...purchases.map((p) => ({ date: p.date, kind: 'purchase' as const, text: `Purchase at ${p.merchant}`, amount: p.amount, txnId: p.txnId })),
      ...allocs.flatMap((a) => {
        const credit = byId.get(a.creditTxnId);
        return credit ? [{ date: credit.date, kind: 'credit' as const, text: `Money received from ${credit.merchant}`, amount: a.amount, txnId: credit.id }] : [];
      }),
      ...(c.promisedDate ? [{ date: c.promisedDate, kind: 'promised' as const, text: 'Promised by this date' }] : []),
      ...(c.notes ? [{ date: c.createdAt.slice(0, 10), kind: 'note' as const, text: c.notes }] : []),
      ...(c.state === 'closed' ? [{ date: c.updatedAt.slice(0, 10), kind: 'closed' as const, text: `Closed${c.closedReason ? ` (${c.closedReason.replace('_', ' ')})` : ''}` }] : []),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return {
      case: c,
      purchases,
      purchaseTotal,
      ...(expected !== undefined ? { expected } : {}),
      received,
      ...(outstanding !== undefined ? { outstanding } : {}),
      status,
      ageDays,
      overdue,
      timeline,
    };
  });

  const inPeriod = (d: IsoDate): boolean => (!ctx.start || d >= ctx.start) && (!ctx.end || d <= ctx.end);
  const received: MoneyBack['received'] = [];
  const needsMatching: MoneyBack['needsMatching'] = [];
  for (const t of txns) {
    const allocs = allocByCredit.get(t.id) ?? [];
    if (!isRefundLike(t) && allocs.length === 0) continue;
    if (!inPeriod(t.date)) continue;
    const allocated = Math.min(t.amount, sum(allocs.map((a) => a.amount)));
    received.push({
      creditTxnId: t.id,
      date: t.date,
      amount: t.amount,
      allocated,
      unallocated: t.amount - allocated,
      merchant: t.merchant,
      caseIds: [...new Set(allocs.map((a) => a.caseId))],
    });
    const alreadyLinked = t.linkedTxnId !== undefined && byId.has(t.linkedTxnId);
    if (isRefundLike(t) && allocated < t.amount && !alreadyLinked) {
      const key = t.merchantKey;
      const candidates = txns
        .filter((p) => p.direction === 'debit' && p.merchantKey === key && p.date <= t.date && daysBetween(p.date, t.date) <= 180)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5)
        .map((p) => p.id);
      needsMatching.push({ creditTxnId: t.id, date: t.date, amount: t.amount, merchant: t.merchant, candidatePurchaseIds: candidates });
    }
  }
  received.sort((a, b) => a.date.localeCompare(b.date));

  const open = cases.filter((c) => c.status === 'expected' || c.status === 'partially_received' || c.status === 'amount_to_confirm');
  return {
    received,
    cases,
    needsMatching,
    totals: {
      receivedInPeriod: sum(received.map((r) => r.amount)),
      expectedOutstanding: sum(open.map((c) => c.outstanding ?? 0)),
      openCases: open.length,
      amountToConfirm: cases.filter((c) => c.status === 'amount_to_confirm').length,
    },
  };
}
