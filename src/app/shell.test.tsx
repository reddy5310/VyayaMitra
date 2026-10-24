import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';

const state = vi.hoisted(() => ({ hideAmounts: false, updateSettings: vi.fn(async () => {}) }));

vi.mock('@/db/hooks', () => ({
  useTransactions: () => [{ date: '2025-09-14' }] as Transaction[],
  useStatements: () => [],
  useSettings: () => ({ theme: 'system', hideAmounts: state.hideAmounts, p2pReviewThreshold: 500000, onboardingDone: true }),
}));
vi.mock('@/db/actions', () => ({ updateSettings: state.updateSettings }));
vi.mock('@/engine/analytics', () => ({
  dataRange: () => ({ min: '2025-03-02', max: '2025-09-14' }),
  defaultPeriod: () => ({ preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' }),
  resolvePeriod: () => ({ preset: 'this_month', start: '2025-09-01', end: '2025-09-30', label: 'September 2025' }),
}));

// The real screens belong to other modules; the shell is tested against stand-ins.
vi.mock('@/features/overview/OverviewPage', async () => {
  const React = await import('react');
  return { default: () => React.createElement('p', null, 'overview body') };
});
vi.mock('@/features/activity/ActivityPage', async () => {
  const React = await import('react');
  const { usePageChrome } = await import('./chrome');
  return {
    default: function Activity() {
      usePageChrome({
        title: 'Spending log',
        showPeriod: true,
        actions: React.createElement('button', { type: 'button' }, 'Export'),
      });
      return React.createElement('p', null, 'activity body');
    },
  };
});
vi.mock('@/features/import/ImportPage', async () => {
  const React = await import('react');
  return { default: () => React.createElement('p', null, 'import body') };
});
vi.mock('@/features/plan/PlanPage', async () => {
  const React = await import('react');
  return {
    default: function Plan(): never {
      void React;
      throw new Error('boom from plan');
    },
  };
});
vi.mock('@/features/settings/SettingsPage', async () => {
  const React = await import('react');
  return { default: () => React.createElement('p', null, 'settings body') };
});
vi.mock('@/features/reports/ReportPage', async () => {
  const React = await import('react');
  return { default: () => React.createElement('p', null, 'report body') };
});

import App from './App';

const primaryNavs = () => screen.getAllByRole('navigation', { name: 'Primary' });
const bottomNav = () => primaryNavs()[primaryNavs().length - 1];

beforeEach(() => {
  window.location.hash = '#/';
  state.hideAmounts = false;
  state.updateSettings.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('app shell', () => {
  it('renders the overview with a heading and both navigations (sidebar + bottom tabs)', async () => {
    render(<App />);
    expect(await screen.findByText('overview body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(primaryNavs()).toHaveLength(2);
    for (const nav of primaryNavs()) {
      for (const name of ['Overview', 'Activity', 'Import', 'Plan', 'Settings']) {
        expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
      }
    }
  });

  it('marks the active item with aria-current and follows navigation', async () => {
    render(<App />);
    await screen.findByText('overview body');
    expect(within(bottomNav()).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottomNav()).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(bottomNav()).getByRole('link', { name: 'Import' }));
    expect(await screen.findByText('import body')).toBeInTheDocument();
    expect(within(bottomNav()).getByRole('link', { name: 'Import' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottomNav()).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: 'Import statements' })).toBeInTheDocument();
  });

  it('lets a page set its title, actions and period picker through usePageChrome', async () => {
    window.location.hash = '#/activity';
    render(<App />);
    expect(await screen.findByText('activity body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Spending log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Reporting period' })).toBeInTheDocument();
    expect(document.title).toBe('Spending log · VyayaMitra');

    // leaving the page clears its chrome
    await userEvent.click(within(bottomNav()).getByRole('link', { name: 'Overview' }));
    expect(await screen.findByText('overview body')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Reporting period' })).not.toBeInTheDocument();
  });

  it('skip link moves focus to the main content without changing the route', async () => {
    render(<App />);
    await screen.findByText('overview body');
    await userEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.location.hash).toBe('#/');
  });

  it('toggles hide-amounts through updateSettings', async () => {
    render(<App />);
    await screen.findByText('overview body');
    await userEvent.click(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(state.updateSettings).toHaveBeenCalledWith({ hideAmounts: true });
  });

  it('offers to show amounts again when they are hidden', async () => {
    state.hideAmounts = true;
    render(<App />);
    await screen.findByText('overview body');
    const btn = screen.getByRole('button', { name: 'Show amounts' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(btn);
    expect(state.updateSettings).toHaveBeenCalledWith({ hideAmounts: false });
  });

  it('contains a crashing screen, keeps the navigation, and recovers when you leave', async () => {
    render(<App />);
    await screen.findByText('overview body');
    await userEvent.click(within(bottomNav()).getByRole('link', { name: 'Plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on this screen.');
    expect(screen.getByText(/Your data is safe on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(primaryNavs()).toHaveLength(2);

    await userEvent.click(within(bottomNav()).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText('settings body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends unknown routes to the overview', async () => {
    window.location.hash = '#/nowhere';
    render(<App />);
    expect(await screen.findByText('overview body')).toBeInTheDocument();
  });
});
