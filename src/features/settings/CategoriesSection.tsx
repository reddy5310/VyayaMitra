import { useState, type FormEvent } from 'react';
import { BUILTIN_CATEGORIES, CATEGORY_GROUP_LABELS } from '@/domain/categories';
import type { CategoryGroup } from '@/domain/types';
import { createCustomCategory } from '@/db/actions';
import { useCustomCategories } from '@/db/hooks';
import { Button, CategoryIcon, Field, Input, ListGroup, ListRow, Notice, Select, useToast } from '@/ui';
import { SettingsSection } from './shared';
import { errorMessage } from './utils';

export function CategoriesSection() {
  const custom = useCustomCategories();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CategoryGroup>('lifestyle');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the category a name.');
    setSaving(true);
    setError(null);
    try {
      await createCustomCategory(trimmed, group);
      setName('');
      toast(`Added “${trimmed}”.`, { tone: 'success' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Categories"
      subtitle={`${BUILTIN_CATEGORIES.length} built-in categories are always available. Add your own for anything they miss.`}
    >
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="New category name">
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Pet care" autoComplete="off" />}
        </Field>
        <Field label="Group">
          {({ id }) => (
            <Select id={id} value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
              {(Object.keys(CATEGORY_GROUP_LABELS) as CategoryGroup[]).map((g) => (
                <option key={g} value={g}>
                  {CATEGORY_GROUP_LABELS[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" loading={saving}>
          Add category
        </Button>
      </form>
      {error && <Notice tone="negative">{error}</Notice>}
      {custom && custom.length > 0 && (
        <ListGroup>
          {custom.map((c) => (
            <ListRow key={c.id} leading={<CategoryIcon category={c.id} custom={custom} />} title={c.name} subtitle={CATEGORY_GROUP_LABELS[c.group]} />
          ))}
        </ListGroup>
      )}
    </SettingsSection>
  );
}
