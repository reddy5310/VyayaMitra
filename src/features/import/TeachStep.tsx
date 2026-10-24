import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, GraduationCap } from 'lucide-react';
import { INSTITUTIONS } from '@/domain/institutions';
import type { AccountType, ColumnRole, TemplateDraft } from '@/domain/types';
import { inspectImport } from '@/engine/import';
import { draftTemplate, type StatementFile, type StatementInspection } from '@/parsing';
import { Button, Card, Field, Input, Notice, Select, SegmentedControl, Skeleton, cn } from '@/ui';
import { ACCOUNT_TYPE_LABELS } from './accountTypes';
import { describeImportError, type ErrorView } from './describeError';
import {
  AMOUNT_STYLE_LABELS,
  DATE_ORDER_LABELS,
  LAYOUT_LABELS,
  ROLE_OPTIONS,
  columnLabel,
  dateExamples,
  initialForm,
  missingRoles,
  suggestAmountStyle,
  toMapping,
  type AmountStyle,
  type DateOrder,
  type DescriptionLayout,
  type TeachCache,
  type TeachForm,
} from './teachForm';

const PREVIEW_ROWS = 8;

function ErrorNotice({ view }: { view: ErrorView }) {
  return (
    <Notice tone="negative" title={view.title}>
      <p>{view.body}</p>
      {view.hints.length > 0 && (
        <ul className="mt-1 list-disc pl-4">
          {view.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/**
 * "Teach VyayaMitra this format": the user says which column is which, and VyayaMitra tries it.
 * Only column positions and header labels become a template; amounts and descriptions never do.
 */
export function TeachStep({
  file,
  password,
  cache,
  onCache,
  onTry,
  onCancel,
}: {
  file: StatementFile;
  password?: string;
  cache: TeachCache | null;
  onCache: (cache: TeachCache) => void;
  /** Parse with the draft and move on to review. Rejects with the parse error when it does not work. */
  onTry: (draft: TemplateDraft, name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [inspection, setInspection] = useState<StatementInspection | null>(cache?.inspection ?? null);
  const [form, setForm] = useState<TeachForm | null>(cache?.form ?? null);
  const [loadError, setLoadError] = useState<ErrorView | null>(null);
  const [tryError, setTryError] = useState<ErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);

  useEffect(() => {
    if (cache) return;
    let live = true;
    inspectImport(file, password === undefined ? {} : { password })
      .then((ins) => {
        if (!live) return;
        setInspection(ins);
        setForm(initialForm(ins));
      })
      .catch((e: unknown) => live && setLoadError(describeImportError(e)));
    return () => {
      live = false;
    };
    // Inspect once per mount; the file and password do not change while this screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (inspection && form) onCache({ inspection, form });
  }, [inspection, form, onCache]);

  const examples = useMemo(
    () => (inspection && form ? dateExamples(inspection, form.roles, form.dateOrder) : []),
    [inspection, form],
  );

  if (loadError) {
    return (
      <Card className="space-y-4">
        <ErrorNotice view={loadError} />
        <Button variant="outline" onClick={onCancel}>
          Back
        </Button>
      </Card>
    );
  }
  if (!inspection || !form) {
    return (
      <Card className="space-y-3" aria-busy="true">
        <h2 className="text-base font-semibold text-fg">Looking at the statement layout…</h2>
        <Skeleton className="h-24 w-full" />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </Card>
    );
  }

  const insp = inspection;
  const f = form;
  const missing = missingRoles(f.roles);
  const rows = insp.previewRows.slice(0, PREVIEW_ROWS);
  const card = insp.columns[Math.min(cardIndex, insp.columns.length - 1)];

  function setRole(colId: string, role: ColumnRole) {
    setForm((prev) => {
      if (!prev) return prev;
      const roles = { ...prev.roles, [colId]: role };
      return { ...prev, roles, amountStyle: prev.amountStyleTouched ? prev.amountStyle : suggestAmountStyle(roles, prev.amountStyle) };
    });
  }
  const patch = (p: Partial<TeachForm>) => setForm((prev) => (prev ? { ...prev, ...p } : prev));

  async function tryIt() {
    setBusy(true);
    setTryError(null);
    try {
      const draft = draftTemplate(insp, toMapping(f));
      await onTry(draft, f.name.trim() || draft.name);
    } catch (e) {
      setTryError(describeImportError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-primary-soft p-2.5 text-primary">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">Teach VyayaMitra this format</h2>
            <p className="text-sm text-fg-muted">
              Tell it what each column means. Only the column positions and header labels are remembered, never your amounts or descriptions.
            </p>
          </div>
        </div>
      </Card>

      {tryError && <ErrorNotice view={tryError} />}

      {/* Wide screens: the whole table at once, with a role picker above each column. */}
      <Card className="hidden space-y-2 md:block">
        <h3 className="text-sm font-semibold text-fg">What is in each column?</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">Sample rows from the statement</caption>
            <thead className="bg-surface-2">
              <tr>
                {insp.columns.map((c, i) => (
                  <th key={c.id} scope="col" className="min-w-[8.5rem] px-2 py-2 text-left align-top font-medium text-fg-muted">
                    <span className="block truncate pb-1">{columnLabel(c, i)}</span>
                    <Select
                      aria-label={`Role of ${columnLabel(c, i)} (column ${i + 1})`}
                      value={f.roles[c.id] ?? 'ignore'}
                      onChange={(e) => setRole(c.id, e.target.value as ColumnRole)}
                      className="min-h-9 text-sm"
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.role} value={o.role}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {rows.map((r, i) => (
                <tr key={i}>
                  {insp.columns.map((c) => (
                    <td key={c.id} className={cn('max-w-[14rem] truncate px-2 py-1.5', f.roles[c.id] === 'ignore' && 'text-fg-subtle')}>
                      {r.cells[c.id] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-subtle">
          Showing {rows.length} of {insp.previewRows.length} sample rows.
        </p>
      </Card>

      {/* Phones: one column at a time, with its samples and role chips. */}
      <Card className="space-y-3 md:hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">
            Column {Math.min(cardIndex, insp.columns.length - 1) + 1} of {insp.columns.length}
          </h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" aria-label="Previous column" disabled={cardIndex === 0} onClick={() => setCardIndex((i) => Math.max(0, i - 1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label="Next column"
              disabled={cardIndex >= insp.columns.length - 1}
              onClick={() => setCardIndex((i) => Math.min(insp.columns.length - 1, i + 1))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
        {card && (
          <>
            <p className="text-base font-medium text-fg">{columnLabel(card, Math.min(cardIndex, insp.columns.length - 1))}</p>
            <ul className="space-y-1 rounded-xl bg-surface-2 p-3 font-mono text-xs text-fg" aria-label="Sample values">
              {card.samples.slice(0, 5).map((s, i) => (
                <li key={i} className="break-all">
                  {s || '(empty)'}
                </li>
              ))}
              {card.samples.length === 0 && <li className="text-fg-subtle">(no samples)</li>}
            </ul>
            <div role="radiogroup" aria-label="What is this column?" className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((o) => {
                const on = (f.roles[card.id] ?? 'ignore') === o.role;
                return (
                  <button
                    key={o.role}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRole(card.id, o.role)}
                    className={cn(
                      'min-h-touch rounded-full border px-3 text-sm font-medium transition-colors',
                      on ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface text-fg hover:bg-surface-2',
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="All columns">
          {insp.columns.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCardIndex(i)}
                className={cn('rounded-full px-2 py-1', i === cardIndex ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-fg-muted')}
              >
                {columnLabel(c, i)}: {ROLE_OPTIONS.find((o) => o.role === (f.roles[c.id] ?? 'ignore'))?.label}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-fg">How is it written?</h3>
        <div className="space-y-2">
          <p className="text-sm font-medium text-fg">Date order</p>
          <SegmentedControl<DateOrder>
            label="Date order"
            value={f.dateOrder}
            onChange={(v) => patch({ dateOrder: v })}
            options={(Object.keys(DATE_ORDER_LABELS) as DateOrder[]).map((k) => ({ value: k, label: k }))}
          />
          <p className="text-xs text-fg-muted">{DATE_ORDER_LABELS[f.dateOrder]}</p>
          {examples.length > 0 && (
            <ul className="space-y-0.5 text-sm" aria-label="Date examples">
              {examples.map((x) => (
                <li key={x.text} className={x.result ? 'text-fg' : 'text-warning'}>
                  <span className="font-mono">{x.text}</span> → {x.result ?? 'not a valid date this way'}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amounts">
            {({ id }) => (
              <Select id={id} value={f.amountStyle} onChange={(e) => patch({ amountStyle: e.target.value as AmountStyle, amountStyleTouched: true })}>
                {(Object.keys(AMOUNT_STYLE_LABELS) as AmountStyle[]).map((k) => (
                  <option key={k} value={k}>
                    {AMOUNT_STYLE_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Description">
            {({ id }) => (
              <Select id={id} value={f.descriptionLayout} onChange={(e) => patch({ descriptionLayout: e.target.value as DescriptionLayout })}>
                {(Object.keys(LAYOUT_LABELS) as DescriptionLayout[]).map((k) => (
                  <option key={k} value={k}>
                    {LAYOUT_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Name this format</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Format name">{({ id }) => <Input id={id} value={f.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} />}</Field>
          <Field label="Bank">
            {({ id }) => (
              <Select id={id} value={f.institution} onChange={(e) => patch({ institution: e.target.value })}>
                {!INSTITUTIONS.some((i) => i.id === f.institution) && <option value={f.institution}>{f.institution}</option>}
                {INSTITUTIONS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Account type">
            {({ id }) => (
              <Select id={id} value={f.accountType} onChange={(e) => patch({ accountType: e.target.value as AccountType })}>
                {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {missing.length > 0 && <Notice tone="warning">Still needed: {missing.join(', ')}.</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void tryIt()} loading={busy} disabled={missing.length > 0}>
          Try it
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
