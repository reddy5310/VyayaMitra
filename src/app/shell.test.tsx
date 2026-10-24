import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@/domain/types';

const state = vi.hoisted(() => ({ hideAmounts: false, updateSettings: vi.fn(async () => {}) }));

vi.mock('@/db/hooks', () => ({
  useTransactions: () => [{ date: '2025-09-14' }] as Transaction[],
  useAccounts: () => [
    { id: 'a1', name: 'Test Savings' },
    { id: 'a2', name: 'Test Card' },
  ],
  useStatements: () => [],
  useSettings: () => ({ theme: 'system', hideAmounts: state.hideAmounts, p2pReviewThreshold: 500000, onboardingDone: true }),
}));
vi.mock('@/db/sampleBanner', () => ({ SampleBanner: () => null }));
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
for (const mod of ['explore/ExplorePage', 'accounts/AccountsPage', 'accounts/AccountDetailPage', 'learning/LearningPage']) {
  vi.doMock(`@/features/${mod}`, async () => {
    const React = await import('react');
    return { default: () => React.createElement('p', null, `${mod} body`) };
  });
}
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

const DESTINATIONS = ['Overview', 'Explore', 'Activity', 'Plan', 'Accounts'];

describe('app shell', () => {
  it('renders the five destinations in the bottom tabs, the rail and the sidebar', async () => {
    render(<App />);
    expect(await screen.findByText('overview body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const navs = primaryNavs();
    expect(navs).toHaveLength(3);
    const bottom = navs.find((n) => n.getAttribute('data-nav') === 'bottom')!;
    const rail = navs.find((n) => n.closest('[data-nav="rail"]'))!;
    const side = navs.find((n) => n.closest('[data-nav="sidebar"]'))!;
    for (const nav of [bottom, rail, side]) {
      expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(DESTINATIONS);
      // Import and Settings are actions, never tabs.
      expect(within(nav).queryByRole('link', { name: 'Import' })).not.toBeInTheDocument();
      expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    }
  });

  it('switches layout by breakpoint class: tabs on phones, rail on tablets, sidebar on desktop', async () => {
    render(<App />);
    await screen.findByText('overview body');
    expect(bottomNav().className).toContain('md:hidden');
    const rail = document.querySelector('[data-nav="rail"]')!;
    expect(rail.className.split(' ')).toContain('hidden');
    expect(rail.className).toContain('md:flex');
    expect(rail.className).toContain('lg:hidden');
    const side = document.querySelector('[data-nav="sidebar"]')!;
    expect(side.className).toContain('lg:flex');
    expect(side.className.split(' ')).toContain('hidden');
  });

  it('offers Import as an action at every breakpoint', async () => {
    render(<App />);
    await screen.findByText('overview body');
    const imports = Array.from(document.querySelectorAll('[data-action="import"]'));
    // header (phones and tablets), rail and sidebar
    expect(imports).toHaveLength(3);
    for (const el of imports) expect(el.getAttribute('href')).toBe('#/import');
    expect(document.querySelector('header [data-action="import"]')).not.toBeNull();
    expect(document.querySelector('[data-nav="rail"] [data-action="import"]')).not.toBeNull();
    expect(document.querySelector('[data-nav="sidebar"] [data-action="import"]')).not.toBeNull();
    // Settings is behind a gear on phones and in the rail/sidebar elsewhere; Learning is in the sidebar.
    expect(document.querySelector('header [data-action="settings"]')).not.toBeNull();
    expect(within(document.querySelector('[data-nav="sidebar"]') as HTMLElement).getByRole('link', { name: 'Learning' })).toBeInTheDocument();
  });

  it('marks the active destination with aria-current and follows navigation', async () => {
    render(<App />);
    await screen.findByText('overview body');
    expect(within(bottomNav()).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottomNav()).getByRole('link', { name: 'Activity' })).not.toHaveAttribute('aria-current');

    await userEvent.click(screen.getAllByRole('link', { name: 'Import statement' })[0]);
    expect(await screen.findByText('import body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Import statements' })).toBeInTheDocument();
    expect(within(bottomNav()).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(bottomNav()).getByRole('link', { name: 'Accounts' }));
    expect(await screen.findByText('accounts/AccountsPage body')).toBeInTheDocument();
    expect(within(bottomNav()).getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
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
    expect(primaryNavs()).toHaveLength(3);

    await userEvent.click(document.querySelector('header [data-action="settings"]')!);
    expect(await screen.findByText('settings body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends unknown routes to the overview', async () => {
    window.location.hash = '#/nowhere';
    render(<App />);
    expect(await screen.findByText('overview body')).toBeInTheDocument();
  });

  it('lets the person scope every screen to some accounts, and remembers it', async () => {
    localStorage.removeItem('vm-scope');
    window.location.hash = '#/activity';
    render(<App />);
    await screen.findByText('activity body');
    await userEvent.click(screen.getByRole('button', { name: /All accounts/ }));
    const dialog = screen.getByRole('dialog', { name: 'Which accounts?' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Test Card' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: /Test Savings/ })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('vm-scope')!)).toEqual(['a1']);
  });

  it('shows a quiet note while offline and nothing when online', async () => {
    render(<App />);
    await screen.findByText('overview body');
    expect(document.querySelector('[data-offline]')).toBeNull();
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText(/Offline — everything still works except loading the OCR files/)).toBeInTheDocument();
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(document.querySelector('[data-offline]')).toBeNull());
  });
});
