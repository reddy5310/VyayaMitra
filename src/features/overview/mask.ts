import type { Paise } from '@/domain/types';
import type { Insight, InsightText } from '@/engine/analytics';
import { usePrivacy } from '@/ui';

/** Rupee amounts the engine may have pre-formatted into a sentence: ₹1,234.50, ₹1.3L, ₹12K. */
const RUPEES = /₹\s?[\d,]+(?:\.\d+)?(?:\s?(?:L|Cr|K|lakh|crore))?/g;

/** Hide-amounts masking for plain strings and aria-labels. */
export function useMask(): (text: string) => string {
  const { hideAmounts } = usePrivacy();
  return (text) => (hideAmounts ? text.replace(RUPEES, '₹ ••••') : text);
}

/** Insight with the structured fields the analytics module adds (all optional, so older insights still render). */
export type RichInsight = Omit<Insight, 'evidence'> & {
  titleParts?: InsightText;
  bodyParts?: InsightText;
  evidence: { txnIds: string[]; figures: { label: string; value: string; amount?: Paise }[] };
};

export const rich = (i: Insight): RichInsight => i as unknown as RichInsight;
