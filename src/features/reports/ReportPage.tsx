import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { ROUTES } from '@/app/routes';
import { useLedger, useRecurringDecisions } from '@/db/hooks';
import { CATEGORY_GROUP_LABELS, categoryName } from '@/domain/categories';
import { KIND_LABELS, metricBucket } from '@/domain/kinds';
import { applyQuery, detectRecurring, monthlySeries, summarize } from '@/engine/analytics';
import { formatDate, formatMonth, monthKey, monthsBetween, todayIso } from '@/lib/dates';
import { Button, Money, Notice, Skeleton } from '@/ui';

const MAX_MONTH_ROWS = 60;

/**
 * Printing in dark mode would give light text on white paper, so the page switches to the light
 * tokens only while the browser prepares the print preview, then restores the user's theme.
 */
function usePrintLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let saved: string | null | undefined;
    const restore = () => {
      if (saved === undefined) return;
      if (saved === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', saved);
      saved = undefined;
    };
    const before = () => {
      if (saved !== undefined) return;
      saved = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', restore);
      restore();
    };
  }, []);
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="break-inside-avoid print:shadow-none">
      <h2 className="mb-2 text-base font-semibold text-fg">{title}</h2>
      {note && <p className="mb-2 text-sm text-fg-muted">{note}</p>}
      {children}
    </section>
  );
}

function Table({ label, head, children }: { label: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border print:overflow-visible">
      <table className="w-full min-w-0 border-collapse text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-fg-muted">{head}</thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

const th = 'px-3 py-2 font-medium';
const thRight = `${th} text-right`;
const td = 'px-3 py-2 align-top';
const tdRight = `${td} text-right`;

function Kpi({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-fg">{children}</dd>
      {hint && <p className="mt-0.5 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

export default function ReportPage() {
  usePrintLightTheme();
  usePageChrome({ title: 'Report', showPeriod: true });
  const { period } = usePeriod();
  const ledger = useLedger();
  const decisions = useRecurringDecisions();
  const today = todayIso();

  // Everything below is derived from current data on each render; nothing is cached across periods.
  const report = useMemo(() => {
    if (!ledger.ready) return null;
    const txns = applyQuery(ledger.transactions, { start: period.start, end: period.end });
    const summary = summarize(txns, {
      accounts: ledger.accounts,
      statements: ledger.statements,
      customCategories: ledger.customCategories,
      start: period.start,
      end: period.end,
      today,
    });
    const months = monthsBetween(monthKey(period.start), monthKey(period.end)).slice(-MAX_MONTH_ROWS);
    const monthly = monthlySeries(txns, { accounts: ledger.accounts, statements: ledger.statements, months });
    const top = txns
      .filter((t) => t.direction === 'debit' && metricBucket(t.kind, t.direction) === 'spending')
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    const recurring = decisions
      ? detectRecurring(ledger.transactions, decisions, today).filter((r) => r.status === 'confirmed')
      : [];
    return { txns, summary, monthly, top, recurring };
  }, [ledger, decisions, period.start, period.end, today]);

  const accountName = (id: string) => ledger.accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-4 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide>
        <Link
          to={ROUTES.overview}
          className="inline-flex min-h-touch items-center gap-2 rounded-xl px-2 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to overview
        </Link>
        <Button onClick={() => window.print()} icon={<Printer className="h-4 w-4" aria-hidden />} disabled={!report}>
          Print / Save as PDF
        </Button>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-fg">VyayaMitra report</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {period.label} · {formatDate(period.start)} to {formatDate(period.end)}
        </p>
        <p className="text-xs text-fg-subtle">Prepared on {formatDate(today)} from statements stored on this device.</p>
      </header>

      {!report ? (
        <div className="space-y-3" aria-busy="true" aria-label="Preparing report">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          {report.txns.length === 0 && (
            <Notice tone="info" title="No transactions in this period">
              Choose another period, or import a statement that covers these dates.
            </Notice>
          )}

          <Section title="Coverage">
            {report.summary.coverage.complete ? (
              <p className="text-sm text-fg">Every active account has statements covering this whole period.</p>
            ) : (
              <Notice tone="warning" title="This period is not fully covered by imported statements">
                {report.summary.coverage.notes.length > 0 ? (
                  <ul className="list-disc pl-4">
                    {report.summary.coverage.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  'Totals may be lower than the real figures.'
                )}
              </Notice>
            )}
          </Section>

          <Section title="Key figures">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Kpi label="Income">
                <Money value={report.summary.income} />
              </Kpi>
              <Kpi label="Spending" hint="Net of refunds">
                <Money value={report.summary.spending} />
              </Kpi>
              <Kpi label="Saved & invested">
                <Money value={report.summary.invested} />
              </Kpi>
              <Kpi label="Income minus spending">
                <Money value={report.summary.netSavings} tone="auto" />
              </Kpi>
              <Kpi label="Savings rate" hint={report.summary.savingsRate === null ? report.summary.savingsRateNote : undefined}>
                {report.summary.savingsRate === null ? 'Not available' : `${report.summary.savingsRate.toFixed(1)}%`}
              </Kpi>
              <Kpi label="Transactions" hint={`${report.summary.counts.needsReview} need review`}>
                {report.summary.counts.total}
              </Kpi>
              <Kpi label="Refunds received">
                <Money value={report.summary.refunds} />
              </Kpi>
              <Kpi label="Sent to people">
                <Money value={report.summary.peopleOut} />
              </Kpi>
              <Kpi label="Received from people">
                <Money value={report.summary.peopleIn} />
              </Kpi>
            </dl>
          </Section>

          <Section title="Spending by category">
            {report.summary.byCategory.length === 0 ? (
              <p className="text-sm text-fg-muted">No spending in this period.</p>
            ) : (
              <Table
                label="Spending by category"
                head={
                  <tr>
                    <th scope="col" className={th}>Category</th>
                    <th scope="col" className={thRight}>Txns</th>
                    <th scope="col" className={thRight}>Share</th>
                    <th scope="col" className={thRight}>Amount</th>
                  </tr>
                }
              >
                {report.summary.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td className={td}>{categoryName(c.category, ledger.customCategories)}</td>
                    <td className={tdRight}>{c.count}</td>
                    <td className={tdRight}>{(c.share * 100).toFixed(1)}%</td>
                    <td className={tdRight}>
                      <Money value={c.amount} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <Section title="Spending by group">
            {report.summary.byGroup.length === 0 ? (
              <p className="text-sm text-fg-muted">No spending in this period.</p>
            ) : (
              <Table
                label="Spending by group"
                head={
                  <tr>
                    <th scope="col" className={th}>Group</th>
                    <th scope="col" className={thRight}>Share</th>
                    <th scope="col" className={thRight}>Amount</th>
                  </tr>
                }
              >
                {report.summary.byGroup.map((g) => (
                  <tr key={g.group}>
                    <td className={td}>{CATEGORY_GROUP_LABELS[g.group]}</td>
                    <td className={tdRight}>{(g.share * 100).toFixed(1)}%</td>
                    <td className={tdRight}>
                      <Money value={g.amount} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <Section
            title="Month by month"
            note="Months marked “partial” are not fully covered by statements, so their totals may be incomplete."
          >
            <Table
              label="Month by month"
              head={
                <tr>
                  <th scope="col" className={th}>Month</th>
                  <th scope="col" className={thRight}>Income</th>
                  <th scope="col" className={thRight}>Spending</th>
                  <th scope="col" className={thRight}>Invested</th>
                  <th scope="col" className={thRight}>Net</th>
                </tr>
              }
            >
              {report.monthly.map((m) => (
                <tr key={m.month}>
                  <td className={td}>
                    {formatMonth(m.month)}
                    {!m.complete && <span className="ml-1 text-xs text-warning">partial</span>}
                  </td>
                  <td className={tdRight}>
                    <Money value={m.income} />
                  </td>
                  <td className={tdRight}>
                    <Money value={m.spending} />
                  </td>
                  <td className={tdRight}>
                    <Money value={m.invested} />
                  </td>
                  <td className={tdRight}>
                    <Money value={m.netSavings} tone="auto" />
                  </td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Ten largest expenses">
            {report.top.length === 0 ? (
              <p className="text-sm text-fg-muted">No expenses in this period.</p>
            ) : (
              <Table
                label="Ten largest expenses"
                head={
                  <tr>
                    <th scope="col" className={th}>Date</th>
                    <th scope="col" className={th}>Merchant</th>
                    <th scope="col" className={thRight}>Amount</th>
                  </tr>
                }
              >
                {report.top.map((t) => (
                  <tr key={t.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(t.date, { short: true })}</td>
                    <td className={`${td} min-w-0 break-words`}>
                      <span className="font-medium text-fg">{t.merchant}</span>
                      <span className="block text-xs text-fg-muted">
                        {categoryName(t.category, ledger.customCategories)} · {KIND_LABELS[t.kind]}
                        {accountName(t.accountId) ? ` · ${accountName(t.accountId)}` : ''}
                      </span>
                      {t.rawDescription !== t.merchant && (
                        <span className="block break-all text-xs text-fg-subtle">{t.rawDescription}</span>
                      )}
                    </td>
                    <td className={tdRight}>
                      <Money value={t.amount} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <Section title="Recurring commitments you confirmed">
            {report.recurring.length === 0 ? (
              <p className="text-sm text-fg-muted">
                None confirmed yet. Confirm recurring payments in Plan and they will be listed here.
              </p>
            ) : (
              <Table
                label="Confirmed recurring commitments"
                head={
                  <tr>
                    <th scope="col" className={th}>Payment</th>
                    <th scope="col" className={th}>Repeats</th>
                    <th scope="col" className={thRight}>Typical</th>
                    <th scope="col" className={thRight}>Per month</th>
                  </tr>
                }
              >
                {report.recurring.map((r) => (
                  <tr key={r.merchantKey}>
                    <td className={td}>{r.merchant}</td>
                    <td className={td}>{r.cadence}</td>
                    <td className={tdRight}>
                      <Money value={r.typicalAmount} />
                    </td>
                    <td className={tdRight}>
                      <Money value={r.monthlyCost} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>

          <p className="text-xs text-fg-subtle">
            Figures come from the statements you imported. Transfers between your own accounts and card bill payments are excluded from spending.
          </p>
        </>
      )}
    </div>
  );
}
