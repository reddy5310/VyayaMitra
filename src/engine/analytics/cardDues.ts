import type { Account, IsoDate, Statement, Transaction } from '@/domain/types';
import { daysBetween } from '@/lib/dates';
import type { CardDue } from './index';

/** The date a statement was cut: the printed statement date, else the end of its period. */
function statementCut(s: Statement, txns: readonly Transaction[]): IsoDate | undefined {
  const printed = s.cardSummary?.statementDate ?? s.periodEnd;
  if (printed) return printed;
  let latest: IsoDate | undefined;
  for (const t of txns) if (t.statementId === s.id && (!latest || t.date > latest)) latest = t.date;
  return latest;
}

/**
 * The bill each credit card currently owes: the latest statement per (non-archived) credit-card
 * account that prints a due date and a total due.
 *
 * paidSoFar = card_payment credits on that card account dated after the statement date.
 * Status: 'paid' (paidSoFar >= totalDue), else 'overdue' when today is past the due date and
 * less than the minimum due (or, if no minimum is printed, less than the total) has been paid,
 * else 'partly_paid' when something was paid, else 'due'. daysLeft is negative once overdue.
 * Only payments visible in imported statements are counted.
 */
export function upcomingCardDues(
  accounts: readonly Account[],
  statements: readonly Statement[],
  txns: readonly Transaction[],
  today: IsoDate,
): CardDue[] {
  const out: CardDue[] = [];
  for (const a of accounts) {
    if (a.type !== 'credit_card' || a.archived) continue;
    const candidates = statements.filter((s) => s.accountId === a.id && s.cardSummary?.dueDate && s.cardSummary.totalDue !== undefined);
    if (candidates.length === 0) continue;
    const key = (s: Statement): string => s.cardSummary?.statementDate ?? s.periodEnd ?? s.cardSummary?.dueDate ?? '';
    const latest = candidates.reduce((x, y) => (key(y) > key(x) || (key(y) === key(x) && y.importedAt > x.importedAt) ? y : x));
    const summary = latest.cardSummary;
    if (!summary?.dueDate || summary.totalDue === undefined) continue;
    const cut = statementCut(latest, txns);
    const payments = txns.filter(
      (t) => t.accountId === a.id && t.kind === 'card_payment' && t.direction === 'credit' && (cut === undefined || t.date > cut),
    );
    const paidSoFar = payments.reduce((s, t) => s + t.amount, 0);
    const totalDue = summary.totalDue;
    const daysLeft = daysBetween(today, summary.dueDate);
    const needed = summary.minimumDue !== undefined && summary.minimumDue > 0 ? summary.minimumDue : totalDue;
    let status: CardDue['status'];
    if (totalDue <= 0 || paidSoFar >= totalDue) status = 'paid';
    else if (daysLeft < 0 && paidSoFar < needed) status = 'overdue';
    else if (paidSoFar > 0) status = 'partly_paid';
    else status = 'due';
    out.push({
      accountId: a.id,
      statementId: latest.id,
      dueDate: summary.dueDate,
      totalDue,
      ...(summary.minimumDue !== undefined ? { minimumDue: summary.minimumDue } : {}),
      paidSoFar,
      status,
      daysLeft,
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.accountId.localeCompare(b.accountId));
}
