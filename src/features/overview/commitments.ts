import type { Account, IsoDate, Paise } from '@/domain/types';
import type { CardDue, RecurringSeries } from '@/engine/analytics';
import { addDays, daysBetween } from '@/lib/dates';

export interface CommitmentItem {
  key: string;
  date: IsoDate;
  label: string;
  amount: Paise;
  kind: 'card' | 'recurring';
  /** Plain-words status, e.g. "Due in 3 days", "2 days overdue". */
  status: string;
  tone: 'neutral' | 'warning' | 'negative';
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function when(date: IsoDate, today: IsoDate): { text: string; tone: CommitmentItem['tone'] } {
  const left = daysBetween(today, date);
  if (left < 0) return { text: `${days(-left)} overdue`, tone: 'negative' };
  if (left === 0) return { text: 'Due today', tone: 'warning' };
  return { text: `In ${days(left)}`, tone: left <= 3 ? 'warning' : 'neutral' };
}

/** Card bills still to pay plus confirmed recurring payments, ordered by date, within the next `horizon` days. */
export function buildCommitments(
  dues: readonly CardDue[],
  series: readonly RecurringSeries[],
  accounts: readonly Account[],
  today: IsoDate,
  horizon = 60,
): CommitmentItem[] {
  const limit = addDays(today, horizon);
  const items: CommitmentItem[] = [];
  for (const d of dues) {
    if (d.status === 'paid' || d.dueDate > limit) continue;
    const w = when(d.dueDate, today);
    items.push({
      key: `card-${d.statementId}`,
      date: d.dueDate,
      label: `${accounts.find((a) => a.id === d.accountId)?.name ?? 'Credit card'} bill`,
      amount: Math.max(0, d.totalDue - d.paidSoFar),
      kind: 'card',
      status: d.status === 'partly_paid' ? `Partly paid · ${w.text.toLowerCase()}` : w.text,
      tone: w.tone,
    });
  }
  for (const s of series) {
    if (s.status !== 'confirmed' || s.nextExpected > limit) continue;
    const w = when(s.nextExpected, today);
    items.push({
      key: `rec-${s.merchantKey}`,
      date: s.nextExpected,
      label: s.merchant,
      amount: s.typicalAmount,
      kind: 'recurring',
      status: s.overdue ? 'Expected, not seen yet' : w.text.replace('Due today', 'Expected today'),
      tone: s.overdue ? 'warning' : 'neutral',
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
