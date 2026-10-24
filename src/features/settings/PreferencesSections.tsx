import { useEffect, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import type { ThemePreference } from '@/domain/types';
import { useTheme } from '@/app/theme';
import { updateSettings } from '@/db/actions';
import { useSettings } from '@/db/hooks';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import { Button, Field, Input, SegmentedControl, Switch, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { errorMessage } from './utils';

export function AppearanceSection() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <SettingsSection title="Appearance" subtitle="System follows your phone or computer, including automatic dark mode at night.">
      <SegmentedControl<ThemePreference>
        label="Theme"
        value={preference}
        onChange={setPreference}
        className="w-full sm:w-auto"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
      <p className="text-xs text-fg-subtle">Currently showing the {resolved} theme.</p>
    </SettingsSection>
  );
}

export function PrivacySection() {
  const settings = useSettings();
  const { toast } = useToast();
  const [rupees, setRupees] = useState(String(paiseToRupees(settings.p2pReviewThreshold)));
  const [error, setError] = useState<string | null>(null);

  // Follow external changes (e.g. a backup restore) when the field is not being edited.
  useEffect(() => {
    setRupees(String(paiseToRupees(settings.p2pReviewThreshold)));
  }, [settings.p2pReviewThreshold]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(rupees);
    if (!rupees.trim() || !Number.isFinite(n) || n < 0) return setError('Enter an amount of 0 or more.');
    setError(null);
    try {
      await updateSettings({ p2pReviewThreshold: rupeesToPaise(n) });
      toast('Review threshold saved.', { tone: 'success' });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <SettingsSection title="Privacy">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">Hide amounts</p>
          <p className="text-xs text-fg-muted">Blur every amount until you turn this off. Handy in public. The eye button in the header does the same.</p>
        </div>
        <Switch
          checked={settings.hideAmounts}
          label="Hide amounts"
          onChange={(hideAmounts) => {
            updateSettings({ hideAmounts }).catch((err) => toast(errorMessage(err), { tone: 'error' }));
          }}
        />
      </div>

      <form onSubmit={save} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          label="Review money sent to people at or above (₹)"
          hint="Payments to individuals at or above this amount are flagged so you can confirm they are not mis-categorised."
          error={error}
          className="sm:flex-1"
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          Save
        </Button>
      </form>

      <div className="rounded-xl bg-surface-2 p-4 text-sm text-fg-muted">
        <p className="flex items-center gap-2 font-semibold text-fg">
          <Lock className="h-4 w-4 text-primary" aria-hidden />
          How your data is handled
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Statements are read on this device. The files, and any PDF passwords you type, never leave it.</li>
          <li>Your transactions are saved in this browser’s storage. VyayaMitra has no accounts, no servers and no analytics.</li>
          <li>Clearing site data or “clear browsing data” for this site deletes everything, so make backups.</li>
          <li>Nothing syncs between your devices. To move data to another phone, export a backup and restore it there.</li>
        </ul>
      </div>
    </SettingsSection>
  );
}
