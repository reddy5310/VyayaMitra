import type { ParsedStatement } from '@/domain/types';
import { storedFileName } from './fileName';

const parsed = { institution: 'SBI_CARD', accountType: 'credit_card', periodEnd: '2026-10-19', rows: [] } as unknown as ParsedStatement;

describe('storedFileName', () => {
  it('replaces a file name that contains the password', () => {
    expect(storedFileName('12345678abcd.pdf', '12345678abcd', parsed)).toBe('SBI Card card statement October 2026.pdf');
    expect(storedFileName('ASHA1203.PDF', 'asha1203', parsed)).toBe('SBI Card card statement October 2026.pdf');
    expect(storedFileName('statement-asha_1203 (1).pdf', 'ASHA1203', parsed)).toBe('SBI Card card statement October 2026.pdf');
  });
  it('keeps ordinary names', () => {
    expect(storedFileName('Statement_Oct2026.pdf', 'asha1203', parsed)).toBe('Statement_Oct2026.pdf');
    expect(storedFileName('Statement_Oct2026.pdf', undefined, parsed)).toBe('Statement_Oct2026.pdf');
  });
  it('ignores trivially short passwords', () => {
    expect(storedFileName('abc.pdf', 'abc', parsed)).toBe('abc.pdf');
  });
});
