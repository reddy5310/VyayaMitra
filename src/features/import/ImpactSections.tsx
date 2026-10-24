import { AlertTriangle, ArrowLeftRight, Check } from 'lucide-react';
import type { RowWarning, Statement, Transaction } from '@/domain/types';
import type { ImportPreview, PreviewRow } from '@/engine/import';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, Money, cn } from '@/ui';
import { UNCERTAIN_WARNINGS, type TransferCandidate } from './candidates';

const WARNING_TEXT: Partial<Record<RowWarning, string>> = {
  balance_break: 'The running balance does not match this row',
  ambiguous_amount: 'More than one number could be the amount',
  direction_from_balance: 'Money in or out was worked out from the balance, not a column',
};

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <Button size="sm" variant={pressed ? 'primary' : 'outline'} aria-pressed={pressed} onClick={onClick}>
      {children}
    </Button>
  );
}

/** Rows whose amount or direction is doubtful. Each needs an explicit answer before the import can be confirmed. */
export function UncertainRows({
  rows,
  accepted,
  excluded,
  onAccept,
  onExclude,
}: {
  rows: PreviewRow[];
  accepted: ReadonlySet<number>;
  excluded: ReadonlySet<number>;
  onAccept: (index: number) => void;
  onExclude: (index: number) => void;
}) {
  if (rows.length === 0) return null;
  const open = rows.filter((r) => !accepted.has(r.index) && !excluded.has(r.index)).length;
  return (
    <Card className="space-y-3" role="region" aria-label="Amounts to resolve">
      <CardHeader
        title="Check these amounts first"
        subtitle={open > 0 ? `${open} of ${rows.length} still need your answer. Largest first.` : 'All answered.'}
      />
      <ul className="space-y-3">
        {rows.map((r) => {
          const state = accepted.has(r.index) ? 'accept' : excluded.has(r.index) ? 'exclude' : 'open';
          return (
            <li key={r.index} className={cn('rounded-xl border p-3', state === 'open' ? 'border-warning/60 bg-warning-soft/40' : 'border-border')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">
                    {formatDate(r.row.date)} · {r.understanding.merchant}
                  </p>
                  <ul className="mt-0.5 text-xs text-warning">
                    {r.row.warnings.filter((w) => UNCERTAIN_WARNINGS.has(w)).map((w) => (
                      <li key={w} className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                        {WARNING_TEXT[w]}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="shrink-0 text-right">
                  <Money value={r.row.amount} direction={r.row.direction} tone="direction" className="text-sm font-semibold" />
                  {r.row.balanceAfter !== undefined && (
                    <p className="text-xs text-fg-muted">
                      balance <Money value={r.row.balanceAfter} />
                    </p>
                  )}
                </div>
              </div>
              <pre
                aria-label={`Statement lines for ${r.understanding.merchant}`}
                className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-2 font-mono text-xs text-fg"
              >
                {r.row.source.rawLines.join('\n') || r.row.description}
              </pre>
              <p className="mt-0.5 text-xs text-fg-subtle">Page {r.row.source.page}</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Decide for ${r.understanding.merchant} on ${formatDate(r.row.date)}`}>
                <Choice pressed={state === 'accept'} onClick={() => onAccept(r.index)}>
                  Accept as printed
                </Choice>
                <Choice pressed={state === 'exclude'} onClick={() => onExclude(r.index)}>
                  Exclude
                </Choice>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** A row that is already in the ledger, shown next to the one that matched it. */
export function DuplicateRows({
  rows,
  existing,
  statements,
  keepBoth,
  onKeep,
}: {
  rows: PreviewRow[];
  existing: ReadonlyMap<string, Transaction>;
  statements: readonly Statement[];
  keepBoth: ReadonlySet<number>;
  onKeep: (index: number, keep: boolean) => void;
}) {
  const withMatch = rows.filter((r) => r.duplicateOf && existing.has(r.duplicateOf));
  if (withMatch.length === 0) return null;
  return (
    <Card className="space-y-3" role="region" aria-label="Possible duplicates">
      <CardHeader title="Possible duplicates" subtitle="These look like transactions you already have. They are skipped unless you keep both." />
      <ul className="space-y-3">
        {withMatch.slice(0, 10).map((r) => {
          const old = existing.get(r.duplicateOf!)!;
          const file = statements.find((s) => s.id === old.statementId)?.fileName ?? 'an earlier import';
          const keep = keepBoth.has(r.index);
          return (
            <li key={r.index} className="rounded-xl border border-border p-3">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <Badge tone="info">In this file</Badge>
                  <p className="mt-1">{formatDate(r.row.date)}</p>
                  <Money value={r.row.amount} direction={r.row.direction} tone="direction" className="font-semibold" />
                  <p className="truncate text-xs text-fg-muted">{r.row.description}</p>
                </div>
                <div className="min-w-0">
                  <Badge>Already imported</Badge>
                  <p className="mt-1">{formatDate(old.date)}</p>
                  <Money value={old.amount} direction={old.direction} tone="direction" className="font-semibold" />
                  <p className="truncate text-xs text-fg-muted">{old.rawDescription}</p>
                  <p className="truncate text-xs text-fg-subtle">From {file}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Decide for ${formatDate(r.row.date)} ${r.understanding.merchant}`}>
                <Choice pressed={!keep} onClick={() => onKeep(r.index, false)}>
                  Skip
                </Choice>
                <Choice pressed={keep} onClick={() => onKeep(r.index, true)}>
                  Keep both
                </Choice>
              </div>
            </li>
          );
        })}
      </ul>
      {withMatch.length > 10 && <p className="text-xs text-fg-muted">and {withMatch.length - 10} more, skipped.</p>}
    </Card>
  );
}

/** Both legs of a possible own-account transfer or card repayment, with the reason they were paired. */
export function TransferHints({ items, targetName }: { items: TransferCandidate[]; targetName: string }) {
  if (items.length === 0) return null;
  return (
    <Card className="space-y-3" role="region" aria-label="Possible transfers">
      <CardHeader
        title="Possible transfers or card payments"
        subtitle="If these are the same money moving between your own accounts, VyayaMitra links them after import so neither leg counts as spending."
      />
      <ul className="space-y-3">
        {items.slice(0, 6).map((c) => (
          <li key={c.row.index} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-fg-muted">{targetName}</p>
                <p>{formatDate(c.row.row.date, { short: true })}</p>
                <Money value={c.row.row.amount} direction={c.row.row.direction} tone="direction" className="font-semibold" />
              </div>
              <ArrowLeftRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />
              <div className="min-w-0 flex-1 text-right">
                <p className="truncate text-xs text-fg-muted">{c.otherAccount?.name ?? 'Another account'}</p>
                <p>{formatDate(c.other.date, { short: true })}</p>
                <Money value={c.other.amount} direction={c.other.direction} tone="direction" className="font-semibold" />
              </div>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              {c.cardRepayment ? 'Looks like a card bill payment: ' : 'Looks like a transfer: '}
              same amount, opposite direction, {c.daysApart === 0 ? 'on the same day' : `${c.daysApart} day${c.daysApart === 1 ? '' : 's'} apart`}, in another of your accounts.
            </p>
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="text-xs text-fg-muted">and {items.length - 6} more.</p>}
    </Card>
  );
}

function CheckLine({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={cn('flex items-center gap-2 text-sm', ok ? 'text-fg' : 'text-warning')}>
      {ok ? <Check className="h-4 w-4 text-positive" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
      <span>{children}</span>
      <span className="sr-only">{ok ? '(done)' : '(needs attention)'}</span>
    </li>
  );
}

/** First thing on the review step: what was understood about the statement, and what is left for the user. */
export function ReviewReceipt({ preview, attention }: { preview: ImportPreview; attention: number }) {
  const { parsed, account, stats } = preview;
  const accountOk = Boolean(account.existingAccountId) || Boolean(account.proposed.mask);
  const periodOk = Boolean(parsed.periodStart && parsed.periodEnd);
  const status = parsed.reconciliation.status;
  return (
    <Card className="space-y-3" role="region" aria-label="Statement summary">
      <h2 className="text-base font-semibold text-fg">Statement ready for review</h2>
      <ul className="space-y-1" aria-label="What was checked">
        <CheckLine ok={accountOk}>{accountOk ? 'Account identified' : 'Account not identified'}</CheckLine>
        <CheckLine ok={periodOk}>{periodOk ? 'Period identified' : 'Period not found'}</CheckLine>
        <CheckLine ok={status === 'balanced'}>
          {status === 'balanced' ? 'Totals checked' : status === 'mismatch' ? 'Totals do not match' : 'Totals could not be checked'}
        </CheckLine>
      </ul>
      <p className="text-sm font-medium text-fg">
        {stats.new} new · {stats.duplicates} already imported · {attention} need your attention
      </p>
    </Card>
  );
}

/** Category questions that share a merchant or UPI id, so one answer after import can settle them all. */
export function SimilarGroups({ rows }: { rows: PreviewRow[] }) {
  const groups = new Map<string, { name: string; rows: PreviewRow[] }>();
  for (const r of rows) {
    const key = r.understanding.counterparty.vpa ? `vpa:${r.understanding.counterparty.vpa}` : `m:${r.understanding.merchantKey}`;
    const g = groups.get(key) ?? { name: r.understanding.merchant, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
  if (list.length === 0) return null;
  return (
    <Card className="space-y-3" role="region" aria-label="Review similar transactions together">
      <CardHeader
        title="Review similar transactions together"
        subtitle="After importing, you answer once per merchant and the answer covers the whole group."
      />
      <ul className="divide-y divide-border text-sm">
        {list.slice(0, 8).map((g) => (
          <li key={g.name} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate font-medium text-fg">{g.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">
              {g.rows.length} transaction{g.rows.length === 1 ? '' : 's'} · <Money value={g.rows.reduce((n, r) => n + r.row.amount, 0)} />
            </span>
          </li>
        ))}
      </ul>
      {list.length > 8 && <p className="text-xs text-fg-muted">and {list.length - 8} more groups.</p>}
    </Card>
  );
}
