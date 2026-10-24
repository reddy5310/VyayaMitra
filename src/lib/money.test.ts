import { formatINR, parseAmountToPaise } from './money';
import { addMonths, daysBetween, monthEnd, parseStatementDate } from './dates';

describe('money', () => {
  it('parses Indian grouped amounts to exact paise', () => {
    expect(parseAmountToPaise('1,27,102.63')).toBe(12710263);
    expect(parseAmountToPaise('`23,273.56')).toBe(2327356);
    expect(parseAmountToPaise('1,657.82 CR')).toBe(165782);
    expect(parseAmountToPaise('(500.00)')).toBe(-50000);
    expect(parseAmountToPaise('0.10')).toBe(10);
  });
  it('rejects reference numbers when decimals are required', () => {
    expect(parseAmountToPaise('123456', { requireDecimals: true })).toBeNull();
    expect(parseAmountToPaise('5550001234', { requireDecimals: true })).toBeNull();
    expect(parseAmountToPaise('100.00', { requireDecimals: true })).toBe(10000);
  });
  it('formats with Indian grouping', () => {
    expect(formatINR(12710263)).toBe('₹1,27,102.63');
    expect(formatINR(-4298)).toBe('−₹42.98');
  });
});

describe('dates', () => {
  it('parses statement formats day-first', () => {
    expect(parseStatementDate('03-06-2024')).toBe('2024-06-03');
    expect(parseStatementDate('28/06/2024')).toBe('2024-06-28');
    expect(parseStatementDate('14-Sep-2025')).toBe('2025-09-14');
    expect(parseStatementDate('June 03, 2024')).toBe('2024-06-03');
    expect(parseStatementDate('31-02-2024')).toBeNull();
  });
  it('does calendar arithmetic without timezone drift', () => {
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(addMonths('2024-12', 1)).toBe('2025-01');
    expect(daysBetween('2025-10-01', '2025-10-31')).toBe(30);
  });
});
