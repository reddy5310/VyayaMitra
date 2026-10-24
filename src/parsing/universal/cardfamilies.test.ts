/**
 * Card-statement layout families seen across issuers, re-created with invented data:
 * category column + "Ref No" (YES-like), header-less table with year-less "30AUG" dates, unlabelled
 * summary and foreign amounts (HSBC-like), unsigned amounts with wording as the only direction hint plus
 * sample tables elsewhere (RBL-like), and a lone amount column with Dr suffix (Axis-like).
 */
import { describe, expect, it } from 'vitest';
import { L, R, layoutDoc, type LineSpec } from '../../../tests/fixtures/parsing/builders';
import { readMoney } from '../core/text';
import { UnsupportedStatementError } from '../errors';
import { parseUniversal } from './engine';

const parse = (doc: ReturnType<typeof layoutDoc>, extra: { forceHeaderless?: boolean } = {}) =>
  parseUniversal(doc, { fileName: 'c.pdf', fileKind: 'pdf', ...extra });

describe('amounts with international digit grouping', () => {
  it('reads 3-digit grouping as well as lakh grouping', () => {
    expect(readMoney('456,789.12')?.paise).toBe(45_678_912);
    expect(readMoney('1,234,567.89')?.paise).toBe(123_456_789);
    expect(readMoney('4,56,789.12')?.paise).toBe(45_678_912);
    expect(readMoney('50,6515.57')).toBeNull();
  });
});

// ── YES-like ────────────────────────────────────────────────────────────────

function yesLike(row: Pick<LineSpec, 'cells'>, header = true) {
  return layoutDoc([
    [
      { y: 44, cells: [L(228, 'Credit Card Statement')] },
      { y: 59, cells: [L(240, 'EXAMPLE BANK Card')] },
      { y: 240, cells: [L(73, 'Statement for EXAMPLE BANK Card Number 5100XXXXXXXX1111')] },
      { y: 246, cells: [L(400, 'Previous Balance :')] },
      { y: 255, cells: [L(400, 'Rs. 12.50 Cr')] },
      { y: 262, cells: [L(128, 'Statement Period:'), L(325, 'Credit Limit:')] },
      { y: 272, cells: [L(102, '16/09/2026 To 15/10/2026'), L(316, 'Rs. 3,00,000.00')] },
      { y: 292, cells: [L(91, 'Statement Date : 15/10/2026'), L(316, 'Rs. 2,97,512.50')] },
      { y: 311, cells: [L(125, 'Total Amount Due:'), L(329, 'Cash Limit:')] },
      { y: 321, cells: [L(140, 'Rs. 2,487.50'), L(316, 'Rs. 90,000.00')] },
      { y: 337, cells: [L(109, 'Minimum Amount Due:'), L(291, 'Available Cash Limit:'), L(400, 'Rs. 0.00')] },
      { y: 346, cells: [L(151, 'Rs. 125.00'), L(316, 'Rs. 90,000.00')] },
      { y: 367, cells: [L(81, 'Payment Due Date: 04/11/2026')] },
      ...(header ? [{ y: 654, cells: [L(48, 'Date'), L(93, 'Transaction Details'), L(377, 'Merchant Category'), R(547, 'Amount (Rs.)')] }] : []),
      { y: 675, cells: row.cells },
      { y: 702, cells: [L(202, '------------------End of the Statement------------------')] },
    ],
  ]);
}

describe('YES-like card statement', () => {
  const row = { cells: [L(48, '30/09/2026'), L(93, 'ShopEase 101 - Ref No: RT000000000000000001'), L(377, 'Transportation Services'), R(547, '2,500.00 Dr')] };

  it('moves the category column to bankCategory and "Ref No" to reference', () => {
    const st = parse(yesLike(row));
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({
      date: '2026-09-30',
      direction: 'debit',
      amount: 250_000,
      description: 'ShopEase 101',
      reference: 'RT000000000000000001',
      bankCategory: 'Transportation Services',
    });
    expect(st.periodStart).toBe('2026-09-16');
    expect(st.periodEnd).toBe('2026-10-15');
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reads the summary: label above value, stacked figures, and a minimum due not stolen from a neighbour', () => {
    const st = parse(yesLike(row));
    expect(st.cardSummary).toMatchObject({
      statementDate: '2026-10-15',
      dueDate: '2026-11-04',
      previousBalance: -1_250,
      totalDue: 248_750,
      minimumDue: 12_500,
      creditLimit: 30_000_000,
    });
  });

  it('takes an inline "[Category]" bracket out of the description too', () => {
    const st = parse(
      yesLike({ cells: [L(48, '30/09/2026'), L(93, 'ShopEase 101 - Ref No: RT000000000000000001 [Fuel Stations]'), R(547, '2,500.00 Dr')] }, true),
    );
    expect(st.rows[0].description).toBe('ShopEase 101');
    expect(st.rows[0].bankCategory).toBe('Fuel Stations');
  });
});

// ── HSBC-like: no header, year-less dates, unlabelled summary ───────────────

function hsbcLike() {
  const lines: LineSpec[] = [
    { y: 52, cells: [L(370, '03 OCT 2026'), R(530, '2,660.47')] },
    { y: 73, cells: [L(58, 'ASHA VERMA')] },
    { y: 83, cells: [L(339, '16 AUG 2026 To 15 SEP 2026'), R(534, '53,209.33')] },
    { y: 104, cells: [L(379, 'EXAMPLE PLATINUM Credit Card')] },
    { y: 176, cells: [L(364, '48xx xxxx xxxx 7777')] },
    { y: 197, cells: [R(119, '300,000.00'), R(246, '90,000.00')] },
    { y: 250, cells: [L(78, 'Reward Points earned this month')] },
    { y: 278, cells: [L(78, 'Available Credit Limit'), R(409, '88,000.00')] },
    { y: 290, cells: [L(77, 'OPENING BALANCE'), R(408, '123,456.78')] },
    { y: 299, cells: [L(31, '30AUG'), L(77, 'PAYU PYM FROM OTH BANK-20260830000000001'), R(424, '123,457.00 CR')] },
    { y: 310, cells: [L(77, 'PURCHASES & INSTALLMENTS')] },
    { y: 321, cells: [L(77, 'Interest Rate applicable : 3.75% p.m. (45.00% p.a.)')] },
    { y: 333, cells: [L(77, '48xx xxxx xxxx 7777 ASHA VERMA')] },
    { y: 343, cells: [L(31, '27AUG'), L(77, 'IAP CAS*SHOPX'), L(155, 'Springfield'), R(408, '49,999.00')] },
    { y: 364, cells: [L(31, '01SEP'), L(77, 'SOFTHOST* PAYMENT'), L(164, 'BERLIN'), L(213, 'DE'), L(270, 'USD'), R(316, '38.50'), R(408, '3,210.55')] },
    { y: 517, cells: [L(79, 'TOTAL PURCHASE OUTSTANDING'), R(407, '53,209.55')] },
    { y: 559, cells: [L(31, '15SEP'), L(79, 'NET OUTSTANDING BALANCE'), R(407, '53,209.33')] },
    { y: 670, cells: [R(105, '123,456.78'), R(243, '53,209.55'), R(382, '123,457.00'), R(520, '53,209.33')] },
  ];
  return layoutDoc([lines]);
}

describe('HSBC-like card statement (no header, year-less dates, unlabelled summary)', () => {
  it('reads descriptions, year-less dates and CR credits', () => {
    const st = parse(hsbcLike());
    expect(st.rows.map((r) => [r.date, r.direction, r.amount, r.description])).toEqual([
      ['2026-08-30', 'credit', 12_345_700, 'PAYU PYM FROM OTH BANK-20260830000000001'],
      ['2026-08-27', 'debit', 4_999_900, 'IAP CAS*SHOPX Springfield'],
      ['2026-09-01', 'debit', 321_055, 'SOFTHOST* PAYMENT BERLIN DE'],
    ]);
    expect(st.periodStart).toBe('2026-08-16');
    expect(st.periodEnd).toBe('2026-09-15');
    expect(st.cardMasks).toEqual(['7777']);
    expect(st.warnings.join(' ')).toMatch(/no year/);
  });

  it('keeps the foreign amount apart from the INR amount', () => {
    const st = parse(hsbcLike());
    expect(st.rows[2].foreign).toEqual({ amount: 3_850, currency: 'USD' });
    expect(st.rows[2].amount).toBe(321_055);
    expect(st.rows[1].foreign).toBeUndefined();
  });

  it('finds the summary from the figures that add up and from a date + amount box', () => {
    const st = parse(hsbcLike());
    expect(st.cardSummary).toMatchObject({
      previousBalance: 12_345_678,
      totalDue: 5_320_933,
      dueDate: '2026-10-03',
      minimumDue: 266_047,
      creditLimit: 30_000_000,
      availableCredit: 8_800_000,
      statementDate: '2026-09-15',
    });
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.reconciliation.checks.map((c) => c.label)).toContain('Previous balance + charges - payments = total due');
  });

  it('does not turn the due-date box, the period line or the "net outstanding" row into transactions', () => {
    const st = parse(hsbcLike());
    expect(st.rows).toHaveLength(3);
    expect(st.skipped).toEqual([]);
  });
});

// ── RBL-like: unsigned amounts, summary with +/- labels, sample tables ──────

function rblLike() {
  const left: LineSpec[] = [
    { y: 195, cells: [L(21, 'Card Number'), L(113, 'XXXXXXXXXXXXXX51')] },
    { y: 216, cells: [L(21, 'Total Amount Due PAY NOW 862.00')] },
    { y: 241, cells: [L(21, 'Min. Amt. Due'), L(113, '43.00')] },
    { y: 265, cells: [L(21, 'Payment Due Date'), L(113, '04 Nov 2026')] },
    { y: 286, cells: [L(21, 'Last Bill Amount'), L(113, '1,000.00')] },
    { y: 305, cells: [L(21, '- Payments & Credits'), L(113, '600.00')] },
    { y: 324, cells: [L(21, '+ New Debits'), L(113, '450.00')] },
    { y: 343, cells: [L(21, '- Transferred to EMI'), L(113, '0.00')] },
    { y: 362, cells: [L(21, '+ Monthly EMI Debits'), L(113, '0.00')] },
    { y: 381, cells: [L(21, '+ Fees & Charges'), L(113, '10.00')] },
    { y: 400, cells: [L(21, '+ Goods & Services Tax'), L(113, '1.80')] },
    { y: 419, cells: [L(21, 'Statement Period'), L(113, '16-09-2026 to 15-10-2026')] },
    { y: 438, cells: [L(21, 'Statement Date'), L(113, '15-10-2026')] },
    { y: 461, cells: [L(21, 'Total Credit Limit'), L(113, '5,00,000.00')] },
    { y: 486, cells: [L(21, 'Available Credit Limit'), L(113, '19,202.22')] },
    { y: 509, cells: [L(21, 'Available Cash Limit'), L(113, '19,202.22')] },
  ];
  const table: LineSpec[] = [
    { y: 176, cells: [L(224, 'Date'), L(296, 'Description'), R(573, 'Amount')] },
    { y: 195, cells: [L(224, '30 Sep 2026'), L(296, 'CAS*SHOP A'), L(363, 'Pune IND'), R(570, '300.00')] },
    { y: 276, cells: [L(224, '1 Oct 2026'), L(296, 'PAYMENT RECEIVED - RAZORPAY'), R(570, '600.00')] },
    { y: 296, cells: [L(224, '2 Oct 2026'), L(296, 'RAZ*SHOP B'), L(362, 'Springfield IND'), R(570, '150.00')] },
    { y: 316, cells: [L(224, '3 Oct 2026'), L(296, 'FASTag loading fee and Toll Payment'), R(570, '10.00')] },
    { y: 336, cells: [L(224, '15 Oct 2026'), L(296, 'Goods & Service Tax'), R(570, '1.80')] },
    { y: 411, cells: [L(415, 'Eligible for EMI'), L(480, 'Eligible for Bonus Reward Points')] },
  ];
  const sample: LineSpec[] = [
    { y: 248, cells: [L(257, 'Date'), L(316, 'Transaction'), R(430, 'Amount')] },
    { y: 263, cells: [L(257, '12-Dec-18'), L(315, 'Purchase of Groceries'), R(425, '6,000.00')] },
    { y: 288, cells: [L(257, '02-Jan-19'), L(315, 'Membership Fee + GST'), R(425, '588.82')] },
    { y: 333, cells: [L(257, '22-Jan-19'), L(315, 'Payment Credit'), R(425, '1,088.82')] },
  ];
  return layoutDoc([[{ y: 30, cells: [L(225, 'Elevate your experience with your EXAMPLE Credit Card')] }, ...left, ...table], sample]);
}

describe('RBL-like card statement (unsigned amounts, sample tables elsewhere)', () => {
  it('uses the wording for direction when the statement marks nothing, and the summary agrees', () => {
    const st = parse(rblLike());
    expect(st.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2026-09-30', 'debit', 30_000],
      ['2026-10-01', 'credit', 60_000],
      ['2026-10-02', 'debit', 15_000],
      ['2026-10-03', 'debit', 1_000],
      ['2026-10-15', 'debit', 180],
    ]);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('accepts the rounded total due and checks debits and credits against the summary', () => {
    const st = parse(rblLike());
    const labels = Object.fromEntries(st.reconciliation.checks.map((c) => [c.label, c]));
    expect(labels['Previous balance + charges - payments = total due'].detail).toMatch(/rounded to the rupee/);
    expect(labels['Debits match the printed total'].ok).toBe(true);
    expect(labels['Credits match the printed total'].ok).toBe(true);
    expect(st.cardSummary).toMatchObject({
      previousBalance: 100_000,
      totalDue: 86_200,
      minimumDue: 4_300,
      dueDate: '2026-11-04',
      statementDate: '2026-10-15',
      creditLimit: 50_000_000,
      availableCredit: 1_920_222,
    });
  });

  it('leaves out the sample table (dates years away) and the promo text under the last row', () => {
    const st = parse(rblLike());
    expect(st.rows.every((r) => r.date.startsWith('2026'))).toBe(true);
    expect(st.rows.some((r) => /Eligible/.test(r.description))).toBe(false);
    for (const s of st.skipped) expect(s.reason).toMatch(/far outside the statement period/);
  });

  it('falls back to the printed payments total to find which unsigned rows are credits', () => {
    // payment wording that no keyword recognises: only the printed "Payments & Credits" figure can tell
    const doc = rblLike();
    for (const l of doc.pages[0].lines) for (const i of l.items) if (i.text === 'PAYMENT RECEIVED - RAZORPAY') i.text = 'XYZ SETTLEMENT 7781';
    const st = parse(doc);
    expect(st.rows.map((r) => r.direction)).toEqual(['debit', 'credit', 'debit', 'debit', 'debit']);
    expect(st.reconciliation.status).toBe('balanced');
  });
});

// ── Axis-like: lone amount column with a Dr suffix; false-positive guard ───

function axisLike(withRows = true) {
  const page1: LineSpec[] = [
    { y: 60, cells: [L(281, 'Example Axis Premium Credit Card')] },
    { y: 210, cells: [L(252, 'PAYMENT SUMMARY')] },
    { y: 224, cells: [L(52, 'Total Payment Due'), L(152, 'Minimum Payment Due'), L(272, 'Statement Period'), L(381, 'Payment Due Date'), L(472, 'Statement Generation Date')] },
    { y: 237, cells: [L(62, '1,416.00 Dr'), L(170, '1,416.00 Dr'), L(260, '19/07/2026 - 17/10/2026'), L(393, '06/11/2026'), L(510, '17/10/2026')] },
    { y: 253, cells: [L(51, 'Credit Card Number'), L(172, 'Credit Limit'), L(265, 'Available Credit Limit'), L(379, 'Available Cash Limit')] },
    { y: 266, cells: [L(51, '123456******9999'), L(175, '60,000.00'), L(285, '58,584.00'), L(396, '18,000.00')] },
    { y: 281, cells: [L(69, 'Previous Balance - Payments - Credits + Purchase + Cash Advance + Other Debit&Charges =Total Payment Due')] },
    { y: 295, cells: [L(58, '0.00'), L(123, '0.00'), L(172, '0.00'), L(218, '0.00'), L(273, '0.00'), L(336, '1,416.00'), L(406, '1,416.00 Dr')] },
    { y: 307, cells: [L(272, 'Account Summary')] },
    { y: 319, cells: [L(50, 'DATE'), L(184, 'TRANSACTION DETAILS'), L(387, 'MERCHANT CATEGORY'), L(514, 'AMOUNT (Rs.)')] },
    { y: 329, cells: [L(83, 'Card No:'), L(122, '123456******9999'), L(260, 'Name'), L(287, 'ASHA VERMA')] },
    ...(withRows
      ? [
          { y: 339, cells: [L(35, '07/10/2026'), L(90, 'GST'), R(582, '216.00 Dr')] },
          { y: 349, cells: [L(35, '07/10/2026'), L(90, 'ANNUAL FEE'), R(582, '1,200.00 Dr')] },
        ]
      : []),
    { y: 363, cells: [L(254, '**** End of Statement ****')] },
  ];
  const page2: LineSpec[] = [
    { y: 87, cells: [L(43, 'Finance Charge calculation')] },
    { y: 485, cells: [L(36, 'Txn Date'), L(73, 'Type'), L(181, 'Cr/Db MAD Contribution'), L(288, 'Amount')] },
    { y: 495, cells: [L(36, '25th Sep'), L(73, 'Purchase'), L(181, 'Db'), L(267, '2%'), R(316, '5000.00')] },
    { y: 505, cells: [L(36, '1st Oct'), L(73, 'Joining Fees'), L(181, 'Db'), L(259, '100%'), R(316, '1000.00')] },
  ];
  return layoutDoc([page1, page2]);
}

describe('Axis-like card statement and the false-balanced guard', () => {
  it('reads the lone Dr-suffixed amount column as transaction amounts, not balances', () => {
    const st = parse(axisLike());
    expect(st.rows.map((r) => [r.direction, r.amount, r.description])).toEqual([
      ['debit', 21_600, 'GST'],
      ['debit', 120_000, 'ANNUAL FEE'],
    ]);
    expect(st.cardSummary).toMatchObject({ previousBalance: 0, totalDue: 141_600, minimumDue: 141_600, dueDate: '2026-11-06' });
    expect(st.periodStart).toBe('2026-07-19');
    expect(st.periodEnd).toBe('2026-10-17');
    expect(st.accountMask).toBe('9999');
    expect(st.cardMasks).toEqual(['9999']);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reads the same rows when the header is ignored (numbers-only inference)', () => {
    const st = parse(axisLike(), { forceHeaderless: true });
    expect(st.rows.map((r) => [r.amount, r.description])).toEqual([[21_600, 'GST'], [120_000, 'ANNUAL FEE']]);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('ignores the sample table on the page after "End of Statement"', () => {
    const st = parse(axisLike());
    expect(st.rows).toHaveLength(2);
    expect(st.rows.every((r) => r.date === '2026-10-07')).toBe(true);
  });

  it('never emits a row with an empty description, and never calls summary lines transactions', () => {
    for (const forceHeaderless of [false, true]) {
      // the transaction rows are gone: only summary figures with dates remain
      expect(() => parse(axisLike(false), { forceHeaderless })).toThrow(UnsupportedStatementError);
    }
    for (const forceHeaderless of [false, true]) {
      const st = parse(axisLike(), { forceHeaderless });
      for (const r of st.rows) expect(r.description.trim()).not.toBe('');
    }
  });

  it('does not report balanced for a row with no description even if it equals the total due', () => {
    const doc = axisLike();
    // blank the description of the annual-fee row and make it equal the total due
    for (const l of doc.pages[0].lines) {
      for (const i of l.items) {
        if (i.text === 'ANNUAL FEE') i.text = ' ';
      }
    }
    const st = parse(doc);
    for (const r of st.rows) expect(r.description.trim()).not.toBe('');
    expect(st.skipped.some((s) => /No description/.test(s.reason))).toBe(true);
    expect(st.reconciliation.status).toBe('mismatch');
  });
});
