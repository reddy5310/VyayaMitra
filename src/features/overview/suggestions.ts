import type { Recommendation } from '@/engine/analytics';

const URGENT: Recommendation['kind'][] = ['chase_refund', 'avoid_fee'];

/** Urgent refund and fee items first, then by rank; at least `max` shown, never hiding an urgent one. */
export function pickSuggestions(recs: readonly Recommendation[], max = 3): Recommendation[] {
  const urgent = recs.filter((r) => URGENT.includes(r.kind));
  const rest = recs.filter((r) => !URGENT.includes(r.kind));
  return [...urgent, ...rest].slice(0, Math.max(max, urgent.length));
}
