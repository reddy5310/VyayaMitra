import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { UserRule } from '@/domain/types';
import { deleteRule, updateRule } from '@/db/actions';
import { useCustomCategories, useRules } from '@/db/hooks';
import { ConfirmDialog, EmptyState, IconButton, ListGroup, ListRow, Skeleton, Switch, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { errorMessage } from './utils';

const FIELD_LABELS: Record<UserRule['match']['field'], string> = {
  merchantKey: 'merchant',
  vpa: 'UPI ID',
  description: 'description',
};

function describeMatch(r: UserRule): string {
  return `When the ${FIELD_LABELS[r.match.field]} ${r.match.op === 'equals' ? 'is' : 'contains'} “${r.match.value}”`;
}

export function RulesSection() {
  const rules = useRules();
  const custom = useCustomCategories();
  const { toast } = useToast();
  const [pending, setPending] = useState<UserRule | null>(null);

  const describeSet = (r: UserRule): string => {
    const parts: string[] = [];
    if (r.set.category) parts.push(`category ${categoryName(r.set.category, custom ?? [])}`);
    if (r.set.kind) parts.push(`type ${KIND_LABELS[r.set.kind]}`);
    if (r.set.merchant) parts.push(`name “${r.set.merchant}”`);
    const scope = [r.direction === 'debit' ? 'money out only' : r.direction === 'credit' ? 'money in only' : null].filter(Boolean);
    return `Set ${parts.join(', ') || 'nothing'}${scope.length ? ` (${scope.join(', ')})` : ''}`;
  };

  return (
    <SettingsSection
      title="Remembered rules"
      subtitle="Created when you choose “remember for this merchant”. Switch one off to pause it, or delete it to undo its effect."
    >
      {rules === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : rules.length === 0 ? (
        <EmptyState title="No rules yet" body="When you fix a category and ask VyayaMitra to remember it, the rule shows up here." />
      ) : (
        <ListGroup>
          {rules.map((r) => (
            <ListRow
              key={r.id}
              title={describeMatch(r)}
              subtitle={describeSet(r)}
              className={r.enabled ? undefined : 'opacity-60'}
              trailing={
                <span className="flex items-center">
                  <Switch
                    checked={r.enabled}
                    label={`${r.enabled ? 'Pause' : 'Enable'} rule: ${describeMatch(r)}`}
                    onChange={(enabled) => {
                      updateRule(r.id, { enabled }).catch((e) => toast(errorMessage(e), { tone: 'error' }));
                    }}
                  />
                  <IconButton label={`Delete rule: ${describeMatch(r)}`} onClick={() => setPending(r)}>
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </IconButton>
                </span>
              }
            />
          ))}
        </ListGroup>
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        tone="danger"
        title="Delete this rule?"
        confirmLabel="Delete rule"
        onConfirm={async () => {
          if (!pending) return;
          await deleteRule(pending.id);
          toast('Rule deleted. Affected transactions were re-checked.', { tone: 'success' });
        }}
      >
        <p>
          Transactions this rule changed go back to VyayaMitra’s automatic category and type. Anything you edited on a single transaction by hand
          stays as you set it.
        </p>
      </ConfirmDialog>
    </SettingsSection>
  );
}
