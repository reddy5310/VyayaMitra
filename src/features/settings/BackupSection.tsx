import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileJson, Lock, Upload } from 'lucide-react';
import { exportBackup, inspectBackup, restoreBackup, type BackupSummary } from '@/db/backup';
import { Badge, Button, ConfirmDialog, Field, Input, Notice, SegmentedControl, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { backupFileName, downloadBlob, errorMessage } from './utils';

const LAST_BACKUP_KEY = 'vm-last-backup';

function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

const COUNT_LABELS: Record<string, string> = {
  accounts: 'accounts',
  statements: 'statements',
  transactions: 'transactions',
  rules: 'rules',
  budgets: 'budgets',
  goals: 'goals',
};

function describeCounts(counts: Record<string, number> | undefined): string {
  if (!counts) return '';
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${COUNT_LABELS[k] ?? k}`);
  return parts.join(', ');
}

export function BackupSection() {
  return (
    <SettingsSection
      title="Backup & restore"
      subtitle="VyayaMitra keeps data only on this device. A backup file is your safety net, and the way to move to a new phone."
    >
      <ExportBlock />
      <hr className="border-border" />
      <RestoreBlock />
    </SettingsSection>
  );
}

function ExportBlock() {
  const { toast } = useToast();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(readLastBackup);

  const run = async () => {
    if (pass && pass !== confirm) return setError('The two passphrases do not match.');
    setBusy(true);
    setError(null);
    try {
      const blob = await exportBackup(pass ? { passphrase: pass } : {});
      const now = new Date();
      downloadBlob(blob, backupFileName(now));
      const stamp = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      try {
        localStorage.setItem(LAST_BACKUP_KEY, stamp);
      } catch {
        /* optional nicety */
      }
      setLast(stamp);
      setPass('');
      setConfirm('');
      toast(pass ? 'Encrypted backup downloaded.' : 'Backup downloaded.', { tone: 'success' });
    } catch (e) {
      setError(errorMessage(e, 'Could not create the backup.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Export</h3>
        {last && <Badge>Last backup {last}</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Passphrase (optional)" hint="Encrypts the file. If you forget it, the backup cannot be opened by anyone.">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          )}
        </Field>
        {pass && (
          <Field label="Repeat passphrase">
            {({ id }) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
        )}
      </div>
      {!pass && (
        <p className="flex items-start gap-1.5 text-xs text-fg-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Without a passphrase the file is readable by anyone who has it. It contains your transactions.
        </p>
      )}
      {error && <Notice tone="negative">{error}</Notice>}
      <Button onClick={run} loading={busy} icon={<Download className="h-4 w-4" aria-hidden />}>
        Download backup
      </Button>
    </div>
  );
}

function RestoreBlock() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reset = () => {
    setFile(null);
    setSummary(null);
    setPass('');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setSummary(null);
    setError(null);
    setInspecting(true);
    try {
      setSummary(await inspectBackup(f));
    } catch (err) {
      setError(errorMessage(err, 'This does not look like a VyayaMitra backup.'));
    } finally {
      setInspecting(false);
    }
  };

  const needsPass = summary?.encrypted === true;
  const canRestore = Boolean(file && summary && (!needsPass || pass.length > 0));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg">Restore</h3>
      <input ref={inputRef} type="file" accept=".json,application/json" onChange={onPick} className="sr-only" id="restore-file" aria-label="Choose backup file" tabIndex={-1} />
      <Button variant="outline" onClick={() => inputRef.current?.click()} loading={inspecting} icon={<Upload className="h-4 w-4" aria-hidden />}>
        {file ? 'Choose a different file' : 'Choose backup file'}
      </Button>

      {file && summary && (
        <div className="space-y-3 rounded-xl bg-surface-2 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-fg">
            <FileJson className="h-4 w-4 text-primary" aria-hidden />
            <span className="min-w-0 truncate">{file.name}</span>
            {summary.encrypted && <Badge tone="primary">Encrypted</Badge>}
          </p>
          <p className="text-fg-muted">
            {summary.createdAt ? `Created ${new Date(summary.createdAt).toLocaleString('en-IN')}. ` : ''}
            {summary.counts ? `Contains ${describeCounts(summary.counts) || 'no records'}.` : 'Contents are shown after you enter the passphrase.'}
          </p>
          {needsPass && (
            <Field label="Passphrase">
              {({ id }) => <Input id={id} type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />}
            </Field>
          )}
          <div className="space-y-1.5">
            <SegmentedControl<'merge' | 'replace'>
              label="Restore mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'merge', label: 'Merge' },
                { value: 'replace', label: 'Replace' },
              ]}
            />
            <p className="text-xs text-fg-muted">
              {mode === 'merge'
                ? 'Adds records from the backup that are not on this device yet. Nothing here is deleted.'
                : 'Erases everything on this device first, then restores the backup exactly as it was.'}
            </p>
          </div>
          <Button onClick={() => setConfirmOpen(true)} disabled={!canRestore}>
            Restore…
          </Button>
        </div>
      )}
      {error && <Notice tone="negative">{error}</Notice>}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tone={mode === 'replace' ? 'danger' : 'primary'}
        title={mode === 'replace' ? 'Replace everything on this device?' : 'Merge this backup into your data?'}
        confirmLabel={mode === 'replace' ? 'Replace and restore' : 'Merge backup'}
        onConfirm={async () => {
          if (!file) return;
          try {
            const { counts } = await restoreBackup(file, { passphrase: needsPass ? pass : undefined, mode });
            toast(`Restored ${describeCounts(counts) || 'the backup'}.`, { tone: 'success' });
            reset();
          } catch (e) {
            // A wrong passphrase or damaged file never partially applies; say so and keep the dialog open.
            throw new Error(`${errorMessage(e, 'Could not restore this backup.')} Nothing was changed.`);
          }
        }}
      >
        <p>
          {mode === 'replace'
            ? 'All accounts, statements, transactions, rules, budgets and goals currently on this device will be erased and replaced by the backup. This cannot be undone.'
            : 'Records that already exist on this device are kept. Only records that are missing here are added from the backup.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}
