import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Share, SquarePlus, Trash2 } from 'lucide-react';
import { useInstall } from '@/app/install';
import { PERIOD_STORAGE_KEY } from '@/app/period';
import { deleteAllData, getStorageStatus, requestPersistentStorage } from '@/db/actions';
import { version } from '../../../package.json';
import { Badge, Button, ConfirmDialog, Notice, ProgressBar, Skeleton, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { errorMessage, formatBytes } from './utils';

const REPO_URL = 'https://github.com/reddy5310/VyayaMitra';

type Storage = Awaited<ReturnType<typeof getStorageStatus>>;

export function StorageSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Storage | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getStorageStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = async () => {
    setBusy(true);
    try {
      const ok = await requestPersistentStorage();
      toast(
        ok ? 'Storage is now protected from automatic clean-up.' : 'The browser did not grant protected storage. Keep backups.',
        { tone: ok ? 'success' : 'info' },
      );
      await refresh();
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const used = status?.usageBytes;
  const quota = status?.quotaBytes;

  return (
    <SettingsSection title="Storage" subtitle="Where your data lives: in this browser, on this device.">
      {failed ? (
        <Notice tone="warning">Could not read storage information in this browser.</Notice>
      ) : status === null ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={status.persisted ? 'positive' : 'warning'}>{status.persisted ? 'Protected storage' : 'Not protected'}</Badge>
            <span className="text-fg-muted">
              {status.persisted
                ? 'The browser will not clear your data to free space.'
                : 'The browser may clear this data if the device runs low on space.'}
            </span>
          </div>
          {used !== undefined && (
            <div className="space-y-1.5">
              <p className="text-sm text-fg">
                Using {formatBytes(used)}
                {quota ? <span className="text-fg-muted"> of about {formatBytes(quota)} available</span> : null}
              </p>
              {quota ? <ProgressBar label="Storage used" value={Math.max(used / quota, used > 0 ? 0.01 : 0)} /> : null}
            </div>
          )}
          {!status.persisted && (
            <Button variant="secondary" onClick={request} loading={busy}>
              Protect my data
            </Button>
          )}
        </>
      )}
    </SettingsSection>
  );
}

export function InstallSection() {
  const { canInstall, installed, showIosSteps, promptInstall } = useInstall();
  const { toast } = useToast();
  return (
    <SettingsSection title="Install app" subtitle="Add VyayaMitra to your home screen to open it like any other app, even without internet.">
      {installed ? (
        <Notice tone="positive">VyayaMitra is installed on this device.</Notice>
      ) : canInstall ? (
        <Button
          icon={<Download className="h-4 w-4" aria-hidden />}
          onClick={async () => {
            if (await promptInstall()) toast('VyayaMitra installed.', { tone: 'success' });
          }}
        >
          Install app
        </Button>
      ) : showIosSteps ? (
        <ol className="space-y-2 text-sm text-fg-muted">
          <li className="flex items-center gap-2">
            <Share className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            In Safari, tap the <strong className="text-fg">Share</strong> button.
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            Choose <strong className="text-fg">Add to Home Screen</strong>, then tap <strong className="text-fg">Add</strong>.
          </li>
          <li className="text-xs text-fg-subtle">Open it only in Safari; other iPhone browsers cannot install web apps.</li>
        </ol>
      ) : (
        <p className="text-sm text-fg-muted">
          On Android, open the browser menu and choose <strong className="text-fg">Install app</strong> (or Add to Home screen). On iPhone, use Safari’s Share
          button and choose Add to Home Screen. On a computer, look for the install icon in Chrome or Edge’s address bar.
        </p>
      )}
    </SettingsSection>
  );
}

export function AboutSection() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const offlineReady = 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;

  return (
    <SettingsSection title="About">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-fg-muted">Version</dt>
        <dd className="font-medium text-fg">VyayaMitra {version}</dd>
        <dt className="text-fg-muted">Offline</dt>
        <dd className="font-medium text-fg">
          {offlineReady ? 'Ready: works without internet' : 'Becomes available after the first full load'}
          <span className="font-normal text-fg-muted"> · you are {online ? 'online' : 'offline'}</span>
        </dd>
        <dt className="text-fg-muted">Source</dt>
        <dd>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-touch items-center gap-1.5 font-medium text-primary underline-offset-2 hover:underline"
          >
            Open source on GitHub
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </dd>
      </dl>
    </SettingsSection>
  );
}

export function DangerSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="danger-title" className="rounded-2xl border border-negative/40 bg-negative-soft/40 p-4 sm:p-5">
      <h2 id="danger-title" className="text-base font-semibold text-negative">
        Danger zone
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Permanently erase every account, statement, transaction, rule, budget and goal stored on this device. Backups you downloaded are not affected.
      </p>
      <Button variant="danger" className="mt-3" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>
        Delete all data
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        tone="danger"
        title="Delete all data?"
        confirmLabel="Delete everything"
        requireText="DELETE"
        onConfirm={async () => {
          await deleteAllData();
          try {
            localStorage.removeItem(PERIOD_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          toast('All data deleted from this device.', { tone: 'success' });
        }}
      >
        <p>This cannot be undone. Download a backup first if you might want this data again.</p>
      </ConfirmDialog>
    </section>
  );
}
