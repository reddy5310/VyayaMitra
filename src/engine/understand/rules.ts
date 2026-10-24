/**
 * User rules: matching and selection. User rules always outrank built-in knowledge.
 */
import type { Counterparty, Direction, UserRule } from '@/domain/types';

export interface RuleTarget {
  accountId: string;
  direction: Direction;
  merchantKey: string;
  counterparty: Counterparty;
  rawDescription: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Does a user rule apply to this (already understood) transaction? */
export function ruleMatches(rule: UserRule, txn: RuleTarget): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== txn.accountId) return false;
  if (rule.direction && rule.direction !== txn.direction) return false;
  const wanted = norm(rule.match.value);
  if (!wanted) return false;
  let candidate: string | undefined;
  switch (rule.match.field) {
    case 'merchantKey':
      candidate = txn.merchantKey;
      break;
    case 'vpa':
      candidate = txn.counterparty.vpa;
      break;
    case 'description':
      candidate = txn.rawDescription;
      break;
  }
  if (!candidate) return false;
  const have = norm(candidate);
  return rule.match.op === 'equals' ? have === wanted : have.includes(wanted);
}

function specificity(rule: UserRule): number {
  const field = rule.match.field === 'vpa' ? 3 : rule.match.field === 'merchantKey' ? 2 : 1;
  const op = rule.match.op === 'equals' ? 10 : 0;
  return op + field * 2 + (rule.accountId ? 1 : 0) + (rule.direction ? 1 : 0);
}

export interface RuleDecision {
  kind?: { value: NonNullable<UserRule['set']['kind']>; rule: UserRule };
  category?: { value: string; rule: UserRule };
  merchant?: { value: string; rule: UserRule };
  /** Merchant alias (UserRule.set.merchantKey): group under this key. Matched on the natural key only. */
  alias?: { value: string; rule: UserRule };
}

/** Most specific matching rule wins per field (kind / category / merchant); ties go to the earlier rule. */
export function selectRules(rules: readonly UserRule[], txn: RuleTarget): RuleDecision {
  const hits = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => ruleMatches(rule, txn))
    .sort((a, b) => specificity(b.rule) - specificity(a.rule) || a.index - b.index);
  const out: RuleDecision = {};
  for (const { rule } of hits) {
    if (!out.kind && rule.set.kind) out.kind = { value: rule.set.kind, rule };
    if (!out.category && rule.set.category) out.category = { value: rule.set.category, rule };
    if (!out.merchant && rule.set.merchant) out.merchant = { value: rule.set.merchant, rule };
    if (!out.alias && rule.set.merchantKey?.trim()) out.alias = { value: rule.set.merchantKey.trim(), rule };
  }
  return out;
}
