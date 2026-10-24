/**
 * CONTRACT — owned by the app-shell module.
 * One shared reporting period for Overview, Activity, Plan and Reports, so every screen
 * describes the same dates. Persisted per device (localStorage 'vm-period').
 *
 * Until the user chooses, the period is the calendar month of the latest transaction (so an old
 * statement never opens on an empty month). The choice is stored as a preset name (relative presets
 * such as "last 3 months" keep moving with today) or, for custom ranges / stepped months, explicit dates.
 */
/* eslint-disable react-refresh/only-export-components -- contract file: hooks and components live together */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { IsoDate } from '@/domain/types';
import { dataRange, defaultPeriod, resolvePeriod, type Period, type PeriodPreset } from '@/engine/analytics';
import { useStatements, useTransactions } from '@/db/hooks';
import { addMonths, formatMonth, isIsoDate, monthEnd, monthKey, monthStart, todayIso } from '@/lib/dates';
import { Button, Field, IconButton, Input, Menu, Notice, Sheet, cn } from '@/ui';

export const PERIOD_STORAGE_KEY = 'vm-period';

type PresetChoice = Exclude<PeriodPreset, 'custom'>;

export interface PeriodState {
  period: Period;
  setPreset: (preset: PresetChoice) => void;
  setCustom: (start: IsoDate, end: IsoDate) => void;
  /** Step a single-month period backward (-1) or forward (+1). No-op for multi-month presets. */
  stepMonth: (delta: -1 | 1) => void;
  /** True when the period is one calendar month (stepping is meaningful). */
  isSingleMonth: boolean;
  /** Whether there is a month to step to; the picker disables its arrows otherwise. */
  canStepPrev: boolean;
  canStepNext: boolean;
}

type Choice = { preset: PresetChoice } | { preset: 'custom'; start: IsoDate; end: IsoDate };

const PRESETS: PresetChoice[] = ['this_month', 'last_month', 'last_3_months', 'last_6_months', 'last_12_months', 'this_year', 'all'];

const PRESET_LABELS: Record<PresetChoice, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  last_6_months: 'Last 6 months',
  last_12_months: 'Last 12 months',
  this_year: 'This year',
  all: 'All time',
};

export function readStoredChoice(): Choice | null {
  try {
    const raw = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { preset?: string; start?: string; end?: string };
    if (v.preset === 'custom') {
      if (v.start && v.end && isIsoDate(v.start) && isIsoDate(v.end) && v.start <= v.end) {
        return { preset: 'custom', start: v.start, end: v.end };
      }
      return null;
    }
    return PRESETS.includes(v.preset as PresetChoice) ? { preset: v.preset as PresetChoice } : null;
  } catch {
    return null;
  }
}

function storeChoice(choice: Choice): void {
  try {
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the choice applies for this session only */
  }
}

function isSingleMonthRange(start: IsoDate, end: IsoDate): boolean {
  const m = monthKey(start);
  return monthKey(end) === m && start === monthStart(m);
}

/** A custom range that is exactly one calendar month reads better as "September 2025". */
function tidyLabel(p: Period): Period {
  const m = monthKey(p.start);
  if (p.preset === 'custom' && isSingleMonthRange(p.start, p.end) && p.end === monthEnd(m)) {
    return { ...p, label: formatMonth(m) };
  }
  return p;
}

const PeriodContext = createContext<PeriodState | null>(null);

export function usePeriod(): PeriodState {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used inside <PeriodProvider>');
  return ctx;
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const txns = useTransactions();
  const statements = useStatements();
  // The default month follows the latest statement period; this key changes only when that does.
  const statementsKey = statements ? statements.map((st) => `${st.id}:${st.periodEnd ?? ''}`).sort().join('|') : '';
  const [choice, setChoice] = useState<Choice | null>(readStoredChoice);
  const [today, setToday] = useState<IsoDate>(() => todayIso());

  // A phone left open overnight should roll over to the new day.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday((t) => (t === todayIso() ? t : todayIso()));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const range = useMemo(() => (txns ? dataRange(txns) : null), [txns]);
  const rangeMin = range?.min;
  const rangeMax = range?.max;

  const computed = useMemo<Period>(() => {
    const dr = rangeMin && rangeMax ? { min: rangeMin, max: rangeMax } : undefined;
    if (choice) {
      return tidyLabel(
        resolvePeriod(choice.preset, {
          today,
          custom: choice.preset === 'custom' ? { start: choice.start, end: choice.end } : undefined,
          dataRange: dr,
        }),
      );
    }
    if (txns && dr) return tidyLabel(defaultPeriod(txns, today, statements ?? []));
    return tidyLabel(resolvePeriod('this_month', { today, dataRange: dr }));
    // `txns` only matters for its latest date, which rangeMax mirrors; this avoids a new Period on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, today, rangeMin, rangeMax, statementsKey]);

  // Keep a referentially stable Period while its content is unchanged (screens use it in effect deps).
  const stable = useRef(computed);
  if (
    stable.current.preset !== computed.preset ||
    stable.current.start !== computed.start ||
    stable.current.end !== computed.end ||
    stable.current.label !== computed.label
  ) {
    stable.current = computed;
  }
  const period = stable.current;

  const commit = useCallback((c: Choice) => {
    setChoice(c);
    storeChoice(c);
  }, []);

  const setPreset = useCallback((preset: PresetChoice) => commit({ preset }), [commit]);
  const setCustom = useCallback(
    (start: IsoDate, end: IsoDate) => {
      if (!isIsoDate(start) || !isIsoDate(end)) return;
      const [s, e] = start <= end ? [start, end] : [end, start];
      commit({ preset: 'custom', start: s, end: e });
    },
    [commit],
  );

  const isSingleMonth = isSingleMonthRange(period.start, period.end);
  const thisMonth = monthKey(today);
  const lastMonth = rangeMax && monthKey(rangeMax) > thisMonth ? monthKey(rangeMax) : thisMonth;
  const current = monthKey(period.start);
  const canStepPrev = isSingleMonth && rangeMin !== undefined && current > monthKey(rangeMin);
  const canStepNext = isSingleMonth && current < lastMonth;

  const stepMonth = useCallback(
    (delta: -1 | 1) => {
      if (!isSingleMonthRange(period.start, period.end)) return;
      const m = addMonths(monthKey(period.start), delta);
      commit({ preset: 'custom', start: monthStart(m), end: monthEnd(m) });
    },
    [period.start, period.end, commit],
  );

  const value = useMemo<PeriodState>(
    () => ({ period, setPreset, setCustom, stepMonth, isSingleMonth, canStepPrev, canStepNext }),
    [period, setPreset, setCustom, stepMonth, isSingleMonth, canStepPrev, canStepNext],
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

/** Compact control showing the period label with prev/next month arrows and a preset menu. */
export function PeriodPicker({ className }: { className?: string }) {
  const { period, setPreset, setCustom, stepMonth, isSingleMonth, canStepPrev, canStepNext } = usePeriod();
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState<string>(period.start);
  const [to, setTo] = useState<string>(period.end);
  const [error, setError] = useState<string | null>(null);

  const openCustom = () => {
    setFrom(period.start);
    setTo(period.end);
    setError(null);
    setCustomOpen(true);
  };
  const applyCustom = () => {
    if (!isIsoDate(from) || !isIsoDate(to)) return setError('Pick both dates.');
    if (from > to) return setError('The start date must be on or before the end date.');
    setCustom(from, to);
    setCustomOpen(false);
  };

  const arrow = 'min-h-10 min-w-10 coarse:min-h-touch coarse:min-w-touch';
  return (
    <div
      className={cn('inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface p-0.5 shadow-card', className)}
      role="group"
      aria-label="Reporting period"
    >
      {isSingleMonth && (
        <IconButton label="Previous month" onClick={() => stepMonth(-1)} disabled={!canStepPrev} className={arrow}>
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </IconButton>
      )}
      <Menu
        label="Choose period"
        align="start"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold text-fg transition-colors hover:bg-surface-2 coarse:min-h-touch"
          >
            <Calendar className="h-4 w-4 text-fg-muted" aria-hidden />
            <span className="whitespace-nowrap">{period.label}</span>
          </button>
        )}
        items={[
          ...PRESETS.map((preset) => ({
            label: PRESET_LABELS[preset],
            checked: period.preset === preset,
            onSelect: () => setPreset(preset),
          })),
          'separator' as const,
          { label: 'Custom range…', checked: period.preset === 'custom' && !isSingleMonth ? true : undefined, onSelect: openCustom },
        ]}
      />
      {isSingleMonth && (
        <IconButton label="Next month" onClick={() => stepMonth(1)} disabled={!canStepNext} className={arrow}>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </IconButton>
      )}

      <Sheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Custom date range"
        description="Both dates are included."
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyCustom}>Apply</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="From">
            {({ id }) => <Input id={id} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="To">
            {({ id }) => <Input id={id} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}
          </Field>
          {error && <Notice tone="negative">{error}</Notice>}
        </div>
      </Sheet>
    </div>
  );
}
