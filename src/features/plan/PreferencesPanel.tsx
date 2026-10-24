import { useMemo } from 'react';
import { setAdviserPreference } from '@/db/moneyback';
import { BUDGETABLE_GROUPS, allCategories } from '@/domain/categories';
import type { AdviserPreference, CategoryPreference, CustomCategory } from '@/domain/types';
import { Card, CardHeader, Select, useToast } from '@/ui';
import { errorMessage } from './errors';

const OPTIONS: { value: CategoryPreference; label: string }[] = [
  { value: 'protected', label: 'Protected: do not suggest cuts' },
  { value: 'essential', label: 'Essential: only if clearly wasteful' },
  { value: 'fixed', label: 'Fixed: hard to change' },
  { value: 'adjustable', label: 'Adjustable: happy to look' },
];

/** "What matters to you": per category, how the adviser should treat it. Suggestions respect these. */
export function PreferencesPanel({
  preferences,
  baselines,
  customCategories,
}: {
  preferences: readonly AdviserPreference[];
  baselines: { category: string; monthlyAverage: number }[];
  customCategories: readonly CustomCategory[];
}) {
  const { toast } = useToast();
  const rows = useMemo(() => {
    const wanted = new Set([...baselines.map((b) => b.category), ...preferences.map((p) => p.category)]);
    const all = allCategories(customCategories).filter((c) => BUDGETABLE_GROUPS.has(c.group));
    const withData = all.filter((c) => wanted.has(c.id));
    return withData.length > 0 ? withData : all;
  }, [baselines, preferences, customCategories]);

  async function change(category: string, value: string) {
    try {
      await setAdviserPreference(category, value === '' ? null : (value as CategoryPreference));
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    }
  }

  return (
    <Card>
      <CardHeader title="What matters to you" subtitle="Tell VyayaMitra which spending to leave alone. Suggestions follow these choices." />
      <ul className="divide-y divide-border">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
            <label htmlFor={`pref-${c.id}`} className="min-w-0 text-sm font-medium text-fg">
              {c.name}
            </label>
            <Select
              id={`pref-${c.id}`}
              className="w-full sm:w-64"
              value={preferences.find((p) => p.category === c.id)?.preference ?? ''}
              onChange={(e) => change(c.id, e.target.value)}
            >
              <option value="">No preference</option>
              {OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}
