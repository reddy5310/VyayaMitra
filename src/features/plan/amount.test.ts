import { describe, expect, it } from 'vitest';
import { paiseToInput, parseRupeeInput } from './amount';

describe('parseRupeeInput', () => {
  it('converts rupees with Indian grouping to exact paise', () => {
    expect(parseRupeeInput('1,250.50')).toEqual({ ok: true, paise: 125050 });
    expect(parseRupeeInput('1,50,000')).toEqual({ ok: true, paise: 15_000_000 });
    expect(parseRupeeInput(' ₹ 400 ')).toEqual({ ok: true, paise: 40000 });
    expect(parseRupeeInput('0.1')).toEqual({ ok: true, paise: 10 });
  });

  it('is exact where float math is not (19.99, 1.15)', () => {
    expect(parseRupeeInput('19.99')).toEqual({ ok: true, paise: 1999 });
    expect(parseRupeeInput('1.15')).toEqual({ ok: true, paise: 115 });
  });

  it('rejects empty, zero, negative and malformed input', () => {
    expect(parseRupeeInput('')).toMatchObject({ ok: false });
    expect(parseRupeeInput('0')).toEqual({ ok: false, error: 'Amount must be more than ₹0.' });
    expect(parseRupeeInput('0.00')).toMatchObject({ ok: false });
    expect(parseRupeeInput('-5')).toMatchObject({ ok: false });
    expect(parseRupeeInput('12.345')).toMatchObject({ ok: false });
    expect(parseRupeeInput('abc')).toMatchObject({ ok: false });
  });
});

describe('paiseToInput', () => {
  it('round-trips without float math', () => {
    expect(paiseToInput(125050)).toBe('1250.50');
    expect(paiseToInput(400000)).toBe('4000');
    expect(paiseToInput(5)).toBe('0.05');
  });
});
