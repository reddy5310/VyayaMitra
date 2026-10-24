/**
 * Synthetic bank statements laid out like the real ones (same column geometry, wrapping and
 * furniture) but with invented people, accounts, VPAs and references.
 *
 * Descriptions are given as the ORIGINAL text; the generators wrap them to the column width the
 * way the banks do (word wrap, hard break inside over-long tokens), so tests can assert that the
 * parser rebuilds the original text.
 */
import { inr, makeWrapper, T, TR, type PdfPageSpec, type PdfText } from './builders';

// ─── ICICI savings ──────────────────────────────────────────────────────────

export interface IciciTxn {
  date: string;
  mode?: string;
  /** The full description as the bank holds it, before wrapping. */
  text: string;
  debit?: number;
  credit?: number;
}

export const ICICI_OPENING = 15_000_000; // ₹1,50,000.00
const ICICI_WRAP = 190;
const ICICI_SIZE = 8;
const ICICI_PITCH = 9.6;

/** Descriptions that wrap to 1, 2, 3, 4 and 5 lines so block attribution has to cope with each. */
export const ICICI_TXNS: IciciTxn[] = [
  {
    date: '03-06-2024',
    text: 'UPI/100000000001/Payment from Ph/asha.verma@okaxis/State Bank Of India/YBL0123456789abcdef0123456789abcdef',
    credit: 500_000,
  },
  { date: '03-06-2024', mode: 'MOBILE BANKING', text: 'MMT/IMPS/100000000002/Rent 98765432/Ravi Kumar/HDFC0000001', debit: 1_200_000 },
  { date: '04-06-2024', text: 'ACH/EXAMPLE FIN DIV 23 24/000001', credit: 950 },
  { date: '05-06-2024', mode: 'CMS TRANSACTION', text: 'CMS/ SAMPLE WITHDRAW REQ ASHA VERMA/EXAMPLEORIG', credit: 200_000 },
  {
    date: '05-06-2024',
    text: 'UPI/100000000003/UPIIntent/shop.example@hdfcbank/HDFC BANK LTD/PPPL20100000000000000000001/',
    debit: 57_325,
  },
  {
    date: '06-06-2024',
    text: 'UPI/100000000004/Refund/shop.example@hdfcbank/HDFC BANKLTD/HDF0A1B2C3D4E5F60718293A4B5C6D7E8F9',
    credit: 14_935,
  },
  {
    date: '07-06-2024',
    text: 'UPI/100000000005/Paid Via Example/broker.example/ICICI Bank Ltd/GPG20240607000000000000000000000001/',
    debit: 3_000_000,
  },
  {
    date: '07-06-2024',
    text: 'NEFT-AXISP00000000001-EXAMPLE CLEARING LIMITED-TENDEROFFER SAMPLEPHARMA 2024001-000000000000001-UTIB0000 SETTLEMENT BATCH 7 FOR ASHA VERMA ACCOUNT HOLDER REFERENCE NUMBER 0001',
    credit: 281_350,
  },
  {
    date: '08-06-2024',
    text: 'UPI/100000000006/Payment from Ph/rahul.menon@ybl/Bank of Baroda/YBL00112233445566778899aabbccddeeff0',
    credit: 1_000_000,
  },
  { date: '08-06-2024', mode: 'NET BANKING', text: 'BIL/INFT/DXX0000001/Family/ RAVI KUMAR', debit: 5_000_000 },
];

export interface IciciOptions {
  txns?: IciciTxn[];
  opening?: number;
  /** Bottom limit before a page break (smaller forces more pages). */
  limitY?: number;
  /** Override the printed balance after these txn indexes (to create a break). */
  balanceOverride?: Record<number, number>;
  /** Print the amount under the opposite column for these txn indexes. */
  swapColumns?: number[];
}

export interface IciciBuilt {
  pages: PdfPageSpec[];
  /** Wrapped line count per txn. */
  lineCounts: number[];
  balances: number[];
  totalDebits: number;
  totalCredits: number;
  closing: number;
}

export async function iciciSavingsPages(opts: IciciOptions = {}): Promise<IciciBuilt> {
  const wrap = await makeWrapper();
  const txns = opts.txns ?? ICICI_TXNS;
  const opening = opts.opening ?? ICICI_OPENING;
  const limitY = opts.limitY ?? 790;
  const pages: PdfPageSpec[] = [];
  const balances: number[] = [];
  const lineCounts: number[] = [];
  let totalDebits = 0;
  let totalCredits = 0;

  let texts: PdfText[] = [];
  let pageNo = 1;
  const header = (y: number): PdfText[] => [
    T(27, y, 'DATE'),
    T(76, y, 'MODE**'),
    T(158, y, 'PARTICULARS'),
    TR(427, y, 'DEPOSITS'),
    TR(505, y, 'WITHDRAWALS'),
    TR(583, y, 'BALANCE'),
  ];

  texts.push(TR(592, 50, 'Page 1 of N', 10));
  texts.push(T(27, 175, 'MS.ASHA VERMA', 9), T(387, 175, 'Your Base Branch: EXAMPLE TECH PARK', 9));
  texts.push(T(27, 216, 'BENGALURU - INDIA - 560001', 9), T(407, 207, 'Visit www.icicibank.com', 9));
  texts.push(T(27, 304, 'Summary of Accounts held under Cust ID: 100000001 as on December 03, 2024', 9));
  texts.push(T(27, 339, 'ACCOUNT TYPE'), T(181, 339, 'A/c BALANCE(I)'));
  texts.push(T(27, 351, 'Savings A/c 123456780001'), TR(242, 351, '1,00,000.00'));
  texts.push(
    T(
      27,
      396,
      'Statement of Transactions in Savings Account Number: 123456780001 in INR for the period June 03, 2024 - December 03, 2024',
      9,
    ),
  );
  texts.push(...header(413));
  texts.push(T(27, 424.3, '03-06-2024'), T(158, 424.3, 'B/F'), TR(583, 424.3, inr(opening)));
  let cursor = 434.7;

  const newPage = () => {
    pages.push({ texts });
    pageNo++;
    texts = [TR(592, 50, `Page ${pageNo} of N`, 10), T(27, 135, 'MS.ASHA VERMA', 9), ...header(157)];
    cursor = 167.1;
  };

  let balance = opening;
  txns.forEach((t, i) => {
    const lines = wrap(t.text, ICICI_SIZE, ICICI_WRAP);
    const k = lines.length;
    lineCounts.push(k);
    if (cursor + k * ICICI_PITCH > limitY) newPage();
    const dateY = cursor + ((k - 1) / 2) * ICICI_PITCH;
    lines.forEach((line, li) => {
      const y = cursor + li * ICICI_PITCH;
      const onDateLine = Math.abs(y - dateY) < 0.01;
      texts.push(T(158, onDateLine ? y - 0.9 : y, line));
    });
    texts.push(T(27, dateY, t.date));
    if (t.mode) texts.push(T(76, dateY, t.mode));
    const amt = t.debit ?? t.credit ?? 0;
    const isDebit = t.debit !== undefined;
    balance += isDebit ? -amt : amt;
    if (isDebit) totalDebits += amt;
    else totalCredits += amt;
    const swapped = opts.swapColumns?.includes(i) ?? false;
    const inDebitColumn = swapped ? !isDebit : isDebit;
    texts.push(TR(inDebitColumn ? 505 : 427, dateY, inr(amt)));
    texts.push(TR(583, dateY, inr(opts.balanceOverride?.[i] ?? balance)));
    balances.push(balance);
    cursor += k * ICICI_PITCH + 0.4;
  });

  texts.push(
    T(155, cursor + 12, 'TOTAL'),
    TR(426, cursor + 12, inr(totalCredits)),
    TR(504, cursor + 12, inr(totalDebits)),
    TR(583, cursor + 12, inr(balance)),
  );
  texts.push(T(27, cursor + 56, 'Account Related Other Information', 10));
  pages.push({ texts });
  return { pages, lineCounts, balances, totalDebits, totalCredits, closing: balance };
}

// ─── DBS savings ────────────────────────────────────────────────────────────

export interface DbsTxn {
  date: string;
  valueDate?: string;
  text: string;
  debit?: number;
  credit?: number;
}

export const DBS_OPENING = 1_250_075;
const DBS_WRAP = 153.4;
const DBS_SIZE = 7;
const DBS_PITCH = 8.4;

export const DBS_TXNS: DbsTxn[] = [
  { date: '31-Aug-2025', text: 'UPI~100000000011~asha.verma@okaxis~ASHAVERMAJOSHI-YBL0123456789abcdef0123456789', credit: 100 },
  { date: '01-Sep-2025', text: 'UPI~100000000012~ravi.kumar@oksbi~RAVIKUMARSHARMA-AXL1111aaaa2222bbbb3333cccc4444', debit: 33_500 },
  { date: '02-Sep-2025', text: 'CREDIT INTEREST - Saving -100200300400', credit: 13_150 },
  { date: '03-Sep-2025', text: 'UPI~100000000013~playstore@axisbank~Google -AXI5555dddd6666eeee7777ffff8888', debit: 20_000 },
  { date: '04-Sep-2025', text: 'NEFTIN ICIN100000000014 ASHA VERMA -ICICI BANK LIMITED ICIC0000001', credit: 1_000_000 },
  { date: '05-Sep-2025', text: 'UPI~100000000015~sandeepkumar@axl~SANDEEP KUMAR-AXL9999aaaa0000bbbb1111cccc2222', debit: 150_000 },
  {
    date: '01-Oct-2025',
    valueDate: '30-Sep-2025',
    text: 'UPI~100000000016~asha.verma@okaxis~ASHA VERMA-YBL3333dddd4444eeee5555ffff6666',
    debit: 50_000,
  },
];

export interface DbsOptions {
  txns?: DbsTxn[];
  opening?: number;
}

export interface DbsBuilt {
  pages: PdfPageSpec[];
  closing: number;
  balances: number[];
  totalDebits: number;
  totalCredits: number;
}

export async function dbsPages(opts: DbsOptions = {}): Promise<DbsBuilt> {
  const wrap = await makeWrapper();
  const txns = opts.txns ?? DBS_TXNS;
  const opening = opts.opening ?? DBS_OPENING;
  const texts: PdfText[] = [];
  const balances: number[] = [];
  let totalDebits = 0;
  let totalCredits = 0;
  texts.push(T(36, 40.8, 'PRIVATE & CONFIDENTIAL', 7), T(510, 79, 'Page 3 of 3', 10));
  texts.push(T(36, 140.5, 'Account Name: ASHA VERMA'));
  texts.push(T(36, 154.4, 'Account No.: 100200300400'), T(244, 154.4, 'Account Type: DIGISAVINGS'));
  texts.push(T(36, 168.4, 'Statement Period: 01-Sep-2025 To 30-Sep-2025'), T(244, 168.4, 'Currency: INR'));
  texts.push(T(300, 175, 'DBS Bank India Limited', 7));
  const hy = 191;
  texts.push(
    T(37, hy, 'Transaction Date', 7),
    T(111, hy, 'Value Date', 7),
    T(205, hy, 'Details of transaction', 7),
    TR(369, hy, 'Debit', 7),
    TR(446, hy, 'Credit', 7),
    TR(531, hy, 'Balance', 7),
  );
  texts.push(T(169, 207.3, 'Opening Balance', 7), TR(553, 207.3, inr(opening), 7));
  let y = 229.9;
  let balance = opening;
  for (const t of txns) {
    const lines = wrap(t.text, DBS_SIZE, DBS_WRAP);
    texts.push(T(42, y, t.date, 7), T(104, y, t.valueDate ?? t.date, 7));
    lines.forEach((line, i) => texts.push(T(169, y + i * DBS_PITCH, line, 7)));
    const isDebit = t.debit !== undefined;
    const amt = t.debit ?? t.credit ?? 0;
    balance += isDebit ? -amt : amt;
    if (isDebit) totalDebits += amt;
    else totalCredits += amt;
    texts.push(TR(isDebit ? 390 : 469, y, inr(amt), 7), TR(553, y, inr(balance), 7));
    balances.push(balance);
    y += (lines.length - 1) * DBS_PITCH + 11.3;
  }
  texts.push(T(169, y + 8, 'Closing Balance', 7), TR(553, y + 8, inr(balance), 7));
  texts.push(T(250, y + 30, '*** End of Statement ***', 8));
  return { pages: [{ texts }], closing: balance, balances, totalDebits, totalCredits };
}

// ─── ICICI credit card ──────────────────────────────────────────────────────

export interface CcTxn {
  date: string;
  ser: string;
  text: string;
  amount: number;
  credit?: boolean;
  /** Reward points column (default 0). */
  reward?: string;
  /** Foreign-currency column, e.g. '25 USD'. */
  foreign?: string;
}

export interface CcSection {
  /** Masked card number line, e.g. '5100XXXXXXXX1111'. */
  card: string;
  txns: CcTxn[];
}

export const CC_PREVIOUS = 170_025;

export const CC_SECTIONS: CcSection[] = [
  {
    card: '5100XXXXXXXX1111',
    txns: [
      { date: '28/06/2024', ser: '9000000001', text: 'INFINITY PAYMENT RECEIVED, THANK YOU', amount: 170_025, credit: true },
      { date: '18/07/2024', ser: '9000000002', text: 'Refund Amt Transfer to Bank Acc XX1234', amount: 4_299 },
    ],
  },
  {
    card: '4000XXXXXXXX2222',
    txns: [
      { date: '22/06/2024', ser: '9000000003', text: 'WWW EXAMPLESHOP COM', amount: 512_340 },
      { date: '24/06/2024', ser: '9000000004', text: 'UPI-100000000021-CINEMAHALL ENTERTAINMENT IN', amount: 98_750 },
      { date: '30/06/2024', ser: '9000000005', text: 'UPI-100000000022-SAMPLE CAFE LOCALITY IN', amount: 1_045_000 },
      { date: '12/07/2024', ser: '9000000006', text: 'UPI-100000000023-TEA STALL TOWNSHIP IN', amount: 4_300 },
      { date: '12/07/2024', ser: '9000000007', text: 'UPI-100000000023-TEA STALL TOWNSHIP IN', amount: 4_300, credit: true },
      { date: '13/07/2024', ser: '9000000008', text: 'UPI-100000000024-Amazon I ndia IN', amount: 127_480 },
    ],
  },
];

export interface CcBuilt {
  pages: PdfPageSpec[];
  debits: number;
  credits: number;
  previous: number;
  due: number;
  rowCount: number;
}

export async function iciciCreditCardPages(
  sections: CcSection[] = CC_SECTIONS,
  previous = CC_PREVIOUS,
): Promise<CcBuilt> {
  const wrap = await makeWrapper();
  let debits = 0;
  let credits = 0;
  let rowCount = 0;
  for (const s of sections) {
    for (const t of s.txns) {
      rowCount++;
      if (t.credit) credits += t.amount;
      else debits += t.amount;
    }
  }
  const due = previous + debits - credits;
  const texts: PdfText[] = [];
  texts.push(T(38, 56.2, 'CREDIT CARD STATEMENT', 10));
  texts.push(T(38, 94.7, 'MR ASHA VERMA', 8), T(276, 94.7, 'Download the iMobile Pay app to -', 8));
  texts.push(T(285, 109, 'Block/unblock ATM withdrawal, online transactions &', 6));
  texts.push(T(215, 195, 'All communications are being sent to your registered e-mail ID', 9));
  texts.push(T(213, 214, 'visit www.icicibank.com or the nearest ICICI Bank branch', 7));
  texts.push(T(79, 194.9, 'STATEMENT DATE', 9), T(81, 205.9, 'July 20, 2024', 10));
  texts.push(T(75, 223.4, 'PAYMENT DUE DATE', 9), T(75, 234.4, 'August 7, 2024', 10));
  texts.push(T(205, 254.4, 'STATEMENT SUMMARY', 10));
  texts.push(
    T(81, 275, 'Total Amount due', 7),
    T(221, 275, 'Previous Balance', 7),
    T(306, 275, 'Purchases / Charges', 7),
    T(404, 275, 'Cash Advances', 7),
    T(488, 275, 'Payments / Credits', 7),
  );
  texts.push(T(87, 289, '`' + inr(due), 10));
  texts.push(
    T(231, 292.5, previous < 0 ? '`' + inr(-previous) + ' CR' : '`' + inr(previous), 8),
    T(318, 292.5, '`' + inr(debits), 8),
    T(418, 292.5, '`0.00', 8),
    T(498, 292.5, '`' + inr(credits), 8),
  );
  texts.push(T(73, 314.9, 'Minimum Amount due', 10), T(92, 328.3, '`1,170.00', 10));
  texts.push(
    T(208, 334, 'Credit Limit (Including cash)', 7),
    T(325, 334, 'Available Credit (Including cash)', 7),
    T(450, 334, 'Cash Limit', 7),
    T(520, 334, 'Available Cash', 7),
  );
  texts.push(T(222, 354.8, '`4,70,000.00', 8), T(340, 354.8, '`3,76,726.44', 8), T(452, 354.8, '`47,000.00', 8), T(525, 354.8, '`40,000.00', 8));
  const hy = 375.7;
  texts.push(
    T(208, hy, 'Date', 6),
    T(262, hy, 'SerNo.', 6),
    T(305, hy, 'Transaction Details', 6),
    T(443, hy, 'Reward', 6),
    T(486, hy, 'Intl.#', 6),
    TR(557, hy, 'Amount (in`)', 6),
    T(445, hy + 7.7, 'Points', 6),
    T(481, hy + 7.7, 'amount', 6),
  );
  let y = 398.3;
  // Left sidebar (spend-mix percentages, promo text) sharing y-lines with the table.
  const sidebar: [number, string][] = [
    [56, '89%'],
    [161, '6%'],
    [154, '4%'],
    [118, 'For exclusive'],
    [122, 'offers, visit'],
    [54, 'Apparel/Grocery-2%'],
    [127, 'Fuel-4%'],
    [108, 'www.icicibank.com/offers'],
  ];
  let sb = 0;
  const side = (yy: number) => {
    if (sb >= sidebar.length) return;
    const [x, s] = sidebar[sb++];
    texts.push(T(x, yy + 0.8, s, 6));
  };
  for (const sec of sections) {
    texts.push(T(208, y, sec.card, 8));
    side(y);
    y += 13.5;
    for (const t of sec.txns) {
      const lines = wrap(t.text, 6, 100);
      texts.push(T(208, y, t.date, 6), T(254, y, t.ser, 6), T(305, y, lines[0], 6), T(452, y, t.reward ?? '0', 6));
      if (t.foreign) texts.push(T(484, y, t.foreign, 6));
      texts.push(TR(557, y, inr(t.amount) + (t.credit ? ' CR' : ''), 6));
      side(y);
      for (let i = 1; i < lines.length; i++) {
        texts.push(T(305, y + i * 7.3, lines[i], 6));
        side(y + i * 7.3);
      }
      y += (lines.length - 1) * 7.3 + 13;
    }
  }
  texts.push(T(205, y + 30, "For further information, 'ask iPal' on our website and mobile app. You may also contact our Customer Care, your", 7));
  texts.push(T(205, y + 38, 'RM or visit any ICICI Bank Branch.', 7));
  texts.push(T(41, 761.7, 'Statement period : June 21, 2024 to July 20, 2024', 5));
  texts.push(T(525, 827, 'Page 1 of 1', 6));
  return { pages: [{ texts }], debits, credits, previous, due, rowCount };
}

// ─── Generic layouts: HDFC style ────────────────────────────────────────────

export interface GenericTxn {
  date: string;
  valueDate?: string;
  text: string;
  ref?: string;
  debit?: number;
  credit?: number;
}

export const HDFC_TXNS: GenericTxn[] = [
  {
    date: '01/04/24',
    text: 'UPI-ASHA VERMA-asha.verma@okaxis-HDFC0000001-409000000001-PAYMENT',
    ref: '0000409000000001',
    valueDate: '01/04/24',
    debit: 25_000,
  },
  {
    date: '02/04/24',
    text: 'NEFT CR-ICIC0000001-EXAMPLE EMPLOYER PVT LTD-ASHA VERMA',
    ref: 'N092240000000002',
    valueDate: '02/04/24',
    credit: 8_500_000,
  },
  { date: '03/04/24', text: 'POS 400000XXXXXX0001 EXAMPLE MART', ref: '0000409000000003', valueDate: '03/04/24', debit: 189_950 },
];

export async function hdfcPages(
  opening = 1_000_000,
  txns: GenericTxn[] = HDFC_TXNS,
): Promise<{ pages: PdfPageSpec[]; balances: number[] }> {
  const wrap = await makeWrapper();
  const texts: PdfText[] = [];
  texts.push(T(40, 60, 'HDFC BANK LIMITED', 10), T(400, 60, 'HDFC BANK Statement of Account', 8));
  texts.push(T(40, 80, 'Account No : 50100000000999', 8), T(300, 80, 'Statement From : 01/04/2024 To : 30/04/2024', 8));
  const hy = 140;
  texts.push(
    T(40, hy, 'Date', 8),
    T(95, hy, 'Narration', 8),
    T(268, hy, 'Chq./Ref.No.', 8),
    T(356, hy, 'Value Dt', 8),
    TR(455, hy, 'Withdrawal Amt.', 8),
    TR(520, hy, 'Deposit Amt.', 8),
    TR(580, hy, 'Closing Balance', 8),
  );
  let y = 158;
  let bal = opening;
  const balances: number[] = [];
  for (const t of txns) {
    const lines = wrap(t.text, 8, 165);
    texts.push(T(40, y, t.date, 8), T(95, y, lines[0], 8));
    if (t.ref) texts.push(T(268, y, t.ref, 8));
    if (t.valueDate) texts.push(T(356, y, t.valueDate, 8));
    const amt = t.debit ?? t.credit ?? 0;
    bal += t.debit !== undefined ? -amt : amt;
    texts.push(TR(t.debit !== undefined ? 445 : 512, y, inr(amt), 8), TR(578, y, inr(bal), 8));
    balances.push(bal);
    for (let i = 1; i < lines.length; i++) texts.push(T(95, y + i * 10, lines[i], 8));
    y += lines.length * 10 + 6;
  }
  texts.push(T(40, y + 40, 'Closing Balance', 8));
  return { pages: [{ texts }], balances };
}
