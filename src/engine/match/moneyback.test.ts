import { describe, expect, it } from 'vitest';
import type { ChargeLink, RefundAllocation, RefundCase, Transaction } from '@/domain/types';
import { CARD, understood } from '@/engine/understand/testkit';
import { linkCharges, proposeRefundAllocations } from './index';

const none = { cases: [] as RefundCase[], allocations: [] as RefundAllocation[] };
const buy = (id: string, amount: number, date: string, desc = 'UPI-412345678921-Amazon I ndia IN') => understood(id, desc, 'debit', amount, date, CARD);
const credit = (id: string, amount: number, date: string, desc = 'AMAZON INDIA') => understood(id, desc, 'credit', amount, date, CARD);
const sum = (p: ReturnType<typeof proposeRefundAllocations>, creditId: string) => p.allocations.filter((a) => a.creditTxnId === creditId).reduce((s, a) => s + a.amount, 0);

describe('proposeRefundAllocations', () => {
  it('two partial refunds (₹2,000 + ₹3,000) both fill the same ₹5,000 purchase', () => {
    const p = proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r1', 200_000, '2024-06-10'), credit('r2', 300_000, '2024-06-20')], none);
    expect(p.allocations.map((a) => [a.creditTxnId, a.purchaseTxnId, a.amount])).toEqual([
      ['r1', 'b', 200_000],
      ['r2', 'b', 300_000],
    ]);
    expect(p.newCases).toHaveLength(1);
    // Fully refunded: the case closes as received with the purchase amount as the expectation.
    expect(p.newCases[0]).toMatchObject({ expectedSource: 'full_purchase', expectedAmount: 500_000, purchaseTxnIds: ['b'], state: 'closed', closedReason: 'received' });
    expect(new Set(p.allocations.map((a) => a.caseId))).toEqual(new Set([p.newCases[0].tempKey]));
    expect(p.ambiguous).toEqual([]);
    expect(p.unmatched).toEqual([]);
  });

  it('a partial return smaller than the purchase allocates only the credited amount', () => {
    const p = proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r', 120_000, '2024-06-10')], none);
    expect(p.allocations).toHaveLength(1);
    expect(p.allocations[0]).toMatchObject({ purchaseTxnId: 'b', amount: 120_000, source: 'auto' });
  });

  it('a refund in a later month still matches within 120 days', () => {
    expect(proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r', 500_000, '2024-08-15')], none).allocations).toHaveLength(1);
    const late = proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r', 500_000, '2024-10-15')], none);
    expect(late.allocations).toEqual([]);
    expect(late.unmatched).toEqual(['r']);
  });

  it('several plausible purchases make the credit ambiguous and allocate nothing', () => {
    const p = proposeRefundAllocations([buy('a', 500_000, '2024-06-01'), buy('b', 800_000, '2024-06-05'), credit('r', 200_000, '2024-06-10')], none);
    expect(p.allocations).toEqual([]);
    expect(p.ambiguous).toHaveLength(1);
    expect(p.ambiguous[0]).toMatchObject({ creditTxnId: 'r' });
    expect([...p.ambiguous[0].candidatePurchaseIds].sort()).toEqual(['a', 'b']);
  });

  it('an exact amount among several purchases is chosen', () => {
    const p = proposeRefundAllocations([buy('a', 500_000, '2024-06-01'), buy('b', 800_000, '2024-06-05'), credit('r', 800_000, '2024-06-10')], none);
    expect(p.allocations.map((a) => a.purchaseTxnId)).toEqual(['b']);
  });

  it('splits one credit across purchases only on an exact sum', () => {
    const p = proposeRefundAllocations([buy('a', 200_000, '2024-06-01'), buy('b', 300_000, '2024-06-05'), credit('r', 500_000, '2024-06-10')], none);
    expect(p.allocations.map((a) => [a.purchaseTxnId, a.amount])).toEqual([
      ['a', 200_000],
      ['b', 300_000],
    ]);
    const inexact = proposeRefundAllocations([buy('a', 200_000, '2024-06-01'), buy('b', 300_000, '2024-06-05'), credit('r', 450_000, '2024-06-10')], none);
    expect(inexact.allocations).toEqual([]);
    expect(inexact.unmatched).toEqual(['r']);
  });

  it('no purchase at the merchant, or a purchase after the credit, is unmatched', () => {
    expect(proposeRefundAllocations([credit('r', 100_000, '2024-06-10')], none).unmatched).toEqual(['r']);
    expect(proposeRefundAllocations([buy('b', 100_000, '2024-06-20'), credit('r', 100_000, '2024-06-10')], none).unmatched).toEqual(['r']);
  });

  it('never reuses allocated amounts and keeps user allocations and cases', () => {
    const userCase = { id: 'case1', purchaseTxnIds: ['b'], merchant: 'Amazon', merchantKey: 'amazon', expectedSource: 'user', state: 'open' } as RefundCase;
    const userAlloc = { id: 'x', caseId: 'case1', creditTxnId: 'r1', purchaseTxnId: 'b', amount: 200_000, source: 'user', reason: 'mine', createdAt: '' } as RefundAllocation;
    const tooBig = proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r1', 200_000, '2024-06-10'), credit('r2', 400_000, '2024-06-20')], {
      cases: [userCase],
      allocations: [userAlloc],
    });
    // r1 is already allocated; r2 (₹4,000) does not fit in the ₹3,000 the purchase has left
    expect(tooBig.allocations).toEqual([]);
    expect(sum(tooBig, 'r2')).toBe(0);
    expect(tooBig.newCases).toEqual([]);
    const fits = proposeRefundAllocations([buy('b', 500_000, '2024-06-01'), credit('r1', 200_000, '2024-06-10'), credit('r2', 300_000, '2024-06-20')], {
      cases: [userCase],
      allocations: [userAlloc],
    });
    expect(fits.allocations).toEqual([expect.objectContaining({ caseId: 'case1', creditTxnId: 'r2', amount: 300_000 })]);
    expect(fits.newCases).toEqual([]);
  });

  it('is idempotent once its allocations are saved', () => {
    const txns = [buy('b', 500_000, '2024-06-01'), credit('r1', 200_000, '2024-06-10'), credit('r2', 300_000, '2024-06-20')];
    const first = proposeRefundAllocations(txns, none);
    const cases = first.newCases.map((c) => ({ ...c, id: 'c1', createdAt: '', updatedAt: '' })) as RefundCase[];
    const saved = first.allocations.map((a, i) => ({ ...a, id: `a${i}`, caseId: 'c1', createdAt: '' })) as RefundAllocation[];
    const again = proposeRefundAllocations(txns, { cases, allocations: saved });
    expect(again.allocations).toEqual([]);
    expect(again.newCases).toEqual([]);
  });
});

describe('charges: understanding', () => {
  it('labels fee rows by type and carries the fee type on GST rows and reversals', () => {
    const fee = understood('f', 'FUEL SURCHARGE', 'debit', 2_000, '2024-06-10', CARD);
    const gst = understood('g', 'IGST ON FUEL SURCHARGE', 'debit', 360, '2024-06-10', CARD);
    const rev = understood('r', 'FUEL SURCHARGE REVERSAL', 'credit', 2_000, '2024-06-20', CARD);
    expect(fee).toMatchObject({ kind: 'fee', chargeType: 'fuel_surcharge', merchant: 'Fuel surcharge', merchantKey: 'charge:fuel_surcharge' });
    expect(gst).toMatchObject({ kind: 'fee', chargeType: 'fuel_surcharge', merchant: 'GST on fuel surcharge', merchantKey: 'charge:gst:fuel_surcharge' });
    expect(rev).toMatchObject({ kind: 'refund', category: 'fees_charges', chargeType: 'fuel_surcharge', merchant: 'Fuel surcharge reversed' });
  });

  it.each([
    ['ANNUAL FEE', 'annual_fee'],
    ['JOINING FEE', 'joining_fee'],
    ['LATE PAYMENT FEE', 'late_payment_fee'],
    ['FINANCE CHARGES', 'finance_charge'],
    ['FOREX MARKUP FEE', 'forex_markup'],
    ['ATM CHARGES', 'atm_charge'],
    ['CASH ADVANCE FEE', 'cash_advance_fee'],
    ['PROCESSING FEE', 'processing_fee'],
    ['CONVENIENCE FEE', 'convenience_fee'],
    ['OVERLIMIT FEE', 'overlimit_fee'],
    ['SMS ALERT CHARGES', 'other_fee'],
  ])('%s is %s', (desc, type) => {
    const u = understood('x', desc, 'debit', 10_000, '2024-06-10', CARD);
    expect(u.kind).toBe('fee');
    expect(u.chargeType).toBe(type);
  });

  it('non-fee rows have no chargeType', () => {
    expect(understood('x', 'SWIGGY BANGALORE', 'debit', 10_000, '2024-06-10', CARD).chargeType).toBeUndefined();
  });
});

describe('linkCharges', () => {
  const fuel = understood('fuel', 'INDIAN OIL PETROL PUMP', 'debit', 200_000, '2024-06-10', CARD);
  const surcharge = understood('s', 'FUEL SURCHARGE', 'debit', 2_000, '2024-06-10', CARD);
  const gst = understood('g', 'IGST ON FUEL SURCHARGE', 'debit', 360, '2024-06-11', CARD);
  const reversal = understood('r', 'FUEL SURCHARGE REVERSAL', 'credit', 2_000, '2024-06-25', CARD);
  const net = (links: Omit<ChargeLink, 'id'>[], all: Transaction[]) =>
    links.reduce((s, l) => {
      const t = all.find((x) => x.id === l.txnId)!;
      return s + (t.direction === 'debit' ? t.amount : -t.amount);
    }, 0);

  it('groups surcharge, GST and reversal, links the fuel purchase, and leaves ₹3.60 net when GST is not reversed', () => {
    expect(fuel.kind).toBe('expense');
    const all = [fuel, surcharge, gst, reversal];
    const links = linkCharges(all, []);
    expect(new Set(links.map((l) => l.groupId)).size).toBe(1);
    expect(links.map((l) => [l.txnId, l.role]).sort()).toEqual([
      ['g', 'tax'],
      ['r', 'reversal'],
      ['s', 'charge'],
    ]);
    expect(links.every((l) => l.chargeType === 'fuel_surcharge' && l.reason)).toBe(true);
    expect(links.find((l) => l.txnId === 's')!.relatedPurchaseTxnId).toBe('fuel');
    expect(net(links, all)).toBe(360);
  });

  it('adds a GST reversal to the group when one arrives', () => {
    const taxRev = understood('gr', 'IGST ON FUEL SURCHARGE REVERSAL', 'credit', 360, '2024-06-25', CARD);
    const links = linkCharges([surcharge, gst, reversal, taxRev], []);
    expect(links.find((l) => l.txnId === 'gr')?.role).toBe('tax_reversal');
  });

  it('does not invent a purchase: wrong amount, or two equally plausible purchases, relate to nothing', () => {
    const other = understood('o', 'INDIAN OIL PETROL PUMP', 'debit', 900_000, '2024-06-10', CARD);
    expect(linkCharges([other, surcharge], []).find((l) => l.txnId === 's')!.relatedPurchaseTxnId).toBeUndefined();
    const twin = understood('fuel2', 'BPCL PETROL PUMP', 'debit', 200_000, '2024-06-10', CARD);
    expect(linkCharges([fuel, twin, surcharge], []).find((l) => l.txnId === 's')!.relatedPurchaseTxnId).toBeUndefined();
  });

  it('GST that is not about 18% of the charge is not attached', () => {
    const odd = understood('g2', 'IGST ON FUEL SURCHARGE', 'debit', 1_000, '2024-06-11', CARD);
    const links = linkCharges([surcharge, odd], []);
    expect(links.find((l) => l.txnId === 'g2')!.groupId).not.toBe(links.find((l) => l.txnId === 's')!.groupId);
  });

  it('keeps user links and is idempotent', () => {
    const user: ChargeLink = { id: 'u', groupId: 'mine', txnId: 's', chargeType: 'fuel_surcharge', role: 'charge', source: 'user', reason: 'mine' };
    const out = linkCharges([surcharge, gst, reversal], [user]);
    expect(out.find((l) => l.txnId === 's')).toBeUndefined();
    expect(out.some((l) => l.groupId === 'mine')).toBe(false);
    const first = linkCharges([surcharge, gst, reversal], []);
    const saved = first.map((l, i) => ({ ...l, id: String(i) }));
    expect(linkCharges([surcharge, gst, reversal], saved)).toEqual([]);
  });
});
