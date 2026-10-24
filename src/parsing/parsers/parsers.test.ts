import { beforeAll, describe, expect, it } from 'vitest';
import { L, R, buildPdf, layoutDoc, type Cell, type LineSpec } from '../../../tests/fixtures/parsing/builders';
import {
  CC_PREVIOUS,
  CC_SECTIONS,
  DBS_OPENING,
  DBS_TXNS,
  HDFC_TXNS,
  ICICI_OPENING,
  ICICI_TXNS,
  dbsPages,
  hdfcPages,
  iciciCreditCardPages,
  iciciSavingsPages,
} from '../../../tests/fixtures/parsing/statements';
import { UnsupportedStatementError } from '../errors';
import { extractLayout } from '../pdf/extract';
import { useLegacyPdfjsForNode } from '../pdf/node';
import type { LayoutDoc } from '../pdf/types';
import { parseLayout } from '../registry';
import { dbsSavingsParser } from './dbsSavings';
import { universalParser as genericColumnarParser } from './universal';
import { iciciCreditCardParser } from './iciciCreditCard';
import { iciciSavingsParser } from './iciciSavings';

beforeAll(() => useLegacyPdfjsForNode());

const ctx = { fileName: 'test.pdf' };
const read = async (pages: Parameters<typeof buildPdf>[0]): Promise<LayoutDoc> => extractLayout(await buildPdf(pages));
const squash = (s: string) => s.replace(/\s+/g, '');

// ─── ICICI savings ──────────────────────────────────────────────────────────

describe('ICICI savings parser', () => {
  it('reads a multi-page statement through the real PDF path and reconciles it exactly', async () => {
    const built = await iciciSavingsPages({ limitY: 560 }); // forces a page break and a repeated header
    expect(built.pages.length).toBeGreaterThan(1);
    const doc = await read(built.pages);
    const st = parseLayout(doc, ctx);

    expect(st.parserId).toBe('icici-savings');
    expect(st.institution).toBe('ICICI');
    expect(st.accountType).toBe('savings');
    expect(st.accountMask).toBe('0001');
    expect(st.holderName).toBe('ASHA VERMA');
    expect(st.periodStart).toBe('2024-06-03');
    expect(st.periodEnd).toBe('2024-12-03');
    expect(st.openingBalance).toBe(ICICI_OPENING);
    expect(st.closingBalance).toBe(built.closing);
    expect(st.printedTotals).toEqual({ debits: built.totalDebits, credits: built.totalCredits });
    expect(st.rows).toHaveLength(ICICI_TXNS.length);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.reconciliation.rowBalanceBreaks).toBe(0);
    expect(st.skipped).toEqual([]);

    st.rows.forEach((r, i) => {
      const t = ICICI_TXNS[i];
      expect(r.amount, `row ${i} amount`).toBe(t.debit ?? t.credit);
      expect(r.direction, `row ${i} direction`).toBe(t.debit !== undefined ? 'debit' : 'credit');
      expect(r.balanceAfter, `row ${i} balance`).toBe(built.balances[i]);
      expect(r.date).toBe(`${t.date.slice(6)}-${t.date.slice(3, 5)}-${t.date.slice(0, 2)}`);
      expect(r.warnings, `row ${i} warnings`).toEqual([]);
      expect(r.source.page).toBeGreaterThanOrEqual(1);
      expect(r.source.rawLines.length).toBeGreaterThan(0);
    });
  });

  it('attributes wrapped lines above and below the date line, whatever the line count', async () => {
    const built = await iciciSavingsPages();
    // the fixture really exercises 1, 2, 3, 4 and 5 line descriptions
    expect(new Set(built.lineCounts)).toEqual(new Set([1, 2, 3, 4, 5]));
    const st = parseLayout(await read(built.pages), ctx);
    st.rows.forEach((r, i) => {
      const t = ICICI_TXNS[i];
      const expected = t.mode ? `${t.text} [${t.mode}]` : t.text;
      expect(r.description, `row ${i}`).toBe(expected);
      expect(r.source.rawLines.length).toBeGreaterThanOrEqual(built.lineCounts[i]);
    });
    // extra spot checks on what a person would look for
    expect(st.rows[0].reference).toBe('100000000001');
    expect(st.rows[4].description).toBe(
      'UPI/100000000003/UPIIntent/shop.example@hdfcbank/HDFC BANK LTD/PPPL20100000000000000000001/',
    );
    expect(st.rows[5].description).toContain('/HDFC BANKLTD/HDF0A1B2C3D4E5F60718293A4B5C6D7E8F9');
  });

  it('excludes the MODE column from amounts and the B/F row from transactions', async () => {
    const st = parseLayout(await read((await iciciSavingsPages()).pages), ctx);
    expect(st.rows).toHaveLength(ICICI_TXNS.length); // B/F is not a row
    expect(st.rows[1].amount).toBe(1_200_000);
    expect(st.rows[3].amount).toBe(200_000);
    expect(st.rows[3].description).toContain('[CMS TRANSACTION]');
  });

  it('trusts the balance when the amount sits under the wrong column', async () => {
    const built = await iciciSavingsPages({ swapColumns: [3] });
    const st = parseLayout(await read(built.pages), ctx);
    expect(st.rows[3].direction).toBe('credit'); // the balance went up
    expect(st.rows[3].warnings).toContain('direction_from_balance');
    expect(st.reconciliation.rowBalanceBreaks).toBe(0);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reports a balance break and a mismatch when a printed balance is wrong', async () => {
    const built = await iciciSavingsPages({ balanceOverride: { 4: built0(4) } });
    const st = parseLayout(await read(built.pages), ctx);
    expect(st.reconciliation.status).toBe('mismatch');
    expect(st.reconciliation.rowBalanceBreaks).toBe(1);
    expect(st.rows[4].warnings).toContain('balance_break');
    expect(st.rows[5].warnings).not.toContain('balance_break');
  });

  it('flags description_merged when a wrapped line could belong to either neighbour', () => {
    const doc = layoutDoc([
      [
        { y: 40, cells: [L(27, 'Visit www.icicibank.com')] },
        { y: 60, cells: [L(27, 'Statement of Transactions in Savings Account Number: 123456780001 in INR for the period June 03, 2024 - December 03, 2024')] },
        { y: 100, cells: [L(27, 'DATE'), L(76, 'MODE**'), L(158, 'PARTICULARS'), R(427, 'DEPOSITS'), R(505, 'WITHDRAWALS'), R(583, 'BALANCE')] },
        { y: 112, cells: [L(27, '03-06-2024'), L(158, 'B/F'), R(583, '1,000.00')] },
        { y: 140, cells: [L(27, '04-06-2024'), L(158, 'FIRST ROW TEXT'), R(505, '100.00'), R(583, '900.00')] },
        { y: 150, cells: [L(158, 'WRAPPED LINE')] }, // exactly halfway between the two date lines
        { y: 160, cells: [L(27, '04-06-2024'), L(158, 'SECOND ROW TEXT'), R(427, '50.00'), R(583, '950.00')] },
      ],
    ]);
    const st = iciciSavingsParser.parse(doc, ctx);
    expect(st.rows).toHaveLength(2);
    // amounts and balances are unaffected by the doubt
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 10_000, 90_000],
      ['credit', 5_000, 95_000],
    ]);
    expect(st.reconciliation.status).toBe('balanced');
    for (const r of st.rows) expect(r.warnings).toContain('description_merged');
    const holders = st.rows.filter((r) => r.description.includes('WRAPPED LINE'));
    expect(holders).toHaveLength(1); // attributed exactly once
    expect(st.warnings.join(' ')).toMatch(/descriptions were assembled from nearby lines/);
  });

  it('detects its own layout and refuses a credit-card statement', async () => {
    const savings = await read((await iciciSavingsPages()).pages);
    const card = await read((await iciciCreditCardPages()).pages);
    expect(iciciSavingsParser.detect(savings).confidence).toBeGreaterThan(0.9);
    expect(iciciSavingsParser.detect(card).confidence).toBe(0);
  });
});

/** A wrong balance for ICICI txn `i`: the true balance plus ₹1.00. */
function built0(i: number): number {
  let b = ICICI_OPENING;
  ICICI_TXNS.slice(0, i + 1).forEach((t) => {
    b += t.debit !== undefined ? -t.debit : (t.credit ?? 0);
  });
  return b + 100;
}

// ─── DBS ────────────────────────────────────────────────────────────────────

describe('DBS savings parser', () => {
  it('reads date-first rows, wrapped descriptions, opening and closing balance', async () => {
    const built = await dbsPages();
    const st = parseLayout(await read(built.pages), ctx);
    expect(st.parserId).toBe('dbs-savings');
    expect(st.institution).toBe('DBS');
    expect(st.accountMask).toBe('0400');
    expect(st.holderName).toBe('ASHA VERMA');
    expect(st.periodStart).toBe('2025-09-01');
    expect(st.periodEnd).toBe('2025-09-30');
    expect(st.openingBalance).toBe(DBS_OPENING);
    expect(st.closingBalance).toBe(built.closing);
    expect(st.rows).toHaveLength(DBS_TXNS.length);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.reconciliation.rowBalanceBreaks).toBe(0);

    st.rows.forEach((r, i) => {
      const t = DBS_TXNS[i];
      expect(r.amount).toBe(t.debit ?? t.credit);
      expect(r.direction).toBe(t.debit !== undefined ? 'debit' : 'credit');
      expect(r.balanceAfter).toBe(built.balances[i]);
      // every character of the wrapped description is kept, in order
      expect(squash(r.description)).toBe(squash(t.text));
    });
    expect(st.rows[0].reference).toBe('100000000011');
    expect(st.rows[2].description).toBe('CREDIT INTEREST - Saving -100200300400');
    expect(st.rows[2].reference).toBeUndefined(); // the account number is not a reference
  });

  it('keeps the transaction date and the value date apart', async () => {
    const st = parseLayout(await read((await dbsPages()).pages), ctx);
    const last = st.rows[st.rows.length - 1];
    expect(last.date).toBe('2025-10-01');
    expect(last.valueDate).toBe('2025-09-30');
    // posted after the period end but value-dated inside it: not flagged
    expect(last.warnings).not.toContain('date_out_of_period');
    // dated before the period start on both dates: flagged, yet the amounts still reconcile
    expect(st.rows[0].warnings).toEqual(['date_out_of_period']);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('puts a credit under Credit even when the Debit cell is blank', async () => {
    const st = parseLayout(await read((await dbsPages()).pages), ctx);
    const credits = st.rows.filter((r) => DBS_TXNS[st.rows.indexOf(r)].credit !== undefined);
    expect(credits.length).toBeGreaterThan(0);
    for (const r of credits) expect(r.direction).toBe('credit');
    expect(st.rows[0].amount).toBe(100); // ₹1.00 credit — small amounts sit under Credit, not Balance
  });

  it('requires DBS markers', async () => {
    const hdfc = await read((await hdfcPages()).pages);
    expect(dbsSavingsParser.detect(hdfc).confidence).toBe(0);
    expect(dbsSavingsParser.detect(await read((await dbsPages()).pages)).confidence).toBeGreaterThan(0.9);
  });
});

// ─── ICICI credit card ──────────────────────────────────────────────────────

describe('ICICI credit-card parser', () => {
  it('reads the statement, treats CR as credit and uses SerNo as the reference', async () => {
    const built = await iciciCreditCardPages();
    const st = parseLayout(await read(built.pages), ctx);
    expect(st.parserId).toBe('icici-credit-card');
    expect(st.accountType).toBe('credit_card');
    expect(st.rows).toHaveLength(built.rowCount);
    expect(st.periodStart).toBe('2024-06-21');
    expect(st.periodEnd).toBe('2024-07-20');
    expect(st.printedTotals).toEqual({
      previousBalance: CC_PREVIOUS,
      totalDue: built.due,
      debits: built.debits,
      credits: built.credits,
    });

    const flat = CC_SECTIONS.flatMap((s) => s.txns.map((t) => ({ ...t, card: s.card.slice(-4) })));
    st.rows.forEach((r, i) => {
      const t = flat[i];
      expect(r.amount, `row ${i}`).toBe(t.amount);
      expect(r.direction, `row ${i}`).toBe(t.credit ? 'credit' : 'debit');
      expect(r.reference).toBe(t.ser);
      expect(r.description).toBe(t.text);
      expect(r.date).toBe(`${t.date.slice(6)}-${t.date.slice(3, 5)}-${t.date.slice(0, 2)}`);
    });
    // no running balance, but the printed summary lets us verify the rows
    expect(st.rows.every((r) => r.balanceAfter === undefined)).toBe(true);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.reconciliation.checks.map((c) => c.label)).toContain('Previous balance + charges - payments = total due');
  });

  it('drops the left sidebar that shares y-lines with the transactions', async () => {
    const built = await iciciCreditCardPages();
    const doc = await read(built.pages);
    // the sidebar really is on the same lines as transaction rows in the extracted layout
    const sharing = doc.pages[0].lines.filter((l) => /\d{2}\/\d{2}\/\d{4}/.test(l.text) && /%|exclusive|offers/.test(l.text));
    expect(sharing.length).toBeGreaterThan(0);

    const st = parseLayout(doc, ctx);
    for (const r of st.rows) {
      expect(r.description).not.toMatch(/%|exclusive|offers|Apparel|Fuel/);
      for (const raw of r.source.rawLines) expect(raw).not.toMatch(/%|exclusive|offers/);
    }
  });

  it('collects add-on card masks and tags each row with its card', async () => {
    const st = parseLayout(await read((await iciciCreditCardPages()).pages), ctx);
    expect(st.accountMask).toBe('1111');
    expect(st.cardMasks).toEqual(['1111', '2222']);
    expect(st.rows.map((r) => r.cardMask)).toEqual(['1111', '1111', '2222', '2222', '2222', '2222', '2222', '2222']);
  });

  it('does not run text that follows the table into the last row', async () => {
    const st = parseLayout(await read((await iciciCreditCardPages()).pages), ctx);
    const last = st.rows[st.rows.length - 1];
    expect(last.description).toBe('UPI-100000000024-Amazon I ndia IN');
  });

  it('flags a mismatch when the printed totals disagree with the rows', async () => {
    const sections = CC_SECTIONS.map((s, i) => ({
      ...s,
      txns: i === 1 ? s.txns.slice(0, -1) : s.txns, // drop a row but keep the old totals via previous balance trick below
    }));
    // Build with full sections for totals, then re-read with one row removed from the layout.
    const full = await iciciCreditCardPages();
    const trimmed = await iciciCreditCardPages(sections);
    // use the full statement's summary block with the trimmed table
    const summary = full.pages[0].texts.filter((t) => t.y > 250 && t.y < 300);
    const table = trimmed.pages[0].texts.filter((t) => !(t.y > 250 && t.y < 300));
    const st = parseLayout(await read([{ texts: [...summary, ...table] }]), ctx);
    expect(st.reconciliation.status).toBe('mismatch');
  });
});

describe("another bank's card statement", () => {
  const hdfcCard = layoutDoc([
    [
      { y: 56, cells: [L(38, 'HDFC BANK CREDIT CARD STATEMENT')] },
      { y: 80, cells: [L(38, 'Card No: 4000 XXXX XXXX 9999'), L(300, 'Pay through ICICI bank UPI at www.hdfcbank.com')] },
      { y: 120, cells: [L(40, 'Date'), L(100, 'Transaction Description'), R(520, 'Amount (in Rs.)')] },
      { y: 135, cells: [L(40, '02/07/2024'), L(100, 'EXAMPLE STORE MUMBAI'), R(520, '1,250.00')] },
      { y: 150, cells: [L(40, '05/07/2024'), L(100, 'PAYMENT RECEIVED'), R(520, '5,000.00 Cr')] },
    ],
  ]);

  it('is not accepted by the ICICI credit-card parser', () => {
    const d = iciciCreditCardParser.detect(hdfcCard);
    expect(d.confidence).toBeLessThan(0.5);
    expect(parseLayout(hdfcCard, ctx).parserId).not.toBe('icici-credit-card');
  });

  it('is not accepted even when it mentions ICICI and has the card title', () => {
    const mentionsIcici = layoutDoc([
      [
        { y: 56, cells: [L(38, 'CREDIT CARD STATEMENT')] },
        { y: 70, cells: [L(38, 'Pay from your ICICI Bank account via ICICI netbanking')] },
        { y: 120, cells: [L(40, 'Date'), L(100, 'Details'), R(520, 'Amount')] },
        { y: 135, cells: [L(40, '02/07/2024'), L(100, 'EXAMPLE STORE'), R(520, '1,250.00')] },
      ],
    ]);
    expect(iciciCreditCardParser.detect(mentionsIcici).confidence).toBeLessThan(0.5);
  });

  it('is not claimed by the ICICI savings parser either', () => {
    expect(iciciSavingsParser.detect(hdfcCard).confidence).toBe(0);
  });
});

// ─── Generic columnar ───────────────────────────────────────────────────────

/** A table whose header cells and rows are given directly. Rows are placed 14pt apart. */
function table(header: Cell[], rows: Cell[][], preamble: LineSpec[] = []): LayoutDoc {
  const lines: LineSpec[] = [...preamble, { y: 200, cells: header }];
  rows.forEach((cells, i) => lines.push({ y: 220 + i * 14, cells }));
  return layoutDoc([lines]);
}

describe('generic columnar parser', () => {
  it('reads an HDFC style PDF end to end', async () => {
    const built = await hdfcPages();
    const st = parseLayout(await read(built.pages), ctx);
    expect(st.parserId).toBe('universal');
    expect(st.institution).toBe('HDFC');
    expect(st.accountMask).toBe('0999');
    expect(st.periodStart).toBe('2024-04-01');
    expect(st.periodEnd).toBe('2024-04-30');
    expect(st.rows).toHaveLength(HDFC_TXNS.length);
    st.rows.forEach((r, i) => {
      const t = HDFC_TXNS[i];
      expect(r.amount).toBe(t.debit ?? t.credit);
      expect(r.direction).toBe(t.debit !== undefined ? 'debit' : 'credit');
      expect(r.balanceAfter).toBe(built.balances[i]);
      expect(r.reference).toBe(t.ref);
      expect(squash(r.description)).toBe(squash(t.text));
    });
    expect(st.rows[0].valueDate).toBe('2024-04-01');
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('keeps a reference number out of the amount: ref 123456 + amount 100.00 + balance 900.00', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Narration'), L(250, 'Chq./Ref.No.'), R(400, 'Withdrawal Amt.'), R(470, 'Deposit Amt.'), R(560, 'Closing Balance')],
      [
        [L(30, '01/04/24'), L(90, 'CHQ PAID EXAMPLE'), L(250, '123456'), R(395, '100.00'), R(560, '900.00')],
        [L(30, '02/04/24'), L(90, 'CHQ PAID EXAMPLE TWO'), L(250, '123457'), R(395, '50.00'), R(560, '850.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows).toHaveLength(2);
    expect(st.rows[0]).toMatchObject({ amount: 10_000, direction: 'debit', balanceAfter: 90_000, reference: '123456' });
    expect(st.rows[1]).toMatchObject({ amount: 5_000, direction: 'debit', balanceAfter: 85_000, reference: '123457' });
  });

  it('reads a blank withdrawal with a populated deposit as a credit', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Narration'), R(400, 'Withdrawal Amt.'), R(470, 'Deposit Amt.'), R(560, 'Closing Balance')],
      [
        [L(30, '01/04/24'), L(90, 'SALARY EXAMPLE EMPLOYER'), R(470, '2,500.00'), R(560, '3,500.00')],
        [L(30, '02/04/24'), L(90, 'ATM EXAMPLE'), R(400, '500.00'), R(560, '3,000.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows.map((r) => [r.direction, r.amount])).toEqual([
      ['credit', 250_000],
      ['debit', 50_000],
    ]);
  });

  it('handles SBI style headers with textual dates and a separate value date', () => {
    const doc = table(
      [L(30, 'Txn Date'), L(85, 'Value Date'), L(150, 'Description'), L(280, 'Ref No./Cheque No.'), R(400, 'Debit'), R(455, 'Credit'), R(520, 'Balance')],
      [
        [L(30, '1 Apr 2024'), L(85, '1 Apr 2024'), L(150, 'UPI/EXAMPLE'), L(280, 'TXN0001'), R(400, '120.00'), R(520, '880.00')],
        [L(30, '2 Apr 2024'), L(85, '3 Apr 2024'), L(150, 'SALARY'), L(280, 'TXN0002'), R(455, '2,000.00'), R(520, '2,880.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows.map((r) => [r.date, r.valueDate, r.direction, r.amount])).toEqual([
      ['2024-04-01', '2024-04-01', 'debit', 12_000],
      ['2024-04-02', '2024-04-03', 'credit', 200_000],
    ]);
    expect(st.rows[0].reference).toBe('TXN0001');
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('handles Axis style DR / CR / BAL headers', () => {
    const doc = table(
      [L(30, 'Tran Date'), L(90, 'CHQNO'), L(150, 'PARTICULARS'), R(380, 'DR'), R(440, 'CR'), R(500, 'BAL'), L(520, 'SOL')],
      [
        [L(30, '01-04-2024'), L(150, 'NEFT-EXAMPLE'), R(380, '1,000.00'), R(500, '9,000.00'), L(520, '1234')],
        [L(30, '02-04-2024'), L(150, 'INT.PD'), R(440, '12.50'), R(500, '9,012.50'), L(520, '1234')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 100_000, 900_000],
      ['credit', 1_250, 901_250],
    ]);
  });

  it('handles a Kotak style single amount column marked (Dr) / (Cr)', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Narration'), L(300, 'Chq/Ref No'), R(430, 'Withdrawal (Dr)/ Deposit (Cr)'), R(520, 'Balance')],
      [
        [L(30, '01 Apr 2024'), L(90, 'UPI-EXAMPLE SHOP'), L(300, 'UPI0001'), R(430, '250.00(Dr)'), R(520, '4,750.00(Cr)')],
        [L(30, '02 Apr 2024'), L(90, 'SALARY EXAMPLE'), L(300, 'NEFT0002'), R(430, '10,000.00(Cr)'), R(520, '14,750.00(Cr)')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 25_000, 475_000],
      ['credit', 1_000_000, 1_475_000],
    ]);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('flags ambiguous_amount for an unsigned Amount column with no Dr/Cr mark and no balance', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Description'), R(450, 'Amount')],
      [
        [L(30, '01/04/2024'), L(90, 'SOMETHING'), R(450, '250.00')],
        [L(30, '02/04/2024'), L(90, 'SOMETHING ELSE'), R(450, '1,000.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows).toHaveLength(2);
    for (const r of st.rows) expect(r.warnings).toContain('ambiguous_amount');
    expect(st.reconciliation.status).toBe('mismatch');
    expect(st.warnings.join(' ')).toMatch(/debit vs credit could not be determined/);
  });

  it('reads direction from the balance for an unsigned Amount column that has a balance', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Description'), R(400, 'Amount'), R(500, 'Balance')],
      [
        [L(30, '01/04/2024'), L(90, 'FIRST'), R(400, '100.00'), R(500, '900.00')],
        [L(30, '02/04/2024'), L(90, 'REFUND'), R(400, '50.00'), R(500, '950.00')],
        [L(30, '03/04/2024'), L(90, 'SPEND'), R(400, '200.00'), R(500, '750.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    // the first row has no earlier balance: flagged; the later two are decided by the running balance
    expect(st.rows[1].direction).toBe('credit');
    expect(st.rows[2].direction).toBe('debit');
    expect(st.rows[0].warnings).toContain('ambiguous_amount');
    expect(st.rows[1].warnings).not.toContain('ambiguous_amount');
  });

  it('reports lines with a date and an amount that could not become rows', () => {
    const doc = table(
      [L(30, 'Date'), L(90, 'Narration'), R(400, 'Withdrawal Amt.'), R(470, 'Deposit Amt.'), R(560, 'Closing Balance')],
      [
        [L(30, '01/04/24'), L(90, 'GOOD ROW'), R(400, '100.00'), R(560, '900.00')],
        // both a withdrawal and a deposit printed on one line: no reading can make a single row of it
        [L(30, '02/04/24'), L(90, 'ODD ROW'), R(400, '77.00'), R(470, '12.00'), R(560, '823.00')],
        [L(30, '03/04/24'), L(90, 'GOOD ROW 2'), R(400, '23.00'), R(560, '800.00')],
      ],
    );
    const st = genericColumnarParser.parse(doc, ctx);
    expect(st.rows).toHaveLength(2);
    expect(st.skipped).toHaveLength(1);
    expect(st.skipped[0].text).toContain('ODD ROW');
    expect(st.skipped[0].reason).toMatch(/debit and a credit/i);
    expect(st.warnings.join(' ')).toMatch(/could not be turned into transactions/);
  });

  it('is only selected when a real header and rows are found', () => {
    const noHeader = layoutDoc([[{ y: 100, cells: [L(30, 'Some letter text with 1,000.00 in it')] }]]);
    expect(genericColumnarParser.detect(noHeader).confidence).toBe(0);
    const headerOnly = table([L(30, 'Date'), L(90, 'Narration'), R(400, 'Debit'), R(470, 'Credit'), R(560, 'Balance')], []);
    expect(genericColumnarParser.detect(headerOnly).confidence).toBe(0);
  });

  it('never outranks a bank-specific parser', async () => {
    const doc = await read((await dbsPages()).pages);
    expect(genericColumnarParser.detect(doc).confidence).toBeLessThan(dbsSavingsParser.detect(doc).confidence);
    expect(parseLayout(doc, ctx).parserId).toBe('dbs-savings');
  });
});

describe('registry', () => {
  it('rejects a document with a recognised header but zero rows', () => {
    const doc = table([L(30, 'Date'), L(90, 'Narration'), R(400, 'Debit'), R(470, 'Credit'), R(560, 'Balance')], []);
    expect(() => parseLayout(doc, ctx)).toThrow(UnsupportedStatementError);
  });

  it('rejects text that no parser recognises, with hints', () => {
    const doc = layoutDoc([[{ y: 100, cells: [L(30, 'Dear customer, your loan application is approved.')] }]]);
    try {
      parseLayout(doc, ctx);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedStatementError);
      expect((e as UnsupportedStatementError).hints.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the next parser when the best one finds no rows', () => {
    // ICICI title + marker, but a table without a PARTICULARS column: the ICICI parser finds no rows.
    const doc = layoutDoc([
      [
        { y: 40, cells: [L(30, 'Statement of Transactions in Savings Account Number: 123456780001 in INR for the period June 03, 2024 - December 03, 2024 ICICI Bank')] },
        { y: 200, cells: [L(30, 'Date'), R(400, 'Withdrawal Amt.'), R(470, 'Deposit Amt.'), R(560, 'Closing Balance')] },
        { y: 220, cells: [L(30, '01/04/24'), R(400, '100.00'), R(560, '900.00')] },
      ],
    ]);
    const st = parseLayout(doc, ctx);
    expect(st.rows).toHaveLength(1);
    expect(st.parserId).toBe('universal');
  });
});
