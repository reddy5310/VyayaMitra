/**
 * CONTRACT — owned by the transaction-intelligence module.
 * Understands ONE transaction: channel, counterparty, merchant, kind, category, confidence, reasons.
 * Pure and synchronous. No I/O.
 */
import type {
  Account,
  CategorySource,
  Channel,
  Counterparty,
  CustomCategory,
  Direction,
  IsoDate,
  ChargeType,
  FeedbackEvent,
  KindSource,
  Paise,
  Transaction,
  TxnKind,
  UserRule,
} from '@/domain/types';
import { trainModel } from './learned';
import { understandTransaction } from './pipeline';
import { buildCalibration as buildCalibrationImpl, prioritise, suggest, type SuggestionHistory } from './selftrain';
import { ruleMatches as ruleMatchesImpl } from './rules';
import { normalizeMerchantKey as normalizeMerchantKeyImpl } from './text';

export interface UnderstandInput {
  description: string;
  amount: Paise;
  direction: Direction;
  date: IsoDate;
  reference?: string;
  balanceAfter?: Paise;
  /** Issuer-printed merchant category (strong hint when present). */
  bankCategory?: string;
}

export interface UnderstandContext {
  /** The account the row belongs to (may be a provisional, not-yet-saved account during import preview). */
  account: Account;
  /** All of the user's accounts (masks + holder names enable self-transfer detection). */
  ownAccounts: readonly Account[];
  /** User rules; applied before any built-in knowledge. */
  rules: readonly UserRule[];
  /** Model trained only on the user's own confirmed categorisations. */
  learned?: LearnedModel | null;
  /** Per-source accuracy learned from the user's feedback; adjusts confidences. */
  calibration?: Calibration | null;
  /** p2p_out at or above this amount gets needsReview. */
  p2pReviewThreshold: Paise;
  customCategories?: readonly CustomCategory[];
}

export interface Understanding {
  channel: Channel;
  counterparty: Counterparty;
  merchant: string;
  merchantKey: string;
  reference?: string;
  kind: TxnKind;
  kindSource: KindSource;
  category: string;
  categorySource: CategorySource;
  confidence: number;
  reasons: string[];
  needsReview: boolean;
  reviewReasons: string[];
  /** Structured fee subtype for kind 'fee' rows (and their reversals). */
  chargeType?: ChargeType;
}

/** Serializable on-device model. Shape is private to the module; persist it as opaque JSON. */
export interface LearnedModel {
  /** 1 = word tokens only (still readable); 2 = memory + words, 3-grams, handle, amount, direction. */
  version: 1 | 2;
  trainedAt: string;
  exampleCount: number;
  [key: string]: unknown;
}

export interface LearningExample {
  /** Raw description of a transaction whose category the user confirmed. */
  text: string;
  merchantKey: string;
  category: string;
  /** UPI handle of the transaction, when it had one (exact memory + handle features). */
  vpa?: string;
  /** Amount in paise (amount-bucket feature). */
  amount?: Paise;
  direction?: Direction;
}

export function understand(input: UnderstandInput, ctx: UnderstandContext): Understanding {
  return understandTransaction(input, ctx);
}

/** Returns null when there are too few examples to learn anything useful. */
export function trainLearnedModel(examples: readonly LearningExample[]): LearnedModel | null {
  return trainModel(examples);
}

/** Does a user rule apply to this (already understood) transaction? */
export function ruleMatches(
  rule: UserRule,
  txn: {
    accountId: string;
    direction: Direction;
    merchantKey: string;
    counterparty: Counterparty;
    rawDescription: string;
  },
): boolean {
  return ruleMatchesImpl(rule, txn);
}

/** Canonical merchant key from a display name or raw fragment ("Amazon I ndia IN" → "amazon india"). */
export function normalizeMerchantKey(text: string): string {
  return normalizeMerchantKeyImpl(text);
}

export { DICTIONARY_SIZE } from './brands';
export { cleanMerchantText, repairFragments } from './text';
export { isLearnedModelUsable } from './learned';

// ─── Self-training (wave 2) ──────────────────────────────────────────────────

/** Serializable per-source / per-category accuracy derived from FeedbackEvents. Shape private to the module. */
export interface Calibration {
  version: 1;
  builtAt: string;
  eventCount: number;
  [key: string]: unknown;
}

/** Rebuild calibration from the full feedback history (cheap; call after each correction). */
export function buildCalibration(events: readonly FeedbackEvent[]): Calibration | null {
  return buildCalibrationImpl(events);
}

export interface CategorySuggestion {
  category: string;
  /** 0..1 */
  probability: number;
  source: 'user_rule' | 'learned' | 'builtin_rule' | 'similar_merchant' | 'kind_default';
  reason: string;
}

/** Best k categories for a transaction (for one-tap review chips). Never returns the same category twice. */
export function suggestCategories(
  txn: Pick<Transaction, 'rawDescription' | 'merchantKey' | 'merchant' | 'counterparty' | 'direction' | 'amount' | 'kind' | 'accountId'>,
  ctx: UnderstandContext,
  k = 3,
  /** Optional slice of the user's ledger; lets weak cases fall back to what the user usually does. */
  history?: SuggestionHistory,
): CategorySuggestion[] {
  return suggest(txn, ctx, k, history);
}

export interface ReviewItem {
  txnId: string;
  /** Higher = review first. */
  score: number;
  /** How many other needs-review transactions share this merchant/VPA (teaching this one fixes them too). */
  sameMerchantCount: number;
  reason: string;
}

/** Order needs-review transactions so teaching one decision fixes the most money and rows. */
export function reviewPriority(txns: readonly Transaction[]): ReviewItem[] {
  return prioritise(txns);
}

export type { SuggestionHistory } from './selftrain';
