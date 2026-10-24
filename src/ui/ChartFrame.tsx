import { useId, type ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn, Skeleton } from './primitives';
import { usePrivacy } from './privacy';

export type ChartDataStatus = 'complete' | 'incomplete' | 'estimate';

export interface ChartFrameProps {
  /** The question this chart answers, e.g. "Which categories took most of your spending?" */
  question: string;
  /** Period and account scope, e.g. "September 2025 · 2 accounts". */
  scope: ReactNode;
  /** One-sentence plain-language answer shown above the chart. */
  takeaway?: ReactNode;
  /** Data completeness. 'incomplete' and 'estimate' always show a visible marker with `statusNote`. */
  status?: ChartDataStatus;
  statusNote?: ReactNode;
  /** Structured equivalent of the chart (list or table). Required: charts are never the only way to read the data. */
  table: ReactNode;
  /** Optional controls (view toggles, "See transactions"). */
  actions?: ReactNode;
  loading?: boolean;
  /** Shown instead of the chart when there is nothing to draw. */
  empty?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** The visualisation itself. Give it role="img" and an aria-label summarising it. */
  children: ReactNode;
}

/**
 * Every chart in VyayaMitra sits in this frame so it states its question, scope, completeness and
 * takeaway the same way, and always offers a table alternative.
 */
export function ChartFrame({
  question,
  scope,
  takeaway,
  status = 'complete',
  statusNote,
  table,
  actions,
  loading,
  empty,
  error,
  className,
  children,
}: ChartFrameProps) {
  const titleId = useId();
  const { hideAmounts } = usePrivacy();
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      className={cn('rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5', className)}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-fg [text-wrap:balance]">
            {question}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted sm:text-sm">{scope}</p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>

      {status !== 'complete' && (
        <p
          className={cn(
            'mb-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
            status === 'incomplete' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info',
          )}
        >
          {status === 'incomplete' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            <span className="font-medium">{status === 'incomplete' ? 'Incomplete data. ' : 'Includes an estimate. '}</span>
            {statusNote}
          </span>
        </p>
      )}

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : empty ? (
        <div className="rounded-xl bg-surface-2 px-3 py-6 text-center text-sm text-fg-muted">{empty}</div>
      ) : (
        <>
          {takeaway && <p className="mb-3 text-sm font-medium text-fg [text-wrap:pretty]">{takeaway}</p>}
          {children}
          <details className="mt-3 text-sm">
            <summary className="min-h-touch cursor-pointer select-none py-2 font-medium text-primary">Show as a table</summary>
            <div className={cn('mt-2 overflow-x-auto', hideAmounts && '[&_.tabular]:select-none [&_.tabular]:blur-[6px]')}>{table}</div>
          </details>
        </>
      )}
    </section>
  );
}
