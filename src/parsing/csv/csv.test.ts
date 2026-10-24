import { describe, expect, it } from 'vitest';
import { UnsupportedStatementError } from '../errors';
import { parseCsvTable } from '../registry';
import { decodeCsvBytes, readCsv } from './readCsv';

const ctx = { fileName: 'export.csv' };
const parse = (text: string, fileName = 'export.csv') => parseCsvTable(readCsv(text), { fileName });

describe('readCsv (RFC 4180)', () => {
  it('handles quoted fields with commas, doubled quotes and embedded newlines', () => {
    const t = readCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3\r\n');
    expect(t.records).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });

  it('copes with LF, CR and CRLF records, a missing final newline and blank lines', () => {
    expect(readCsv('a,b\n1,2\n\n3,4').records).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    expect(readCsv('a,b\r1,2\r').records).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty fields', () => {
    expect(readCsv('a,,c\n,,\n1,,').records).toEqual([['a', '', 'c'], ['1', '', '']]);
  });

  it('sniffs semicolon and tab delimiters', () => {
    expect(readCsv('a;b;c\n1;2;3').records[1]).toEqual(['1', '2', '3']);
    expect(readCsv('a\tb\n1\t2').records[1]).toEqual(['1', '2']);
    // commas inside quotes do not decide the delimiter
    expect(readCsv('"a,b,c";d\n1;2').records[0]).toEqual(['a,b,c', 'd']);
  });

  it('strips a UTF-8 BOM and falls back to Windows-1252', () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Date,Amount\n')]);
    expect(decodeCsvBytes(bom)).toBe('Date,Amount\n');
    const latin = Uint8Array.from([0x44, 0x61, 0x74, 0x65, 0x2c, 0x43, 0x61, 0x66, 0xe9]); // "Date,Café" in cp1252
    expect(decodeCsvBytes(latin)).toBe('Date,Café');
  });
});

describe('CSV statement parser', () => {
  it('reads the legacy SmartSpend export exactly, with quoting and rupee floats as text', () => {
    const csv = [
      'Date,Description,Category,Type,Amount,Confidence,Source File',
      '2024-06-03,"Swiggy, Bangalore",Food,DEBIT,450.5,92%,june.pdf',
      '2024-06-04,"UPI/100000000001 ""Payment"" from Asha",Income,CREDIT,5000.0,40%,june.pdf',
      '2024-06-05,Book shop,Shopping,DEBIT,19.990000000000002,88%,june.pdf',
      '2024-06-06,Interest,Interest,CREDIT,0.07,95%,june.pdf',
      '',
    ].join('\r\n');
    const st = parse(csv);
    expect(st.parserId).toBe('csv');
    expect(st.institution).toBe('OTHER');
    expect(st.accountType).toBe('savings');
    expect(st.rows.map((r) => [r.date, r.direction, r.amount, r.description])).toEqual([
      ['2024-06-03', 'debit', 45_050, 'Swiggy, Bangalore'],
      ['2024-06-04', 'credit', 500_000, 'UPI/100000000001 "Payment" from Asha'],
      ['2024-06-05', 'debit', 1_999, 'Book shop'],
      ['2024-06-06', 'credit', 7, 'Interest'],
    ]);
    expect(st.rows[0].source).toMatchObject({ page: 1, lineStart: 1, lineEnd: 1 });
    expect(st.rows[0].warnings).toEqual([]);
    expect(st.detection.confidence).toBeGreaterThan(0.9);
    expect(st.reconciliation.status).toBe('unverified');
  });

  it('finds the header after preamble rows and reads separate debit / credit columns', () => {
    const csv = [
      'Account Statement',
      'Account No,XXXXXX1234',
      '',
      'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '01/04/2024,"UPI-EXAMPLE, SHOP",0000409000000001,"1,250.00",,"8,750.00"',
      '02/04/2024,SALARY EXAMPLE,N0924,,"20,000.00","28,750.00"',
    ].join('\n');
    const st = parse(csv);
    expect(st.rows).toHaveLength(2);
    expect(st.rows[0]).toMatchObject({ direction: 'debit', amount: 125_000, balanceAfter: 875_000, reference: '0000409000000001' });
    expect(st.rows[1]).toMatchObject({ direction: 'credit', amount: 2_000_000, balanceAfter: 2_875_000 });
    expect(st.reconciliation.status).toBe('balanced');
  });

  it('reads direction from a Type column in several spellings', () => {
    const csv = ['Date,Description,Type,Amount', '2024-06-01,a,Dr,10.00', '2024-06-02,b,Cr,20.00', '2024-06-03,c,Withdrawal,30.00', '2024-06-04,d,Deposit,40.00'].join('\n');
    expect(parse(csv).rows.map((r) => r.direction)).toEqual(['debit', 'credit', 'debit', 'credit']);
  });

  it('reads a signed single amount column: negative is money out', () => {
    const csv = ['Date,Description,Amount', '2024-06-01,Shop,-250.00', '2024-06-02,Salary,"10,000.00"', '2024-06-03,Shop two,(75.50)'].join('\n');
    const st = parse(csv);
    expect(st.rows.map((r) => [r.direction, r.amount])).toEqual([
      ['debit', 25_000],
      ['credit', 1_000_000],
      ['debit', 7_550],
    ]);
  });

  it('flags ambiguous_amount instead of assuming when nothing says debit or credit', () => {
    const st = parse(['Date,Description,Amount', '2024-06-01,Shop,250.00', '2024-06-02,Salary,"10,000.00"'].join('\n'));
    expect(st.rows).toHaveLength(2);
    for (const r of st.rows) expect(r.warnings).toContain('ambiguous_amount');
    expect(st.reconciliation.status).toBe('mismatch');
  });

  it('uses the running balance to decide an unsigned amount', () => {
    const csv = ['Date,Description,Amount,Balance', '2024-06-01,Open,100.00,1000.00', '2024-06-02,Spend,50.00,950.00', '2024-06-03,Refund,25.00,975.00'].join('\n');
    const st = parse(csv);
    expect(st.rows[1].direction).toBe('debit');
    expect(st.rows[2].direction).toBe('credit');
    expect(st.rows[1].warnings).not.toContain('ambiguous_amount');
  });

  it('reports rows it cannot read in skipped and keeps the good ones', () => {
    const csv = ['Date,Description,Type,Amount', '2024-06-01,ok,DEBIT,10.00', 'not a date,bad date,DEBIT,11.00', '2024-06-03,bad amount,DEBIT,12 rupees', '2024-06-04,fine,CREDIT,13.00'].join('\n');
    const st = parse(csv);
    expect(st.rows).toHaveLength(2);
    expect(st.skipped.map((s) => s.line)).toEqual([2, 3]);
    expect(st.warnings.join(' ')).toMatch(/could not be turned into transactions/);
  });

  it('takes the account type from the file name when it says so', () => {
    const csv = 'Date,Description,Type,Amount\n2024-06-01,x,DEBIT,10.00';
    expect(parse(csv, 'my-credit-card-june.csv').accountType).toBe('credit_card');
    expect(parse(csv, 'current_account.csv').accountType).toBe('current');
    expect(parse(csv, 'export.csv').accountType).toBe('savings');
  });

  it('refuses a CSV that is not a transaction list, and one with a header but no rows', () => {
    expect(() => parseCsvTable(readCsv('name,city\nAsha,Pune'), ctx)).toThrow(UnsupportedStatementError);
    expect(() => parseCsvTable(readCsv('Date,Description,Type,Amount\n'), ctx)).toThrow(UnsupportedStatementError);
  });
});
