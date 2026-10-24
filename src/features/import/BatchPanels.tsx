import { AlertTriangle, CheckCircle2, Circle, Loader2, Lock, MinusCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES, activityLink } from '@/app/routes';
import { Badge, Button, Card, CardHeader, cn, type Tone } from '@/ui';
import { STATUS_LABELS, takeaway, type BatchItem, type BatchStatus, type BatchTotals } from './batch';

const TONE: Record<BatchStatus, Tone> = {
  queued: 'neutral',
  reading: 'info',
  password: 'warning',
  scanned: 'warning',
  ready: 'primary',
  imported: 'positive',
  failed: 'negative',
  skipped: 'neutral',
};

function StatusIcon({ status }: { status: BatchStatus }) {
  const cls = 'h-4 w-4 shrink-0';
  switch (status) {
    case 'reading':
      return <Loader2 className={cn(cls, 'animate-spin text-info')} aria-hidden />;
    case 'imported':
      return <CheckCircle2 className={cn(cls, 'text-positive')} aria-hidden />;
    case 'failed':
      return <AlertTriangle className={cn(cls, 'text-negative')} aria-hidden />;
    case 'password':
      return <Lock className={cn(cls, 'text-warning')} aria-hidden />;
    case 'skipped':
      return <MinusCircle className={cn(cls, 'text-fg-subtle')} aria-hidden />;
    default:
      return <Circle className={cn(cls, 'text-fg-subtle')} aria-hidden />;
  }
}

/** Every file in the batch with what is really happening to it. One is reviewed at a time. */
export function BatchList({ items, onSkip }: { items: BatchItem[]; onSkip?: (key: number) => void }) {
  return (
    <Card className="p-0 sm:p-0">
      <ul aria-label="Files in this import" className="divide-y divide-border">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-3 px-4 py-3">
            <StatusIcon status={i.status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{i.name}</p>
              <p className="text-xs text-fg-muted">{i.text ?? STATUS_LABELS[i.status]}</p>
            </div>
            <Badge tone={TONE[i.status]}>{STATUS_LABELS[i.status]}</Badge>
            {onSkip && (i.status === 'password' || i.status === 'scanned' || i.status === 'ready') && (
              <Button size="sm" variant="ghost" aria-label={`Skip ${i.name}`} onClick={() => onSkip(i.key)}>
                Skip
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function BatchSummary({ items, totals }: { items: BatchItem[]; totals: BatchTotals }) {
  const count = (s: BatchStatus) => items.filter((i) => i.status === s).length;
  const t = takeaway(totals);
  return (
    <Card className="space-y-3" role="region" aria-label="Batch summary">
      <CardHeader title="All files done" subtitle={`${count('imported')} imported, ${count('failed')} could not be read, ${count('skipped')} skipped`} />
      <p className="text-sm text-fg">
        {totals.inserted} transaction{totals.inserted === 1 ? '' : 's'} added
        {totals.duplicates > 0 ? `, ${totals.duplicates} duplicates skipped` : ''}.
      </p>
      <p className="rounded-xl bg-primary-soft px-3 py-2 text-sm font-medium text-primary">{t.text}</p>
      <div className="flex flex-wrap gap-2">
        {totals.needsReview > 0 && (
          <Link
            to={activityLink({ review: true })}
            className="inline-flex min-h-touch items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90"
          >
            Review {totals.needsReview} transaction{totals.needsReview === 1 ? '' : 's'}
          </Link>
        )}
        <Link
          to={ROUTES.overview}
          className="inline-flex min-h-touch items-center rounded-xl border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2"
        >
          See overview
        </Link>
      </div>
    </Card>
  );
}
