/** Route paths (HashRouter, so they work on GitHub Pages without server rewrites). */
export const ROUTES = {
  overview: '/',
  activity: '/activity',
  import: '/import',
  plan: '/plan',
  settings: '/settings',
  report: '/report',
  learning: '/learning',
} as const;

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
