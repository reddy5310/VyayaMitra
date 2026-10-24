import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { Account, RowWarning } from '@/domain/types';
import type { CommitChoices, ImportPreview, PreviewRow } from '@/engine/import';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, Money, Notice, SegmentedControl, Spinner, type Tone } from '@/ui';
import type { AccountTarget } from './AccountStep';
import { FormatNotices } from './FormatNotices';
import type { Via } from './importTypes';

const PAGE = 60;

/** Warnings that mean the amount, direction or date may be misread, as opposed to an unsure category. */
const AMOUNT_WARNINGS: ReadonlySet<RowWarning> = new Set<RowWarning>(['balance_break', 'ambiguous_amount', 'date_out_of_period', 'direction_from_balance']);
const hasAmountIssue = (r: PreviewRow) => r.row.warnings.some((w) => AMOUNT_WARNINGS.has(w));

type RowFilter = 'all' | 'amounts' | 'categories';

const WARNING_LABELS: Record<RowWarning, { label: string; tone: Tone }> = {
  balance_break: { label: 'Balance break', tone: 'warning' },
  direction_from_balance: { label: 'Direction from balance', tone: 'info' },
  ambiguous_amount: { label: 'Amount unclear', tone: 'warning' },
  date_out_of_period: { label: 'Date outside period', tone: 'warning' },
  description_merged: { label: 'Description merged', tone: 'neutral' },
};

function ReconciliationCard({ preview }: { preview: ImportPreview }) {
  const rec = preview.parsed.reconciliation;
  const failed = rec.checks.filter((c) => !c.ok);
  if (rec.status === 'balanced') {
    return (
      <Notice tone="positive" title="Balanced">
        <span className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Every row matches the statement&apos;s running balance.
        </span>
      </Notice>
    );
  }
  if (rec.status === 'mismatch') {
    return (
      <Notice tone="warning" title="Some figures do not match the statement">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            {failed.length > 0 && (
              <ul className="list-disc pl-4">
                {failed.map((c) => (
                  <li key={c.label}>
                    {c.label}
                    {c.expected !== undefined && c.actual !== undefined && (
                      <>
                        : statement says <Money value={c.expected} />, rows add up to <Money value={c.actual} />
                      </>
                    )}
                    {c.detail ? ` (${c.detail})` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1">
              {rec.rowBalanceBreaks} row{rec.rowBalanceBreaks === 1 ? '' : 's'} where the running balance breaks, flagged below. They are marked for review after import.
            </p>
          </div>
        </div>
      </Notice>
    );
  }
  return (
    <Notice tone="info" title="Not verifiable">
      <span className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        This statement doesn&apos;t print balances; rows were imported as printed.
      </span>
    </Notice>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

export function ReviewStep({
  preview,
  accounts,
  target,
  committing,
  commitError,
  via,
  templateName,
  onTeach,
  onConfirm,
  onBack,
  onCancel,
}: {
  preview: ImportPreview;
  accounts: readonly Account[];
  target: AccountTarget;
  committing: boolean;
  commitError: string | null;
  via: Via;
  /** Name of the stored template that was used, when known. */
  templateName?: string;
  /** Opens the "teach this format" screen. Omit to hide every teach offer. */
  onTeach?: () => void;
  /** Called only from the explicit confirm button. */
  onConfirm: (choices: CommitChoices) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const { parsed, stats } = preview;
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [visible, setVisible] = useState(PAGE);
  const [showSkipped, setShowSkipped] = useState(false);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');

  const replacing = mode === 'replace' && Boolean(preview.alreadyImported);
  /** In "add" mode a duplicate is always skipped by the importer, so it is locked off. */
  const locked = (r: PreviewRow) => !replacing && r.duplicateOf !== undefined;
  const included = (r: PreviewRow) => !locked(r) && !excluded.has(r.index);
  const includedCount = useMemo(
    () => preview.rows.filter((r) => (replacing || r.duplicateOf === undefined) && !excluded.has(r.index)).length,
    [preview.rows, excluded, replacing],
  );

  const debitCount = parsed.rows.filter((r) => r.direction === 'debit').length;
  const creditCount = parsed.rows.length - debitCount;
  const accountName =
    'accountId' in target ? (accounts.find((a) => a.id === target.accountId)?.name ?? 'Account') : target.newAccount.name;

  function toggle(index: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function confirm() {
    const excludeRowIndexes = preview.rows.filter((r) => !locked(r) && excluded.has(r.index)).map((r) => r.index);
    const base: CommitChoices = 'accountId' in target ? { accountId: target.accountId, mode: 'add' } : { newAccount: target.newAccount, mode: 'add' };
    onConfirm(
      replacing && preview.alreadyImported
        ? { ...base, mode: 'replace', replaceStatementId: preview.alreadyImported.statementId, excludeRowIndexes }
        : { ...base, excludeRowIndexes },
    );
  }

  const amountRows = useMemo(() => preview.rows.filter(hasAmountIssue), [preview.rows]);
  const categoryRows = useMemo(() => preview.rows.filter((r) => !hasAmountIssue(r) && r.understanding.needsReview), [preview.rows]);
  const listed = rowFilter === 'amounts' ? amountRows : rowFilter === 'categories' ? categoryRows : preview.rows;
  const shown = listed.slice(0, visible);
  const actionLabel = replacing ? `Replace and import ${includedCount}` : `Import ${includedCount} transaction${includedCount === 1 ? '' : 's'}`;

  return (
    <div className="space-y-4">
      {committing && (
        <Notice tone="info">
          <Spinner label="Saving to this device. This happens in one step, so nothing is half-saved." />
        </Notice>
      )}
      {commitError && (
        <Notice tone="negative" title="Nothing was saved">
          {commitError} Your existing data is untouched. You can try again.
        </Notice>
      )}

      {preview.alreadyImported && (
        <Notice
          tone="warning"
          title="This exact file was imported before"
          action={
            replacing ? (
              <Button size="sm" variant="outline" disabled={committing} onClick={() => setMode('add')}>
                Keep the earlier import
              </Button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" variant="outline" disabled={committing} onClick={() => setMode('replace')}>
                  Replace it
                </Button>
                <Button size="sm" variant="ghost" disabled={committing} onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            )
          }
        >
          Imported on {formatDate(preview.alreadyImported.importedAt.slice(0, 10))}.{' '}
          {replacing
            ? 'The earlier import and its transactions will be removed, then every row below is imported again.'
            : 'Adding it again would only skip every row as a duplicate. Replace it to re-import with the current rules, or cancel.'}
        </Notice>
      )}

      {preview.overlapping.length > 0 && (
        <Notice tone="info" title="Overlaps with statements you already imported">
          <ul className="list-disc pl-4">
            {preview.overlapping.map((o) => (
              <li key={o.statementId}>
                {o.fileName}
                {o.periodStart && o.periodEnd ? ` (${formatDate(o.periodStart)} – ${formatDate(o.periodEnd)})` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1">Rows that are already in your ledger are skipped automatically.</p>
        </Notice>
      )}

      <FormatNotices preview={preview} via={via} templateName={templateName} disabled={committing} onTeach={onTeach} />

      <Card className="space-y-4">
        <CardHeader title={preview.file.name} subtitle={`Importing into ${accountName}`} />
        <ReconciliationCard preview={preview} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="Period">
            {parsed.periodStart && parsed.periodEnd ? `${formatDate(parsed.periodStart, { short: true })} – ${formatDate(parsed.periodEnd)}` : 'Not printed'}
          </Stat>
          <Stat label="Opening balance">{parsed.openingBalance !== undefined ? <Money value={parsed.openingBalance} /> : 'Not printed'}</Stat>
          <Stat label="Closing balance">{parsed.closingBalance !== undefined ? <Money value={parsed.closingBalance} /> : 'Not printed'}</Stat>
          <Stat label={`Money out (${debitCount})`}>
            <Money value={stats.debits} />
          </Stat>
          <Stat label={`Money in (${creditCount})`}>
            <Money value={stats.credits} />
          </Stat>
          <Stat label="New / already imported">
            {stats.new} / {stats.duplicates}
          </Stat>
          <Stat label="Need review">{stats.needsReview}</Stat>
        </dl>
      </Card>

      {parsed.warnings.length > 0 && (
        <Notice tone="warning" title="Warnings from the statement">
          <ul className="list-disc pl-4">
            {parsed.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}

      {parsed.skipped.length > 0 && (
        <Card>
          <button
            type="button"
            className="flex min-h-touch w-full items-center justify-between gap-2 text-left text-sm font-medium text-fg"
            aria-expanded={showSkipped}
            onClick={() => setShowSkipped((v) => !v)}
          >
            <span>
              {parsed.skipped.length} line{parsed.skipped.length === 1 ? '' : 's'} looked like transactions but were skipped
            </span>
            {showSkipped ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
          {showSkipped && (
            <ul className="mt-2 divide-y divide-border text-xs">
              {parsed.skipped.map((s, i) => (
                <li key={`${s.page}-${s.line}-${i}`} className="py-2">
                  <p className="text-fg-muted">
                    Page {s.page}, line {s.line}: {s.reason}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-fg">{s.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <section aria-label="Rows to import">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">
            {includedCount} of {preview.rows.length} rows will be imported
          </h3>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={committing} onClick={() => setExcluded(new Set())}>
              Include all
            </Button>
            <Button size="sm" variant="ghost" disabled={committing} onClick={() => setExcluded(new Set(preview.rows.map((r) => r.index)))}>
              Exclude all
            </Button>
          </div>
        </div>
        {(amountRows.length > 0 || categoryRows.length > 0) && (
          <div className="mb-2 space-y-1">
            <SegmentedControl<RowFilter>
              label="Which rows to show"
              value={rowFilter}
              onChange={(v) => {
                setRowFilter(v);
                setVisible(PAGE);
              }}
              options={[
                { value: 'all', label: `All (${preview.rows.length})` },
                { value: 'amounts', label: `Check amounts (${amountRows.length})` },
                { value: 'categories', label: `Confirm categories (${categoryRows.length})` },
              ]}
            />
            {rowFilter === 'amounts' && <p className="text-xs text-fg-muted">The statement text for these rows did not add up cleanly. Compare them with your statement.</p>}
            {rowFilter === 'categories' && <p className="text-xs text-fg-muted">The amounts look fine; only the category is unsure. You can confirm these in bulk after importing.</p>}
          </div>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {shown.map((r) => {
            const u = r.understanding;
            const warnings = r.row.warnings;
            const isIncluded = included(r);
            const rowLocked = locked(r);
            return (
              <li key={r.index} className={isIncluded ? '' : 'bg-surface-2/60'}>
                <label className="flex min-h-[56px] cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-primary"
                    checked={isIncluded}
                    disabled={committing || rowLocked}
                    onChange={() => toggle(r.index)}
                    aria-label={`Include ${u.merchant} on ${formatDate(r.row.date)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-fg">{u.merchant}</span>
                      <Money value={r.row.amount} direction={r.row.direction} tone="direction" className="shrink-0 text-sm font-semibold" />
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {formatDate(r.row.date, { short: true })} · {r.row.description}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-fg-muted">
                        {KIND_LABELS[u.kind]} · {categoryName(u.category)}
                      </span>
                      {r.duplicateOf !== undefined && <Badge tone="info">{rowLocked ? 'Already imported, skipped' : 'Duplicate'}</Badge>}
                      {u.needsReview && <Badge tone="warning">Needs review</Badge>}
                      {warnings.map((w) => (
                        <Badge key={w} tone={WARNING_LABELS[w].tone}>
                          {WARNING_LABELS[w].label}
                        </Badge>
                      ))}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {visible < listed.length && (
          <div className="py-3 text-center">
            <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)}>
              Show more ({listed.length - visible} remaining)
            </Button>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur pb-safe">
        <Button onClick={confirm} loading={committing} disabled={includedCount === 0}>
          {actionLabel}
        </Button>
        <Button variant="outline" onClick={onBack} disabled={committing}>
          Back
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={committing}>
          Cancel
        </Button>
        {includedCount === 0 && !committing && <span className="text-sm text-fg-muted">Nothing new to import.</span>}
      </div>
    </div>
  );
}
