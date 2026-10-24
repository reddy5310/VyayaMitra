/**
 * Row identity for de-duplication.
 *
 * fingerprint = hash( accountId | date | direction | amount | balanceAfter | reference
 *                     | normalised description | occurrence )
 *
 * `occurrence` is the index of the row among rows with an identical canonical key inside ONE
 * statement. So two genuine ₹43 coffees on the same day get occurrence 0 and 1 (both kept), while
 * re-importing the same statement — or an overlapping one that prints the same rows — reproduces
 * the same fingerprints and dedupes exactly. Printed running balances and SerNo/reference values
 * make the key very specific for bank statements; credit-card rows rely on occurrence.
 *
 * The hash is two independent 53-bit cyrb53 passes (≈106 bits, 28 hex chars): synchronous,
 * fast, deterministic and collision-safe far beyond a personal ledger. It is an identity, not a
 * security primitive.
 */
import type { ParsedRow } from '@/domain/types';

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hex14(n: number): string {
  return n.toString(16).padStart(14, '0');
}

/** Lower-cased letters and digits only, so wrapping/spacing differences between parser versions don't matter. */
export function normalizeDescription(description: string): string {
  return description.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The occurrence-independent part of the key. */
export function canonicalRowKey(accountId: string, row: ParsedRow): string {
  return [
    accountId,
    row.date,
    row.direction,
    String(row.amount),
    row.balanceAfter === undefined ? '' : String(row.balanceAfter),
    (row.reference ?? '').trim().toLowerCase(),
    normalizeDescription(row.description),
  ].join('|');
}

/** Stable identity used for de-duplication (unique per account in the database). */
export function rowFingerprint(accountId: string, row: ParsedRow, occurrence: number): string {
  const key = `${canonicalRowKey(accountId, row)}|${occurrence}`;
  return hex14(cyrb53(key, 0)) + hex14(cyrb53(key, 0x9e3779b9));
}

/** Fingerprints for every row of one statement, assigning occurrence indexes in row order. */
export function computeFingerprints(accountId: string, rows: readonly ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = canonicalRowKey(accountId, row);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return rowFingerprint(accountId, row, occurrence);
  });
}
