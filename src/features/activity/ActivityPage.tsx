import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, SearchX } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { useLedger } from '@/db/hooks';
import { todayIso } from '@/lib/dates';
import { applyQuery, summarize } from '@/engine/analytics';
import { Button, Card, EmptyState, Money, Notice, SegmentedControl, Skeleton, useToast } from '@/ui';
import { csvFilename, downloadCsv, transactionsToCsv } from '../reports/csv';
import { ActivityFilters } from './ActivityFilters';
import { ReviewQueue } from './ReviewQueue';
import { ShortcutHelp } from './ShortcutHelp';
import { TransactionDetail } from './TransactionDetail';
import { TransactionList } from './TransactionList';
import { activeFilterCount, buildQuery, useActivityFilters } from './useActivityFilters';
import { shortcutsBlocked, useIsDesktop } from './useIsDesktop';
import { useSuggest } from './useSuggest';

interface SavedView {
  y: number;
  visible: number;
}
const storageKey = (k: string) => `vm-activity-view:${k}`;
function readSaved(k: string): SavedView | null {
  try {
    const raw = sessionStorage.getItem(storageKey(k));
    return raw ? (JSON.parse(raw) as SavedView) : null;
  } catch {
    return null;
  }
}
function writeSaved(k: string, v: SavedView) {
  try {
    sessionStorage.setItem(storageKey(k), JSON.stringify(v));
  } catch {
    /* private mode: restoring is a convenience only */
  }
}

export default function ActivityPage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const { period } = usePeriod();
  const ledger = useLedger();
  const suggest = useSuggest(ledger.accounts, ledger.customCategories);
  const { filters, filterKey, update, clearAll } = useActivityFilters();
  const txnId = params.get('txn') ?? undefined;
  const isDesktop = useIsDesktop();
  const searchRef = useRef<HTMLInputElement>(null);
  const [helpSignal, setHelpSignal] = useState(0);

  // Deep link with review=1 opens the focused queue; the view can then be switched to the plain list.
  const [reviewView, setReviewView] = useState<'queue' | 'list'>(filters.review ? 'queue' : 'list');

  const query = useMemo(() => buildQuery(filters, period), [filters, period]);
  const filtered = useMemo(
    () => (ledger.ready ? applyQuery(ledger.transactions, query) : []),
    [ledger.ready, ledger.transactions, query],
  );
  const summary = useMemo(
    () =>
      ledger.ready
        ? summarize(filtered, {
            accounts: ledger.accounts,
            statements: ledger.statements,
            customCategories: ledger.customCategories,
            start: period.start,
            end: period.end,
            today: todayIso(),
          })
        : null,
    [ledger.ready, filtered, ledger.accounts, ledger.statements, ledger.customCategories, period.start, period.end],
  );

  const accountNames = useMemo(() => new Map(ledger.accounts.map((a) => [a.id, a.name])), [ledger.accounts]);

  const openTxn = useCallback(
    (id: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('txn', id);
        return next;
      }),
    [setParams],
  );
  const closeTxn = useCallback(
    () =>
      setParams(
        (prev) => {
          if (!prev.has('txn')) return prev;
          const next = new URLSearchParams(prev);
          next.delete('txn');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  function exportCsv() {
    let start = period.start;
    let end = period.end;
    if (filters.ids.length && filtered.length) {
      const dates = filtered.map((t) => t.date).sort();
      start = dates[0];
      end = dates[dates.length - 1];
    }
    const csv = transactionsToCsv(filtered, {
      accounts: ledger.accounts,
      customCategories: ledger.customCategories,
      statements: ledger.statements,
    });
    try {
      downloadCsv(csv, csvFilename(start, end));
      toast(`Exported ${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`, { tone: 'success' });
    } catch {
      toast('Could not create the CSV file on this device.', { tone: 'error' });
    }
  }

  const hasFilters = activeFilterCount(filters) > 0 || filters.ids.length > 0;
  const showQueue = filters.review && reviewView === 'queue';

  // Back returns to the same filters (they live in the URL) and the same scroll position and list length.
  const viewKey = `${filterKey}|${period.start}|${period.end}`;
  const saved = useMemo(() => readSaved(viewKey), [viewKey]);
  const visibleRef = useRef(saved?.visible ?? 0);
  const restored = useRef<string | null>(null);
  const listReady = ledger.ready && filtered.length > 0;
  useEffect(() => {
    if (!listReady || restored.current === viewKey) return;
    restored.current = viewKey;
    if (!saved || saved.y <= 0) return;
    const t = setTimeout(() => window.scrollTo?.(0, saved.y), 60); // after the shell's own scroll-to-top
    return () => clearTimeout(t);
  }, [listReady, viewKey, saved]);
  useEffect(() => {
    const save = () => writeSaved(viewKey, { y: window.scrollY, visible: visibleRef.current });
    window.addEventListener('pagehide', save);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
    };
  }, [viewKey]);

  // Page-level shortcuts; j / k / Enter live with the list that owns the rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDesktop && txnId && !shortcutsBlocked(e)) {
        closeTxn();
        return;
      }
      if (shortcutsBlocked(e)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '?') {
        setHelpSignal((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, txnId, closeTxn]);

  usePageChrome({
    title: 'Activity',
    showPeriod: true,
    actions: (
      <Button
        variant="outline"
        size="sm"
        disabled={!ledger.ready || filtered.length === 0}
        onClick={exportCsv}
        icon={<Download className="h-4 w-4" aria-hidden />}
      >
        <span className="hidden sm:inline">Export CSV</span>
        <span className="sm:hidden">CSV</span>
      </Button>
    ),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 lg:max-w-6xl">
      <p className="sr-only">Keyboard shortcuts: j and k move between transactions, Enter opens one, slash searches, Escape closes details.</p>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-5">
      <div className="min-w-0 space-y-3">
      <ShortcutHelp openSignal={helpSignal} />
      {filters.ids.length > 0 && (
        <Notice
          tone="info"
          action={
            <Button size="sm" variant="outline" onClick={() => update({ ids: [] })}>
              Show all
            </Button>
          }
        >
          {ledger.ready
            ? `Showing ${filtered.length} transaction${filtered.length === 1 ? '' : 's'} from an insight`
            : 'Showing transactions from an insight'}
        </Notice>
      )}

      {/* Always mounted: loading never replaces the search box or open editors. */}
      <ActivityFilters
        filters={filters}
        accounts={ledger.accounts}
        customCategories={ledger.customCategories}
        onChange={update}
        onClearAll={clearAll}
        searchRef={searchRef}
      />

      <section aria-label="Results" aria-live="polite" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-sm">
        {summary ? (
          <>
            <span className="font-medium text-fg">
              {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
            </span>
            <span className="flex flex-wrap gap-x-4 text-fg-muted">
              <span>
                Spending <Money value={summary.spending} className="font-medium text-fg" />
              </span>
              <span>
                Income <Money value={summary.income} className="font-medium text-fg" />
              </span>
            </span>
          </>
        ) : (
          <Skeleton className="h-5 w-full" />
        )}
      </section>

      {filters.review && (
        <SegmentedControl
          label="Review view"
          value={reviewView}
          onChange={setReviewView}
          options={[
            { value: 'queue', label: 'One by one' },
            { value: 'list', label: 'List' },
          ]}
        />
      )}

      {!ledger.ready ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading transactions">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : showQueue ? (
        <ReviewQueue
          suggest={suggest}
          txns={filtered}
          allTxns={ledger.transactions}
          accountNames={accountNames}
          customCategories={ledger.customCategories}
          onOpen={openTxn}
          onExit={() => {
            update({ review: false });
            setReviewView('list');
          }}
        />
      ) : filtered.length === 0 ? (
        <Card>
          {ledger.transactions.length === 0 ? (
            <EmptyState
              icon={<SearchX className="h-6 w-6" aria-hidden />}
              title="No transactions yet"
              body="Import a bank or credit-card statement to see every transaction here."
            />
          ) : (
            <EmptyState
              icon={<SearchX className="h-6 w-6" aria-hidden />}
              title="Nothing matches"
              body={hasFilters ? 'Try removing a filter or choosing a longer period.' : 'No transactions in this period. Try a longer period.'}
              action={hasFilters ? <Button variant="outline" onClick={clearAll}>Clear filters</Button> : undefined}
            />
          )}
        </Card>
      ) : (
        <TransactionList
          key={viewKey}
          txns={filtered}
          activeId={txnId}
          initialVisible={saved?.visible}
          onVisibleChange={(v) => {
            visibleRef.current = v;
          }}
          accountNames={accountNames}
          customCategories={ledger.customCategories}
          onOpen={openTxn}
        />
      )}

      </div>
      {isDesktop && <TransactionDetail pane txnId={txnId} onClose={closeTxn} onOpenTxn={openTxn} />}
      </div>
      {!isDesktop && <TransactionDetail txnId={txnId} onClose={closeTxn} onOpenTxn={openTxn} />}
    </div>
  );
}
