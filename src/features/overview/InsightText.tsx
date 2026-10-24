import { Fragment } from 'react';
import type { InsightText } from '@/engine/analytics';
import { Money } from '@/ui';
import { useMask } from './mask';

/** A sentence that may contain pre-formatted rupees. Masked when "Hide amounts" is on. */
export function MaskedText({ text }: { text: string }) {
  const mask = useMask();
  return <>{mask(text)}</>;
}

/** Structured advice text: strings as-is, amounts through <Money> so privacy mode masks them. Falls back to a masked string. */
export function InsightTextView({ parts, fallback }: { parts?: InsightText; fallback?: string }) {
  if (!parts) return <MaskedText text={fallback ?? ''} />;
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <Money key={i} value={p.paise} whole />))}
    </>
  );
}
