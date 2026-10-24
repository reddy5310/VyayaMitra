import type { FeedbackEvent, IsoDate, MonthKey, StatementTemplate, Transaction } from '@/domain/types';
import { addMonths, monthKey } from '@/lib/dates';
import type { LearningStats } from './index';

const AUTO_CONFIDENCE = 0.6;

/** A decision the user did not make themselves (rule, model or kind default), as it stood before they acted. */
function wasAutomatic(e: FeedbackEvent): boolean {
  const b = e.before;
  return b.categorySource !== 'user_txn' && b.categorySource !== 'user_rule' && b.kindSource !== 'user' && b.kindSource !== 'user_rule';
}

/**
 * How well VyayaMitra is understanding the user's statements, and how much teaching helped.
 *
 * - autoUnderstoodShare: rows with confidence >= 0.6 that do not need review, over all rows.
 * - corrections: feedback events that changed something (category, kind or merchant).
 * - accuracyTrend: one point per month from the first feedback event to today's month, by the month
 *   the user gave feedback. Each transaction counts once per month (its last event). A "decision"
 *   is an automatic one the user looked at; it is accurate when the user confirmed it and did not
 *   change it. accuracy is null in a month with no such decision.
 * - topTaught: merchants whose rows are now decided by one of the user's rules (not one-off edits).
 */
export function learningStats(
  txns: readonly Transaction[],
  ctx: { feedback: readonly FeedbackEvent[]; rules: readonly { id: string }[]; templates: readonly StatementTemplate[]; today: IsoDate },
): LearningStats {
  const bySource: Record<string, number> = {};
  let auto = 0;
  let needsReview = 0;
  const taught = new Map<string, { merchant: string; rows: number; latest: string }>();
  for (const t of txns) {
    bySource[t.categorySource] = (bySource[t.categorySource] ?? 0) + 1;
    if (t.needsReview) needsReview++;
    if (t.confidence >= AUTO_CONFIDENCE && !t.needsReview) auto++;
    if (t.categorySource === 'user_rule' || t.kindSource === 'user_rule') {
      const key = t.merchantKey || t.counterparty.vpa || t.merchant;
      const cur = taught.get(key);
      if (!cur) taught.set(key, { merchant: t.merchant, rows: 1, latest: t.date });
      else {
        cur.rows++;
        if (t.date >= cur.latest) {
          cur.latest = t.date;
          cur.merchant = t.merchant;
        }
      }
    }
  }

  const templates = { total: ctx.templates.length, auto: 0, user: 0, imported: 0 };
  for (const tpl of ctx.templates) templates[tpl.source]++;

  const corrections = ctx.feedback.filter((e) => e.action === 'category' || e.action === 'kind' || e.action === 'merchant').length;

  // Latest event per transaction per month.
  const perMonth = new Map<MonthKey, Map<string, FeedbackEvent>>();
  for (const e of ctx.feedback) {
    if (e.action === 'reset') continue;
    const m = monthKey(e.at.slice(0, 10));
    let byTxn = perMonth.get(m);
    if (!byTxn) perMonth.set(m, (byTxn = new Map()));
    const prev = byTxn.get(e.txnId);
    if (!prev || e.at >= prev.at) byTxn.set(e.txnId, e);
  }
  const accuracyTrend: LearningStats['accuracyTrend'] = [];
  if (ctx.feedback.length > 0) {
    const months = [...perMonth.keys(), ...ctx.feedback.map((e) => monthKey(e.at.slice(0, 10)))].sort();
    const first = months[0];
    const last = monthKey(ctx.today) > months[months.length - 1] ? monthKey(ctx.today) : months[months.length - 1];
    for (let m = first; m <= last; m = addMonths(m, 1)) {
      const events = [...(perMonth.get(m)?.values() ?? [])].filter(wasAutomatic);
      const changed = events.filter((e) => e.action !== 'confirm').length;
      accuracyTrend.push({
        month: m,
        accuracy: events.length > 0 ? Math.round(((events.length - changed) / events.length) * 1000) / 1000 : null,
        corrections: changed,
        decisions: events.length,
      });
    }
  }

  const topTaught = [...taught.entries()]
    .map(([merchantKey, v]) => ({ merchantKey, merchant: v.merchant, rows: v.rows }))
    .sort((a, b) => b.rows - a.rows || a.merchantKey.localeCompare(b.merchantKey))
    .slice(0, 10);

  return {
    totalTransactions: txns.length,
    autoUnderstoodShare: txns.length > 0 ? auto / txns.length : 0,
    needsReview,
    bySource,
    rules: ctx.rules.length,
    templates,
    corrections,
    accuracyTrend,
    topTaught,
  };
}
