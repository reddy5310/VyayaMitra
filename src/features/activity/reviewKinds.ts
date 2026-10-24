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

/** The row's numbers were inferred rather than read: OCR text, or a direction worked out from the balance. */
export function isEstimated(t: Pick<Transaction, 'reasons' | 'reviewReasons'>): boolean {
  return [...t.reasons, ...t.reviewReasons].some((r) => /\bocr\b|from the (running )?balance|direction.*balance/i.test(r));
}

/** The user made (or remembered) the decision rather than the built-in rules. */
export function isUserDecided(t: Pick<Transaction, 'categorySource' | 'kindSource'>): boolean {
  return t.categorySource === 'user_txn' || t.categorySource === 'user_rule' || t.kindSource === 'user' || t.kindSource === 'user_rule';
}
