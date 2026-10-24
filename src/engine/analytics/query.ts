import type { Transaction } from '@/domain/types';
import { metricBucket } from '@/domain/kinds';
import type { LedgerQuery } from './index';

/** Parse a search token as an amount in paise: "1,250", "₹1250", "1250.5". Null when not an amount. */
function tokenAmount(token: string): { paise: number; hasDecimals: boolean } | null {
  const clean = token.replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac] = clean.split('.');
  const paise = Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
  return Number.isSafeInteger(paise) ? { paise, hasDecimals: frac !== undefined } : null;
}

function haystack(t: Transaction): string {
  return [t.merchant, t.rawDescription, t.counterparty.name, t.counterparty.vpa, t.note, t.reference]
    .filter((x): x is string => !!x)
    .join('\n')
    .toLowerCase();
}

/**
 * Search semantics: the query is split on whitespace and EVERY token must match
 * (merchant / description / counterparty name or VPA / note / reference text, or the amount).
 * An amount token without decimals ("1250", "1,250") matches ₹1,250.00 and any ₹1,250.xx;
 * with decimals ("1250.50") it must match exactly.
 */
function matchesSearch(t: Transaction, tokens: string[], text: string): boolean {
  return tokens.every((tok) => {
    if (text.includes(tok)) return true;
    const amt = tokenAmount(tok);
    if (!amt) return false;
    return amt.hasDecimals ? t.amount === amt.paise : Math.floor(t.amount / 100) === amt.paise / 100;
  });
}

/**
 * The single filter contract used by every list, summary, chart and report.
 * All criteria are AND-ed; omitted criteria do not constrain. Input order is preserved.
 */
export function applyQuery(txns: readonly Transaction[], q: LedgerQuery): Transaction[] {
  const accountIds = q.accountIds && new Set(q.accountIds);
  const categories = q.categories && new Set(q.categories);
  const kinds = q.kinds && new Set(q.kinds);
  const buckets = q.buckets && new Set(q.buckets);
  const ids = q.ids && new Set(q.ids);
  const tokens = (q.search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);

  return txns.filter((t) => {
    if (q.start && t.date < q.start) return false;
    if (q.end && t.date > q.end) return false;
    if (accountIds && !accountIds.has(t.accountId)) return false;
    if (categories && !categories.has(t.category)) return false;
    if (kinds && !kinds.has(t.kind)) return false;
    if (buckets && !buckets.has(metricBucket(t.kind, t.direction))) return false;
    if (q.direction && t.direction !== q.direction) return false;
    if (q.needsReview !== undefined && t.needsReview !== q.needsReview) return false;
    if (ids && !ids.has(t.id)) return false;
    if (tokens.length > 0 && !matchesSearch(t, tokens, haystack(t))) return false;
    return true;
  });
}
