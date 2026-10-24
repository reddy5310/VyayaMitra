import { useState } from 'react';
import type { Account, AccountType } from '@/domain/types';
import type { ImportPreview, NewAccountInput } from '@/engine/import';
import { Button, Card, Field, Input, Notice, Select } from '@/ui';
import { ACCOUNT_TYPE_LABELS } from './accountTypes';

export type AccountTarget = { accountId: string } | { newAccount: NewAccountInput };

const NEW = '__new__';

/**
 * Confirms which account these rows belong to. Picking another account re-understands the staged rows
 * (retargetPreview); nothing is saved until the final review step.
 */
export function AccountStep({
  preview,
  accounts,
  onRetarget,
  onContinue,
  onCancel,
}: {
  preview: ImportPreview;
  accounts: readonly Account[];
  /** Re-understand the preview for another account. Rejects with a user-presentable error. */
  onRetarget: (target: AccountTarget) => Promise<void>;
  onContinue: (target: AccountTarget, needsRetarget: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const proposed = preview.account.proposed;
  const [selected, setSelected] = useState<string>(preview.account.existingAccountId ?? NEW);
  const [draft, setDraft] = useState<NewAccountInput>(proposed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usable = accounts.filter((a) => !a.archived);
  const candidates = new Set(preview.candidateAccountIds);
  const ordered = [...usable.filter((a) => candidates.has(a.id)), ...usable.filter((a) => !candidates.has(a.id))];
  const existing = selected === NEW ? undefined : accounts.find((a) => a.id === selected);
  const creating = selected === NEW;

  async function guarded(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch account. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  function choose(value: string) {
    const previous = selected;
    setSelected(value);
    void guarded(async () => {
      try {
        await onRetarget(value === NEW ? { newAccount: draft } : { accountId: value });
      } catch (e) {
        setSelected(previous);
        throw e;
      }
    });
  }

  const maskValid = /^\d{0,4}$/.test(draft.mask ?? '');
  const nameValid = draft.name.trim().length > 0;
  const draftChanged =
    draft.name !== proposed.name || draft.type !== proposed.type || (draft.mask ?? '') !== (proposed.mask ?? '');
  const canContinue = !busy && (creating ? nameValid && maskValid : Boolean(existing));

  function submit() {
    const target: AccountTarget = creating
      ? { newAccount: { ...draft, name: draft.name.trim(), mask: draft.mask || undefined } }
      : { accountId: selected };
    void guarded(() => onContinue(target, creating && draftChanged));
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-fg">Which account is this?</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          {preview.account.existingAccountId
            ? 'This statement looks like an account you already have.'
            : 'No matching account yet, so a new one will be created when you confirm.'}
        </p>
      </div>

      <Field label="Account">
        {({ id }) => (
          <Select id={id} value={selected} disabled={busy} onChange={(e) => choose(e.target.value)}>
            {ordered.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {candidates.has(a.id) ? ' (likely match)' : ''}
              </option>
            ))}
            <option value={NEW}>New account</option>
          </Select>
        )}
      </Field>

      {creating && (
        <fieldset className="space-y-3 rounded-xl border border-border p-3" disabled={busy}>
          <legend className="px-1 text-sm font-medium text-fg">New account details</legend>
          <Field label="Name" error={nameValid ? undefined : 'Give the account a name'}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              {({ id }) => (
                <Select id={id} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AccountType })}>
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Last 4 digits"
              hint="Only the last four digits are kept."
              error={maskValid ? undefined : 'Use up to 4 digits'}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={draft.mask ?? ''}
                  onChange={(e) => setDraft({ ...draft, mask: e.target.value.replace(/\s/g, '') })}
                />
              )}
            </Field>
          </div>
        </fieldset>
      )}

      {existing && (
        <p className="text-sm text-fg-muted">
          Rows will be added to <span className="font-medium text-fg">{existing.name}</span>.
        </p>
      )}

      {error && (
        <Notice tone="negative" title="Could not continue">
          {error}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} loading={busy} disabled={!canContinue}>
          Continue to review
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
