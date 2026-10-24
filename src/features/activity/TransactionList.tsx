import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Link2 } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import type { CustomCategory, Transaction } from '@/domain/types';
import { formatDate, weekday } from '@/lib/dates';
import { Badge, CategoryIcon, Money, cn } from '@/ui';
import { shortcutsBlocked } from './useIsDesktop';
import { weekdayName } from './labels';

export const PAGE_SIZE = 60;

export const TransactionRow = memo(function TransactionRow({
  txn,
  accountName,
  customCategories,
  onOpen,
  active,
  current,
}: {
  txn: Transaction;
  accountName: string;
  customCategories: readonly CustomCategory[];
  onOpen: (id: string) => void;
  /** This row's detail is open. */
  active?: boolean;
  /** The keyboard cursor (j/k) is on this row. */
  current?: boolean;
}) {
  // Merchant, category, account and amount only. How it was decided lives in the detail view.
  const what = categoryName(txn.category, customCategories);
  const label = `${txn.merchant}, ${txn.direction === 'credit' ? 'received' : 'paid'}. Open details`;
  return (
    <li id={`txn-${txn.id}`}>
      <button
        type="button"
        onClick={() => onOpen(txn.id)}
        aria-label={label}
        data-testid="txn-row"
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2 sm:py-1.5',
          active && 'bg-primary-soft/60',
          current && 'ring-2 ring-inset ring-focus',
        )}
      >
        <CategoryIcon category={txn.category} custom={customCategories} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-fg">{txn.merchant}</span>
            {txn.linkedTxnId && <Link2 className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="Linked to another transaction" />}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
            <span className="truncate">
              {accountName} · {what}
            </span>
            {txn.needsReview && (
              <Badge tone="warning" className="shrink-0">
                Needs review
              </Badge>
            )}
          </span>
        </span>
        <Money value={txn.amount} direction={txn.direction} tone="direction" className="shrink-0 text-sm font-semibold" />
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-fg-subtle sm:block" aria-hidden />
      </button>
    </li>
  );
});

function groupByDate(txns: readonly Transaction[]): { date: string; items: Transaction[] }[] {
  const groups: { date: string; items: Transaction[] }[] = [];
  for (const t of txns) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }
  return groups;
}

/**
 * Date-grouped list with incremental rendering: the first page renders at once and
 * more rows are added by "Show more" or when the sentinel scrolls into view.
 * Mount this with a `key` that changes with the filters so the window resets.
 */
export function TransactionList({
  txns,
  accountNames,
  customCategories,
  onOpen,
  activeId,
  initialVisible = PAGE_SIZE,
  onVisibleChange,
}: {
  txns: readonly Transaction[];
  accountNames: ReadonlyMap<string, string>;
  customCategories: readonly CustomCategory[];
  onOpen: (id: string) => void;
  /** The transaction whose detail is open. */
  activeId?: string;
  /** Restores how far the user had scrolled/expanded the list. */
  initialVisible?: number;
  onVisibleChange?: (visible: number) => void;
}) {
  const [visible, setVisible] = useState(Math.max(PAGE_SIZE, initialVisible));
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const onVisibleRef = useRef(onVisibleChange);
  onVisibleRef.current = onVisibleChange;
  useEffect(() => onVisibleRef.current?.(visible), [visible]);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = visible < txns.length;

  const groups = useMemo(() => groupByDate(txns.slice(0, visible)), [txns, visible]);

  useEffect(() => {
    const el = sentinel.current;
    if (!hasMore || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible((v) => v + PAGE_SIZE);
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visible]);

  // j / k move the cursor, Enter opens it. Moving past the rendered rows renders more.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutsBlocked(e)) return;
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const from = txns.findIndex((t) => t.id === (cursorRef.current ?? activeId));
        const next = Math.max(0, Math.min(txns.length - 1, e.key === 'j' ? from + 1 : from < 0 ? 0 : from - 1));
        const target = txns[next];
        if (!target) return;
        setCursor(target.id);
        setVisible((v) => Math.max(v, next + 5));
        requestAnimationFrame(() => document.getElementById(`txn-${target.id}`)?.scrollIntoView?.({ block: 'nearest' }));
      } else if (e.key === 'Enter' && cursorRef.current && (e.target === document.body || e.target === null)) {
        e.preventDefault();
        onOpen(cursorRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [txns, activeId, onOpen]);

  return (
    <div>
      {groups.map((g) => (
        <section key={g.date} aria-label={formatDate(g.date)} className="mb-3">
          <h3 className="sticky top-[var(--vm-header-h,0px)] z-10 bg-bg/95 md:top-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted backdrop-blur">
            {weekdayName(weekday(g.date))}, {formatDate(g.date)}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {g.items.map((t) => (
              <TransactionRow
                key={t.id}
                txn={t}
                accountName={accountNames.get(t.accountId) ?? 'Account'}
                customCategories={customCategories}
                onOpen={onOpen}
                active={t.id === activeId}
                current={t.id === cursor}
              />
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <div ref={sentinel} className="py-4 text-center">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="min-h-touch rounded-xl px-4 text-sm font-medium text-primary hover:bg-surface-2"
          >
            Show more ({txns.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
