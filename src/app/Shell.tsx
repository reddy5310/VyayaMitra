import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Compass,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Landmark,
  LayoutDashboard,
  Lock,
  ReceiptText,
  Settings,
  Sparkles,
  Target,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { SampleBanner } from '@/db/sampleBanner';
import { Button, IconButton, cn, usePrivacy, useToast } from '@/ui';
import { PageChromeProvider, useChromeConfig } from './chrome';
import { useInstall } from './install';
import { AccountScopePicker, PeriodPicker } from './period';
import { UpdateBanner } from './pwa';
import { ROUTES } from './routes';
import { useScrollMemory } from './scroll';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** The five destinations. Import and Settings are actions, not destinations. */
const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.overview, label: 'Overview', icon: LayoutDashboard, end: true },
  { to: ROUTES.explore, label: 'Explore', icon: Compass },
  { to: ROUTES.activity, label: 'Activity', icon: ReceiptText },
  { to: ROUTES.plan, label: 'Plan', icon: Target },
  { to: ROUTES.accounts, label: 'Accounts', icon: Landmark },
];

const IMPORT_ITEM: NavItem = { to: ROUTES.import, label: 'Import', icon: FileUp };
const LEARNING_ITEM: NavItem = { to: ROUTES.learning, label: 'Learning', icon: Sparkles };
const SETTINGS_ITEM: NavItem = { to: ROUTES.settings, label: 'Settings', icon: Settings };

const ROUTE_TITLES: Record<string, string> = {
  [ROUTES.overview]: 'Overview',
  [ROUTES.explore]: 'Explore',
  [ROUTES.activity]: 'Activity',
  [ROUTES.import]: 'Import statements',
  [ROUTES.plan]: 'Plan',
  [ROUTES.accounts]: 'Accounts',
  [ROUTES.settings]: 'Settings',
  [ROUTES.learning]: 'Learning centre',
  [ROUTES.report]: 'Report',
};

const BASE = import.meta.env.BASE_URL;

function Brand({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src={`${BASE}logo.svg`} alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
      {!compact && <span className="text-lg font-semibold tracking-tight text-fg">VyayaMitra</span>}
    </div>
  );
}

/** Desktop (lg+): full sidebar with destinations, then Import and the secondary links. */
function Sidebar() {
  const { canInstall, promptInstall } = useInstall();
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-touch items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
      isActive ? 'bg-primary-soft text-primary' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
    );
  return (
    <aside data-nav="sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface px-3 py-5 lg:flex print:hidden">
      <Brand className="px-3 pb-5" />
      <Link
        to={IMPORT_ITEM.to}
        data-action="import"
        className="mb-4 flex min-h-touch items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg shadow-card transition-colors hover:bg-primary/90"
      >
        <FileUp className="h-5 w-5" aria-hidden />
        Import statement
      </Link>
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={link}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <nav aria-label="More" className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
        {[LEARNING_ITEM, SETTINGS_ITEM].map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={link}>
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      {canInstall && (
        <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" aria-hidden />} onClick={() => void promptInstall()} className="mt-3">
          Install app
        </Button>
      )}
      <div className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-fg-muted">
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
          Private
        </p>
        <p className="mt-1">Your data stays on this device. Nothing is uploaded.</p>
      </div>
    </aside>
  );
}

function RailBody({ icon: Icon, label, isActive }: { icon: LucideIcon; label: string; isActive: boolean }) {
  return (
    <>
      <span className={cn('flex h-8 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      {label}
    </>
  );
}

/** Tablet (md to lg): a narrow navigation rail, icons with short labels. */
function Rail() {
  const item = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex min-h-touch w-full flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors',
      isActive ? 'text-primary' : 'text-fg-muted hover:text-fg',
    );
  return (
    <aside data-nav="rail" className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col items-center border-r border-border bg-surface px-1.5 py-4 md:flex lg:hidden print:hidden">
      <Brand compact className="pb-4" />
      <nav aria-label="Primary" className="flex w-full flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon, end }) => (
          <NavLink key={to} to={to} end={end} className={item}>
            {({ isActive }) => <RailBody icon={icon} label={label} isActive={isActive} />}
          </NavLink>
        ))}
      </nav>
      <nav aria-label="More" className="flex w-full flex-col gap-1 border-t border-border pt-2">
        {[IMPORT_ITEM, SETTINGS_ITEM].map(({ to, label, icon }) => (
          <NavLink key={to} to={to} data-action={to === ROUTES.import ? 'import' : undefined} className={item}>
            {({ isActive }) => <RailBody icon={icon} label={label} isActive={isActive} />}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

/** Phones (below md): bottom navigation with the five destinations. */
function BottomTabs() {
  return (
    <nav
      data-nav="bottom"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe pl-safe pr-safe backdrop-blur md:hidden print:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[64px] w-full min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[11px] font-medium leading-tight transition-colors',
                  isActive ? 'text-primary' : 'text-fg-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-[32px] w-[52px] items-center justify-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                    <Icon className="h-[22px] w-[22px]" aria-hidden />
                  </span>
                  <span className="max-w-full break-words">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The Import action in the header (phones and tablets; the sidebar carries its own on desktop). */
function ImportAction() {
  return (
    <Link
      to={IMPORT_ITEM.to}
      data-action="import"
      aria-label="Import statement"
      className="inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-fg shadow-card transition-colors hover:bg-primary/90 lg:hidden"
    >
      <FileUp className="h-5 w-5" aria-hidden />
      <span className="hidden sm:inline">Import</span>
    </Link>
  );
}

/** Settings gear for phones; the rail and sidebar carry it from md up. */
function SettingsAction() {
  return (
    <Link
      to={SETTINGS_ITEM.to}
      data-action="settings"
      aria-label="Settings"
      className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
    >
      <Settings className="h-5 w-5" aria-hidden />
    </Link>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Small header note while the device is offline; nothing else about the app changes. */
function OfflineNote() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" data-offline className="flex items-start gap-2 border-t border-border bg-surface-2 px-4 py-1.5 text-xs text-fg-muted md:px-8 print:hidden">
      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>Offline — everything still works except loading the OCR files for the first time.</span>
    </p>
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
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 print:hidden md:order-2">
          {chrome?.actions}
          <HideAmountsToggle />
          <SettingsAction />
          <ImportAction />
        </div>
        {chrome?.showPeriod && (
          <div className="order-last flex min-w-0 basis-full flex-wrap items-center gap-2 pb-1 print:hidden md:order-1 md:basis-auto md:pb-0">
            <PeriodPicker />
            <AccountScopePicker />
          </div>
        )}
      </div>
      {/* Always visible while sample data is on (the header is sticky on phones). */}
      <SampleBanner />
      <OfflineNote />
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

  // New screen: top of page; returning with Back: where the person was.
  useScrollMemory();

  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    // A plain "#main" href would be swallowed by the hash router, so focus the target manually.
    e.preventDefault();
    mainRef.current?.focus();
    mainRef.current?.scrollIntoView?.();
  };

  const fallback = ROUTE_TITLES[pathname] ?? (pathname.startsWith(`${ROUTES.accounts}/`) ? 'Account' : 'VyayaMitra');

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        onClick={skip}
        className="sr-only left-3 top-3 z-50 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed"
      >
        Skip to content
      </a>
      <Sidebar />
      <Rail />
      <div className="md:pl-20 lg:pl-64 print:pl-0">
        <Header fallbackTitle={fallback} />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto max-w-6xl px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 focus:outline-none md:px-8 md:pb-12 print:pb-0"
        >
          <Outlet />
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
