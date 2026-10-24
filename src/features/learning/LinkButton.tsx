import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/ui';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary/90',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
  outline: 'border border-border-strong text-fg hover:bg-surface-2',
  ghost: 'text-primary hover:bg-surface-2',
};

/** A router link that looks like a Button (the shared Button cannot render as a link). */
export function LinkButton({
  to,
  variant = 'secondary',
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
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors',
        variants[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
