import type { ReactNode } from 'react';
import { cn, type Tone } from '@/ui';

const fill: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  primary: 'bg-primary',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
};

const stroke: Record<Tone, string> = {
  neutral: 'stroke-fg-subtle',
  primary: 'stroke-primary',
  positive: 'stroke-positive',
  negative: 'stroke-negative',
  warning: 'stroke-warning',
  info: 'stroke-info',
};

/**
 * Bullet-style meter: the bar is what was used, the tick is where an even pace would be by now.
 * Values above 1 fill the bar completely; say the overshoot in text next to it.
 */
export function Meter({ value, marker, tone = 'primary', label, className }: { value: number; marker?: number | null; tone?: Tone; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn('relative', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div className={cn('h-full rounded-full', fill[tone])} style={{ width: `${pct}%` }} />
      </div>
      {marker !== undefined && marker !== null && (
        <span aria-hidden className="absolute -bottom-1 -top-1 w-0.5 rounded bg-fg" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} />
      )}
    </div>
  );
}

/** Circular progress with optional centre content. The ring itself is decorative; put the numbers in text. */
export function ProgressRing({
  value,
  tone = 'primary',
  size = 64,
  label,
  children,
}: {
  value: number;
  tone?: Tone;
  size?: number;
  label: string;
  children?: ReactNode;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-surface-3" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} className={stroke[tone]} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-fg">{children}</span>
    </div>
  );
}
