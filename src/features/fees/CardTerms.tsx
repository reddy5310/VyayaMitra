import { useState } from 'react';
import { deleteCardPolicy, saveCardPolicy } from '@/db/moneyback';
import type { Account, CardPolicy, ChargeType } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Button, Card, CardHeader, ConfirmDialog, Field, Input, Notice, Select, Textarea, useToast } from '@/ui';
import { amountToPaise } from '../activity/useActivityFilters';
import { CHARGE_LABELS, CHARGE_TYPES } from './helpers';
import { Money } from '@/ui';

type Form = {
  id?: string;
  accountId: string;
  chargeType: ChargeType;
  summary: string;
  min: string;
  max: string;
  cap: string;
  tax: 'unknown' | 'yes' | 'no';
  effectiveFrom: string;
  sourceNote: string;
};

const rupees = (p?: number) => (p === undefined ? '' : String(p / 100));

function toForm(p: CardPolicy): Form {
  return {
    id: p.id,
    accountId: p.accountId,
    chargeType: p.chargeType,
    summary: p.summary,
    min: rupees(p.waiverMinPurchase),
    max: rupees(p.waiverMaxPurchase),
    cap: rupees(p.cycleCap),
    tax: p.taxReversed === null ? 'unknown' : p.taxReversed ? 'yes' : 'no',
    effectiveFrom: p.effectiveFrom ?? '',
    sourceNote: p.sourceNote ?? '',
  };
}

/** Terms are typed in by the user from their own card's published terms. VyayaMitra ships no issuer rules. */
export function CardTerms({ policies, accounts }: { policies: readonly CardPolicy[]; accounts: readonly Account[] }) {
  const { toast } = useToast();
  const cards = accounts.filter((a) => a.type === 'credit_card' && !a.archived);
  const [form, setForm] = useState<Form | null>(null);
  const [removing, setRemoving] = useState<CardPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Card';

  const blank = (): Form => ({ accountId: cards[0]?.id ?? '', chargeType: 'fuel_surcharge', summary: '', min: '', max: '', cap: '', tax: 'unknown', effectiveFrom: '', sourceNote: '' });

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await saveCardPolicy({
        id: form.id,
        accountId: form.accountId,
        chargeType: form.chargeType,
        summary: form.summary.trim(),
        waiverMinPurchase: amountToPaise(form.min) ?? undefined,
        waiverMaxPurchase: amountToPaise(form.max) ?? undefined,
        cycleCap: amountToPaise(form.cap) ?? undefined,
        taxReversed: form.tax === 'unknown' ? null : form.tax === 'yes',
        effectiveFrom: form.effectiveFrom || undefined,
        sourceNote: form.sourceNote.trim() || undefined,
      });
      toast('Card terms saved', { tone: 'success' });
      setForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save these terms.');
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  return (
    <Card className="space-y-3">
      <CardHeader
        title="Card terms"
        subtitle="Write down what your card’s own terms say about a charge. VyayaMitra uses only these notes to say a charge might qualify for reversal."
        action={
          !form && (
            <Button size="sm" variant="outline" disabled={cards.length === 0} onClick={() => setForm(blank())}>
              Add card terms
            </Button>
          )
        }
      />
      {cards.length === 0 && <p className="text-sm text-fg-muted">Import a credit-card statement first, then you can record its terms.</p>}
      {policies.length > 0 && (
        <ul className="divide-y divide-border" aria-label="Recorded card terms">
          {policies.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-fg">
                  {accountName(p.accountId)} · {CHARGE_LABELS[p.chargeType]}
                </p>
                <p className="text-fg-muted">{p.summary}</p>
                <p className="text-xs text-fg-subtle">
                  {p.waiverMinPurchase !== undefined && <>From <Money value={p.waiverMinPurchase} /> </>}
                  {p.waiverMaxPurchase !== undefined && <>up to <Money value={p.waiverMaxPurchase} /> </>}
                  {p.cycleCap !== undefined && <>· cap <Money value={p.cycleCap} /> a cycle </>}
                  {p.effectiveFrom && <>· from {formatDate(p.effectiveFrom)} </>}
                  {p.sourceNote && <>· {p.sourceNote}</>}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setForm(toForm(p))}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <form
          aria-label="Card terms form"
          className="space-y-3 rounded-xl border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Card">
              {({ id }) => (
                <Select id={id} value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}>
                  {cards.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Type of charge">
              {({ id }) => (
                <Select id={id} value={form.chargeType} onChange={(e) => set({ chargeType: e.target.value as ChargeType })}>
                  {CHARGE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CHARGE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="What the terms say, in your words" hint="For example: “1% fuel surcharge waived on ₹400 to ₹4,000, up to ₹100 a cycle.”">
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} maxLength={300} required value={form.summary} onChange={(e) => set({ summary: e.target.value })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Smallest purchase (₹)">{({ id }) => <Input id={id} inputMode="decimal" value={form.min} onChange={(e) => set({ min: e.target.value })} />}</Field>
            <Field label="Largest purchase (₹)">{({ id }) => <Input id={id} inputMode="decimal" value={form.max} onChange={(e) => set({ max: e.target.value })} />}</Field>
            <Field label="Cap per cycle (₹)">{({ id }) => <Input id={id} inputMode="decimal" value={form.cap} onChange={(e) => set({ cap: e.target.value })} />}</Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Is the tax reversed too?">
              {({ id }) => (
                <Select id={id} value={form.tax} onChange={(e) => set({ tax: e.target.value as Form['tax'] })}>
                  <option value="unknown">Not stated</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              )}
            </Field>
            <Field label="Effective from">{({ id }) => <Input id={id} type="date" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</Field>
            <Field label="Where this came from">{({ id }) => <Input id={id} maxLength={120} placeholder="e.g. card terms PDF, March 2025" value={form.sourceNote} onChange={(e) => set({ sourceNote: e.target.value })} />}</Field>
          </div>
          {error && <Notice tone="negative">{error}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!form.accountId || !form.summary.trim()}>
              Save terms
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove these card terms?"
        tone="danger"
        confirmLabel="Remove terms"
        onConfirm={async () => {
          if (removing) await deleteCardPolicy(removing.id);
          toast('Card terms removed', { tone: 'success' });
        }}
      >
        <p>Charges will go back to saying “Check your card’s terms”. Nothing else changes.</p>
      </ConfirmDialog>
    </Card>
  );
}
