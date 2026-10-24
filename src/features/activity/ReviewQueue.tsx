import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, SkipForward, Sparkles } from 'lucide-react';
import { markReviewed, type CorrectionScope } from '@/db/actions';
import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { CustomCategory, Transaction } from '@/domain/types';
import { reviewPriority, type CategorySuggestion, type ReviewItem } from '@/engine/understand';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Card, CategoryIcon, EmptyState, Money, ProgressBar, useToast } from '@/ui';
import { CorrectionPrompt } from './CorrectionPrompt';
import { categorySourceLabel, percentText } from './labels';
import { popularCategories } from './popularCategories';
import { errorMessage, useCorrection, type PendingChange } from './useCorrection';

interface QueueEntry {
  txn: Transaction;
  item?: ReviewItem;
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

/**
 * One transaction at a time. Skipped items are remembered locally and reappear only after a reload;
 * reviewed or recategorised items leave the queue because the data is reactive. After an answer applied to
 * a whole merchant, the other rows of that merchant are moved past as well.
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
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [advanced, setAdvanced] = useState<ReadonlySet<string>>(new Set());
  const [total] = useState(txns.length);
  const ordered = useMemo(() => orderQueue(txns), [txns]);
  const queue = useMemo(() => ordered.filter((e) => !skipped.has(e.txn.id) && !advanced.has(e.txn.id)), [ordered, skipped, advanced]);
  const current = queue[0];

  const onAnswered = useCallback(
    (answered: Transaction, scope: CorrectionScope) => {
      if (scope !== 'merchant') return;
      setAdvanced((prev) => {
        const next = new Set(prev);
        for (const t of txns) if (t.merchantKey === answered.merchantKey) next.add(t.id);
        return next;
      });
    },
    [txns],
  );

  if (!current) {
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

  const done = Math.max(0, total - queue.length);
  return (
    <ReviewCard
      key={current.txn.id}
      txn={current.txn}
      item={current.item}
      remaining={queue.length}
      progress={total ? done / total : 0}
      allTxns={allTxns}
      accountName={accountNames.get(current.txn.accountId) ?? 'Account'}
      customCategories={customCategories}
      suggestions={suggest(current.txn)}
      onSkip={() => setSkipped((s) => new Set(s).add(current.txn.id))}
      onAnswered={onAnswered}
      onOpen={onOpen}
    />
  );
}

function ReviewCard({
  txn,
  item,
  remaining,
  progress,
  allTxns,
  accountName,
  customCategories,
  suggestions,
  onSkip,
  onAnswered,
  onOpen,
}: {
  txn: Transaction;
  item?: ReviewItem;
  remaining: number;
  progress: number;
  allTxns: readonly Transaction[];
  accountName: string;
  customCategories: readonly CustomCategory[];
  suggestions: CategorySuggestion[];
  onSkip: () => void;
  onAnswered: (txn: Transaction, scope: CorrectionScope) => void;
  onOpen: (id: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  // A deliberate category choice is a review decision too, so the item leaves the queue.
  const afterApplied = useCallback(
    async (change: PendingChange, scope: CorrectionScope) => {
      if (change.type === 'category' || change.type === 'kind') await markReviewed([txn.id]);
      onAnswered(txn, scope);
    },
    [txn, onAnswered],
  );
  const correction = useCorrection(txn, allTxns, afterApplied);
  const suggestedIds = useMemo(() => new Set(suggestions.map((s) => s.category)), [suggestions]);
  const others = useMemo(() => popularCategories(txn, allTxns, 8).filter((id) => !suggestedIds.has(id)).slice(0, 5), [txn, allTxns, suggestedIds]);
  const alsoFixes = item?.sameMerchantCount ?? 0;

  const askScope = (id: string) =>
    correction.request({ type: 'category', value: id, label: `Change category to “${categoryName(id, customCategories)}”` });

  async function looksRight() {
    setBusy(true);
    try {
      await markReviewed([txn.id]);
      toast('Marked as reviewed', { tone: 'success' });
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card role="region" aria-label="Review transaction" className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>{remaining} left to review</span>
        </div>
        <ProgressBar value={progress} label="Review progress" />
      </div>

      <div className="flex items-start gap-3">
        <CategoryIcon category={txn.category} custom={customCategories} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{txn.merchant}</p>
          <p className="text-sm text-fg-muted">
            {formatDate(txn.date)} · {accountName}
          </p>
        </div>
        <Money value={txn.amount} direction={txn.direction} tone="direction" className="text-lg font-semibold" />
      </div>

      {alsoFixes > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
          Fixing this also fixes {alsoFixes} more
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge>{KIND_LABELS[txn.kind]}</Badge>
        <Badge tone={txn.category === 'uncategorized' ? 'warning' : 'neutral'}>{categoryName(txn.category, customCategories)}</Badge>
        <span className="self-center text-fg-subtle">{categorySourceLabel(txn.categorySource, txn.confidence)}</span>
      </div>

      {txn.reviewReasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-muted">
          {txn.reviewReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="break-all rounded-xl bg-surface-2 p-3 font-mono text-xs text-fg-muted">{txn.rawDescription}</p>

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
          merchant={txn.merchant}
          otherCount={correction.otherCount}
          busy={correction.busy}
          error={correction.error}
          onChoose={correction.apply}
          onCancel={correction.cancel}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" loading={busy} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} onClick={looksRight}>
          Looks right
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
