import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/ui';

/** A titled card; every Settings section uses it so spacing and headings stay uniform. */
export function SettingsSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <div className="space-y-4">{children}</div>
    </Card>
  );
}
