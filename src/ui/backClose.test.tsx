import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './primitives';
import { loadScroll, saveScroll } from '../app/scroll';

function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <p data-testid="state">{open ? 'open' : 'closed'}</p>
      <Sheet open={open} onClose={() => setOpen(false)} title="Task">
        content
      </Sheet>
    </>
  );
}

describe('Back closes sheets', () => {
  it('pushes a history entry while open, and Back closes the sheet instead of leaving', async () => {
    render(<Demo />);
    const before = window.history.length;
    screen.getByText('open').click();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('open'));
    await waitFor(() => expect(window.history.length).toBe(before + 1));
    expect(window.history.state?.vmSheet).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removes its entry again when closed from the UI', async () => {
    render(<Demo />);
    screen.getByText('open').click();
    await waitFor(() => expect(window.history.state?.vmSheet).toBeTruthy());
    screen.getByRole('button', { name: 'Close' }).click();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'));
    await waitFor(() => expect(window.history.state?.vmSheet).toBeFalsy());
  });
});

describe('scroll memory storage', () => {
  it('round-trips a position per route and tolerates broken storage', () => {
    sessionStorage.clear();
    saveScroll('/activity', 1234.6);
    expect(loadScroll('/activity')).toBe(1235);
    expect(loadScroll('/plan')).toBe(0);
    sessionStorage.setItem('vm-scroll', '{nope');
    expect(loadScroll('/activity')).toBe(0);
  });
});
