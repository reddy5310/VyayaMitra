import { describe, expect, it } from 'vitest';
import { makeAccount, makeStatement, makeTxn } from '../activity/testUtils';
import { CSV_BOM, CSV_HEADERS, csvFilename, csvText, paiseToCsvNumber, transactionsToCsv } from './csv';

const accounts = [makeAccount()];

function rows(csv: string): string[] {
  return csv.slice(CSV_BOM.length).split('\r\n').filter(Boolean);
}

describe('csv', () => {
  it('starts with a UTF-8 BOM, uses CRLF and the documented header', () => {
    const csv = transactionsToCsv([makeTxn()], { accounts });
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('\r\n');
    expect(rows(csv)[0]).toBe(CSV_HEADERS.join(','));
    expect(CSV_HEADERS).toHaveLength(15);
  });

  it('doubles quotes and quotes cells containing commas or newlines', () => {
    expect(csvText('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvText('line1\nline2')).toBe('"line1\nline2"');
    expect(csvText('plain')).toBe('plain');
  });

  it('neutralises formula injection in text cells', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvText('+91 98')).toBe("'+91 98");
    expect(csvText('-5 OFF')).toBe("'-5 OFF");
    expect(csvText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvText('\tTAB')).toBe("'\tTAB");
    expect(csvText('\rCR')).toBe('"\'\rCR"');
  });

  it('prefixes dangerous descriptions and merchants in the generated rows', () => {
    const csv = transactionsToCsv([makeTxn({ rawDescription: '=cmd|calc', merchant: '@evil' })], { accounts });
    const line = rows(csv)[1];
    expect(line).toContain("'=cmd|calc");
    expect(line).toContain("'@evil");
  });

  it('writes amounts as signed plain numbers with two decimals, unprefixed', () => {
    expect(paiseToCsvNumber(-125_050)).toBe('-1250.50');
    expect(paiseToCsvNumber(5)).toBe('0.05');
    expect(paiseToCsvNumber(-5)).toBe('-0.05');
    const csv = transactionsToCsv(
      [
        makeTxn({ amount: 125_050, direction: 'debit', balanceAfter: 1_000_000 }),
        makeTxn({ amount: 99, direction: 'credit', balanceAfter: -2_500 }),
      ],
      { accounts },
    );
    const [, a, b] = rows(csv);
    const cellsA = a.split(',');
    expect(cellsA[7]).toBe('-1250.50');
    expect(cellsA[8]).toBe('10000.00');
    const cellsB = b.split(',');
    expect(cellsB[7]).toBe('0.99');
    expect(cellsB[8]).toBe('-25.00');
  });

  it('fills labels, account name, statement file and page', () => {
    const csv = transactionsToCsv([makeTxn({ needsReview: true })], { accounts, statements: [makeStatement()] });
    const line = rows(csv)[1];
    expect(line).toContain('Demo Savings ••1234');
    expect(line).toContain('Spending');
    expect(line).toContain('Groceries');
    expect(line).toContain('Yes');
    expect(line).toContain('demo-statement.pdf');
    expect(line.endsWith(',1')).toBe(true);
  });

  it('builds the download filename from the period', () => {
    expect(csvFilename('2025-09-01', '2025-09-30')).toBe('vyayamitra-transactions-2025-09-01-to-2025-09-30.csv');
  });
});
