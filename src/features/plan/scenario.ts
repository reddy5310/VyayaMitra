import { planScenario, type ScenarioResult } from '@/engine/analytics';
import { formatINR } from '@/lib/money';

export type { ScenarioResult };
export type ScenarioInput = Parameters<typeof planScenario>[0];

/** The scenario for the editor. Always the analytics engine's rules (no double counting, kept expenses respected). */
export function runScenario(input: ScenarioInput): ScenarioResult {
  return planScenario(input);
}

/** One goal-impact line, e.g. "Emergency fund: ₹2,400 more a month, about 3 months sooner". */
export function describeImpact(x: ScenarioResult['goalImpact'][number]): string {
  if (x.extraPerMonth <= 0) return `${x.name}: no change`;
  const sooner =
    x.monthsSooner === null ? '' : x.monthsSooner > 0 ? `, about ${x.monthsSooner} month${x.monthsSooner === 1 ? '' : 's'} sooner` : '';
  return `${x.name}: ${formatINR(x.extraPerMonth, { whole: true })} more a month${sooner}`;
}
