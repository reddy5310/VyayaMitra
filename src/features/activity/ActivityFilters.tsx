import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import { CATEGORY_GROUP_LABELS, allCategories, categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { Account, CategoryGroup, CustomCategory } from '@/domain/types';
import { Badge, Button, Input, Select, cn } from '@/ui';
import { activeFilterCount, type ActivityFilters as Filters } from './useActivityFilters';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Keeps a text box responsive while the URL value is only updated after a pause.
 * The input is local state, so list reloads or data updates never reset it.
 */
function useDebouncedField(urlValue: string, commit: (v: string) => void) {
  const [text, setText] = useState(urlValue);
  const committed = useRef(urlValue);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // External change (chip removed, deep link): adopt it, but ignore echoes of our own commits.
  useEffect(() => {
    if (urlValue !== committed.current) {
      committed.current = urlValue;
      setText(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    if (text === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = text;
      commitRef.current(text);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return [text, setText] as const;
}

export function ActivityFilters({
  filters,
  accounts,
  customCategories,
  onChange,
  onClearAll,
  searchRef,
}: {
  filters: Filters;
  accounts: readonly Account[];
  customCategories: readonly CustomCategory[];
  onChange: (patch: Partial<Filters>) => void;
  onClearAll: () => void;
  /** Lets the page focus the search box (the `/` shortcut). */
  searchRef?: RefObject<HTMLInputElement>;
}) {
  const [search, setSearch] = useDebouncedField(filters.q, (q) => onChange({ q }));
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters);

  const categoryGroups = useMemo(() => {
    const groups = new Map<CategoryGroup, { id: string; name: string }[]>();
    for (const c of allCategories(customCategories)) {
      const list = groups.get(c.group) ?? [];
      list.push({ id: c.id, name: c.name });
      groups.set(c.group, list);
    }
    return [...groups.entries()];
  }, [customCategories]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.q.trim()) chips.push({ key: 'q', label: `Search: “${filters.q.trim()}”`, remove: () => { setSearch(''); onChange({ q: '' }); } });
  if (filters.accountId) chips.push({ key: 'account', label: `Account: ${accountName(filters.accountId)}`, remove: () => onChange({ accountId: '' }) });
  if (filters.category) chips.push({ key: 'category', label: `Category: ${categoryName(filters.category, customCategories)}`, remove: () => onChange({ category: '' }) });
  if (filters.kind) chips.push({ key: 'kind', label: `Type: ${KIND_LABELS[filters.kind]}`, remove: () => onChange({ kind: '' }) });
  if (filters.review) chips.push({ key: 'review', label: 'Needs review', remove: () => onChange({ review: false }) });

  return (
    <section aria-label="Filters" className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
          <Input
            ref={searchRef}
            aria-keyshortcuts="/"
            type="search"
            inputMode="search"
            aria-label="Search transactions"
            placeholder="Search merchant, note, amount…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        <Button
          variant="outline"
          className="sm:hidden"
          aria-expanded={open}
          aria-controls="activity-filter-panel"
          onClick={() => setOpen((v) => !v)}
          icon={<ListFilter className="h-4 w-4" aria-hidden />}
        >
          Filters
          {count > 0 && <Badge tone="primary">{count}</Badge>}
        </Button>
      </div>

      <div id="activity-filter-panel" className={cn('grid-cols-1 gap-2 sm:grid sm:grid-cols-4', open ? 'grid' : 'hidden')}>
        <Select aria-label="Account" value={filters.accountId} onChange={(e) => onChange({ accountId: e.target.value })}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={filters.category} onChange={(e) => onChange({ category: e.target.value })}>
          <option value="">All categories</option>
          {categoryGroups.map(([group, list]) => (
            <optgroup key={group} label={CATEGORY_GROUP_LABELS[group]}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select aria-label="Type" value={filters.kind} onChange={(e) => onChange({ kind: e.target.value as Filters['kind'] })}>
          <option value="">All types</option>
          {(Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Button
          variant={filters.review ? 'primary' : 'outline'}
          aria-pressed={filters.review}
          onClick={() => onChange({ review: !filters.review })}
        >
          Needs review
        </Button>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={c.remove}
                aria-label={`Remove filter ${c.label}`}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-primary-soft px-3 text-sm font-medium text-primary hover:opacity-90"
              >
                <span className="truncate">{c.label}</span>
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onClearAll} className="min-h-9 rounded-lg px-2 text-sm font-medium text-fg-muted hover:text-fg">
              Clear all
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
