import { useCallback, useMemo, useState } from 'react';
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
import { TransactionDetail } from './TransactionDetail';
import { TransactionList } from './TransactionList';
import { activeFilterCount, buildQuery, useActivityFilters } from './useActivityFilters';
import { useSuggest } from './useSuggest';

export default function ActivityPage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const { period } = usePeriod();
  const ledger = useLedger();
  const suggest = useSuggest(ledger.accounts, ledger.customCategories);
  const { filters, filterKey, update, clearAll } = useActivityFilters();
  const txnId = params.get('txn') ?? undefined;

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
    <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4">

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
          key={`${filterKey}|${period.start}|${period.end}`}
          txns={filtered}
          accountNames={accountNames}
          customCategories={ledger.customCategories}
          onOpen={openTxn}
        />
      )}

      <TransactionDetail txnId={txnId} onClose={closeTxn} onOpenTxn={openTxn} />
    </div>
  );
}
