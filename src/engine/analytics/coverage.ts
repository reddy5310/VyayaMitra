import type { Account, IsoDate, Statement, Transaction } from '@/domain/types';
import { addDays, daysBetween } from '@/lib/dates';
import type { AccountCoverage, Coverage } from './index';
import { formatRange } from './util';

interface Interval {
  start: IsoDate;
  end: IsoDate;
}

const INCOME_TYPES: ReadonlySet<Account['type']> = new Set(['savings', 'current', 'wallet']);

/** The dates a statement is known to cover: its printed period, else the min..max of its rows. */
function statementInterval(s: Statement, rowDates: Map<string, Interval>): Interval | null {
  const rows = rowDates.get(s.id);
  const start = s.periodStart ?? rows?.start;
  const end = s.periodEnd ?? rows?.end;
  if (start && end) return start <= end ? { start, end } : { start: end, end: start };
  if (start ?? end) return { start: (start ?? end) as IsoDate, end: (start ?? end) as IsoDate };
  return null;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= addDays(last.end, 1)) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

function accountCoverage(accountId: string, intervals: Interval[], start: IsoDate, end: IsoDate): AccountCoverage {
  const clipped = mergeIntervals(
    intervals.filter((iv) => iv.end >= start && iv.start <= end).map((iv) => ({ start: iv.start < start ? start : iv.start, end: iv.end > end ? end : iv.end })),
  );
  const totalDays = daysBetween(start, end) + 1;
  const gaps: Interval[] = [];
  let cursor = start;
  let covered = 0;
  for (const iv of clipped) {
    if (iv.start > cursor) gaps.push({ start: cursor, end: addDays(iv.start, -1) });
    covered += daysBetween(iv.start, iv.end) + 1;
    cursor = addDays(iv.end, 1);
  }
  if (cursor <= end) gaps.push({ start: cursor, end });
  return { accountId, coveredDays: covered, totalDays, gaps, complete: gaps.length === 0 };
}

/**
 * Which parts of [start,end] are backed by an imported statement.
 *
 * A statement covers `periodStart..periodEnd`. If either bound is missing it falls back to the
 * min..max date of that statement's rows, which needs the optional `txns` argument (pass the
 * ledger rows when available; without them such a statement covers nothing).
 *
 * Relevant accounts = not archived AND at least one statement. Coverage is the union of an
 * account's statements, so back-to-back statements count as continuous. An account is expected
 * to be covered only from the start of its EARLIEST imported statement onward: it is never
 * "missing" before it was tracked, but a gap between its statements, or the time after its
 * latest statement, still counts as missing (the "import your latest statement" nudge). Accounts
 * not yet tracked anywhere in [start,end] are left out of `accounts`. With no expected account
 * nothing is known, so `complete` is false and `incomeCoverage` is 'none'.
 */
export function computeCoverage(
  accounts: readonly Account[],
  statements: readonly Statement[],
  start: IsoDate,
  end: IsoDate,
  txns: readonly Transaction[] = [],
): Coverage {
  const rowDates = new Map<string, Interval>();
  if (statements.some((s) => !s.periodStart || !s.periodEnd)) {
    for (const t of txns) {
      const cur = rowDates.get(t.statementId);
      if (!cur) rowDates.set(t.statementId, { start: t.date, end: t.date });
      else {
        if (t.date < cur.start) cur.start = t.date;
        if (t.date > cur.end) cur.end = t.date;
      }
    }
  }

  const byAccount = new Map<string, Statement[]>();
  for (const s of statements) {
    const list = byAccount.get(s.accountId);
    if (list) list.push(s);
    else byAccount.set(s.accountId, [s]);
  }

  const relevant = accounts.filter((a) => !a.archived && (byAccount.get(a.id)?.length ?? 0) > 0);
  const perAccount: AccountCoverage[] = [];
  const relevantTracked: Account[] = [];
  const notes: string[] = [];
  for (const a of relevant) {
    const intervals = (byAccount.get(a.id) ?? [])
      .map((s) => statementInterval(s, rowDates))
      .filter((iv): iv is Interval => iv !== null);
    // An account is only expected from the start of its earliest imported statement onward.
    const tracked = intervals.reduce<IsoDate | null>((min, iv) => (min === null || iv.start < min ? iv.start : min), null);
    const from = tracked !== null && tracked > start ? tracked : start;
    if (from > end) continue; // not tracked yet in this range: nothing can be missing
    const cov = accountCoverage(a.id, intervals, from, end);
    perAccount.push(cov);
    relevantTracked.push(a);
    for (const g of cov.gaps.slice(0, 3)) notes.push(`No ${a.name} statement covers ${formatRange(g.start, g.end)}`);
    if (cov.gaps.length > 3) notes.push(`${a.name} has ${cov.gaps.length - 3} more uncovered stretches in this period`);
  }

  const complete = perAccount.length > 0 && perAccount.every((c) => c.complete);
  if (relevant.length === 0) notes.push('No statements have been imported yet');
  else if (perAccount.length === 0) notes.push(`No imported statement covers ${formatRange(start, end)}`);

  const incomeCovs = relevantTracked.map((a, i) => ({ a, c: perAccount[i] })).filter((x) => INCOME_TYPES.has(x.a.type)).map((x) => x.c);
  let incomeCoverage: Coverage['incomeCoverage'];
  if (incomeCovs.length === 0) incomeCoverage = 'none';
  else if (incomeCovs.every((c) => c.complete)) incomeCoverage = 'full';
  else if (incomeCovs.some((c) => c.coveredDays > 0)) incomeCoverage = 'partial';
  else incomeCoverage = 'none';

  return { start, end, accounts: perAccount, complete, incomeCoverage, notes };
}
