import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { activityLink } from '@/app/routes';
import { useLedger } from '@/db/hooks';
import { useCardPolicies, useChargeLinks } from '@/db/moneyback';
import type { ChargeType, Transaction } from '@/domain/types';
import { feesSummary, type ChargeEvent, type FeesSummary } from '@/engine/analytics';
import { formatDate, formatMonth, formatMonthShort } from '@/lib/dates';
import { Badge, Card, CardHeader, ChartFrame, EmptyState, Money, Sheet, Skeleton, chartColor } from '@/ui';
import { CardTerms } from './CardTerms';
import { CHARGE_LABELS, STATUS_INFO, eligibilityText } from './helpers';

function Waterfall({ e }: { e: ChargeEvent }) {
  const top = Math.max(e.charge + e.tax, 1);
  const steps = [
    { label: 'Charge', value: e.charge, sign: '', cls: 'bg-negative' },
    { label: 'Tax on it', value: e.tax, sign: '+', cls: 'bg-warning' },
    { label: 'Reversed', value: e.reversed, sign: '−', cls: 'bg-positive' },
    { label: 'What it cost', value: e.net, sign: '', cls: 'bg-primary' },
  ];
  return (
    <ol aria-label="How this charge adds up" className="space-y-1.5">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
          <span className="text-fg-muted">{s.label}</span>
          <span aria-hidden className="h-3 overflow-hidden rounded bg-surface-2">
            <span className={`block h-full rounded ${s.cls}`} style={{ width: `${Math.min(100, (Math.abs(s.value) / top) * 100)}%` }} />
          </span>
          <span className="tabular font-medium">
            {s.sign}
            <Money value={Math.abs(s.value)} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function EventSheet({ event, txns, accountName, onClose }: { event: ChargeEvent | null; txns: readonly Transaction[]; accountName: (id: string) => string; onClose: () => void }) {
  const rows = event ? event.txnIds.map((id) => txns.find((t) => t.id === id)).filter((t): t is Transaction => Boolean(t)) : [];
  const related = event?.relatedPurchaseTxnId ? txns.find((t) => t.id === event.relatedPurchaseTxnId) : undefined;
  return (
    <Sheet
      open={event !== null}
      onClose={onClose}
      title={event ? `${CHARGE_LABELS[event.chargeType]} · ${formatDate(event.date)}` : 'Charge'}
      description={event ? accountName(event.accountId) : undefined}
      size="lg"
    >
      {event && (
        <div className="space-y-5 text-sm">
          <Waterfall e={event} />
          <p className="text-fg">{event.explanation}</p>
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-fg-muted">{eligibilityText(event)}</p>
          {related && (
            <p>
              Related purchase:{' '}
              <Link to={activityLink({ txn: related.id })} className="font-medium text-primary hover:underline">
                {related.merchant}, {formatDate(related.date)}
              </Link>{' '}
              (<Money value={related.amount} />)
            </p>
          )}
          <section aria-label="Statement rows">
            <h3 className="mb-1 font-semibold text-fg">Statement rows</h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.map((t) => (
                <li key={t.id} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link to={activityLink({ txn: t.id })} className="text-primary hover:underline">
                      {formatDate(t.date)}
                    </Link>
                    <Money value={t.amount} direction={t.direction} tone="direction" className="font-semibold" />
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-fg-muted">{t.source.rawLines.join('\n') || t.rawDescription}</pre>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Sheet>
  );
}

function MonthlyBars({ summary, scope }: { summary: FeesSummary; scope: string }) {
  const types = useMemo(() => {
    const seen = new Set<ChargeType>();
    for (const m of summary.byMonth) for (const t of Object.keys(m.byType) as ChargeType[]) seen.add(t);
    return [...seen];
  }, [summary.byMonth]);
  const max = Math.max(1, ...summary.byMonth.map((m) => m.net));
  const worst = [...summary.byMonth].sort((a, b) => b.net - a.net)[0];
  return (
    <ChartFrame
      question="What did charges cost each month?"
      scope={scope}
      takeaway={worst ? `${formatMonth(worst.month)} cost the most in charges.` : undefined}
      empty={summary.byMonth.length === 0 ? 'No charges in this period.' : undefined}
      table={
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Charges by month and type</caption>
            <thead>
              <tr className="text-left text-xs text-fg-muted">
                <th scope="col" className="py-1 pr-3 font-medium">Month</th>
                {types.map((t) => (
                  <th key={t} scope="col" className="px-2 py-1 text-right font-medium">{CHARGE_LABELS[t]}</th>
                ))}
                <th scope="col" className="px-2 py-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {summary.byMonth.map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <th scope="row" className="py-1 pr-3 text-left font-medium">{formatMonth(m.month)}</th>
                  {types.map((t) => (
                    <td key={t} className="px-2 py-1 text-right"><Money value={m.byType[t] ?? 0} /></td>
                  ))}
                  <td className="px-2 py-1 text-right"><Money value={m.net} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div role="img" aria-label={`Stacked bars of charges by month and type. ${worst ? `${formatMonth(worst.month)} is highest.` : ''}`}>
        <div className="flex h-40 items-end gap-2">
          {summary.byMonth.map((m) => (
            <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(m.net / max) * 100}%` }}>
                {types.map((t, i) => {
                  const v = m.byType[t] ?? 0;
                  return v > 0 ? <span key={t} style={{ flexGrow: v, backgroundColor: chartColor(i + 1) }} /> : null;
                })}
              </div>
              <span className="mt-1 truncate text-center text-[10px] text-fg-muted">{formatMonthShort(m.month)}</span>
            </div>
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted" aria-label="Charge types">
          {types.map((t, i) => (
            <li key={t} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: chartColor(i + 1) }} />
              {CHARGE_LABELS[t]}
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
}

export default function FeesPage() {
  usePageChrome({ title: 'Fees & charges', showPeriod: true, subtitle: 'What your accounts charged, the tax on it, and what was reversed.' });
  const { period } = usePeriod();
  const ledger = useLedger();
  const links = useChargeLinks();
  const policies = useCardPolicies();
  const [params] = useSearchParams();
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const summary = useMemo(
    () => (ledger.ready && links && policies ? feesSummary(ledger.transactions, { links, policies, accounts: ledger.accounts, start: period.start, end: period.end }) : null),
    [ledger.ready, ledger.transactions, ledger.accounts, links, policies, period.start, period.end],
  );
  const accountName = (id: string) => ledger.accounts.find((a) => a.id === id)?.name ?? 'Account';

  if (!summary || !policies) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading fees">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // `?txn=` (from a fee row in Activity) or `?event=` opens that charge group.
  const wantedTxn = params.get('txn');
  const fromLink = summary.events.find((e) => e.groupId === params.get('event') || (wantedTxn !== null && e.txnIds.includes(wantedTxn)));
  const openEvent = openGroup === '__closed__' ? null : (summary.events.find((e) => e.groupId === openGroup) ?? fromLink ?? null);

  const purchaseOf = (e: ChargeEvent) => (e.relatedPurchaseTxnId ? ledger.transactions.find((t) => t.id === e.relatedPurchaseTxnId) : undefined);
  const t = summary.totals;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4">
      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {[
            ['Charged', t.charged],
            ['Tax on charges', t.tax],
            ['Reversed', t.reversed],
            ['What it cost', t.net],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-fg-muted">{label as string}</dt>
              <dd className="text-lg font-semibold text-fg"><Money value={value as number} /></dd>
            </div>
          ))}
        </dl>
      </Card>

      {summary.events.length === 0 ? (
        <Card>
          <EmptyState title="No fees or charges found in this period" body="Charges such as surcharges, annual fees and interest appear here when they are in your statements." />
        </Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Fees and charges</caption>
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  {['Date', 'Account', 'Type', 'Charge', 'Tax', 'Reversed', 'Net', 'Related purchase', 'Status'].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-medium ${i >= 3 && i <= 6 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.events.map((e) => {
                  const p = purchaseOf(e);
                  return (
                    <tr key={e.groupId}>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpenGroup(e.groupId)}>
                          {formatDate(e.date)}
                        </button>
                      </td>
                      <td className="px-3 py-2">{accountName(e.accountId)}</td>
                      <td className="px-3 py-2">{CHARGE_LABELS[e.chargeType]}</td>
                      <td className="px-3 py-2 text-right"><Money value={e.charge} /></td>
                      <td className="px-3 py-2 text-right"><Money value={e.tax} /></td>
                      <td className="px-3 py-2 text-right"><Money value={e.reversed} /></td>
                      <td className="px-3 py-2 text-right font-medium"><Money value={e.net} /></td>
                      <td className="px-3 py-2">{p ? `${p.merchant}, ${formatDate(p.date, { short: true })}` : 'None found'}</td>
                      <td className="px-3 py-2"><Badge tone={STATUS_INFO[e.status].tone}>{STATUS_INFO[e.status].label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden" aria-label="Fees and charges">
            {summary.events.map((e) => (
              <li key={e.groupId}>
                <Card className="p-3 sm:p-3">
                  <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpenGroup(e.groupId)} aria-label={`${CHARGE_LABELS[e.chargeType]} on ${formatDate(e.date)}`}>
                    <span>
                      <span className="block text-sm font-semibold text-fg">{CHARGE_LABELS[e.chargeType]}</span>
                      <span className="block text-xs text-fg-muted">{formatDate(e.date)} · {accountName(e.accountId)}</span>
                    </span>
                    <Badge tone={STATUS_INFO[e.status].tone}>{STATUS_INFO[e.status].label}</Badge>
                  </button>
                  <p className="mt-1 text-sm text-fg-muted">
                    Charge <Money value={e.charge} /> · Tax <Money value={e.tax} /> · Reversed <Money value={e.reversed} /> · Net <Money value={e.net} />
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <MonthlyBars summary={summary} scope={period.label} />

      <Card>
        <CardHeader title="Charges that keep coming" subtitle="The same type of charge in at least 2 of the last 3 months." />
        {summary.recurring.length === 0 ? (
          <p className="text-sm text-fg-muted">None found.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" aria-label="Recurring charges">
            {summary.recurring.map((r) => (
              <li key={r.chargeType} className="flex items-center justify-between gap-3 py-2">
                <span>{CHARGE_LABELS[r.chargeType]} <span className="text-xs text-fg-muted">in {r.months} months</span></span>
                <Money value={r.total} className="font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CardTerms policies={policies} accounts={ledger.accounts} />

      <EventSheet
        event={openEvent}
        txns={ledger.transactions}
        accountName={accountName}
        onClose={() => {
          setOpenGroup('__closed__');
        }}
      />
    </div>
  );
}
