import { describe, expect, it } from 'vitest';
import type { Account, Direction, TxnKind } from '@/domain/types';
import { DICTIONARY_SIZE, normalizeMerchantKey, ruleMatches } from './index';
import { CARD, SAVINGS, SECOND, makeAccount, makeRule, run } from './testkit';

interface Case {
  name: string;
  description: string;
  direction: Direction;
  account?: Account;
  amount?: number;
  kind: TxnKind;
  category?: string;
  source?: string;
  merchant?: string;
  merchantKey?: string;
  channel?: string;
  cpType?: string;
  review?: boolean;
  reason?: RegExp;
}

const cases: Case[] = [
  // ── the old app's failures ────────────────────────────────────────────────────────────────────
  { name: 'STEAM is entertainment, not food (TEA inside STEAM)', description: 'STEAMGAMES.COM 425-9522985', direction: 'debit', account: CARD, kind: 'expense', category: 'entertainment', source: 'builtin_rule', merchant: 'Steam' },
  { name: 'bare STEAM word is entertainment', description: 'STEAM', direction: 'debit', account: CARD, kind: 'expense', category: 'entertainment' },
  { name: 'whole-word TEA is food', description: 'TEA POINT HYDERABAD', direction: 'debit', account: CARD, kind: 'expense', category: 'food_dining', source: 'builtin_rule' },
  { name: 'SWIGGY INSTAMART is groceries', description: 'SWIGGY INSTAMART BANGALORE', direction: 'debit', account: CARD, kind: 'expense', category: 'groceries', merchant: 'Swiggy Instamart', merchantKey: 'swiggy instamart' },
  { name: 'SWIGGY alone is food', description: 'SWIGGY BANGALORE', direction: 'debit', account: CARD, kind: 'expense', category: 'food_dining', merchantKey: 'swiggy' },
  { name: 'NEFT SALARY is income/salary, not a personal transfer', description: 'NEFT SALARY', direction: 'credit', kind: 'income', category: 'salary', channel: 'NEFT' },
  { name: 'payroll NEFT with employer name', description: 'NEFT-HDFCN12345678-INFOSYS LIMITED-SAL JUN-HDFC0000104', direction: 'credit', amount: 8_000_000, kind: 'income', category: 'salary', merchant: 'Infosys', cpType: 'employer' },
  { name: 'ACH payroll credit', description: 'ACH/SAL-ACME PAYROLL JUN/123456789', direction: 'credit', kind: 'income', category: 'salary' },
  { name: 'UPI to Zerodha is an investment, not a personal transfer', description: 'UPI/412345678903/Payment from Ph/zerodha@yesbank/Yes Bank Ltd/YBL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'investment', category: 'investments', merchant: 'Zerodha', cpType: 'investment_platform' },
  { name: 'payment rails never decide a category', description: 'UPI/412345678904/NA/rajesh.kumar@okaxis/Axis Bank Ltd/AXL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', source: 'kind_default' },
  { name: 'a credit is not automatically income', description: 'UPI/412345678905/Payment from Ph/kavya.nair@oksbi/State Bank Of I/YBL1a2b3c4d5e6f7a8b9c', direction: 'credit', kind: 'p2p_in', category: 'received_from_people' },

  // ── ICICI savings: UPI ────────────────────────────────────────────────────────────────────────
  { name: 'UPI to a brand handle (Myntra via payu)', description: 'UPI/412345678902/UPIIntent/myntra.payu@icici/ICICI Bank/PPPL20100000000000000000001/', direction: 'debit', kind: 'expense', category: 'shopping', source: 'builtin_rule', merchant: 'Myntra', merchantKey: 'myntra', channel: 'UPI' },
  { name: 'UPI refund from truncated brand handle', description: 'UPI/412345678927/Refund/myntra2.payu@hd/HDF C BANKLTD/HDF1A2B3C4D5E6F708192A3B4C5D6E7F801', direction: 'credit', kind: 'refund', category: 'shopping', merchant: 'Myntra' },
  { name: 'Groww purchase via UPI is an investment', description: 'UPI/412345678940/Paid by Groww P/growwnbt1@yesg/Yes Bank Ltd/YJP240101010101V2A9IRSTP9GV9LH5DMD4/', direction: 'debit', kind: 'investment', category: 'investments', merchant: 'Groww' },
  { name: 'phone-number VPA is a person', description: 'UPI/412345678933/Payment from Ph/9000000001@ybl/State Bank Of I/YBL41b4c3c8a9d64f4293d88151a9b270c7', direction: 'credit', kind: 'p2p_in', category: 'received_from_people', cpType: 'person', merchantKey: '9000000001' },
  { name: 'phone-number VPA debit is p2p_out', description: 'UPI/412345678934/NA/9000000002@ibl/ICICI Bank/IBLa3b2c3d4e5f60718293a4b5c6d7e8f9', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', cpType: 'person', review: false },
  { name: 'firstname.lastname@okaxis is a person', description: 'UPI/412345678935/NA/priya.menon@okaxis/Axis Bank/AXL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', merchant: 'Priya Menon', cpType: 'person' },
  { name: 'Paytm QR is a merchant', description: 'UPI/412345678936/NA/paytmqr7x1a2b@ptys/Yes Bank Ltd/PTM1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'expense', category: 'uncategorized', cpType: 'merchant', review: true, reason: /merchant QR \(Paytm\)/ },
  { name: 'PhonePe merchant QR (Q-number VPA)', description: 'UPI~412345678926~Q987654321@ybl~RAMESH GOWDA -AXLe1b2c3d4e5f60718293a4b5c6db', direction: 'debit', account: SECOND, kind: 'expense', category: 'uncategorized', cpType: 'merchant', merchant: 'Ramesh Gowda', reason: /merchant QR \(PhonePe\)/ },
  { name: 'BharatPe QR', description: 'UPI~412345678931~BHARATPE.9A1B2C3D4E5F6789@fbpe~KAVITHA STORES -AXLa1b2c3d4e5f60718293a4b5c6d7', direction: 'debit', account: SECOND, kind: 'expense', category: 'uncategorized', cpType: 'merchant', reason: /BharatPe/ },
  { name: 'Google Pay for Business QR', description: 'UPI~412345678932~gpay-98765432109@okbizaxis~SAGAR HOTEL -AXLc1b2c3d4e5f60718293a4b5c6d9', direction: 'debit', account: SECOND, kind: 'expense', category: 'food_dining', source: 'builtin_rule', cpType: 'merchant' },
  { name: 'Bajaj Pay QR', description: 'UPI~412345678930~bajajpay.1357924.abcd1234@indus~RAJU TRADERS -AXLf1b2c3d4e5f60718293a4b5c6dc', direction: 'debit', account: SECOND, kind: 'expense', category: 'uncategorized', cpType: 'merchant', reason: /Bajaj Pay/ },
  { name: 'store POS handle (apollopharmacyoffline)', description: 'UPI~412345678928~APOLLOPHARMACYO FFLINE@axl~APOLLO -AXLb1b2c3d4e5f60718293a4b5c6d8', direction: 'debit', account: SECOND, kind: 'expense', category: 'healthcare', source: 'builtin_rule', merchant: 'Apollo Pharmacy', merchantKey: 'apollo pharmacy' },
  { name: 'Play Store handle', description: 'UPI/412345678906/NA/playstore@axisbank/Axis Bank/AXL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'expense', category: 'entertainment', merchant: 'Google Play' },
  { name: 'IRCTC handle is travel', description: 'UPI/412345678907/NA/irctc@sbi/State Bank Of India/SBI1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'expense', category: 'travel', merchant: 'IRCTC' },
  { name: 'Swiggy handle is food', description: 'UPI/412345678908/NA/swiggy@icici/ICICI Bank/ICI1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'expense', category: 'food_dining', merchant: 'Swiggy' },

  { name: 'alternate ICICI order: handle first, reference later (brand credit)', description: 'UPI/MEESHO@ybl/Payment from Ph/Yes Bank Ltd/412345678901/YBLa6b2c3d4e5f60718', direction: 'credit', kind: 'refund', category: 'shopping', merchant: 'Meesho' },
  { name: 'alternate ICICI order: person credit, bank without the word bank', description: 'UPI/snehal.k@ibl/Payment from Ph/AIRTEL PAYMENTS/412345678901/YBLa5b2c3d4e5f60718293a4b5c6d7', direction: 'credit', kind: 'p2p_in', category: 'received_from_people', merchant: 'Snehal K' },
  { name: 'handle truncated before the @ sign', description: 'UPI/sunil.varma77-/UPI/Canara Bank/412345678901/ICIa4b2c3d4e5f60718293a4b5', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', merchant: 'Sunil Varma' },

  // ── ICICI savings: other schemes ──────────────────────────────────────────────────────────────
  { name: 'IMPS to a person with a Family remark', description: 'MMT/IMPS/412345678923/Family 57012345/Sunita Rao/CNRB0001234', direction: 'debit', amount: 100_000, kind: 'p2p_out', category: 'family_support', channel: 'IMPS', cpType: 'person' },
  { name: 'IMPS to a person with a Friends remark', description: 'MMT/IMPS/412345678924/Friends/Rohit Bansal/UTIB0000999', direction: 'debit', amount: 100_000, kind: 'p2p_out', category: 'sent_to_people', channel: 'IMPS' },
  { name: 'CMS broker payout credit is an investment redemption', description: 'CMS/ GROWW WITHDRAW REQ ASHA NAIR/NEXTBILLIO', direction: 'credit', kind: 'investment_return', category: 'investments', channel: 'CMS', merchant: 'Groww' },
  { name: 'NEFT from a clearing corporation is a redemption', description: 'NEFT-AXNHN12345678-INDIAN CLEARING CORPORATION LTD-PAYOUT', direction: 'credit', kind: 'investment_return', category: 'investments' },
  { name: 'NEFT to a broker is an investment', description: 'NEFT-YESEBN12345678-ZERODHA BROKING LTD', direction: 'debit', kind: 'investment', category: 'investments' },
  { name: 'Personal loan EMI', description: 'Personal Loan XX48153 EMI Asha Nair', direction: 'debit', amount: 3_250_000, kind: 'loan_payment', category: 'loan_emi', review: false },
  { name: 'CRED payment is a card bill, not spending', description: 'CRED/DREAMPLUG /Yes Bank Ltd', direction: 'debit', kind: 'card_payment', category: 'card_payment', merchant: 'CRED' },
  { name: 'CRED via UPI handle', description: 'UPI/412345678909/NA/cred.club@axisb/Axis Bank/AXL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'card_payment', category: 'card_payment' },
  { name: 'ATM withdrawal', description: 'ATM/ZXQPA123/CASH WDL/10-07-24', direction: 'debit', kind: 'cash_withdrawal', category: 'cash', channel: 'ATM' },
  { name: 'NFS cash at another bank ATM', description: 'NFS/CASH WDL/123456/MG ROAD', direction: 'debit', kind: 'cash_withdrawal', category: 'cash', channel: 'ATM' },
  { name: 'dividend through ACH', description: 'ACH/ACME INDUSTRIES FIN DIV 24/N123456789', direction: 'credit', kind: 'income', category: 'other_income', channel: 'ACH', reason: /Dividend/ },
  { name: 'ACH debit to an AMC (SIP)', description: 'ACH D- NIPPON INDIA MUTUAL FUND-123456789', direction: 'debit', kind: 'investment', category: 'investments' },
  { name: 'NEFT payout from a branded company is income to confirm, not a retail refund', description: 'NEFT-HSBCN12345678-SWIGGY LIMITED-PAYOUT 22', direction: 'credit', kind: 'income', category: 'other_income', review: true },
  { name: 'ACH credit from a listed company is not a refund', description: 'ACH/TATA POWER COMPANY LTD/N123456789', direction: 'credit', kind: 'income', category: 'other_income', channel: 'ACH' },
  { name: 'income tax refund is income', description: 'NEFT-SBINN12345678-ITDTAX REFUND 2024-25', direction: 'credit', kind: 'income', category: 'other_income', cpType: 'government' },
  { name: 'net-banking card bill payment', description: 'BIL/123456789/ICICI BANK CREDIT CARD PAYMENT/123456', direction: 'debit', kind: 'card_payment', category: 'card_payment' },
  { name: 'internal transfer to a person', description: 'INF/INFT/123456789012/Rohit Bansal', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', channel: 'INTERNAL' },
  { name: 'bank interest', description: 'CREDIT INTEREST - Saving -123456789012', direction: 'credit', kind: 'interest', category: 'interest_income', channel: 'INTEREST', cpType: 'bank' },
  { name: 'ICICI interest paid', description: 'Int.Pd:01-04-2024 to 30-06-2024', direction: 'credit', kind: 'interest', category: 'interest_income' },
  { name: 'bank charges', description: 'SMS ALERT CHARGES 01-04-24 TO 30-06-24', direction: 'debit', amount: 1_770, kind: 'fee', category: 'fees_charges', channel: 'CHARGE' },
  { name: 'GST on charges', description: 'IGST-CGST ON SERVICE CHARGES', direction: 'debit', kind: 'fee', category: 'fees_charges' },
  { name: 'debit-card purchase (VPS)', description: 'VPS/AMAZON PAY INDIA/MUMBAI', direction: 'debit', kind: 'expense', category: 'shopping', channel: 'CARD', merchant: 'Amazon' },
  { name: 'mobile recharge (TOP)', description: 'TOP/AIRTEL/9000000001', direction: 'debit', kind: 'expense', category: 'mobile_internet', channel: 'BILLPAY', merchant: 'Airtel' },
  { name: 'ICICIdirect (EBA) is an investment', description: 'EBA/ICICIDIRECT/ABC123', direction: 'debit', kind: 'investment', category: 'investments' },
  { name: 'MAT cash withdrawal at another bank ATM', description: 'MAT/CASH WDL/PUNE/123456', direction: 'debit', kind: 'cash_withdrawal', category: 'cash', channel: 'ATM' },
  { name: 'BSE bill payment is an investment', description: 'BIL/ONL/123456789/BSE', direction: 'debit', kind: 'investment', category: 'investments' },
  { name: 'electricity bill through BIL', description: 'BIL/ONL/123456789/BESCOM', direction: 'debit', kind: 'expense', category: 'utilities', channel: 'BILLPAY' },
  { name: 'FD booking is an investment', description: 'FD BOOKING 123456', direction: 'debit', kind: 'investment', category: 'investments' },
  { name: 'FD maturity is a redemption', description: 'FD MATURITY PROCEEDS 123456', direction: 'credit', kind: 'investment_return', category: 'investments' },
  { name: 'TDS word alone is not a fee', description: 'UPI/412345678910/NA/tdsagency@ybl/Yes Bank Ltd/YBL1a2b3c4d5e6f7a8b9c', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people' },

  // ── other banks' layouts (generic parsing) ───────────────────────────────────────────────────
  { name: 'HDFC-style NEFT credit from a person', description: 'NEFT CR-HDFC0000001-MEERA NAIR-REF123456789', direction: 'credit', kind: 'p2p_in', category: 'received_from_people', channel: 'NEFT', merchant: 'Meera Nair' },
  { name: 'HDFC-style IMPS debit', description: 'IMPS-412345678901-MEERA NAIR-HDFC-XXXXXXXX1234-NA', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', channel: 'IMPS', merchant: 'Meera Nair' },
  { name: 'HDFC-style UPI row', description: 'UPI-MEERA NAIR-meera.nair@okaxis-UTIB0000001-412345678901-NA', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', merchant: 'Meera Nair', channel: 'UPI' },
  { name: 'SBI-style UPI row', description: 'TO TRANSFER-UPI/DR/412345678901/MEERA NAIR/SBIN/meera@sbi/NA', direction: 'debit', kind: 'p2p_out', category: 'sent_to_people', merchant: 'Meera Nair' },
  { name: 'POS purchase', description: 'POS 4147XXXXXXXX1234 SWIGGY', direction: 'debit', kind: 'expense', category: 'food_dining', channel: 'CARD' },
  { name: 'ATM withdrawal (ATW)', description: 'ATW-4147XXXXXXXX1234-Z9QPA456-HYDERABAD', direction: 'debit', kind: 'cash_withdrawal', category: 'cash', channel: 'ATM' },
  { name: 'NEFT salary from a named employer', description: 'NEFT-HDFCN52024061234567-INFOSYS LIMITED-SALARY JUN', direction: 'credit', kind: 'income', category: 'salary', merchant: 'Infosys' },

  // ── DBS ───────────────────────────────────────────────────────────────────────────────────────
  { name: 'DBS UPI to a person (wrapped VPA and name)', description: 'UPI~412345678937~rakeshvarmapd@ax l~VARMA RAKE -AXLa2b2c3d4e5f60718293a4b5c6dd', direction: 'debit', account: SECOND, kind: 'p2p_out', category: 'sent_to_people', cpType: 'person', merchantKey: 'varma rake' },
  { name: 'DBS UPI with phone VPA and name', description: 'UPI~412345678941~9000000003@ybl~NEELAM RAO -AXLd1b2c3d4e5f60718293a4b5c6da', direction: 'debit', account: SECOND, kind: 'p2p_out', category: 'sent_to_people', cpType: 'person', merchant: 'Neelam Rao' },
  { name: 'DBS IMPS from a stranger', description: 'IMP-412345678920-9000000011-MEERA NAIR -Bank of Baroda-IMPS Transacti', direction: 'credit', account: SECOND, kind: 'p2p_in', category: 'received_from_people', channel: 'IMPS', cpType: 'person' },
  { name: 'DBS NEFT in from a person', description: 'NEFTIN ICIN412345678925 MEERA NAIR -ICICI BANK LIMITED ICIC0000002', direction: 'credit', account: SECOND, kind: 'p2p_in', category: 'received_from_people', channel: 'NEFT' },
  { name: 'DBS credit interest', description: 'CREDIT INTEREST - Saving -412345678929', direction: 'credit', account: SECOND, kind: 'interest', category: 'interest_income' },

  // ── own accounts ──────────────────────────────────────────────────────────────────────────────
  { name: 'DBS IMPS to my own name (truncated)', description: 'IMP-412345678920-9000000011-ANIL KUMAR R -ICICI Bank Limi-IMPS Transacti', direction: 'debit', account: SECOND, kind: 'self_transfer', category: 'self_transfer', cpType: 'own_account' },
  { name: 'NEFT in with reordered own name', description: 'NEFTIN ICIN412345678925 RAO ANIL KUMAR -ICICI BANK LIMITED ICIC0000002', direction: 'credit', account: SECOND, kind: 'self_transfer', category: 'self_transfer', cpType: 'own_account' },
  { name: 'internet transfer to my own name', description: 'BIL/INFT/DFON/Family/ ANIL KUMAR RAO', direction: 'debit', kind: 'self_transfer', category: 'self_transfer', channel: 'INTERNAL' },
  { name: 'a family member sharing only the surname is a person', description: 'MMT/IMPS/412345678923/Family/SUNITA RAO/CNRB0001234', direction: 'debit', amount: 100_000, kind: 'p2p_out', category: 'family_support', cpType: 'person' },
  { name: 'own account mask in the description', description: 'TRANSFER TO XX2468 SAVINGS', direction: 'debit', kind: 'self_transfer', category: 'self_transfer', cpType: 'own_account' },

  // ── ICICI credit card ─────────────────────────────────────────────────────────────────────────
  { name: 'card bill payment received', description: 'INFINITY PAYMENT RECEIVED, THANK YOU', direction: 'credit', account: CARD, kind: 'card_payment', category: 'card_payment' },
  { name: 'card excess balance sent back to the bank is a transfer', description: 'Refund Amt Transfer to Bank Acc XX1357', direction: 'debit', account: CARD, kind: 'self_transfer', category: 'self_transfer' },
  { name: 'plain card merchant (Excitel broadband)', description: 'WWW EXCITEL COM', direction: 'debit', account: CARD, kind: 'expense', category: 'mobile_internet', merchant: 'Excitel' },
  { name: 'UPI-on-card wrap artifact: Amazon I ndia', description: 'UPI-412345678921-Amazon I ndia IN', direction: 'debit', account: CARD, kind: 'expense', category: 'shopping', merchant: 'Amazon', channel: 'UPI' },
  { name: 'UPI-on-card wrap artifact: ASTER PH ARMACY', description: 'UPI-412345678939-ASTER PH ARMACY IN', direction: 'debit', account: CARD, kind: 'expense', category: 'healthcare', merchant: 'Aster Pharmacy' },
  { name: 'UPI-on-card wrap artifact: RAMALAXM I NAGAR (unknown merchant)', description: 'UPI-412345678922-RAMALAXM I NAGAR TEKKI IN', direction: 'debit', account: CARD, kind: 'expense', category: 'uncategorized', source: 'none', merchant: 'Ramalaxmi Nagar Tekki', review: true },
  { name: 'initials stay initials', description: 'UPI-412345678938-P K BAKE RS IN', direction: 'debit', account: CARD, kind: 'expense', category: 'food_dining', merchant: 'P K Bakers' },
  { name: 'card merchant credit is a refund', description: 'MedPlus', direction: 'credit', account: CARD, kind: 'refund', category: 'healthcare', merchant: 'MedPlus' },
  { name: 'card annual fee', description: 'ANNUAL FEE', direction: 'debit', account: CARD, kind: 'fee', category: 'fees_charges' },
  { name: 'card finance charges', description: 'FINANCE CHARGES', direction: 'debit', account: CARD, kind: 'fee', category: 'fees_charges' },
  { name: 'card late payment fee', description: 'LATE PAYMENT FEE', direction: 'debit', account: CARD, kind: 'fee', category: 'fees_charges' },
  { name: 'card cash advance', description: 'CASH ADVANCE ATM 123456', direction: 'debit', account: CARD, kind: 'cash_withdrawal', category: 'cash' },
  { name: 'card cashback is a refund-type credit', description: 'CASHBACK CREDIT', direction: 'credit', account: CARD, kind: 'refund', category: 'refunds' },
];

describe('understand: table', () => {
  it.each(cases)('$name', (c) => {
    const u = run(c.description, c.direction, { account: c.account, amount: c.amount });
    expect(u.kind).toBe(c.kind);
    expect(u.category).toBe(c.category);
    if (c.source) expect(u.categorySource).toBe(c.source);
    if (c.merchant) expect(u.merchant).toBe(c.merchant);
    if (c.merchantKey) expect(u.merchantKey).toBe(c.merchantKey);
    if (c.channel) expect(u.channel).toBe(c.channel);
    if (c.cpType) expect(u.counterparty.type).toBe(c.cpType);
    if (c.review !== undefined) expect(u.needsReview).toBe(c.review);
    if (c.reason) expect(u.reasons.join(' | ')).toMatch(c.reason);
  });
});

describe('understand: output shape', () => {
  it('always returns reasons, a key, and keeps confidence in 0..1', () => {
    for (const c of cases) {
      const u = run(c.description, c.direction, { account: c.account, amount: c.amount });
      expect(u.reasons.length).toBeGreaterThan(0);
      expect(u.confidence).toBeGreaterThanOrEqual(0);
      expect(u.confidence).toBeLessThanOrEqual(1);
      expect(u.merchantKey).toBe(u.merchantKey.toLowerCase());
      expect(u.merchantKey).not.toMatch(/\s{2,}|^\s|\s$/);
      expect(u.merchant).not.toBe('');
    }
  });

  it('extracts reference, VPA, bank and IFSC into the counterparty', () => {
    const u = run('UPI/412345678901/Payment from Ph/meera.nair@oksbi/State Bank Of I/YBL1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6', 'credit');
    expect(u.reference).toBe('412345678901');
    expect(u.counterparty.vpa).toBe('meera.nair@oksbi');
    expect(u.counterparty.bank).toBe('State Bank of India');
    const imps = run('MMT/IMPS/412345678923/Family/Rohit Bansal/UTIB0000999', 'debit');
    expect(imps.counterparty.ifsc).toBe('UTIB0000999');
    expect(imps.reference).toBe('412345678923');
    const neft = run('NEFTIN ICIN412345678925 MEERA NAIR -ICICI BANK LIMITED ICIC0000002', 'credit', { account: SECOND });
    expect(neft.counterparty.ifsc).toBe('ICIC0000002');
    expect(neft.counterparty.bank).toBe('ICICI Bank');
  });

  it('is deterministic and does not mutate its inputs', () => {
    const a = run('UPI/412345678902/UPIIntent/myntra.payu@icici/ICICI Bank/PPPL201', 'debit');
    const b = run('UPI/412345678902/UPIIntent/myntra.payu@icici/ICICI Bank/PPPL201', 'debit');
    expect(a).toEqual(b);
  });
});

describe('confidence, sources and review', () => {
  it('uses calibrated confidences per decision source', () => {
    expect(run('SWIGGY BANGALORE', 'debit', { account: CARD }).confidence).toBe(0.9);
    expect(run('UPI/412345678902/UPIIntent/myntra.payu@icici/ICICI Bank/PPPL201', 'debit').confidence).toBe(0.85);
    expect(run('TEA POINT HYDERABAD', 'debit', { account: CARD }).confidence).toBe(0.6);
    expect(run('ZZQ UNKNOWN SHOP', 'debit', { account: CARD })).toMatchObject({ category: 'uncategorized', categorySource: 'none', confidence: 0 });
    expect(run('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit').confidence).toBe(0.6);
  });

  it('keeps categorySource separate from confidence', () => {
    const brand = run('SWIGGY BANGALORE', 'debit', { account: CARD });
    const keyword = run('TEA POINT HYDERABAD', 'debit', { account: CARD });
    expect(brand.categorySource).toBe('builtin_rule');
    expect(keyword.categorySource).toBe('builtin_rule');
    expect(brand.confidence).toBeGreaterThan(keyword.confidence);
  });

  it('flags review for low confidence, unknown kind, uncategorized spending and large p2p_out', () => {
    const unknown = run('SOME GIBBERISH TEXT', 'debit');
    expect(unknown.kind).toBe('unknown');
    expect(unknown.needsReview).toBe(true);
    expect(unknown.reviewReasons.join(' ')).toMatch(/tell what/);

    const uncategorized = run('ZZQ UNKNOWN SHOP', 'debit', { account: CARD });
    expect(uncategorized.needsReview).toBe(true);
    expect(uncategorized.reviewReasons.join(' ')).toMatch(/No category/);

    const small = run('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', { amount: 499_999 });
    expect(small.needsReview).toBe(false);
    const atThreshold = run('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', { amount: 500_000 });
    expect(atThreshold.needsReview).toBe(true);
    expect(atThreshold.reviewReasons.join(' ')).toMatch(/Large transfer/);
    const custom = run('UPI/412345678868/NA/priya.menon@okaxis/Axis Bank/AXL1', 'debit', { amount: 100_000, ctx: { p2pReviewThreshold: 100_000 } });
    expect(custom.needsReview).toBe(true);

    expect(run('SWIGGY BANGALORE', 'debit', { account: CARD }).needsReview).toBe(false);
    expect(run('NEFT SALARY', 'credit').needsReview).toBe(false);
  });

  it('does not flag large incoming transfers', () => {
    const u = run('UPI/412345678905/Payment from Ph/kavya.nair@oksbi/State Bank Of I/YBL1', 'credit', { amount: 5_000_000 });
    expect(u.kind).toBe('p2p_in');
    expect(u.needsReview).toBe(false);
  });

  it('describes the decision in human-readable reasons', () => {
    expect(run('SWIGGY INSTAMART BANGALORE', 'debit', { account: CARD }).reasons.join(' | ')).toMatch(/Matched "Swiggy Instamart" \(merchant\) → Groceries/);
    expect(run('UPI~412345678926~Q987654321@ybl~RAMESH GOWDA -AXL1', 'debit', { account: SECOND }).reasons).toContain('UPI payment to a merchant QR (PhonePe)');
  });
});

describe('ledger principle: unknowns are conservative', () => {
  it('does not turn unknown credits into income', () => {
    const u = run('SOME GIBBERISH TEXT', 'credit');
    expect(u.kind).toBe('unknown');
  });
  it('a credit from a retail merchant is a refund needing confirmation, never income', () => {
    const u = run('UPI/412345678911/NA/paytmqr7x1a2b@ptys/Yes Bank Ltd/PTM1', 'credit');
    expect(u.kind).toBe('refund');
    expect(u.needsReview).toBe(true);
  });
  it('credit from a company via NEFT is income but asks for confirmation', () => {
    const u = run('NEFT-HDFCN12345678-ACME SOLUTIONS PRIVATE LIMITED-INV 22', 'credit');
    expect(u.kind).toBe('income');
    expect(u.needsReview).toBe(true);
  });
});

describe('own accounts', () => {
  const lone = makeAccount('solo', 'savings', '1111', 'PRIYA MENON');
  it('needs no holder name when there is no match', () => {
    const u = run('IMP-412345678920-9000000011-ANIL KUMAR R -ICICI Bank Limi-IMPS Transacti', 'debit', { account: lone, ctx: { ownAccounts: [lone] } });
    expect(u.kind).toBe('p2p_out');
  });
  it('matches initials and truncated tokens', () => {
    const u = run('IMP-412345678920-9000000011-A KUMAR RAO -ICICI Bank Limi-IMPS Transacti', 'debit', { account: SECOND });
    expect(u.kind).toBe('self_transfer');
  });
  it('a single shared token is not enough', () => {
    const u = run('IMP-412345678920-9000000011-RAO -ICICI Bank Limi-IMPS Transacti', 'debit', { account: SECOND });
    expect(u.kind).toBe('p2p_out');
  });
  it('detects add-on card masks', () => {
    const withExtra: Account = { ...SECOND, extraMasks: ['5555'] };
    const u = run('TRANSFER TO XX5555', 'debit', { account: SAVINGS, ctx: { ownAccounts: [SAVINGS, withExtra, CARD] } });
    expect(u.kind).toBe('self_transfer');
  });
  it('ignores the account\'s own mask', () => {
    const u = run('Personal Loan XX1357 EMI Asha', 'debit');
    expect(u.kind).toBe('loan_payment');
  });
});

describe('user rules', () => {
  it('apply before any built-in knowledge', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'gifts_donations' } });
    const u = run('SWIGGY BANGALORE', 'debit', { account: CARD, ctx: { rules: [rule] } });
    expect(u.category).toBe('gifts_donations');
    expect(u.categorySource).toBe('user_rule');
    expect(u.confidence).toBe(0.98);
    expect(u.needsReview).toBe(false);
  });
  it('can set kind, and the kind drives the category', () => {
    const rule = makeRule({ match: { field: 'description', op: 'contains', value: 'rajesh.kumar' }, set: { kind: 'expense' } });
    const u = run('UPI/412345678904/NA/rajesh.kumar@okaxis/Axis Bank Ltd/AXL1', 'debit', { ctx: { rules: [rule] } });
    expect(u.kind).toBe('expense');
    expect(u.kindSource).toBe('user_rule');
  });
  it('turns a person into a spending kind when the rule sets a spending category', () => {
    const rule = makeRule({ match: { field: 'vpa', op: 'equals', value: 'rajesh.kumar@okaxis' }, set: { category: 'rent_housing' } });
    const u = run('UPI/412345678904/NA/rajesh.kumar@okaxis/Axis Bank Ltd/AXL1', 'debit', { ctx: { rules: [rule] } });
    expect(u).toMatchObject({ kind: 'expense', category: 'rent_housing', categorySource: 'user_rule', kindSource: 'user_rule' });
  });
  it('can rename the merchant without changing its key', () => {
    const rule = makeRule({ match: { field: 'merchantKey', op: 'equals', value: 'excitel' }, set: { merchant: 'Home WiFi' } });
    const u = run('WWW EXCITEL COM', 'debit', { account: CARD, ctx: { rules: [rule] } });
    expect(u.merchant).toBe('Home WiFi');
    expect(u.merchantKey).toBe('excitel');
  });
  it('honours enabled, account and direction restrictions', () => {
    const base = { match: { field: 'merchantKey', op: 'equals', value: 'swiggy' } as const, set: { category: 'gifts_donations' } };
    const off = makeRule({ ...base, enabled: false });
    const otherAccount = makeRule({ ...base, accountId: 'elsewhere' });
    const otherDirection = makeRule({ ...base, direction: 'credit' });
    for (const rule of [off, otherAccount, otherDirection]) {
      expect(run('SWIGGY BANGALORE', 'debit', { account: CARD, ctx: { rules: [rule] } }).category).toBe('food_dining');
    }
    const right = makeRule({ ...base, accountId: 'card', direction: 'debit' });
    expect(run('SWIGGY BANGALORE', 'debit', { account: CARD, ctx: { rules: [right] } }).category).toBe('gifts_donations');
  });
  it('prefers the more specific rule', () => {
    const loose = makeRule({ id: 'a', match: { field: 'description', op: 'contains', value: 'swiggy' }, set: { category: 'shopping' } });
    const exact = makeRule({ id: 'b', match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: { category: 'fitness' } });
    expect(run('SWIGGY BANGALORE', 'debit', { account: CARD, ctx: { rules: [loose, exact] } }).category).toBe('fitness');
  });
});

describe('ruleMatches', () => {
  const txn = {
    accountId: 'a1',
    direction: 'debit' as Direction,
    merchantKey: 'swiggy instamart',
    counterparty: { type: 'merchant' as const, vpa: 'swiggy@icici' },
    rawDescription: 'UPI/123/NA/swiggy@icici/ICICI Bank',
  };
  const table: Array<[string, Parameters<typeof makeRule>[0], boolean]> = [
    ['merchantKey equals (case-insensitive)', { match: { field: 'merchantKey', op: 'equals', value: 'Swiggy Instamart' }, set: {} }, true],
    ['merchantKey equals miss', { match: { field: 'merchantKey', op: 'equals', value: 'swiggy' }, set: {} }, false],
    ['merchantKey contains', { match: { field: 'merchantKey', op: 'contains', value: 'INSTA' }, set: {} }, true],
    ['vpa equals', { match: { field: 'vpa', op: 'equals', value: 'SWIGGY@icici' }, set: {} }, true],
    ['vpa contains', { match: { field: 'vpa', op: 'contains', value: '@icici' }, set: {} }, true],
    ['description contains', { match: { field: 'description', op: 'contains', value: 'icici bank' }, set: {} }, true],
    ['description equals miss', { match: { field: 'description', op: 'equals', value: 'swiggy' }, set: {} }, false],
    ['account mismatch', { match: { field: 'merchantKey', op: 'contains', value: 'swiggy' }, accountId: 'a2', set: {} }, false],
    ['account match', { match: { field: 'merchantKey', op: 'contains', value: 'swiggy' }, accountId: 'a1', set: {} }, true],
    ['direction mismatch', { match: { field: 'merchantKey', op: 'contains', value: 'swiggy' }, direction: 'credit', set: {} }, false],
    ['disabled', { match: { field: 'merchantKey', op: 'contains', value: 'swiggy' }, enabled: false, set: {} }, false],
    ['empty value never matches', { match: { field: 'merchantKey', op: 'contains', value: '  ' }, set: {} }, false],
  ];
  it.each(table)('%s', (_name, partial, expected) => {
    expect(ruleMatches(makeRule(partial), txn)).toBe(expected);
  });
  it('a vpa rule cannot match a transaction without a VPA', () => {
    const rule = makeRule({ match: { field: 'vpa', op: 'contains', value: 'x' }, set: {} });
    expect(ruleMatches(rule, { ...txn, counterparty: { type: 'person' } })).toBe(false);
  });
});

describe('normalizeMerchantKey', () => {
  const table: Array<[string, string]> = [
    ['Amazon I ndia IN', 'amazon india'],
    ['ASTER PH ARMACY IN', 'aster pharmacy'],
    ['RAMALAXM I NAGAR TEKKI IN', 'ramalaxmi nagar tekki'],
    ['  Swiggy   Instamart  ', 'swiggy instamart'],
    ['Acme Foods PVT LTD', 'acme foods'],
    ['Acme Foods Private Limited', 'acme foods'],
    ['UPI-412345678921-MedPlus IN', 'medplus'],
    ['WWW EXCITEL COM', 'excitel'],
    ['H&M', 'h and m'],
    ['Cult.fit', 'cult fit'],
    ['P K BAKE RS IN', 'p k bakers'],
    ['', ''],
  ];
  it.each(table)('%j → %j', (input, expected) => {
    expect(normalizeMerchantKey(input)).toBe(expected);
  });
  it('is idempotent', () => {
    for (const [input] of table) {
      const once = normalizeMerchantKey(input);
      expect(normalizeMerchantKey(once)).toBe(once);
    }
  });
  it('gives Swiggy the same key on a DBS UPI row and an ICICI card row', () => {
    const dbs = run('UPI~123456789012~swiggy@icici~SWIGGY -AXL1a2b3c4d5e6f7a8b9c0d1e2f3', 'debit', { account: SECOND });
    const card = run('UPI-412345678921-SWIGGY BANGALORE IN', 'debit', { account: CARD });
    expect(dbs.merchantKey).toBe('swiggy');
    expect(card.merchantKey).toBe(dbs.merchantKey);
  });
});

describe('dictionary', () => {
  it('is large', () => {
    expect(DICTIONARY_SIZE.brands).toBeGreaterThan(500);
    expect(DICTIONARY_SIZE.aliases).toBeGreaterThan(1000);
  });

  const brands: Array<[string, string]> = [
    ['BLINKIT GURGAON', 'groceries'],
    ['ZEPTO MARKETPLACE', 'groceries'],
    ['BIGBASKET', 'groceries'],
    ['DMART AVENUE SUPERMARTS', 'groceries'],
    ['ZOMATO ORDER', 'food_dining'],
    ["MCDONALD'S", 'food_dining'],
    ['STARBUCKS COFFEE', 'food_dining'],
    ['UBER INDIA SYSTEMS', 'transport'],
    ['OLA CABS', 'transport'],
    ['BHARAT PETROLEUM FUEL', 'transport'],
    ['FASTAG RECHARGE', 'transport'],
    ['NETFLIX.COM', 'entertainment'],
    ['BOOKMYSHOW', 'entertainment'],
    ['SPOTIFY INDIA', 'entertainment'],
    ['MAKEMYTRIP INDIA', 'travel'],
    ['INDIGO AIRLINES', 'travel'],
    ['IRCTC WEB', 'travel'],
    ['APOLLO PHARMACY', 'healthcare'],
    ['PHARMEASY', 'healthcare'],
    ['AIRTEL PREPAID', 'mobile_internet'],
    ['JIO RECHARGE', 'mobile_internet'],
    ['BESCOM', 'utilities'],
    ['MAHANAGAR GAS', 'utilities'],
    ['LIC OF INDIA', 'insurance'],
    ['HDFC LIFE', 'insurance'],
    ['LENSKART', 'shopping'],
    ['FLIPKART INTERNET', 'shopping'],
    ['CULT.FIT', 'fitness'],
    ['UDEMY', 'education'],
    ['NOBROKER', 'rent_housing'],
    ['INCOME TAX DEPARTMENT', 'taxes'],
    ['URBAN COMPANY', 'personal_care'],
    ['GITHUB', 'subscriptions'],
  ];
  it.each(brands)('%s → %s', (description, category) => {
    const u = run(description, 'debit', { account: CARD });
    expect(u.category).toBe(category);
    expect(u.categorySource).toBe('builtin_rule');
    expect(u.confidence).toBe(0.9);
  });

  const notBrands = ['SHOP', 'STORE', 'MART', 'AUTO', 'GAME', 'CENTRAL', 'MORE', 'MAX', 'EMI', 'GASTRONOMY', 'CABIN', 'BARNES', 'LABEL', 'TEAM', 'FDA', 'SIPPER'];
  it.each(notBrands)('generic or embedded word %s does not win', (word) => {
    const u = run(word, 'debit', { account: CARD });
    expect(u.categorySource).not.toBe('builtin_rule');
  });

  const wordBoundary: Array<[string, string | null]> = [
    ['LAB REPORTS CENTRE', 'healthcare'],
    ['LABEL FACTORY', null],
    ['GAS AGENCY', 'utilities'],
    ['VEGAS CLUB', null],
    ['CAB SERVICE', 'transport'],
    ['CABINET WORKS', null],
    ['SUNRISE BAR', 'food_dining'],
    ['BARCODE TECH', null],
  ];
  it.each(wordBoundary)('keyword %s → %s', (description, category) => {
    const u = run(description, 'debit', { account: CARD });
    if (category) expect(u.category).toBe(category);
    else expect(u.category).toBe('uncategorized');
  });
});

describe('credit card ledger semantics', () => {
  it('card debits are purchases and card credits are never income', () => {
    const debit = run('SOME MERCHANT', 'debit', { account: CARD });
    const credit = run('SOME MERCHANT', 'credit', { account: CARD });
    expect(debit.kind).toBe('expense');
    expect(credit.kind).toBe('refund');
    expect(credit.kind).not.toBe('income');
  });
});

describe('robustness', () => {
  const odd = [
    '',
    '   ',
    '@',
    'UPI/',
    'UPI//',
    'UPI/////',
    'UPI~~~',
    'IMP---',
    'MMT/IMPS/',
    'NEFT-',
    'ACH/',
    'CMS/',
    'BIL/',
    '12345678901234567890',
    'X'.repeat(5000),
    'UPI/412345678901/' + 'a/'.repeat(200),
    '₹₹₹ ☃ 日本語 UPI',
    'XX XX XX 1234',
    'UPI/412345678901/NA/@ybl/Yes Bank/',
  ];
  it.each(odd)('does not throw on %j', (description) => {
    for (const account of [SAVINGS, CARD, SECOND]) {
      for (const direction of ['debit', 'credit'] as const) {
        const u = run(description, direction, { account });
        expect(typeof u.merchant).toBe('string');
        expect(u.merchant.length).toBeGreaterThan(0);
        expect(u.reasons.length).toBeGreaterThan(0);
        expect(Number.isFinite(u.confidence)).toBe(true);
      }
    }
  });
  it('treats an empty description as unknown and flags it', () => {
    const u = run('', 'debit');
    expect(u.kind).toBe('unknown');
    expect(u.needsReview).toBe(true);
    expect(u.merchantKey).toBe('');
  });
});
