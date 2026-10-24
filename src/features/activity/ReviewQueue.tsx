import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, SkipForward, Sparkles } from 'lucide-react';
import { markReviewed } from '@/db/actions';
import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { CustomCategory, ExpenseTag, Transaction } from '@/domain/types';
import { reviewPriority, type CategorySuggestion, type ReviewItem } from '@/engine/understand';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Card, CategoryIcon, EmptyState, Money, Notice, ProgressBar, SegmentedControl, useToast } from '@/ui';
import { CorrectionPrompt } from './CorrectionPrompt';
import { categorySourceLabel, percentText } from './labels';
import { popularCategories } from './popularCategories';
import { groupKey, isExtractionIssue } from './reviewKinds';
import { useTagging } from './tagging';
import { TagSelect } from './TxnExtras';
import { errorMessage, useCorrection, type PendingChange } from './useCorrection';

interface QueueEntry {
  txn: Transaction;
  item?: ReviewItem;
}
interface Group {
  key: string;
  entries: QueueEntry[];
}

/** Highest-impact first: teaching one merchant fixes the most rows and money. */
function orderQueue(txns: readonly Transaction[]): QueueEntry[] {
  const pending = txns.filter((t) => t.needsReview);
  const byId = new Map(pending.map((t) => [t.id, t]));
  const entries: QueueEntry[] = [];
  const seen = new Set<string>();
  for (const item of reviewPriority(pending)) {
    const txn = byId.get(item.txnId);
    if (txn && !seen.has(txn.id)) {
      seen.add(txn.id);
      entries.push({ txn, item });
    }
  }
  // Anything the ranking did not mention keeps its place at the end rather than disappearing.
  for (const txn of pending) if (!seen.has(txn.id)) entries.push({ txn });
  return entries;
}

function groupEntries(entries: readonly QueueEntry[]): Group[] {
  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (const e of entries) {
    const key = groupKey(e.txn);
    let g = index.get(key);
    if (!g) {
      g = { key, entries: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

type Tab = 'amounts' | 'categories';

/**
 * Two different questions, kept apart: "is this amount read correctly?" (extraction problems) and
 * "is this the right category?" (decisions, asked once per merchant or UPI id for all its rows).
 * Skipped items are remembered locally and reappear after a reload; answered rows leave because the data is reactive.
 */
export function ReviewQueue({
  txns,
  allTxns,
  accountNames,
  customCategories,
  suggest,
  onOpen,
  onExit,
}: {
  txns: readonly Transaction[];
  allTxns: readonly Transaction[];
  accountNames: ReadonlyMap<string, string>;
  customCategories: readonly CustomCategory[];
  /** Top suggestions for a transaction (engine `suggestCategories` with the ledger context applied). */
  suggest: (txn: Transaction) => CategorySuggestion[];
  onOpen: (id: string) => void;
  onExit: () => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [total] = useState(txns.length);
  const ordered = useMemo(() => orderQueue(txns), [txns]);
  const open = useMemo(() => ordered.filter((e) => !hidden.has(e.txn.id) && !skipped.has(e.txn.id)), [ordered, hidden, skipped]);
  const amountEntries = useMemo(() => open.filter((e) => isExtractionIssue(e.txn)), [open]);
  const groups = useMemo(() => groupEntries(open.filter((e) => !isExtractionIssue(e.txn))), [open]);
  const [tab, setTab] = useState<Tab>(() => (ordered.some((e) => isExtractionIssue(e.txn)) ? 'amounts' : 'categories'));
  const active: Tab = tab === 'amounts' ? (amountEntries.length > 0 || groups.length === 0 ? 'amounts' : 'categories') : groups.length > 0 || amountEntries.length === 0 ? 'categories' : 'amounts';

  const hide = useCallback((ids: readonly string[]) => setHidden((prev) => new Set([...prev, ...ids])), []);
  const skip = useCallback((ids: readonly string[]) => setSkipped((prev) => new Set([...prev, ...ids])), []);

  if (open.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" aria-hidden />}
          title={ordered.length === 0 ? 'Nothing left to review' : 'You have gone through them all'}
          body={
            skipped.size > 0
              ? `${skipped.size} skipped. They stay marked “Needs review” until you confirm them.`
              : 'Every transaction here has been checked.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {skipped.size > 0 && (
                <Button variant="outline" onClick={() => setSkipped(new Set())}>
                  Review skipped again
                </Button>
              )}
              <Button onClick={onExit}>See all transactions</Button>
            </div>
          }
        />
      </Card>
    );
  }

  const done = Math.max(0, total - open.length);
  const group = groups[0];
  const amount = amountEntries[0];
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>{open.length} left to review</span>
        </div>
        <ProgressBar value={total ? done / total : 0} label="Review progress" />
      </div>

      {amountEntries.length > 0 && groups.length > 0 && (
        <SegmentedControl<Tab>
          label="What to review"
          value={active}
          onChange={setTab}
          options={[
            { value: 'amounts', label: `Check these amounts (${amountEntries.length})` },
            { value: 'categories', label: `Confirm categories (${groups.length})` },
          ]}
        />
      )}

      {active === 'amounts' && amount ? (
        <AmountCard
          key={amount.txn.id}
          txn={amount.txn}
          accountName={accountNames.get(amount.txn.accountId) ?? 'Account'}
          customCategories={customCategories}
          onSkip={() => skip([amount.txn.id])}
          onOpen={onOpen}
        />
      ) : group ? (
        <GroupCard
          key={group.key}
          rows={group.entries.map((e) => e.txn)}
          item={group.entries[0].item}
          allTxns={allTxns}
          accountNames={accountNames}
          customCategories={customCategories}
          suggestions={suggest(group.entries[0].txn)}
          onSkip={(ids) => skip(ids)}
          onAnswered={hide}
          onOpen={onOpen}
        />
      ) : null}
    </div>
  );
}

/** An amount, direction or date that may be misread: show the statement's own text next to it. */
function AmountCard({
  txn,
  accountName,
  customCategories,
  onSkip,
  onOpen,
}: {
  txn: Transaction;
  accountName: string;
  customCategories: readonly CustomCategory[];
  onSkip: () => void;
  onOpen: (id: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await markReviewed([txn.id]);
      toast('Amount confirmed', { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card role="region" aria-label="Check this amount" className="space-y-4">
      <div className="flex items-start gap-3">
        <CategoryIcon category={txn.category} custom={customCategories} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{txn.merchant}</p>
          <p className="text-sm text-fg-muted">
            {formatDate(txn.date)} · {accountName} · page {txn.source.page}
          </p>
        </div>
        <Money value={txn.amount} direction={txn.direction} tone="direction" className="text-lg font-semibold" />
      </div>
      <Notice tone="warning" title="This amount may be misread">
        <ul className="list-disc pl-4">
          {txn.reviewReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Notice>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">As printed on the statement</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 font-mono text-xs text-fg">
          {txn.source.rawLines.join('\n') || txn.rawDescription}
        </pre>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" loading={busy} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} onClick={confirm}>
          Amount is correct
        </Button>
        <Button variant="outline" icon={<SkipForward className="h-4 w-4" aria-hidden />} onClick={onSkip}>
          Skip
        </Button>
        <Button variant="ghost" onClick={() => onOpen(txn.id)}>
          More options
        </Button>
      </div>
    </Card>
  );
}

const PREVIEW_ROWS = 6;

/** One decision for one merchant or UPI id, with a preview of every row it would touch. */
function GroupCard({
  rows,
  item,
  allTxns,
  accountNames,
  customCategories,
  suggestions,
  onSkip,
  onAnswered,
  onOpen,
}: {
  rows: Transaction[];
  item?: ReviewItem;
  allTxns: readonly Transaction[];
  accountNames: ReadonlyMap<string, string>;
  customCategories: readonly CustomCategory[];
  suggestions: CategorySuggestion[];
  onSkip: (ids: string[]) => void;
  onAnswered: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const { toast } = useToast();
  const tagTransactions = useTagging();
  const lead = rows[0];
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(rows.map((r) => r.id)));
  const [showAll, setShowAll] = useState(false);
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);

  // A deliberate answer is also a review decision, so the affected rows leave the queue.
  const afterApplied = useCallback(
    async (change: PendingChange, scope: 'this' | 'merchant' | 'selected', ids?: string[]) => {
      const affected = scope === 'selected' ? (ids ?? []) : scope === 'merchant' ? rows.map((r) => r.id) : [lead.id];
      if (change.type === 'category' || change.type === 'kind') await markReviewed(affected);
      onAnswered(affected);
    },
    [rows, lead.id, onAnswered],
  );
  const correction = useCorrection(lead, allTxns, afterApplied);
  const suggestedIds = useMemo(() => new Set(suggestions.map((s) => s.category)), [suggestions]);
  const others = useMemo(
    () => popularCategories(lead, allTxns, 8).filter((id) => !suggestedIds.has(id)).slice(0, 5),
    [lead, allTxns, suggestedIds],
  );
  const alsoFixes = Math.max(rows.length - 1, item?.sameMerchantCount ?? 0);
  const shown = showAll ? rows : rows.slice(0, PREVIEW_ROWS);

  const askScope = (id: string) =>
    correction.request({ type: 'category', value: id, label: `Change category to “${categoryName(id, customCategories)}”` });

  async function confirm(ids: string[]) {
    setBusy(true);
    try {
      await markReviewed(ids);
      onAnswered(ids);
      toast(ids.length === 1 ? 'Marked as reviewed' : `Marked ${ids.length} as reviewed`, { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card role="region" aria-label="Review transaction" className="space-y-4">
      <div className="flex items-start gap-3">
        <CategoryIcon category={lead.category} custom={customCategories} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{lead.merchant}</p>
          <p className="text-sm text-fg-muted">
            {rows.length} transaction{rows.length === 1 ? '' : 's'}
            {lead.counterparty.vpa ? ` · ${lead.counterparty.vpa}` : ''}
          </p>
        </div>
        <Money value={lead.amount} direction={lead.direction} tone="direction" className="text-lg font-semibold" />
      </div>

      {alsoFixes > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
          Fixing this also fixes {alsoFixes} more
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge>{KIND_LABELS[lead.kind]}</Badge>
        <Badge tone={lead.category === 'uncategorized' ? 'warning' : 'neutral'}>{categoryName(lead.category, customCategories)}</Badge>
        <span className="self-center text-fg-subtle">{categorySourceLabel(lead.categorySource, lead.confidence)}</span>
      </div>
      {lead.reviewReasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
          {lead.reviewReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {/* fieldsets default to min-width: min-content, which forces sideways scrolling on narrow screens */}
      <fieldset className="min-w-0">
        <legend className="mb-1 max-w-full whitespace-normal text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Rows this could change ({selectedIds.length} of {rows.length} selected)
        </legend>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {shown.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-touch cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-primary"
                  checked={selected.has(r.id)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                  aria-label={`Include ${formatDate(r.date)} ${r.merchant}`}
                />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block truncate text-fg">{formatDate(r.date, { short: true })} · {accountNames.get(r.accountId) ?? 'Account'}</span>
                  <span className="block truncate font-mono text-xs text-fg-muted">{r.rawDescription}</span>
                </span>
                <Money value={r.amount} direction={r.direction} tone="direction" className="ml-auto text-sm" />
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <p className="mb-1 text-xs text-fg-muted">Tag the {selectedIds.length} selected</p>
          {(() => {
            const picked = rows.filter((r) => selected.has(r.id));
            const tags = new Set(picked.map((r) => r.tag ?? ''));
            return (
              <TagSelect
                label="Tag selected transactions"
                current={tags.size === 1 ? ([...tags][0] as ExpenseTag | '') : 'mixed'}
                onPick={(tag) => void tagTransactions(picked, tag)}
              />
            );
          })()}
        </div>
        {rows.length > PREVIEW_ROWS && (
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </Button>
        )}
      </fieldset>

      <div className="space-y-3">
        <p className="text-sm font-medium text-fg">What is it?</p>
        {suggestions.length > 0 && (
          <div role="group" aria-label="Suggested categories" className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((s) => {
              const name = categoryName(s.category, customCategories);
              return (
                <button
                  key={s.category}
                  type="button"
                  disabled={correction.busy}
                  onClick={() => askScope(s.category)}
                  aria-label={`${name}, ${percentText(s.probability)} likely`}
                  className="min-h-touch rounded-xl border border-border-strong bg-surface p-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <CategoryIcon category={s.category} custom={customCategories} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{name}</span>
                    <span className="text-xs font-semibold text-fg-muted">{percentText(s.probability)}</span>
                  </span>
                  <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.max(0, Math.min(1, s.probability)) * 100)}%` }} />
                  </span>
                  <span className="mt-1.5 block text-xs text-fg-muted">{s.reason}</span>
                </button>
              );
            })}
          </div>
        )}
        {others.length > 0 && (
          <div>
            {suggestions.length > 0 && <p className="mb-1.5 text-xs text-fg-muted">Or pick another</p>}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Other categories">
              {others.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={correction.busy}
                  onClick={() => askScope(id)}
                  className="inline-flex min-h-touch items-center gap-2 rounded-full border border-border-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
                >
                  <CategoryIcon category={id} custom={customCategories} size="sm" className="h-6 w-6 rounded-full" />
                  {categoryName(id, customCategories)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {correction.pending && (
        <CorrectionPrompt
          change={correction.pending.label}
          merchant={lead.merchant}
          merchantRows={correction.merchantRows}
          busy={correction.busy}
          error={correction.error}
          onChoose={correction.apply}
          selectedRows={rows.filter((r) => selected.has(r.id))}
          onChooseSelected={rows.length > 1 ? () => void correction.applySelected(selectedIds) : undefined}
          onCancel={correction.cancel}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" loading={busy} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} onClick={() => void confirm([lead.id])}>
          Looks right
        </Button>
        {rows.length > 1 && (
          <Button variant="outline" disabled={busy || selectedIds.length === 0} onClick={() => void confirm(selectedIds)}>
            Looks right for {selectedIds.length} selected
          </Button>
        )}
        <Button variant="outline" icon={<SkipForward className="h-4 w-4" aria-hidden />} onClick={() => onSkip(rows.map((r) => r.id))}>
          Skip
        </Button>
        <Button variant="ghost" onClick={() => onOpen(lead.id)}>
          More options
        </Button>
      </div>
    </Card>
  );
}
