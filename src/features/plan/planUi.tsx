import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Sheet, Skeleton, cn } from '@/ui';
import { errorMessage } from './errors';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
  outline: 'border border-border-strong text-fg hover:bg-surface-2',
  ghost: 'text-primary hover:bg-surface-2',
};

/** A router link styled like a Button. */
export function LinkButton({
  to,
  variant = 'ghost',
  icon,
  children,
  className,
}: {
  to: string;
  variant?: Variant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors',
        variants[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/** Small "are you sure" dialog for destructive or irreversible actions. */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Should throw on failure; the sheet stays open and shows the message. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" loading={busy} onClick={run}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-fg-muted">
        <div>{body}</div>
        {error && (
          <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-negative">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/** Inline section skeleton while a hook is still loading. */
export function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
    </div>
  );
}
