import type { Account, CardPolicy, ChargeLink, ChargeType, IsoDate, MonthKey, Paise, Transaction } from '@/domain/types';
import { addMonths, monthKey } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import type { ChargeEvent, FeesSummary } from './index';
import { sum } from './util';

const TYPE_LABEL: Record<ChargeType, string> = {
  fuel_surcharge: 'Fuel surcharge',
  annual_fee: 'Annual fee',
  joining_fee: 'Joining fee',
  late_payment_fee: 'Late payment fee',
  finance_charge: 'Finance charge',
  forex_markup: 'Foreign currency markup',
  atm_charge: 'ATM charge',
  cash_advance_fee: 'Cash advance fee',
  processing_fee: 'Processing fee',
  convenience_fee: 'Convenience fee',
  overlimit_fee: 'Over-limit fee',
  bank_charge: 'Bank charge',
  other_fee: 'Other fee',
};

export function chargeTypeLabel(t: ChargeType): string {
  return TYPE_LABEL[t];
}

const inr = (p: Paise): string => formatINR(Math.round(p), { whole: true });
const UNKNOWN_NOTE = "Check your card's terms.";

/** Eligibility comes ONLY from a user-entered CardPolicy for the same card and charge type; never inferred. */
function eligibility(
  type: ChargeType,
  accountId: string,
  date: IsoDate,
  status: ChargeEvent['status'],
  purchase: Transaction | undefined,
  policies: readonly CardPolicy[],
): ChargeEvent['eligibility'] {
  const policy = policies.find((p) => p.accountId === accountId && p.chargeType === type && (!p.effectiveFrom || p.effectiveFrom <= date));
  if (!policy) return { state: 'unknown', note: UNKNOWN_NOTE };
  if (status === 'reversed') return { state: 'unknown', note: 'Already reversed.', policyId: policy.id };
  const ranged = policy.waiverMinPurchase !== undefined || policy.waiverMaxPurchase !== undefined;
  if (ranged && !purchase) return { state: 'unknown', note: `${UNKNOWN_NOTE} The related purchase is not known, so your recorded range cannot be checked.`, policyId: policy.id };
  if (purchase && ranged) {
    const below = policy.waiverMinPurchase !== undefined && purchase.amount < policy.waiverMinPurchase;
    const above = policy.waiverMaxPurchase !== undefined && purchase.amount > policy.waiverMaxPurchase;
    if (below || above) return { state: 'unlikely', note: `The purchase is outside the range in your recorded terms ("${policy.summary}"). ${UNKNOWN_NOTE}`, policyId: policy.id };
  }
  return { state: 'likely', note: `Might qualify for reversal under your recorded card terms ("${policy.summary}"). ${UNKNOWN_NOTE}`, policyId: policy.id };
}

/**
 * Fees as events: each ChargeLink group is one event with its charge, tax and any reversals
 * (net = charge + tax - reversed). `recurring` = the same charge type in at least 2 of the 3 months ending
 * at `end` (or the latest event). `start`/`end` filter events by date.
 */
export function feesSummary(
  txns: readonly Transaction[],
  ctx: { links: readonly ChargeLink[]; policies: readonly CardPolicy[]; accounts: readonly Account[]; start?: IsoDate; end?: IsoDate },
): FeesSummary {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const groups = new Map<string, ChargeLink[]>();
  for (const l of ctx.links) (groups.get(l.groupId) ?? groups.set(l.groupId, []).get(l.groupId))?.push(l);

  const events: ChargeEvent[] = [];
  for (const [groupId, links] of groups) {
    let charge = 0;
    let tax = 0;
    let reversed = 0;
    const ids: string[] = [];
    const rows: { t: Transaction; role: ChargeLink['role'] }[] = [];
    for (const l of links) {
      const t = byId.get(l.txnId);
      if (!t) continue;
      ids.push(t.id);
      rows.push({ t, role: l.role });
      if (l.role === 'charge') charge += t.amount;
      else if (l.role === 'tax') tax += t.amount;
      else reversed += t.amount;
    }
    // The event is dated and attributed by its charge row (else its earliest row).
    const pool = rows.some((r) => r.role === 'charge') ? rows.filter((r) => r.role === 'charge') : rows;
    const anchor = pool.map((r) => r.t).sort((x, y) => x.date.localeCompare(y.date))[0];
    const date = anchor?.date;
    const accountId = anchor?.accountId ?? '';
    if (ids.length === 0 || date === undefined) continue;
    if ((ctx.start && date < ctx.start) || (ctx.end && date > ctx.end)) continue;
    const type = links[0].chargeType;
    const related = links.find((l) => l.relatedPurchaseTxnId)?.relatedPurchaseTxnId;
    const gross = charge + tax;
    const status: ChargeEvent['status'] = reversed >= gross && gross > 0 ? 'reversed' : reversed > 0 ? 'partly_reversed' : 'not_reversed';
    const net = gross - reversed;
    events.push({
      groupId,
      date,
      accountId,
      chargeType: type,
      charge,
      tax,
      reversed,
      net,
      ...(related ? { relatedPurchaseTxnId: related } : {}),
      txnIds: ids,
      status,
      eligibility: eligibility(type, accountId, date, status, related ? byId.get(related) : undefined, ctx.policies),
      explanation: `${TYPE_LABEL[type]}: ${inr(charge)} charged${tax > 0 ? ` plus ${inr(tax)} tax` : ''}${reversed > 0 ? `, ${inr(reversed)} reversed` : ''}; it cost ${inr(net)}.`,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.groupId.localeCompare(b.groupId));

  const months = new Map<MonthKey, { byType: Partial<Record<ChargeType, Paise>>; net: Paise }>();
  for (const e of events) {
    const m = months.get(monthKey(e.date)) ?? { byType: {}, net: 0 };
    m.byType[e.chargeType] = (m.byType[e.chargeType] ?? 0) + e.net;
    m.net += e.net;
    months.set(monthKey(e.date), m);
  }
  const byMonth = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v }));

  const lastMonth = ctx.end ? monthKey(ctx.end) : events.length ? monthKey(events[events.length - 1].date) : undefined;
  const recurring: FeesSummary['recurring'] = [];
  if (lastMonth) {
    const window = new Set([lastMonth, addMonths(lastMonth, -1), addMonths(lastMonth, -2)]);
    const types = new Map<ChargeType, { months: Set<MonthKey>; total: Paise }>();
    for (const e of events) {
      const m = monthKey(e.date);
      if (!window.has(m)) continue;
      const cur = types.get(e.chargeType) ?? { months: new Set<MonthKey>(), total: 0 };
      cur.months.add(m);
      cur.total += e.net;
      types.set(e.chargeType, cur);
    }
    for (const [chargeType, v] of types) if (v.months.size >= 2) recurring.push({ chargeType, months: v.months.size, total: v.total });
    recurring.sort((a, b) => b.total - a.total);
  }

  return {
    events,
    byMonth,
    totals: { charged: sum(events.map((e) => e.charge)), tax: sum(events.map((e) => e.tax)), reversed: sum(events.map((e) => e.reversed)), net: sum(events.map((e) => e.net)) },
    recurring,
  };
}
