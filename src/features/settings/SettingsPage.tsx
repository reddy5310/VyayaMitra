import { useState } from 'react';
import { usePageChrome } from '@/app/chrome';
import { TabPanel, Tabs, type TabItem } from '@/ui';
import { AccountsSection } from './AccountsSection';
import { BackupSection } from './BackupSection';
import { CategoriesSection } from './CategoriesSection';
import { AboutSection, DangerSection, InstallSection, StorageSection } from './DeviceSections';
import { AppearanceSection, PrivacySection } from './PreferencesSections';
import { RulesSection } from './RulesSection';
import { StatementsSection } from './StatementsSection';

type GroupId = 'data' | 'preferences' | 'backup' | 'app';

const GROUPS: TabItem<GroupId>[] = [
  { value: 'data', label: 'Data' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'backup', label: 'Backup' },
  { value: 'app', label: 'App' },
];

const ID_BASE = 'settings';

export default function SettingsPage() {
  usePageChrome({ title: 'Settings' });
  const [group, setGroup] = useState<GroupId>('data');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Tabs<GroupId> label="Settings sections" idBase={ID_BASE} value={group} onChange={setGroup} tabs={GROUPS} />
      <TabPanel idBase={ID_BASE} value="data" active={group === 'data'} className="space-y-4">
        <AccountsSection />
        <StatementsSection />
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
