import type { Budget, Paise, SavingsGoal } from '@/domain/types';
import { categoryName } from '@/domain/categories';

export interface ScenarioResult {
  currentPlanTotal: Paise;
  scenarioPlanTotal: Paise;
  /** Sum of per-category reductions against the typical (baseline) spend. */
  plannedReduction: Paise;
  perCategory: { category: string; baseline: Paise; current?: Paise; scenario?: Paise; reduction: Paise; kept: boolean }[];
  surplusNow?: Paise;
  surplusScenario?: Paise;
  goalImpact: { goalId: string; name: string; extraPerMonth: Paise; monthsSooner: number | null }[];
  notes: string[];
}

/**
 * A what-if, not a prediction. For each category, reduction = max(0, baseline - scenario limit), measured
 * against the typical monthly spend (not the old limit), 0 for categories in `keep` or without a limit or
 * baseline. A category appears once even if several changes touch it (the last change wins, with a note).
 * Surplus = incomeMonthly - total baseline spend, only when income is given. The whole reduction is
 * assumed to go to the first unfinished goal; `remaining` (optional) lets monthsSooner be estimated.
 */
export function planScenario(input: {
  budgets: Budget[];
  baselines: { category: string; monthlyAverage: Paise }[];
  changes: { category: string; monthlyLimit: Paise | null }[];
  keep: string[];
  goals: { goal: SavingsGoal; monthlyNeeded: Paise | null; recentMonthlyPace: Paise; remaining?: Paise }[];
  incomeMonthly?: Paise;
}): ScenarioResult {
  const notes: string[] = ['This is a what-if scenario, not a prediction: it assumes your spending follows the limits you set.'];
  const baseline = new Map(input.baselines.map((b) => [b.category, b.monthlyAverage]));
  const current = new Map<string, Paise>();
  for (const b of input.budgets) current.set(b.category, (current.get(b.category) ?? 0) + b.monthlyLimit);
  const changed = new Map<string, Paise | null>();
  const repeated = new Set<string>();
  for (const c of input.changes) {
    if (changed.has(c.category)) repeated.add(c.category);
    changed.set(c.category, c.monthlyLimit);
  }
  for (const c of repeated) notes.push(`${categoryName(c)} was changed more than once; it is counted once, using the last change.`);
  const keep = new Set(input.keep);

  const categories = [...new Set([...baseline.keys(), ...current.keys(), ...changed.keys()])];
  const perCategory = categories.map((category) => {
    const base = baseline.get(category) ?? 0;
    const cur = current.get(category);
    const scenario = changed.has(category) ? (changed.get(category) ?? undefined) : cur;
    const kept = keep.has(category);
    const reduction = kept || scenario === undefined ? 0 : Math.max(0, base - scenario);
    return {
      category,
      baseline: base,
      ...(cur !== undefined ? { current: cur } : {}),
      ...(scenario !== undefined ? { scenario } : {}),
      reduction,
      kept,
    };
  });
  if (perCategory.some((c) => c.kept)) notes.push('Categories you chose to keep are left unchanged and add nothing to the reduction.');

  const plannedReduction = perCategory.reduce((s, c) => s + c.reduction, 0);
  const currentPlanTotal = perCategory.reduce((s, c) => s + (c.current ?? 0), 0);
  const scenarioPlanTotal = perCategory.reduce((s, c) => s + (c.scenario ?? 0), 0);

  const result: ScenarioResult = { currentPlanTotal, scenarioPlanTotal, plannedReduction, perCategory, goalImpact: [], notes };
  if (input.incomeMonthly !== undefined) {
    const typical = perCategory.reduce((s, c) => s + c.baseline, 0);
    result.surplusNow = input.incomeMonthly - typical;
    result.surplusScenario = result.surplusNow + plannedReduction;
    notes.push('Surplus is monthly income minus your typical monthly spending from fully covered months.');
  }

  const goal = input.goals.find((g) => !g.goal.archived && (g.monthlyNeeded !== null || g.goal.targetDate === undefined));
  if (goal && plannedReduction > 0) {
    let monthsSooner: number | null = null;
    const { remaining, recentMonthlyPace: pace } = goal;
    if (remaining !== undefined && remaining > 0 && pace > 0) {
      monthsSooner = Math.max(0, Math.ceil(remaining / pace) - Math.ceil(remaining / (pace + plannedReduction)));
    }
    result.goalImpact.push({ goalId: goal.goal.id, name: goal.goal.name, extraPerMonth: plannedReduction, monthsSooner });
    notes.push(`The whole planned reduction is assumed to go to ${goal.goal.name}, the first unfinished goal.`);
  }
  return result;
}
