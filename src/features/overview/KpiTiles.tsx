import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import type { Paise } from '@/domain/types';
import type { LedgerSummary } from '@/engine/analytics';
import { activityLink } from '@/app/routes';
import { Money, Notice, cn } from '@/ui';

/** `consumption` (spending without money sent to people) is added to the summary by the analytics module. */
type SummaryWithConsumption = LedgerSummary & { consumption?: Paise };

interface TileProps {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  definition: ReactNode;
  footer?: ReactNode;
  className?: string;
}

function Tile({ label, value, caption, definition, footer, className }: TileProps) {
  const [open, setOpen] = useState(false);
  const defId = useId();
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-3 shadow-card sm:p-4', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={defId}
        onClick={() => setOpen((o) => !o)}
        className="block min-h-touch w-full rounded-lg text-left"
      >
        <span className="flex items-center justify-between gap-2 text-sm text-fg-muted">
          <span>{label}</span>
          <Info className="h-4 w-4 shrink-0" aria-hidden />
        </span>
        <span className="mt-1 block text-xl font-semibold text-fg sm:text-2xl">{value}</span>
        {caption && <span className="mt-0.5 block text-xs text-fg-subtle">{caption}</span>}
      </button>
      <p id={defId} hidden={!open} className={cn('mt-2 border-t border-border pt-2 text-xs text-fg-muted')}>
        {definition}
      </p>
      {footer}
    </div>
  );
}

/** Headline numbers for the selected period. Each tile explains how its figure is built. */
export function KpiTiles({ summary }: { summary: SummaryWithConsumption }) {
  const split = summary.consumption !== undefined;
  const rate = summary.savingsRate;
  const suppressed = rate === null;
  const reason = summary.savingsRateNote ?? 'There is no income in this period to compare against.';
  return (
    <section aria-labelledby="kpi-heading" className="space-y-3">
      <h2 id="kpi-heading" className="sr-only">
        Key figures
      </h2>
      <div className={cn('grid grid-cols-2 gap-3', split ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
        <Tile
          label="Spending"
          value={<Money value={split ? (summary.consumption ?? 0) : summary.spending} whole />}
          caption={split ? 'Net of refunds, without money sent to people' : 'Net of refunds'}
          definition={
            <>
              Everything you paid for, after <Money value={summary.refunds} whole /> of refunds
              {split ? '. Money you sent to people is shown next to it, not mixed in' : ''}. It leaves out{' '}
              <Money value={summary.neutral.selfTransfers} whole /> moved between your accounts and{' '}
              <Money value={summary.neutral.cardPayments} whole /> of card bill payments, so nothing is counted twice.
            </>
          }
        />
        {split && (
          <Tile
            label="Sent to people (net)"
            value={<Money value={Math.max(0, summary.spending - (summary.consumption ?? 0))} whole />}
            caption={
              <>
                <Money value={summary.peopleOut} whole /> sent · <Money value={summary.peopleIn} whole /> received
              </>
            }
            definition="Money you sent to people you haven't labelled yet is offset by money people sent you; only the net outflow counts against your savings. Payments you've labelled (rent, family support, gifts) count in full. Label a person once and VyayaMitra remembers them."
            footer={
              summary.peopleOut > 0 ? (
                <Link
                  to={activityLink({ kind: 'p2p_out' })}
                  className="mt-1 inline-flex min-h-touch items-center text-sm font-medium text-primary hover:underline"
                >
                  Review<span className="sr-only"> money sent to people</span>
                </Link>
              ) : undefined
            }
          />
        )}
        <Tile
          label="Income"
          value={suppressed ? '—' : <Money value={summary.income} whole />}
          caption={suppressed ? 'Not available' : 'Salary, interest and other earnings'}
          definition={
            <>
              Salary, interest and other money you earned. Money received from people (
              <Money value={summary.peopleIn} whole />) is shown under People and is not counted as income.
            </>
          }
        />
        <Tile
          label="Saved & invested"
          value={<Money value={summary.invested} whole />}
          caption="Net of withdrawals"
          definition="Money moved into investments you imported (SIPs, funds, FDs, brokers), minus anything withdrawn. Cash left in your bank account is not included."
        />
        <Tile
          label="Savings rate"
          className={split ? 'col-span-2 lg:col-span-1' : undefined}
          value={rate === null ? '—' : <span className={cn(rate < 0 && 'text-negative')}>{rate.toFixed(1)}%</span>}
          caption={rate === null ? 'Not shown' : 'Of income'}
          definition={
            <>
              (Income − spending{split ? ' − money sent to people' : ''}) ÷ income. Net savings this period: <Money value={summary.netSavings} whole tone="auto" />.
            </>
          }
        />
      </div>
      {suppressed && (
        <Notice tone="info" title="Savings rate not shown">
          {reason}
        </Notice>
      )}
    </section>
  );
}
