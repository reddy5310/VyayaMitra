import { describe, expect, it } from 'vitest';
import type { Account, Direction, TxnKind } from '@/domain/types';
import { parseDescription } from './parse';
import { cleanCardDescriptor, classifySegments, findBank, parseWalletText, splitSegments } from './grammars';
import { CARD, SAVINGS, makeAccount, run } from './testkit';

/** Synthetic narrations modelled on the public formats of each bank. All names, numbers and handles are invented. */
interface Case {
  bank: string;
  narration: string;
  direction: Direction;
  kind: TxnKind;
  category?: string;
  merchant?: string;
  vpa?: string;
  counterBank?: string;
  channel?: string;
  reference?: string;
  cpType?: string;
}

const UPI_CASES: Case[] = [
  { bank: 'HDFC', narration: 'UPI-MEERA NAIR-meera.nair@okaxis-UTIB0000001-412345678901-NA', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', vpa: 'meera.nair@okaxis', counterBank: 'Axis Bank', reference: '412345678901', channel: 'UPI' },
  { bank: 'HDFC', narration: 'UPI-SWIGGY-swiggy@icici-ICIC0000103-412345678902-Order', direction: 'debit', kind: 'expense', category: 'food_dining', merchant: 'Swiggy', counterBank: 'ICICI Bank' },
  { bank: 'HDFC', narration: 'UPI-ZERODHA BROKING-zerodha.rzp@hdfcbank-HDFC0000001-412345678903-Funds', direction: 'debit', kind: 'investment', merchant: 'Zerodha' },
  { bank: 'SBI', narration: 'TO TRANSFER-UPI/DR/412345678904/MEERA NAIR/SBIN/meera@sbi/NA', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', vpa: 'meera@sbi', counterBank: 'State Bank of India', reference: '412345678904' },
  { bank: 'SBI', narration: 'BY TRANSFER-UPI/CR/412345678905/RAJU NAIR/PUNB/raju.nair@ybl/Payment', direction: 'credit', kind: 'p2p_in', merchant: 'Raju Nair', counterBank: 'Punjab National Bank' },
  { bank: 'Axis', narration: 'UPI/P2M/412345678906/SWIGGY/Order/AXIS BANK', direction: 'debit', kind: 'expense', category: 'food_dining', merchant: 'Swiggy', counterBank: 'Axis Bank' },
  { bank: 'Axis', narration: 'UPI/P2M/412345678907/RAJU STORES/Payment/AXIS BANK', direction: 'debit', kind: 'expense', category: 'uncategorized', merchant: 'Raju Stores', cpType: 'merchant' },
  { bank: 'Axis', narration: 'UPI/P2A/412345678908/MEERA NAIR/HDFC BANK', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', counterBank: 'HDFC Bank' },
  { bank: 'Axis', narration: 'UPI/P2A/412345678909/MEERA NAIR/meera@okhdfcbank/UPI', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair', vpa: 'meera@okhdfcbank' },
  { bank: 'Kotak', narration: 'UPI/MEERA NAIR/412345678910/Payment for rent', direction: 'debit', kind: 'p2p_out', category: 'rent_housing', merchant: 'Meera Nair', reference: '412345678910' },
  { bank: 'Kotak', narration: 'UPI/SWIGGY/412345678911/Food order', direction: 'debit', kind: 'expense', category: 'food_dining', merchant: 'Swiggy' },
  { bank: 'Bank of Baroda', narration: 'UPI/412345678912/DR/MEERA NAIR/HDFC BANK/meera@okhdfcbank', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', vpa: 'meera@okhdfcbank', counterBank: 'HDFC Bank' },
  { bank: 'PNB', narration: 'UPI/CR/412345678913/MEERA NAIR/PUNB/meera@ybl/NA', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair', counterBank: 'Punjab National Bank' },
  { bank: 'Canara', narration: 'UPI/DR/412345678914/MEERA NAIR/meera@ybl/UPI', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', vpa: 'meera@ybl' },
  { bank: 'Union Bank', narration: 'UPIAR/412345678915/DR/MEERA NAIR/UBIN/meera@ybl', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', counterBank: 'Union Bank of India' },
  { bank: 'IDFC First', narration: 'UPI/412345678916/MEERA NAIR/meera@okicici/Thanks', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', vpa: 'meera@okicici' },
  { bank: 'Yes Bank', narration: 'UPI-412345678917-MEERA NAIR-meera@ybl-YESB0000001', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', counterBank: 'Yes Bank' },
  { bank: 'IndusInd', narration: 'UPI/412345678918/MEERA NAIR/meera@ybl/UPI', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair' },
  { bank: 'Federal', narration: 'UPI/412345678919/CR/MEERA NAIR/FDRL/meera@ybl', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair', counterBank: 'Federal Bank' },
  { bank: 'AU Small Finance', narration: 'UPI/DR/412345678920/MEERA NAIR/AUBL/meera@ybl', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair' },
  { bank: 'hyphenated gateway handle', narration: 'UPI-SPORTS PLANET-paytm-24680@ptys-PYTM0123456-412345678921-Paytm', direction: 'debit', kind: 'expense', cpType: 'merchant', vpa: 'paytm-24680@ptys' },
  { bank: 'UPI mandate (autopay)', narration: 'UPI/MANDATE/412345678922/NETFLIX/netflix@icici/Autopay', direction: 'debit', kind: 'expense', category: 'entertainment', merchant: 'Netflix' },
  { bank: 'Paytm Payments Bank', narration: 'Paid to MEERA NAIR', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', channel: 'UPI' },
  { bank: 'Paytm Payments Bank', narration: 'Received from MEERA NAIR', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair' },
];

const TRANSFER_CASES: Case[] = [
  { bank: 'SBI', narration: 'BY TRANSFER-NEFT*HDFC0000001*N123456789*ACME SOLUTIONS PVT LTD*SALARY', direction: 'credit', kind: 'income', category: 'salary', merchant: 'Acme Solutions', counterBank: 'HDFC Bank', channel: 'NEFT' },
  { bank: 'SBI', narration: 'TO TRANSFER-NEFT*SBIN0000001*N123456789*MEERA NAIR', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', counterBank: 'State Bank of India', channel: 'NEFT' },
  { bank: 'HDFC', narration: 'NEFT CR-HDFC0000001-MEERA NAIR-REF123456789', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair', counterBank: 'HDFC Bank', channel: 'NEFT' },
  { bank: 'HDFC', narration: 'NEFT DR-UTIB0000001-MEERA NAIR-412345678931-UPIPAYOUT', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', counterBank: 'Axis Bank', channel: 'NEFT' },
  { bank: 'HDFC', narration: 'IMPS-412345678932-MEERA NAIR-HDFC-XXXXXXXX1234-NA', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', channel: 'IMPS', reference: '412345678932' },
  { bank: 'Axis', narration: 'IMPS/P2A/412345678933/MEERA NAIR/HDFC BANK/Rent', direction: 'debit', kind: 'p2p_out', merchant: 'Meera Nair', channel: 'IMPS', counterBank: 'HDFC Bank' },
  { bank: 'Kotak', narration: 'NEFT KKBK0000001 MEERA NAIR 412345678934', direction: 'credit', kind: 'p2p_in', channel: 'NEFT' },
  { bank: 'ICICI-style', narration: 'NEFT-KKBKN12345678-ACME SOLUTIONS-INV 22', direction: 'debit', kind: 'expense', merchant: 'Acme Solutions', channel: 'NEFT' },
  { bank: 'RTGS', narration: 'RTGS-HDFCR52024061234567-ACME TRADERS-INV 123', direction: 'debit', kind: 'expense', merchant: 'Acme Traders', channel: 'RTGS' },
  { bank: 'RTGS credit', narration: 'BY TRANSFER-RTGS*SBIN0000001*SBINR12024061234567*ACME SOLUTIONS LTD*PAYMENT', direction: 'credit', kind: 'income', merchant: 'Acme Solutions', channel: 'RTGS' },
  { bank: 'DBS', narration: 'NEFTIN ICIN412345678935 MEERA NAIR -ICICI BANK LIMITED ICIC0000002', direction: 'credit', kind: 'p2p_in', merchant: 'Meera Nair', counterBank: 'ICICI Bank', channel: 'NEFT' },
];

const MANDATE_CASES: Case[] = [
  { bank: 'HDFC', narration: 'ACH D- NIPPON INDIA MUTUAL FUND-123456', direction: 'debit', kind: 'investment', category: 'investments', channel: 'ACH' },
  { bank: 'HDFC', narration: 'ACH D- HDFC LTD-123456', direction: 'debit', kind: 'loan_payment', category: 'loan_emi', channel: 'ACH' },
  { bank: 'generic', narration: 'NACH-DR-HDFC LIFE INSURANCE-123456', direction: 'debit', kind: 'expense', category: 'insurance', merchant: 'HDFC Life', channel: 'ACH' },
  { bank: 'generic', narration: 'NACH/DR/PARAG PARIKH MF SIP/123456', direction: 'debit', kind: 'investment', channel: 'ACH' },
  { bank: 'generic', narration: 'ECS/BAJAJ FINANCE LTD/123456', direction: 'debit', kind: 'loan_payment', category: 'loan_emi', channel: 'ACH' },
  { bank: 'generic', narration: 'SI-LIC OF INDIA-POLICY 123456', direction: 'debit', kind: 'expense', category: 'insurance', merchant: 'LIC', channel: 'ACH' },
  { bank: 'generic', narration: 'ACH C- COAL INDIA LTD-DIVIDEND', direction: 'credit', kind: 'income', channel: 'ACH' },
  { bank: 'generic', narration: 'NACH DR GROWW INVEST TECH SIP 123456', direction: 'debit', kind: 'investment', channel: 'ACH' },
  { bank: 'generic', narration: 'ACH D- STAR HEALTH AND ALLIED INSURANCE-123456', direction: 'debit', kind: 'expense', category: 'insurance', channel: 'ACH' },
];

const CARD_CASES: Case[] = [
  { bank: 'HDFC POS', narration: 'POS 4147XXXXXXXX1234 SWIGGY BANGALORE IN', direction: 'debit', kind: 'expense', category: 'food_dining', merchant: 'Swiggy', channel: 'CARD' },
  { bank: 'ECOM', narration: 'ECOM PUR/AMAZON PAY INDIA PRIVA MUMBAI', direction: 'debit', kind: 'expense', category: 'shopping', merchant: 'Amazon', channel: 'CARD' },
  { bank: 'ECOM', narration: 'ECOM 5241XXXXXXXX9876 FLIPKART INTERNET BANGALORE', direction: 'debit', kind: 'expense', category: 'shopping', merchant: 'Flipkart' },
  { bank: 'international', narration: 'POS 4147XXXXXXXX1234 NETFLIX.COM LOS GATOS US', direction: 'debit', kind: 'expense', category: 'entertainment', merchant: 'Netflix' },
  { bank: 'international', narration: 'POS 4147XXXXXXXX1234 SPOTIFY P1234 STOCKHOLM SE', direction: 'debit', kind: 'expense', category: 'entertainment', merchant: 'Spotify' },
  { bank: 'ATM', narration: 'ATW-4147XXXXXXXX1234-Z9QPA456-HYDERABAD', direction: 'debit', kind: 'cash_withdrawal', category: 'cash', channel: 'ATM' },
  { bank: 'ATM', narration: 'NWD-4147XXXXXXXX1234-123456-MUMBAI', direction: 'debit', kind: 'cash_withdrawal', channel: 'ATM' },
  { bank: 'SBI ATM', narration: 'ATM WDL-ATM CASH 1234 MG ROAD', direction: 'debit', kind: 'cash_withdrawal', channel: 'ATM' },
  { bank: 'Axis ATM', narration: 'EAW-4147XXXXXXXX1234-HYDERABAD', direction: 'debit', kind: 'cash_withdrawal' },
];

const BILL_CASES: Case[] = [
  { bank: 'BBPS', narration: 'BBPS-BESCOM-412345678940', direction: 'debit', kind: 'expense', category: 'utilities', merchant: 'BESCOM', channel: 'BILLPAY' },
  { bank: 'HDFC card bill', narration: 'IB BILLPAY DR-HDFCVD-4147XXXXXXXX1234', direction: 'debit', kind: 'card_payment', category: 'card_payment' },
  { bank: 'ICICI', narration: 'BIL/ONL/412345678941/BESCOM', direction: 'debit', kind: 'expense', category: 'utilities', channel: 'BILLPAY' },
];

function accountFor(c: Case): Account {
  return c.bank === 'HDFC POS' ? CARD : SAVINGS;
}

describe.each([
  ['UPI', UPI_CASES],
  ['NEFT / IMPS / RTGS', TRANSFER_CASES],
  ['NACH / ACH / ECS mandates', MANDATE_CASES],
  ['card descriptors, POS and ATM', CARD_CASES],
  ['bill payments', BILL_CASES],
])('narration grammar: %s', (_label, cases) => {
  it.each(cases)('$bank: $narration', (c) => {
    const u = run(c.narration, c.direction, { account: accountFor(c) });
    expect(u.kind).toBe(c.kind);
    if (c.category) expect(u.category).toBe(c.category);
    if (c.merchant) expect(u.merchant).toBe(c.merchant);
    if (c.vpa) expect(u.counterparty.vpa).toBe(c.vpa);
    if (c.counterBank) expect(u.counterparty.bank).toBe(c.counterBank);
    if (c.channel) expect(u.channel).toBe(c.channel);
    if (c.reference) expect(u.reference).toBe(c.reference);
    if (c.cpType) expect(u.counterparty.type).toBe(c.cpType);
  });
});

describe('P2M / P2A tags', () => {
  it('P2M marks a merchant payment even for a person-looking handle', () => {
    const u = run('UPI/P2M/412345678950/KAVYA STORES/Payment/AXIS BANK', 'debit');
    expect(u.kind).toBe('expense');
    expect(u.reasons.join(' ')).toMatch(/merchant/i);
  });
  it('P2A stays a person transfer', () => {
    expect(run('UPI/P2A/412345678951/KAVYA NAIR/AXIS BANK', 'debit').kind).toBe('p2p_out');
  });
});

describe('IFSC names the counterparty bank', () => {
  it.each([
    ['HDFC0001234', 'HDFC Bank'],
    ['UTIB0000001', 'Axis Bank'],
    ['SBIN0004321', 'State Bank of India'],
    ['KKBK0000001', 'Kotak Mahindra Bank'],
    ['PUNB0123456', 'Punjab National Bank'],
    ['BARB0VJNAGA', 'Bank of Baroda'],
  ])('%s → %s', (ifsc, bank) => {
    const parsed = parseDescription(`NEFT-XXXXN123456-SOME NAME-${ifsc}`, 'savings');
    expect(parsed.ifsc).toBe(ifsc);
    expect(parsed.bank).toBe(bank);
  });
});

describe('helpers', () => {
  it('splitSegments re-joins hyphenated handles', () => {
    expect(splitSegments('UPI-SHOP-paytm-24680@ptys-REF')).toEqual(['UPI', 'SHOP', 'paytm-24680@ptys', 'REF']);
    expect(splitSegments('NEFT*HDFC0000001*N123*NAME')).toEqual(['NEFT', 'HDFC0000001', 'N123', 'NAME']);
  });
  it('classifySegments classifies by shape, whatever the order', () => {
    const a = classifySegments(['UPI', 'P2M', '412345678901', 'SOME SHOP', 'Order', 'AXIS BANK']);
    expect(a).toMatchObject({ reference: '412345678901', name: 'SOME SHOP', bank: 'Axis Bank', mode: 'merchant', notes: ['Order'] });
    const b = classifySegments(['x@ybl', 'Payment from Ph', 'Yes Bank Ltd', '412345678901', 'YBL1a2b3c4d5e6f7a8b9c']);
    expect(b).toMatchObject({ vpa: 'x@ybl', reference: '412345678901', bank: 'Yes Bank' });
    expect(b.name).toBeUndefined();
  });
  it('findBank repairs truncation but does not mistake names for banks', () => {
    expect(findBank('State Bank Of I')).toBe('State Bank of India');
    expect(findBank('SBIN')).toBe('State Bank of India');
    expect(findBank('MEERA NAIR')).toBeUndefined();
    expect(findBank('AXIS')).toBeUndefined();
  });
  it('cleanCardDescriptor strips prefixes, masked numbers, country codes and a trailing city', () => {
    expect(cleanCardDescriptor('POS 4147XXXXXXXX1234 SWIGGY BANGALORE IN')).toBe('SWIGGY BANGALORE');
    expect(cleanCardDescriptor('ECOM PUR/AMAZON PAY INDIA PRIVA MUMBAI')).toBe('AMAZON PAY INDIA PRIVA');
    expect(cleanCardDescriptor('POS 4147XXXXXXXX1234 NETFLIX.COM LOS GATOS US')).toBe('NETFLIX.COM LOS GATOS');
    expect(cleanCardDescriptor('TEA POINT HYDERABAD')).toBe('TEA POINT');
    expect(cleanCardDescriptor('SWIGGY BANGALORE')).toBe('SWIGGY BANGALORE');
  });
  it('parseWalletText recognises wallet-style narrations', () => {
    expect(parseWalletText('Paid to Meera Nair')).toEqual({ name: 'Meera Nair', outgoing: true });
    expect(parseWalletText('Received from Meera Nair')).toEqual({ name: 'Meera Nair', outgoing: false });
    expect(parseWalletText('SWIGGY BANGALORE')).toBeNull();
  });
  it('unknown banks still parse (shape-based, no bank list needed)', () => {
    const other = makeAccount('x', 'savings', '1111', 'SOMEONE ELSE');
    const u = run('UPI/A9/412345678960/MEERA NAIR/SOMEBANK/meera@ybl/NA', 'debit', { account: other, ctx: { ownAccounts: [other] } });
    expect(u.kind).toBe('p2p_out');
    expect(u.merchant).toBe('Meera Nair');
  });
});
