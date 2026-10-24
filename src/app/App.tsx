import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSettings } from '@/db/hooks';
import { PrivacyContext, Skeleton, ToastProvider } from '@/ui';
import { InstallProvider } from './install';
import { PeriodProvider } from './period';
import { PwaProvider } from './pwa';
import { ROUTES } from './routes';
import { RouteBoundary } from './RouteBoundary';
import Shell from './Shell';
import { ThemeProvider } from './theme';

// Every screen is its own chunk so the first paint only downloads the shell.
const OverviewPage = lazy(() => import('@/features/overview/OverviewPage'));
const ActivityPage = lazy(() => import('@/features/activity/ActivityPage'));
const ImportPage = lazy(() => import('@/features/import/ImportPage'));
const PlanPage = lazy(() => import('@/features/plan/PlanPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const ReportPage = lazy(() => import('@/features/reports/ReportPage'));
const LearningPage = lazy(() => import('@/features/learning/LearningPage'));
const ExplorePage = lazy(() => import('@/features/explore/ExplorePage'));
const AccountsPage = lazy(() => import('@/features/accounts/AccountsPage'));
const AccountDetailPage = lazy(() => import('@/features/accounts/AccountDetailPage'));
const MonthReviewPage = lazy(() => import('@/features/review/MonthReviewPage'));
const MoneyBackPage = lazy(() => import('@/features/moneyback/MoneyBackPage'));
const FeesPage = lazy(() => import('@/features/fees/FeesPage'));

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading screen">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** One route's content: lazy chunk + its own error boundary that resets when the route changes. */
function Screen({ page: Page }: { page: ComponentType }) {
  const { pathname } = useLocation();
  return (
    <RouteBoundary resetKey={pathname}>
      <Suspense fallback={<PageFallback />}>
        <Page />
      </Suspense>
    </RouteBoundary>
  );
}

/** Feeds AppSettings.hideAmounts to every <Money/> in the tree. */
function PrivacyBridge({ children }: { children: ReactNode }) {
  const { hideAmounts } = useSettings();
  const value = useMemo(() => ({ hideAmounts }), [hideAmounts]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path={ROUTES.overview} element={<Screen page={OverviewPage} />} />
        <Route path={ROUTES.activity} element={<Screen page={ActivityPage} />} />
        <Route path={ROUTES.import} element={<Screen page={ImportPage} />} />
        <Route path={ROUTES.plan} element={<Screen page={PlanPage} />} />
        <Route path={ROUTES.settings} element={<Screen page={SettingsPage} />} />
        <Route path={ROUTES.report} element={<Screen page={ReportPage} />} />
        <Route path={ROUTES.learning} element={<Screen page={LearningPage} />} />
        <Route path={ROUTES.explore} element={<Screen page={ExplorePage} />} />
        <Route path={ROUTES.accounts} element={<Screen page={AccountsPage} />} />
        <Route path={`${ROUTES.accounts}/:accountId`} element={<Screen page={AccountDetailPage} />} />
        <Route path={ROUTES.review} element={<Screen page={MonthReviewPage} />} />
        <Route path={ROUTES.moneyBack} element={<Screen page={MoneyBackPage} />} />
        <Route path={ROUTES.fees} element={<Screen page={FeesPage} />} />
        <Route path="*" element={<Navigate to={ROUTES.overview} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <InstallProvider>
          <PwaProvider>
            <RouteBoundary>
              <PrivacyBridge>
                <PeriodProvider>
                  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <AppRoutes />
                  </HashRouter>
                </PeriodProvider>
              </PrivacyBridge>
            </RouteBoundary>
          </PwaProvider>
        </InstallProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
