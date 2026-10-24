import type { ReactNode } from 'react';
import { formatINR } from '@/lib/money';
import { cn, type Tone } from './primitives';

const FILL: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  primary: 'bg-primary',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
};

/**
 * Bullet meter for "how much of a target is used" (budgets, limits).
 * - `value` and `target` are paise (or pass `format` for other units).
 * - `tone` is chosen by the caller from pace and context (e.g. 96% used at month end is fine); the meter
 *   never turns amber or red on its own percentage.
 * - `expected` draws a tick where spending should be by today if spread evenly.
 * - Above target the track grows so the target marker stays visible, the part beyond it is drawn in the
 *   negative colour, and the over amount is written out (colour is never the only cue).
 */
export function MeterBar({
  value,
  target,
  expected,
  label,
  format = (n: number) => formatINR(n, { whole: true }),
  tone = 'neutral',
  showText = true,
  className,
}: {
  value: number;
  target: number;
  expected?: number;
  /** Accessible name, e.g. "Groceries budget". */
  label: string;
  format?: (n: number) => string;
  /** Status colour for the filled part. Default: the calm accent. */
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
  showText?: boolean;
  className?: string;
}) {
  const safeTarget = Math.max(target, 0);
  const over = Math.max(0, value - safeTarget);
  const max = Math.max(value, safeTarget, expected ?? 0, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  const within = Math.min(value, safeTarget);
  const text = `${format(value)} of ${format(safeTarget)}${over > 0 ? `, ${format(over)} over` : ''}`;
  const fill: Tone = tone === 'neutral' ? 'primary' : tone;
  return (
    <div className={cn('w-full', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${text}${expected !== undefined ? `; ${format(expected)} expected by today` : ''}`}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div className={cn('absolute inset-y-0 left-0 rounded-l-full', FILL[fill])} style={{ width: pct(within) }} />
        {over > 0 && <div className={cn('absolute inset-y-0', FILL.negative)} style={{ left: pct(safeTarget), width: pct(over) }} />}
        {safeTarget > 0 && over > 0 && <div aria-hidden className="absolute inset-y-0 w-0.5 bg-surface" style={{ left: pct(safeTarget) }} />}
        {expected !== undefined && <div aria-hidden className="absolute -inset-y-0.5 w-0.5 bg-fg" style={{ left: pct(expected) }} />}
      </div>
      {showText && (
        <p className={cn('mt-1.5 text-xs tabular', over > 0 ? 'font-medium text-negative' : 'text-fg-muted')}>
          {text}
          {expected !== undefined && over === 0 && <span className="text-fg-subtle"> · tick marks where you would be by today</span>}
        </p>
      )}
    </div>
  );
}

const STROKE: Record<Tone, string> = {
  neutral: 'stroke-fg-subtle',
  primary: 'stroke-primary',
  positive: 'stroke-positive',
  negative: 'stroke-negative',
  warning: 'stroke-warning',
  info: 'stroke-info',
};

/** Circular progress toward a target (goals). Centre shows the percentage unless `centre` is given. */
export function ProgressRing({
  value,
  target,
  label,
  size = 96,
  tone = 'primary',
  centre,
  valueText,
  className,
}: {
  value: number;
  target: number;
  /** Accessible name, e.g. "Emergency fund progress". */
  label: string;
  size?: number;
  tone?: Tone;
  centre?: ReactNode;
  /** Spoken text; defaults to "NN% of target". */
  valueText?: string;
  className?: string;
}) {
  const ratio = target > 0 ? Math.max(0, value / target) : 0;
  const pct = Math.round(Math.min(ratio, 1) * 100);
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const done = ratio >= 1;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText ?? `${Math.round(ratio * 100)}% of target`}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(ratio, 1))}
          className={cn(done ? STROKE.positive : STROKE[tone], 'transition-[stroke-dashoffset] duration-500')}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-sm font-semibold tabular text-fg">
        {centre ?? `${Math.round(ratio * 100)}%`}
      </span>
    </div>
  );
}
