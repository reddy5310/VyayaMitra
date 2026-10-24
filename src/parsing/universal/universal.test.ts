import { beforeAll, describe, expect, it } from 'vitest';
import type { ColumnRole, ParsedStatement, StatementTemplate } from '@/domain/types';
import { L, R, buildPdf, inr, layoutDoc, T, TR, type PdfText } from '../../../tests/fixtures/parsing/builders';
import {
  ALL_BANK_LAYOUTS,
  AMEX_EXPECTED,
  CARD_PREVIOUS,
  CARD_TXNS,
  LEDGER,
  LEDGER_OPENING,
  amexYearless,
  cardTotals,
  hdfcCard,
  hdfcLike,
  ledgerBalances,
  pageBreakStitching,
  sbiCard,
  xlsRecords,
} from '../../../tests/fixtures/parsing/layouts';
import { dbsPages, hdfcPages, iciciCreditCardPages, iciciSavingsPages } from '../../../tests/fixtures/parsing/statements';
import { extractLayout } from '../pdf/extract';
import { parseLayout } from '../registry';
import { draftTemplate, inspectStatement, parseStatement, UnsupportedStatementError, type StatementInspection } from '../index';
import { useLegacyPdfjsForNode } from '../pdf/node';
import { parseTables } from '../tables';
import { parseUniversal } from './engine';
import { sheetToLayout } from './sheet';
import { parseDateTok, inferDateOrder, resolveDate } from './dates';

beforeAll(() => useLegacyPdfjsForNode());

const ctx = { fileName: 'x' };
const bals = ledgerBalances();

function expectLedger(st: ParsedStatement, opts: { skipBalance?: boolean } = {}): void {
  expect(st.rows).toHaveLength(LEDGER.length);
  st.rows.forEach((r, i) => {
    const t = LEDGER[i];
    expect(r.date, `row ${i} date`).toBe(t.date);
    expect(r.amount, `row ${i} amount`).toBe(t.amount);
    expect(r.direction, `row ${i} direction`).toBe(t.dir);
    if (!opts.skipBalance) expect(r.balanceAfter, `row ${i} balance`).toBe(bals[i]);
  });
}

describe('universal engine: one ledger in twelve bank layouts', () => {
  const expectedInstitution: Record<string, string> = {
    hdfcLike: 'HDFC',
    sbiBilingual: 'SBI',
    axisLike: 'AXIS',
    kotakLike: 'KOTAK',
    bobSerialFirst: 'BOB',
    pnbLike: 'PNB',
    idfcDescriptionFirst: 'IDFC',
    yesSigned: 'YES',
    indusindDrCrColumn: 'INDUSIND',
    federalLike: 'FEDERAL',
    headerless: 'OTHER',
    mdyDates: 'OTHER',
  };

  for (const [name, build] of Object.entries(ALL_BANK_LAYOUTS)) {
    it(`${name}: same rows, directions and balances, reconciled`, () => {
      const st = parseUniversal(build(), { fileName: name, fileKind: 'pdf' });
      expectLedger(st);
      expect(st.reconciliation.status).toBe('balanced');
      expect(st.reconciliation.rowBalanceBreaks).toBe(0);
      expect(st.institution).toBe(expectedInstitution[name]);
      expect(st.accountType).toBe('savings');
      expect(st.skipped).toEqual([]);
    });
  }

  it('keeps unknown columns (Tran Type, Tran ID, Branch) out of descriptions', () => {
    const fed = parseUniversal(ALL_BANK_LAYOUTS.federalLike(), { fileName: 'f', fileKind: 'pdf' });
    for (const r of fed.rows) expect(r.description).not.toMatch(/TFR|S100000/);
    const pnb = parseUniversal(ALL_BANK_LAYOUTS.pnbLike(), { fileName: 'p', fileKind: 'pdf' });
    for (const r of pnb.rows) expect(r.description).not.toMatch(/MAIN BRANCH|S10\d/);
  });

  it('rebuilds wrapped descriptions below the date line', () => {
    const st = parseUniversal(hdfcLike(), { fileName: 'h', fileKind: 'pdf' });
    expect(st.rows[0].description).toBe('UPI/ASHA VERMA/ground rent share april');
    expect(st.rows[3].description).toBe('ATM CASH WDL EXAMPLE ROAD TERMINAL 0042');
  });

  it('reads description-first tables (particulars left of the date)', () => {
    const st = parseUniversal(ALL_BANK_LAYOUTS.idfcDescriptionFirst(), { fileName: 'i', fileKind: 'pdf' });
    expect(st.rows[0].description).toBe('UPI/ASHA VERMA/ground rent share april');
  });

  it('reads serial-first tables without taking the serial number for an amount or a reference', () => {
    const st = parseUniversal(ALL_BANK_LAYOUTS.bobSerialFirst(), { fileName: 'b', fileKind: 'pdf' });
    expect(st.rows.map((r) => r.reference)).toEqual(new Array(LEDGER.length).fill(undefined));
    expect(st.rows[0].valueDate).toBe('2024-04-01');
  });

  it('takes the overdraft sign from Dr on a balance', () => {
    const doc = sbiLikeOverdraft();
    const st = parseUniversal(doc, { fileName: 'od', fileKind: 'pdf' });
    expect(st.rows.map((r) => r.balanceAfter)).toEqual([-50_000, -150_000, 50_000]);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('stitches a description across a page break and ignores the repeated header and page counters', () => {
    const st = parseUniversal(pageBreakStitching(), { fileName: 'pb', fileKind: 'pdf' });
    expect(st.rows).toHaveLength(3);
    expect(st.rows[1].description).toBe('UPI/ASHA VERMA/long note continues on next page and ends here');
    expect(st.rows[2].description).toBe('SALARY');
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reads newest-first statements in date order', () => {
    const doc = reversedLedger();
    const st = parseUniversal(doc, { fileName: 'r', fileKind: 'pdf' });
    expect(st.rows.map((r) => r.date)).toEqual(['2024-04-01', '2024-04-02', '2024-04-03', '2024-04-04', '2024-04-05']);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.warnings.join(' ')).toMatch(/newest/);
  });
});

function sbiLikeOverdraft() {
  return layoutDoc([
    [
      { y: 40, cells: [L(40, 'State Bank of India')] },
      { y: 100, cells: [L(30, 'Date'), L(100, 'Description'), R(400, 'Debit'), R(460, 'Credit'), R(540, 'Balance')] },
      { y: 112, cells: [L(100, 'Opening Balance'), R(538, '500.00 Cr')] },
      { y: 120, cells: [L(30, '01/04/2024'), L(100, 'FIRST'), R(398, '1,000.00'), R(538, '500.00 Dr')] },
      { y: 134, cells: [L(30, '02/04/2024'), L(100, 'SECOND'), R(398, '1,000.00'), R(538, '1,500.00 Dr')] },
      { y: 148, cells: [L(30, '03/04/2024'), L(100, 'THIRD'), R(458, '2,000.00'), R(538, '500.00 Cr')] },
    ],
  ]);
}

function reversedLedger() {
  // five transactions printed newest first; balances are the true running balances
  const rows = [
    { d: '05/04/2024', desc: 'E', debit: 100_00, bal: 9_000_00 },
    { d: '04/04/2024', desc: 'D', credit: 500_00, bal: 9_100_00 },
    { d: '03/04/2024', desc: 'C', debit: 250_00, bal: 8_600_00 },
    { d: '02/04/2024', desc: 'B', debit: 50_00, bal: 8_850_00 },
    { d: '01/04/2024', desc: 'A', credit: 900_00, bal: 8_900_00 },
  ];
  return layoutDoc([
    [
      { y: 100, cells: [L(30, 'Date'), L(100, 'Narration'), R(400, 'Withdrawal'), R(460, 'Deposit'), R(540, 'Balance')] },
      ...rows.map((r, i) => ({
        y: 120 + i * 14,
        cells: [L(30, r.d), L(100, r.desc), ...(r.debit ? [R(398, inr(r.debit))] : [R(458, inr(r.credit as number))]), R(538, inr(r.bal))],
      })),
    ],
  ]);
}

describe('universal engine: credit cards', () => {
  const t = cardTotals();

  it('SBI Card style: D / C suffix, label : value summary, card number in the header', () => {
    const st = parseUniversal(sbiCard(), { fileName: 's', fileKind: 'pdf' });
    expect(st.institution).toBe('SBI_CARD');
    expect(st.accountType).toBe('credit_card');
    expect(st.rows.map((r) => [r.date, r.direction, r.amount])).toEqual(
      CARD_TXNS.map((x) => [x.date, x.credit ? 'credit' : 'debit', x.amount]),
    );
    expect(st.cardSummary).toMatchObject({
      statementDate: '2024-07-15',
      dueDate: '2024-08-04',
      totalDue: t.due,
      previousBalance: CARD_PREVIOUS,
      creditLimit: 10_000_000,
      availableCredit: 10_000_000 - t.due,
    });
    expect(st.cardSummary?.minimumDue).toBeGreaterThan(0);
    expect(st.cardMasks).toEqual(['7788']);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.reconciliation.checks.map((c) => c.label)).toContain('Previous balance + charges - payments = total due');
  });

  it('HDFC card style: stacked summary, Cr suffix, rewards column and a section heading', () => {
    const st = parseUniversal(hdfcCard(), { fileName: 'h', fileKind: 'pdf' });
    expect(st.institution).toBe('HDFC');
    expect(st.accountType).toBe('credit_card');
    expect(st.rows).toHaveLength(CARD_TXNS.length);
    expect(st.rows.map((r) => r.direction)).toEqual(CARD_TXNS.map((x) => (x.credit ? 'credit' : 'debit')));
    // the clock time and the reward points are not part of the description
    expect(st.rows[0].description).toBe('EXAMPLE MART BENGALURU');
    expect(st.rows.some((r) => /Domestic/.test(r.description))).toBe(false);
    expect(st.cardSummary).toMatchObject({ totalDue: t.due, dueDate: '2024-08-04', previousBalance: CARD_PREVIOUS });
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('Amex style: year-less dates across Dec to Jan take their year from the statement period', () => {
    const st = parseUniversal(amexYearless(), { fileName: 'a', fileKind: 'pdf' });
    expect(st.rows.map((r) => [r.date, r.amount, r.direction])).toEqual(AMEX_EXPECTED.map((x) => [x.date, x.amount, x.dir]));
    expect(st.periodStart).toBe('2023-12-12');
    expect(st.periodEnd).toBe('2024-01-11');
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.warnings.join(' ')).toMatch(/no year/);
  });

  it('tries the opposite sign convention when the card summary demands it', () => {
    // charges printed negative, payments positive
    const doc = layoutDoc([
      [
        { y: 30, cells: [L(40, 'Example Card Services Credit Card Statement')] },
        { y: 44, cells: [L(40, 'Statement Period : 01 Jun 2024 to 30 Jun 2024')] },
        { y: 70, cells: [L(40, 'Previous Balance'), L(220, '1,000.00')] },
        { y: 84, cells: [L(40, 'Total Amount Due'), L(220, '1,300.00')] },
        { y: 98, cells: [L(40, 'Minimum Amount Due'), L(220, '100.00')] },
        { y: 112, cells: [L(40, 'Payment Due Date'), L(220, '20 Jul 2024')] },
        { y: 140, cells: [L(40, 'Date'), L(110, 'Description'), R(520, 'Amount')] },
        { y: 158, cells: [L(40, '03 Jun'), L(110, 'SHOP ONE'), R(520, '-500.00')] },
        { y: 171, cells: [L(40, '10 Jun'), L(110, 'PAYMENT THANK YOU'), R(520, '200.00')] },
      ],
    ]);
    const st = parseUniversal(doc, { fileName: 'n', fileKind: 'pdf' });
    expect(st.rows.map((r) => r.direction)).toEqual(['debit', 'credit']);
    expect(st.reconciliation.status).toBe('balanced');
  });
});

describe('dates', () => {
  it('votes day-first vs month-first from the values', () => {
    expect(inferDateOrder(['04/14/2024', '05/02/2024'])).toBe('MDY');
    expect(inferDateOrder(['14/04/2024', '05/02/2024'])).toBe('DMY');
    expect(inferDateOrder(['05/02/2024'])).toBe('DMY');
    expect(inferDateOrder(['2024/04/14'])).toBe('YMD');
  });

  it('reads the many ways Indian statements write dates', () => {
    const cases: [string, string][] = [
      ['12-JUL-24', '2024-07-12'],
      ['2024/07/12', '2024-07-12'],
      ['12.07.2024', '2024-07-12'],
      ['12th July 2024', '2024-07-12'],
      ['July 12, 2024', '2024-07-12'],
      ['12 Jul 2024 10:30:15', '2024-07-12'],
      ['12/07/24', '2024-07-12'],
    ];
    for (const [text, iso] of cases) {
      const tok = parseDateTok(text, 'DMY');
      expect(tok, text).not.toBeNull();
      expect(resolveDate(tok!), text).toBe(iso);
    }
    expect(parseDateTok('31/02/2024', 'DMY')).toBeNull();
    expect(parseDateTok('12.50', 'DMY')).toBeNull(); // an amount, not a date
  });

  it('resolves year-less dates against the statement end, including the year rollover', () => {
    expect(resolveDate({ d: 28, m: 12 }, '2024-01-11')).toBe('2023-12-28');
    expect(resolveDate({ d: 3, m: 1 }, '2024-01-11')).toBe('2024-01-03');
    expect(resolveDate({ d: 29, m: 2 }, '2025-03-01')).toBe('2024-02-29');
    expect(resolveDate({ d: 5, m: 5 })).toBeNull();
  });

  it('decides month-first for a document by voting (mdyDates layout)', () => {
    const st = parseUniversal(ALL_BANK_LAYOUTS.mdyDates(), { fileName: 'm', fileKind: 'pdf' });
    expect(st.rows[0].date).toBe('2024-04-01');
    expect(st.learnedTemplate?.dateOrder).toBe('MDY');
  });
});

describe('spreadsheets and OFX through the same engine', () => {
  it('reads an Excel-style table with title rows and a totals row', () => {
    const st = parseTables([{ name: 'Sheet1', records: xlsRecords() }], ctx);
    expectLedger(st);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('the universal engine alone reads the same sheet (index-based columns)', () => {
    const st = parseUniversal(sheetToLayout(xlsRecords()), { fileName: 'x.xlsx', fileKind: 'sheet' });
    expectLedger(st);
    expect(st.reconciliation.status).toBe('balanced');
    expect(st.learnedTemplate?.fileKind).toBe('sheet');
    expect(st.learnedTemplate?.columns.every((c) => c.index !== undefined && c.x0 === undefined)).toBe(true);
  });

  it('reads a sheet with Hindi headers and no decimals in plain numbers', () => {
    const records = [
      ['दिनांक', 'विवरण', 'नामे', 'जमा', 'शेष'],
      ['01/04/2024', 'FIRST', '100', '', '900'],
      ['02/04/2024', 'SECOND', '', '250.5', '1150.50'],
    ];
    const st = parseUniversal(sheetToLayout(records), { fileName: 'h.xls', fileKind: 'sheet' });
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 10_000, 90_000],
      ['credit', 25_050, 115_050],
    ]);
  });

  it('parses an OFX file', async () => {
    const ofx = [
      'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', '', '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>INR',
      '<BANKACCTFROM><BANKID>EXAM<ACCTID>00001234567<ACCTTYPE>SAVINGS</BANKACCTFROM>',
      '<BANKTRANLIST><DTSTART>20240401<DTEND>20240430',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240402<TRNAMT>-150.25<FITID>A1<NAME>EXAMPLE SHOP</STMTTRN>',
      '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240405<TRNAMT>1000.00<FITID>A2<NAME>EXAMPLE SALARY</STMTTRN>',
      '</BANKTRANLIST><LEDGERBAL><BALAMT>849.75<DTASOF>20240430</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
    ].join('\n');
    const st = await parseStatement({ name: 'export.ofx', bytes: new TextEncoder().encode(ofx) });
    expect(st.rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ['2024-04-02', 'debit', 15_025],
      ['2024-04-05', 'credit', 100_000],
    ]);
    expect(st.accountMask).toBe('4567');
  });
});

describe('self-training: learn, reuse, teach', () => {
  const asTemplate = (draft: NonNullable<ParsedStatement['learnedTemplate']>, id = 'tpl-1'): StatementTemplate => ({
    ...draft,
    id,
    source: 'auto',
    verifiedCount: 1,
    useCount: 1,
    createdAt: '2024-05-01T00:00:00Z',
    updatedAt: '2024-05-01T00:00:00Z',
  });

  it('emits a learned template after an inferred import, with no personal data', () => {
    const st = parseUniversal(hdfcLike(), { fileName: 'h', fileKind: 'pdf' });
    const tpl = st.learnedTemplate!;
    expect(st.template).toEqual({ source: 'inferred' });
    expect(tpl.institution).toBe('HDFC');
    expect(tpl.fileKind).toBe('pdf');
    expect(tpl.amountStyle).toBe('split');
    expect(tpl.descriptionLayout).toBe('below');
    expect(tpl.dateOrder).toBe('DMY');
    expect(tpl.columns.map((c) => c.role)).toEqual(['date', 'description', 'reference', 'value_date', 'debit', 'credit', 'balance']);
    expect(tpl.signature.markers).toContain('hdfc bank');
    expect(tpl.signature.headerTokens).toEqual(expect.arrayContaining(['narration', 'withdrawal', 'deposit', 'balance']));

    // nothing from the statement body or letterhead leaks into the template
    const json = JSON.stringify(tpl);
    expect(json).not.toMatch(/\d{4,}/);
    expect(json).not.toMatch(/ASHA|VERMA|EXAMPLE|50100000000999|UPI|NEFT|SALARY/i);
  });

  it('reuses a stored template: same rows, template id recorded', () => {
    const doc = hdfcLike();
    const learned = parseUniversal(doc, { fileName: 'h', fileKind: 'pdf' }).learnedTemplate!;
    const tpl = asTemplate(learned);
    const st = parseUniversal(doc, { fileName: 'h', fileKind: 'pdf', templates: [tpl] });
    expect(st.template).toEqual({ id: 'tpl-1', source: 'auto' });
    expect(st.learnedTemplate).toBeUndefined();
    expectLedger(st);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('does not apply a template from a different bank or layout', () => {
    const doc = hdfcLike();
    const learned = parseUniversal(ALL_BANK_LAYOUTS.axisLike(), { fileName: 'a', fileKind: 'pdf' }).learnedTemplate!;
    const st = parseUniversal(doc, { fileName: 'h', fileKind: 'pdf', templates: [asTemplate(learned, 'axis')] });
    expect(st.template?.id).toBeUndefined();
    expectLedger(st);
  });

  it('works through parseStatement with a real PDF and stored templates', async () => {
    const built = await hdfcPages();
    const bytes = await buildPdf(built.pages);
    const first = await parseStatement({ name: 'a.pdf', bytes });
    expect(first.parserId).toBe('universal');
    const tpl = asTemplate(first.learnedTemplate!);
    const second = await parseStatement({ name: 'b.pdf', bytes }, { templates: [tpl] });
    expect(second.template?.id).toBe('tpl-1');
    expect(second.rows.map((r) => r.amount)).toEqual(first.rows.map((r) => r.amount));
    expect(second.rows.map((r) => r.direction)).toEqual(first.rows.map((r) => r.direction));
  });

  /** A statement whose labels no bank dictionary knows: the user must teach it. */
  async function strangePdf(): Promise<Uint8Array> {
    const texts: PdfText[] = [
      T(40, 60, 'Example Cooperative Society', 10),
      T(40, 120, 'Posted On'),
      T(120, 120, 'Memo'),
      TR(400, 120, 'Out'),
      TR(470, 120, 'In'),
      TR(560, 120, 'Running'),
    ];
    const rows = [
      ['03-Jun-24', 'ATM EXAMPLE', 250_000, 'out', 9_750_000],
      ['04-Jun-24', 'SALARY EXAMPLE', 1_500_000, 'in', 11_250_000],
      ['05-Jun-24', 'GROCERY EXAMPLE', 120_050, 'out', 11_129_950],
      ['06-Jun-24', 'RENT EXAMPLE', 900_000, 'out', 10_229_950],
    ] as const;
    rows.forEach(([d, desc, a, dir, bal], i) => {
      const y = 140 + i * 14;
      texts.push(T(40, y, d), T(120, y, desc), TR(dir === 'out' ? 400 : 470, y, inr(a)), TR(560, y, inr(bal)));
    });
    return buildPdf([{ texts }]);
  }

  it('inspects an unknown format and offers column guesses with samples', async () => {
    const insp = await inspectStatement({ name: 'coop.pdf', bytes: await strangePdf() });
    expect(insp.fileKind).toBe('pdf');
    expect(insp.columns.length).toBeGreaterThanOrEqual(5);
    const date = insp.columns.find((c) => c.guessedRole === 'date');
    expect(date?.samples[0]).toBe('03-Jun-24');
    const money = insp.columns.filter((c) => ['debit', 'credit', 'amount', 'balance'].includes(c.guessedRole));
    expect(money.length).toBeGreaterThanOrEqual(3);
    expect(insp.previewRows.length).toBe(4);
    expect(Object.keys(insp.previewRows[0].cells).length).toBeGreaterThanOrEqual(4);
    expect(insp.guesses.dateOrder).toBe('DMY');
    expect(insp.columns.every((c) => c.confidence > 0 && c.confidence <= 1)).toBe(true);
    for (const c of insp.columns) {
      expect(c.id).toMatch(/^c\d+$/);
      expect(c.x0).toBeDefined();
    }
  });

  it('teach flow: map the columns once, then parse with the template and reuse it later', async () => {
    const bytes = await strangePdf();
    const file = { name: 'coop.pdf', bytes };
    const insp: StatementInspection = await inspectStatement(file);

    // The user maps the columns: Out = debit, In = credit, Running = balance, Memo = description.
    const roles: Record<string, ColumnRole> = {};
    for (const c of insp.columns) {
      const h = (c.header ?? '').toLowerCase();
      roles[c.id] = h === 'posted on' ? 'date' : h === 'memo' ? 'description' : h === 'out' ? 'debit' : h === 'in' ? 'credit' : h === 'running' ? 'balance' : 'ignore';
    }
    const draft = draftTemplate(insp, { roles, name: 'My co-operative society', institution: 'COOP_SOCIETY' });
    expect(draft.name).toBe('My co-operative society');
    expect(draft.columns.filter((c) => c.role !== 'ignore')).toHaveLength(5);

    const taught = await parseStatement(file, { template: draft });
    expect(taught.rows.map((r) => [r.date, r.direction, r.amount, r.balanceAfter])).toEqual([
      ['2024-06-03', 'debit', 250_000, 9_750_000],
      ['2024-06-04', 'credit', 1_500_000, 11_250_000],
      ['2024-06-05', 'debit', 120_050, 11_129_950],
      ['2024-06-06', 'debit', 900_000, 10_229_950],
    ]);
    expect(taught.reconciliation.status).toBe('balanced');
    expect(taught.rows[1].description).toBe('SALARY EXAMPLE');
    expect(taught.template?.source).toBe('user');

    // stored as a template, the next statement from the same society is recognised
    const stored: StatementTemplate = {
      ...draft,
      id: 'taught-1',
      source: 'user',
      verifiedCount: 1,
      useCount: 1,
      createdAt: '2024-06-10T00:00:00Z',
      updatedAt: '2024-06-10T00:00:00Z',
    };
    const reused = await parseStatement(file, { templates: [stored] });
    expect(reused.template?.id).toBe('taught-1');
    expect(reused.rows).toHaveLength(4);
  });

  it('a wrong mapping fails loudly instead of producing wrong rows', async () => {
    const file = { name: 'coop.pdf', bytes: await strangePdf() };
    const insp = await inspectStatement(file);
    const roles: Record<string, ColumnRole> = {};
    for (const c of insp.columns) roles[c.id] = 'description';
    await expect(parseStatement(file, { template: draftTemplate(insp, { roles }) })).rejects.toBeInstanceOf(UnsupportedStatementError);
  });

  it('scrubs personal data from taught templates', async () => {
    const insp = await inspectStatement({ name: 'coop.pdf', bytes: await strangePdf() });
    const dirty: StatementInspection = {
      ...insp,
      markers: ['hdfc bank', 'asha verma 9876543210', 'a/c 1234567890 holder'],
      headerTokens: ['date', 'ravi@oksbi', 'asha'],
      columns: insp.columns.map((c, i) => (i === 1 ? { ...c, header: 'Asha Verma 9876543210 Flat 4, MG Road' } : c)),
    };
    const roles: Record<string, ColumnRole> = {};
    for (const c of dirty.columns) roles[c.id] = 'ignore';
    const draft = draftTemplate(dirty, { roles, name: 'Asha 9876543210 statements' });
    const json = JSON.stringify(draft);
    expect(json).not.toMatch(/9876543210|1234567890|MG Road|oksbi/i);
    expect(draft.signature.markers).toEqual(['hdfc bank']);
    expect(draft.name).toBe('Custom format');
  });

  it('teaches a spreadsheet format by column index', () => {
    const records = [
      ['Posted', 'Memo', 'Out', 'In', 'Running'],
      ['03-Jun-24', 'ATM EXAMPLE', '2,500.00', '', '97,500.00'],
      ['04-Jun-24', 'SALARY EXAMPLE', '', '15,000.00', '1,12,500.00'],
    ];
    const layout = sheetToLayout(records);
    const st = parseUniversal(layout, {
      fileName: 's.xlsx',
      fileKind: 'sheet',
      template: {
        name: 'Taught sheet',
        institution: 'OTHER',
        accountType: 'savings',
        fileKind: 'sheet',
        signature: { markers: [], headerTokens: [], columnCount: 5 },
        columns: [
          { role: 'date', index: 0 },
          { role: 'description', index: 1 },
          { role: 'debit', index: 2 },
          { role: 'credit', index: 3 },
          { role: 'balance', index: 4 },
        ],
        amountStyle: 'split',
      },
    });
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['debit', 250_000, 9_750_000],
      ['credit', 1_500_000, 11_250_000],
    ]);
  });
});

describe('opening balance and statement metadata', () => {
  it('reads the opening balance printed before the first row', () => {
    const doc = layoutDoc([
      [
        { y: 40, cells: [L(40, 'Example Bank')] },
        { y: 100, cells: [L(30, 'Date'), L(100, 'Narration'), R(400, 'Debit'), R(460, 'Credit'), R(540, 'Balance')] },
        { y: 112, cells: [L(100, 'Opening Balance'), R(538, inr(LEDGER_OPENING))] },
        { y: 126, cells: [L(30, '01/04/2024'), L(100, 'FIRST'), R(398, '1,000.00'), R(538, inr(LEDGER_OPENING - 100_000))] },
        { y: 140, cells: [L(100, 'Closing Balance'), R(538, inr(LEDGER_OPENING - 100_000))] },
      ],
    ]);
    const st = parseUniversal(doc, { fileName: 'o', fileKind: 'pdf' });
    expect(st.openingBalance).toBe(LEDGER_OPENING);
    expect(st.closingBalance).toBe(LEDGER_OPENING - 100_000);
    expect(st.reconciliation.checks.map((c) => c.label)).toContain('Opening + credits - debits = closing');
  });
});

describe('universal engine reproduces the dedicated parsers on the same files', () => {
  const squash = (s: string) => s.replace(/\s+/g, '');
  const cases: [string, () => Promise<{ pages: Parameters<typeof buildPdf>[0] }>][] = [
    ['ICICI savings', () => iciciSavingsPages({ limitY: 560 })],
    ['DBS savings', () => dbsPages()],
    ['ICICI credit card', () => iciciCreditCardPages()],
  ];
  for (const [name, make] of cases) {
    for (const headerless of [false, true]) {
      it(`${name}${headerless ? ' (headerless inference)' : ''}: same rows as the dedicated parser`, async () => {
        const doc = await extractLayout(await buildPdf((await make()).pages));
        const dedicated = parseLayout(doc, ctx);
        const uni = parseUniversal(doc, { fileName: 'x', fileKind: 'pdf', forceHeaderless: headerless });
        expect(uni.rows).toHaveLength(dedicated.rows.length);
        uni.rows.forEach((r, i) => {
          const d = dedicated.rows[i];
          expect([r.date, r.valueDate, r.amount, r.direction, r.balanceAfter, r.cardMask]).toEqual([
            d.date,
            d.valueDate,
            d.amount,
            d.direction,
            d.balanceAfter,
            d.cardMask,
          ]);
          // without a header the serial, reward and mode columns cannot be told from the description
          if (!headerless) expect(squash(r.description)).toBe(squash(d.description));
        });
        expect(uni.reconciliation.status).toBe(dedicated.reconciliation.status);
        expect(uni.reconciliation.status).toBe('balanced');
        expect(uni.cardMasks).toEqual(dedicated.cardMasks);
        expect(uni.openingBalance).toBe(dedicated.openingBalance);
        expect(uni.closingBalance).toBe(dedicated.closingBalance);
      });
    }
  }

  it('keeps the credit-card sidebar out of rows without any bank-specific rule', async () => {
    const doc = await extractLayout(await buildPdf((await iciciCreditCardPages()).pages));
    const st = parseUniversal(doc, { fileName: 'c', fileKind: 'pdf' });
    for (const r of st.rows) {
      expect(r.description).not.toMatch(/%|exclusive|offers|Apparel|Fuel/);
      for (const raw of r.source.rawLines) expect(raw).not.toMatch(/%|exclusive|offers/);
    }
    expect(st.cardMasks).toEqual(['1111', '2222']);
    expect(st.cardSummary?.totalDue).toBeGreaterThan(0);
  });
});

describe('account type, institution by IFSC, progress and OCR hand-off', () => {
  const table = (extra: { y: number; items: { text: string; x0: number; x1: number }[] }[] = []) =>
    layoutDoc([
      [
        ...extra.map((l) => ({ y: l.y, cells: l.items.map((i) => L(i.x0, i.text)) })),
        { y: 100, cells: [L(30, 'Date'), L(100, 'Particulars'), R(400, 'Debit'), R(460, 'Credit'), R(540, 'Balance')] },
        { y: 120, cells: [L(30, '01/04/2024'), L(100, 'EMI RECOVERED'), R(398, '5,000.00'), R(538, '95,000.00')] },
        { y: 134, cells: [L(30, '02/04/2024'), L(100, 'PART PAYMENT'), R(458, '1,000.00'), R(538, '96,000.00')] },
      ],
    ]);
  const heading = (text: string) => [{ y: 40, items: [{ text, x0: 40, x1: 300 }] }];

  it('recognises loan, wallet and current-account statements from their headings', () => {
    expect(parseUniversal(table(heading('Loan Account Statement')), { fileName: 'l', fileKind: 'pdf' }).accountType).toBe('loan');
    expect(parseUniversal(table(heading('Paytm Wallet statement')), { fileName: 'w', fileKind: 'pdf' }).accountType).toBe('wallet');
    expect(parseUniversal(table(heading('Statement of Current Account')), { fileName: 'c', fileKind: 'pdf' }).accountType).toBe('current');
    expect(parseUniversal(table(heading('Statement of Account')), { fileName: 's', fileKind: 'pdf' }).accountType).toBe('savings');
  });

  it('identifies a bank from the IFSC bank code when its name is not printed', () => {
    const st = parseUniversal(table(heading('Branch IFSC : UTIB0001234')), { fileName: 'i', fileKind: 'pdf' });
    expect(st.institution).toBe('AXIS');
    // only the 4-letter bank code may reach a template, never the branch part
    expect(JSON.stringify(st.learnedTemplate)).not.toMatch(/0001234/);
  });

  it('does not take a bank named in a transaction for the statement bank', () => {
    const st = parseUniversal(
      layoutDoc([
        [
          { y: 40, cells: [L(40, 'Account Statement')] },
          { y: 100, cells: [L(30, 'Date'), L(100, 'Particulars'), R(400, 'Debit'), R(460, 'Credit'), R(540, 'Balance')] },
          { y: 120, cells: [L(30, '01/04/2024'), L(100, 'NEFT FROM HDFC BANK LTD'), R(458, '1,000.00'), R(538, '2,000.00')] },
        ],
      ]),
      { fileName: 'x', fileKind: 'pdf' },
    );
    expect(st.institution).toBe('OTHER');
  });

  it('reports progress while reading and parsing', async () => {
    const seen: string[] = [];
    const bytes = await buildPdf((await hdfcPages()).pages);
    await parseStatement({ name: 'p.pdf', bytes }, { onProgress: (p) => seen.push(p.stage) });
    expect(seen).toContain('reading');
    expect(seen).toContain('parsing');
  });
});

describe('CSV exports through parseStatement', () => {
  const csv = (lines: string[]) => ({ name: 'export.csv', bytes: new TextEncoder().encode(lines.join('\n')) });

  it('reads month-first dates that the day-first CSV reader would drop', async () => {
    const st = await parseStatement(
      csv([
        'Date,Description,Debit,Credit,Balance',
        '04/14/2024,FIRST,100.00,,900.00',
        '04/15/2024,SECOND,,50.00,950.00',
        '04/20/2024,THIRD,25.00,,925.00',
      ]),
    );
    expect(st.rows.map((r) => r.date)).toEqual(['2024-04-14', '2024-04-15', '2024-04-20']);
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reads a headerless CSV from its numbers alone', async () => {
    const st = await parseStatement(
      csv([
        '01-04-2024,SALARY EXAMPLE,,"20,000.00","1,20,000.00"',
        '02-04-2024,RENT EXAMPLE,"15,000.00",,"1,05,000.00"',
        '03-04-2024,GROCERY EXAMPLE,"1,250.50",,"1,03,749.50"',
        '04-04-2024,REFUND EXAMPLE,,300.00,"1,04,049.50"',
      ]),
    );
    expect(st.rows.map((r) => [r.direction, r.amount, r.balanceAfter])).toEqual([
      ['credit', 2_000_000, 12_000_000],
      ['debit', 1_500_000, 10_500_000],
      ['debit', 125_050, 10_374_950],
      ['credit', 30_000, 10_404_950],
    ]);
    expect(st.warnings.join(' ')).toMatch(/no printed table header/);
  });
});
