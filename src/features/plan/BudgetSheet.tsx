import { useMemo, useState, type FormEvent } from 'react';
import { BUDGETABLE_GROUPS, CATEGORY_GROUP_LABELS, allCategories, categoryName } from '@/domain/categories';
import type { Budget, CategoryGroup, CustomCategory, Paise } from '@/domain/types';
import { upsertBudget } from '@/db/actions';
import { Button, Field, Input, Money, Notice, Select, Sheet, useToast } from '@/ui';
import { paiseToInput, parseRupeeInput } from './amount';
import { errorMessage, isValidationError } from './errors';

interface Props {
  /** Budget being edited; null to add a new one. */
  editing: Budget | null;
  /** Categories that already have a budget (not offered again when adding). */
  takenCategories: ReadonlySet<string>;
  baselines: { category: string; monthlyAverage: Paise; monthsUsed: number }[];
  customCategories: readonly CustomCategory[];
  onClose: () => void;
}

/** Add or edit one monthly category limit. */
export function BudgetSheet({ editing, takenCategories, baselines, customCategories, onClose }: Props) {
  const { toast } = useToast();
  const options = useMemo(
    () =>
      allCategories(customCategories).filter(
        (c) => BUDGETABLE_GROUPS.has(c.group) && (editing ? c.id === editing.category : !takenCategories.has(c.id)),
      ),
    [customCategories, editing, takenCategories],
  );
  const grouped = useMemo(() => {
    const map = new Map<CategoryGroup, typeof options>();
    for (const o of options) map.set(o.group, [...(map.get(o.group) ?? []), o]);
    return [...map.entries()];
  }, [options]);

  const [category, setCategory] = useState(editing?.category ?? options[0]?.id ?? '');
  const [amount, setAmount] = useState(editing ? paiseToInput(editing.monthlyLimit) : '');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseline = baselines.find((b) => b.category === category && b.monthlyAverage > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!category) {
      setFormError('Choose a category first.');
      return;
    }
    const parsed = parseRupeeInput(amount);
    if (!parsed.ok) {
      setAmountError(parsed.error);
      return;
    }
    setAmountError(undefined);
    setBusy(true);
    try {
      await upsertBudget(category, parsed.paise);
      toast(`${categoryName(category, customCategories)} budget saved.`, { tone: 'success' });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
      if (!isValidationError(err)) toast(errorMessage(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      title={editing ? 'Edit budget' : 'Add a budget'}
      description="A monthly limit for one category. Progress is measured against your imported statements."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {options.length === 0 ? (
          <Notice tone="info">Every spending category already has a budget. Edit an existing one instead.</Notice>
        ) : (
          <>
            <Field label="Category">
              {({ id }) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)} disabled={Boolean(editing)}>
                  {grouped.map(([group, cats]) => (
                    <optgroup key={group} label={CATEGORY_GROUP_LABELS[group]}>
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Monthly limit (₹)"
              error={amountError}
              hint={
                baseline ? (
                  <>
                    Your {baseline.monthsUsed}-month average is <Money value={baseline.monthlyAverage} whole />.{' '}
                    <button
                      type="button"
                      className="font-medium text-primary underline"
                      onClick={() => {
                        setAmount(paiseToInput(baseline.monthlyAverage));
                        setAmountError(undefined);
                      }}
                    >
                      Use this
                    </button>
                  </>
                ) : (
                  'Enter rupees, for example 1,250.50'
                )
              }
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountError(undefined);
                  }}
                />
              )}
            </Field>
          </>
        )}
        {formError && (
          <Notice tone="negative" title="Could not save the budget">
            {formError}
          </Notice>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy} disabled={options.length === 0}>
            Save budget
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
