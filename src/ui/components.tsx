/**
 * Higher-level building blocks on top of the primitives: ConfirmDialog, Menu, Tabs, Stat,
 * ListRow/ListGroup, Switch, Chip, SectionHeader. All are keyboard accessible, meet 44px
 * touch targets on touch screens and read from the shared colour tokens (light + dark).
 */
import { ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button, Field, Input, Notice, Sheet, cn, type Tone } from './primitives';

// ─── ConfirmDialog ───────────────────────────────────────────────────────────

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** May be async. The dialog stays open (showing the error) if it throws. */
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  /** Plain-language explanation of what will happen, including what cannot be undone. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** When set, the user must type this exact text before the confirm button enables (e.g. "DELETE"). */
  requireText?: string;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  requireText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped('');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const ready = !requireText || typed === requireText;

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} disabled={!ready} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm text-fg-muted">
        {children}
        {requireText && (
          <Field label={`Type ${requireText} to confirm`}>
            {({ id }) => (
              <Input
                id={id}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void run();
                  }
                }}
              />
            )}
          </Field>
        )}
        {error && <Notice tone="negative">{error}</Notice>}
      </div>
    </Sheet>
  );
}

// ─── Menu (dropdown) ─────────────────────────────────────────────────────────

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  /** Renders as a selectable option (menuitemradio) with a check mark. */
  checked?: boolean;
}
export type MenuEntry = MenuItem | 'separator';

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  id: string;
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

/**
 * Dropdown menu. `trigger` receives props to spread on your button:
 *   <Menu label="More" trigger={(p) => <IconButton label="More" {...p}><MoreVertical/></IconButton>} items={[...]} />
 * Arrow keys / Home / End move, Enter or Space selects, Escape closes and returns focus.
 */
export function Menu({
  trigger,
  items,
  label,
  align = 'start',
  className,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuEntry[];
  /** Accessible name for the menu. */
  label: string;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const menuId = `${baseId}-menu`;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const enabledButtons = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;
    const buttons = enabledButtons();
    const checked = buttons.find((b) => b.getAttribute('aria-checked') === 'true');
    (checked ?? buttons[0])?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = enabledButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(index <= 0 ? -1 : index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(-1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={wrapRef} className={cn('relative inline-block', className)}>
      {trigger({
        ref: triggerRef,
        id: `${baseId}-trigger`,
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
      })}
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(
            'absolute top-full z-40 mt-1 min-w-52 max-w-[calc(100vw-2rem)] animate-toast-in rounded-xl border border-border bg-surface p-1 shadow-raised',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-border" />
            ) : (
              <button
                key={i}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={cn(
                  'flex min-h-touch w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50',
                  item.tone === 'danger' ? 'text-negative' : 'text-fg',
                  item.checked && 'font-semibold',
                )}
              >
                {item.icon && <span className="shrink-0 text-fg-muted">{item.icon}</span>}
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.checked && <span aria-hidden className="text-primary">✓</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Small count shown after the label. */
  count?: number;
}

/**
 * Tab list (WAI-ARIA tabs, automatic activation). Pair with <TabPanel> using the same `idBase`.
 * Scrolls horizontally on narrow screens instead of wrapping.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  idBase,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: TabItem<T>[];
  label: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn('scrollbar-none flex gap-1 overflow-x-auto border-b border-border', className)}>
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${t.value}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${t.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              '-mb-px inline-flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-sm font-medium transition-colors',
              selected ? 'border-primary text-primary' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-surface-2 px-1.5 text-xs text-fg-muted tabular">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idBase,
  value,
  active,
  children,
  className,
}: {
  idBase: string;
  value: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} className={className}>
      {children}
    </div>
  );
}

// ─── Stat (KPI tile) ─────────────────────────────────────────────────────────

const statTone: Record<Tone, string> = {
  neutral: 'text-fg',
  primary: 'text-primary',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
  info: 'text-info',
};

export function Stat({
  label,
  value,
  sublabel,
  tone = 'neutral',
  icon,
  className,
}: {
  label: ReactNode;
  /** Usually a <Money/> or a formatted string. */
  value: ReactNode;
  sublabel?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-4 shadow-card', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        {icon && <span className="text-fg-subtle">{icon}</span>}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold leading-tight tabular', statTone[tone])}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-fg-subtle">{sublabel}</p>}
    </div>
  );
}

// ─── ListRow / ListGroup ─────────────────────────────────────────────────────

/** A bordered, divided container for ListRows. */
export function ListGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-card', className)} {...rest} />;
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  selected,
  disabled,
  showChevron,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title' | 'onClick'> & {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** When set, the whole row is a button. */
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** Chevron after the trailing content (defaults to true for clickable rows). */
  showChevron?: boolean;
}) {
  const chevron = showChevron ?? Boolean(onClick);
  const inner = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        {subtitle && <span className="mt-0.5 block text-xs text-fg-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-sm text-fg">{trailing}</span>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
    </>
  );
  const base = cn('flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left', selected && 'bg-primary-soft/60', className);
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={selected ? 'true' : undefined}
        className={cn(base, 'transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50')}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={base} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {inner}
    </div>
  );
}

// ─── Switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name (visible text elsewhere should be linked with aria-labelledby via `id` if preferred). */
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('inline-flex min-h-touch min-w-touch items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50', className)}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-block h-7 w-12 rounded-full border transition-colors',
          checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full shadow-card transition-[left]',
            checked ? 'left-[1.375rem] bg-primary-fg' : 'left-0.5 bg-fg-muted',
          )}
        />
      </span>
    </button>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

/** Filter chip. Pass `selected` to make it a toggle (aria-pressed). */
export function Chip({
  children,
  selected,
  onClick,
  icon,
  trailing,
  disabled,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  /** e.g. a count or a small × shown after the label. */
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-10 coarse:min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors disabled:opacity-50',
        selected
          ? 'border-primary bg-primary-soft text-primary'
          : 'border-border-strong bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
    >
      {icon}
      {children}
      {trailing}
    </button>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  subtitle,
  action,
  as: Tag = 'h2',
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <Tag className="text-lg font-semibold text-fg">{title}</Tag>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
