import type { MoneyBackCase } from '@/engine/analytics';
import { formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import type { Tone } from '@/ui';

export const STATUS_INFO: Record<MoneyBackCase['status'], { label: string; tone: Tone }> = {
  expected: { label: 'Expected', tone: 'info' },
  partially_received: { label: 'Partly received', tone: 'warning' },
  received: { label: 'Received', tone: 'positive' },
  over_received: { label: 'Received more than expected', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
  amount_to_confirm: { label: 'Amount to confirm', tone: 'warning' },
};

/** Ageing in words: a missed promise matters more than the raw number of days. */
export function agingText(c: MoneyBackCase): string | null {
  if (c.status === 'received' || c.status === 'closed' || c.status === 'over_received') return null;
  if (c.overdue) return c.case.promisedDate ? `Overdue: promised by ${formatDate(c.case.promisedDate)}` : `Overdue: ${c.ageDays} days since the purchase`;
  if (c.case.promisedDate) return `Promised by ${formatDate(c.case.promisedDate)}`;
  return `${c.ageDays} day${c.ageDays === 1 ? '' : 's'} since the purchase`;
}

/** Plain text the user can paste into an email or chat with the merchant or bank. Only facts from the ledger. */
export function followUpText(c: MoneyBackCase, references: Record<string, string | undefined>): string {
  const lines: string[] = [`Refund follow-up: ${c.case.merchant}`, ''];
  lines.push('Purchase');
  for (const p of c.purchases) {
    const ref = references[p.txnId];
    lines.push(`- ${formatDate(p.date)}, ${formatINR(p.amount)}${ref ? `, reference ${ref}` : ''}`);
  }
  lines.push('');
  lines.push(c.expected !== undefined ? `Refund expected: ${formatINR(c.expected)}` : 'Refund amount: to be confirmed');
  if (c.case.reason) lines.push(`Reason: ${c.case.reason}`);
  if (c.case.promisedDate) lines.push(`Promised by: ${formatDate(c.case.promisedDate)}`);
  const credits = c.timeline.filter((t) => t.kind === 'credit');
  lines.push('');
  if (credits.length === 0) lines.push('Credits received so far: none found in my statements');
  else {
    lines.push('Credits received so far');
    for (const t of credits) lines.push(`- ${formatDate(t.date)}, ${t.amount !== undefined ? formatINR(t.amount) : ''}`);
  }
  lines.push(`Total received: ${formatINR(c.received)}`);
  if (c.outstanding !== undefined) lines.push(`Still outstanding: ${formatINR(c.outstanding)}`);
  return lines.join('\n');
}

/** Copy with the Clipboard API, then the old selection trick; false means the user has to copy by hand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
