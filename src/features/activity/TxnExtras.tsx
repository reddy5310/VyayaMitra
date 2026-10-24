import { useMemo, useState } from 'react';
import { Check, Minus, TriangleAlert } from 'lucide-react';
import { deleteRule } from '@/db/actions';
import { mergeMerchants } from '@/db/review';
import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { CustomCategory, ExpenseTag, FeedbackEvent, Transaction } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Button, Field, Input, Notice, cn, useToast } from '@/ui';
import { TAG_OPTIONS, type StateChip } from './tagging';
import { errorMessage } from './useCorrection';

// ─── State chips ─────────────────────────────────────────────────────────────

export function StateChips({ chips }: { chips: StateChip[] }) {
  return (
    <ul aria-label="Status of this transaction" className="flex flex-wrap gap-1.5">
      {chips
        .filter((c) => !c.warning || c.on)
        .map((c) => {
          const Icon = c.warning ? TriangleAlert : c.on ? Check : Minus;
          return (
            <li
              key={c.label}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
                c.warning ? 'bg-warning-soft text-warning' : c.on ? 'bg-positive-soft text-positive' : 'bg-surface-2 text-fg-subtle',
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {c.on ? c.label : (c.offLabel ?? c.label)}
            </li>
          );
        })}
    </ul>
  );
}

// ─── Correction history ──────────────────────────────────────────────────────

function describeEvent(e: FeedbackEvent, custom: readonly CustomCategory[]): string {
  switch (e.action) {
    case 'category':
      return `Category: ${categoryName(e.before.category, custom)} → ${categoryName(e.after.category, custom)}`;
    case 'kind':
      return `Type: ${KIND_LABELS[e.before.kind]} → ${KIND_LABELS[e.after.kind]}`;
    case 'merchant':
      return 'Merchant name changed';
    case 'confirm':
      return 'Marked as looks right';
    case 'reset':
      return 'Reset to automatic';
    case 'tag':
      return 'Tag changed';
  }
}

export function CorrectionHistory({ events, custom }: { events: readonly FeedbackEvent[] | undefined; custom: readonly CustomCategory[] }) {
  if (events === undefined) return <p className="text-sm text-fg-muted">Loading history…</p>;
  if (events.length === 0) return <p className="text-sm text-fg-muted">No corrections yet. Everything here is still automatic.</p>;
  return (
    <ol aria-label="Correction history" className="divide-y divide-border text-sm">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
          <span className="text-fg">{describeEvent(e, custom)}</span>
          <span className="text-xs text-fg-muted">
            {formatDate(e.at.slice(0, 10))} · {e.scope === 'merchant' ? 'all from this merchant' : 'this transaction only'}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ─── Tag ─────────────────────────────────────────────────────────────────────

export function TagSelect({ label, current, onPick, className }: { label: string; current: ExpenseTag | '' | 'mixed'; onPick: (tag: ExpenseTag | null) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {TAG_OPTIONS.map((o) => (
        <button
          key={o.value || 'none'}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          onClick={() => onPick(o.value || null)}
          className={cn(
            'min-h-touch rounded-full border px-3 text-sm font-medium transition-colors',
            current === o.value ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface text-fg hover:bg-surface-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Combine merchants ───────────────────────────────────────────────────────

/** Group other merchants under this one's name (or any chosen name). Undo deletes the rule that did it. */
export function CombineMerchants({ txn, allTxns, onDone }: { txn: Transaction; allTxns: readonly Transaction[]; onDone: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState(txn.merchant);
  const [busy, setBusy] = useState(false);

  const merchants = useMemo(() => {
    const m = new Map<string, { key: string; name: string; count: number }>();
    for (const t of allTxns) {
      const e = m.get(t.merchantKey);
      if (e) e.count += 1;
      else m.set(t.merchantKey, { key: t.merchantKey, name: t.merchant, count: 1 });
    }
    return [...m.values()];
  }, [allTxns]);
  const mine = merchants.find((m) => m.key === txn.merchantKey);
  const matches = merchants
    .filter((m) => m.key !== txn.merchantKey && (!query.trim() || m.name.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const chosen = merchants.filter((m) => picked.has(m.key));
  const rowCount = (mine?.count ?? 1) + chosen.reduce((n, m) => n + m.count, 0);
  const nameOptions = [mine, ...chosen].filter((m): m is NonNullable<typeof m> => Boolean(m));

  async function run() {
    setBusy(true);
    try {
      const target = nameOptions.find((m) => m.name === name.trim());
      const result = await mergeMerchants([txn.merchantKey, ...picked], { merchantKey: target?.key ?? txn.merchantKey, name: name.trim() });
      const ruleId = result.ruleId;
      toast(`Combined ${rowCount} transactions under ${name.trim()}`, {
        tone: 'success',
        action: ruleId
          ? {
              label: 'Undo',
              onClick: () => {
                deleteRule(ruleId).then(
                  () => toast('Merchants separated again', { tone: 'success' }),
                  (e: unknown) => toast(errorMessage(e), { tone: 'error' }),
                );
              },
            }
          : undefined,
      });
      onDone();
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Combine merchants" className="space-y-3 rounded-xl border border-primary/40 bg-primary-soft/40 p-3">
      <Field label="Find other merchants to group with this one">
        {({ id }) => <Input id={id} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search merchants" />}
      </Field>
      {matches.length === 0 ? (
        <p className="text-sm text-fg-muted">No other merchants match.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-surface">
          {matches.map((m) => (
            <li key={m.key}>
              <label className="flex min-h-touch cursor-pointer items-center gap-3 px-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-primary"
                  checked={picked.has(m.key)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.key)) next.delete(m.key);
                      else next.add(m.key);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="text-xs text-fg-muted">{m.count} transaction{m.count === 1 ? '' : 's'}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {picked.size > 0 && (
        <>
          <p className="text-sm font-medium text-fg" role="status">
            {rowCount} transactions from {picked.size + 1} merchants will be grouped
          </p>
          <Field label="Show them all as">
            {({ id }) => (
              <>
                <Input id={id} list="combine-names" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                <datalist id="combine-names">
                  {nameOptions.map((m) => (
                    <option key={m.key} value={m.name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Notice tone="info">Future transactions from these merchants will be grouped too. You can undo this right after.</Notice>
        </>
      )}
      <div className="flex gap-2">
        <Button disabled={picked.size === 0 || name.trim() === ''} loading={busy} onClick={() => void run()}>
          Combine
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
