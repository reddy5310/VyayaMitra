import { beforeAll, describe, expect, it } from 'vitest';
import { L, R, buildPdf, layoutDoc, type LineSpec } from '../../../tests/fixtures/parsing/builders';
import { CC_SECTIONS, iciciCreditCardPages, type CcSection } from '../../../tests/fixtures/parsing/statements';
import { extractLayout } from '../pdf/extract';
import { useLegacyPdfjsForNode } from '../pdf/node';
import { parseLayout } from '../registry';
import { iciciCreditCardParser } from '../parsers/iciciCreditCard';
import { parseUniversal } from './engine';

beforeAll(() => useLegacyPdfjsForNode());

const ctx = { fileName: 'card.pdf' };

/** An SBI Card style statement: last two card digits, period banner above the first row, D / C column. */
function sbiCardStatement(printedDue: string, opts: { mergedHolder?: boolean } = {}) {
  const lines: LineSpec[] = [
    { y: 30, cells: [L(40, 'SBI Card')] },
    {
      y: 54,
      cells: opts.mergedHolder ? [L(40, 'ASHA VERMA Credit Card Number')] : [L(40, 'ASHA VERMA'), L(300, 'Credit Card Number')],
    },
    { y: 66, cells: [L(opts.mergedHolder ? 40 : 300, 'XXXX XXXX XXXX XX12')] },
    { y: 90, cells: [L(40, 'Statement Date'), L(220, '19 Oct 26')] },
    { y: 104, cells: [L(40, 'Payment Due Date'), L(220, '08 Nov 26')] },
    { y: 118, cells: [L(40, 'Previous Balance'), L(220, 'Rs. 40,000.00')] },
    { y: 132, cells: [L(40, 'Total Amount Due'), L(220, printedDue)] },
    { y: 146, cells: [L(40, 'Minimum Amount Due'), L(220, 'Rs. 2,260.00')] },
    { y: 160, cells: [L(40, 'Credit Limit'), L(220, 'Rs. 1,50,000.00')] },
    { y: 174, cells: [L(40, 'Available Credit Limit'), L(220, 'Rs. 1,04,798.00')] },
    { y: 200, cells: [L(40, 'Date'), L(110, 'Transaction Details'), R(520, 'Amount (Rs.)')] },
    { y: 213, cells: [L(110, 'for Statement Period: 20 Sep 26 to 19 Oct 26')] },
    { y: 226, cells: [L(40, '22 Sep 26'), L(110, 'PAYMENT RECEIVED 000123456'), R(520, '8,560.00'), L(530, 'C')] },
    { y: 239, cells: [L(40, '25 Sep 26'), L(110, 'EXAMPLE STORE (Pay in EMIs)'), R(520, '4,761.00'), L(530, 'D')] },
    { y: 252, cells: [L(40, '03 Oct 26'), L(110, 'EXAMPLE MART'), R(520, '9,000.68'), L(530, 'D')] },
  ];
  return layoutDoc([lines]);
}

describe('SBI Card style statement', () => {
  it('keeps the statement-period banner out of descriptions and reads the D / C column', () => {
    const st = parseUniversal(sbiCardStatement('Rs. 45,202.00'), { fileName: 's', fileKind: 'pdf' });
    expect(st.rows.map((r) => [r.date, r.direction, r.amount, r.description])).toEqual([
      ['2026-09-22', 'credit', 856_000, 'PAYMENT RECEIVED 000123456'],
      ['2026-09-25', 'debit', 476_100, 'EXAMPLE STORE (Pay in EMIs)'],
      ['2026-10-03', 'debit', 900_068, 'EXAMPLE MART'],
    ]);
    expect(st.periodStart).toBe('2026-09-20');
    expect(st.periodEnd).toBe('2026-10-19');
    expect(st.rows.some((r) => /Statement Period/i.test(r.description))).toBe(false);
  });

  it('accepts a total due rounded to the rupee, and says so', () => {
    const st = parseUniversal(sbiCardStatement('Rs. 45,202.00'), { fileName: 's', fileKind: 'pdf' });
    expect(st.reconciliation.status).toBe('balanced');
    const check = st.reconciliation.checks.find((c) => c.label.startsWith('Previous balance'));
    expect(check?.ok).toBe(true);
    expect(check?.detail).toBe('Total due is rounded to the rupee (₹0.32)');
    expect(st.cardSummary).toMatchObject({
      statementDate: '2026-10-19',
      dueDate: '2026-11-08',
      previousBalance: 4_000_000,
      totalDue: 4_520_200,
      minimumDue: 226_000,
      creditLimit: 15_000_000,
      availableCredit: 10_479_800,
    });
  });

  it('stays strict when the printed total is not a whole-rupee amount, or is a rupee or more away', () => {
    expect(parseUniversal(sbiCardStatement('Rs. 45,202.50'), { fileName: 's', fileKind: 'pdf' }).reconciliation.status).toBe('mismatch');
    expect(parseUniversal(sbiCardStatement('Rs. 45,203.00'), { fileName: 's', fileKind: 'pdf' }).reconciliation.status).toBe('mismatch');
    expect(parseUniversal(sbiCardStatement('Rs. 45,201.68'), { fileName: 's', fileKind: 'pdf' }).reconciliation.status).toBe('balanced');
  });

  it('captures a mask with only the last two digits and the holder printed before the label', () => {
    for (const mergedHolder of [false, true]) {
      const st = parseUniversal(sbiCardStatement('Rs. 45,202.00', { mergedHolder }), { fileName: 's', fileKind: 'pdf' });
      expect(st.accountMask).toBe('12');
      expect(st.cardMasks).toEqual(['12']);
      expect(st.holderName).toBe('ASHA VERMA');
      expect(st.rows.every((r) => r.cardMask === '12')).toBe(true);
      // the holder is never stored in a learned template
      expect(JSON.stringify(st.learnedTemplate)).not.toMatch(/ASHA|VERMA/i);
    }
  });
});

describe('statement-period banners in bank layouts', () => {
  it('is metadata in a bank statement too, whichever way descriptions wrap', () => {
    const doc = layoutDoc([
      [
        { y: 40, cells: [L(40, 'Example Bank')] },
        { y: 100, cells: [L(30, 'Date'), L(100, 'Narration'), R(400, 'Debit'), R(460, 'Credit'), R(540, 'Balance')] },
        { y: 112, cells: [L(100, 'Statement Period: 01 Apr 2024 to 30 Apr 2024')] },
        { y: 124, cells: [L(30, '01/04/2024'), L(100, 'FIRST'), R(398, '100.00'), R(538, '900.00')] },
        { y: 136, cells: [L(30, '02/04/2024'), L(100, 'SECOND'), R(458, '50.00'), R(538, '950.00')] },
      ],
    ]);
    const st = parseUniversal(doc, { fileName: 'b', fileKind: 'pdf' });
    expect(st.rows.map((r) => r.description)).toEqual(['FIRST', 'SECOND']);
  });
});

describe('ICICI card statement with a credit previous balance and a foreign-currency row', () => {
  const sections: CcSection[] = [
    {
      card: '5100XXXXXXXX1111',
      txns: [
        // posted after it happened: three days before the period starts (21/06)
        { date: '18/06/2024', ser: '9000000011', text: 'SOME SAAS INC', amount: 250_754, reward: '48', foreign: '25 USD' },
        { date: '24/06/2024', ser: '9000000012', text: 'EXAMPLE MART', amount: 345_000 },
        { date: '28/06/2024', ser: '9000000013', text: 'PAYMENT RECEIVED THANK YOU', amount: 100_000, credit: true },
      ],
    },
  ];
  const PREVIOUS_CREDIT = -207_676; // printed as "`2,076.76 CR"

  it('dedicated parser: a CR previous balance is negative, so the card reconciles exactly', async () => {
    const built = await iciciCreditCardPages(sections, PREVIOUS_CREDIT);
    const doc = await extractLayout(await buildPdf(built.pages));
    const st = iciciCreditCardParser.parse(doc, ctx);
    expect(st.printedTotals?.previousBalance).toBe(PREVIOUS_CREDIT);
    expect(st.reconciliation.status).toBe('balanced');
    const check = st.reconciliation.checks.find((c) => c.label.startsWith('Previous balance'));
    expect(check?.detail).toContain('=');
    expect(st.cardSummary).toMatchObject({
      statementDate: '2024-07-20',
      dueDate: '2024-08-07',
      totalDue: built.due,
      minimumDue: 117_000,
      previousBalance: PREVIOUS_CREDIT,
      creditLimit: 47_000_000,
      availableCredit: 37_672_644,
    });
    expect(built.due).toBe(PREVIOUS_CREDIT + 250_754 + 345_000 - 100_000);
  });

  it('dedicated parser: foreign amount and reward points stay out of the description and the amount', async () => {
    const doc = await extractLayout(await buildPdf((await iciciCreditCardPages(sections, PREVIOUS_CREDIT)).pages));
    const st = iciciCreditCardParser.parse(doc, ctx);
    expect(st.rows[0]).toMatchObject({ amount: 250_754, direction: 'debit', description: 'SOME SAAS INC', reference: '9000000011' });
  });

  it('a card row up to 10 days before the period is not out of period; a bank row still is', async () => {
    const doc = await extractLayout(await buildPdf((await iciciCreditCardPages(sections, PREVIOUS_CREDIT)).pages));
    const st = iciciCreditCardParser.parse(doc, ctx);
    expect(st.periodStart).toBe('2024-06-21');
    expect(st.rows[0].date).toBe('2024-06-18');
    expect(st.rows[0].warnings).not.toContain('date_out_of_period');
    expect(st.warnings.join(' ')).not.toMatch(/outside the statement period/);

    const early: CcSection[] = [{ card: sections[0].card, txns: [{ date: '05/06/2024', ser: '9000000014', text: 'TOO EARLY', amount: 1_000 }] }];
    const stEarly = iciciCreditCardParser.parse(await extractLayout(await buildPdf((await iciciCreditCardPages(early, 0)).pages)), ctx);
    expect(stEarly.rows[0].warnings).toContain('date_out_of_period');
  });

  it('universal engine reads the same card the same way', async () => {
    const doc = await extractLayout(await buildPdf((await iciciCreditCardPages(sections, PREVIOUS_CREDIT)).pages));
    const st = parseUniversal(doc, { fileName: 'c', fileKind: 'pdf' });
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.cardSummary?.previousBalance).toBe(PREVIOUS_CREDIT);
    expect(st.rows[0]).toMatchObject({ amount: 250_754, direction: 'debit' });
    expect(st.rows[0].description).toBe('SOME SAAS INC');
    expect(st.rows[0].warnings).not.toContain('date_out_of_period');
  });

  it('through parseLayout: the card summary is available for card dues', async () => {
    const doc = await extractLayout(await buildPdf((await iciciCreditCardPages(CC_SECTIONS)).pages));
    const st = parseLayout(doc, ctx);
    expect(st.parserId).toBe('icici-credit-card');
    expect(st.cardSummary?.totalDue).toBeGreaterThan(0);
    expect(st.cardSummary?.dueDate).toBe('2024-08-07');
  });
});
