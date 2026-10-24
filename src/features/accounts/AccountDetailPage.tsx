import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { ROUTES, activityLink } from '@/app/routes';
import { deleteAccount, updateAccount } from '@/db/actions';
import { useLedger } from '@/db/hooks';
import type { Account, Statement } from '@/domain/types';
import { cardCycles, type CardCycle } from '@/engine/analytics';
import { deleteStatement } from '@/engine/import';
import { formatDate, formatMonth, monthKey, todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Money, Skeleton, useToast } from '@/ui';
import { ACCOUNT_TYPE_LABELS } from '../import/accountTypes';
import { CoverageGrid } from './CoverageGrid';
import { coverageMonths, dataThrough } from './accountInfo';

const PAYMENT_STATUS: Record<CardCycle['paymentStatus'], { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' }> = {
  paid: { label: 'Paid', tone: 'positive' },
  partly_paid: { label: 'Partly paid', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'negative' },
  unknown: { label: 'Not confirmed yet', tone: 'neutral' },
};

const RECON_BADGE: Record<Statement['reconciliation']['status'], { label: string; tone: 'positive' | 'warning' | 'neutral' }> = {
  balanced: { label: 'Totals match', tone: 'positive' },
  mismatch: { label: 'Totals do not match', tone: 'warning' },
  unverified: { label: 'Not checkable', tone: 'neutral' },
};

function period(start?: string, end?: string): string {
  return start && end ? `${formatDate(start, { short: true })} – ${formatDate(end)}` : 'Period not printed';
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

function CycleCard({ cycle }: { cycle: CardCycle }) {
  const status = PAYMENT_STATUS[cycle.paymentStatus];
  const endMonth = cycle.periodEnd ? formatMonth(monthKey(cycle.periodEnd)).split(' ')[0] : null;
  return (
    <Card className="space-y-3" aria-label={`Statement cycle ${period(cycle.periodStart, cycle.periodEnd)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{period(cycle.periodStart, cycle.periodEnd)}</h3>
          {cycle.statementDate && <p className="text-xs text-fg-muted">Statement dated {formatDate(cycle.statementDate)}</p>}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Figure label="Statement balance">{cycle.totalDue !== undefined ? <Money value={cycle.totalDue} /> : 'Not printed'}</Figure>
        <Figure label="Due date">{cycle.dueDate ? formatDate(cycle.dueDate) : 'Not printed'}</Figure>
        <Figure label="Minimum due">{cycle.minimumDue !== undefined ? <Money value={cycle.minimumDue} /> : 'Not printed'}</Figure>
        <Figure label="Purchases">
          <Money value={cycle.purchases} />
        </Figure>
        <Figure label="Refunds">
          <Money value={cycle.refunds} />
        </Figure>
        <Figure label="Fees">
          <Money value={cycle.fees} />
        </Figure>
        <Figure label="Interest">
          <Money value={cycle.interest} />
        </Figure>
        <Figure label="Payments received">
          <Money value={cycle.payments} />
        </Figure>
      </dl>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Repayments matched to your bank</h4>
        {cycle.matchedRepayments.length === 0 ? (
          <p className="mt-1 text-sm text-fg-muted">
            {cycle.paymentStatus === 'unknown'
              ? 'No repayment found yet. Import the bank account you pay this card from to confirm it.'
              : 'No bank-side repayment was matched.'}
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-border text-sm">
            {cycle.matchedRepayments.map((r) => (
              <li key={r.txnId} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {formatDate(r.date)} · <Money value={r.amount} />
                </span>
                <Link to={activityLink({ txn: r.txnId })} className="min-h-9 text-sm font-medium text-primary hover:underline">
                  See the bank payment
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cycle.periodStart && cycle.periodEnd && endMonth && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          This cycle runs {formatDate(cycle.periodStart, { short: true })} – {formatDate(cycle.periodEnd, { short: true })}, so “{endMonth}” on Overview includes part of it.
        </p>
      )}
      <Link to={activityLink({ ids: cycle.txnIds })} className="inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline">
        See the {cycle.txnIds.length} transactions
      </Link>
    </Card>
  );
}

function RenameForm({ account }: { account: Account }) {
  const { toast } = useToast();
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== account.name;
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed) return;
        setBusy(true);
        try {
          await updateAccount(account.id, { name: name.trim() });
          toast('Account renamed', { tone: 'success' });
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Could not rename the account.', { tone: 'error' });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Account name" className="flex-1">
        {({ id }) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Button type="submit" variant="outline" disabled={!changed} loading={busy}>
        Rename
      </Button>
    </form>
  );
}

export default function AccountDetailPage() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const ledger = useLedger();
  const account = ledger.accounts.find((a) => a.id === accountId);
  usePageChrome({ title: account?.name ?? 'Account' });
  const [deleting, setDeleting] = useState<Statement | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const months = useMemo(() => coverageMonths(), []);

  const statements = useMemo(
    () => ledger.statements.filter((s) => s.accountId === accountId).sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? '')),
    [ledger.statements, accountId],
  );
  const cycles = useMemo(
    () => (account?.type === 'credit_card' ? cardCycles(account, ledger.statements, ledger.transactions, todayIso()) : []),
    [account, ledger.statements, ledger.transactions],
  );

  if (!ledger.ready) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!account) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <Card>
          <EmptyState
            title="Account not found"
            body="It may have been deleted."
            action={
              <Link to={ROUTES.accounts} className="inline-flex min-h-touch items-center text-sm font-medium text-primary hover:underline">
                Back to accounts
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const isCard = account.type === 'credit_card';
  const through = dataThrough(account.id, ledger.statements);
  const txnCount = ledger.transactions.filter((t) => t.accountId === account.id).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4">
      <Link to={ROUTES.accounts} className="inline-flex min-h-touch items-center gap-2 text-sm font-medium text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All accounts
      </Link>

      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-fg">{account.name}</h2>
          <p className="text-sm text-fg-muted">
            {ACCOUNT_TYPE_LABELS[account.type]}
            {account.mask ? ` ••${account.mask}` : ''} · {through ? `data through ${formatDate(through)}` : 'no statements yet'} · {txnCount} transactions
          </p>
        </div>
        <RenameForm account={account} />
        <div className="flex flex-wrap gap-2">
          <Link to={activityLink({ account: account.id })} className="inline-flex min-h-touch items-center rounded-xl border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2">
            See transactions
          </Link>
          <Link to={ROUTES.import} className="inline-flex min-h-touch items-center rounded-xl border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2">
            Import a statement
          </Link>
        </div>
      </Card>

      {isCard && (
        <section aria-label="Statement cycles" className="space-y-3">
          <h2 className="text-sm font-semibold text-fg-muted">Statement cycles</h2>
          {cycles.length === 0 ? (
            <Card>
              <EmptyState title="No statement cycles yet" body="Import a statement for this card to see its balance, due date and repayments." />
            </Card>
          ) : (
            cycles.map((c) => <CycleCard key={c.statementId} cycle={c} />)
          )}
        </section>
      )}

      <Card>
        <CardHeader title="Statements" subtitle={statements.length === 0 ? undefined : `${statements.length} imported`} />
        {statements.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing imported for this account yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {statements.map((s) => {
              const badge = RECON_BADGE[s.reconciliation.status];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg">{period(s.periodStart, s.periodEnd)}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {s.fileName} · {s.rowCount} rows
                    </p>
                  </div>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <Button size="sm" variant="ghost" aria-label={`Delete statement ${s.fileName}`} icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setDeleting(s)}>
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Coverage" subtitle="The last 12 months for this account." />
        <CoverageGrid accounts={[account]} statements={ledger.statements} months={months} />
      </Card>

      <Card>
        <CardHeader title="Remove account" />
        <p className="mb-3 text-sm text-fg-muted">Deletes this account with all of its statements and transactions from this device.</p>
        <Button variant="danger" onClick={() => setDeletingAccount(true)}>
          Delete account
        </Button>
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this statement?"
        tone="danger"
        confirmLabel="Delete statement"
        onConfirm={async () => {
          if (!deleting) return;
          await deleteStatement(deleting.id);
          toast('Statement deleted', { tone: 'success' });
        }}
      >
        <p>
          “{deleting?.fileName}” and the {deleting?.rowCount} transactions imported from it will be removed. This cannot be undone, but you can import the file again.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deletingAccount}
        onClose={() => setDeletingAccount(false)}
        title="Delete this account?"
        tone="danger"
        confirmLabel="Delete account"
        requireText="DELETE"
        onConfirm={async () => {
          await deleteAccount(account.id);
          toast('Account deleted', { tone: 'success' });
          navigate(ROUTES.accounts, { replace: true });
        }}
      >
        <p>
          {account.name}, its {statements.length} statements and {txnCount} transactions will be erased from this device. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
