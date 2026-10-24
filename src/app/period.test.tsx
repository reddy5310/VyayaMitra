import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';
import { addMonths, formatMonth, monthEnd, monthKey, monthStart } from '@/lib/dates';

const txns = vi.hoisted(() => ({ value: undefined as Transaction[] | undefined }));

vi.mock('@/db/hooks', () => ({ useTransactions: () => txns.value, useStatements: () => [] }));

// Small deterministic stand-in for the analytics engine (only the pieces the provider calls).
vi.mock('@/engine/analytics', () => {
  const month = (m: string, preset: string) => ({ preset, start: `${m}-01`, end: `${m}-28`, label: m });
  const sorted = (t: { date: string }[]) => t.map((x) => x.date).sort();
  return {
    dataRange: (t: { date: string }[]) => (t.length ? { min: sorted(t)[0], max: sorted(t).at(-1) } : null),
    defaultPeriod: (t: { date: string }[]) => month(sorted(t).at(-1)!.slice(0, 7), 'this_month'),
    resolvePeriod: (preset: string, o: { today: string; custom?: { start: string; end: string } }) => {
      if (preset === 'custom') return { preset, start: o.custom!.start, end: o.custom!.end, label: `${o.custom!.start} – ${o.custom!.end}` };
      if (preset === 'last_3_months') return { preset, start: '2025-07-01', end: '2025-09-30', label: 'Jul – Sep 2025' };
      if (preset === 'all') return { preset, start: '2025-01-01', end: '2025-09-30', label: 'All time' };
      return month(o.today.slice(0, 7), preset);
    },
  };
});

import { PERIOD_STORAGE_KEY, PeriodPicker, PeriodProvider, usePeriod } from './period';

const tx = (date: string) => ({ date }) as Transaction;

function Probe() {
  const s = usePeriod();
  return (
    <div>
      <p data-testid="period">{`${s.period.preset}|${s.period.start}|${s.period.end}|${s.period.label}`}</p>
      <p data-testid="flags">{`${s.isSingleMonth}|${s.canStepPrev}|${s.canStepNext}`}</p>
      <button onClick={() => s.stepMonth(-1)}>prev</button>
      <button onClick={() => s.stepMonth(1)}>next</button>
      <button onClick={() => s.setPreset('last_3_months')}>preset3</button>
      <button onClick={() => s.setCustom('2025-02-10', '2025-03-05')}>custom</button>
    </div>
  );
}

const wrap = (ui = <Probe />) => render(<PeriodProvider>{ui}</PeriodProvider>);
const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  localStorage.clear();
  txns.value = [tx('2025-03-02'), tx('2025-08-18'), tx('2025-09-14')];
});

describe('PeriodProvider', () => {
  it('defaults to the latest-transaction month', () => {
    wrap();
    expect(text('period')).toBe('this_month|2025-09-01|2025-09-28|2025-09');
  });

  it('steps back and forward one month and persists each step', async () => {
    wrap();
    await userEvent.click(screen.getByText('prev'));
    expect(text('period')).toBe(`custom|2025-08-01|2025-08-31|${formatMonth('2025-08')}`);
    expect(JSON.parse(localStorage.getItem(PERIOD_STORAGE_KEY)!)).toEqual({ preset: 'custom', start: '2025-08-01', end: '2025-08-31' });
    await userEvent.click(screen.getByText('next'));
    expect(text('period')).toContain('2025-09-01|2025-09-30');
  });

  it('bounds stepping by the first month with data', () => {
    txns.value = [tx('2025-08-18'), tx('2025-09-14')];
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ preset: 'custom', start: '2025-08-01', end: '2025-08-31' }));
    wrap();
    expect(text('flags')).toBe('true|false|true');
  });

  it('allows stepping forward up to the current calendar month even without newer data', async () => {
    const today = new Date();
    const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = addMonths(cur, -1);
    txns.value = [tx(`${addMonths(cur, -6)}-10`), tx(`${prevMonth}-10`)];
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ preset: 'custom', start: monthStart(prevMonth), end: monthEnd(prevMonth) }));
    wrap();
    expect(text('flags')).toBe('true|true|true');
    await userEvent.click(screen.getByText('next'));
    expect(monthKey(text('period')!.split('|')[1])).toBe(cur);
    expect(text('flags')).toBe('true|true|false');
  });

  it('does not step multi-month presets', async () => {
    wrap();
    await userEvent.click(screen.getByText('preset3'));
    expect(text('flags')).toBe('false|false|false');
    const before = text('period');
    await userEvent.click(screen.getByText('prev'));
    await userEvent.click(screen.getByText('next'));
    expect(text('period')).toBe(before);
    expect(JSON.parse(localStorage.getItem(PERIOD_STORAGE_KEY)!)).toEqual({ preset: 'last_3_months' });
  });

  it('restores a stored custom range and a stored preset on mount', () => {
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ preset: 'custom', start: '2025-02-10', end: '2025-03-05' }));
    const { unmount } = wrap();
    expect(text('period')).toBe('custom|2025-02-10|2025-03-05|2025-02-10 – 2025-03-05');
    unmount();
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ preset: 'all' }));
    wrap();
    expect(text('period')).toContain('all|2025-01-01');
  });

  it('ignores corrupt stored values and falls back to the default month', () => {
    localStorage.setItem(PERIOD_STORAGE_KEY, '{nope');
    const { unmount } = wrap();
    expect(text('period')).toContain('2025-09-01');
    unmount();
    localStorage.setItem(PERIOD_STORAGE_KEY, JSON.stringify({ preset: 'custom', start: '2025-13-40', end: '2025-01-01' }));
    wrap();
    expect(text('period')).toContain('2025-09-01');
  });

  it('keeps the same Period object when the transactions change but the range does not', () => {
    const seen: unknown[] = [];
    function Spy() {
      seen.push(usePeriod().period);
      return null;
    }
    const { rerender } = render(
      <PeriodProvider>
        <Spy />
      </PeriodProvider>,
    );
    txns.value = [...txns.value!];
    rerender(
      <PeriodProvider>
        <Spy />
      </PeriodProvider>,
    );
    expect(new Set(seen).size).toBe(1);
  });
});

describe('PeriodPicker', () => {
  it('shows the label, steps months with the arrows and offers presets', async () => {
    wrap(<PeriodPicker />);
    expect(screen.getByRole('button', { name: /2025-09/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('button', { name: /August 2025/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /August 2025/ }));
    expect(screen.getByRole('menu', { name: 'Choose period' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Last 3 months' }));
    expect(screen.getByRole('button', { name: /Jul – Sep 2025/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument();
  });

  it('applies a custom range from the dialog and rejects an inverted one', async () => {
    wrap(<PeriodPicker />);
    await userEvent.click(screen.getByRole('button', { name: /2025-09/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Custom range…' }));
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    await userEvent.clear(from);
    await userEvent.type(from, '2025-05-20');
    await userEvent.clear(to);
    await userEvent.type(to, '2025-05-10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/start date must be on or before/i)).toBeInTheDocument();
    await userEvent.clear(to);
    await userEvent.type(to, '2025-06-10');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: /2025-05-20 – 2025-06-10/ })).toBeInTheDocument();
  });
});
