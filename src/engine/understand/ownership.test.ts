import { describe, expect, it } from 'vitest';
import { compareNames, findOwnByMask, findOwnByName, nameTokens, sameHolder } from './ownership';
import { CARD, SAVINGS, SECOND, makeAccount } from './testkit';

describe('sameHolder', () => {
  const holder = 'MADHAV KESHAV IYENGAR';
  const table: Array<[string, boolean]> = [
    ['MADHAV KESHAV IYENGAR', true],
    ['KESHAV IYENGAR MADHAV', true],
    ['MADHAV KESHAV IY', true], // truncated by the statement column
    ['KESHAV IY', true],
    ['M KESHAV IYENGAR', true], // initial
    ['MR MADHAV KESHAV IYENGAR', true], // title
    ['IYENGAR', false], // one token is never enough
    ['MADHAV', false], // a shared surname alone
    ['MADHAV GOPALAN', false],
    ['KESHAV RAO', false],
    ['SOMEONE ELSE', false],
    ['', false],
  ];
  it.each(table)('%j vs holder → %s', (name, expected) => {
    expect(sameHolder(name, holder)).toBe(expected);
  });

  it('reports coverage details', () => {
    const m = compareNames('KESHAV IY', holder);
    expect(m).toMatchObject({ matched: 2, strong: 1, cpCovered: true, holderCovered: false });
  });
});

describe('initials against the holder name', () => {
  const holder = 'VERMA ASHA KUMARI';
  const table: Array<[string, boolean, boolean]> = [
    // [counterparty, same holder, initials-only (weaker evidence)]
    ['Asha VK', true, true],
    ['ASHA K VERMA', true, false],
    ['A K VERMA', true, true],
    ['Verma A K', true, true],
    ['ASHA KV', true, true],
    ['Asha EV', false, false],
    ['Asha', false, false],
    ['VK', false, false],
    ['RAHUL VK', false, false],
    ['VERMA ASHA KUMARI', true, false],
  ];
  it.each(table)('%j: holder %s, initials-only %s', (name, same, initialsOnly) => {
    expect(sameHolder(name, holder)).toBe(same);
    expect(compareNames(name, holder).initialsOnly).toBe(initialsOnly && same);
  });

  it('keeps KUMARI as a name token when it is not the first word', () => {
    expect(nameTokens('Verma Asha Kumari')).toEqual(['VERMA', 'ASHA', 'KUMARI']);
    expect(nameTokens('Kumari Asha Verma')).toEqual(['ASHA', 'VERMA']);
  });
});

describe('findOwnByName / findOwnByMask', () => {
  it('finds the matching account by holder name', () => {
    expect(findOwnByName('KUMAR RAO ANIL', [SAVINGS, SECOND, CARD])?.account.id).toBe('savings');
    expect(findOwnByName('SOMEONE ELSE', [SAVINGS, SECOND, CARD])).toBeUndefined();
    expect(findOwnByName(undefined, [SAVINGS])).toBeUndefined();
  });

  it('skips accounts without a holder name', () => {
    const nameless = makeAccount('n', 'savings', '0001', null);
    expect(findOwnByName('ANIL KUMAR RAO', [nameless])).toBeUndefined();
  });

  it('finds an account by mask, honouring extra masks and the excluded account', () => {
    const withExtra = { ...CARD, extraMasks: ['5555'] };
    expect(findOwnByMask(['2468'], [SAVINGS, SECOND])?.account.id).toBe('second');
    expect(findOwnByMask(['5555'], [SAVINGS, withExtra])?.account.id).toBe('card');
    expect(findOwnByMask(['1357'], [SAVINGS, SECOND], 'savings')).toBeUndefined();
    expect(findOwnByMask([], [SAVINGS])).toBeUndefined();
  });
});
