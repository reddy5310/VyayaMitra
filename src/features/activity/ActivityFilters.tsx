import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import { CATEGORY_GROUP_LABELS, allCategories, categoryName } from '@/domain/categories';
import { KIND_LABELS } from '@/domain/kinds';
import type { Account, CategoryGroup, CustomCategory, Statement } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { Badge, Button, Input, Select, cn } from '@/ui';
import { KIND_GROUP_LABELS, activeFilterCount, amountToPaise, type ActivityFilters as Filters, type KindGroup } from './useActivityFilters';

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
  merchants,
  statements,
  onChange,
  onClearAll,
  searchRef,
}: {
  filters: Filters;
  accounts: readonly Account[];
  customCategories: readonly CustomCategory[];
  /** Every merchant in the ledger, for the searchable merchant filter. */
  merchants: readonly { key: string; name: string }[];
  statements: readonly Statement[];
  onChange: (patch: Partial<Filters>) => void;
  onClearAll: () => void;
  /** Lets the page focus the search box (the `/` shortcut). */
  searchRef?: RefObject<HTMLInputElement>;
}) {
  const [search, setSearch] = useDebouncedField(filters.q, (q) => onChange({ q }));
  const [minText, setMinText] = useDebouncedField(filters.min, (min) => onChange({ min }));
  const [maxText, setMaxText] = useDebouncedField(filters.max, (max) => onChange({ max }));
  const advancedActive = Boolean(filters.kindGroup || filters.min || filters.max || filters.merchant || filters.statementId || filters.recurring);
  const [more, setMore] = useState(false);
  const moreOpen = more || advancedActive;
  const merchantName = merchants.find((m) => m.key === filters.merchant)?.name ?? '';
  const [merchantText, setMerchantText] = useState(merchantName);
  useEffect(() => setMerchantText(merchantName), [merchantName]);
  const statementName = (id: string) => {
    const st = statements.find((x) => x.id === id);
    return st ? st.fileName : id;
  };
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
  if (filters.kindGroup) chips.push({ key: 'group', label: `Money: ${KIND_GROUP_LABELS[filters.kindGroup]}`, remove: () => onChange({ kindGroup: '' }) });
  if (filters.min.trim()) chips.push({ key: 'min', label: `At least ₹${filters.min.trim()}`, remove: () => { setMinText(''); onChange({ min: '' }); } });
  if (filters.max.trim()) chips.push({ key: 'max', label: `At most ₹${filters.max.trim()}`, remove: () => { setMaxText(''); onChange({ max: '' }); } });
  if (filters.merchant) chips.push({ key: 'merchant', label: `Merchant: ${merchantName || filters.merchant}`, remove: () => onChange({ merchant: '' }) });
  if (filters.statementId) chips.push({ key: 'statement', label: `Import: ${statementName(filters.statementId)}`, remove: () => onChange({ statementId: '' }) });
  if (filters.recurring) chips.push({ key: 'recurring', label: 'Recurring', remove: () => onChange({ recurring: false }) });

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

      <div>
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="activity-more-filters"
          onClick={() => setMore((v) => !v)}
          className="min-h-9 rounded-lg px-2 text-sm font-medium text-primary hover:bg-surface-2"
        >
          {moreOpen ? 'Fewer filters' : 'More filters'}
        </button>
        <div id="activity-more-filters" hidden={!moreOpen} className="mt-2 grid gap-2 sm:grid-cols-3">
          <Select aria-label="Money group" value={filters.kindGroup} onChange={(e) => onChange({ kindGroup: e.target.value as KindGroup | '' })}>
            <option value="">Spending, income, transfers…</option>
            {(Object.keys(KIND_GROUP_LABELS) as KindGroup[]).map((g) => (
              <option key={g} value={g}>
                {KIND_GROUP_LABELS[g]}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Minimum amount in rupees"
              inputMode="decimal"
              placeholder="Min ₹"
              autoComplete="off"
              aria-invalid={minText.trim() !== '' && amountToPaise(minText) === null}
              value={minText}
              onChange={(e) => setMinText(e.target.value)}
            />
            <Input
              aria-label="Maximum amount in rupees"
              inputMode="decimal"
              placeholder="Max ₹"
              autoComplete="off"
              aria-invalid={maxText.trim() !== '' && amountToPaise(maxText) === null}
              value={maxText}
              onChange={(e) => setMaxText(e.target.value)}
            />
          </div>
          <div>
            <Input
              aria-label="Merchant"
              list="activity-merchants"
              placeholder="Search merchants"
              autoComplete="off"
              value={merchantText}
              onChange={(e) => {
                const text = e.target.value;
                setMerchantText(text);
                const hit = merchants.find((m) => m.name.toLowerCase() === text.trim().toLowerCase());
                if (hit) onChange({ merchant: hit.key });
                else if (!text.trim() && filters.merchant) onChange({ merchant: '' });
              }}
            />
            <datalist id="activity-merchants">
              {merchants.slice(0, 400).map((m) => (
                <option key={m.key} value={m.name} />
              ))}
            </datalist>
          </div>
          <Select aria-label="Statement or import" value={filters.statementId} onChange={(e) => onChange({ statementId: e.target.value })}>
            <option value="">All imports</option>
            {[...statements]
              .sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
              .map((st) => (
                <option key={st.id} value={st.id}>
                  {st.fileName}
                  {st.periodEnd ? ` (to ${formatDate(st.periodEnd)})` : ''}
                </option>
              ))}
          </Select>
          <Button variant={filters.recurring ? 'primary' : 'outline'} aria-pressed={filters.recurring} onClick={() => onChange({ recurring: !filters.recurring })}>
            Recurring
          </Button>
        </div>
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
