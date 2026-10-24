import { Suspense, lazy, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Compass, Upload } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { ROUTES, type ExploreView } from '@/app/routes';
import { EmptyState, SegmentedControl, Skeleton } from '@/ui';
import { VIEWS, parseView } from './views';
import { useExploreData } from './useExploreData';

// Each view is its own chunk: Recharts (Trends, Merchants, Flow) loads only when that view opens.
const CategoriesView = lazy(() => import('./CategoriesView'));
const TrendsView = lazy(() => import('./TrendsView'));
const CompareView = lazy(() => import('./CompareView'));
const MerchantsView = lazy(() => import('./MerchantsView'));
const PatternsView = lazy(() => import('./PatternsView'));
const FlowView = lazy(() => import('./FlowView'));

const COMPONENTS: Record<ExploreView, ReturnType<typeof lazy>> = {
  categories: CategoriesView,
  trends: TrendsView,
  compare: CompareView,
  merchants: MerchantsView,
  patterns: PatternsView,
  flow: FlowView,
};

export default function ExplorePage() {
  usePageChrome({ title: 'Explore', showPeriod: true });
  const { ready, transactions } = useExploreData();
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get('view'));
  const setView = useCallback(
    (next: ExploreView) => {
      const sp = new URLSearchParams(params);
      sp.set('view', next);
      if (next !== 'categories') sp.delete('category');
      setParams(sp, { replace: true });
    },
    [params, setParams],
  );
  const View = COMPONENTS[view];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 sm:px-6">
      {ready && transactions.length === 0 ? (
        <EmptyState
          icon={<Compass className="h-6 w-6" aria-hidden />}
          title="Nothing to explore yet"
          body="Import a statement and your spending patterns will appear here, all computed on this device."
          action={
            <Link to={ROUTES.import} className="inline-flex min-h-touch items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg">
              <Upload className="h-4 w-4" aria-hidden /> Import a statement
            </Link>
          }
        />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <SegmentedControl label="Explore view" value={view} onChange={setView} options={VIEWS} className="min-w-max" />
          </div>
          {!ready ? (
            <Skeleton className="h-72" />
          ) : (
            <Suspense fallback={<Skeleton className="h-72" />}>
              <View />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
