import { landingMonth } from './landing';

function preview(periodStart: string | undefined, periodEnd: string | undefined, rowDates: string[]) {
  return {
    parsed: { periodStart, periodEnd } as never,
    rows: rowDates.map((date) => ({ row: { date } })) as never,
  };
}

describe('landingMonth', () => {
  it('ignores rows dated just outside a one-month statement period', () => {
    expect(landingMonth(preview('2025-09-01', '2025-09-30', ['2025-08-31', '2025-09-15', '2025-10-01']))).toBe('2025-09');
  });
  it('picks the latest fully covered month of a multi-month statement', () => {
    expect(landingMonth(preview('2024-06-03', '2024-12-03', ['2024-06-03', '2024-12-03']))).toBe('2024-11');
  });
  it('falls back to the month a card cycle ends in', () => {
    expect(landingMonth(preview('2024-06-21', '2024-07-20', ['2024-06-22', '2024-07-19']))).toBe('2024-07');
  });
  it('uses row dates when the statement prints no period', () => {
    expect(landingMonth(preview(undefined, undefined, ['2025-03-01', '2025-03-31']))).toBe('2025-03');
  });
  it('returns null for an empty preview', () => {
    expect(landingMonth(preview(undefined, undefined, []))).toBeNull();
  });
});
