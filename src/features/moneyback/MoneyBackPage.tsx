import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { activityLink } from '@/app/routes';
import { useLedger } from '@/db/hooks';
import { useRefundAllocations, useRefundCases } from '@/db/moneyback';
import { moneyBack, type MoneyBackCase } from '@/engine/analytics';
import { formatDate, todayIso } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, Money, ProgressBar, SegmentedControl, Skeleton, TabPanel, Tabs } from '@/ui';
import { CaseSheet, MatchSheet, TrackSheet, type CreditToMatch } from './Sheets';
import { STATUS_INFO, agingText } from './helpers';

type TabId = 'received' | 'expected' | 'matching';
type ViewId = 'statement' | 'purchase';

const VIEW_NOTE: Record<ViewId, string> = {
  statement: 'Statement-period view: a refund counts in the period when the credit posted, even if the purchase was earlier.',
  purchase: 'Purchase view: each refund reduces the purchase it belongs to, whenever it arrived.',
};

function StatusBadge({ c }: { c: MoneyBackCase }) {
  const s = STATUS_INFO[c.status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function Amount({ value, fallback }: { value?: number; fallback: string }) {
  return value === undefined ? <span className="text-fg-muted">{fallback}</span> : <Money value={value} />;
}

/** Refund progress is only drawn when the expected amount is known; otherwise there is nothing honest to measure against. */
function Progress({ c }: { c: MoneyBackCase }) {
  if (c.expected === undefined || c.expected <= 0) return null;
  return <ProgressBar value={c.received / c.expected} tone="positive" label={`Refund received for ${c.case.merchant}`} />;
}

function purchaseLabel(c: MoneyBackCase): string {
  const first = c.purchases[0];
  if (!first) return 'Purchase not found';
  return `${formatDate(first.date, { short: true })}${c.purchases.length > 1 ? ` + ${c.purchases.length - 1} more` : ''}`;
}

function CaseList({ cases, onOpen, empty }: { cases: MoneyBackCase[]; onOpen: (id: string) => void; empty: string }) {
  if (cases.length === 0) return <p className="py-6 text-center text-sm text-fg-muted">{empty}</p>;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Refunds you are tracking</caption>
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Purchase</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Purchase amount</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Expected</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Outstanding</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cases.map((c) => (
              <tr key={c.case.id}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onOpen(c.case.id)} className="text-left font-medium text-primary hover:underline">
                    {c.case.merchant}
                  </button>
                  <span className="block text-xs text-fg-muted">{purchaseLabel(c)}</span>
                </td>
                <td className="px-3 py-2 text-right"><Money value={c.purchaseTotal} /></td>
                <td className="px-3 py-2 text-right"><Amount value={c.expected} fallback="To confirm" /></td>
                <td className="px-3 py-2 text-right"><Money value={c.received} /></td>
                <td className="px-3 py-2 text-right"><Amount value={c.outstanding} fallback="Needs confirmation" /></td>
                <td className="px-3 py-2">
                  <StatusBadge c={c} />
                  {agingText(c) && <span className={c.overdue ? 'mt-1 block text-xs text-warning' : 'mt-1 block text-xs text-fg-muted'}>{agingText(c)}</span>}
                  <div className="mt-1 w-28"><Progress c={c} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden" aria-label="Refunds you are tracking">
        {cases.map((c) => (
          <li key={c.case.id}>
            <Card className="space-y-2 p-3 sm:p-3">
              <button type="button" onClick={() => onOpen(c.case.id)} className="flex w-full items-start justify-between gap-3 text-left" aria-label={`Open refund for ${c.case.merchant}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-fg">{c.case.merchant}</span>
                  <span className="block text-xs text-fg-muted">{purchaseLabel(c)} · <Money value={c.purchaseTotal} /></span>
                </span>
                <StatusBadge c={c} />
              </button>
              <p className="text-sm text-fg-muted">
                Expected <Amount value={c.expected} fallback="to confirm" /> · Received <Money value={c.received} />
                {c.outstanding !== undefined && (
                  <>
                    {' '}· Outstanding <Money value={c.outstanding} />
                  </>
                )}
              </p>
              <Progress c={c} />
              {agingText(c) && <p className={c.overdue ? 'text-xs text-warning' : 'text-xs text-fg-muted'}>{agingText(c)}</p>}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function MoneyBackPage() {
  usePageChrome({ title: 'Money back', showPeriod: true, subtitle: 'Refunds and credits you are waiting for, and the ones that arrived.' });
  const { period } = usePeriod();
  const ledger = useLedger();
  const cases = useRefundCases();
  const allocations = useRefundAllocations();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>('expected');
  const [view, setView] = useState<ViewId>('statement');
  const [openCaseId, setOpenCaseId] = useState<string | null>(params.get('case'));
  const [trackFor, setTrackFor] = useState<{ txnId?: string } | null>(params.get('track') ? { txnId: params.get('track') ?? undefined } : null);
  const [matching, setMatching] = useState<{ credit: CreditToMatch; caseId?: string } | null>(null);
  const [matchParamHandled, setMatchParamHandled] = useState(false);
  /** Set when the user came from a case sheet: the next credit they pick is matched to this case. */
  const [focusCase, setFocusCase] = useState<string | null>(null);

  const today = todayIso();
  const data = useMemo(
    () => (ledger.ready && cases && allocations ? moneyBack(ledger.transactions, { cases, allocations, start: period.start, end: period.end, today }) : null),
    [ledger.ready, ledger.transactions, cases, allocations, period.start, period.end, today],
  );
  const dataThrough = useMemo(() => ledger.statements.reduce<string | null>((m, s) => (s.periodEnd && (!m || s.periodEnd > m) ? s.periodEnd : m), null), [ledger.statements]);

  const creditFor = (txnId: string): CreditToMatch | null => {
    const r = data?.received.find((x) => x.creditTxnId === txnId);
    if (r) return { creditTxnId: r.creditTxnId, date: r.date, amount: r.amount, merchant: r.merchant, unallocated: r.unallocated };
    const n = data?.needsMatching.find((x) => x.creditTxnId === txnId);
    if (n) return { creditTxnId: n.creditTxnId, date: n.date, amount: n.amount, merchant: n.merchant, unallocated: n.amount };
    const t = ledger.transactions.find((x) => x.id === txnId);
    return t ? { creditTxnId: t.id, date: t.date, amount: t.amount, merchant: t.merchant, unallocated: t.amount } : null;
  };
  // A link from a transaction ("Match this credit") opens the matching sheet once the data is there.
  const matchParam = params.get('match');
  useEffect(() => {
    if (!data || !matchParam || matchParamHandled) return;
    setMatchParamHandled(true);
    const credit = creditFor(matchParam);
    if (credit) setMatching({ credit });
    // creditFor reads `data` and the ledger, which are already in the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, matchParam, matchParamHandled]);

  const matchingCredits = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: { creditTxnId: string; date: string; amount: number; merchant: string; candidates: number }[] = [];
    for (const n of data.needsMatching) {
      seen.add(n.creditTxnId);
      out.push({ creditTxnId: n.creditTxnId, date: n.date, amount: n.amount, merchant: n.merchant, candidates: n.candidatePurchaseIds.length });
    }
    // Part-matched credits still have money left to place.
    for (const r of data.received) if (r.unallocated > 0 && !seen.has(r.creditTxnId)) out.push({ creditTxnId: r.creditTxnId, date: r.date, amount: r.unallocated, merchant: r.merchant, candidates: 0 });
    return out;
  }, [data]);
  const openCase = data?.cases.find((c) => c.case.id === openCaseId) ?? null;
  const expectedCases = data?.cases.filter((c) => c.status === 'expected' || c.status === 'partially_received' || c.status === 'amount_to_confirm') ?? [];
  const receivedCases = data?.cases.filter((c) => c.received > 0) ?? [];
  const clearParam = (key: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(key);
      return next;
    }, { replace: true });

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading money back">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">Received in this period</dt>
              <dd className="text-lg font-semibold text-fg"><Money value={data.totals.receivedInPeriod} /></dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Still expected</dt>
              <dd className="text-lg font-semibold text-fg"><Money value={data.totals.expectedOutstanding} /></dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Open refunds</dt>
              <dd className="text-lg font-semibold text-fg">{data.totals.openCases}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Amount to confirm</dt>
              <dd className="text-lg font-semibold text-fg">{data.totals.amountToConfirm}</dd>
            </div>
          </dl>
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setTrackFor({})}>
            Track an expected refund
          </Button>
        </div>
        <p className="text-xs text-fg-muted">{dataThrough ? `Data through ${formatDate(dataThrough)}. Credits after that date have not been imported yet.` : 'No statements imported yet.'}</p>
      </Card>

      <div className="space-y-1">
        <SegmentedControl<ViewId>
          label="How to count refunds"
          value={view}
          onChange={setView}
          options={[
            { value: 'statement', label: 'Statement period' },
            { value: 'purchase', label: 'Purchase' },
          ]}
        />
        <p className="text-xs text-fg-muted">{VIEW_NOTE[view]}</p>
      </div>

      <Tabs<TabId>
        label="Money back"
        idBase="mb"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'received', label: 'Received', count: view === 'statement' ? data.received.length : receivedCases.length },
          { value: 'expected', label: 'Expected', count: expectedCases.length },
          { value: 'matching', label: 'Needs matching', count: data.needsMatching.length },
        ]}
      />

      <TabPanel idBase="mb" value="received" active={tab === 'received'}>
        {view === 'purchase' ? (
          <CaseList cases={receivedCases} onOpen={setOpenCaseId} empty="No refunds have arrived for the purchases you track." />
        ) : data.received.length === 0 ? (
          <EmptyState title="Nothing received in this period" body="Credits that look like refunds appear here when they post." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Credits received">
            {data.received.map((r) => (
              <li key={r.creditTxnId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={activityLink({ txn: r.creditTxnId })} className="font-medium text-primary hover:underline">{r.merchant}</Link>
                  <p className="text-xs text-fg-muted">
                    {formatDate(r.date)} ·{' '}
                    {r.unallocated > 0 ? (
                      <>
                        <Money value={r.unallocated} /> not matched to a purchase yet
                      </>
                    ) : (
                      'matched to a purchase'
                    )}
                  </p>
                </div>
                <Money value={r.amount} direction="credit" tone="direction" className="font-semibold" />
                {r.unallocated > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setMatching({ credit: creditFor(r.creditTxnId)! })}>
                    Match this credit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </TabPanel>

      <TabPanel idBase="mb" value="expected" active={tab === 'expected'}>
        <CaseList cases={expectedCases} onOpen={setOpenCaseId} empty="Nothing is being tracked. Track an expected refund to keep count of it." />
        {expectedCases.some((c) => c.received === 0) && <p className="mt-2 text-xs text-fg-muted">“No matching credit found in these statements” may just mean it has not arrived yet.</p>}
      </TabPanel>

      <TabPanel idBase="mb" value="matching" active={tab === 'matching'}>
        {focusCase && (
          <p className="mb-2 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary" role="status">
            Choose the credit that belongs to {data.cases.find((c) => c.case.id === focusCase)?.case.merchant ?? 'this refund'}.
          </p>
        )}
        {matchingCredits.length === 0 ? (
          <EmptyState title="Every refund-like credit is matched" body="Credits that might be refunds but have no purchase yet would be listed here." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Credits to match">
            {matchingCredits.map((n) => (
              <li key={n.creditTxnId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{n.merchant}</p>
                  <p className="text-xs text-fg-muted">
                    {formatDate(n.date)} · Needs confirmation{n.candidates > 0 ? ` · ${n.candidates} possible purchase${n.candidates === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <Money value={n.amount} direction="credit" tone="direction" className="font-semibold" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const credit = creditFor(n.creditTxnId);
                    if (credit) setMatching({ credit, caseId: focusCase ?? undefined });
                  }}
                >
                  Match this credit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>

      <CaseSheet
        data={openCase}
        onClose={() => setOpenCaseId(null)}
        onMatch={(caseId) => {
          setOpenCaseId(null);
          setFocusCase(caseId);
          setTab('matching');
        }}
        transactions={ledger.transactions}
      />
      <TrackSheet
        key={trackFor?.txnId ?? 'new'}
        open={trackFor !== null}
        initialTxnId={trackFor?.txnId}
        transactions={ledger.transactions}
        onClose={() => {
          setTrackFor(null);
          clearParam('track');
        }}
      />
      <MatchSheet
        key={`${matching?.credit.creditTxnId ?? 'none'}-${matching?.caseId ?? ''}`}
        credit={matching?.credit ?? null}
        initialCaseId={matching?.caseId}
        cases={data.cases}
        onClose={() => {
          setMatching(null);
          setFocusCase(null);
          clearParam('match');
        }}
      />
    </div>
  );
}
