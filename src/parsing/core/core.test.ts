import { describe, expect, it } from 'vitest';
import { L, R, layoutDoc, type Cell, type LineSpec } from '../../../tests/fixtures/parsing/builders';
import { attributeBlocks } from './blocks';
import { findHeader, matchRole } from './header';
import { reconcile, type DraftRow } from './reconcile';
import { assignAmountColumn, explodeDates, layoutAmountColumns, splitLine } from './table';
import { decimalStringToPaise, joinWrapped, readDate, readMoney, splitLeadingDate } from './text';
import { findPeriod } from './meta';
import { buildLines } from '../pdf/layout';
import type { LayoutItem } from '../pdf/types';

describe('readMoney', () => {
  it('accepts only amounts with exactly two decimals', () => {
    expect(readMoney('1,27,102.63')?.paise).toBe(12_710_263);
    expect(readMoney('100.00')?.paise).toBe(10_000);
    expect(readMoney('`23,273.56')?.paise).toBe(2_327_356);
    expect(readMoney('₹4,807.32')?.paise).toBe(480_732);
  });

  it('never reads reference, cheque or UPI numbers as money', () => {
    for (const ref of ['123456', '100000000099', '9000000099', '0000409000000001', '1.5', '12345.6', 'UPI/123456', '1,234']) {
      expect(readMoney(ref)).toBeNull();
    }
  });

  it('reads Dr/Cr markers and signs without floats', () => {
    expect(readMoney('1,657.82 CR')).toMatchObject({ paise: 165_782, indicator: 'CR' });
    expect(readMoney('5,000.00(Dr)')).toMatchObject({ paise: 500_000, indicator: 'DR' });
    expect(readMoney('2,000.00 (cr)')).toMatchObject({ paise: 200_000, indicator: 'CR' });
    expect(readMoney('-42.98')).toMatchObject({ paise: 4_298, negative: true });
    expect(readMoney('(500.00)')).toMatchObject({ paise: 50_000, negative: true });
    expect(readMoney('0.07')?.paise).toBe(7);
  });
});

describe('decimalStringToPaise', () => {
  it('converts rupee strings by string arithmetic', () => {
    expect(decimalStringToPaise('1234.5')).toBe(123_450);
    expect(decimalStringToPaise('0.1')).toBe(10);
    expect(decimalStringToPaise('19.99')).toBe(1_999);
    expect(decimalStringToPaise('1,00,000')).toBe(10_000_000);
    expect(decimalStringToPaise('-250.75')).toBe(-25_075);
    // float artefacts from exports are rounded half-up at the third decimal, not trusted
    expect(decimalStringToPaise('12.300000000000001')).toBe(1_230);
    expect(decimalStringToPaise('0.285')).toBe(29);
    expect(decimalStringToPaise('abc')).toBeNull();
    expect(decimalStringToPaise('1e5')).toBeNull();
  });
});

describe('dates in text', () => {
  it('reads only whole-cell dates', () => {
    expect(readDate('03-06-2024')).toBe('2024-06-03');
    expect(readDate('31-Aug-2025')).toBe('2025-08-31');
    expect(readDate('01/04/24')).toBe('2024-04-01');
    expect(readDate('1 Apr 2024')).toBe('2024-04-01');
    expect(readDate('100000000099')).toBeNull();
    expect(readDate('CAM/55051HRY/CASH WDL/25-10-24')).toBeNull();
  });

  it('splits a date off a glued cell', () => {
    expect(splitLeadingDate('05-06-2024 CMS TRANSACTION')).toMatchObject({ date: '2024-06-05', rest: 'CMS TRANSACTION' });
    expect(splitLeadingDate('PAID 05-06-2024')).toBeNull();
    const items: LayoutItem[] = [{ text: '05-06-2024 CMS TRANSACTION', x0: 27, x1: 152 }];
    const out = explodeDates(items);
    expect(out.map((i) => i.text)).toEqual(['05-06-2024', 'CMS TRANSACTION']);
    expect(out[0].x1).toBeLessThan(out[1].x0 + 1);
  });

  it('finds a statement period in several formats', () => {
    expect(findPeriod('for the period June 03, 2024 - December 03, 2024')).toEqual({ start: '2024-06-03', end: '2024-12-03' });
    expect(findPeriod('Statement Period: 01-Sep-2025 To 30-Sep-2025')).toEqual({ start: '2025-09-01', end: '2025-09-30' });
    expect(findPeriod('From : 01/04/2024 To : 30/04/2024')).toEqual({ start: '2024-04-01', end: '2024-04-30' });
    expect(findPeriod('Statement period : June 21, 2024 to July 20, 2024')).toEqual({ start: '2024-06-21', end: '2024-07-20' });
    expect(findPeriod('no dates here')).toBeNull();
  });
});

describe('joinWrapped', () => {
  it('joins ordinary wrapped lines with a space', () => {
    expect(joinWrapped([{ text: 'UPI/1/Payment from' }, { text: 'Ph/x@ybl/State Bank Of' }, { text: 'I/YBL1' }])).toBe(
      'UPI/1/Payment from Ph/x@ybl/State Bank Of I/YBL1',
    );
  });

  it('does not add a space around separators', () => {
    expect(joinWrapped([{ text: 'Ph/9000000001-' }, { text: '3@yb/State' }])).toBe('Ph/9000000001-3@yb/State');
    expect(joinWrapped([{ text: 'NAME' }, { text: '-YBL28e6' }])).toBe('NAME-YBL28e6');
  });

  it('rejoins a single token that was cut at the column limit', () => {
    const lines = [
      { text: 'UPI~100000000011~asha.verma@okaxis~ASHAVER', x1: 322 },
      { text: 'MA JOSHI', x1: 200 },
    ];
    expect(joinWrapped(lines, 323)).toBe('UPI~100000000011~asha.verma@okaxis~ASHAVERMA JOSHI');
    // a short line is never glued
    expect(joinWrapped([{ text: 'HDFC', x1: 180 }, { text: 'BANK', x1: 190 }], 323)).toBe('HDFC BANK');
  });
});

describe('layout reconstruction', () => {
  const raw = (str: string, x: number, topY: number, width: number, height = 8) => ({
    str,
    x,
    y: 800 - topY,
    width,
    height,
  });

  it('groups fragments into lines top to bottom with a tolerance relative to glyph height', () => {
    const lines = buildLines(
      1,
      [
        raw('Amount', 400, 100.9, 30), // baseline off by <1pt: same line
        raw('Date', 40, 100, 20),
        raw('Second line', 40, 120, 50),
      ],
      800,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].items.map((i) => i.text)).toEqual(['Date', 'Amount']);
    expect(lines[0].index).toBe(0);
    expect(lines[1].text).toBe('Second line');
    expect(lines[1].page).toBe(1);
  });

  it('merges kerned fragments and word gaps but keeps column gaps apart', () => {
    const lines = buildLines(
      1,
      [raw('UPI/45', 158, 100, 24), raw('2096', 182.2, 100, 17), raw('Payment', 202, 100, 30), raw('from', 235, 100, 18), raw('40,000.00', 470, 100, 36)],
      800,
    );
    expect(lines[0].items.map((i) => i.text)).toEqual(['UPI/452096 Payment from', '40,000.00']);
  });

  it('records x0 and x1 for each item', () => {
    const [line] = buildLines(1, [raw('1,657.82 CR', 524, 50, 33)], 800);
    expect(line.items[0]).toMatchObject({ x0: 524, x1: 557 });
  });
});

describe('header synonyms', () => {
  it('maps the usual Indian bank column labels', () => {
    const cases: [string, ReturnType<typeof matchRole>][] = [
      ['Date', 'date'],
      ['Txn Date', 'date'],
      ['Tran Date', 'date'],
      ['Transaction Date', 'date'],
      ['Value Date', 'valueDate'],
      ['Value Dt', 'valueDate'],
      ['Narration', 'description'],
      ['Particulars', 'description'],
      ['Details of transaction', 'description'],
      ['Remarks', 'description'],
      ['Withdrawal Amt.', 'debit'],
      ['Withdrawal (Dr)', 'debit'],
      ['Debit', 'debit'],
      ['DR', 'debit'],
      ['Deposit Amt.', 'credit'],
      ['Deposit (Cr)', 'credit'],
      ['CREDIT', 'credit'],
      ['Balance', 'balance'],
      ['Closing Balance', 'balance'],
      ['Chq./Ref.No.', 'reference'],
      ['Ref No./Cheque No.', 'reference'],
      ['MODE**', 'mode'],
      ['Withdrawal (Dr)/ Deposit (Cr)', 'amount'],
      ['Amount (INR)', 'amount'],
      ['Dr/Cr', 'type'],
      ['Random heading', null],
    ];
    for (const [label, role] of cases) expect(matchRole(label), label).toBe(role);
  });

  const rowsFor = (header: Cell[]): LineSpec[] => [
    { y: 100, cells: header },
    { y: 120, cells: [L(30, '01/04/24'), L(90, 'x'), R(400, '10.00'), R(500, '90.00')] },
  ];

  it('finds the header even when two labels were glued into one item', () => {
    const doc = layoutDoc([
      [
        { y: 100, cells: [L(30, 'Date'), L(90, 'Narration'), R(430, 'Debit'), { x: 480, text: 'Credit Balance' }] },
      ],
    ]);
    const h = findHeader(doc.pages[0]);
    expect(h?.cells.map((c) => c.role)).toEqual(['date', 'description', 'debit', 'credit', 'balance']);
  });

  it('finds SBI, Axis and Kotak style headers', () => {
    const sbi = findHeader(
      layoutDoc([rowsFor([L(30, 'Txn Date'), L(85, 'Value Date'), L(150, 'Description'), L(280, 'Ref No./Cheque No.'), R(400, 'Debit'), R(455, 'Credit'), R(520, 'Balance')])]).pages[0],
    );
    expect(sbi?.cells.map((c) => c.role)).toEqual(['date', 'valueDate', 'description', 'reference', 'debit', 'credit', 'balance']);
    const axis = findHeader(
      layoutDoc([rowsFor([L(30, 'Tran Date'), L(90, 'CHQNO'), L(150, 'PARTICULARS'), R(380, 'DR'), R(440, 'CR'), R(500, 'BAL')])]).pages[0],
    );
    expect(axis?.cells.map((c) => c.role)).toEqual(['date', 'description', 'debit', 'credit', 'balance']);
    const kotak = findHeader(
      layoutDoc([rowsFor([L(30, 'Date'), L(90, 'Narration'), L(300, 'Chq/Ref No'), R(430, 'Withdrawal (Dr)/ Deposit (Cr)'), R(520, 'Balance')])]).pages[0],
    );
    expect(kotak?.cells.map((c) => c.role)).toEqual(['date', 'description', 'reference', 'amount', 'balance']);
  });

  it('is not fooled by a summary table without a date column', () => {
    const doc = layoutDoc([[{ y: 100, cells: [L(30, 'ACCOUNT TYPE'), R(242, 'A/c BALANCE'), R(388, 'FIXED DEPOSITS'), R(505, 'TOTAL BALANCE')] }]]);
    expect(findHeader(doc.pages[0])).toBeNull();
  });
});

describe('amount column assignment by position', () => {
  // DBS shape: header right edges 369 / 446 / 531, amounts 390 / 469 / 553 (offset of ~22).
  const dbs = layoutDoc([
    [
      { y: 100, cells: [L(37, 'Transaction Date'), L(111, 'Value Date'), L(205, 'Details of transaction'), R(369, 'Debit'), R(446, 'Credit'), R(531, 'Balance')] },
      { y: 120, cells: [L(42, '01-Sep-2025'), L(104, '01-Sep-2025'), L(169, 'UPI~1~a@b~X'), R(390, '5,000.00'), R(553, '4,588.38')] },
      { y: 130, cells: [L(42, '02-Sep-2025'), L(104, '02-Sep-2025'), L(169, 'UPI~2~a@b~Y'), R(469, '1.00'), R(553, '4,589.38')] },
    ],
  ]);

  it('learns the header-to-amount offset from the page itself', () => {
    const page = dbs.pages[0];
    const header = findHeader(page)!;
    const layout = layoutAmountColumns(header, page.lines.slice(1));
    expect(layout.offset).toBeGreaterThan(18);
    expect(layout.offset).toBeLessThan(26);
    const debitLine = splitLine(page.lines[1], layout);
    expect(debitLine.amounts.map((a) => [a.col.role, a.money.paise])).toEqual([
      ['debit', 500_000],
      ['balance', 458_838],
    ]);
    const creditLine = splitLine(page.lines[2], layout);
    expect(creditLine.amounts.map((a) => [a.col.role, a.money.paise])).toEqual([
      ['credit', 100],
      ['balance', 458_938],
    ]);
  });

  it('puts a blank-debit, populated-credit row in the credit column (never the debit)', () => {
    const page = dbs.pages[0];
    const layout = layoutAmountColumns(findHeader(page)!, page.lines.slice(1));
    const cols = splitLine(page.lines[2], layout).amounts.map((a) => a.col.role);
    expect(cols).toContain('credit');
    expect(cols).not.toContain('debit');
  });

  it('does not assign tokens that sit far from every amount column', () => {
    const page = dbs.pages[0];
    const layout = layoutAmountColumns(findHeader(page)!, page.lines.slice(1));
    expect(assignAmountColumn({ text: '100.00', x0: 250, x1: 280 }, layout)).toBeNull();
  });
});

describe('reconcile', () => {
  const row = (amount: number, direction: 'debit' | 'credit' | undefined, balance?: number, date = '2024-06-03'): DraftRow => ({
    date,
    amount,
    direction,
    balanceAfter: balance,
    description: 'x',
    source: { page: 1, lineStart: 0, lineEnd: 0, rawLines: ['x'] },
    warnings: [],
  });

  it('balances a clean chain and the opening/closing equation', () => {
    const r = reconcile({
      rows: [row(10_000, 'debit', 90_000), row(5_000, 'credit', 95_000)],
      openingBalance: 100_000,
      closingBalance: 95_000,
    });
    expect(r.reconciliation.status).toBe('balanced');
    expect(r.reconciliation.rowBalanceBreaks).toBe(0);
    expect(r.reconciliation.checks.every((c) => c.ok)).toBe(true);
  });

  it('trusts the balance over the column and flags direction_from_balance', () => {
    const r = reconcile({ rows: [row(10_000, 'debit', 110_000)], openingBalance: 100_000 });
    expect(r.rows[0].direction).toBe('credit');
    expect(r.rows[0].warnings).toContain('direction_from_balance');
    expect(r.reconciliation.rowBalanceBreaks).toBe(0);
  });

  it('decides an undecided direction from the balance without a warning', () => {
    const r = reconcile({ rows: [row(10_000, undefined, 90_000)], openingBalance: 100_000 });
    expect(r.rows[0].direction).toBe('debit');
    expect(r.rows[0].warnings).toEqual([]);
  });

  it('flags a balance break to the paise and reports a mismatch', () => {
    const r = reconcile({ rows: [row(10_000, 'debit', 90_001)], openingBalance: 100_000 });
    expect(r.rows[0].warnings).toContain('balance_break');
    expect(r.reconciliation.rowBalanceBreaks).toBe(1);
    expect(r.reconciliation.status).toBe('mismatch');
  });

  it('counts one misprinted balance once, not once per following row', () => {
    const r = reconcile({
      rows: [row(10_000, 'debit', 90_000), row(10_000, 'debit', 70_000 /* should be 80_000 */), row(10_000, 'debit', 70_000)],
      openingBalance: 100_000,
    });
    expect(r.reconciliation.rowBalanceBreaks).toBe(1);
    expect(r.rows[1].warnings).toContain('balance_break');
    expect(r.rows[2].warnings).not.toContain('balance_break');
  });

  it('fails when opening + credits - debits differs from the closing balance', () => {
    const r = reconcile({ rows: [row(10_000, 'debit')], openingBalance: 100_000, closingBalance: 91_000 });
    const check = r.reconciliation.checks.find((c) => c.label.startsWith('Opening'));
    expect(check).toMatchObject({ ok: false, expected: 91_000, actual: 90_000 });
    expect(r.reconciliation.status).toBe('mismatch');
  });

  it('checks printed debit and credit totals', () => {
    const rows = [row(10_000, 'debit'), row(2_500, 'credit')];
    expect(reconcile({ rows, printedTotals: { debits: 10_000, credits: 2_500 } }).reconciliation.status).toBe('balanced');
    expect(reconcile({ rows, printedTotals: { debits: 10_000, credits: 2_501 } }).reconciliation.status).toBe('mismatch');
  });

  it('is unverified when nothing printed can be checked', () => {
    const r = reconcile({ rows: [row(10_000, 'debit')] });
    expect(r.reconciliation.status).toBe('unverified');
    expect(r.reconciliation.checks.length).toBeGreaterThan(0);
  });

  it('flags rows outside the printed period but accepts a value date inside it', () => {
    const inPeriod = { ...row(100, 'debit', undefined, '2024-07-01'), valueDate: '2024-06-30' };
    const r = reconcile({
      rows: [row(100, 'debit', undefined, '2024-05-31'), inPeriod, row(100, 'debit', undefined, '2024-06-10')],
      periodStart: '2024-06-01',
      periodEnd: '2024-06-30',
    });
    expect(r.rows[0].warnings).toContain('date_out_of_period');
    expect(r.rows[1].warnings).not.toContain('date_out_of_period');
    expect(r.rows[2].warnings).not.toContain('date_out_of_period');
  });

  it('never assumes a direction: an unsigned amount with no balance is flagged ambiguous', () => {
    const r = reconcile({ rows: [row(100, undefined)] });
    expect(r.rows[0].warnings).toContain('ambiguous_amount');
    expect(r.ambiguousCount).toBe(1);
    expect(r.reconciliation.status).toBe('mismatch');
  });

  it('checks the credit-card equation previous + charges - payments = total due', () => {
    const rows = [row(1_000, 'debit'), row(300, 'credit')];
    const ok = reconcile({ rows, nature: 'liability', printedTotals: { previousBalance: 500, totalDue: 1_200 } });
    expect(ok.reconciliation.status).toBe('balanced');
    const bad = reconcile({ rows, nature: 'liability', printedTotals: { previousBalance: 500, totalDue: 1_201 } });
    expect(bad.reconciliation.status).toBe('mismatch');
  });
});

describe('attributeBlocks (text centred on the date line)', () => {
  it('gives each transaction the lines symmetric around its date line', () => {
    // three rows of: one line above, date line carrying text, one below
    const dates = [
      { y: 100, hasText: true },
      { y: 130, hasText: true },
      { y: 160, hasText: true },
    ];
    const gaps = [[90], [108.8, 119.6], [138.8, 149.6], [168.8]];
    const r = attributeBlocks(dates, gaps);
    expect(r.above).toEqual([1, 1, 1]);
    expect(r.below).toEqual([1, 1, 1]);
    expect(r.uncertain).toEqual([false, false, false]);
  });

  it('copes with rows of different heights next to each other', () => {
    // row A: 2 lines (its blank date line sits between them), row B: text on its own date line only,
    // row C: 3 lines (middle one on its date line)
    const dates = [
      { y: 105, hasText: false },
      { y: 130, hasText: true },
      { y: 165, hasText: true },
    ];
    const r = attributeBlocks(dates, [[100], [110], [155.4], [174.6]]);
    expect(r.above).toEqual([1, 0, 1]);
    expect(r.below).toEqual([1, 0, 1]);
  });

  it('does not let a row with no description opt out', () => {
    const dates = [
      { y: 100, hasText: false },
      { y: 129.4, hasText: false },
    ];
    // two lines between the dates: one belongs to each row
    const r = attributeBlocks(dates, [[90.4], [109.6, 119.2], [138.8]]);
    expect(r.above).toEqual([1, 1]);
    expect(r.below).toEqual([1, 1]);
  });

  it('reports a split as uncertain when two attributions are equally good', () => {
    // one line exactly halfway between two date lines that both carry their own text
    const dates = [
      { y: 100, hasText: true },
      { y: 120, hasText: true },
    ];
    const r = attributeBlocks(dates, [[], [110], []]);
    expect(r.uncertain).toEqual([true, true]);
    expect(r.gapMargin[1]).toBeLessThan(2);
  });
});

describe('header dictionary across banks, including Hindi', () => {
  const labels: [string, ReturnType<typeof matchRole>][] = [
    // dates
    ['Txn Date', 'date'], ['Tran Date', 'date'], ['Posting Date', 'date'], ['Book Date', 'date'], ['Date of Transaction', 'date'],
    ['Transaction Date', 'date'], ['Value Dt', 'valueDate'], ['Value Date', 'valueDate'], ['दिनांक', 'date'], ['तारीख', 'date'], ['दिनांक Date', 'date'],
    // descriptions
    ['Narration', 'description'], ['Particulars', 'description'], ['Transaction Remarks', 'description'], ['Transaction Particulars', 'description'],
    ['Details', 'description'], ['विवरण', 'description'], ['विवरण Description', 'description'], ['Description of Transaction', 'description'],
    // references
    ['Chq./Ref.No.', 'reference'], ['Cheque Number', 'reference'], ['Ref No./Cheque No.', 'reference'], ['Instrument No', 'reference'], ['UTR No', 'reference'],
    // money
    ['Withdrawal Amt.', 'debit'], ['Withdrawals', 'debit'], ['Debit Amount', 'debit'], ['Dr Amount', 'debit'], ['Amount Debited', 'debit'], ['Paid Out', 'debit'],
    ['Money Out', 'debit'], ['नामे', 'debit'], ['नामे Debit', 'debit'], ['निकासी', 'debit'],
    ['Deposit Amt.', 'credit'], ['Deposits', 'credit'], ['Credit Amount', 'credit'], ['Cr Amount', 'credit'], ['Amount Credited', 'credit'], ['Paid In', 'credit'],
    ['Money In', 'credit'], ['जमा', 'credit'], ['जमा Credit', 'credit'],
    ['Closing Balance', 'balance'], ['Running Balance', 'balance'], ['Available Balance', 'balance'], ['Balance(INR)', 'balance'], ['BAL', 'balance'], ['शेष', 'balance'],
    ['Amount', 'amount'], ['Transaction Amount', 'amount'], ['Amount (in Rs.)', 'amount'], ['Withdrawal (Dr)/ Deposit (Cr)', 'amount'],
    ['Dr/Cr', 'type'], ['Txn Type', 'type'],
    // columns to ignore
    ['Sr. No.', 'serial'], ['S No', 'serial'], ['Reward Points', 'skip'], ['Intl. Amount', 'foreign'],
    // not labels
    ['Branch Name', null], ['Tran ID', null], ['Page', null],
  ];
  it(`maps ${labels.length} real-world labels`, () => {
    expect(labels.length).toBeGreaterThanOrEqual(60);
    for (const [label, role] of labels) {
      // "Branch Name" is a column to ignore, never a role
      expect(matchRole(label), label).toBe(role);
    }
  });
});
