import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/ui';

/** "See transactions" link that routes to the Activity list behind a chart element. */
export function SeeTransactions({ to, children = 'See transactions', className }: { to: string; children?: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn('inline-flex min-h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-surface-2', className)}
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

export const tableCell = 'px-2 py-1.5 text-left';
export const tableHead = 'px-2 py-1.5 text-left font-medium text-fg-muted';
export const tableNum = 'px-2 py-1.5 text-right tabular-nums';
