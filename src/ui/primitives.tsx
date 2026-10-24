/* eslint-disable react-refresh/only-export-components -- hooks/helpers intentionally live beside their components */
import { clsx, type ClassValue } from 'clsx';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2, X } from 'lucide-react';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg shadow-card hover:bg-primary/90 active:bg-primary/80',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 active:bg-surface-3',
  ghost: 'text-fg hover:bg-surface-2 active:bg-surface-3',
  outline: 'border border-border-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-3',
  danger: 'bg-negative text-negative-fg shadow-card hover:bg-negative/90 active:bg-negative/80',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 coarse:min-h-touch px-3 text-sm gap-1.5',
  md: 'min-h-touch px-4 text-sm gap-2',
  lg: 'min-h-12 px-5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: accessible name. */
  label: string;
  variant?: 'ghost' | 'secondary';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl text-fg-muted transition-colors hover:text-fg disabled:opacity-50',
        variant === 'ghost' ? 'hover:bg-surface-2' : 'bg-surface-2 hover:bg-surface-3',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5', className)} {...rest} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'primary' | 'positive' | 'negative' | 'warning' | 'info';

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  primary: 'bg-primary-soft text-primary',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', badgeTones[tone], className)}
      {...rest}
    />
  );
}

// ─── Form controls ───────────────────────────────────────────────────────────

const controlBase =
  'w-full min-h-touch rounded-xl border border-border-strong bg-surface px-3 text-base text-fg placeholder:text-fg-subtle transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-focus/30 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-negative aria-[invalid=true]:ring-negative/20 sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(controlBase, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={cn(controlBase, 'pr-8', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(controlBase, 'py-2', className)} {...rest} />;
});

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {(error || hint) && (
        <p id={hintId} className={cn('text-xs', error ? 'text-negative' : 'text-fg-subtle')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────────

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  /** Accessible group name. */
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  // Radio-group keyboard model: arrows move and select, Tab leaves the group.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cn(
            'min-h-9 coarse:min-h-touch flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Sheet (accessible modal: bottom sheet on phones, centred dialog on desktop) ─

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fallbacks keep the content reachable in environments without <dialog> modal support (older WebViews, jsdom).
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    }
    if (!open && el.open) {
      if (typeof el.close === 'function') el.close();
      else el.removeAttribute('open');
    }
  }, [open]);

  // Lock page scroll behind an open sheet (restored on close/unmount).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        // The native event also fires when we close the dialog ourselves because `open` became false;
        // only a browser-initiated close (e.g. a platform back gesture) should be reported.
        if (openRef.current) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none overflow-hidden rounded-t-2xl border border-border bg-surface p-0 text-fg shadow-sheet backdrop:backdrop-blur-[2px]',
        'sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-2xl',
        size === 'sm' && 'sm:max-w-md',
        size === 'md' && 'sm:max-w-xl',
        size === 'lg' && 'sm:max-w-3xl',
      )}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0 pt-2">
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
            </div>
            <IconButton label="Close" onClick={onClose}>
              <X className="h-5 w-5" aria-hidden />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          {footer && <div className="border-t border-border px-4 py-3 pb-safe sm:px-5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-fg-muted', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-surface-2', className)} />;
}

export function ProgressBar({
  value,
  tone = 'primary',
  label,
  className,
}: {
  /** 0..1 (values above 1 render full). */
  value: number;
  tone?: Tone;
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const bar: Record<Tone, string> = {
    neutral: 'bg-fg-subtle',
    primary: 'bg-primary',
    positive: 'bg-positive',
    negative: 'bg-negative',
    warning: 'bg-warning',
    info: 'bg-info',
  };
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div className={cn('h-full rounded-full transition-[width]', bar[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      {icon && <div className="mb-3 rounded-2xl bg-surface-2 p-3 text-fg-muted">{icon}</div>}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-fg-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role={tone === 'negative' ? 'alert' : 'status'} className={cn('rounded-xl px-3 py-2.5 text-sm', badgeTones[tone], className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title && <p className="font-medium">{title}</p>}
          {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
