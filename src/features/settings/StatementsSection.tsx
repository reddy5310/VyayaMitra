import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Statement } from '@/domain/types';
import { deleteStatement } from '@/engine/import';
import { useAccounts, useStatements } from '@/db/hooks';
import { formatDate } from '@/lib/dates';
import { Badge, ConfirmDialog, EmptyState, IconButton, ListGroup, ListRow, Skeleton, useToast, type Tone } from '@/ui';
import { SettingsSection } from './shared';

const STATUS: Record<Statement['reconciliation']['status'], { label: string; tone: Tone; hint: string }> = {
  balanced: { label: 'Balanced', tone: 'positive', hint: 'Every check against the printed balances and totals passed.' },
  mismatch: { label: 'Mismatch', tone: 'warning', hint: 'At least one check failed. Affected rows are flagged for review.' },
  unverified: { label: 'Unverified', tone: 'neutral', hint: 'This statement prints nothing we can check against. Rows were still imported.' },
};

function period(s: Statement): string {
  if (s.periodStart && s.periodEnd) return `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`;
  return 'Period not printed';
}

export function StatementsSection() {
  const statements = useStatements();
  const accounts = useAccounts();
  const { toast } = useToast();
  const [pending, setPending] = useState<Statement | null>(null);

  const accountName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? 'Unknown account';
  const ids = Array.from(new Set((statements ?? []).map((s) => s.accountId)));

  return (
    <SettingsSection title="Statements" subtitle="Each imported file, with whether its numbers added up. Delete one to remove only its transactions.">
      {statements === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : statements.length === 0 ? (
        <EmptyState title="No statements yet" body="Import a bank or credit-card statement to get started." />
      ) : (
        ids.map((accountId) => (
          <div key={accountId} className="space-y-2">
            <h3 className="text-sm font-semibold text-fg-muted">{accountName(accountId)}</h3>
            <ListGroup>
              {statements
                .filter((s) => s.accountId === accountId)
                .sort((a, b) => (b.periodEnd ?? b.importedAt).localeCompare(a.periodEnd ?? a.importedAt))
                .map((s) => {
                  const status = STATUS[s.reconciliation.status];
                  const failed = s.reconciliation.checks.filter((c) => !c.ok);
                  return (
                    <ListRow
                      key={s.id}
                      title={period(s)}
                      subtitle={
                        <>
                          {s.rowCount} {s.rowCount === 1 ? 'transaction' : 'transactions'} · {s.fileName}
                          {failed.length > 0 && <span className="mt-0.5 block text-warning">{failed.map((c) => c.label).join('; ')}</span>}
                        </>
                      }
                      trailing={
                        <span className="flex items-center gap-1">
                          <Badge tone={status.tone} title={status.hint}>
                            {status.label}
                          </Badge>
                          <IconButton label={`Delete statement ${period(s)}`} onClick={() => setPending(s)}>
                            <Trash2 className="h-5 w-5" aria-hidden />
                          </IconButton>
                        </span>
                      }
                    />
                  );
                })}
            </ListGroup>
          </div>
        ))
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        tone="danger"
        title="Delete this statement?"
        confirmLabel="Delete statement"
        onConfirm={async () => {
          if (!pending) return;
          await deleteStatement(pending.id);
          toast('Statement deleted.', { tone: 'success' });
        }}
      >
        {pending && (
          <>
            <p>
              This removes {pending.rowCount} {pending.rowCount === 1 ? 'transaction' : 'transactions'} from {period(pending)} in{' '}
              {accountName(pending.accountId)}, plus any transfer or refund links that point at them.
            </p>
            <p>Other statements and your account stay as they are. You can import the file again later.</p>
          </>
        )}
      </ConfirmDialog>
    </SettingsSection>
  );
}
