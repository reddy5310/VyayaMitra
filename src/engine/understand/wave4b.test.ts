import { describe, expect, it } from 'vitest';
import { understand } from './index';
import type { Account } from '@/domain/types';

const card: Account = { id: 'c1', name: 'Card', institution: 'OTHER', type: 'credit_card', currency: 'INR', createdAt: '2026-01-01T00:00:00Z' };
const ctx = { account: card, ownAccounts: [card], rules: [], p2pReviewThreshold: 500_000 };
const run = (description: string, direction: 'debit' | 'credit' = 'debit') =>
  understand({ description, amount: 100_000, direction, date: '2026-09-01' }, ctx);

describe('card descriptor clean-up (wave 4b)', () => {
  it('reads "PYM FROM OTH BANK" credits as a card bill payment', () => {
    expect(run('PAYU PYM FROM OTH BANK-20260830000000001', 'credit').kind).toBe('card_payment');
  });
  it('strips an IAP lead-in before a gateway tag', () => {
    const u = run('IAP CAS*SAMPLE STORES BANGALORE');
    expect(u.merchant.toLowerCase()).not.toContain('iap');
    expect(u.reasons.join(' ')).toMatch(/Cashfree/);
  });
  it('drops a trailing IND country code and stray asterisks', () => {
    expect(run('RAZ*Sample Traders IND').merchant).not.toMatch(/\bInd\b/i);
    expect(run('SOME SAAS INC *').merchant).not.toMatch(/\*/);
  });
});
