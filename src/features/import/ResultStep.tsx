import { CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES, activityLink } from '@/app/routes';
import type { ImportResult } from '@/engine/import';
import { Button, Card, cn } from '@/ui';

function Count({ label, value, tone }: { label: string; value: number; tone?: 'warning' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <dd className={cn('text-2xl font-semibold tabular', tone === 'warning' && value > 0 ? 'text-warning' : 'text-fg')}>{value}</dd>
      <dt className="text-xs text-fg-muted">{label}</dt>
    </div>
  );
}

const linkButton =
  'inline-flex min-h-touch items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors';

export function ResultStep({
  result,
  fileName,
  waiting,
  format,
  onAnother,
}: {
  /** A format saved or learned by this import, so the user knows the next one will be instant. */
  format?: { kind: 'taught' | 'auto'; name?: string } | null;
  result: ImportResult;
  fileName: string;
  /** Files still queued after this one. */
  waiting: number;
  onAnother: () => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl bg-positive-soft p-2.5 text-positive">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">Import complete</h2>
          <p className="truncate text-sm text-fg-muted">{fileName}</p>
        </div>
      </div>

      {format && (
        <p className="rounded-xl bg-positive-soft px-3 py-2 text-sm text-positive" role="status">
          {format.kind === 'taught'
            ? `Saved the format “${format.name ?? 'your format'}”. Next time a statement like this imports instantly.`
            : 'Learned this format. Next time it’s instant.'}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="Added" value={result.inserted} />
        <Count label="Duplicates skipped" value={result.skippedDuplicates} />
        <Count label="Linked transfers" value={result.linked} />
        <Count label="Need review" value={result.needsReview} tone="warning" />
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {result.needsReview > 0 && (
          <Link to={activityLink({ review: true })} className={cn(linkButton, 'bg-primary text-primary-fg hover:bg-primary/90')}>
            Review {result.needsReview} transaction{result.needsReview === 1 ? '' : 's'}
          </Link>
        )}
        <Link
          to={ROUTES.overview}
          className={cn(linkButton, result.needsReview > 0 ? 'border border-border-strong text-fg hover:bg-surface-2' : 'bg-primary text-primary-fg hover:bg-primary/90')}
        >
          See overview
        </Link>
        <Button variant="outline" onClick={onAnother}>
          {waiting > 0 ? `Import next file (${waiting} waiting)` : 'Import another'}
        </Button>
      </div>
    </Card>
  );
}
