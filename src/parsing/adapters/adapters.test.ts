import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { StatementFile } from '../index';
import { IncorrectPasswordError, PasswordRequiredError, UnsupportedStatementError } from '../errors';
import { isOfx, isSpreadsheet, ocrPagesToLayoutDoc, readOfx, readSpreadsheet } from '.';
import { mapReadError } from './spreadsheet';
import type { OcrWord } from './types';

const enc = new TextEncoder();
const file = (name: string, bytes: Uint8Array | string): StatementFile => ({ name, bytes: typeof bytes === 'string' ? enc.encode(bytes) : bytes });

// ─── Synthetic workbooks (no real data) ──────────────────────────────────────

/** Title, blank row, header, three transactions; column A and the last column are blank padding. */
function sampleWorkbook(): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([
    [null, 'Example Bank Ltd - Statement of Account', null, null, null, null],
    [null, null, null, null, null, null],
    [null, 'Date', 'Narration', 'Debit', 'Credit', null],
    [null, null, 'Opening balance', null, null, null],
  ]);
  // Date cells stored with Excel's built-in format 14, which SheetJS would print US-style.
  XLSX.utils.sheet_add_aoa(
    ws,
    [
      [null, 45_000, 'UPI/SAMPLE SHOP/001', 1234.5, null, null],
      [null, 45_001, 'SALARY SAMPLE CO', null, 50_000, null],
    ],
    { origin: 'A5' },
  );
  ws.B5.z = 'm/d/yy';
  ws.B6.z = 'm/d/yy';
  for (const a of ['D5', 'E6']) ws[a].z = '#,##0.00';
  ws['!merges'] = [XLSX.utils.decode_range('B1:E1')];
  ws['!ref'] = 'A1:F6';
  const second = XLSX.utils.aoa_to_sheet([['Notes'], ['nothing to see']]);
  const empty = XLSX.utils.aoa_to_sheet([[null]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  XLSX.utils.book_append_sheet(wb, second, 'Notes');
  XLSX.utils.book_append_sheet(wb, empty, 'Blank');
  return wb;
}

const written = (bookType: XLSX.BookType): Uint8Array => new Uint8Array(XLSX.write(sampleWorkbook(), { type: 'array', bookType }) as ArrayBuffer);

const EXPECTED_STATEMENT = [
  ['Example Bank Ltd - Statement of Account', '', '', ''],
  ['Date', 'Narration', 'Debit', 'Credit'],
  ['', 'Opening balance', '', ''],
  ['2023-03-15', 'UPI/SAMPLE SHOP/001', '1,234.50', ''],
  ['2023-03-16', 'SALARY SAMPLE CO', '', '50,000.00'],
];

describe('spreadsheet adapter: real workbook formats', () => {
  for (const [label, bookType, name] of [
    ['XLSX', 'xlsx', 'statement.xlsx'],
    ['XLS (BIFF8)', 'biff8', 'statement.xls'],
    ['ODS', 'ods', 'statement.ods'],
    ['SpreadsheetML 2003', 'xlml', 'statement.xml'],
  ] as const) {
    it(`reads ${label}: formatted text, ISO dates, padding and blank sheets removed`, async () => {
      const f = file(name, written(bookType));
      expect(isSpreadsheet(f)).toBe(true);
      const tables = await readSpreadsheet(f);
      expect(tables.map((t) => t.name)).toEqual(['Statement', 'Notes']); // the empty sheet is dropped
      if (bookType === 'ods') {
        // The ODS writer in the test library drops number formats, so only structure and values can be compared.
        const rows = tables[0].records;
        expect(rows.slice(0, 3)).toEqual(EXPECTED_STATEMENT.slice(0, 3));
        expect(rows.slice(3).map((r) => r[1])).toEqual(['UPI/SAMPLE SHOP/001', 'SALARY SAMPLE CO']);
        expect([rows[3][2], rows[4][3]].map(Number)).toEqual([1234.5, 50000]);
      } else {
        expect(tables[0].records).toEqual(EXPECTED_STATEMENT);
      }
      expect(tables[1].records).toEqual([['Notes'], ['nothing to see']]);
    });
  }

  it('detects by content, not by extension', async () => {
    expect(isSpreadsheet(file('statement.dat', written('xlsx')))).toBe(true);
    expect(isSpreadsheet(file('statement.pdf', written('biff8')))).toBe(true);
    const tables = await readSpreadsheet(file('whatever.bin', written('xlsx')));
    expect(tables[0].records[1]).toEqual(['Date', 'Narration', 'Debit', 'Credit']);
  });
});

describe('spreadsheet adapter: HTML table saved as .xls', () => {
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
    <table><tr><td colspan="3">Example Bank - Account Statement</td></tr>
    <tr><td>Txn Date</td><td>Description</td><td>Amount</td></tr>
    <tr><td>01/02/2025</td><td>UPI-SAMPLE&nbsp;STORE</td><td>1,234.50</td></tr>
    <tr><td>03/02/2025</td><td>ATM CASH</td><td>(500.00)</td></tr></table>
    <table><tr><td>Summary</td><td>2 rows</td></tr></table></body></html>`;

  it('is detected as a spreadsheet and keeps cell text exactly as printed', async () => {
    const f = file('AccountStatement.xls', html);
    expect(isSpreadsheet(f)).toBe(true);
    const tables = await readSpreadsheet(f);
    expect(tables).toHaveLength(2);
    expect(tables[0].records).toEqual([
      ['Example Bank - Account Statement', '', ''],
      ['Txn Date', 'Description', 'Amount'],
      ['01/02/2025', 'UPI-SAMPLE STORE', '1,234.50'],
      ['03/02/2025', 'ATM CASH', '(500.00)'],
    ]);
    expect(tables[1].records).toEqual([['Summary', '2 rows']]);
  });

  it('is detected even when named .pdf or with a byte-order mark', () => {
    expect(isSpreadsheet(file('x.pdf', html))).toBe(true);
    expect(isSpreadsheet(file('x.xls', '﻿\n  ' + html))).toBe(true);
  });

  it('decodes windows-1252 exports', async () => {
    const bytes = Uint8Array.from([...enc.encode('<table><tr><td>Caf')].concat([0xe9], [...enc.encode('</td><td>1,00</td></tr></table>')]));
    const [t] = await readSpreadsheet(file('legacy.xls', bytes));
    expect(t.records[0][0]).toBe('Café');
  });
});

describe('spreadsheet adapter: not a spreadsheet', () => {
  it('rejects PDFs, CSV, plain text, OFX and tiny files', () => {
    expect(isSpreadsheet(file('a.pdf', '%PDF-1.7\n1 0 obj'))).toBe(false);
    expect(isSpreadsheet(file('a.xlsx', '%PDF-1.7 not really a workbook'))).toBe(false);
    expect(isSpreadsheet(file('a.csv', 'Date,Description,Amount\n01/02/2025,Shop,10.00\n'))).toBe(false);
    expect(isSpreadsheet(file('a.txt', 'hello world, this is just text'))).toBe(false);
    expect(isSpreadsheet(file('a.ofx', '<OFX><BANKMSGSRSV1><STMTTRN></STMTTRN></BANKMSGSRSV1></OFX>'))).toBe(false);
    expect(isSpreadsheet(file('a.html', '<html><body><p>No tables here, just a web page.</p></body></html>'))).toBe(false);
    expect(isSpreadsheet(file('a.xls', '<tr>'))).toBe(false);
  });

  it('refuses a file that is not a workbook when asked to read it', async () => {
    await expect(readSpreadsheet(file('a.csv', 'Date,Amount\n1,2\n'))).rejects.toBeInstanceOf(UnsupportedStatementError);
  });
});

describe('spreadsheet adapter: password errors', () => {
  it('maps the library messages to the shared errors', () => {
    expect(() => mapReadError(new Error('File is password-protected'), false)).toThrow(PasswordRequiredError);
    expect(() => mapReadError(new Error('Password is incorrect'), true)).toThrow(IncorrectPasswordError);
    expect(() => mapReadError(new Error('File is password-protected: ECMA-376 Extensible'), true)).toThrow(UnsupportedStatementError);
    expect(() => mapReadError(new Error('Encryption scheme unsupported'), true)).toThrow(UnsupportedStatementError);
    expect(() => mapReadError(new Error('boom'), false)).toThrow(UnsupportedStatementError);
  });
});

// ─── OFX / QFX ───────────────────────────────────────────────────────────────

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20250930120000<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>INR
<BANKACCTFROM><BANKID>EXAMPLE<ACCTID>0012345678901234<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20250901<DTEND>20250930
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20250914120000[+5:30:IST]<TRNAMT>-1,250.00<FITID>REF002<NAME>SAMPLE STORE<MEMO>UPI/12345</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20250902<TRNAMT>50000.00<FITID>REF001<NAME>SALARY SAMPLE CO<MEMO>SALARY SAMPLE CO</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>48750.00<DTASOF>20250930</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>INR</CURDEF>
<CCACCTFROM><ACCTID>4000 1234 5678 9010</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20250905000000</DTPOSTED><TRNAMT>-499,50</TRNAMT><FITID>C1</FITID><NAME>Tom &amp; Jerry Cafe</NAME></STMTTRN>
<STMTTRN><TRNTYPE>PAYMENT</TRNTYPE><DTPOSTED>20250910000000</DTPOSTED><TRNAMT>10000.00</TRNAMT><FITID>C2</FITID><MEMO>BILL PAYMENT</MEMO></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-1500.25</BALAMT><DTASOF>20250930</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe('OFX / QFX adapter', () => {
  it('detects SGML and XML variants by content', () => {
    expect(isOfx(file('export.dat', OFX_SGML))).toBe(true);
    expect(isOfx(file('export.dat', OFX_XML))).toBe(true);
    expect(isOfx(file('export.qfx', '\n\n' + OFX_SGML))).toBe(true);
    expect(isOfx(file('a.csv', 'Date,Amount\n1,2\n'))).toBe(false);
    expect(isOfx(file('a.pdf', '%PDF-1.4 something'))).toBe(false);
  });

  it('reads the SGML variant: fixed header, ISO dates, oldest first, balance on the last row', async () => {
    const r = await readOfx(file('x.ofx', OFX_SGML));
    expect(r.table.name).toBe('OFX');
    expect(r.table.records).toEqual([
      ['Date', 'Description', 'Amount', 'Reference', 'Type', 'Balance'],
      ['2025-09-02', 'SALARY SAMPLE CO', '50000.00', 'REF001', 'CREDIT', ''],
      ['2025-09-14', 'SAMPLE STORE UPI/12345', '-1250.00', 'REF002', 'DEBIT', '48750.00'],
    ]);
    expect(r.accountType).toBe('savings');
    expect(r.accountMask).toBe('1234'); // only the last four characters
    expect(r.currency).toBe('INR');
  });

  it('reads the XML credit-card variant: entities, decimal comma, spaced account id', async () => {
    const r = await readOfx(file('x.qfx', OFX_XML));
    expect(r.accountType).toBe('credit_card');
    expect(r.accountMask).toBe('9010');
    expect(r.table.records).toEqual([
      ['Date', 'Description', 'Amount', 'Reference', 'Type', 'Balance'],
      ['2025-09-05', 'Tom & Jerry Cafe', '-499.50', 'C1', 'DEBIT', ''],
      ['2025-09-10', 'BILL PAYMENT', '10000.00', 'C2', 'PAYMENT', '-1500.25'],
    ]);
  });

  it('never exposes more than the last four characters of the account id', async () => {
    const r = await readOfx(file('x.ofx', OFX_SGML));
    expect(JSON.stringify(r)).not.toContain('00123456789');
  });

  it('checking accounts map to current; a file without transactions is rejected', async () => {
    const checking = OFX_SGML.replace('SAVINGS', 'CHECKING');
    expect((await readOfx(file('x.ofx', checking))).accountType).toBe('current');
    await expect(readOfx(file('x.ofx', '<OFX><BANKMSGSRSV1><STMTRS></STMTRS></BANKMSGSRSV1></OFX> padding padding'))).rejects.toBeInstanceOf(
      UnsupportedStatementError,
    );
  });
});

// ─── OCR word boxes → LayoutDoc ──────────────────────────────────────────────

describe('OCR words to LayoutDoc', () => {
  const SCALE = 2;
  /** 595 x 842 pt page rendered at 2x. Boxes are in pixels, top-down. */
  const w = (text: string, x0: number, bottom: number, width: number, line: number, confidence = 90, height = 20): OcrWord => ({
    text,
    x0,
    x1: x0 + width,
    y0: bottom - height,
    y1: bottom,
    confidence,
    line,
  });

  it('builds one line per visual row, ordered top to bottom, items left to right, in PDF points', () => {
    const doc = ocrPagesToLayoutDoc([
      {
        width: 595,
        height: 842,
        scale: SCALE,
        words: [
          // Second row listed first, and its words out of order.
          w('1,234.50', 800, 400, 120, 1),
          w('UPI/SAMPLE', 300, 402, 160, 1),
          w('SHOP', 472, 398, 70, 1),
          w('14/09/2025', 100, 400, 110, 1),
          w('Date', 100, 200, 60, 0),
          w('Narration', 300, 201, 140, 0),
          w('Amount', 800, 199, 110, 0),
        ],
      },
    ]);
    const page = doc.pages[0];
    expect(page.page).toBe(1);
    expect(page.width).toBe(595);
    expect(page.height).toBe(842);
    expect(page.lines.map((l) => l.text)).toEqual(['Date Narration Amount', '14/09/2025 UPI/SAMPLE SHOP 1,234.50']);
    const row = page.lines[1];
    expect(row.items.map((i) => i.text)).toEqual(['14/09/2025', 'UPI/SAMPLE SHOP', '1,234.50']);
    // Pixels become points.
    expect(row.items[0].x0).toBeCloseTo(50, 5);
    expect(row.items[0].x1).toBeCloseTo(105, 5);
    expect(row.items[2].x1).toBeCloseTo(460, 5);
    // Baseline is the median bottom of the line, in top-down points.
    expect(row.y).toBeCloseTo(200, 0);
    expect(page.lines[0].y).toBeCloseTo(100, 0);
    expect(row.height).toBeCloseTo(10, 5);
    expect(page.lines.map((l) => l.index)).toEqual([0, 1]);
  });

  it('regroups a table row the engine split into separate text lines', () => {
    const doc = ocrPagesToLayoutDoc([
      {
        width: 595,
        height: 842,
        scale: SCALE,
        words: [
          w('14/09/2025', 100, 400, 110, 5),
          w('SAMPLE SHOP', 300, 401, 190, 6), // another engine "line" (column), same visual row
          w('1,234.50', 800, 400, 120, 7),
          w('Next', 100, 460, 60, 8),
        ],
      },
    ]);
    expect(doc.pages[0].lines.map((l) => l.text)).toEqual(['14/09/2025 SAMPLE SHOP 1,234.50', 'Next']);
  });

  it('drops low-confidence specks, blank words and degenerate boxes', () => {
    const doc = ocrPagesToLayoutDoc([
      {
        width: 595,
        height: 842,
        scale: SCALE,
        words: [w('Real', 100, 100, 60, 0), w('|', 170, 100, 4, 0, 10), w('   ', 180, 100, 20, 0), { ...w('flat', 200, 100, 0, 0), x1: 200 }],
      },
    ]);
    expect(doc.pages[0].lines.map((l) => l.text)).toEqual(['Real']);
  });

  it('handles several pages and empty pages', () => {
    const doc = ocrPagesToLayoutDoc([
      { width: 595, height: 842, scale: SCALE, words: [w('One', 100, 100, 50, 0)] },
      { width: 595, height: 842, scale: SCALE, words: [] },
      { width: 595, height: 842, scale: SCALE, words: [w('Three', 100, 100, 70, 0)] },
    ]);
    expect(doc.pages.map((p) => [p.page, p.lines.length])).toEqual([
      [1, 1],
      [2, 0],
      [3, 1],
    ]);
    expect(doc.pages[2].lines[0].page).toBe(3);
  });
});
