import { describe, expect, it } from 'vitest';
import { metricBucket, signedContribution } from '@/domain/kinds';
import type { Transaction } from '@/domain/types';
import { CARD, OWN, SAVINGS, SECOND, applyUpdates, makeTxn, understood } from '@/engine/understand/testkit';
import { GATEWAY_BURST_REASON, linkTransactions } from './index';

const ACCOUNTS = OWN;

function byId(txns: readonly Transaction[], id: string): Transaction {
  const t = txns.find((x) => x.id === id);
  if (!t) throw new Error(`missing ${id}`);
  return t;
}

function linked(txns: Transaction[]) {
  const updates = linkTransactions(txns, ACCOUNTS);
  return { updates, after: applyUpdates(txns, updates) };
}

/** Income and spending exactly as the app's headline metrics compute them. */
function headline(txns: readonly Transaction[]) {
  let income = 0;
  let spending = 0;
  for (const t of txns) {
    const bucket = metricBucket(t.kind, t.direction);
    const value = signedContribution(t.kind, t.direction, t.amount);
    if (bucket === 'income') income += value;
    if (bucket === 'spending') spending += value;
  }
  return { income, spending };
}

describe('ledger example: salary, card purchase, card bill payment', () => {
  const salary = () => understood('salary', 'NEFT-HDFCN12345678-INFOSYS LIMITED-SAL JUN', 'credit', 1_000_000, '2024-06-01', SAVINGS);
  const purchase = () => understood('purchase', 'SWIGGY BANGALORE', 'debit', 100_000, '2024-06-05', CARD);
  const cardCredit = () => understood('card-credit', 'PAYMENT RECEIVED, THANK YOU', 'credit', 100_000, '2024-06-10', CARD);

  it('income is ₹10,000 and spending ₹1,000 when the bank debit is recognised from its text', () => {
    const debit = understood('bank-debit', 'BIL/123456789/ICICI BANK CREDIT CARD PAYMENT/9', 'debit', 100_000, '2024-06-09', SAVINGS);
    const { after } = linked([salary(), purchase(), debit, cardCredit()]);
    expect(headline(after)).toEqual({ income: 1_000_000, spending: 100_000 });
    expect(byId(after, 'bank-debit').kind).toBe('card_payment');
    expect(byId(after, 'card-credit').kind).toBe('card_payment');
  });

  it('links the two legs when the bank text says nothing', () => {
    const debit = understood('bank-debit', 'SOMETHING OPAQUE 12345', 'debit', 100_000, '2024-06-09', SAVINGS);
    expect(debit.kind).toBe('unknown');
    const before = [salary(), purchase(), debit, cardCredit()];
    // without linking, the unknown debit would be counted as spending
    expect(headline(before).spending).toBe(200_000);
    const { after, updates } = linked(before);
    expect(headline(after)).toEqual({ income: 1_000_000, spending: 100_000 });
    const out = byId(after, 'bank-debit');
    const inn = byId(after, 'card-credit');
    expect(out).toMatchObject({ kind: 'card_payment', kindSource: 'match', linkRole: 'card_payment_out', linkedTxnId: 'card-credit', category: 'card_payment' });
    expect(inn).toMatchObject({ kind: 'card_payment', kindSource: 'match', linkRole: 'card_payment_in', linkedTxnId: 'bank-debit' });
    expect(out.linkId).toBeTruthy();
    expect(out.linkId).toBe(inn.linkId);
    expect(updates.map((u) => u.txnId).sort()).toEqual(['bank-debit', 'card-credit']);
  });

  it('is idempotent', () => {
    const debit = understood('bank-debit', 'SOMETHING OPAQUE 12345', 'debit', 100_000, '2024-06-09', SAVINGS);
    const { after } = linked([salary(), purchase(), debit, cardCredit()]);
    expect(linkTransactions(after, ACCOUNTS)).toEqual([]);
  });
});

describe('card bill payment window', () => {
  it.each([
    [5, true],
    [-5, true],
    [0, true],
    [6, false],
    [-6, false],
  ])('bank debit %i days after the card credit → linked: %s', (offset, expected) => {
    const base = new Date(Date.UTC(2024, 5, 15, 12));
    const debitDate = new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const credit = understood('c', 'PAYMENT RECEIVED, THANK YOU', 'credit', 250_000, '2024-06-15', CARD);
    const debit = understood('d', 'OPAQUE DEBIT', 'debit', 250_000, debitDate, SAVINGS);
    expect(linkTransactions([credit, debit], ACCOUNTS).length > 0).toBe(expected);
  });

  it('does not link a different amount', () => {
    const credit = understood('c', 'PAYMENT RECEIVED, THANK YOU', 'credit', 250_000, '2024-06-15', CARD);
    const debit = understood('d', 'OPAQUE DEBIT', 'debit', 250_001, '2024-06-15', SAVINGS);
    expect(linkTransactions([credit, debit], ACCOUNTS)).toEqual([]);
  });

  it('does not pair a branded purchase with a card credit just because the amounts agree', () => {
    const credit = understood('c', 'PAYMENT RECEIVED, THANK YOU', 'credit', 80_000, '2024-06-15', CARD);
    const debit = understood('d', 'UPI/412345678908/NA/swiggy@icici/ICICI Bank/ICI1', 'debit', 80_000, '2024-06-15', SAVINGS);
    expect(debit.kind).toBe('expense');
    expect(linkTransactions([credit, debit], ACCOUNTS)).toEqual([]);
  });

  it('pairs the closest dates first, one-to-one', () => {
    const credits = [understood('c1', 'PAYMENT RECEIVED, THANK YOU', 'credit', 90_000, '2024-06-10', CARD), understood('c2', 'PAYMENT RECEIVED, THANK YOU', 'credit', 90_000, '2024-07-10', CARD)];
    const debits = [understood('d1', 'OPAQUE DEBIT', 'debit', 90_000, '2024-07-11', SAVINGS), understood('d2', 'OPAQUE DEBIT', 'debit', 90_000, '2024-06-09', SAVINGS)];
    const { after } = linked([...credits, ...debits]);
    expect(byId(after, 'c1').linkedTxnId).toBe('d2');
    expect(byId(after, 'c2').linkedTxnId).toBe('d1');
  });
});

describe('self transfers between own accounts', () => {
  const out = (date = '2024-06-10', amount = 5_000_000) => understood('out', 'UPI/412345678868/NA/rahul.sen@okaxis/Axis Bank/AXL1', 'debit', amount, date, SAVINGS);
  const inn = (date = '2024-06-11', amount = 5_000_000) => understood('in', 'UPI/412345678870/Payment from Ph/rahul.sen@okaxis/Axis Bank/AXL2', 'credit', amount, date, SECOND);

  it('links same amount within 3 days when both legs look like transfers', () => {
    const { after } = linked([out(), inn()]);
    expect(byId(after, 'out')).toMatchObject({ kind: 'self_transfer', kindSource: 'match', linkRole: 'transfer_out', linkedTxnId: 'in', category: 'self_transfer', needsReview: false });
    expect(byId(after, 'in')).toMatchObject({ kind: 'self_transfer', kindSource: 'match', linkRole: 'transfer_in', linkedTxnId: 'out' });
    expect(headline(after)).toEqual({ income: 0, spending: 0 });
    expect(byId(after, 'out').reasons.length).toBeGreaterThan(byId([out()], 'out').reasons.length);
  });

  it.each([
    ['same day', '2024-06-10', true],
    ['next day', '2024-06-11', true],
    ['previous day', '2024-06-09', true],
    // weak hint (only p2p_out ↔ p2p_in): beyond one day it stays two person payments
    ['3 days later', '2024-06-13', false],
    ['3 days earlier', '2024-06-07', false],
    ['2 days later', '2024-06-12', false],
  ])('weak hint window: %s', (_label, creditDate, expected) => {
    expect(linkTransactions([out(), inn(creditDate)], ACCOUNTS).length > 0).toBe(expected);
  });

  it('weak hint needs at least ₹500', () => {
    expect(linkTransactions([out('2024-06-10', 49_999), inn('2024-06-10', 49_999)], ACCOUNTS)).toEqual([]);
    expect(linkTransactions([out('2024-06-10', 50_000), inn('2024-06-10', 50_000)], ACCOUNTS)).toHaveLength(2);
  });

  it.each([
    ['same day', '2024-06-10', true],
    ['3 days later', '2024-06-13', true],
    ['3 days earlier', '2024-06-07', true],
    ['4 days later', '2024-06-14', false],
  ])('strong hint window (a leg already read as a self-transfer): %s', (_label, creditDate, expected) => {
    const strongOut = understood('out', 'TRANSFER TO XX2468 SAVINGS', 'debit', 5_000_000, '2024-06-10', SAVINGS);
    expect(strongOut.kind).toBe('self_transfer');
    expect(linkTransactions([strongOut, inn(creditDate)], ACCOUNTS).length > 0).toBe(expected);
  });

  it('strong hints are not limited by the ₹500 floor', () => {
    const smallOut = understood('out', 'TRANSFER TO XX2468 SAVINGS', 'debit', 10_000, '2024-06-10', SAVINGS);
    const smallIn = understood('in', 'UPI/412345678870/Payment from Ph/rahul.sen@okaxis/Axis Bank/AXL2', 'credit', 10_000, '2024-06-12', SECOND);
    expect(linkTransactions([smallOut, smallIn], ACCOUNTS)).toHaveLength(2);
  });

  it('needs a different amount to be left alone', () => {
    expect(linkTransactions([out(), inn('2024-06-11', 5_000_100)], ACCOUNTS)).toEqual([]);
  });

  it('never links two legs of the same account', () => {
    const second = { ...inn(), accountId: SAVINGS.id };
    expect(linkTransactions([out(), second], ACCOUNTS)).toEqual([]);
  });

  it('never treats a credit-card account as a self-transfer leg', () => {
    const cardLeg = { ...inn(), accountId: CARD.id };
    const updates = linkTransactions([out(), cardLeg], ACCOUNTS);
    expect(updates.filter((u) => u.patch.kind === 'self_transfer')).toEqual([]);
  });

  it('needs a hint: an ordinary purchase and a salary of the same amount are not a transfer', () => {
    const purchase = understood('p', 'UPI/412345678908/NA/swiggy@icici/ICICI Bank/ICI1', 'debit', 5_000_000, '2024-06-10', SAVINGS);
    const salary = understood('s', 'NEFT SALARY', 'credit', 5_000_000, '2024-06-10', SECOND);
    expect(linkTransactions([purchase, salary], ACCOUNTS)).toEqual([]);
  });

  it('uses a holder-name hint from the understanding', () => {
    const named = understood('named', 'IMP-412345678920-9000000011-ANIL KUMAR R -ICICI Bank Limi-IMPS Transacti', 'debit', 700_000, '2024-06-02', SECOND);
    const credit = understood('cr', 'SOME BANK CREDIT LINE', 'credit', 700_000, '2024-06-02', SAVINGS);
    expect(named.counterparty.type).toBe('own_account');
    const { after } = linked([named, credit]);
    expect(byId(after, 'cr')).toMatchObject({ kind: 'self_transfer', linkRole: 'transfer_in' });
  });

  it('prefers the closest date when several credits fit', () => {
    const early = { ...inn('2024-06-08'), id: 'early' };
    const late = { ...inn('2024-06-12'), id: 'late' };
    const near = { ...inn('2024-06-10'), id: 'near' };
    const { after } = linked([out(), early, late, near]);
    expect(byId(after, 'out').linkedTxnId).toBe('near');
    expect(byId(after, 'early').linkId).toBeUndefined();
    expect(byId(after, 'late').linkId).toBeUndefined();
  });

  it('is idempotent and order-independent', () => {
    const txns = [out(), inn()];
    const forward = linkTransactions(txns, ACCOUNTS);
    const backward = linkTransactions([...txns].reverse(), ACCOUNTS);
    expect(backward.map((u) => u.txnId).sort()).toEqual(forward.map((u) => u.txnId).sort());
    expect(linkTransactions(applyUpdates(txns, forward), ACCOUNTS)).toEqual([]);
  });
});

describe('card excess-balance refund to the bank', () => {
  it('links the card debit to the bank credit as a self-transfer pair', () => {
    const cardDebit = understood('cd', 'Refund Amt Transfer to Bank Acc XX1357', 'debit', 3_175, '2024-07-18', CARD);
    const bankCredit = understood('bc', 'UPI/412345678900/Payment from Ph/9000000009@ybl/Bank of Baroda/YBL1', 'credit', 3_175, '2024-07-20', SAVINGS);
    const { after } = linked([cardDebit, bankCredit]);
    expect(byId(after, 'cd')).toMatchObject({ kind: 'self_transfer', linkRole: 'transfer_out', linkedTxnId: 'bc', kindSource: 'match' });
    expect(byId(after, 'bc')).toMatchObject({ kind: 'self_transfer', linkRole: 'transfer_in', linkedTxnId: 'cd' });
    expect(headline(after)).toEqual({ income: 0, spending: 0 });
  });
});

describe('refunds', () => {
  const purchase = (date = '2024-06-01', amount = 200_000) => understood('buy', 'UPI-412345678921-Amazon I ndia IN', 'debit', amount, date, CARD);
  const refund = (date = '2024-06-20', amount = 200_000) => understood('ref', 'AMAZON INDIA', 'credit', amount, date, CARD);

  it('links a card credit to the earlier purchase at the same merchant and copies the category', () => {
    const { after } = linked([purchase(), refund()]);
    expect(byId(after, 'ref')).toMatchObject({ kind: 'refund', kindSource: 'match', category: 'shopping' });
    // refunds are many-to-many: allocations own the pairing, so no one-to-one link fields are written
    expect(byId(after, 'ref').linkId).toBeUndefined();
    expect(byId(after, 'ref').linkedTxnId).toBeUndefined();
    expect(byId(after, 'buy')).toMatchObject({ kind: 'expense' });
    expect(byId(after, 'buy').linkId).toBeUndefined();
    expect(headline(after).spending).toBe(0);
  });

  it('handles partial refunds and keeps the net spending right', () => {
    const { after } = linked([purchase(), refund('2024-06-20', 50_000)]);
    expect(byId(after, 'ref').kind).toBe('refund');
    expect(byId(after, 'ref').reasons.join(' ')).toMatch(/partial refund/);
    expect(headline(after).spending).toBe(150_000);
  });

  it('does not link a refund larger than the purchase', () => {
    expect(linkTransactions([purchase('2024-06-01', 100_000), refund('2024-06-20', 100_001)], ACCOUNTS)).toEqual([]);
  });

  it.each([
    ['120 days later', '2024-09-29', true],
    ['121 days later', '2024-09-30', false],
    ['before the purchase', '2024-05-30', false],
  ])('window: %s', (_label, creditDate, expected) => {
    expect(linkTransactions([purchase(), refund(creditDate)], ACCOUNTS).length > 0).toBe(expected);
  });

  it('does not link across different merchants or accounts', () => {
    const other = understood('ref', 'MEDPLUS', 'credit', 200_000, '2024-06-20', CARD);
    expect(linkTransactions([purchase(), other], ACCOUNTS)).toEqual([]);
    const bankRefund = understood('ref', 'UPI/412345678888/Refund/amazon@apl/Axis Bank/AXL1', 'credit', 200_000, '2024-06-20', SAVINGS);
    expect(linkTransactions([purchase(), bankRefund], ACCOUNTS)).toEqual([]);
  });

  it('links a bank refund that carries refund signals to a bank purchase', () => {
    const buy = understood('buy', 'UPI/412345678902/UPIIntent/myntra.payu@icici/ICICI Bank/PPPL1', 'debit', 56_800, '2024-06-08', SAVINGS);
    const ref = understood('ref', 'UPI/412345678927/Refund/myntra2.payu@hd/HDF C BANKLTD/HDF3D12', 'credit', 14_581, '2024-06-10', SAVINGS);
    const { after } = linked([buy, ref]);
    expect(byId(after, 'ref')).toMatchObject({ kind: 'refund', category: 'shopping' });
  });

  it('two refunds can both relate to the same purchase: no one-to-one exclusivity', () => {
    const r1 = { ...refund('2024-06-12', 80_000), id: 'r1' };
    const r2 = { ...refund('2024-06-13', 120_000), id: 'r2' };
    const { after } = linked([purchase(), r1, r2]);
    expect(byId(after, 'r1').kind).toBe('refund');
    expect(byId(after, 'r2').kind).toBe('refund');
  });

  it('is idempotent', () => {
    const { after } = linked([purchase(), refund()]);
    expect(linkTransactions(after, ACCOUNTS)).toEqual([]);
  });
});

describe('reversals', () => {
  it('pairs a debit with the same amount returning within 2 days as two neutral reversal legs when the bank reference matches', () => {
    const debit = understood('d', 'UPI-412345678922-ZZQ SHOP IN', 'debit', 5_100, '2024-07-12', CARD, { reference: 'R9' });
    const credit = understood('c', 'ZZQ SHOP', 'credit', 5_100, '2024-07-13', CARD, { reference: 'R9' });
    const { after } = linked([debit, credit]);
    expect(byId(after, 'd')).toMatchObject({ kind: 'reversal', linkRole: 'reversal', linkedTxnId: 'c', kindSource: 'match', category: 'reversal' });
    expect(byId(after, 'c')).toMatchObject({ kind: 'reversal', linkRole: 'reversal', linkedTxnId: 'd' });
    expect(headline(after)).toEqual({ income: 0, spending: 0 });
  });

  it('three days later it is a refund, not a reversal', () => {
    const debit = understood('d', 'UPI-412345678922-ZZQ SHOP IN', 'debit', 5_100, '2024-07-12', CARD);
    const credit = understood('c', 'ZZQ SHOP', 'credit', 5_100, '2024-07-15', CARD, { reference: 'R9' });
    const { after } = linked([{ ...debit, reference: 'R9' }, credit]);
    expect(byId(after, 'c').kind).toBe('refund');
  });

  it('a genuine next-day refund at the same merchant is a refund, not a neutral reversal', () => {
    const buy = understood('buy', 'UPI-412345678921-Amazon I ndia IN', 'debit', 200_000, '2024-06-01', CARD);
    const ref = understood('ref', 'AMAZON INDIA', 'credit', 200_000, '2024-06-02', CARD);
    const { after } = linked([buy, ref]);
    expect(byId(after, 'ref').kind).toBe('refund');
    expect(byId(after, 'buy').kind).toBe('expense');
    expect(headline(after).spending).toBe(0);
    expect(after.filter((t) => t.kind === 'reversal')).toHaveLength(0);
  });

  it('the same bank reference on both legs is reversal evidence', () => {
    const debit = understood('d', 'UPI-412345678922-ZZQ SHOP IN', 'debit', 5_100, '2024-07-12', CARD, { reference: 'RRN123' });
    const credit = understood('c', 'ZZQ SHOP', 'credit', 5_100, '2024-07-12', CARD, { reference: 'RRN123' });
    expect(byId(linked([debit, credit]).after, 'c').kind).toBe('reversal');
  });

  it('a person paying back the same amount without any reversal wording is not a reversal', () => {
    const sent = understood('d', 'UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', 100_000, '2024-07-12', SAVINGS);
    const back = understood('c', 'UPI/412345678869/Payment from Ph/priya.menon@okaxis/Axis Bank/AXL2', 'credit', 100_000, '2024-07-13', SAVINGS);
    expect(linkTransactions([sent, back], ACCOUNTS)).toEqual([]);
  });

  it('a person-to-person reversal needs wording like "reversal"', () => {
    const sent = understood('d', 'UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', 100_000, '2024-07-12', SAVINGS);
    const back = understood('c', 'UPI/412345678869/Reversal/priya.menon@okaxis/Axis Bank/AXL2', 'credit', 100_000, '2024-07-13', SAVINGS);
    const { after } = linked([sent, back]);
    expect(byId(after, 'c').kind).toBe('reversal');
  });

  it('is idempotent', () => {
    const debit = understood('d', 'UPI-412345678922-ZZQ SHOP IN', 'debit', 5_100, '2024-07-12', CARD);
    const credit = understood('c', 'ZZQ SHOP', 'credit', 5_100, '2024-07-13', CARD, { reference: 'R9' });
    const { after } = linked([{ ...debit, reference: 'R9' }, credit]);
    expect(byId(after, 'c').kind).toBe('reversal');
    expect(linkTransactions(after, ACCOUNTS)).toEqual([]);
  });
});

describe('user decisions are never overridden', () => {
  const pair = (kindSource: Transaction['kindSource']) => {
    const out = understood('out', 'UPI/412345678868/NA/rahul.sen@okaxis/Axis Bank/AXL1', 'debit', 5_000_000, '2024-06-10', SAVINGS, { kindSource, kind: 'p2p_out' });
    const inn = understood('in', 'UPI/412345678870/Payment from Ph/rahul.sen@okaxis/Axis Bank/AXL2', 'credit', 5_000_000, '2024-06-11', SECOND);
    return [out, inn];
  };

  it.each(['user', 'user_rule'] as const)('skips pairs with a %s-sourced leg entirely', (source) => {
    expect(linkTransactions(pair(source), ACCOUNTS)).toEqual([]);
  });

  it('still links when the same legs are machine decisions', () => {
    expect(linkTransactions(pair('heuristic'), ACCOUNTS)).toHaveLength(2);
  });

  it('never emits an update for a user-locked transaction in any stage', () => {
    const lockedCredit = understood('c', 'PAYMENT RECEIVED, THANK YOU', 'credit', 90_000, '2024-06-10', CARD, { kindSource: 'user', kind: 'income' });
    const debit = understood('d', 'OPAQUE DEBIT', 'debit', 90_000, '2024-06-10', SAVINGS);
    expect(linkTransactions([lockedCredit, debit], ACCOUNTS)).toEqual([]);

    const buy = understood('buy', 'UPI-412345678921-Amazon I ndia IN', 'debit', 200_000, '2024-06-01', CARD, { kindSource: 'user_rule', kind: 'expense' });
    const ref = understood('ref', 'AMAZON INDIA', 'credit', 200_000, '2024-06-20', CARD);
    expect(linkTransactions([buy, ref], ACCOUNTS).map((u) => u.txnId)).not.toContain('buy');
  });
});

describe('purity', () => {
  it('does not mutate its inputs', () => {
    const txns = [
      understood('out', 'UPI/412345678868/NA/rahul.sen@okaxis/Axis Bank/AXL1', 'debit', 5_000_000, '2024-06-10', SAVINGS),
      understood('in', 'UPI/412345678870/Payment from Ph/rahul.sen@okaxis/Axis Bank/AXL2', 'credit', 5_000_000, '2024-06-11', SECOND),
    ];
    const snapshot = JSON.stringify(txns);
    for (const t of txns) Object.freeze(t);
    Object.freeze(txns);
    linkTransactions(txns, ACCOUNTS);
    expect(JSON.stringify(txns)).toBe(snapshot);
  });

  it('returns [] for an empty or unrelated ledger', () => {
    expect(linkTransactions([], ACCOUNTS)).toEqual([]);
    const lone = makeTxn({ accountId: SAVINGS.id, direction: 'debit', amount: 100, date: '2024-06-10' });
    expect(linkTransactions([lone], ACCOUNTS)).toEqual([]);
  });

  it('ignores transactions of unknown accounts for transfer and card stages', () => {
    const a = makeTxn({ id: 'x1', accountId: 'ghost1', direction: 'debit', amount: 100, date: '2024-06-10', kind: 'self_transfer' });
    const b = makeTxn({ id: 'x2', accountId: 'ghost2', direction: 'credit', amount: 100, date: '2024-06-10', kind: 'self_transfer' });
    expect(linkTransactions([a, b], ACCOUNTS)).toEqual([]);
  });
});

describe('refund after an EMI purchase', () => {
  it('links a same-merchant credit within 15 days even though the purchase carried the EMI note', () => {
    const buy = understood('buy', 'CROMA ELECTRONICS (Pay in EMIs)', 'debit', 4_500_000, '2025-01-10', CARD);
    const ref = understood('ref', 'CROMA ELECTRONICS', 'credit', 4_500_000, '2025-01-22', CARD);
    expect(buy.merchantKey).toBe(ref.merchantKey);
    const { after } = linked([buy, ref]);
    expect(byId(after, 'ref')).toMatchObject({ kind: 'refund', category: 'shopping' });
  });
});

describe('bursts of large near-limit gateway payments', () => {
  const gw = (id: string, date: string, amount = 4_999_900, desc = 'RAZ*ZZQ ELECTRONICS', account = CARD) => understood(id, desc, 'debit', amount, date, account);

  it('flags several ₹40,000+ gateway payments ending in 99/98/97/95 within a week', () => {
    const rows = [gw('a', '2025-02-01'), gw('b', '2025-02-03', 4_999_800), gw('c', '2025-02-05', 5_499_700), gw('d', '2025-02-06', 4_499_500)];
    const updates = linkTransactions(rows, ACCOUNTS);
    expect(updates.map((u) => u.txnId).sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const u of updates) {
      expect(u.patch.needsReview).toBe(true);
      expect(u.patch.reviewReasons).toContain(GATEWAY_BURST_REASON);
      expect(u.patch.kind).toBeUndefined(); // a flag only, no judgement
    }
  });

  it('keeps existing review reasons and is idempotent', () => {
    const rows = [gw('a', '2025-02-01'), gw('b', '2025-02-02'), gw('c', '2025-02-03')];
    const after = applyUpdates(rows, linkTransactions(rows, ACCOUNTS));
    expect(byId(after, 'a').reviewReasons).toEqual(expect.arrayContaining([...rows[0].reviewReasons, GATEWAY_BURST_REASON]));
    expect(linkTransactions(after, ACCOUNTS)).toEqual([]);
  });

  it.each([
    ['only two rows', [gw('a', '2025-02-01'), gw('b', '2025-02-02')]],
    ['rows far apart', [gw('a', '2025-01-01'), gw('b', '2025-02-01'), gw('c', '2025-03-01')]],
    ['amounts below ₹40,000', [gw('a', '2025-02-01', 3_999_900), gw('b', '2025-02-02', 3_999_900), gw('c', '2025-02-03', 3_999_900)]],
    ['amounts not near a round figure', [gw('a', '2025-02-01', 4_500_000), gw('b', '2025-02-02', 4_500_000), gw('c', '2025-02-03', 4_500_000)]],
    ['not through a gateway', [gw('a', '2025-02-01', 4_999_900, 'CROMA ELECTRONICS'), gw('b', '2025-02-02', 4_999_900, 'CROMA ELECTRONICS'), gw('c', '2025-02-03', 4_999_900, 'CROMA ELECTRONICS')]],
    ['not on a card', [gw('a', '2025-02-01', 4_999_900, 'RAZ*ZZQ', SAVINGS), gw('b', '2025-02-02', 4_999_900, 'RAZ*ZZQ', SAVINGS), gw('c', '2025-02-03', 4_999_900, 'RAZ*ZZQ', SAVINGS)]],
  ])('does not flag %s', (_label, rows) => {
    expect(linkTransactions(rows, ACCOUNTS)).toEqual([]);
  });

  it('never touches user-decided rows', () => {
    const rows = [gw('a', '2025-02-01'), gw('b', '2025-02-02'), gw('c', '2025-02-03')].map((t, i) => (i === 0 ? { ...t, kindSource: 'user' as const } : t));
    expect(linkTransactions(rows, ACCOUNTS).map((u) => u.txnId).sort()).toEqual(['b', 'c']);
  });
});
