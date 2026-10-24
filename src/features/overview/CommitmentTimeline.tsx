import { CreditCard, Repeat } from 'lucide-react';
import { formatDate } from '@/lib/dates';
import { Badge, Money } from '@/ui';
import type { CommitmentItem } from './commitments';

/** Chronological list of what is coming up: card bills and confirmed recurring payments. */
export function CommitmentTimeline({ items }: { items: readonly CommitmentItem[] }) {
  return (
    <ol className="divide-y divide-border">
      {items.map((c) => {
        const Icon = c.kind === 'card' ? CreditCard : Repeat;
        return (
          <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 basis-32">
              <p className="truncate text-sm font-medium text-fg">{c.label}</p>
              <p className="text-xs text-fg-muted">
                {formatDate(c.date)} · <span className={c.tone === 'negative' ? 'text-negative' : c.tone === 'warning' ? 'text-warning' : undefined}>{c.status}</span>
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm font-semibold text-fg">
                <Money value={c.amount} whole />
              </p>
              <Badge tone="neutral" className="hidden sm:inline-flex">{c.kind === 'card' ? 'Card bill' : 'Recurring'}</Badge>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
