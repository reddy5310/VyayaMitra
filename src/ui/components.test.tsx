import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Chip,
  ConfirmDialog,
  ListRow,
  Menu,
  SegmentedControl,
  Sheet,
  Stat,
  Switch,
  TabPanel,
  Tabs,
  Money,
  PrivacyContext,
  Button,
} from '.';

describe('ConfirmDialog', () => {
  it('runs onConfirm then closes', async () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Remove it?" confirmLabel="Remove">
        It cannot be undone.
      </ConfirmDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Remove it?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires the typed text and shows a failure without closing', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('Nope, that failed.');
    });
    const onClose = vi.fn();
    render(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Wipe" confirmLabel="Wipe" requireText="DELETE" />);
    const confirm = screen.getByRole('button', { name: 'Wipe' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE{Enter}');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Nope, that failed.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Sheet', () => {
  it('does not report onClose when the parent closes it', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={onClose} title="A">
        body
      </Sheet>,
    );
    rerender(
      <Sheet open={false} onClose={onClose} title="A">
        body
      </Sheet>,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the close button', async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="A">
        body
      </Sheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Menu', () => {
  const setup = () => {
    const picked: string[] = [];
    render(
      <Menu
        label="Actions"
        trigger={(p) => <Button {...p}>Open</Button>}
        items={[
          { label: 'First', onSelect: () => picked.push('first') },
          { label: 'Disabled', onSelect: () => picked.push('disabled'), disabled: true },
          'separator',
          { label: 'Third', onSelect: () => picked.push('third') },
        ]}
      />,
    );
    return picked;
  };

  it('opens, moves with arrow keys (skipping disabled), selects with Enter and returns focus', async () => {
    const picked = setup();
    const trigger = screen.getByRole('button', { name: 'Open' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Third' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus(); // wraps
    await userEvent.keyboard('{End}{Enter}');
    expect(picked).toEqual(['third']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape and on an outside click', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('Tabs', () => {
  function Demo() {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return (
      <>
        <Tabs
          label="Demo"
          idBase="demo"
          value={v}
          onChange={setV}
          tabs={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta', count: 3 },
            { value: 'c', label: 'Gamma' },
          ]}
        />
        <TabPanel idBase="demo" value="a" active={v === 'a'}>
          panel a
        </TabPanel>
        <TabPanel idBase="demo" value="b" active={v === 'b'}>
          panel b
        </TabPanel>
      </>
    );
  }

  it('switches panels by click and arrow keys with a roving tabindex', async () => {
    render(<Demo />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel a');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveAttribute('tabindex', '-1');

    alpha.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Beta/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel b');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(alpha);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel a');
  });
});

describe('Switch, Chip, SegmentedControl', () => {
  it('Switch exposes role=switch and toggles', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Hide amounts" />);
    const sw = screen.getByRole('switch', { name: 'Hide amounts' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Chip is a toggle button', async () => {
    const onClick = vi.fn();
    render(
      <Chip selected onClick={onClick}>
        Food
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Food' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
  });

  it('SegmentedControl supports arrow-key selection', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Theme"
        value="light"
        onChange={onChange}
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />,
    );
    screen.getByRole('radio', { name: 'Light' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('dark');
    // focus followed the selection, so ArrowLeft steps back from 'dark'
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('light');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('system');
  });
});

describe('Stat and ListRow', () => {
  it('Stat shows label, value and sublabel', () => {
    render(<Stat label="Spent" value="₹1,200" sublabel="vs last month" tone="negative" />);
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.getByText('₹1,200')).toHaveClass('text-negative');
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('ListRow is a button only when clickable', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ListRow title="Row" subtitle="detail" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<ListRow title="Row" subtitle="detail" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: /Row/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Money privacy', () => {
  it('blurs amounts when hideAmounts is on', () => {
    const { rerender } = render(
      <PrivacyContext.Provider value={{ hideAmounts: false }}>
        <Money value={123456} />
      </PrivacyContext.Provider>,
    );
    expect(screen.getByText(/1,234\.56/)).toBeInTheDocument();
    rerender(
      <PrivacyContext.Provider value={{ hideAmounts: true }}>
        <Money value={123456} />
      </PrivacyContext.Provider>,
    );
    expect(screen.queryByText(/1,234\.56/)).not.toBeInTheDocument();
    expect(within(document.body).getByLabelText('Amount hidden')).toBeInTheDocument();
  });
});
