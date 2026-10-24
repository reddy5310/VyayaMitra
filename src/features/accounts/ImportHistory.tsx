import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { Account, Statement, Transaction } from '@/domain/types';
import { deleteStatement } from '@/engine/import';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, ConfirmDialog, useToast } from '@/ui';

const RECON: Record<Statement['reconciliation']['status'], { label: string; tone: 'positive' | 'warning' | 'neutral' }> = {
  balanced: { label: 'Totals match', tone: 'positive' },
  mismatch: { label: 'Totals do not match', tone: 'warning' },
  unverified: { label: 'Not checkable', tone: 'neutral' },
};

function period(s: Statement): string {
  return s.periodStart && s.periodEnd ? `${formatDate(s.periodStart, { short: true })} – ${formatDate(s.periodEnd)}` : 'Period not printed';
}

/** Every import, newest first, each with a way to take it back out. */
export function ImportHistory({
  statements,
  accounts,
  transactions,
}: {
  statements: readonly Statement[];
  accounts: readonly Account[];
  transactions: readonly Transaction[];
}) {
  const { toast } = useToast();
  const [undoing, setUndoing] = useState<Statement | null>(null);
  const sorted = useMemo(() => [...statements].sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [statements]);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Deleted account';

  // What undoing would remove, counted from the ledger rather than trusted from the statement record.
  const impact = useMemo(() => {
    if (!undoing) return null;
    const rows = transactions.filter((t) => t.statementId === undoing.id);
    const corrected = rows.filter((t) => t.categorySource === 'user_txn' || t.kindSource === 'user' || Boolean(t.note)).length;
    const linked = rows.filter((t) => t.linkedTxnId).length;
    return { rows: rows.length, corrected, linked };
  }, [undoing, transactions]);

  if (sorted.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Import history" subtitle="Newest first. Undoing an import removes only what that file added." />
      <ul className="divide-y divide-border" aria-label="Imports">
        {sorted.map((s) => {
          const badge = RECON[s.reconciliation.status];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{s.fileName}</p>
                <p className="text-xs text-fg-muted">
                  {accountName(s.accountId)} · {period(s)} · {s.rowCount} rows · imported {formatDate(s.importedAt.slice(0, 10))}
                </p>
              </div>
              <Badge tone={badge.tone}>{badge.label}</Badge>
              <Button size="sm" variant="outline" aria-label={`Undo this import: ${s.fileName}`} icon={<Undo2 className="h-4 w-4" aria-hidden />} onClick={() => setUndoing(s)}>
                Undo this import
              </Button>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        title="Undo this import?"
        tone="danger"
        confirmLabel="Undo this import"
        onConfirm={async () => {
          if (!undoing) return;
          await deleteStatement(undoing.id);
          toast(`Removed ${undoing.fileName}`, { tone: 'success' });
        }}
      >
        {undoing && impact && (
          <div className="space-y-2">
            <p>This will remove:</p>
            <ul className="list-disc pl-5">
              <li>
                the statement “{undoing.fileName}” ({period(undoing)}) from {accountName(undoing.accountId)}
              </li>
              <li>
                its {impact.rows} transaction{impact.rows === 1 ? '' : 's'}
                {impact.corrected > 0 ? `, including ${impact.corrected} you corrected or added a note to (those changes are lost)` : ''}
              </li>
              {impact.linked > 0 && <li>{impact.linked} links to transactions in your other accounts (those stay, unlinked)</li>}
            </ul>
            <p>Nothing else changes: other statements, your rules and the account itself stay. You can import the file again later.</p>
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}
