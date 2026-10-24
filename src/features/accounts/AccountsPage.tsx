import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { ROUTES, accountLink, activityLink } from '@/app/routes';
import { useLedger } from '@/db/hooks';
import { formatDate } from '@/lib/dates';
import { ACCOUNT_TYPE_LABELS } from '../import/accountTypes';
import { Badge, Card, CardHeader, EmptyState, ListGroup, ListRow, Skeleton } from '@/ui';
import { CoverageGrid } from './CoverageGrid';
import { ImportHistory } from './ImportHistory';
import { GROUP_LABELS, coverageMonths, dataThrough, groupAccounts } from './accountInfo';

const importLink = 'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90';

export default function AccountsPage() {
  usePageChrome({
    title: 'Accounts',
    subtitle: 'Your accounts, the statements behind them, and which months are covered.',
  });
  const ledger = useLedger();
  const groups = useMemo(() => groupAccounts(ledger.accounts), [ledger.accounts]);
  const months = useMemo(() => coverageMonths(), []);
  const reviewCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of ledger.transactions) if (t.needsReview) counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
    return counts;
  }, [ledger.transactions]);

  if (!ledger.ready) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading accounts">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <Card>
          <EmptyState
            title="No accounts yet"
            body="Import a bank or credit-card statement and its account appears here."
            action={
              <Link to={ROUTES.import} className={importLink}>
                <Upload className="h-4 w-4" aria-hidden />
                Import a statement
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const visible = groups.flatMap((g) => g.accounts);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-4">
      <div className="flex justify-end">
        <Link to={ROUTES.import} className={importLink}>
          <Upload className="h-4 w-4" aria-hidden />
          Import statements
        </Link>
      </div>
      {groups.map((g) => (
        <section key={g.id} aria-label={GROUP_LABELS[g.id]}>
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">{GROUP_LABELS[g.id]}</h2>
          <ListGroup>
            {g.accounts.map((a) => {
              const through = dataThrough(a.id, ledger.statements);
              const review = reviewCount.get(a.id) ?? 0;
              return (
                <div key={a.id} className="flex items-center">
                  <div className="min-w-0 flex-1">
                    <Link to={accountLink(a.id)} className="block">
                      <ListRow
                        title={a.name}
                        subtitle={
                          <>
                            {ACCOUNT_TYPE_LABELS[a.type]}
                            {a.mask ? ` ••${a.mask}` : ''} · {through ? `Data through ${formatDate(through)}` : 'No statements yet'}
                          </>
                        }
                        showChevron
                      />
                    </Link>
                  </div>
                  {review > 0 && (
                    <Link to={activityLink({ account: a.id, review: true })} className="mr-3 shrink-0" aria-label={`${review} transactions to review in ${a.name}`}>
                      <Badge tone="warning">{review} to review</Badge>
                    </Link>
                  )}
                </div>
              );
            })}
          </ListGroup>
        </section>
      ))}

      <Card>
        <CardHeader title="Statement coverage" subtitle="The last 12 months. Tap a month to see that account's statements." />
        <CoverageGrid accounts={visible} statements={ledger.statements} months={months} />
      </Card>

      <ImportHistory statements={ledger.statements} accounts={ledger.accounts} transactions={ledger.transactions} />
    </div>
  );
}
