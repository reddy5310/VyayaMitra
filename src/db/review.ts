/**
 * CONTRACT — owned by the ledger module (wave 7: review workspace).
 * Tags, insight feedback, month-end reviews, merchant aliases and per-transaction history.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import type { ExpenseTag, FeedbackEvent, InsightFeedback, MonthKey, MonthReview, Transaction } from '@/domain/types';
import { normalizeMerchantKey } from '@/engine/understand';
import { newId, nowTimestamp } from '@/lib/ids';
import { REASON_RENAMED, decisionSnapshot, recordFeedback } from './ledger';
import { loadSelected, upsertRule, type CorrectionResult } from './actions';
import { db, writeAll } from './db';
import { ValidationError, requireName, requireOneOf } from './validation';

const TAGS: readonly ExpenseTag[] = ['planned', 'exceptional', 'reimbursable'];
const INSIGHT_ACTIONS: readonly InsightFeedback['action'][] = ['dismissed', 'expected', 'irrelevant'];

/** Tag (or untag with null) one or more transactions as planned / exceptional / reimbursable. Records feedback; undoable. */
export async function setTransactionsTag(txnIds: string[], tag: ExpenseTag | null): Promise<void> {
  if (tag !== null) requireOneOf(tag, TAGS, 'Tag');
  await writeAll(async () => {
    const txns = await loadSelected(txnIds);
    const changed = txns.filter((t) => (t.tag ?? null) !== tag);
    if (changed.length === 0) return;
    const now = nowTimestamp();
    await db.transactions.bulkPut(
      changed.map((t) => {
        const next: Transaction = { ...t, updatedAt: now };
        if (tag) next.tag = tag;
        else delete next.tag;
        return next;
      }),
    );
    await recordFeedback(
      changed.map((t) => ({
        txn: t,
        action: 'tag' as const,
        scope: 'this' as const,
        before: decisionSnapshot(t),
        after: { kind: t.kind, category: t.category },
      })),
    );
  });
}

function requireKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new ValidationError(`${label} is not valid.`);
  return value.trim();
}

/** One mark per insight key: marking again replaces the previous mark. */
export async function recordInsightFeedback(input: {
  key: string;
  insightId: string;
  action: InsightFeedback['action'];
}): Promise<void> {
  const key = requireKey(input.key, 'Insight');
  const insightId = requireKey(input.insightId, 'Insight');
  const action = requireOneOf(input.action, INSIGHT_ACTIONS, 'Action');
  await writeAll(async () => {
    await db.insightFeedback.where('key').equals(key).delete();
    await db.insightFeedback.add({ id: newId(), key, insightId, action, at: nowTimestamp() });
  });
}

/** Undo a dismissal / expected / irrelevant mark. */
export async function clearInsightFeedback(id: string): Promise<void> {
  await db.insightFeedback.delete(id);
}

export function useInsightFeedback(): InsightFeedback[] | undefined {
  return useLiveQuery(() => db.insightFeedback.orderBy('at').toArray(), []);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function saveMonthReview(review: Omit<MonthReview, 'updatedAt'>): Promise<void> {
  if (typeof review.month !== 'string' || !MONTH_RE.test(review.month)) {
    throw new ValidationError('Month must look like 2025-09.');
  }
  const status = requireOneOf<MonthReview['status']>(review.status, ['in_progress', 'completed'], 'Status');
  if (!Array.isArray(review.notes) || review.notes.length > 50) throw new ValidationError('A review can hold up to 50 notes.');
  const notes = review.notes.map((n) => requireName(n, 'Note', 500));
  if (!Array.isArray(review.nextActionIds)) throw new ValidationError('Next actions are not valid.');
  const nextActionIds = [...new Set(review.nextActionIds.map((id) => requireKey(id, 'Action')))];
  const now = nowTimestamp();
  const record: MonthReview = { month: review.month, status, notes, nextActionIds, updatedAt: now };
  if (status === 'completed') record.completedAt = review.completedAt ?? now;
  await db.monthReviews.put(record);
}

/** Oldest month first. */
export function useMonthReviews(): MonthReview[] | undefined {
  return useLiveQuery(() => db.monthReviews.orderBy('month').toArray(), []);
}

/**
 * Merchant alias: group several merchantKeys under one merchant (name + key). Creates/updates user rules with
 * set.merchantKey/set.merchant for each source key and re-understands the affected rows. Reversible via deleteRule.
 * Rows are updated directly (a per-transaction rename keeps its own display name), so the result does not depend
 * on when understanding next runs; a later reprocess derives the same values from the rules.
 */
export async function mergeMerchants(
  sourceKeys: string[],
  target: { merchantKey: string; name: string },
): Promise<CorrectionResult> {
  if (!Array.isArray(sourceKeys)) throw new ValidationError('Choose the merchants to combine.');
  const name = requireName(target?.name, 'Merchant name');
  const targetKey = normalizeMerchantKey(requireKey(target?.merchantKey, 'Merchant'));
  if (!targetKey) throw new ValidationError('Merchant is not valid.');
  const sources = [...new Set(sourceKeys.map((k) => requireKey(k, 'Merchant').toLowerCase()))].filter((k) => k !== targetKey);
  if (sources.length === 0) throw new ValidationError('Choose at least one other merchant to combine.');

  return writeAll(async () => {
    let firstRuleId: string | undefined;
    for (const source of sources) {
      const rule = await upsertRule({ field: 'merchantKey', op: 'equals', value: source }, { merchantKey: targetKey, merchant: name });
      firstRuleId ??= rule.id;
    }
    const wanted = new Set(sources);
    const rows = (await db.transactions.toArray()).filter((t) => wanted.has(t.merchantKey.toLowerCase()));
    const now = nowTimestamp();
    await db.transactions.bulkPut(
      rows.map((t) => ({
        ...t,
        merchantKey: targetKey,
        merchant: t.reasons.includes(REASON_RENAMED) ? t.merchant : name,
        updatedAt: now,
      })),
    );
    return { updated: rows.length, ruleId: firstRuleId };
  });
}

/** Correction history for one transaction (oldest first). */
export function useTransactionHistory(txnId: string | undefined): FeedbackEvent[] | undefined {
  return useLiveQuery(async () => (txnId ? db.feedback.where('txnId').equals(txnId).sortBy('at') : []), [txnId]);
}

export type { MonthKey };
