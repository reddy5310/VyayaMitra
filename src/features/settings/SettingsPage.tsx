import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Sparkles } from 'lucide-react';
import { usePageChrome } from '@/app/chrome';
import { ROUTES } from '@/app/routes';
import { TabPanel, Tabs, type TabItem } from '@/ui';
import { BackupSection } from './BackupSection';
import { CategoriesSection } from './CategoriesSection';
import { AboutSection, DangerSection, InstallSection, StorageSection } from './DeviceSections';
import { AppearanceSection, PrivacySection } from './PreferencesSections';
import { RulesSection } from './RulesSection';

type GroupId = 'data' | 'preferences' | 'backup' | 'app';

const GROUPS: TabItem<GroupId>[] = [
  { value: 'data', label: 'Data' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'backup', label: 'Backup' },
  { value: 'app', label: 'App' },
];

const ID_BASE = 'settings';

function QuickLink({ to, icon, title, body }: { to: string; icon: ReactNode; title: string; body: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-touch items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="block text-sm text-fg-muted">{body}</span>
      </span>
    </Link>
  );
}

export default function SettingsPage() {
  usePageChrome({ title: 'Settings' });
  const [group, setGroup] = useState<GroupId>('data');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Tabs<GroupId> label="Settings sections" idBase={ID_BASE} value={group} onChange={setGroup} tabs={GROUPS} />
      <TabPanel idBase={ID_BASE} value="data" active={group === 'data'} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLink to={ROUTES.accounts} icon={<Landmark className="h-5 w-5" aria-hidden />} title="Accounts and statements" body="Manage accounts and statements" />
          <QuickLink to={ROUTES.learning} icon={<Sparkles className="h-5 w-5" aria-hidden />} title="Learning centre" body="See what VyayaMitra has learned" />
        </div>
        <RulesSection />
        <CategoriesSection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} value="preferences" active={group === 'preferences'} className="space-y-4">
        <AppearanceSection />
        <PrivacySection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} value="backup" active={group === 'backup'} className="space-y-4">
        <BackupSection />
        <StorageSection />
        <DangerSection />
      </TabPanel>
      <TabPanel idBase={ID_BASE} value="app" active={group === 'app'} className="space-y-4">
        <InstallSection />
        <AboutSection />
      </TabPanel>
    </div>
  );
}
