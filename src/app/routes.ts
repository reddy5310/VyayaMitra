/** Route paths (HashRouter, so they work on GitHub Pages without server rewrites). */
export const ROUTES = {
  overview: '/',
  activity: '/activity',
  import: '/import',
  plan: '/plan',
  settings: '/settings',
  report: '/report',
  learning: '/learning',
  explore: '/explore',
  accounts: '/accounts',
  review: '/review',
} as const;

/** Month-end review for a calendar month: '/review?month=YYYY-MM'. */
export function reviewLink(month: string): string {
  return `${ROUTES.review}?month=${month}`;
}

/** Account detail: '/accounts/<id>' (credit cards show statement cycles). */
export function accountLink(id: string): string {
  return `${ROUTES.accounts}/${encodeURIComponent(id)}`;
}

/** Explore sections: '/explore?view=categories|trends|compare|merchants|patterns|flow'. */
export type ExploreView = 'categories' | 'trends' | 'compare' | 'merchants' | 'patterns' | 'flow';
export function exploreLink(view: ExploreView, params: { category?: string } = {}): string {
  const sp = new URLSearchParams({ view });
  if (params.category) sp.set('category', params.category);
  return `${ROUTES.explore}?${sp.toString()}`;
}

/**
 * Activity deep-link query params (all optional):
 *   txn=<id>            open that transaction's detail sheet
 *   ids=<id,id,...>     show exactly these transactions (insight evidence)
 *   category=<id>       filter by category
 *   account=<id>        filter by account
 *   kind=<kind>         filter by kind
 *   review=1            only transactions that need review
 *   q=<text>            search text
 */
export function activityLink(params: {
  txn?: string;
  ids?: string[];
  category?: string;
  account?: string;
  kind?: string;
  review?: boolean;
  q?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.txn) sp.set('txn', params.txn);
  if (params.ids?.length) sp.set('ids', params.ids.join(','));
  if (params.category) sp.set('category', params.category);
  if (params.account) sp.set('account', params.account);
  if (params.kind) sp.set('kind', params.kind);
  if (params.review) sp.set('review', '1');
  if (params.q) sp.set('q', params.q);
  const qs = sp.toString();
  return qs ? `${ROUTES.activity}?${qs}` : ROUTES.activity;
}
