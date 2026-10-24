import { describe, expect, it } from 'vitest';
import type { CategorySource, FeedbackEvent, Transaction, TxnKind } from '@/domain/types';
import { buildCalibration, reviewPriority, suggestCategories, trainLearnedModel, type LearningExample } from './index';
import { similarMerchants } from './learned';
import { calibrateConfidence, MIN_BUCKET_EVENTS } from './selftrain';
import { CARD, SAVINGS, SECOND, ctxFor, makeRule, makeTxn, run } from './testkit';

let seq = 0;
function event(
  source: CategorySource,
  category: string,
  kept: boolean,
  opts: { confidence?: number; action?: FeedbackEvent['action']; kind?: TxnKind } = {},
): FeedbackEvent {
  seq += 1;
  const kind = opts.kind ?? 'expense';
  return {
    id: `e${seq}`,
    at: '2024-06-01T00:00:00.000Z',
    txnId: `t${seq}`,
    merchantKey: 'm',
    action: opts.action ?? (kept ? 'confirm' : 'category'),
    scope: 'this',
    before: { kind, category, categorySource: source, kindSource: 'rule', confidence: opts.confidence ?? 0.6 },
    after: { kind, category: kept ? category : 'gifts_donations' },
  };
}

const many = (n: number, make: () => FeedbackEvent) => Array.from({ length: n }, make);

describe('buildCalibration', () => {
  it('returns null when there is nothing to learn from', () => {
    expect(buildCalibration([])).toBeNull();
    expect(buildCalibration([event('user_rule', 'shopping', true), event('none', 'uncategorized', false)])).toBeNull();
    expect(buildCalibration([event('builtin_rule', 'shopping', false, { action: 'merchant' }), event('builtin_rule', 'shopping', false, { action: 'reset' })])).toBeNull();
  });

  it('is serialisable and carries its provenance', () => {
    const cal = buildCalibration(many(6, () => event('builtin_rule', 'food_dining', true)));
    expect(cal).not.toBeNull();
    expect(cal!.version).toBe(1);
    expect(cal!.eventCount).toBe(6);
    expect(JSON.parse(JSON.stringify(cal))).toEqual(cal);
  });
});

describe('calibration adjusts confidence', () => {
  const keyword = 'TEA POINT HYDERABAD';
  const overridden = buildCalibration(many(8, () => event('builtin_rule', 'food_dining', false, { confidence: 0.6 })));
  const kept = buildCalibration(many(20, () => event('builtin_rule', 'food_dining', true, { confidence: 0.6 })));

  it('leaves confidence alone below the minimum number of events', () => {
    const few = buildCalibration(many(MIN_BUCKET_EVENTS - 1, () => event('builtin_rule', 'food_dining', false)));
    expect(run(keyword, 'debit', { account: CARD, ctx: { calibration: few } }).confidence).toBe(0.6);
  });

  it('stops trusting a source the user keeps overriding, and sends it to review', () => {
    const before = run(keyword, 'debit', { account: CARD });
    const after = run(keyword, 'debit', { account: CARD, ctx: { calibration: overridden } });
    expect(before.confidence).toBe(0.6);
    expect(before.needsReview).toBe(false);
    expect(after.confidence).toBeLessThan(0.6);
    expect(after.confidence).toBeGreaterThanOrEqual(0.3); // bounded at half
    expect(after.needsReview).toBe(true);
    expect(after.reviewReasons.join(' ')).toMatch(/Low confidence/);
    expect(after.reasons.join(' ')).toMatch(/0 of 8 guesses/);
  });

  it('trusts a reliable source a little more, within bounds', () => {
    const after = run(keyword, 'debit', { account: CARD, ctx: { calibration: kept } });
    expect(after.confidence).toBeGreaterThan(0.6);
    expect(after.confidence).toBeLessThanOrEqual(0.6 * 1.15 + 0.001);
  });

  it('is specific to the category: overriding food does not lower shopping', () => {
    const brand = run('FLIPKART INTERNET BANGALORE', 'debit', { account: CARD, ctx: { calibration: overridden } });
    expect(brand.category).toBe('shopping');
    expect(brand.confidence).toBe(0.9);
  });

  it('falls back to the source×band bucket, then the source', () => {
    const cal = buildCalibration(many(10, () => event('builtin_rule', 'groceries', false, { confidence: 0.9 })));
    // brand decisions (band high) for another category inherit the high-band history
    const brand = run('FLIPKART INTERNET BANGALORE', 'debit', { account: CARD, ctx: { calibration: cal } });
    expect(brand.confidence).toBeLessThan(0.9);
    expect(brand.confidence).toBeGreaterThanOrEqual(0.45);
  });

  it('never touches decisions the user made (rules)', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'tea point' }, set: { category: 'food_dining' } });
    const u = run(keyword, 'debit', { account: CARD, ctx: { calibration: overridden, rules: [rule] } });
    expect(u.confidence).toBe(0.98);
  });

  it('never moves a zero confidence', () => {
    expect(calibrateConfidence(overridden, 'none', 'uncategorized', 0)).toMatchObject({ confidence: 0, factor: 1 });
    expect(calibrateConfidence(overridden, 'builtin_rule', 'food_dining', 0)).toMatchObject({ confidence: 0, factor: 1 });
  });

  it('caps at 0.99', () => {
    const cal = buildCalibration(many(50, () => event('builtin_rule', 'shopping', true, { confidence: 0.9 })));
    expect(calibrateConfidence(cal, 'builtin_rule', 'shopping', 0.98).confidence).toBeLessThanOrEqual(0.99);
  });

  it('a confirm counts as kept and a kind change counts as overridden', () => {
    const mixed = buildCalibration([
      ...many(5, () => event('kind_default', 'sent_to_people', true, { kind: 'p2p_out' })),
      ...many(5, () => ({ ...event('kind_default', 'sent_to_people', true, { kind: 'p2p_out' }), action: 'kind' as const, after: { kind: 'expense' as const, category: 'sent_to_people' } })),
    ]);
    const p2p = run('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', { ctx: { calibration: mixed } });
    // half of the p2p defaults were kept → confidence is lowered but the decision is unchanged
    expect(p2p.kind).toBe('p2p_out');
    expect(p2p.confidence).toBeLessThan(0.6);
  });
});

// ─── suggestions ─────────────────────────────────────────────────────────────────────────────────

function example(key: string, category: string, i: number, vpa?: string): LearningExample {
  return { text: `UPI-41234567${1000 + i}-${key.toUpperCase()} IN`, merchantKey: key, category, vpa, amount: 15_000, direction: 'debit' };
}

const model = trainLearnedModel([
  ...Array.from({ length: 5 }, (_, i) => example('zyntrax quolix', 'fitness', i)),
  ...Array.from({ length: 5 }, (_, i) => example('morvik plento', 'education', i)),
  ...Array.from({ length: 3 }, (_, i) => example('q987654321', 'groceries', i, 'q987654321@ybl')),
  ...Array.from({ length: 3 }, (_, i) => example('kovela marlet hub', 'food_dining', i)),
]);

function txnFor(description: string, over: Partial<Transaction> = {}): Transaction {
  return makeTxn({ accountId: CARD.id, direction: 'debit', amount: 15_000, date: '2024-06-10', rawDescription: description, merchantKey: '', merchant: '', kind: 'expense', ...over });
}

describe('suggestCategories', () => {
  it('puts the dictionary answer first for a known brand and always returns distinct categories', () => {
    const t = txnFor('SWIGGY BANGALORE', { merchantKey: 'swiggy', merchant: 'Swiggy' });
    const out = suggestCategories(t, ctxFor(CARD, { learned: model }), 3);
    expect(out[0]).toMatchObject({ category: 'food_dining', source: 'builtin_rule' });
    expect(out[0].probability).toBeGreaterThanOrEqual(0.9);
    expect(new Set(out.map((s) => s.category)).size).toBe(out.length);
    expect(out.length).toBeLessThanOrEqual(3);
    for (const s of out) {
      expect(s.probability).toBeGreaterThan(0);
      expect(s.probability).toBeLessThanOrEqual(0.99);
      expect(s.reason.length).toBeGreaterThan(5);
    }
    for (let i = 1; i < out.length; i++) expect(out[i - 1].probability).toBeGreaterThanOrEqual(out[i].probability);
  });

  it('prefers the user rule above everything', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'gifts_donations' } });
    const t = txnFor('SWIGGY BANGALORE', { merchantKey: 'swiggy', merchant: 'Swiggy' });
    const out = suggestCategories(t, ctxFor(CARD, { rules: [rule], learned: model }), 3);
    expect(out[0]).toMatchObject({ category: 'gifts_donations', source: 'user_rule' });
    expect(out[0].probability).toBeGreaterThanOrEqual(0.98);
    expect(out.map((s) => s.category)).toContain('food_dining');
  });

  it('uses exact memory for a UPI handle the user already taught', () => {
    const t = txnFor('UPI~412345678990~Q987654321@ybl~RAMESH GO -AXL1', {
      accountId: SECOND.id,
      merchantKey: 'q987654321',
      counterparty: { type: 'merchant', vpa: 'q987654321@ybl' },
    });
    const out = suggestCategories(t, ctxFor(SECOND, { learned: model }), 3);
    expect(out[0]).toMatchObject({ category: 'groceries', source: 'learned' });
    expect(out[0].reason).toMatch(/handle/);
  });

  it('suggests from the statistical model with a probability and a plain reason', () => {
    const t = txnFor('UPI-412345678999-ZYNTRAX QUOLIX CHENNAI IN', { merchantKey: 'zyntrax quolix chennai' });
    const out = suggestCategories(t, ctxFor(CARD, { learned: model }), 2);
    expect(out[0].category).toBe('fitness');
    expect(out[0].source).toBe('learned');
  });

  it('finds similar merchants the user has taught (token overlap) and suggests their category', () => {
    const near = similarMerchants(model, 'kovela marlet corner');
    expect(near[0]).toMatchObject({ key: 'kovela marlet hub', category: 'food_dining' });
    expect(near[0].overlap).toBeGreaterThan(0.3);
    expect(similarMerchants(model, 'nothing in common')).toEqual([]);
    const t = txnFor('UPI-412345678999-KOVELA MARLET CORNER IN', { merchantKey: 'kovela marlet corner' });
    expect(suggestCategories(t, ctxFor(CARD, { learned: model }), 3).map((s) => s.category)).toContain('food_dining');
  });

  it('falls back to the kind default when nothing else knows the merchant', () => {
    const t = txnFor('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', { accountId: SAVINGS.id, kind: 'p2p_out', merchantKey: 'priya menon', counterparty: { type: 'person', vpa: 'priya.menon@okaxis' } });
    const out = suggestCategories(t, ctxFor(SAVINGS), 3);
    expect(out.map((s) => s.category)).toContain('sent_to_people');
  });

  it('returns nothing only when k is 0', () => {
    const t = txnFor('ZZQ UNKNOWN SHOP', { merchantKey: 'zzq unknown shop' });
    expect(suggestCategories(t, ctxFor(CARD, { learned: model }), 0)).toEqual([]);
  });

  describe('weak signals still produce suggestions', () => {
    const shop = (amount: number, over: Partial<Transaction> = {}) =>
      txnFor('UPI/412345678868/NA/zzqshop@ybl/Axis Bank/AXL1', { accountId: SAVINGS.id, amount, merchantKey: 'zzqshop', merchant: 'Zzqshop', counterparty: { type: 'merchant', vpa: 'zzqshop@ybl' }, ...over });

    it('falls back to a fixed prior for small UPI payments, honestly labelled and low', () => {
      const out = suggestCategories(shop(8_000), ctxFor(SAVINGS), 3);
      expect(out).toHaveLength(3);
      expect(out.map((s) => s.category)).toEqual(['food_dining', 'groceries', 'transport']);
      for (const s of out) {
        expect(s.source).toBe('kind_default');
        expect(s.probability).toBeLessThanOrEqual(0.2);
        expect(s.reason).toBe('Common for small UPI payments');
      }
    });

    it('the prior depends on the amount', () => {
      expect(suggestCategories(shop(250_000), ctxFor(SAVINGS), 2).map((s) => s.category)).toEqual(['groceries', 'shopping']);
      expect(suggestCategories(shop(2_500_000), ctxFor(SAVINGS), 3).map((s) => s.category)).toEqual(['shopping', 'healthcare', 'travel']);
    });

    it('prefers what the user usually does at a similar amount over the fixed prior', () => {
      const history = [
        ...Array.from({ length: 6 }, () => ({ category: 'transport', amount: 9_000, kind: 'expense' as const, categorySource: 'user_rule' as const, channel: 'UPI' as const })),
        ...Array.from({ length: 2 }, () => ({ category: 'fitness', amount: 9_000, kind: 'expense' as const, categorySource: 'learned' as const, channel: 'UPI' as const })),
        ...Array.from({ length: 9 }, () => ({ category: 'rent_housing', amount: 5_000_000, kind: 'expense' as const, categorySource: 'user_rule' as const, channel: 'UPI' as const })),
        { category: 'uncategorized', amount: 9_000, kind: 'expense' as const, categorySource: 'none' as const },
        { category: 'salary', amount: 9_000, kind: 'income' as const, categorySource: 'builtin_rule' as const },
      ];
      const out = suggestCategories(shop(8_000), ctxFor(SAVINGS), 3, history);
      expect(out[0]).toMatchObject({ category: 'transport', source: 'similar_merchant' });
      expect(out[0].reason).toMatch(/6 of your 8 similar-sized payments/);
      expect(out.map((s) => s.category)).toContain('fitness');
      expect(out.map((s) => s.category)).not.toContain('rent_housing');
      expect(out.map((s) => s.category)).not.toContain('salary');
      expect(out[0].probability).toBeLessThanOrEqual(0.35);
    });

    it('the history argument is optional and the 3-argument call is unchanged', () => {
      expect(suggestCategories(shop(8_000), ctxFor(SAVINGS), 3, undefined)).toEqual(suggestCategories(shop(8_000), ctxFor(SAVINGS), 3));
      expect(suggestCategories(shop(8_000), ctxFor(SAVINGS, { learned: model }))).toHaveLength(3);
    });

    it('guesses from a cut-off word before the generic prior', () => {
      const t = txnFor('UPI-412345678999-RAMA SWEE IN', { merchantKey: 'rama swee', merchant: 'Rama Swee', kind: 'p2p_out' });
      const out = suggestCategories(t, ctxFor(CARD), 4);
      expect(out.map((s) => s.category)).toContain('food_dining');
    });

    it('real signals are never displaced by the fallbacks', () => {
      const t = txnFor('SWIGGY BANGALORE', { merchantKey: 'swiggy', merchant: 'Swiggy' });
      const out = suggestCategories(t, ctxFor(CARD), 3);
      expect(out[0]).toMatchObject({ category: 'food_dining', source: 'builtin_rule' });
      expect(out.length).toBe(3);
      expect(out.slice(1).every((s) => s.probability < out[0].probability)).toBe(true);
    });

    it('non-spending kinds never receive spending priors', () => {
      const t = txnFor('NEFT SALARY', { accountId: SAVINGS.id, direction: 'credit', kind: 'income' });
      expect(suggestCategories(t, ctxFor(SAVINGS), 5).map((s) => s.category)).not.toContain('food_dining');
    });
  });

  it('non-spending kinds only get categories that fit them', () => {
    const salary = txnFor('NEFT SALARY', { accountId: SAVINGS.id, direction: 'credit', kind: 'income' });
    const out = suggestCategories(salary, ctxFor(SAVINGS, { learned: model }), 3);
    expect(out.map((s) => s.category)).toEqual(expect.arrayContaining(['other_income']));
    expect(out.map((s) => s.category)).not.toContain('food_dining');
    const transfer = txnFor('X', { kind: 'self_transfer', accountId: SAVINGS.id });
    expect(suggestCategories(transfer, ctxFor(SAVINGS), 3).map((s) => s.category)).toEqual(['self_transfer']);
  });

  it('agreeing signals reinforce each other', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'food_dining' } });
    const t = txnFor('SWIGGY BANGALORE', { merchantKey: 'swiggy', merchant: 'Swiggy' });
    const out = suggestCategories(t, ctxFor(CARD, { rules: [rule] }), 3);
    expect(out[0]).toMatchObject({ category: 'food_dining', source: 'user_rule' });
    expect(out[0].reason).toMatch(/agree/);
    expect(out[0].probability).toBeGreaterThan(0.98);
  });
});

// ─── review priority ─────────────────────────────────────────────────────────────────────────────

function pending(id: string, amount: number, over: Partial<Transaction> = {}): Transaction {
  return makeTxn({ id, accountId: CARD.id, direction: 'debit', amount, date: '2024-06-10', kind: 'expense', confidence: 0, needsReview: true, reviewReasons: ['No category matched'], merchantKey: id, ...over });
}

describe('reviewPriority', () => {
  it('ignores transactions that do not need review', () => {
    expect(reviewPriority([pending('a', 1_000, { needsReview: false })])).toEqual([]);
  });

  it('ranks by amount × uncertainty × (1 + rows sharing the merchant)', () => {
    const items = reviewPriority([
      pending('big', 500_000, { confidence: 0.5 }), // 5000 × 0.5 = 2500
      pending('s1', 20_000, { merchantKey: 'shop' }),
      pending('s2', 20_000, { merchantKey: 'shop' }),
      pending('s3', 20_000, { merchantKey: 'shop' }),
      pending('s4', 20_000, { merchantKey: 'shop' }), // 200 × 1 × 4 = 800 each
      pending('small', 10_000),
    ]);
    expect(items[0].txnId).toBe('big');
    expect(items[0].score).toBe(2500);
    expect(items.slice(1, 5).map((i) => i.txnId).sort()).toEqual(['s1', 's2', 's3', 's4']);
    expect(items[1].score).toBe(800);
    expect(items[1].sameMerchantCount).toBe(3);
    expect(items[items.length - 1].txnId).toBe('small');
  });

  it('lets many small rows outrank one medium row ("fixing this fixes 11 more")', () => {
    const rows = Array.from({ length: 12 }, (_, i) => pending(`q${i}`, 30_000, { merchantKey: 'q987654321' }));
    const items = reviewPriority([pending('medium', 200_000), ...rows]);
    expect(items[0].sameMerchantCount).toBe(11);
    expect(items[0].reason).toMatch(/fixing it also fixes 11 more/);
    expect(items[0].txnId.startsWith('q')).toBe(true);
  });

  it('groups by UPI handle even when the merchant keys differ', () => {
    const items = reviewPriority([
      pending('a', 50_000, { merchantKey: 'ramesh go', counterparty: { type: 'merchant', vpa: 'Q987654321@ybl' } }),
      pending('b', 50_000, { merchantKey: 'ramesh gowda', counterparty: { type: 'merchant', vpa: 'q987654321@ybl' } }),
      pending('c', 50_000, { merchantKey: 'someone else' }),
    ]);
    const a = items.find((i) => i.txnId === 'a')!;
    expect(a.sameMerchantCount).toBe(1);
    expect(items.find((i) => i.txnId === 'c')!.sameMerchantCount).toBe(0);
  });

  it('treats an unknown kind as fully uncertain and breaks ties deterministically', () => {
    const items = reviewPriority([
      pending('b', 10_000, { kind: 'unknown', confidence: 0.9 }),
      pending('a', 10_000, { kind: 'unknown', confidence: 0.9 }),
    ]);
    expect(items.map((i) => i.txnId)).toEqual(['a', 'b']);
    expect(items[0].score).toBe(100);
  });

  it('does not mutate its input', () => {
    const input = [pending('a', 1_000), pending('b', 2_000)];
    const snapshot = JSON.stringify(input);
    reviewPriority(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
