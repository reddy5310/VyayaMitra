import { useMemo, useState } from 'react';
import { createSavingAction, deleteBudget, upsertBudget } from '@/db/actions';
import { useGoalContributions, useGoals } from '@/db/hooks';
import { BUDGETABLE_GROUPS, allCategories, categoryName } from '@/domain/categories';
import type { Budget, CustomCategory, Paise } from '@/domain/types';
import { goalProgress } from '@/engine/analytics';
import { addMonths, monthKey, todayIso } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Input, Money, Notice, Select, useToast } from '@/ui';
import { paiseToInput, parseRupeeInput } from './amount';
import { MaskedText } from '@/features/overview/InsightText';
import { useMask } from '@/features/overview/mask';
import { describeImpact, runScenario } from './scenario';

interface Props {
  budgets: readonly Budget[];
  baselines: { category: string; monthlyAverage: Paise }[];
  customCategories: readonly CustomCategory[];
  /** Single new limit from a deep link (`?category=..&target=..`, target in paise). */
  prefill?: { category: string; target: Paise } | null;
  onClose: () => void;
}

/**
 * "Try a scenario": change limits side by side with the current plan and see the totals move.
 * Nothing is saved until "Save as my plan". It is a planning aid, not a forecast.
 */
export function ScenarioEditor({ budgets, baselines, customCategories, prefill, onClose }: Props) {
  const { toast } = useToast();
  const mask = useMask();
  const goals = useGoals();
  const contributions = useGoalContributions();
  const today = useMemo(() => todayIso(), []);

  const rows = useMemo(() => {
    const ids = new Set<string>([...budgets.map((b) => b.category), ...baselines.map((b) => b.category)]);
    if (prefill) ids.add(prefill.category);
    return allCategories(customCategories)
      .filter((c) => BUDGETABLE_GROUPS.has(c.group) && ids.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        budget: budgets.find((b) => b.category === c.id),
        baseline: baselines.find((b) => b.category === c.id)?.monthlyAverage,
      }));
  }, [budgets, baselines, customCategories, prefill]);

  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const r of rows) init[r.id] = r.budget ? paiseToInput(r.budget.monthlyLimit) : '';
    if (prefill && prefill.target > 0) init[prefill.category] = paiseToInput(prefill.target);
    return init;
  });
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [track, setTrack] = useState(true);
  const [goalId, setGoalId] = useState('');
  const [toGoal, setToGoal] = useState(false);

  // Parse every row; an unparseable entry is an inline error and is left out of the scenario.
  const parsed = useMemo(() => {
    const changes: { category: string; monthlyLimit: Paise | null }[] = [];
    const errors: Record<string, string> = {};
    for (const r of rows) {
      const text = (inputs[r.id] ?? '').trim();
      const current = r.budget?.monthlyLimit ?? null;
      if (!text) {
        if (current !== null) changes.push({ category: r.id, monthlyLimit: null });
        continue;
      }
      const p = parseRupeeInput(text);
      if (!p.ok) errors[r.id] = p.error;
      else if (p.paise !== current) changes.push({ category: r.id, monthlyLimit: p.paise });
    }
    return { changes, errors };
  }, [rows, inputs]);

  const goalInputs = useMemo(
    () =>
      (goals ?? [])
        .filter((g) => !g.archived)
        .map((g) => {
          const p = goalProgress(g, (contributions ?? []).filter((c) => c.goalId === g.id), today);
          return { goal: g, monthlyNeeded: p.monthlyNeeded, recentMonthlyPace: p.recentMonthlyPace };
        }),
    [goals, contributions, today],
  );

  const result = useMemo(
    () => runScenario({ budgets: [...budgets], baselines, changes: parsed.changes, keep: [...keep], goals: goalInputs }),
    [budgets, baselines, parsed.changes, keep, goalInputs],
  );

  const reductions = parsed.changes.filter((c) => {
    const r = rows.find((x) => x.id === c.category);
    const before = r?.budget?.monthlyLimit ?? r?.baseline ?? 0;
    return c.monthlyLimit !== null && c.monthlyLimit < before;
  });
  const hasErrors = Object.keys(parsed.errors).length > 0;

  async function save() {
    for (const c of parsed.changes) {
      if (c.monthlyLimit === null) {
        const b = budgets.find((x) => x.category === c.category);
        if (b) await deleteBudget(b.id);
      } else {
        await upsertBudget(c.category, c.monthlyLimit);
      }
    }
    if (track) {
      for (const c of reductions) {
        const r = rows.find((x) => x.id === c.category);
        const target = c.monthlyLimit as Paise;
        await createSavingAction({
          type: 'category_limit',
          title: `Keep ${categoryName(c.category, customCategories)} near ${formatINR(target, { whole: true })} a month`,
          category: c.category,
          baselineMonthly: r?.baseline ?? r?.budget?.monthlyLimit ?? target,
          targetMonthly: target,
          startMonth: addMonths(monthKey(today), 1),
          status: 'active',
          scope: { categories: [c.category] },
          assumptions: ['Based on your recent monthly average; replacement spending is not counted.'],
          outcomeKind: 'purchase_reduction',
        });
      }
    }
    toast('Your plan was updated.', { tone: 'success' });
    onClose();
  }

  const pickedGoal = goalInputs.find((g) => g.goal.id === (goalId || goalInputs[0]?.goal.id));

  async function putTowardGoal() {
    if (!pickedGoal || result.plannedReduction <= 0) return;
    setToGoal(true);
    try {
      await createSavingAction({
        type: 'goal_contribution',
        title: `Put ${formatINR(result.plannedReduction, { whole: true })} a month toward ${pickedGoal.goal.name}`,
        goalId: pickedGoal.goal.id,
        baselineMonthly: 0,
        targetMonthly: result.plannedReduction,
        startMonth: addMonths(monthKey(today), 1),
        status: 'active',
        assumptions: ['Assumes the planned reduction is actually moved into the goal.'],
        outcomeKind: 'goal_contribution',
      });
      toast(mask(`Planned: ${formatINR(result.plannedReduction, { whole: true })} a month toward ${pickedGoal.goal.name}.`), { tone: 'success' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the action.', { tone: 'error' });
    } finally {
      setToGoal(false);
    }
  }

  const notes = result.notes;
  const impacts = result.goalImpact.map(describeImpact).filter(Boolean);

  return (
    <Card>
      <CardHeader
        title="Try a scenario"
        subtitle="Change limits and see what it would do to your plan. Nothing is saved until you choose to."
        action={
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      />
      <p className="mb-3 inline-flex items-center gap-2 rounded-xl bg-info-soft px-3 py-1.5 text-sm font-medium text-info">
        Scenario — not a prediction
      </p>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="scn-now">
          <h3 id="scn-now" className="text-sm font-semibold text-fg">
            Your plan now
          </h3>
          <p className="text-2xl font-semibold text-fg">
            <Money value={result.currentPlanTotal} whole /> <span className="text-sm font-normal text-fg-muted">a month</span>
          </p>
          {result.surplusNow !== undefined && (
            <p className="text-xs text-fg-muted">
              Leaves <Money value={result.surplusNow} whole /> a month of income unplanned.
            </p>
          )}
          <ul className="mt-2 divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-fg">{r.name}</span>
                <span className="shrink-0 text-fg-muted">
                  {r.budget ? <Money value={r.budget.monthlyLimit} whole /> : 'No limit'}
                  {r.baseline !== undefined && (
                    <span className="block text-right text-xs text-fg-subtle">
                      3-month avg <Money value={r.baseline} whole />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="scn-new">
          <h3 id="scn-new" className="text-sm font-semibold text-fg">
            Scenario
          </h3>
          <p className="text-2xl font-semibold text-fg">
            <Money value={result.scenarioPlanTotal} whole /> <span className="text-sm font-normal text-fg-muted">a month</span>
          </p>
          <p className="text-xs text-fg-muted">
            {result.plannedReduction > 0 ? (
              <>
                Planned reduction of <Money value={result.plannedReduction} whole /> a month. This is a plan, not money saved.
              </>
            ) : (
              'No reduction yet.'
            )}
            {result.surplusScenario !== undefined && (
              <>
                {' '}
                Would leave <Money value={result.surplusScenario} whole /> a month of income unplanned.
              </>
            )}
          </p>
          <ul className="mt-2 divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex items-center gap-2">
                  <label htmlFor={`scn-${r.id}`} className="min-w-0 flex-1 truncate text-sm text-fg">
                    {r.name} limit (₹)
                  </label>
                  <Input
                    id={`scn-${r.id}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="No limit"
                    className="w-32 shrink-0"
                    value={inputs[r.id] ?? ''}
                    aria-invalid={parsed.errors[r.id] ? true : undefined}
                    aria-describedby={parsed.errors[r.id] ? `scn-${r.id}-err` : undefined}
                    onChange={(e) => setInputs((s) => ({ ...s, [r.id]: e.target.value }))}
                  />
                </div>
                {parsed.errors[r.id] && (
                  <p id={`scn-${r.id}-err`} className="mt-1 text-xs text-negative">
                    {parsed.errors[r.id]}
                  </p>
                )}
                <label className="mt-1 flex min-h-touch items-center gap-2 text-sm text-fg-muted">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-primary"
                    checked={keep.has(r.id)}
                    onChange={(e) =>
                      setKeep((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      })
                    }
                  />
                  Keep this expense
                  <span className="sr-only"> ({r.name})</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(notes.length > 0 || impacts.length > 0) && (
        <div className="mt-4 space-y-2">
          {impacts.length > 0 && (
            <Notice tone="info" title="What it means for your goals">
              <ul className="list-disc pl-4">
                {impacts.map((t) => (
                  <li key={t}>
                    <MaskedText text={t} />
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {notes.length > 0 && (
            <Notice tone="neutral" title="Assumptions">
              <ul className="list-disc pl-4">
                {notes.map((t) => (
                  <li key={t}>
                    <MaskedText text={t} />
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}

      {result.plannedReduction > 0 && goalInputs.length > 0 && (
        <div className="mt-4 rounded-xl bg-surface-2 p-3">
          <label htmlFor="scn-goal" className="text-sm font-medium text-fg">
            Put the difference toward a goal
          </label>
          <p className="text-xs text-fg-muted">
            Plans <Money value={result.plannedReduction} whole /> a month as an extra contribution. It is a plan until deposits show up.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Select id="scn-goal" className="w-full sm:w-64" value={pickedGoal?.goal.id ?? ''} onChange={(e) => setGoalId(e.target.value)}>
              {goalInputs.map((g) => (
                <option key={g.goal.id} value={g.goal.id}>
                  {g.goal.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" loading={toGoal} onClick={putTowardGoal}>
              Plan this contribution
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => setSaving(true)} disabled={parsed.changes.length === 0 || hasErrors}>
          Save as my plan
        </Button>
        <Button variant="outline" onClick={onClose}>
          Discard scenario
        </Button>
        {parsed.changes.length > 0 && <Badge tone="info">{parsed.changes.length} {parsed.changes.length === 1 ? 'change' : 'changes'}</Badge>}
      </div>

      <ConfirmDialog
        open={saving}
        onClose={() => setSaving(false)}
        title="Save these limits as your plan?"
        confirmLabel="Save plan"
        onConfirm={save}
      >
        <p>
          {parsed.changes.length} {parsed.changes.length === 1 ? 'limit' : 'limits'} will be changed. Your transactions are not affected.
        </p>
        {reductions.length > 0 && (
          <label className="flex min-h-touch items-center gap-3 text-fg">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={track} onChange={(e) => setTrack(e.target.checked)} />
            <span>
              Also track the {reductions.length} {reductions.length === 1 ? 'reduction' : 'reductions'} as saving actions (planned, not observed)
            </span>
          </label>
        )}
      </ConfirmDialog>
    </Card>
  );
}
