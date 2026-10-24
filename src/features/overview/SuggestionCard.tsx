import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createSavingAction } from '@/db/actions';
import { setAdviserPreference } from '@/db/moneyback';
import { recordInsightFeedback } from '@/db/review';
import type { Paise, SavingAction } from '@/domain/types';
import type { Recommendation } from '@/engine/analytics';
import { ROUTES, activityLink } from '@/app/routes';
import { paiseToInput, parseRupeeInput } from '@/features/plan/amount';
import { addMonths, formatMonth, monthKey } from '@/lib/dates';
import { Badge, Button, Field, Input, Money, Sheet, useToast } from '@/ui';
import { InsightTextView, MaskedText } from './InsightText';
import { LinkButton } from './LinkButton';

function msg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.';
}

/**
 * One recommendation: what happened, the estimated effect (labelled as an estimate), its assumptions and three
 * ways to respond. Choosing a target stores the scope, assumptions and what the outcome will measure.
 */
export function SuggestionCard({ rec, existing, today }: { rec: Recommendation; existing: readonly SavingAction[]; today: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const chosen = existing.some((a) => a.insightId === rec.id && a.status !== 'dropped');
  const txnCount = rec.evidence.txnIds.length;
  const money = rec.kind === 'chase_refund';
  const fee = rec.kind === 'avoid_fee';

  async function keep() {
    try {
      if (rec.category) {
        await setAdviserPreference(rec.category, 'protected');
        toast('We will leave this spending alone.', {
          tone: 'success',
          action: { label: 'Undo', onClick: () => void setAdviserPreference(rec.category as string, null) },
        });
      } else {
        await recordInsightFeedback({ key: rec.key, insightId: rec.id, action: 'expected' });
        toast('Marked as expected.', { tone: 'success' });
      }
    } catch (e) {
      toast(msg(e), { tone: 'error' });
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold text-fg">
        <MaskedText text={rec.title} />
      </h3>
      <p className="mt-1 text-sm text-fg-muted">
        <InsightTextView parts={rec.happened} />
      </p>
      {rec.change.length > 0 && (
        <p className="mt-1 text-sm text-fg">
          <InsightTextView parts={rec.change} />
        </p>
      )}
      {rec.estimatedEffect !== undefined && rec.estimatedEffect > 0 && (
        <p className="mt-2 text-sm text-fg">
          <Badge tone="info" className="mr-1.5">
            Estimate
          </Badge>
          About <Money value={rec.estimatedEffect} whole className="font-medium" /> a month if you follow it. Not saved yet.
        </p>
      )}
      {rec.assumptions.length > 0 && <p className="mt-1 text-xs text-fg-subtle">Assumes: {rec.assumptions.join('; ')}</p>}
      <p className="mt-0.5 text-xs text-fg-subtle">How we check: {rec.check}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {chosen ? (
          <Badge tone="positive">Target chosen</Badge>
        ) : money ? (
          <LinkButton to={ROUTES.moneyBack} variant="secondary">
            Open Money back
          </LinkButton>
        ) : fee ? (
          <LinkButton to={ROUTES.fees} variant="secondary">
            Open Fees &amp; charges
          </LinkButton>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Choose a target<span className="sr-only"> for {rec.title}</span>
          </Button>
        )}
        {txnCount > 0 && (
          <Link to={activityLink({ ids: rec.evidence.txnIds })} className="inline-flex min-h-touch items-center rounded-xl px-2 text-sm font-medium text-primary hover:bg-surface-2">
            View purchases<span className="sr-only"> ({txnCount})</span>
          </Link>
        )}
        {!money && !fee && !chosen && (
          <Button variant="ghost" onClick={keep}>
            Keep this spending<span className="sr-only"> : {rec.title}</span>
          </Button>
        )}
      </div>
      {open && <TargetSheet rec={rec} today={today} onClose={() => setOpen(false)} />}
    </li>
  );
}

function TargetSheet({ rec, today, onClose }: { rec: Recommendation; today: string; onClose: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(rec.suggestedTarget ? paiseToInput(rec.suggestedTarget) : '');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const startMonth = addMonths(monthKey(today), 1);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const zeroOk = rec.kind === 'review_recurring' && text.trim() === '';
    const parsed = zeroOk ? { ok: true as const, paise: 0 } : parseRupeeInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const target: Paise = parsed.paise;
    setBusy(true);
    try {
      await createSavingAction({
        type: rec.kind === 'review_recurring' ? 'review_recurring' : 'category_limit',
        title: rec.title,
        category: rec.category,
        merchantKey: rec.merchantKey,
        baselineMonthly: target + (rec.estimatedEffect ?? 0),
        targetMonthly: target,
        startMonth,
        status: 'active',
        insightId: rec.id,
        scope: { categories: rec.category ? [rec.category] : undefined, merchantKeys: rec.merchantKey ? [rec.merchantKey] : undefined },
        assumptions: rec.assumptions,
        outcomeKind: 'purchase_reduction',
      });
      toast('Target chosen. We will check it against complete months.', { tone: 'success' });
      onClose();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm" title="Choose a target" description={`Tracking starts in ${formatMonth(startMonth)}.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-fg">
          <MaskedText text={rec.title} />
        </p>
        <Field label="Monthly target (₹)" error={error} hint={rec.kind === 'review_recurring' ? 'Leave empty to track whether the payments stop.' : 'What you aim to spend on this each month.'}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} inputMode="decimal" autoComplete="off" value={text} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => { setText(e.target.value); setError(undefined); }} />
          )}
        </Field>
        {rec.assumptions.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-fg-muted">
            {rec.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy}>
            Choose this target
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
