import type { Direction, Paise } from '@/domain/types';
import { formatINR } from '@/lib/money';
import { cn } from './primitives';
import { usePrivacy } from './privacy';

/**
 * Renders paise as INR with tabular digits. Respects the "hide amounts" privacy setting.
 * `direction` colours credits green and shows +/−; `tone="auto"` colours by sign.
 */
export function Money({
  value,
  direction,
  whole,
  compact,
  tone = 'plain',
  className,
}: {
  value: Paise;
  direction?: Direction;
  whole?: boolean;
  compact?: boolean;
  tone?: 'plain' | 'auto' | 'direction';
  className?: string;
}) {
  const { hideAmounts } = usePrivacy();
  const signed = direction ? (direction === 'credit' ? value : -value) : value;
  const text = direction
    ? `${direction === 'credit' ? '+' : '−'}${formatINR(Math.abs(value), { whole, compact })}`
    : formatINR(value, { whole, compact });
  const color =
    tone === 'direction' && direction
      ? direction === 'credit'
        ? 'text-positive'
        : 'text-fg'
      : tone === 'auto'
        ? signed < 0
          ? 'text-negative'
          : signed > 0
            ? 'text-positive'
            : ''
        : '';
  if (hideAmounts) {
    return (
      <span className={cn('tabular select-none blur-[6px]', className)} aria-label="Amount hidden">
        ₹ ••••
      </span>
    );
  }
  return <span className={cn('tabular whitespace-nowrap', color, className)}>{text}</span>;
}
