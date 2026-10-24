import { useEffect, useRef, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Download, Eye, EyeOff, FileUp, LayoutDashboard, Lock, ReceiptText, Settings, Target, type LucideIcon } from 'lucide-react';
import { Button, IconButton, cn, usePrivacy, useToast } from '@/ui';
import { PageChromeProvider, useChromeConfig } from './chrome';
import { useInstall } from './install';
import { PeriodPicker } from './period';
import { UpdateBanner } from './pwa';
import { ROUTES } from './routes';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** The centre action on phones. */
  prominent?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.overview, label: 'Overview', icon: LayoutDashboard, end: true },
  { to: ROUTES.activity, label: 'Activity', icon: ReceiptText },
  { to: ROUTES.import, label: 'Import', icon: FileUp, prominent: true },
  { to: ROUTES.plan, label: 'Plan', icon: Target },
  { to: ROUTES.settings, label: 'Settings', icon: Settings },
];

const ROUTE_TITLES: Record<string, string> = {
  [ROUTES.overview]: 'Overview',
  [ROUTES.activity]: 'Activity',
  [ROUTES.import]: 'Import statements',
  [ROUTES.plan]: 'Plan',
  [ROUTES.settings]: 'Settings',
  [ROUTES.report]: 'Report',
};

const BASE = import.meta.env.BASE_URL;

function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src={`${BASE}logo.svg`} alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
      <span className="text-lg font-semibold tracking-tight text-fg">VyayaMitra</span>
    </div>
  );
}

function SidebarNav() {
  const { canInstall, promptInstall } = useInstall();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface px-3 py-5 md:flex print:hidden">
      <Brand className="px-3 pb-6" />
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, prominent }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex min-h-touch items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                prominent && !isActive && 'my-1 bg-primary text-primary-fg shadow-card hover:bg-primary/90',
                isActive
                  ? prominent
                    ? 'my-1 bg-primary text-primary-fg shadow-card'
                    : 'bg-primary-soft text-primary'
                  : !prominent && 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      {canInstall && (
        <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" aria-hidden />} onClick={() => void promptInstall()} className="mb-3">
          Install app
        </Button>
      )}
      <div className="rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
          Private
        </p>
        <p className="mt-1">Your data stays on this device. Nothing is uploaded.</p>
      </div>
    </aside>
  );
}

function BottomTabs() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe pl-safe pr-safe backdrop-blur md:hidden print:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 items-end">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, prominent }) => (
          <li key={to} className="flex justify-center">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-fg-muted',
                  prominent && 'relative -mt-4',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {prominent ? (
                    <span
                      className={cn(
                        'flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-fg shadow-raised ring-4 ring-surface',
                        isActive && 'ring-primary-soft',
                      )}
                    >
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                  ) : (
                    <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                  )}
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HideAmountsToggle() {
  const { hideAmounts } = usePrivacy();
  const { toast } = useToast();
  const label = hideAmounts ? 'Show amounts' : 'Hide amounts';
  return (
    <IconButton
      label={label}
      aria-pressed={hideAmounts}
      onClick={() => {
        // Loaded on demand: the actions module pulls in the whole understanding engine, which the shell doesn't need at startup.
        import('@/db/actions')
          .then(({ updateSettings }) => updateSettings({ hideAmounts: !hideAmounts }))
          .catch(() => toast('Could not save that setting.', { tone: 'error' }));
      }}
    >
      {hideAmounts ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
    </IconButton>
  );
}

function Header({ fallbackTitle }: { fallbackTitle: string }) {
  const chrome = useChromeConfig();
  const title = chrome?.title ?? fallbackTitle;
  useEffect(() => {
    document.title = `${title} · VyayaMitra`;
  }, [title]);

  // Publish the sticky header's height so in-page sticky elements (date headers) sit below it.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--vm-header-h', `${el.getBoundingClientRect().height}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={headerRef} className="sticky top-0 z-20 border-b border-border bg-surface/90 pt-safe backdrop-blur md:static md:border-0 md:bg-transparent md:backdrop-blur-none print:static print:border-0">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 md:px-8 md:pb-3 md:pt-8">
        <div className="min-w-0 flex-1 basis-0">
          <h1 className="truncate text-lg font-semibold leading-tight text-fg md:text-2xl">{title}</h1>
          {chrome?.subtitle && <p className="mt-0.5 hidden text-sm text-fg-muted md:block">{chrome.subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 print:hidden md:order-2">
          {chrome?.actions}
          <HideAmountsToggle />
        </div>
        {chrome?.showPeriod && (
          <div className="order-last basis-full pb-1 print:hidden md:order-1 md:basis-auto md:pb-0">
            <PeriodPicker />
          </div>
        )}
      </div>
      <UpdateBanner />
    </header>
  );
}

export default function Shell(): JSX.Element {
  return (
    <PageChromeProvider>
      <ShellFrame />
    </PageChromeProvider>
  );
}

function ShellFrame() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // New screen: start at the top (HashRouter does not do this itself).
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);

  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    // A plain "#main" href would be swallowed by the hash router, so focus the target manually.
    e.preventDefault();
    mainRef.current?.focus();
    mainRef.current?.scrollIntoView?.();
  };

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        onClick={skip}
        className="sr-only left-3 top-3 z-50 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed"
      >
        Skip to content
      </a>
      <SidebarNav />
      <div className="md:pl-64 print:pl-0">
        <Header fallbackTitle={ROUTE_TITLES[pathname] ?? 'VyayaMitra'} />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto max-w-6xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-4 focus:outline-none md:px-8 md:pb-12 print:pb-0"
        >
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
