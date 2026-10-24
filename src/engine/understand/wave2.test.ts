import { describe, expect, it } from 'vitest';
import { normalizeMerchantKey, trainLearnedModel, type LearningExample } from './index';
import { predict, recall, rank, featurize, handleKey } from './learned';
import { dropTruncatedTail, repairFragments } from './text';
import { understand } from './index';
import { CARD, SECOND, SAVINGS, ctxFor, makeAccount, makeRule, run } from './testkit';

describe('truncated names (fixed-width name columns)', () => {
  const keys: Array<[string, string]> = [
    ['SRI KRISHNA TIFFIN C', 'sri krishna tiffin'],
    ['SRI KRISHNA TIFFIN C IN', 'sri krishna tiffin'],
    ['SRI SAI TEA H', 'sri sai tea'],
    ['KRISHNA BAKERY', 'krishna bakery'],
    ['H&M', 'h and m'],
  ];
  it.each(keys)('merchantKey drops a cut-off tail: %j → %j', (input, expected) => {
    expect(normalizeMerchantKey(input)).toBe(expected);
  });

  it('keeps the visible tail in the display name', () => {
    const u = run('UPI-412345678991-SRI KRISHNA TIFFIN C IN', 'debit', { account: CARD });
    expect(u.merchant).toBe('Sri Krishna Tiffin C');
    expect(u.merchantKey).toBe('sri krishna tiffin');
  });

  it('the same merchant keeps one key whether the bank cut it early or late', () => {
    const early = run('UPI-412345678991-SRI KRISHNA TIFFIN C IN', 'debit', { account: CARD });
    const late = run('UPI-412345678992-SRI KRISHNA TIFFIN CE IN', 'debit', { account: CARD });
    expect(early.merchantKey).toBe(late.merchantKey);
  });

  it('never glues a FINAL fragment onto an unknown word, but still repairs a mid-name wrap', () => {
    expect(repairFragments('PRABHAVAT I')).toBe('PRABHAVAT I');
    expect(repairFragments('RAMALAXM I NAGAR')).toBe('RAMALAXMI NAGAR');
    expect(repairFragments('ASTER PH ARMACY')).toBe('ASTER PHARMACY'); // known word: joined even at the end
    expect(repairFragments('ASTER ZORMAC Y')).toBe('ASTER ZORMAC Y');
  });

  it('dropTruncatedTail is conservative and idempotent', () => {
    expect(dropTruncatedTail('tiffin c')).toBe('tiffin');
    expect(dropTruncatedTail('tiffin')).toBe('tiffin');
    expect(dropTruncatedTail('h and m')).toBe('h and m');
    expect(dropTruncatedTail('p k bakers')).toBe('p k bakers');
    expect(dropTruncatedTail('a b')).toBe('a b'); // nothing substantial left to anchor on
    expect(dropTruncatedTail('hotel in')).toBe('hotel in'); // real short words stay
    expect(dropTruncatedTail(dropTruncatedTail('sai ganesh te'))).toBe(dropTruncatedTail('sai ganesh te'));
  });
});

describe('cut-off keywords are matched on prefix with lower confidence', () => {
  const table: Array<[string, string, string]> = [
    ['RAMA SWEE', 'food_dining', 'sweets'],
    ['SRI LAKSHMI PARLOU', 'personal_care', 'parlour'],
    ['NEW MEDICA', 'healthcare', 'medical'],
    ['ANNAPURNA FILTE', 'food_dining', 'filter coffee'],
    ['RAMU KIRAN', 'groceries', 'kirana'],
    ['SAI TIFFI', 'food_dining', 'tiffin'],
    ['KRISHNA RESTAU', 'food_dining', 'restaurant'],
  ];
  it.each(table)('%s → %s', (merchant, category) => {
    const u = run(`UPI-412345678993-${merchant} IN`, 'debit', { account: CARD });
    expect(u.category).toBe(category);
    expect(u.categorySource).toBe('builtin_rule');
    expect(u.confidence).toBe(0.55);
    expect(u.needsReview).toBe(true); // suggested, still reviewed
    expect(u.reasons.join(' ')).toMatch(/Cut-off name/);
  });

  it('a whole keyword stays at 0.6 and is not reviewed', () => {
    const u = run('UPI-412345678993-RAMA SWEETS IN', 'debit', { account: CARD });
    expect(u).toMatchObject({ category: 'food_dining', confidence: 0.6, needsReview: false });
  });

  it('is not triggered by ordinary words that merely start like a keyword', () => {
    for (const merchant of ['SOME TEXT', 'ZZQ HOSP', 'ACME REST', 'PLAN']) {
      expect(run(`UPI-412345678993-${merchant} IN`, 'debit', { account: CARD }).categorySource).not.toBe('builtin_rule');
    }
  });

  it('a prefix ambiguous between categories is ignored', () => {
    expect(run('UPI-412345678993-ACME ELEC IN', 'debit', { account: CARD }).categorySource).toBe('none');
  });

  it('is never used for person-to-person payments', () => {
    const u = run('UPI/412345678868/NA/kiran.kumar@okaxis/Axis Bank/AXL1', 'debit');
    expect(u.kind).toBe('p2p_out');
    expect(u.category).toBe('sent_to_people');
  });

  it('the learned model can confirm a prefix guess and lift it over the review bar', () => {
    const examples: LearningExample[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ text: `UPI-41234567${i}-RAMU KIRANA`, merchantKey: 'ramu kirana', category: 'groceries' })),
      ...Array.from({ length: 6 }, (_, i) => ({ text: `UPI-41234568${i}-ZYNTRAX QUOLIX`, merchantKey: 'zyntrax quolix', category: 'fitness' })),
    ];
    const learned = trainLearnedModel(examples);
    const u = run('UPI-412345678993-RAMU KIRAN IN', 'debit', { account: CARD, ctx: { learned } });
    expect(u.category).toBe('groceries');
    expect(u.confidence).toBeGreaterThanOrEqual(0.55);
  });
});

describe('shop QR codes are remembered by their handle', () => {
  const QR = 'q987654321@ybl';
  const dbs = (name: string) => `UPI~412345678990~Q987654321@ybl~${name} -AXLe1b2c3d4e5f60718293a4b5c6db`;
  const icici = 'UPI/412345678991/NA/Q987654321@ybl/Yes Bank Ltd/YBL1a2b3c4d5e6f7a8b9c';

  it('keys the merchant on the handle, so every bank and every truncation share one key', () => {
    const keys = [run(dbs('RAMESH GOWDA'), 'debit', { account: SECOND }), run(dbs('RAMESH GO'), 'debit', { account: SECOND }), run(icici, 'debit')].map((u) => u.merchantKey);
    expect(new Set(keys)).toEqual(new Set(['q987654321']));
  });

  it('one user rule on that key teaches every future payment to the QR', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'q987654321' }, set: { category: 'groceries' } });
    for (const [desc, account] of [[dbs('RAMESH GOWDA'), SECOND], [dbs('RAMESH GO'), SECOND], [icici, SAVINGS]] as const) {
      const u = run(desc, 'debit', { account, ctx: { rules: [rule] } });
      expect(u).toMatchObject({ category: 'groceries', categorySource: 'user_rule', kind: 'expense' });
    }
  });

  it('a rule on the VPA field works too', () => {
    const rule = makeRule({ match: { field: 'vpa', op: 'equals', value: QR }, set: { category: 'groceries' } });
    expect(run(icici, 'debit', { ctx: { rules: [rule] } }).category).toBe('groceries');
  });

  it('the learned model remembers the handle (exact memory outranks keywords)', () => {
    const examples: LearningExample[] = [
      ...Array.from({ length: 3 }, (_, i) => ({ text: `x${i}`, merchantKey: 'q987654321', category: 'groceries', vpa: QR, amount: 20_000, direction: 'debit' as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ text: `UPI-41234567${i}-MORVIK PLENTO`, merchantKey: 'morvik plento', category: 'education' })),
    ];
    const learned = trainLearnedModel(examples);
    // the printed name says "BAKERY" (a food keyword), but the user already taught this handle
    const u = run(dbs('RAMESH BAKERY'), 'debit', { account: SECOND, ctx: { learned } });
    expect(u).toMatchObject({ category: 'groceries', categorySource: 'learned' });
    expect(u.reasons.join(' ')).toMatch(/UPI handle before/);
    expect(u.confidence).toBeGreaterThanOrEqual(0.6);
    expect(u.needsReview).toBe(false);
    // and the ICICI row that prints no name at all
    expect(run(icici, 'debit', { ctx: { learned } }).category).toBe('groceries');
  });
});

describe('own account via UPI handle', () => {
  const asha = makeAccount('asha', 'savings', '3344', 'ASHA VERMA');
  const ctx = { ownAccounts: [asha] };
  const handle = (h: string) => `UPI/412345678901/NA/${h}/Axis Bank/AXL1a2b3c4d5e6f7a8b9c`;

  it.each(['ashaverma92-1@okaxis', 'verma.asha@ybl', 'asha_verma@oksbi', 'AshaVerma07@paytm'])('%s is the holder', (h) => {
    const u = run(handle(h), 'debit', { account: asha, ctx });
    expect(u.kind).toBe('self_transfer');
    expect(u.counterparty.type).toBe('own_account');
    expect(u.confidence).toBe(0.75);
    expect(u.reasons.join(' ')).toMatch(/spells your own name/);
    expect(u.needsReview).toBe(true);
    expect(u.reviewReasons.join(' ')).toMatch(/resembles your own name/);
  });

  it.each(['asha.nair@okaxis', 'rahul.verma@ybl', 'ashavarma@ybl', '9876543210@ybl'])('%s is not the holder', (h) => {
    expect(run(handle(h), 'debit', { account: asha, ctx }).kind).toBe('p2p_out');
  });

  it('two bare common surnames are not enough', () => {
    const rao = makeAccount('rao', 'savings', '5566', 'KUMAR RAO');
    expect(run(handle('kumar.rao@ybl'), 'debit', { account: rao, ctx: { ownAccounts: [rao] } }).kind).toBe('p2p_out');
    expect(run(handle('kumarrao@ybl'), 'debit', { account: rao, ctx: { ownAccounts: [rao] } }).kind).toBe('p2p_out');
  });

  it('works for incoming payments and other accounts of the same holder', () => {
    const other = makeAccount('other', 'savings', '7788', 'VERMA ASHA');
    const u = run('UPI/412345678901/Payment from Ph/ashaverma92@okaxis/Axis Bank/AXL1', 'credit', { account: other, ctx: { ownAccounts: [asha, other] } });
    expect(u.kind).toBe('self_transfer');
  });
});

describe('learned model v2', () => {
  const ex = (key: string, category: string, i: number, extra: Partial<LearningExample> = {}): LearningExample => ({
    text: `UPI-41234567${1000 + i}-${key.toUpperCase()} IN`,
    merchantKey: key,
    category,
    ...extra,
  });
  const examples = [
    ...Array.from({ length: 5 }, (_, i) => ex('zyntrax quolix', 'fitness', i, { amount: 150_000, direction: 'debit' })),
    ...Array.from({ length: 5 }, (_, i) => ex('morvik plento', 'education', i, { amount: 400_000, direction: 'debit' })),
  ];
  const model = trainLearnedModel(examples);

  it('is robust to truncated and wrapped names through character 3-grams', () => {
    for (const text of ['ZYNTRA QUOL', 'ZYNTRAXQUO LIX', 'ZYN TRAX QUOLIX']) {
      const top = rank(model, { text, merchantKey: normalizeMerchantKey(text) })[0];
      expect(top.category).toBe('fitness');
    }
  });

  it('uses the UPI handle as a feature even when the name is generic', () => {
    const withHandles = trainLearnedModel([
      ...Array.from({ length: 4 }, (_, i) => ex('paytm merchant', 'groceries', i, { vpa: 'paytmqr7x1a2b@ptys' })),
      ...Array.from({ length: 4 }, (_, i) => ex('paytm merchant', 'fitness', i + 10, { vpa: 'paytmqr9zzzzz@ptys' })),
      ...Array.from({ length: 4 }, (_, i) => ex('other thing', 'education', i + 20)),
    ]);
    // the generic name is shared; only the handle differs
    expect(handleKey('paytmqr7x1a2b@ptys')).toBe('paytmqr7x1a2b');
    expect(predict(withHandles, 'UPI-1-PAYTM MERCHANT', 'paytm merchant', { vpa: 'paytmqr7x1a2b@ptys' })?.category).toBe('groceries');
    expect(predict(withHandles, 'UPI-1-PAYTM MERCHANT', 'paytm merchant', { vpa: 'paytmqr9zzzzz@ptys' })?.category).toBe('fitness');
  });

  it('exact memory takes precedence over the statistical layer', () => {
    const mixed = trainLearnedModel([
      ...examples,
      ...Array.from({ length: 12 }, (_, i) => ex('zyntrax quolix', 'education', i + 50)),
    ]);
    const remembered = recall(mixed, 'zyntrax quolix');
    expect(remembered).toMatchObject({ category: 'education', via: 'memory' });
    expect(predict(mixed, 'ZYNTRAX QUOLIX', 'zyntrax quolix')?.via).toBe('memory');
    // a merchant the user never named falls through to the statistical model
    expect(predict(mixed, 'ZYNTRA QUOL', 'zyntra quol')?.via).toBe('model');
  });

  it('memory needs agreement: a split history is discounted below the trust threshold', () => {
    const split = trainLearnedModel([
      ...examples,
      ...Array.from({ length: 2 }, (_, i) => ex('coin flip', 'fitness', i + 60)),
      ...Array.from({ length: 2 }, (_, i) => ex('coin flip', 'education', i + 70)),
    ]);
    expect(recall(split, 'coin flip')).toBeNull();
  });

  it('featurize adds handle, amount bucket and direction features', () => {
    const f = featurize({ text: 'UPI-1-SOME SHOP', merchantKey: 'some shop', vpa: 'someshop.payu@icici', amount: 25_000, direction: 'debit' }).map(([t]) => t);
    expect(f).toEqual(expect.arrayContaining(['w:some', 'w:shop', 'vl:someshop.payu', 'v:someshop', 'v:payu', 'a:lt500', 'd:debit']));
    expect(f.some((t) => t.startsWith('g:'))).toBe(true);
  });

  it('phone-number handles never become features (privacy and noise)', () => {
    const f = featurize({ text: 'x', merchantKey: 'k', vpa: '9876543210@ybl' }).map(([t]) => t);
    expect(f.some((t) => t.startsWith('v:') || t.startsWith('vl:'))).toBe(false);
  });

  it('still reads a v1 model (no memory, word tokens only)', () => {
    const v1 = {
      version: 1 as const,
      trainedAt: '2024-01-01T00:00:00.000Z',
      exampleCount: 10,
      categories: ['education', 'fitness'],
      priors: { education: Math.log(0.5), fitness: Math.log(0.5) },
      counts: { education: { 'w:morvik': 10, 'w:plento': 10 }, fitness: { 'w:zyntrax': 10, 'w:quolix': 10 } },
      totals: { education: 20, fitness: 20 },
      vocabSize: 4,
    };
    expect(predict(v1, 'MORVIK PLENTO', 'morvik plento')?.category).toBe('education');
    expect(recall(v1, 'morvik plento')).toBeNull();
  });

  it('is still trained only on usable, confirmed examples', () => {
    expect(trainLearnedModel(Array.from({ length: 12 }, (_, i) => ex('zyntrax quolix', 'uncategorized', i)))).toBeNull();
    expect(trainLearnedModel(examples.slice(0, 7))).toBeNull();
  });
});

describe('wave 2b: ICICI variants, IPO mandates, outward NEFT narrations', () => {
  const phoneFirst = 'UPI/9876501234@ybl/Payment from Ph/State Bank Of I/582300000001/YBLd8b1a2b3c4d5e6f708192a3b4';
  const phoneOld = 'UPI/582300000001/Payment from Ph/9876501234@ybl/State Bank Of I/YBLd8b1a2b3c4d5e6f708192a3b4';

  it('masks phone-number handles identically in the VPA-first and the classic layout', () => {
    const a = run(phoneFirst, 'credit');
    const b = run(phoneOld, 'credit');
    for (const u of [a, b]) {
      expect(u.merchant).toBe('Contact ••1234');
      expect(u.merchantKey).toBe('9876501234');
      expect(u.counterparty.vpa).toBe('9876501234@ybl');
      expect(u.counterparty.bank).toBe('State Bank of India');
      expect(u.kind).toBe('p2p_in');
      expect(u.reference).toBe('582300000001');
    }
  });

  it('never shows a phone number in any display name', () => {
    for (const d of [phoneFirst, phoneOld, 'UPI/9876501234@ybl/NA/Axis Bank/582300000002/AXL1', 'UPI/919876501234@paytm/NA/Axis Bank/582300000002/AXL1', 'UPI-9876501234-9876501234@ybl-UTIB0000001-582300000002-NA']) {
      expect(run(d, 'debit').merchant).not.toMatch(/\d{5,}/);
    }
  });

  it('handles a VPA-first layout for named handles and merchants too', () => {
    const person = run('UPI/priya.menon@okaxis/NA/Axis Bank/582300000002/AXLd8b1a2b3c4d5e6f708192a3b4', 'debit');
    expect(person).toMatchObject({ kind: 'p2p_out', merchant: 'Priya Menon', reference: '582300000002' });
    expect(person.counterparty).toMatchObject({ vpa: 'priya.menon@okaxis', bank: 'Axis Bank' });
    const brand = run('UPI/swiggy@icici/Order/ICICI Bank/582300000003/ICI1a2b3c4d5e6f708192a3b4', 'debit');
    expect(brand).toMatchObject({ kind: 'expense', category: 'food_dining', merchant: 'Swiggy' });
  });

  describe('IPO applications', () => {
    it.each([
      'UPI/582300000003/UPI Mandate/ipo.acmepowernse/HDFCBANK LTD',
      'UPI/582300000003/UPI Mandate/ipo.tatatechnologiesnse/HDFCBANK LTD',
      'UPI/582300000003/IPO APPLICATION/zerodha.ipo@hdfcbank/HDFC BANK',
      'UPI/582300000003/ASBA/acmeretail@sbi/State Bank Of I',
      'UPI/582300000003/NA/ipo.swiggy@icici/ICICI Bank',
    ])('%s is an investment, not a purchase from the brand in the handle', (d) => {
      const u = run(d, 'debit');
      expect(u).toMatchObject({ kind: 'investment', category: 'investments', merchant: 'IPO application' });
      expect(u.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('a released mandate block (credit) is an investment return', () => {
      expect(run('UPI/582300000004/UPI Mandate/ipo.acmepowernse/HDFCBANK LTD', 'credit')).toMatchObject({ kind: 'investment_return', category: 'investments' });
    });

    it('brokers and registrars on a mandate are investments too', () => {
      expect(run('UPI/582300000005/UPI Mandate/linkintime.ipo@icici/ICICI Bank', 'debit').kind).toBe('investment');
      expect(run('UPI/582300000005/UPI Mandate/bigshare@hdfcbank/HDFC Bank', 'debit').kind).toBe('investment');
    });

    it('does not capture ordinary words that merely contain "ipo"', () => {
      expect(run('UPI/582300000006/NA/tipoff.store@ybl/Axis Bank/AXL1', 'debit').kind).not.toBe('investment');
    });
  });

  describe('outward NEFT/RTGS/IMPS: "<RAIL> <utr> <Name>-<BANK NAME> <IFSC>"', () => {
    const asha = makeAccount('v', 'savings', '3344', 'VERMA ASHA KUMARI');
    const own = { account: asha, ctx: { ownAccounts: [asha] } };

    it('parses name, bank (from the IFSC) and IFSC; a person unless the name has company markers', () => {
      const u = run('NEFT 0811OP5160000001 Asha EV-HDFC BANK LIMITED HDFC0000123', 'debit', own);
      expect(u).toMatchObject({ kind: 'p2p_out', merchant: 'Asha Ev', channel: 'NEFT' });
      expect(u.counterparty).toMatchObject({ type: 'person', bank: 'HDFC Bank', ifsc: 'HDFC0000123' });
      expect(u.merchant).not.toMatch(/bank/i);
      const company = run('NEFT 0811OP5160000005 ACME TRADERS PVT LTD-HDFC BANK LIMITED HDFC0000123', 'debit', own);
      expect(company).toMatchObject({ kind: 'expense', merchant: 'Acme Traders' });
      expect(company.counterparty.bank).toBe('HDFC Bank');
    });

    it.each(['RTGS', 'IMPS'])('%s uses the same grammar', (rail) => {
      const u = run(`${rail} 0811OP5160000009 Rahul Menon-ICICI BANK LIMITED ICIC0000456`, 'debit', own);
      expect(u).toMatchObject({ kind: 'p2p_out', merchant: 'Rahul Menon', channel: rail });
      expect(u.counterparty.bank).toBe('ICICI Bank');
    });

    it.each(['Asha VK', 'A K VERMA', 'Verma A K'])('%j is the holder by initials (weaker, reviewed)', (name) => {
      const u = run(`NEFT 0811OP5160000002 ${name}-HDFC BANK LIMITED HDFC0000123`, 'debit', own);
      expect(u.kind).toBe('self_transfer');
      expect(u.counterparty.type).toBe('own_account');
      expect(u.confidence).toBe(0.75);
      expect(u.reasons.join(' ')).toMatch(/by initials/);
      expect(u.needsReview).toBe(true);
    });

    it('two full name tokens stay a normal, more confident match', () => {
      const u = run('NEFT 0811OP5160000003 ASHA K VERMA-HDFC BANK LIMITED HDFC0000123', 'debit', own);
      expect(u).toMatchObject({ kind: 'self_transfer', confidence: 0.85, needsReview: false });
    });

    it('initials that do not fit the holder are a different person', () => {
      expect(run('NEFT 0811OP5160000001 Asha EV-HDFC BANK LIMITED HDFC0000123', 'debit', own).kind).toBe('p2p_out');
    });

    it('"NEFT SALARY" style narrations without a reference are unaffected', () => {
      expect(run('NEFT SALARY', 'credit').kind).toBe('income');
    });
  });
});

describe('wave 3: card statements (SBI Card, ICICI card)', () => {
  describe('glued and PascalCase descriptors', () => {
    it.each([
      ['FlipkartInternetPvtLtd', 'shopping', 'Flipkart'],
      ['AmazonPayIndiaPrivateLimited', 'shopping', 'Amazon'],
      ['SwiggyLimited', 'food_dining', 'Swiggy'],
      ['ZomatoLtd', 'food_dining', 'Zomato'],
      ['FLIPKARTINTERNETPVTLTD', 'shopping', 'Flipkart'],
      ['FlipkartMinutes', 'groceries', 'Flipkart Minutes'],
      ['BigBasketInnovativeRetail', 'groceries', 'BigBasket'],
      ['YouTubePremium', 'entertainment', 'YouTube Premium'],
    ])('%s → %s', (descriptor, category, merchant) => {
      const u = run(descriptor, 'debit', { account: CARD });
      expect(u).toMatchObject({ kind: 'expense', category, categorySource: 'builtin_rule', merchant });
      expect(u.confidence).toBe(0.9);
    });

    it('splits PascalCase for unknown names too, and strips glued corporate suffixes from the key', () => {
      const u = run('SomeShopNamePvtLtd', 'debit', { account: CARD });
      expect(u.merchant).toBe('Some Shop Name');
      expect(u.merchantKey).toBe('some shop name');
    });

    it('does not invent brands out of ordinary glued words', () => {
      expect(run('ZzqMarketPlaceCo', 'debit', { account: CARD }).categorySource).toBe('none');
      expect(run('RamuStores', 'debit', { account: CARD }).categorySource).not.toBe('builtin_rule');
    });
  });

  describe('wrap artifacts on brands', () => {
    it.each([
      ['HungerBo x', 'food_dining', 'HungerBox'],
      ['Hunger Box', 'food_dining', 'HungerBox'],
      ['sRide', 'transport', 'sRide'],
      ['Lalithaa Jewellery Chennai', 'shopping', 'Lalithaa Jewellery'],
      ['LalithaaJewellery', 'shopping', 'Lalithaa Jewellery'],
      ['Flipkart Minutes Bangalore', 'groceries', 'Flipkart Minutes'],
    ])('%s → %s', (descriptor, category, merchant) => {
      expect(run(descriptor, 'debit', { account: CARD })).toMatchObject({ category, merchant });
    });

    it('quick-commerce, carpool, cafeteria and jewellery chains are known', () => {
      const table: Array<[string, string]> = [
        ['BB NOW', 'groceries'],
        ['FIRSTCLUB', 'groceries'],
        ['BLABLACAR', 'transport'],
        ['CITYFLO', 'transport'],
        ['ROUTEMATIC', 'transport'],
        ['SODEXO', 'food_dining'],
        ['EDENRED', 'food_dining'],
        ['THANGAMAYIL JEWELLERY', 'shopping'],
        ['JOSCO JEWELLERS', 'shopping'],
        ['CHEMMANUR JEWELLERS', 'shopping'],
      ];
      for (const [d, category] of table) expect(run(d, 'debit', { account: CARD }).category).toBe(category);
    });
  });

  describe('foreign-currency card descriptors', () => {
    it.each([
      ['SOME SAAS INC * 25 USD', 'USD', 'Some Saas Inc'],
      ['SOME SAAS INC * 48 25 USD', 'USD', 'Some Saas Inc'],
      ['SOME SAAS INC * 12.50 USD', 'USD', 'Some Saas Inc'],
      ['ACME AI * 9 EUR', 'EUR', 'Acme AI'],
      ['ZETA STUDIO LLC * 5 GBP', 'GBP', 'Zeta Studio LLC'],
    ])('%s', (descriptor, currency, merchant) => {
      const u = run(descriptor, 'debit', { account: CARD });
      expect(u.merchant).toBe(merchant);
      expect(u.counterparty.type).toBe('merchant');
      expect(u.kind).toBe('expense');
      expect(u.reasons).toContain(`International card payment (${currency})`);
      expect(u.reasons.join(' ')).toMatch(/forex markup fee may apply/);
      expect(u.merchantKey).not.toMatch(/usd|eur|gbp|\d/);
    });

    it('suggests subscriptions for a company-looking foreign charge, but keeps it in review', () => {
      const u = run('SOME SAAS INC * 25 USD', 'debit', { account: CARD });
      expect(u).toMatchObject({ category: 'subscriptions', categorySource: 'builtin_rule', confidence: 0.55, needsReview: true });
    });

    it('does not guess for a foreign charge with no company marker', () => {
      const u = run('RIVOLI PARIS * 30 EUR', 'debit', { account: CARD });
      expect(u.category).toBe('uncategorized');
      expect(u.reasons).toContain('International card payment (EUR)');
    });

    it('keeps known brands at brand confidence', () => {
      expect(run('NOTION LABS INC * 10 USD', 'debit', { account: CARD })).toMatchObject({ category: 'subscriptions', confidence: 0.9, merchant: 'Notion Labs Inc' });
      expect(run('NETFLIX.COM LOS GATOS * 9 USD', 'debit', { account: CARD })).toMatchObject({ category: 'entertainment', merchant: 'Netflix' });
    });

    it('an ordinary rupee descriptor is not treated as foreign', () => {
      expect(run('SOME SAAS INC', 'debit', { account: CARD }).reasons.join(' ')).not.toMatch(/International/);
      expect(run('MCDONALDS 4 USD', 'debit', { account: SAVINGS }).reasons.join(' ')).not.toMatch(/International/);
    });
  });

  describe('(Pay in EMIs)', () => {
    it('keeps kind and merchant category, notes the EMI, and leaves the merchant key alone', () => {
      const plain = run('CROMA ELECTRONICS', 'debit', { account: CARD });
      const emi = run('CROMA ELECTRONICS (Pay in EMIs)', 'debit', { account: CARD });
      expect(emi).toMatchObject({ kind: 'expense', category: plain.category, merchant: plain.merchant, merchantKey: plain.merchantKey });
      expect(emi.reasons).toContain('Converted to EMI at checkout');
      expect(plain.reasons).not.toContain('Converted to EMI at checkout');
    });

    it('unknown merchants keep a clean name', () => {
      const u = run('ZZQ GADGETS (Pay in EMIs)', 'debit', { account: CARD });
      expect(u.merchant).toBe('ZZQ Gadgets');
      expect(u.kind).toBe('expense');
    });
  });

  describe('statement-period fragment in front of a row', () => {
    const fragment = 'for Statement Period: 14 Jan 2025 to 13 Feb 2025';
    it.each([
      ['PAYMENT RECEIVED 000000000ABCD12345XYZ', 'credit'],
      ['SWIGGY BANGALORE', 'debit'],
      ['SOME SAAS INC * 25 USD', 'debit'],
      ['FlipkartInternetPvtLtd', 'debit'],
    ] as const)('does not change the decision for %s', (row, direction) => {
      const clean = run(row, direction, { account: CARD });
      const prefixed = run(`${fragment} ${row}`, direction, { account: CARD });
      expect(prefixed).toEqual(clean);
    });

    it('a row that is only the fragment is left alone', () => {
      expect(() => run(fragment, 'debit', { account: CARD })).not.toThrow();
    });
  });

  describe('three-letter "KIR" at the very end', () => {
    it('suggests groceries at 0.5 and keeps it in review', () => {
      const u = run('UPI-412345678999-RAMU KIR IN', 'debit', { account: CARD });
      expect(u).toMatchObject({ category: 'groceries', confidence: 0.5, needsReview: true });
      expect(u.reasons.join(' ')).toMatch(/Cut-off name/);
    });
    it('only as the last token, and never for a lone word', () => {
      expect(run('UPI-412345678999-RAMU KIR STORE IN', 'debit', { account: CARD }).categorySource).toBe('none');
      expect(run('UPI-412345678999-KIR IN', 'debit', { account: CARD }).categorySource).toBe('none');
    });
    it('does not touch person payments', () => {
      expect(run('UPI/412345678868/NA/ramu.kir@okaxis/Axis Bank/AXL1', 'debit').category).toBe('sent_to_people');
    });
  });
});

describe('wave 4: YES Bank, HSBC and RBL card statements', () => {
  const withMcc = (description: string, bankCategory: string | undefined, direction: 'debit' | 'credit' = 'debit', over: { learned?: Parameters<typeof ctxFor>[1] } = {}) =>
    understand({ description, direction, amount: 150_000, date: '2025-02-10', bankCategory }, ctxFor(CARD, over.learned));

  describe('issuer-printed merchant category', () => {
    it.each([
      ['[Transportation Services]', 'transport'],
      ['Grocery Stores, Supermarkets', 'groceries'],
      ['Eating Places Restaurants', 'food_dining'],
      ['Fuel', 'transport'],
      ['Utilities', 'utilities'],
      ['Telecom', 'mobile_internet'],
      ['Insurance', 'insurance'],
      ['Education', 'education'],
      ['Jewelry Stores', 'shopping'],
      ['Department Stores', 'shopping'],
      ['Hotels', 'travel'],
      ['Airlines', 'travel'],
      ['Government Services', 'taxes'],
      ['Digital Goods', 'entertainment'],
      ['Drug Stores Pharmacies', 'healthcare'],
      ['[Health and Beauty Spas]', 'personal_care'],
    ])('%s → %s', (bankCategory, category) => {
      const u = withMcc('ZZQ UNKNOWN PLACE', bankCategory);
      expect(u).toMatchObject({ kind: 'expense', category, categorySource: 'builtin_rule', confidence: 0.85, needsReview: false });
      expect(u.reasons.join(' ')).toContain(`Your card issuer files this under "${bankCategory.replace(/[[\]]/g, '')}"`);
    });

    it('a specific brand match still wins over the issuer category', () => {
      const u = withMcc('SWIGGY BANGALORE', 'Grocery Stores');
      expect(u).toMatchObject({ category: 'food_dining', confidence: 0.9 });
    });

    it('beats a generic keyword, and is ignored when it says nothing useful', () => {
      expect(withMcc('TEA POINT', 'Jewelry Stores').category).toBe('shopping');
      for (const nothing of [undefined, '', 'Money Transfer', 'Financial Institutions', '[ ]']) {
        expect(withMcc('ZZQ UNKNOWN PLACE', nothing).categorySource).toBe('none');
      }
    });

    it('applies to card credits (refunds) and never to person transfers', () => {
      expect(withMcc('ZZQ UNKNOWN PLACE', 'Hotels', 'credit')).toMatchObject({ kind: 'refund', category: 'travel' });
      const p2p = understand({ description: 'UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', direction: 'debit', amount: 10_000, date: '2025-02-10', bankCategory: 'Grocery Stores' }, ctxFor(SAVINGS));
      expect(p2p.category).toBe('sent_to_people');
    });
  });

  describe('payment-gateway prefixes', () => {
    it.each([
      ['RAZ*SWIGGY', 'Razorpay'],
      ['RAZORPAY*SWIGGY', 'Razorpay'],
      ['CAS*SWIGGY', 'Cashfree'],
      ['CASHFREE*SWIGGY', 'Cashfree'],
      ['PAYU*SWIGGY', 'PayU'],
      ['PYU*SWIGGY', 'PayU'],
      ['CCAV*SWIGGY', 'CCAvenue'],
      ['CCAVENUE*SWIGGY', 'CCAvenue'],
      ['BD*SWIGGY', 'BillDesk'],
      ['BILLDESK*SWIGGY', 'BillDesk'],
      ['PTM*SWIGGY', 'Paytm'],
      ['PAYTM*SWIGGY', 'Paytm'],
      ['EAZ*SWIGGY', 'Easebuzz'],
      ['EASEBUZZ*SWIGGY', 'Easebuzz'],
      ['PHONEPE*SWIGGY', 'PhonePe'],
      ['JUSPAY*SWIGGY', 'Juspay'],
      ['PAY*SWIGGY', 'a payment gateway'],
    ])('%s', (descriptor, gateway) => {
      const u = run(descriptor, 'debit', { account: CARD });
      expect(u.merchant).toBe('Swiggy');
      expect(u.category).toBe('food_dining');
      expect(u.reasons).toContain(`Paid through ${gateway}`);
    });

    it('strips the tag from an unknown merchant and keeps it in review', () => {
      const u = run('RAZ*ZZQ ENTERPRISE HUB', 'debit', { account: CARD });
      expect(u.merchant).toBe('ZZQ Enterprise Hub');
      expect(u.merchantKey).toBe('zzq enterprise hub');
      expect(u.needsReview).toBe(true);
    });

    it('a person-like name behind a gateway stays in review even when the issuer category fills the category', () => {
      const u = withMcc('RAZORPAY*RAMESH KUMAR', 'Digital Goods');
      expect(u.category).toBe('entertainment');
      expect(u.needsReview).toBe(true);
      expect(u.reviewReasons.join(' ')).toMatch(/looks like a person/);
    });

    it('a business name behind a gateway is not flagged as a person', () => {
      const u = withMcc('PAYU*ZZQ ELECTRONICS PVT LTD', 'Department Stores');
      expect(u.needsReview).toBe(false);
      expect(u.merchant).toBe('ZZQ Electronics');
    });

    it('a star in the middle of a name is not a gateway', () => {
      const u = run('OPENAI *CHATGPT SUBSCR', 'debit', { account: CARD });
      expect(u.reasons.join(' ')).not.toMatch(/Paid through/);
    });

    it('does not eat ordinary words that start like a gateway tag', () => {
      expect(run('PAYMENT GATEWAY SERVICES', 'debit', { account: CARD }).reasons.join(' ')).not.toMatch(/Paid through/);
    });
  });

  describe('card payments are never refunds', () => {
    it.each([
      'PAYMENT RECEIVED - RAZORPAY',
      'PAYMENT RECEIVED - BILLDESK',
      'PAYMENT RECEIVED - PAYU',
      'PAYMENT - THANK YOU',
      'PAYMENT THANK YOU',
      'NEFT PAYMENT',
      'BBPS PAYMENT',
      'UPI PAYMENT',
      'PAYMENT RECEIVED',
      'THANK YOU FOR YOUR PAYMENT',
      'for Statement Period: 14 Jan 2025 to 13 Feb 2025 PAYMENT RECEIVED - RAZORPAY',
    ])('%s', (description) => {
      expect(run(description, 'credit', { account: CARD })).toMatchObject({ kind: 'card_payment', category: 'card_payment' });
    });
  });

  describe('references and brackets never become the merchant', () => {
    it.each([
      ['RAZ*Pay Hive 356 - Ref No: [', 'Pay Hive 356', 'pay hive'],
      ['ZZQ SHOP Ref No: 123456', 'ZZQ Shop', 'zzq shop'],
      ['ZZQ SHOP - Ref No [12345]', 'ZZQ Shop', 'zzq shop'],
      ['[ZZQ SHOP]', 'ZZQ Shop', 'zzq shop'],
      ['ZZQ SHOP [', 'ZZQ Shop', 'zzq shop'],
    ])('%s', (description, merchant, key) => {
      const u = run(description, 'debit', { account: CARD });
      expect(u.merchant).toBe(merchant);
      expect(u.merchantKey).toBe(key);
      expect(u.merchant).not.toMatch(/ref|\[|\]/i);
    });
  });

  describe('FASTag loading on a card', () => {
    it.each(['FASTAG RECHARGE', 'PTM*FASTAG RECHARGE', 'ICICI BANK FASTAG', 'IHMCL FASTAG LOAD', 'NETC FASTAG'])('%s is transport spending', (description) => {
      expect(run(description, 'debit', { account: CARD })).toMatchObject({ kind: 'expense', category: 'transport', merchant: expect.stringMatching(/FASTag/i) });
    });
  });

  describe('card fee rows', () => {
    it.each([
      'Membership Fee + GST',
      'Annual Fee',
      'Annual Membership Fee',
      'Joining Fee',
      'Renewal Fee',
      'Late Payment Fee',
      'Finance Charges',
      'Interest',
      'Retail Interest',
      'Cash Interest',
      'IGST',
      'CGST @ 9%',
      'SGST @ 9%',
      'GST',
      'Tax on Processing Fee',
      'Tax on Convenience Fee',
      'Forex markup',
      'Forex Markup Fee + GST',
      'Currency Conversion Fee',
      'Cash Advance Fee',
      'Over limit Fee',
      'Card Replacement Fee',
      'Statement Fee',
      'EMI Processing Fee',
      'Rental Fee',
      'Fuel Surcharge',
    ])('%s is a fee', (description) => {
      const u = run(description, 'debit', { account: CARD });
      expect(u).toMatchObject({ kind: 'fee', category: 'fees_charges' });
      expect(u.needsReview).toBe(false);
    });

    it('does not turn real purchases into fees', () => {
      for (const d of ['SCHOOL FEES', 'INTEREST FREE STORE', 'AMAZON PAY INDIA', 'FEE FI FO RESTAURANT']) {
        expect(run(d, 'debit', { account: CARD }).kind).toBe('expense');
      }
    });

    it('a fee waiver or reversal is not a fee', () => {
      expect(run('Fuel Surcharge Waiver', 'credit', { account: CARD }).kind).toBe('refund');
    });
  });
});

describe('wave 4b: Axis card descriptors', () => {
  it.each([
    'ANNUAL FEE',
    'GST',
    'Joining Fees',
    'GST on Joining Fees',
    'GST on Interest',
    'GST on Annual Fee',
    'Cash Withdrawal Fee',
    'Interest on Cash withdrawal',
    'Surcharge on Purchase',
    'Foreign Currency transaction Fee',
    'Duplicate Statement Fee',
    'Cheque return Fee',
    'Overdue Penalty',
  ])('%s is a fee, not spending (GST on fees is filed under Fees & charges, consistently)', (description) => {
    const u = run(description, 'debit', { account: CARD });
    expect(u).toMatchObject({ kind: 'fee', category: 'fees_charges' });
    expect(u.needsReview).toBe(false);
  });

  it('fees on a bank account behave the same way', () => {
    expect(run('ANNUAL FEE', 'debit')).toMatchObject({ kind: 'fee', category: 'fees_charges' });
    expect(run('GST', 'debit')).toMatchObject({ kind: 'fee', category: 'fees_charges' });
  });

  it('"MERCHANT NAME, CITY" keeps the merchant and drops the city', () => {
    const swiggy = run('SWIGGY, BANGALORE', 'debit', { account: CARD });
    expect(swiggy).toMatchObject({ merchant: 'Swiggy', category: 'food_dining' });
    const unknown = run('ZZQ ENTERPRISE HUB, KARIMNAGAR', 'debit', { account: CARD });
    expect(unknown.merchant).toBe('ZZQ Enterprise Hub');
    expect(unknown.merchantKey).toBe('zzq enterprise hub');
    expect(run('ACME FOODS, INC', 'debit', { account: CARD }).merchant).toMatch(/^Acme Foods,? Inc$/); // a legal suffix is not a city
  });

  it('reward / EDGE points lines are never a merchant', () => {
    for (const d of ['EDGE REWARD POINTS BALANCE', 'EDGE MILES POINTS EARNED', 'REWARD POINTS REDEMPTION', 'CASHPOINTS REDEEMED']) {
      const credit = run(d, 'credit', { account: CARD });
      expect(credit).toMatchObject({ kind: 'refund', merchant: 'Reward points', merchantKey: 'reward points' });
      expect(credit.reasons).toContain('Reward points redeemed against the card');
      const debit = run(d, 'debit', { account: CARD });
      expect(debit).toMatchObject({ kind: 'unknown', merchant: 'Reward points', needsReview: true });
    }
  });

  it('a merchant whose name merely contains "reward" is still a merchant', () => {
    expect(run('REWARDS CAFE', 'debit', { account: CARD }).kind).toBe('expense');
  });
});
