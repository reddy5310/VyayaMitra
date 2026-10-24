import { useState, type FormEvent } from 'react';
import type { SavingsGoal } from '@/domain/types';
import { createGoal, updateGoal } from '@/db/actions';
import { isIsoDate, todayIso } from '@/lib/dates';
import { Button, Field, Input, Notice, Sheet, cn, useToast } from '@/ui';
import { paiseToInput, parseRupeeInput } from './amount';
import { DEFAULT_GOAL_COLOR, DEFAULT_GOAL_ICON, GOAL_COLORS, GOAL_ICONS } from './goalStyle';
import { errorMessage } from './errors';

/** Create or edit a savings goal. */
export function GoalSheet({ editing, onClose }: { editing: SavingsGoal | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(editing?.name ?? '');
  const [target, setTarget] = useState(editing ? paiseToInput(editing.target) : '');
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? '');
  const [icon, setIcon] = useState(editing?.icon ?? DEFAULT_GOAL_ICON);
  const [color, setColor] = useState(editing?.color ?? DEFAULT_GOAL_COLOR);
  const [errors, setErrors] = useState<{ name?: string; target?: string; date?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Give your goal a name.';
    const parsed = parseRupeeInput(target);
    if (!parsed.ok) next.target = parsed.error;
    if (targetDate && (!isIsoDate(targetDate) || targetDate <= todayIso())) next.date = 'Pick a date in the future, or leave it empty.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok) return;

    setBusy(true);
    try {
      if (editing) {
        await updateGoal(editing.id, { name: name.trim(), target: parsed.paise, targetDate: targetDate || undefined, icon, color });
      } else {
        await createGoal({ name: name.trim(), target: parsed.paise, targetDate: targetDate || undefined, icon, color });
      }
      toast(editing ? 'Goal updated.' : 'Goal created.', { tone: 'success' });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm" title={editing ? 'Edit goal' : 'New goal'} description="Something you are saving towards.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={name}
              maxLength={60}
              placeholder="Emergency fund, Goa trip…"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Target amount (₹)" error={errors.target} hint="For example 1,50,000">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              value={target}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => setTarget(e.target.value)}
            />
          )}
        </Field>
        <Field label="Target date (optional)" error={errors.date} hint="With a date we can tell you how much to set aside each month.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={targetDate}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          )}
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Icon</legend>
          <div role="radiogroup" aria-label="Goal icon" className="flex flex-wrap gap-2">
            {GOAL_ICONS.map(({ name: n, label, Icon }) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={icon === n}
                aria-label={label}
                title={label}
                onClick={() => setIcon(n)}
                className={cn(
                  'inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl border',
                  icon === n ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-fg-muted hover:bg-surface-2',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-fg">Colour</legend>
          <div role="radiogroup" aria-label="Goal colour" className="flex flex-wrap gap-2">
            {GOAL_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={color === c.value}
                aria-label={c.label}
                title={c.label}
                onClick={() => setColor(c.value)}
                className={cn(
                  'inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl border',
                  color === c.value ? 'border-fg' : 'border-border-strong hover:bg-surface-2',
                )}
              >
                <span aria-hidden className="h-6 w-6 rounded-full" style={{ backgroundColor: c.value }} />
              </button>
            ))}
          </div>
        </fieldset>

        {formError && (
          <Notice tone="negative" title="Could not save the goal">
            {formError}
          </Notice>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy}>
            {editing ? 'Save goal' : 'Create goal'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
