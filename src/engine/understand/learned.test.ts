import { describe, expect, it } from 'vitest';
import { isLearnedModelUsable, trainLearnedModel, type LearningExample } from './index';
import { CARD, run } from './testkit';

function examples(category: string, key: string, count: number, extra = ''): LearningExample[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `UPI-41234567${1000 + i}-${key.toUpperCase()} ${extra} IN`.replace(/\s+/g, ' '),
    merchantKey: key,
    category,
  }));
}

describe('learned model', () => {
  it('returns null with too few examples', () => {
    expect(trainLearnedModel([])).toBeNull();
    expect(trainLearnedModel([...examples('fitness', 'zyntrax quolix', 3), ...examples('education', 'morvik plento', 4)])).toBeNull();
  });

  it('returns null when the examples cover a single category', () => {
    expect(trainLearnedModel(examples('fitness', 'zyntrax quolix', 12))).toBeNull();
  });

  it('ignores uncategorized examples', () => {
    const noise = examples('uncategorized', 'ignored thing', 20);
    expect(trainLearnedModel([...noise, ...examples('fitness', 'zyntrax quolix', 3)])).toBeNull();
  });

  const trained = trainLearnedModel([...examples('fitness', 'zyntrax quolix', 5), ...examples('education', 'morvik plento', 5)]);

  it('trains a JSON-serialisable model', () => {
    expect(trained).not.toBeNull();
    expect(trained!.version).toBe(2);
    expect(trained!.exampleCount).toBe(10);
    const roundTripped = JSON.parse(JSON.stringify(trained));
    expect(roundTripped).toEqual(trained);
    expect(isLearnedModelUsable(roundTripped)).toBe(true);
    expect(isLearnedModelUsable(null)).toBe(false);
    expect(isLearnedModelUsable({ version: 1, trainedAt: '', exampleCount: 3 })).toBe(false);
  });

  it('is used for merchants nothing else recognises, as source "learned" with probability × 0.9', () => {
    const u = run('ZYNTRAX QUOLIX CHENNAI', 'debit', { account: CARD, ctx: { learned: trained } });
    expect(u.category).toBe('fitness');
    expect(u.categorySource).toBe('learned');
    expect(u.confidence).toBeGreaterThan(0.6);
    expect(u.confidence).toBeLessThanOrEqual(0.9);
    expect(u.reasons.join(' ')).toMatch(/Learned from your earlier choices|categorised this merchant before/);
    expect(run('MORVIK PLENTO PUNE', 'debit', { account: CARD, ctx: { learned: trained } }).category).toBe('education');
  });

  it('abstains when it has never seen any of the tokens', () => {
    const u = run('QQQQ WWWW EEEE', 'debit', { account: CARD, ctx: { learned: trained } });
    expect(u.category).toBe('uncategorized');
    expect(u.categorySource).toBe('none');
  });

  it('abstains below 60% probability', () => {
    const ambiguous = trainLearnedModel([...examples('fitness', 'zyntrax quolix', 5, 'qwerty'), ...examples('education', 'morvik plento', 5, 'qwerty')]);
    expect(ambiguous).not.toBeNull();
    const u = run('QWERTY', 'debit', { account: CARD, ctx: { learned: ambiguous } });
    expect(u.categorySource).toBe('none');
  });

  it('never outranks a brand, a keyword or a user rule', () => {
    const wrong = trainLearnedModel([...examples('education', 'swiggy', 6), ...examples('fitness', 'morvik plento', 6)]);
    expect(run('SWIGGY BANGALORE', 'debit', { account: CARD, ctx: { learned: wrong } })).toMatchObject({ category: 'food_dining', categorySource: 'builtin_rule' });
    expect(run('TEA POINT', 'debit', { account: CARD, ctx: { learned: wrong } }).categorySource).toBe('builtin_rule');
  });

  it('only proposes consumption categories for spending', () => {
    const income = trainLearnedModel([...examples('salary', 'zyntrax quolix', 6), ...examples('education', 'morvik plento', 6)]);
    const u = run('ZYNTRAX QUOLIX', 'debit', { account: CARD, ctx: { learned: income } });
    expect(u.category).not.toBe('salary');
  });

  it('does not recategorise structural kinds (salary stays salary)', () => {
    const u = run('NEFT SALARY', 'credit', { ctx: { learned: trained } });
    expect(u.category).toBe('salary');
  });
});
