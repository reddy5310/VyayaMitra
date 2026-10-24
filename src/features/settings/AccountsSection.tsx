import { useState } from 'react';
import { Archive, Banknote, CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import type { Account, AccountType } from '@/domain/types';
import { deleteAccount, updateAccount } from '@/db/actions';
import { useAccounts, useStatements } from '@/db/hooks';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, ListGroup, ListRow, Notice, Select, Sheet, Skeleton, Switch, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { ACCOUNT_TYPE_LABELS } from './labels';
import { errorMessage } from './utils';

const TYPE_ICONS: Record<AccountType, LucideIcon> = {
  savings: PiggyBank,
  current: Landmark,
  credit_card: CreditCard,
  wallet: Wallet,
  loan: Landmark,
  investment: TrendingUp,
  cash: Banknote,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function AccountsSection() {
  const accounts = useAccounts();
  const statements = useStatements();
  const [editing, setEditing] = useState<Account | null>(null);

  const stmtCount = (id: string) => (statements ?? []).filter((s) => s.accountId === id).length;

  return (
    <SettingsSection title="Accounts" subtitle="Rename, retype or archive the accounts created when you import statements.">
      {accounts === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : accounts.length === 0 ? (
        <EmptyState title="No accounts yet" body="Accounts appear here after you import your first statement." />
      ) : (
        <ListGroup>
          {accounts.map((a) => {
            const Icon = TYPE_ICONS[a.type];
            return (
              <ListRow
                key={a.id}
                onClick={() => setEditing(a)}
                leading={
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                }
                title={a.name}
                subtitle={[a.institution, ACCOUNT_TYPE_LABELS[a.type], a.mask ? `••${a.mask}` : null, plural(stmtCount(a.id), 'statement')]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={a.archived ? <Badge>Archived</Badge> : undefined}
                aria-label={`Edit ${a.name}`}
              />
            );
          })}
        </ListGroup>
      )}
      {editing && <EditAccountSheet key={editing.id} account={editing} statementCount={stmtCount(editing.id)} onClose={() => setEditing(null)} />}
    </SettingsSection>
  );
}

function EditAccountSheet({ account, statementCount, onClose }: { account: Account; statementCount: number; onClose: () => void }) {
  const { toast } = useToast();
  const statements = useStatements();
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [mask, setMask] = useState(account.mask ?? '');
  const [archived, setArchived] = useState(Boolean(account.archived));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const txnCount = (statements ?? []).filter((s) => s.accountId === account.id).reduce((sum, s) => sum + s.rowCount, 0);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the account a name.');
    if (mask && !/^\d{4}$/.test(mask)) return setError('Enter exactly the last 4 digits, or leave it blank. Never enter a full number.');
    setSaving(true);
    setError(null);
    try {
      await updateAccount(account.id, { name: trimmed, type, mask: mask || undefined, archived });
      toast('Account updated.', { tone: 'success' });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        open={!confirmDelete}
        onClose={onClose}
        title="Edit account"
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" className="text-negative" onClick={() => setConfirmDelete(true)}>
              Delete account
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Name">{({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
          <Field label="Type">
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Last 4 digits" hint="Only the last 4 digits are ever stored. Used to recognise this account on future statements.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={mask}
                onChange={(e) => setMask(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="e.g. 7422"
              />
            )}
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-1">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <Archive className="h-4 w-4 text-fg-muted" aria-hidden />
                Archive
              </p>
              <p className="text-xs text-fg-muted">Keeps the history but stops counting this account toward coverage checks.</p>
            </div>
            <Switch checked={archived} onChange={setArchived} label="Archive this account" />
          </div>
          {error && <Notice tone="negative">{error}</Notice>}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        tone="danger"
        title={`Delete ${account.name}?`}
        confirmLabel="Delete account"
        onConfirm={async () => {
          await deleteAccount(account.id);
          toast('Account deleted.', { tone: 'success' });
          onClose();
        }}
      >
        <p>
          This permanently removes the account together with its {plural(statementCount, 'statement')} and about {plural(txnCount, 'transaction')}.
          Links between those transactions and your other accounts (for example card bill payments) are removed too.
        </p>
        <p>Budgets, goals, remembered rules and your other accounts are not affected. This cannot be undone, so export a backup first if you are unsure.</p>
      </ConfirmDialog>
    </>
  );
}
