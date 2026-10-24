import { useMemo, useState, type FormEvent } from 'react';
import type { GoalContribution, SavingsGoal, Transaction } from '@/domain/types';
import { addContribution } from '@/db/actions';
import { formatDate, isIsoDate, todayIso } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { Button, Field, Input, Notice, Select, Sheet, useToast } from '@/ui';
import { paiseToInput, parseRupeeInput } from './amount';
import { errorMessage } from './errors';

interface Props {
  goal: SavingsGoal;
  type: 'deposit' | 'withdrawal';
  transactions: readonly Transaction[];
  existing: readonly GoalContribution[];
  onClose: () => void;
}

/** Record money added to, or taken out of, a goal. A deposit can be tied to an imported investment so it counts as verified. */
export function ContributionSheet({ goal, type, transactions, existing, onClose }: Props) {
  const { toast } = useToast();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [linkedId, setLinkedId] = useState('');
  const [errors, setErrors] = useState<{ date?: string; amount?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDeposit = type === 'deposit';
  const linkable = useMemo(() => {
    const taken = new Set(existing.map((c) => c.linkedTxnId).filter(Boolean));
    return transactions
      .filter((t) =>
        isDeposit ? t.kind === 'investment' && t.direction === 'debit' : t.kind === 'investment_return' && t.direction === 'credit',
      )
      .filter((t) => !taken.has(t.id))
      .slice(0, 50);
  }, [transactions, existing, isDeposit]);

  function pickLinked(id: string) {
    setLinkedId(id);
    const t = linkable.find((x) => x.id === id);
    if (t) {
      setAmount(paiseToInput(t.amount));
      setDate(t.date);
      setErrors({});
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const next: typeof errors = {};
    if (!isIsoDate(date)) next.date = 'Choose a valid date.';
    const parsed = parseRupeeInput(amount);
    if (!parsed.ok) next.amount = parsed.error;
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok) return;

    setBusy(true);
    try {
      await addContribution({
        goalId: goal.id,
        date,
        amount: parsed.paise,
        type,
        linkedTxnId: linkedId || undefined,
        note: note.trim() || undefined,
      });
      toast(isDeposit ? 'Deposit added.' : 'Withdrawal recorded.', { tone: 'success' });
      onClose();
    } catch (err) {
      // Includes ValidationError such as "can't withdraw more than you have saved".
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="sm"
      title={isDeposit ? `Add deposit to ${goal.name}` : `Withdraw from ${goal.name}`}
      description={isDeposit ? 'Money you set aside for this goal.' : 'Money you took out of this goal.'}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && (
          <Notice tone="negative" title={isDeposit ? 'Could not add the deposit' : 'Could not record the withdrawal'}>
            {formError}
          </Notice>
        )}
        <Field label="Date" error={errors.date}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={date}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Amount (₹)" error={errors.amount}>
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
                setErrors((x) => ({ ...x, amount: undefined }));
              }}
            />
          )}
        </Field>
        {linkable.length > 0 && (
          <Field
            label="Link to an imported transaction (optional)"
            hint="Linking marks this amount as verified against your statement."
          >
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={linkedId} onChange={(e) => pickLinked(e.target.value)}>
                <option value="">Not linked</option>
                {linkable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatDate(t.date, { short: true })} · {t.merchant} · {formatINR(t.amount)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Note (optional)">
          {({ id }) => <Input id={id} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy}>
            {isDeposit ? 'Add deposit' : 'Record withdrawal'}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
