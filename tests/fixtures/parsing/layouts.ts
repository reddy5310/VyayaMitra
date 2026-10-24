/**
 * Layout-level fixtures for the universal engine: one invented ledger rendered in the column
 * layouts of many banks and card issuers. Every name, number and reference here is made up.
 */
import { inr, L, R, layoutDoc, type Cell, type LineSpec } from './builders';
import type { LayoutDoc } from '@/parsing/pdf/types';

export interface LTxn {
  /** ISO date */
  date: string;
  desc: string[];
  amount: number;
  dir: 'debit' | 'credit';
}

export const LEDGER_OPENING = 2_500_000; // ₹25,000.00

export const LEDGER: LTxn[] = [
  { date: '2024-04-01', desc: ['UPI/ASHA VERMA/ground rent', 'share april'], amount: 125_050, dir: 'debit' },
  { date: '2024-04-02', desc: ['NEFT-EXAMPLE EMPLOYER PVT LTD SALARY MAR'], amount: 4_500_000, dir: 'credit' },
  { date: '2024-04-03', desc: ['POS EXAMPLE MART BENGALURU'], amount: 34_900, dir: 'debit' },
  { date: '2024-04-05', desc: ['ATM CASH WDL EXAMPLE ROAD', 'TERMINAL 0042'], amount: 1_000_000, dir: 'debit' },
  { date: '2024-04-08', desc: ['INT.PD FOR QUARTER'], amount: 1_275, dir: 'credit' },
  { date: '2024-04-12', desc: ['ECOM PUR EXAMPLEKART'], amount: 249_999, dir: 'debit' },
  { date: '2024-04-15', desc: ['IMPS-REFUND-EXAMPLESHOP', 'ORDER REF 7788'], amount: 80_000, dir: 'credit' },
  { date: '2024-04-20', desc: ['UPI/RAVI KUMAR/dinner share'], amount: 100_000, dir: 'debit' },
];

export function ledgerBalances(txns: LTxn[] = LEDGER, opening = LEDGER_OPENING): number[] {
  let b = opening;
  return txns.map((t) => (b += t.dir === 'debit' ? -t.amount : t.amount));
}

// ── date formatting ──────────────────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
export const fmt = {
  dmySlash2: (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`,
  dmyDash: (iso: string) => `${iso.slice(8)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`,
  dmySlash: (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`,
  mdySlash: (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8)}/${iso.slice(0, 4)}`,
  dMonY: (iso: string) => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`,
  dMonY2: (iso: string) => `${p2(Number(iso.slice(8)))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}`,
  monD: (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}`,
  dMon: (iso: string) => `${p2(Number(iso.slice(8)))} ${MON[Number(iso.slice(5, 7)) - 1]}`,
  dashMon: (iso: string) => `${iso.slice(8)}-${MON[Number(iso.slice(5, 7)) - 1].toUpperCase()}-${iso.slice(2, 4)}`,
};

// ── generic ledger renderer ──────────────────────────────────────────────────

interface RowCtx {
  t: LTxn;
  i: number;
  bal: number;
}

interface LedgerSpec {
  preamble: string[];
  headerCells: Cell[];
  /** Cells printed on the date line (include the first description line). */
  row: (c: RowCtx) => Cell[];
  descX: number;
  opening?: (bal: number) => Cell[];
  closing?: (bal: number) => Cell[];
  txns?: LTxn[];
  openingBalance?: number;
  headerY?: number;
  pitch?: number;
  rowGap?: number;
  /** Omit the header row entirely. */
  noHeader?: boolean;
  /** Extra lines after the table. */
  footer?: string[];
}

export function ledgerDoc(s: LedgerSpec): LayoutDoc {
  const txns = s.txns ?? LEDGER;
  const opening = s.openingBalance ?? LEDGER_OPENING;
  const headerY = s.headerY ?? 160;
  const pitch = s.pitch ?? 9;
  const gap = s.rowGap ?? 5;
  const lines: LineSpec[] = [];
  s.preamble.forEach((t, i) => lines.push({ y: 40 + i * 12, cells: [L(40, t)] }));
  if (!s.noHeader) lines.push({ y: headerY, cells: s.headerCells });
  let y = headerY + 16;
  if (s.opening) {
    lines.push({ y, cells: s.opening(opening) });
    y += pitch + gap;
  }
  const bals = ledgerBalances(txns, opening);
  txns.forEach((t, i) => {
    lines.push({ y, cells: s.row({ t, i, bal: bals[i] }) });
    t.desc.slice(1).forEach((d, k) => lines.push({ y: y + (k + 1) * pitch, cells: [L(s.descX, d)] }));
    y += (t.desc.length - 1) * pitch + pitch + gap;
  });
  if (s.closing) {
    lines.push({ y, cells: s.closing(bals[bals.length - 1]) });
    y += pitch + gap;
  }
  (s.footer ?? []).forEach((t, i) => lines.push({ y: y + 20 + i * 12, cells: [L(40, t)] }));
  return layoutDoc([lines]);
}

const amt = (t: LTxn) => inr(t.amount);

// ── bank layouts ─────────────────────────────────────────────────────────────

/** HDFC style: Withdrawal Amt. / Deposit Amt. / Closing Balance, narration wraps below. */
export function hdfcLike(): LayoutDoc {
  return ledgerDoc({
    preamble: ['HDFC BANK LIMITED', 'Statement of account', 'Account No : 50100000000999', 'Statement From : 01/04/2024 To : 30/04/2024'],
    headerCells: [L(40, 'Date'), L(95, 'Narration'), L(268, 'Chq./Ref.No.'), L(356, 'Value Dt'), R(455, 'Withdrawal Amt.'), R(520, 'Deposit Amt.'), R(580, 'Closing Balance')],
    descX: 95,
    row: ({ t, i, bal }) => [
      L(40, fmt.dmySlash2(t.date)),
      L(95, t.desc[0]),
      L(268, `000040900${String(i).padStart(4, '0')}`),
      L(356, fmt.dmySlash2(t.date)),
      R(t.dir === 'debit' ? 448 : 514, amt(t)),
      R(578, inr(bal)),
    ],
  });
}

/** SBI with bilingual Hindi / English headers and "1 Apr 2024" dates. */
export function sbiBilingual(): LayoutDoc {
  return ledgerDoc({
    preamble: ['State Bank of India', 'भारतीय स्टेट बैंक', 'Account Statement', 'Account Number : 00000012345678901', 'Statement From : 1 Apr 2024 to 30 Apr 2024'],
    headerCells: [L(30, 'दिनांक Date'), L(110, 'विवरण Description'), L(280, 'Ref No./Cheque No.'), R(400, 'नामे Debit'), R(465, 'जमा Credit'), R(540, 'शेष Balance')],
    descX: 110,
    row: ({ t, bal }) => [L(30, fmt.dMonY(t.date)), L(110, t.desc[0]), R(t.dir === 'debit' ? 398 : 463, amt(t)), R(538, inr(bal))],
  });
}

/** Axis: DR / CR / BAL / SOL columns, dd-mm-yyyy. */
export function axisLike(): LayoutDoc {
  return ledgerDoc({
    preamble: ['AXIS BANK LIMITED', 'Statement of Axis Account No : 000000000001 for the period (From : 01-04-2024 To : 30-04-2024)'],
    headerCells: [L(30, 'Tran Date'), L(100, 'CHQNO'), L(150, 'PARTICULARS'), R(400, 'DR'), R(460, 'CR'), R(520, 'BAL'), L(540, 'SOL')],
    descX: 150,
    row: ({ t, bal }) => [L(30, fmt.dmyDash(t.date)), L(150, t.desc[0]), R(t.dir === 'debit' ? 398 : 458, amt(t)), R(518, inr(bal)), L(540, '1234')],
  });
}

/** Kotak: one Withdrawal (Dr)/Deposit (Cr) column with (Dr)/(Cr) suffix, balance with (Cr). */
export function kotakLike(): LayoutDoc {
  return ledgerDoc({
    preamble: ['Kotak Mahindra Bank', 'Account Statement', 'Statement Period : 01 Apr 2024 - 30 Apr 2024'],
    headerCells: [L(30, 'Date'), L(90, 'Narration'), L(300, 'Chq/Ref No'), R(430, 'Withdrawal (Dr)/ Deposit (Cr)'), R(520, 'Balance')],
    descX: 90,
    row: ({ t, i, bal }) => [
      L(30, fmt.dMonY(t.date)),
      L(90, t.desc[0]),
      L(300, `UPI${String(i).padStart(5, '0')}`),
      R(430, `${amt(t)}(${t.dir === 'debit' ? 'Dr' : 'Cr'})`),
      R(520, `${inr(bal)}(Cr)`),
    ],
  });
}

/** Bank of Baroda: serial number first, then transaction and value dates. */
export function bobSerialFirst(): LayoutDoc {
  return ledgerDoc({
    preamble: ['Bank of Baroda', 'Statement of Account', 'From 01/04/2024 To 30/04/2024'],
    headerCells: [L(30, 'Sr No'), L(70, 'Txn Date'), L(130, 'Value Date'), L(200, 'Description'), L(330, 'Cheque No'), R(410, 'Debit'), R(470, 'Credit'), R(540, 'Balance')],
    descX: 200,
    row: ({ t, i, bal }) => [
      L(30, String(i + 1)),
      L(70, fmt.dmySlash(t.date)),
      L(130, fmt.dmySlash(t.date)),
      L(200, t.desc[0]),
      R(t.dir === 'debit' ? 408 : 468, amt(t)),
      R(538, inr(bal)),
    ],
  });
}

/** PNB: unknown Txn No. and Branch columns, Dr Amount / Cr Amount, balance with Cr suffix. */
export function pnbLike(): LayoutDoc {
  return ledgerDoc({
    preamble: ['Punjab National Bank', 'Account Statement for A/c XXXXXX4321', 'Statement Period 01/04/2024 to 30/04/2024'],
    headerCells: [L(30, 'Txn No.'), L(70, 'Txn Date'), L(130, 'Description'), L(300, 'Branch Name'), R(420, 'Dr Amount'), R(480, 'Cr Amount'), R(550, 'Balance')],
    descX: 130,
    row: ({ t, i, bal }) => [
      L(30, `S${i + 100}`),
      L(70, fmt.dmySlash(t.date)),
      L(130, t.desc[0]),
      L(300, 'MAIN BRANCH'),
      R(t.dir === 'debit' ? 418 : 478, amt(t)),
      R(548, `${inr(bal)} Cr`),
    ],
  });
}

/** IDFC style description-first: particulars on the left, date after it. */
export function idfcDescriptionFirst(): LayoutDoc {
  return ledgerDoc({
    preamble: ['IDFC FIRST Bank', 'Statement of Account', 'Statement Period : 01-Apr-2024 to 30-Apr-2024'],
    headerCells: [L(30, 'Particulars'), L(250, 'Transaction Date'), R(400, 'Debit'), R(460, 'Credit'), R(530, 'Balance')],
    descX: 30,
    row: ({ t, bal }) => [L(30, t.desc[0]), L(250, fmt.dMonY2(t.date)), R(t.dir === 'debit' ? 398 : 458, amt(t)), R(528, inr(bal))],
  });
}

/** Yes Bank: one signed Amount column (negative = money out). */
export function yesSigned(): LayoutDoc {
  return ledgerDoc({
    preamble: ['YES BANK', 'Account Statement', 'Period : 01/04/2024 - 30/04/2024'],
    headerCells: [L(30, 'Transaction Date'), L(120, 'Description'), R(420, 'Amount'), R(520, 'Balance')],
    descX: 120,
    row: ({ t, bal }) => [L(30, fmt.dmySlash(t.date)), L(120, t.desc[0]), R(418, `${t.dir === 'debit' ? '-' : ''}${amt(t)}`), R(518, inr(bal))],
  });
}

/** IndusInd: Amount column with a separate Dr/Cr indicator column. */
export function indusindDrCrColumn(): LayoutDoc {
  return ledgerDoc({
    preamble: ['IndusInd Bank', 'Statement of Account', 'Statement Period : 01-04-2024 to 30-04-2024'],
    headerCells: [L(30, 'Date'), L(100, 'Particulars'), L(300, 'Chq No'), R(420, 'Amount'), L(436, 'Dr/Cr'), R(520, 'Balance')],
    descX: 100,
    row: ({ t, bal }) => [L(30, fmt.dmyDash(t.date)), L(100, t.desc[0]), R(418, amt(t)), L(438, t.dir === 'debit' ? 'DR' : 'CR'), R(518, inr(bal))],
  });
}

/** Federal Bank: several unknown columns (Tran Type, Tran ID) that must not leak into descriptions. */
export function federalLike(): LayoutDoc {
  return ledgerDoc({
    preamble: ['The Federal Bank Limited', 'Statement of Account', 'From 01/04/2024 to 30/04/2024'],
    headerCells: [L(30, 'Date'), L(90, 'Value Date'), L(150, 'Particulars'), L(280, 'Tran Type'), L(330, 'Tran ID'), L(390, 'Cheque Details'), R(470, 'Withdrawals'), R(530, 'Deposits'), R(600, 'Balance')],
    descX: 150,
    row: ({ t, i, bal }) => [
      L(30, fmt.dmyDash(t.date)),
      L(90, fmt.dmyDash(t.date)),
      L(150, t.desc[0]),
      L(280, 'TFR'),
      L(330, `S${1000000 + i}`),
      R(t.dir === 'debit' ? 468 : 528, amt(t)),
      R(598, `${inr(bal)} Cr`),
    ],
  });
}

/** No header row at all: date, description, debit, credit, balance. */
export function headerless(): LayoutDoc {
  return ledgerDoc({
    preamble: ['Example Co-operative Bank Ltd', 'Pass book print'],
    headerCells: [],
    noHeader: true,
    descX: 100,
    row: ({ t, bal }) => [L(30, fmt.dmyDash(t.date)), L(100, t.desc[0]), R(t.dir === 'debit' ? 400 : 460, amt(t)), R(530, inr(bal))],
  });
}

/** Month-first dates (04/14/2024). */
export function mdyDates(): LayoutDoc {
  return ledgerDoc({
    preamble: ['Example Bank N.A.', 'Statement of Account'],
    headerCells: [L(30, 'Date'), L(100, 'Description'), R(400, 'Debit'), R(460, 'Credit'), R(530, 'Balance')],
    descX: 100,
    row: ({ t, bal }) => [L(30, fmt.mdySlash(t.date)), L(100, t.desc[0]), R(t.dir === 'debit' ? 398 : 458, amt(t)), R(528, inr(bal))],
  });
}

/** Two-page statement whose header repeats and whose description wraps across the page break. */
export function pageBreakStitching(): LayoutDoc {
  const mk = (lines: LineSpec[]) => lines;
  const header = (y: number): LineSpec => ({
    y,
    cells: [L(40, 'Date'), L(95, 'Narration'), R(455, 'Withdrawal Amt.'), R(520, 'Deposit Amt.'), R(580, 'Closing Balance')],
  });
  const page1 = mk([
    { y: 40, cells: [L(40, 'HDFC BANK LIMITED')] },
    header(100),
    { y: 120, cells: [L(40, '01/04/24'), L(95, 'POS EXAMPLE MART'), R(448, '100.00'), R(578, '24,900.00')] },
    { y: 780, cells: [L(40, '02/04/24'), L(95, 'UPI/ASHA VERMA/long note'), R(448, '50.00'), R(578, '24,850.00')] },
    { y: 789, cells: [L(95, 'continues on next page')] },
    { y: 820, cells: [L(40, 'Page 1 of 2')] },
  ]);
  const page2 = mk([
    header(100),
    { y: 111, cells: [L(95, 'and ends here')] },
    { y: 130, cells: [L(40, '03/04/24'), L(95, 'SALARY'), R(514, '1,000.00'), R(578, '25,850.00')] },
    { y: 820, cells: [L(40, 'Page 2 of 2')] },
  ]);
  return layoutDoc([page1, page2]);
}

// ── credit cards ─────────────────────────────────────────────────────────────

export interface CardTxn {
  date: string;
  desc: string;
  amount: number;
  credit?: boolean;
}

export const CARD_PREVIOUS = 1_250_000; // ₹12,500.00
export const CARD_TXNS: CardTxn[] = [
  { date: '2024-06-24', desc: 'EXAMPLE MART BENGALURU', amount: 345_000 },
  { date: '2024-06-28', desc: 'PAYMENT RECEIVED THANK YOU', amount: 1_250_000, credit: true },
  { date: '2024-07-02', desc: 'EXAMPLEKART ONLINE', amount: 129_900 },
  { date: '2024-07-09', desc: 'FUEL STATION EXAMPLE ROAD', amount: 250_000 },
  { date: '2024-07-12', desc: 'REFUND EXAMPLEKART', amount: 29_900, credit: true },
];

export function cardTotals(txns: CardTxn[] = CARD_TXNS, previous = CARD_PREVIOUS) {
  const debits = txns.filter((t) => !t.credit).reduce((s, t) => s + t.amount, 0);
  const credits = txns.filter((t) => t.credit).reduce((s, t) => s + t.amount, 0);
  return { debits, credits, due: previous + debits - credits };
}

function cardDoc(o: {
  preamble: LineSpec[];
  summary: LineSpec[];
  header: Cell[];
  row: (t: CardTxn, i: number) => Cell[];
  extra?: LineSpec[];
  headerY?: number;
}): LayoutDoc {
  const headerY = o.headerY ?? 300;
  const lines: LineSpec[] = [...o.preamble, ...o.summary, { y: headerY, cells: o.header }, ...(o.extra ?? [])];
  CARD_TXNS.forEach((t, i) => lines.push({ y: headerY + 18 + i * 13, cells: o.row(t, i) }));
  return layoutDoc([lines]);
}

const rs = (p: number) => `Rs. ${inr(p)}`;

/** SBI Card style: label : value summary on one line, D / C suffix on amounts. */
export function sbiCard(): LayoutDoc {
  const { due } = cardTotals();
  return cardDoc({
    preamble: [
      { y: 30, cells: [L(40, 'SBI Card')] },
      { y: 44, cells: [L(40, 'Credit Card Statement for the period 16 Jun 2024 to 15 Jul 2024')] },
      { y: 58, cells: [L(40, 'Card Number XXXX XXXX XXXX 7788')] },
    ],
    summary: [
      { y: 80, cells: [L(40, 'Statement Date'), L(220, '15 Jul 2024')] },
      { y: 94, cells: [L(40, 'Payment Due Date'), L(220, '04 Aug 2024')] },
      { y: 108, cells: [L(40, 'Previous Balance'), L(220, rs(CARD_PREVIOUS))] },
      { y: 122, cells: [L(40, 'Total Amount Due'), L(220, rs(due))] },
      { y: 136, cells: [L(40, 'Minimum Amount Due'), L(220, rs(Math.round(due * 0.05 / 100) * 100))] },
      { y: 150, cells: [L(40, 'Credit Limit'), L(220, rs(10_000_000))] },
      { y: 164, cells: [L(40, 'Available Credit Limit'), L(220, rs(10_000_000 - due))] },
    ],
    header: [L(40, 'Date'), L(110, 'Transaction Details'), R(520, 'Amount (Rs.)')],
    row: (t) => [L(40, fmt.dMonY2(t.date)), L(110, t.desc), R(520, `${inr(t.amount)} ${t.credit ? 'C' : 'D'}`)],
  });
}

/** HDFC card style: stacked label/value summary, Cr suffix, a rewards column, section heading. */
export function hdfcCard(): LayoutDoc {
  const { due } = cardTotals();
  return cardDoc({
    preamble: [
      { y: 30, cells: [L(40, 'HDFC Bank Credit Cards')] },
      { y: 44, cells: [L(40, 'Statement for HDFC Bank Credit Card')] },
      { y: 58, cells: [L(40, 'Statement Date:15/07/2024'), L(300, 'Billing Period 16 Jun, 2024 - 15 Jul, 2024')] },
    ],
    summary: [
      { y: 90, cells: [L(40, 'Payment Due Date'), L(180, 'Total Dues'), L(320, 'Minimum Amount Due')] },
      { y: 102, cells: [L(40, '04/08/2024'), L(180, inr(due)), L(320, inr(Math.round(due * 0.05 / 100) * 100))] },
      { y: 130, cells: [L(40, 'Credit Limit'), L(180, 'Available Credit Limit'), L(320, 'Previous Balance')] },
      { y: 142, cells: [L(40, inr(10_000_000)), L(180, inr(10_000_000 - due)), L(320, inr(CARD_PREVIOUS))] },
    ],
    header: [L(40, 'DATE & TIME'), L(150, 'TRANSACTION DESCRIPTION'), L(400, 'REWARDS'), R(560, 'AMOUNT (in Rs.)')],
    extra: [{ y: 312, cells: [L(150, 'Domestic Transactions')] }],
    headerY: 296,
    row: (t) => [L(40, `${fmt.dmySlash(t.date)} 10:30:15`), L(150, t.desc), L(405, '12'), R(560, `${inr(t.amount)}${t.credit ? ' Cr' : ''}`)],
  });
}

/** Amex style: year-less "Jul 12" dates, negative credits, statement spanning Dec to Jan. */
export function amexYearless(): LayoutDoc {
  const txns: CardTxn[] = [
    { date: '2023-12-14', desc: 'EXAMPLE AIRLINES MUMBAI', amount: 1_850_000 },
    { date: '2023-12-28', desc: 'PAYMENT RECEIVED THANK YOU', amount: 500_000, credit: true },
    { date: '2024-01-03', desc: 'EXAMPLE HOTEL GOA', amount: 640_000 },
    { date: '2024-01-09', desc: 'REFUND EXAMPLE AIRLINES', amount: 120_000, credit: true },
  ];
  const previous = 500_000;
  const { due } = cardTotals(txns, previous);
  const lines: LineSpec[] = [
    { y: 30, cells: [L(40, 'American Express')] },
    { y: 44, cells: [L(40, 'Statement Period : 12 Dec 2023 to 11 Jan 2024')] },
    { y: 70, cells: [L(40, 'Previous Balance'), L(220, inr(previous))] },
    { y: 84, cells: [L(40, 'New Balance'), L(220, inr(due))] },
    { y: 98, cells: [L(40, 'Minimum Payment Due'), L(220, inr(500_000))] },
    { y: 112, cells: [L(40, 'Payment Due Date'), L(220, '05 Feb 2024')] },
    { y: 140, cells: [L(40, 'Date'), L(110, 'Description'), R(520, 'Amount')] },
  ];
  txns.forEach((t, i) => lines.push({ y: 158 + i * 13, cells: [L(40, fmt.monD(t.date)), L(110, t.desc), R(520, `${t.credit ? '-' : ''}${inr(t.amount)}`)] }));
  return layoutDoc([lines]);
}

export const AMEX_EXPECTED = [
  { date: '2023-12-14', amount: 1_850_000, dir: 'debit' as const },
  { date: '2023-12-28', amount: 500_000, dir: 'credit' as const },
  { date: '2024-01-03', amount: 640_000, dir: 'debit' as const },
  { date: '2024-01-09', amount: 120_000, dir: 'credit' as const },
];

// ── spreadsheet records ──────────────────────────────────────────────────────

/** A bank's Excel export: title rows, header row, rows, a totals row. */
export function xlsRecords(): string[][] {
  const bals = ledgerBalances();
  const rows = LEDGER.map((t, i) => [
    fmt.dmySlash(t.date),
    t.desc.join(' '),
    `REF${i}`,
    t.dir === 'debit' ? inr(t.amount) : '',
    t.dir === 'credit' ? inr(t.amount) : '',
    inr(bals[i]),
  ]);
  return [
    ['Example Bank Account Statement'],
    ['Account No', 'XXXXXX9988', '', 'Period', '01/04/2024 to 30/04/2024'],
    [],
    ['Txn Date', 'Description', 'Ref No', 'Withdrawal Amt.', 'Deposit Amt.', 'Balance'],
    ...rows,
    ['Total', '', '', inr(LEDGER.filter((t) => t.dir === 'debit').reduce((s, t) => s + t.amount, 0)), inr(LEDGER.filter((t) => t.dir === 'credit').reduce((s, t) => s + t.amount, 0)), ''],
  ];
}

export const ALL_BANK_LAYOUTS: Record<string, () => LayoutDoc> = {
  hdfcLike,
  sbiBilingual,
  axisLike,
  kotakLike,
  bobSerialFirst,
  pnbLike,
  idfcDescriptionFirst,
  yesSigned,
  indusindDrCrColumn,
  federalLike,
  headerless,
  mdyDates,
};
