import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { isBusy, setBusy, useBusy } from './busy';

const reload = vi.hoisted(() => vi.fn());

// Stand-in for the service-worker registrar: reports "a new version is waiting".
vi.mock('./PwaRegistrar', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Registrar({ onReport }: { onReport: (r: { needRefresh: boolean; offlineReady: boolean; update: () => void }) => void }) {
      useEffect(() => onReport({ needRefresh: true, offlineReady: false, update: reload }), [onReport]);
      return null;
    },
  };
});

import { PwaProvider, UpdateBanner, usePwa } from './pwa';

function Probe() {
  return <p data-testid="busy">{useBusy().join(',') || 'idle'}</p>;
}
function Reloader() {
  const { reload: doReload } = usePwa();
  return <button onClick={doReload}>force</button>;
}

afterEach(() => {
  act(() => {
    setBusy('import', false);
    setBusy('restore', false);
  });
  reload.mockClear();
});

describe('busy flag', () => {
  it('tracks reasons independently and ignores repeats', () => {
    render(<Probe />);
    expect(screen.getByTestId('busy')).toHaveTextContent('idle');
    act(() => setBusy('import', true));
    act(() => setBusy('import', true));
    act(() => setBusy('restore', true));
    expect(screen.getByTestId('busy')).toHaveTextContent('import,restore');
    act(() => setBusy('import', false));
    expect(screen.getByTestId('busy')).toHaveTextContent('restore');
    expect(isBusy()).toBe(true);
    act(() => setBusy('restore', false));
    expect(isBusy()).toBe(false);
  });
});

describe('update banner while busy', () => {
  const mount = () =>
    render(
      <ToastProvider>
        <PwaProvider enabled>
          <UpdateBanner />
          <Reloader />
        </PwaProvider>
      </ToastProvider>,
    );

  it('offers Reload when idle', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Reload' }).click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says the update will apply after the import, offers no Reload, and refuses a direct reload', async () => {
    mount();
    await screen.findByRole('button', { name: 'Reload' });
    act(() => setBusy('import', true));
    expect(screen.getByText(/Update ready — will apply after your import/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    screen.getByRole('button', { name: 'force' }).click();
    expect(reload).not.toHaveBeenCalled();
    act(() => setBusy('import', false));
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
