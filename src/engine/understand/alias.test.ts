import { describe, expect, it } from 'vitest';
import { SAVINGS, makeRule, run } from './testkit';

const swiggy = 'SWIGGY BANGALORE';

describe('merchant alias rules (set.merchantKey)', () => {
  it('replaces merchantKey and label and explains the merge', () => {
    const natural = run(swiggy, 'debit', { account: SAVINGS });
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: natural.merchantKey }, set: { merchantKey: 'food-apps', merchant: 'Food apps' } });
    const u = run(swiggy, 'debit', { ctx: { rules: [rule] } });
    expect(u.merchantKey).toBe('food-apps');
    expect(u.merchant).toBe('Food apps');
    expect(u.reasons).toContain('Grouped under Food apps (your merge)');
  });

  it('without a label keeps the natural label and names the alias key', () => {
    const natural = run(swiggy);
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: natural.merchantKey }, set: { merchantKey: 'food-apps' } });
    const u = run(swiggy, 'debit', { ctx: { rules: [rule] } });
    expect(u.merchantKey).toBe('food-apps');
    expect(u.merchant).toBe(natural.merchant);
    expect(u.reasons).toContain('Grouped under food-apps (your merge)');
  });

  it('merges inconsistent statement names into one key', () => {
    const rules = [makeRule({ match: { field: 'description', op: 'contains', value: 'swiggy' }, set: { merchantKey: 'swiggy-group' } })];
    const a = run('SWIGGY BANGALORE', 'debit', { ctx: { rules } });
    const b = run('SWIGGY INSTAMART BANGALORE', 'debit', { ctx: { rules } });
    expect(a.merchantKey).toBe('swiggy-group');
    expect(b.merchantKey).toBe('swiggy-group');
  });

  it('matches on the natural key only: an alias is never re-matched, so chains and loops cannot happen', () => {
    const natural = run(swiggy).merchantKey;
    const rules = [
      makeRule({ id: 'a', match: { field: 'merchantKey', op: 'equals', value: natural }, set: { merchantKey: 'group-a' } }),
      makeRule({ id: 'b', match: { field: 'merchantKey', op: 'equals', value: 'group-a' }, set: { merchantKey: 'group-b' } }),
    ];
    expect(run(swiggy, 'debit', { ctx: { rules } }).merchantKey).toBe('group-a');
  });

  it('respects disabled rules and leaves other merchants alone', () => {
    const natural = run(swiggy).merchantKey;
    const off = makeRule({ enabled: false, match: { field: 'merchantKey', op: 'equals', value: natural }, set: { merchantKey: 'x' } });
    expect(run(swiggy, 'debit', { ctx: { rules: [off] } }).merchantKey).toBe(natural);
    const on = makeRule({ match: { field: 'merchantKey', op: 'equals', value: natural }, set: { merchantKey: 'x' } });
    const other = run('STEAMGAMES.COM 425-9522985', 'debit', { ctx: { rules: [on] } });
    expect(other.merchantKey).not.toBe('x');
  });
});
