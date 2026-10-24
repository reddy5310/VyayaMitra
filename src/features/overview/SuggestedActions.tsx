import type { SavingAction } from '@/domain/types';
import type { Recommendation } from '@/engine/analytics';
import { Card, CardHeader } from '@/ui';
import { SuggestionCard } from './SuggestionCard';
import { pickSuggestions } from './suggestions';

/**
 * Always-visible block of the top recommendations. It does not depend on the month-end review card:
 * urgent refund and fee items stay on screen until they are dealt with.
 */
export function SuggestedActions({ recs, actions, today }: { recs: readonly Recommendation[]; actions: readonly SavingAction[]; today: string }) {
  const shown = pickSuggestions(recs, 3);
  if (shown.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Suggested actions" subtitle="Small changes worth considering. Every figure is an estimate until complete months show the result." />
      <ul className="space-y-3">
        {shown.map((r) => (
          <SuggestionCard key={r.id} rec={r} existing={actions} today={today} />
        ))}
      </ul>
    </Card>
  );
}
