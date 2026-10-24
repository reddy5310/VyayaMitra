import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { institutionName } from '@/domain/institutions';
import type { StatementTemplate, TemplateSource } from '@/domain/types';
import { deleteTemplate, exportTemplates, importTemplates, updateTemplate } from '@/db/learning';
import { todayIso } from '@/lib/dates';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, IconButton, Input, Sheet, Skeleton, useToast, type Tone } from '@/ui';

const SOURCE: Record<TemplateSource, { label: string; tone: Tone }> = {
  auto: { label: 'Learned automatically', tone: 'info' },
  user: { label: 'Taught by you', tone: 'primary' },
  imported: { label: 'Imported', tone: 'neutral' },
};

const ACCOUNT_LABEL: Record<string, string> = {
  savings: 'Savings account',
  current: 'Current account',
  credit_card: 'Credit card',
  wallet: 'Wallet',
  loan: 'Loan',
  investment: 'Investment',
  cash: 'Cash',
};

function message(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was changed.';
}

/** Hands a Blob to the browser as a file download. */
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function FormatsSection({ templates }: { templates: StatementTemplate[] | undefined }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<StatementTemplate | null>(null);
  const [deleting, setDeleting] = useState<StatementTemplate | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  async function onExport() {
    setBusy('export');
    try {
      const blob = await exportTemplates();
      download(blob, `vyayamitra-formats-${todayIso()}.json`);
      toast('Formats exported. The file has no personal data.', { tone: 'success' });
    } catch (e) {
      toast(message(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('import');
    try {
      const { added, merged } = await importTemplates(file);
      toast(`Formats imported: ${added} new, ${merged} merged with ones you already had.`, { tone: 'success' });
    } catch (err) {
      toast(`Could not import that file. ${message(err)}`, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Formats it can read"
        subtitle="Each time a statement checks out against its own balances, its layout is remembered so the next one is read instantly."
      />
      {templates === undefined ? (
        <Skeleton className="h-20 w-full" />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" aria-hidden />}
          title="No formats learned yet"
          body="Import a statement and its layout is saved here automatically when the numbers add up."
          className="py-6"
        />
      ) : (
        <ul className="divide-y divide-border">
          {templates.map((t) => {
            const src = SOURCE[t.source];
            return (
              <li key={t.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{t.name}</p>
                  <p className="text-xs text-fg-muted">
                    {institutionName(t.institution)} · {ACCOUNT_LABEL[t.accountType] ?? t.accountType} · {t.fileKind === 'pdf' ? 'PDF' : 'Spreadsheet or CSV'}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                    <Badge tone={src.tone}>{src.label}</Badge>
                    <span>Used {t.useCount} {t.useCount === 1 ? 'time' : 'times'}</span>
                    <span>·</span>
                    <span>{t.verifiedCount} verified</span>
                  </p>
                </div>
                <div className="-mr-2 flex shrink-0">
                  <IconButton label={`Rename ${t.name}`} onClick={() => setRenaming(t)}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          variant="secondary"
          icon={<Download className="h-4 w-4" aria-hidden />}
          onClick={onExport}
          loading={busy === 'export'}
          disabled={!templates || templates.length === 0}
        >
          Export formats
        </Button>
        <Button variant="secondary" icon={<Upload className="h-4 w-4" aria-hidden />} onClick={() => fileRef.current?.click()} loading={busy === 'import'}>
          Import formats
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Choose a formats file to import" onChange={onImport} />
      </div>

      {renaming && <RenameSheet key={renaming.id} template={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this format?"
        tone="danger"
        confirmLabel="Delete format"
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTemplate(deleting.id);
          toast('Format deleted.', { tone: 'success' });
        }}
      >
        <p>
          &ldquo;{deleting?.name}&rdquo; will be forgotten. Statements you already imported stay as they are. The next statement in this layout is simply read from
          scratch, and its format is learned again if the numbers add up.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function RenameSheet({ template, onClose }: { template: StatementTemplate; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(template.name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the format a name.');
      return;
    }
    setBusy(true);
    try {
      await updateTemplate(template.id, { name: trimmed });
      toast('Format renamed.', { tone: 'success' });
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm" title="Rename format">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Name" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} value={name} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={busy}>
            Save name
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
