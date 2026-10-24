import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBlankPdf, buildPdf, T, TR } from '../../../tests/fixtures/parsing/builders';
import { buildEncryptedPdf } from '../../../tests/fixtures/parsing/encrypted';
import { IncorrectPasswordError, PasswordRequiredError, ScannedPdfError } from '../errors';
import { extractLayout } from './extract';
import { setPdfjsLoader, type PdfjsModule } from './loader';
import { useLegacyPdfjsForNode } from './node';

beforeAll(() => useLegacyPdfjsForNode());
afterEach(() => useLegacyPdfjsForNode());

describe('extractLayout (real pdf.js on a synthetic PDF)', () => {
  it('reconstructs positioned lines with 1-based pages and x extents', async () => {
    const bytes = await buildPdf([
      {
        texts: [
          T(27, 100, 'DATE'),
          T(158, 100, 'PARTICULARS'),
          TR(505, 100, 'WITHDRAWALS'),
          T(27, 120, '03-06-2024'),
          T(158, 120, 'UPI/100000000001/Payment from'),
          TR(505, 120, '40,000.00'),
          T(158, 130, 'second line'),
        ],
      },
      { texts: [T(30, 50, 'page two')] },
    ]);
    const doc = await extractLayout(bytes);
    expect(doc.pages).toHaveLength(2);
    const [p1, p2] = doc.pages;
    expect(p1.page).toBe(1);
    expect(p2.page).toBe(2);
    // top-to-bottom order, items left to right
    expect(p1.lines.map((l) => l.text)).toEqual([
      'DATE PARTICULARS WITHDRAWALS',
      '03-06-2024 UPI/100000000001/Payment from 40,000.00',
      'second line',
    ]);
    expect(p1.lines.map((l) => l.index)).toEqual([0, 1, 2]);
    const amount = p1.lines[1].items[p1.lines[1].items.length - 1];
    expect(amount.text).toBe('40,000.00');
    expect(amount.x1).toBeCloseTo(505, 0);
    expect(amount.x0).toBeLessThan(amount.x1);
  });

  it('throws ScannedPdfError when no page has a text layer', async () => {
    await expect(extractLayout(await buildBlankPdf())).rejects.toBeInstanceOf(ScannedPdfError);
  });

  it('does not mutate or detach the caller bytes', async () => {
    const bytes = await buildPdf([{ texts: [T(30, 50, 'hello')] }]);
    const before = bytes.length;
    await extractLayout(bytes);
    expect(bytes.length).toBe(before);
    await extractLayout(bytes); // can be read twice
  });
});

describe('password handling', () => {
  const failing = (code: number): PdfjsModule => ({
    getDocument: () => ({
      promise: Promise.reject(Object.assign(new Error('No password given'), { name: 'PasswordException', code })),
    }),
  });

  it('maps pdf.js code 1 to PasswordRequiredError', async () => {
    setPdfjsLoader(async () => failing(1));
    await expect(extractLayout(new Uint8Array([1]))).rejects.toBeInstanceOf(PasswordRequiredError);
  });

  it('maps pdf.js code 2 to IncorrectPasswordError', async () => {
    setPdfjsLoader(async () => failing(2));
    await expect(extractLayout(new Uint8Array([1]), { password: 'nope' })).rejects.toBeInstanceOf(IncorrectPasswordError);
  });

  it('passes the password through and always disables eval', async () => {
    let seen: Record<string, unknown> | undefined;
    setPdfjsLoader(async () => ({
      getDocument: (src) => {
        seen = src;
        return { promise: Promise.reject(Object.assign(new Error('x'), { name: 'PasswordException', code: 2 })) };
      },
    }));
    await expect(extractLayout(new Uint8Array([1]), { password: 'secret' })).rejects.toBeInstanceOf(IncorrectPasswordError);
    expect(seen?.password).toBe('secret');
    expect(seen?.isEvalSupported).toBe(false);
  });

  it('lets other pdf.js errors through unchanged', async () => {
    setPdfjsLoader(async () => ({ getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }) }));
    await expect(extractLayout(new Uint8Array([1]))).rejects.toThrow('Invalid PDF structure');
  });
});

describe('password-protected PDF (real pdf.js, RC4 test file)', () => {
  const bytes = buildEncryptedPdf('Secret#1', 'Encrypted statement 100.00');

  it('asks for a password when none is given', async () => {
    await expect(extractLayout(bytes)).rejects.toBeInstanceOf(PasswordRequiredError);
  });

  it('reports a wrong password as incorrect', async () => {
    await expect(extractLayout(bytes, { password: 'wrong' })).rejects.toBeInstanceOf(IncorrectPasswordError);
  });

  it('opens with the right password', async () => {
    const doc = await extractLayout(bytes, { password: 'Secret#1' });
    expect(doc.pages[0].lines[0].text).toBe('Encrypted statement 100.00');
  });
});
