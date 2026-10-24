/**
 * Own-account detection: does a counterparty name or an account/card mask printed in a description
 * belong to one of the user's accounts?
 */
import type { Account } from '@/domain/types';

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'SMT', 'SRI', 'SHRI', 'SHRIMATI', 'KUM', 'KUMARI', 'MASTER', 'DR', 'LATE']);

export function nameTokens(name: string): string[] {
  // titles only count at the start: "KUMARI" ends many women's names ("VERMA ASHA KUMARI")
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t, i) => i > 0 || !TITLES.has(t));
}

export interface NameMatch {
  matched: number;
  strong: number;
  cpCovered: boolean;
  holderCovered: boolean;
  /** True when exactly one name token matched in full and every other match is only an initial ("Asha VK"). */
  initialsOnly: boolean;
}

/**
 * Fuzzy token overlap tolerant of statement truncation ("KESHAV IY" vs "KESHAV IYNIKANT"),
 * reordered names and single-letter initials. Prefix matches are only trusted on the LAST token of the
 * counterparty name (where statements cut text off) or when the fragment is at least 4 letters long.
 */
export function compareNames(counterparty: string, holder: string): NameMatch {
  const cp = nameTokens(counterparty);
  const hold = nameTokens(holder);
  const used = new Set<number>();
  let matched = 0;
  let strong = 0;
  let initials = 0;
  const unmatched: string[] = [];
  cp.forEach((t, i) => {
    const isLast = i === cp.length - 1;
    let found = -1;
    let isStrong = false;
    let initialHit = false;
    for (let j = 0; j < hold.length && found < 0; j++) {
      if (used.has(j)) continue;
      const u = hold[j];
      if (t === u && t.length > 1) {
        found = j;
        isStrong = true;
      }
    }
    for (let j = 0; j < hold.length && found < 0; j++) {
      if (used.has(j)) continue;
      const u = hold[j];
      if (t.length >= 2 && u.startsWith(t) && (isLast || t.length >= 4)) {
        found = j;
        isStrong = t.length >= 4;
      } else if (u.length >= 4 && t.startsWith(u) && t.length > u.length) {
        found = j;
        isStrong = true;
      } else if (t.length === 1 && u[0] === t) {
        found = j;
        initialHit = true;
      } else if (u.length === 1 && t[0] === u) {
        found = j;
        initialHit = true;
      }
    }
    if (found >= 0) {
      used.add(found);
      matched++;
      if (isStrong) strong++;
      if (initialHit) initials++;
    } else {
      unmatched.push(t);
    }
  });
  // a cluster of initials: "VK" for the remaining holder tokens VERMA and KUMARI, in any order
  for (const t of unmatched) {
    if (t.length < 2 || t.length > 3) continue;
    const picks: number[] = [];
    for (const letter of t) {
      const j = hold.findIndex((u, idx) => !used.has(idx) && !picks.includes(idx) && u[0] === letter);
      if (j < 0) break;
      picks.push(j);
    }
    if (picks.length === t.length) {
      for (const j of picks) used.add(j);
      matched++;
      initials++;
    }
  }
  return {
    matched,
    strong,
    cpCovered: cp.length > 0 && matched === cp.length,
    holderCovered: hold.length > 0 && used.size === hold.length,
    initialsOnly: strong === 1 && matched >= 2 && matched === strong + initials,
  };
}

/** True when `counterparty` plausibly is `holder`. Needs ≥ 2 matching tokens, so a shared surname never matches. */
export function sameHolder(counterparty: string, holder: string): boolean {
  const m = compareNames(counterparty, holder);
  return m.strong >= 1 && m.matched >= 2 && (m.cpCovered || m.holderCovered);
}

export interface OwnHit {
  account: Account;
  how: 'name' | 'initials' | 'mask' | 'handle';
}

export function findOwnByName(name: string | undefined, accounts: readonly Account[]): OwnHit | undefined {
  if (!name) return undefined;
  for (const a of accounts) {
    if (!a.holderName) continue;
    if (sameHolder(name, a.holderName)) return { account: a, how: compareNames(name, a.holderName).initialsOnly ? 'initials' : 'name' };
  }
  return undefined;
}

export function findOwnByMask(masks: readonly string[], accounts: readonly Account[], excludeId?: string): OwnHit | undefined {
  if (masks.length === 0) return undefined;
  for (const a of accounts) {
    if (a.id === excludeId) continue;
    const mine = [a.mask, ...(a.extraMasks ?? [])].filter((x): x is string => !!x);
    if (masks.some((m) => mine.includes(m))) return { account: a, how: 'mask' };
  }
  return undefined;
}

const COMMON_SURNAMES = new Set(['kumar', 'singh', 'devi', 'rao', 'reddy', 'sharma', 'kaur', 'das', 'shah', 'khan', 'patel', 'gupta', 'nair', 'iyer', 'iyengar', 'naidu', 'varma', 'verma', 'mohammed', 'mohammad', 'begum']);

/**
 * A UPI handle that spells the holder's own name ("ashaverma92-1@okaxis", "verma.asha@ybl" for holder
 * "ASHA VERMA"): at least two distinct name tokens of 3+ letters appear in the handle, and one of them is
 * not a bare common surname. Weaker evidence than a printed payee name, so callers keep it reviewable.
 */
export function findOwnByHandle(local: string, accounts: readonly Account[]): OwnHit | undefined {
  const letters = local.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length < 6 || /^(?:91)?[6-9]\d{9}$/.test(local)) return undefined;
  for (const a of accounts) {
    if (!a.holderName) continue;
    const tokens = [...new Set(nameTokens(a.holderName).map((t) => t.toLowerCase()).filter((t) => t.length >= 3))];
    if (tokens.length < 2) continue;
    const matched = tokens.filter((t) => letters.includes(t));
    if (matched.length >= 2 && matched.some((t) => !COMMON_SURNAMES.has(t))) return { account: a, how: 'handle' };
  }
  return undefined;
}
