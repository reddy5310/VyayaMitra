import type { Transaction } from '@/domain/types';

/**
 * Review reasons that mean "the AMOUNT, DIRECTION or DATE may be misread" rather than "the category is unsure".
 * Transactions carry these only as text in `reviewReasons`, so the match is on wording.
 */
const EXTRACTION = /balance|amount|direction|outside|period|ambiguous|debit or credit|misread/i;

export function isExtractionIssue(t: Pick<Transaction, 'needsReview' | 'reviewReasons'>): boolean {
  return t.needsReview && t.reviewReasons.some((r) => EXTRACTION.test(r));
}

/** Decisions are grouped by UPI id when there is one, otherwise by merchant. */
export function groupKey(t: Pick<Transaction, 'counterparty' | 'merchantKey'>): string {
  return t.counterparty.vpa ? `vpa:${t.counterparty.vpa}` : `m:${t.merchantKey}`;
}
