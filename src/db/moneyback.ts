/**
 * CONTRACT — owned by the ledger module (wave 8: money back, fees, adviser preferences).
 *
 * Statements prove what was RECEIVED; what is EXPECTED comes from the user. Refund allocations
 * therefore never exceed the credit they come from, and the received/outstanding state is always
 * derived from allocations, never stored.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { allCategories } from '@/domain/categories';
import type {
  AdviserPreference,
  CardPolicy,
  CategoryPreference,
  ChargeLink,
  ChargeType,
  IsoDate,
  Paise,
  RefundAllocation,
  RefundCase,
  Transaction,
} from '@/domain/types';
import { linkCharges, proposeRefundAllocations } from '@/engine/match';
import { formatINR } from '@/lib/money';
import { newId, nowTimestamp } from '@/lib/ids';
import { db, writeAll } from './db';
import {
  ValidationError,
  requireDate,
  requireName,
  requireOneOf,
  requirePositivePaise,
} from './validation';

export const CHARGE_TYPES: readonly ChargeType[] = [
  'fuel_surcharge', 'annual_fee', 'joining_fee', 'late_payment_fee', 'finance_charge', 'forex_markup', 'atm_charge',
  'cash_advance_fee', 'processing_fee', 'convenience_fee', 'overlimit_fee', 'bank_charge', 'other_fee',
];
const CHARGE_ROLES: readonly ChargeLink['role'][] = ['charge', 'tax', 'reversal', 'tax_reversal'];
const PREFERENCES: readonly CategoryPreference[] = ['protected', 'essential', 'fixed', 'adjustable'];
const META_REJECTED = 'moneyRejected';

// ─── hooks ───────────────────────────────────────────────────────────────────

export function useRefundCases(): RefundCase[] | undefined {
  return useLiveQuery(() => db.refundCases.toArray(), []);
}
export function useRefundAllocations(): RefundAllocation[] | undefined {
  return useLiveQuery(() => db.refundAllocations.toArray(), []);
}
export function useChargeLinks(): ChargeLink[] | undefined {
  return useLiveQuery(() => db.chargeLinks.toArray(), []);
}
export function useCardPolicies(): CardPolicy[] | undefined {
  return useLiveQuery(() => db.cardPolicies.toArray(), []);
}
export function useAdviserPreferences(): AdviserPreference[] | undefined {
  return useLiveQuery(() => db.adviserPreferences.toArray(), []);
}

// ─── refund cases ────────────────────────────────────────────────────────────

async function getCase(id: string): Promise<RefundCase> {
  const c = typeof id === 'string' ? await db.refundCases.get(id) : undefined;
  if (!c) throw new ValidationError('That refund case no longer exists.');
  return c;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${label} must be text.`);
  const t = value.trim();
  if (t.length > max) throw new ValidationError(`${label} can be up to ${max} characters.`);
  return t || undefined;
}

/** "Track an expected refund" for one or more purchases. */
export async function createRefundCase(input: {
  purchaseTxnIds: string[];
  expectedAmount?: Paise;
  reason?: string;
  promisedDate?: IsoDate;
  notes?: string;
}): Promise<RefundCase> {
  if (!Array.isArray(input.purchaseTxnIds) || input.purchaseTxnIds.length === 0) {
    throw new ValidationError('Choose at least one purchase.');
  }
  const ids = [...new Set(input.purchaseTxnIds)];
  const expectedAmount = input.expectedAmount === undefined ? undefined : requirePositivePaise(input.expectedAmount, 'Expected refund');
  const reason = optionalText(input.reason, 'Reason', 200);
  const notes = optionalText(input.notes, 'Notes', 500);
  const promisedDate = input.promisedDate === undefined ? undefined : requireDate(input.promisedDate, 'Promised date');
  return writeAll(async () => {
    const purchases = (await db.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t);
    if (purchases.length !== ids.length) throw new ValidationError('One of those purchases no longer exists.');
    if (purchases.some((p) => p.direction !== 'debit')) throw new ValidationError('Refund cases track purchases (money spent).');
    const open = await db.refundCases.where('state').equals('open').toArray();
    const overlapping = open.filter((c) => c.purchaseTxnIds.some((id) => ids.includes(id)));
    const now = nowTimestamp();
    if (overlapping.length > 0) {
      // A case the matcher opened on its own (no amount, no notes) is adopted rather than duplicated,
      // so credits already matched to it stay matched.
      const auto = overlapping[0];
      if (overlapping.length === 1 && auto.expectedSource === 'unknown' && !auto.reason && !auto.notes) {
        const adopted: RefundCase = {
          ...auto,
          purchaseTxnIds: [...new Set([...auto.purchaseTxnIds, ...ids])],
          updatedAt: now,
        };
        if (expectedAmount !== undefined) {
          adopted.expectedAmount = expectedAmount;
          adopted.expectedSource = 'user';
        }
        if (reason) adopted.reason = reason;
        if (notes) adopted.notes = notes;
        if (promisedDate) adopted.promisedDate = promisedDate;
        await db.refundCases.put(adopted);
        return adopted;
      }
      throw new ValidationError('You are already tracking a refund for one of those purchases.');
    }
    const first = purchases[0];
    const record: RefundCase = {
      id: newId(),
      purchaseTxnIds: ids,
      merchant: first.merchant,
      merchantKey: first.merchantKey,
      expectedSource: expectedAmount === undefined ? 'unknown' : 'user',
      state: 'open',
      createdAt: now,
      updatedAt: now,
    };
    if (expectedAmount !== undefined) record.expectedAmount = expectedAmount;
    if (reason) record.reason = reason;
    if (notes) record.notes = notes;
    if (promisedDate) record.promisedDate = promisedDate;
    await db.refundCases.add(record);
    return record;
  });
}

export async function updateRefundCase(
  id: string,
  patch: Partial<Pick<RefundCase, 'expectedAmount' | 'expectedSource' | 'reason' | 'promisedDate' | 'notes'>>,
): Promise<void> {
  await writeAll(async () => {
    const c = await getCase(id);
    const next: RefundCase = { ...c, updatedAt: nowTimestamp() };
    if ('expectedAmount' in patch) {
      if (patch.expectedAmount === undefined) {
        delete next.expectedAmount;
        next.expectedSource = 'unknown';
      } else {
        next.expectedAmount = requirePositivePaise(patch.expectedAmount, 'Expected refund');
        next.expectedSource = 'user';
      }
    }
    if (patch.expectedSource !== undefined) {
      next.expectedSource = requireOneOf(patch.expectedSource, ['user', 'full_purchase', 'unknown'] as const, 'Source');
    }
    if ('reason' in patch) {
      const r = optionalText(patch.reason, 'Reason', 200);
      if (r) next.reason = r;
      else delete next.reason;
    }
    if ('notes' in patch) {
      const n = optionalText(patch.notes, 'Notes', 500);
      if (n) next.notes = n;
      else delete next.notes;
    }
    if ('promisedDate' in patch) {
      if (patch.promisedDate === undefined) delete next.promisedDate;
      else next.promisedDate = requireDate(patch.promisedDate, 'Promised date');
    }
    await db.refundCases.put(next);
  });
}

export async function closeRefundCase(id: string, reason: NonNullable<RefundCase['closedReason']>): Promise<void> {
  const closedReason = requireOneOf(reason, ['received', 'written_off', 'not_expected'] as const, 'Reason');
  await writeAll(async () => {
    const c = await getCase(id);
    await db.refundCases.put({ ...c, state: 'closed', closedReason, updatedAt: nowTimestamp() });
  });
}

export async function reopenRefundCase(id: string): Promise<void> {
  await writeAll(async () => {
    const c = await getCase(id);
    const next: RefundCase = { ...c, state: 'open', updatedAt: nowTimestamp() };
    delete next.closedReason;
    await db.refundCases.put(next);
  });
}

async function allocatedFor(creditTxnId: string): Promise<Paise> {
  const rows = await db.refundAllocations.where('creditTxnId').equals(creditTxnId).toArray();
  return rows.reduce((s, a) => s + a.amount, 0);
}

/** "Match this credit": allocate (part of) a credit to a case; rejects over-allocation of the credit. */
export async function allocateCredit(input: {
  caseId: string;
  creditTxnId: string;
  amount: Paise;
  purchaseTxnId?: string;
}): Promise<RefundAllocation> {
  const amount = requirePositivePaise(input.amount, 'Amount');
  return writeAll(async () => {
    const c = await getCase(input.caseId);
    const credit = await db.transactions.get(input.creditTxnId);
    if (!credit) throw new ValidationError('That credit no longer exists.');
    if (credit.direction !== 'credit') throw new ValidationError('Only money received can be matched to a refund.');
    if (input.purchaseTxnId && !c.purchaseTxnIds.includes(input.purchaseTxnId)) {
      throw new ValidationError('That purchase is not part of this refund case.');
    }
    const left = credit.amount - (await allocatedFor(credit.id));
    if (amount > left) {
      throw new ValidationError(`Only ${formatINR(Math.max(left, 0))} of this credit is left to match.`);
    }
    const allocation: RefundAllocation = {
      id: newId(),
      caseId: c.id,
      creditTxnId: credit.id,
      amount,
      source: 'user',
      reason: 'You matched this credit',
      createdAt: nowTimestamp(),
    };
    if (input.purchaseTxnId) allocation.purchaseTxnId = input.purchaseTxnId;
    await db.refundAllocations.add(allocation);
    // A manual match supersedes an earlier "not this one" for the same pair.
    await forgetRejected('allocations', `${credit.id}|${c.id}`);
    return allocation;
  });
}

export async function removeAllocation(id: string): Promise<void> {
  await writeAll(async () => {
    const a = await db.refundAllocations.get(id);
    if (!a) return;
    await db.refundAllocations.delete(id);
    // Remember the rejection so the next automatic pass does not put it straight back.
    if (a.source === 'auto') await rememberRejected('allocations', `${a.creditTxnId}|${a.caseId}`);
  });
}

// ─── charge links ────────────────────────────────────────────────────────────

/** User correction of a charge relationship (link a tax/reversal/purchase to a charge event). */
export async function setChargeLink(
  input: Omit<ChargeLink, 'id' | 'source' | 'reason'> & { reason?: string },
): Promise<void> {
  const chargeType = requireOneOf(input.chargeType, CHARGE_TYPES, 'Charge type');
  const role = requireOneOf(input.role, CHARGE_ROLES, 'Role');
  const groupId = requireName(input.groupId, 'Charge group', 120);
  const reason = optionalText(input.reason, 'Reason', 200) ?? 'You linked this';
  await writeAll(async () => {
    if (!(await db.transactions.get(input.txnId))) throw new ValidationError('That transaction no longer exists.');
    if (input.relatedPurchaseTxnId && !(await db.transactions.get(input.relatedPurchaseTxnId))) {
      throw new ValidationError('The related purchase no longer exists.');
    }
    await db.chargeLinks.where('txnId').equals(input.txnId).delete();
    const link: ChargeLink = { id: newId(), groupId, txnId: input.txnId, chargeType, role, source: 'user', reason };
    if (input.relatedPurchaseTxnId) link.relatedPurchaseTxnId = input.relatedPurchaseTxnId;
    await db.chargeLinks.add(link);
    await forgetRejected('links', input.txnId);
  });
}

export async function removeChargeLink(id: string): Promise<void> {
  await writeAll(async () => {
    const l = await db.chargeLinks.get(id);
    if (!l) return;
    await db.chargeLinks.delete(id);
    if (l.source === 'auto') await rememberRejected('links', l.txnId);
  });
}

// ─── card terms & adviser preferences ────────────────────────────────────────

export async function saveCardPolicy(
  input: Omit<CardPolicy, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<CardPolicy> {
  const chargeType = requireOneOf(input.chargeType, CHARGE_TYPES, 'Charge type');
  const summary = requireName(input.summary, 'Summary', 300);
  const min = input.waiverMinPurchase === undefined ? undefined : requirePositivePaise(input.waiverMinPurchase, 'Minimum purchase');
  const max = input.waiverMaxPurchase === undefined ? undefined : requirePositivePaise(input.waiverMaxPurchase, 'Maximum purchase');
  if (min !== undefined && max !== undefined && min > max) throw new ValidationError('The minimum purchase cannot exceed the maximum.');
  const cap = input.cycleCap === undefined ? undefined : requirePositivePaise(input.cycleCap, 'Cycle cap');
  if (input.taxReversed !== null && typeof input.taxReversed !== 'boolean') throw new ValidationError('Say whether tax is reversed, or leave it unknown.');
  const effectiveFrom = input.effectiveFrom === undefined ? undefined : requireDate(input.effectiveFrom, 'Effective from');
  const sourceNote = optionalText(input.sourceNote, 'Source note', 300);
  return writeAll(async () => {
    if (!(await db.accounts.get(input.accountId))) throw new ValidationError('That account no longer exists.');
    const existing = input.id ? await db.cardPolicies.get(input.id) : undefined;
    if (input.id && !existing) throw new ValidationError('That card policy no longer exists.');
    const now = nowTimestamp();
    const policy: CardPolicy = {
      id: existing?.id ?? newId(),
      accountId: input.accountId,
      chargeType,
      summary,
      taxReversed: input.taxReversed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (min !== undefined) policy.waiverMinPurchase = min;
    if (max !== undefined) policy.waiverMaxPurchase = max;
    if (cap !== undefined) policy.cycleCap = cap;
    if (effectiveFrom) policy.effectiveFrom = effectiveFrom;
    if (sourceNote) policy.sourceNote = sourceNote;
    await db.cardPolicies.put(policy);
    return policy;
  });
}

export async function deleteCardPolicy(id: string): Promise<void> {
  await db.cardPolicies.delete(id);
}

export async function setAdviserPreference(category: string, preference: CategoryPreference | null): Promise<void> {
  if (preference !== null) requireOneOf(preference, PREFERENCES, 'Preference');
  await writeAll(async () => {
    if (preference === null) {
      await db.adviserPreferences.delete(category);
      return;
    }
    const custom = await db.customCategories.toArray();
    if (!allCategories(custom).some((c) => c.id === category)) throw new ValidationError('That category does not exist.');
    await db.adviserPreferences.put({ category, preference, updatedAt: nowTimestamp() });
  });
}

// ─── automatic pass ──────────────────────────────────────────────────────────

interface Rejected {
  allocations: string[];
  links: string[];
}

async function readRejected(): Promise<Rejected> {
  const v = (await db.meta.get(META_REJECTED))?.value as Partial<Rejected> | undefined;
  return { allocations: v?.allocations ?? [], links: v?.links ?? [] };
}

async function rememberRejected(kind: keyof Rejected, key: string): Promise<void> {
  const r = await readRejected();
  if (!r[kind].includes(key)) r[kind] = [...r[kind], key].slice(-1000);
  await db.meta.put({ key: META_REJECTED, value: r });
}

async function forgetRejected(kind: keyof Rejected, key: string): Promise<void> {
  const r = await readRejected();
  if (!r[kind].includes(key)) return;
  r[kind] = r[kind].filter((k) => k !== key);
  await db.meta.put({ key: META_REJECTED, value: r });
}

export interface MoneyLinkResult {
  allocations: number;
  chargeLinks: number;
  ambiguous: number;
  /** Proposals that were skipped, with the reason (e.g. they would over-allocate a credit). */
  skipped: string[];
}

/**
 * Re-run refund allocation + charge linking over the ledger (called after commit/replace/delete).
 * Runs inside the caller's transaction. User decisions are never changed; automatic ones whose
 * transactions disappeared are removed. A credit is never allocated beyond its amount.
 */
export async function refreshMoneyLinks(): Promise<MoneyLinkResult> {
  const result: MoneyLinkResult = { allocations: 0, chargeLinks: 0, ambiguous: 0, skipped: [] };
  const txns = await db.transactions.toArray();
  const byId = new Map(txns.map((t) => [t.id, t]));

  // 1 ── drop everything that points at deleted transactions
  const cases = await db.refundCases.toArray();
  const deadCases = new Set<string>();
  for (const c of cases) {
    const alive = c.purchaseTxnIds.filter((id) => byId.has(id));
    if (alive.length === c.purchaseTxnIds.length) continue;
    if (alive.length === 0) deadCases.add(c.id);
    else await db.refundCases.put({ ...c, purchaseTxnIds: alive, updatedAt: nowTimestamp() });
  }
  if (deadCases.size > 0) await db.refundCases.bulkDelete([...deadCases]);
  const allAlloc = await db.refundAllocations.toArray();
  const staleAlloc = allAlloc.filter(
    (a) => deadCases.has(a.caseId) || !byId.has(a.creditTxnId) || (a.purchaseTxnId !== undefined && !byId.has(a.purchaseTxnId)),
  );
  if (staleAlloc.length > 0) await db.refundAllocations.bulkDelete(staleAlloc.map((a) => a.id));
  const staleIds = new Set(staleAlloc.map((a) => a.id));
  const liveAlloc = allAlloc.filter((a) => !staleIds.has(a.id));

  const links = await db.chargeLinks.toArray();
  const staleLinks = links.filter((l) => !byId.has(l.txnId));
  if (staleLinks.length > 0) await db.chargeLinks.bulkDelete(staleLinks.map((l) => l.id));
  for (const l of links) {
    if (byId.has(l.txnId) && l.relatedPurchaseTxnId && !byId.has(l.relatedPurchaseTxnId)) {
      const next = { ...l };
      delete next.relatedPurchaseTxnId;
      await db.chargeLinks.put(next);
    }
  }

  const rejected = await readRejected();
  const liveCases = (await db.refundCases.toArray()).filter((c) => !deadCases.has(c.id));

  // 2 ── refunds (the matcher is derived data: a failure must never block the user's action)
  try {
    const proposal = proposeRefundAllocations(txns, { cases: liveCases, allocations: liveAlloc });
    result.ambiguous = proposal.ambiguous.length;
    const now = nowTimestamp();
    const idFor = new Map<string, string>();
    const used = new Map<string, Paise>();
    for (const a of liveAlloc) used.set(a.creditTxnId, (used.get(a.creditTxnId) ?? 0) + a.amount);
    const fresh: RefundAllocation[] = [];
    const casesNeeded = new Set<string>();
    for (const p of proposal.allocations) {
      const credit = byId.get(p.creditTxnId);
      const caseId = idFor.get(p.caseId) ?? p.caseId;
      if (!credit || credit.direction !== 'credit') {
        result.skipped.push(`Credit ${p.creditTxnId} is not a credit`);
        continue;
      }
      if (rejected.allocations.includes(`${p.creditTxnId}|${caseId}`)) continue;
      const total = (used.get(credit.id) ?? 0) + p.amount;
      if (!Number.isSafeInteger(p.amount) || p.amount <= 0 || total > credit.amount) {
        result.skipped.push(`Would over-allocate credit ${credit.id}`);
        continue;
      }
      used.set(credit.id, total);
      casesNeeded.add(p.caseId);
      fresh.push({ ...p, caseId: p.caseId, id: newId(), createdAt: now });
    }
    for (const nc of proposal.newCases) {
      if (!casesNeeded.has(nc.tempKey)) continue;
      const { tempKey, ...rest } = nc;
      const id = newId();
      idFor.set(tempKey, id);
      await db.refundCases.add({ ...rest, id, createdAt: now, updatedAt: now });
    }
    const finalAlloc = fresh.flatMap((a) => {
      const real = idFor.get(a.caseId) ?? a.caseId;
      if (!idFor.has(a.caseId) && !liveCases.some((c) => c.id === real)) {
        result.skipped.push(`Unknown case ${a.caseId}`);
        return [];
      }
      return [{ ...a, caseId: real }];
    });
    if (finalAlloc.length > 0) await db.refundAllocations.bulkAdd(finalAlloc);
    result.allocations = finalAlloc.length;
  } catch (e) {
    console.warn('Refund matching failed', e);
    result.skipped.push('Refund matching is unavailable');
  }

  // 3 ── charge events
  try {
    const existing = await db.chargeLinks.toArray();
    const proposed = linkCharges(txns, existing);
    const userTxns = new Set(existing.filter((l) => l.source === 'user').map((l) => l.txnId));
    const autoIds = existing.filter((l) => l.source === 'auto').map((l) => l.id);
    const next: ChargeLink[] = proposed
      .filter((l) => l.source !== 'user' && !userTxns.has(l.txnId) && byId.has(l.txnId) && !rejected.links.includes(l.txnId))
      .map((l) => ({ ...l, id: newId() }));
    if (autoIds.length > 0) await db.chargeLinks.bulkDelete(autoIds);
    if (next.length > 0) await db.chargeLinks.bulkAdd(next);
    result.chargeLinks = next.length;
  } catch (e) {
    console.warn('Charge linking failed', e);
    result.skipped.push('Charge linking is unavailable');
  }
  return result;
}
