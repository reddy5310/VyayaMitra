/**
 * Sample-data mode: a realistic, entirely invented ledger so people can explore the app without
 * importing their own statements.
 *
 * Isolation: sample data lives in a SEPARATE IndexedDB database ('VyayaMitraDB-sample'), selected at
 * startup by the localStorage flag 'vm-sample'. The personal database is only closed — never read,
 * written or deleted — while sample mode is active. Start = build the sample DB + set the flag +
 * reload. Exit = clear the flag + delete the sample DB + reload.
 *
 * The synthetic statements go through the real commit path (understanding, dedupe, linking), so
 * every screen behaves exactly as it does with real data.
 */
import Dexie from 'dexie';
import type { IsoDate, Paise, ParsedRow, ParsedStatement } from '@/domain/types';
import { commitImport, stageParsed } from '@/engine/import';
import { addMonths, monthEnd, monthKey, todayIso } from '@/lib/dates';
import { addContribution, createGoal, updateSettings, upsertBudget } from './actions';
import { PERSONAL_DB_NAME, SAMPLE_DB_NAME, SAMPLE_FLAG, db, switchDatabase } from './db';

export function isSampleMode(): boolean {
  return db.name === SAMPLE_DB_NAME;
}

/** Fixed for the lifetime of a page load (switching reloads the app). */
export function useSampleMode(): boolean {
  return isSampleMode();
}

function writeFlag(on: boolean): boolean {
  try {
    if (on) globalThis.localStorage.setItem(SAMPLE_FLAG, '1');
    else globalThis.localStorage.removeItem(SAMPLE_FLAG);
    return globalThis.localStorage.getItem(SAMPLE_FLAG) === (on ? '1' : null);
  } catch {
    return false;
  }
}

function reload(): void {
  try {
    globalThis.location?.reload();
  } catch {
    /* not in a browser */
  }
}

// ─── generator ───────────────────────────────────────────────────────────────

const rupees = (r: number): Paise => Math.round(r * 100);
const pad = (n: number) => String(n).padStart(2, '0');

interface Draft {
  date: IsoDate;
  direction: 'debit' | 'credit';
  amount: Paise;
  description: string;
  bankCategory?: string;
}

export const SAMPLE_BANK_MASK = '4321';
export const SAMPLE_CARD_MASK = '5678';

function toRows(drafts: Draft[], opening: Paise | null, withBalance: boolean, serialStart: number): ParsedRow[] {
  const sorted = [...drafts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let balance = opening ?? 0;
  return sorted.map((d, i) => {
    balance += d.direction === 'credit' ? d.amount : -d.amount;
    const row: ParsedRow = {
      date: d.date,
      amount: d.amount,
      direction: d.direction,
      description: d.description,
      source: { page: 1, lineStart: i, lineEnd: i, rawLines: [d.description] },
      warnings: [],
    };
    if (withBalance) {
      row.balanceAfter = balance;
      row.reference = `S${serialStart + i}`;
    }
    if (d.bankCategory) row.bankCategory = d.bankCategory;
    return row;
  });
}

export interface SampleStatements {
  /** In import order (oldest month first). */
  statements: { fileName: string; hash: string; parsed: ParsedStatement }[];
  months: string[];
  /** Savings-account deposits to the emergency-fund goal, as dates (already on or before `today`). */
  goalDates: IsoDate[];
}

/** Build the invented statements for the last 4 complete months and the current one. Pure and deterministic per `today`. */
export function generateSampleStatements(today: IsoDate = todayIso()): SampleStatements {
  const current = monthKey(today);
  const todayDay = Number(today.slice(8, 10));
  const months = [-4, -3, -2, -1, 0].map((n) => addMonths(current, n));
  const out: SampleStatements['statements'] = [];
  const goalDates: IsoDate[] = [];

  let bankBalance = rupees(150_000);
  let cardDue: Paise = 0;
  let serial = 1000;

  months.forEach((m, mi) => {
    const isCurrent = m === current;
    const has = (day: number) => !isCurrent || day <= todayDay;
    const at = (day: number): IsoDate => `${m}-${pad(day)}`;
    const j = (base: number, step: number) => rupees(base + ((mi * 7 + 3) % 5) * step);

    // ── credit card ──
    const card: Draft[] = [];
    const chargeRow = (day: number, rupeeAmount: number, description: string, bankCategory?: string) => {
      if (has(day)) card.push({ date: at(day), direction: 'debit', amount: rupees(rupeeAmount), description, bankCategory });
    };
    chargeRow(2, 649, 'NETFLIX.COM MUMBAI IN', 'Entertainment');
    chargeRow(3, 420 + mi * 60, 'ZOMATO BANGALORE IN', 'Restaurants');
    chargeRow(4, 1899 + mi * 310, 'AMAZON PAY INDIA PVT LTD', 'Shopping');
    chargeRow(6, 2500, 'INDIAN OIL PETROL PUMP BANGALORE', 'Fuel');
    chargeRow(8, 380 + mi * 25, 'STARBUCKS COFFEE MUMBAI IN', 'Restaurants');
    chargeRow(11, 2999, 'MYNTRA DESIGNS BANGALORE', 'Shopping');
    chargeRow(12, 640, 'DOMINOS PIZZA BANGALORE', 'Restaurants');
    if (mi % 2 === 0) chargeRow(19, 3499, 'DECATHLON SPORTS INDIA BANGALORE', 'Shopping');
    if (mi === 1) {
      chargeRow(1, 500, 'ANNUAL FEE ICICI CARD', 'Fees');
      chargeRow(1, 90, 'GST @18% ON ANNUAL FEE', 'Fees');
    }
    if (mi === 2 && has(17)) {
      card.push({ date: at(17), direction: 'credit', amount: rupees(1899 + mi * 310), description: 'AMAZON PAY INDIA PVT LTD REFUND', bankCategory: 'Shopping' });
    }
    // The previous bill is paid on the 15th (bank debit + card credit, same amount).
    const paid = mi > 0 && cardDue > 0 && has(15) ? cardDue : 0;
    if (paid > 0) card.push({ date: at(15), direction: 'credit', amount: paid, description: 'PAYMENT RECEIVED THANK YOU' });

    const previous = cardDue;
    const charges = card.filter((d) => d.direction === 'debit').reduce((s, d) => s + d.amount, 0);
    const credits = card.filter((d) => d.direction === 'credit').reduce((s, d) => s + d.amount, 0);
    const due = previous + charges - credits;
    cardDue = due;

    // ── savings account ──
    const bank: Draft[] = [];
    const add = (day: number, direction: 'debit' | 'credit', amount: Paise, description: string) => {
      if (has(day)) bank.push({ date: at(day), direction, amount, description });
    };
    add(1, 'credit', rupees(85_000), 'NEFT-ACME TECHNOLOGIES PVT LTD-SALARY');
    add(2, 'debit', rupees(22_000), 'UPI-SAMPLE LANDLORD-sample.landlord@okaxis-RENT');
    add(5, 'debit', j(1400, 190), 'BIL/BESCOM ELECTRICITY BANGALORE');
    add(6, 'debit', rupees(1179), 'UPI-ACT FIBERNET-actfibernet@icici-BROADBAND');
    add(7, 'debit', j(1100, 240), 'UPI-BIGBASKET-bigbasket@icici-GROCERY');
    add(9, 'debit', rupees(450 + mi * 40), 'UPI-SWIGGY-swiggy@icici-ORDER');
    add(10, 'debit', rupees(10_000), 'ACH D- HDFC MUTUAL FUND-SIP');
    add(14, 'debit', j(1500, 210), 'UPI-DMART READY-dmartready@axisb-GROCERY');
    if (paid > 0) add(15, 'debit', paid, `CREDIT CARD PAYMENT ICICI BANK CC XX${SAMPLE_CARD_MASK}`);
    add(18, 'debit', rupees(350 + mi * 20), 'UPI-UBER INDIA-uberindia@axisbank-TRIP');
    add(20, 'debit', rupees(3400), 'UPI-RAHUL S-rahuls8821@okicici-DINNER SPLIT');
    add(21, 'debit', j(1800, 150), 'UPI-RELIANCE FRESH-relfresh@icici-GROCERY');
    add(25, 'debit', rupees(5000), 'ATM-CASH WDL-ICICI ATM BANGALORE');
    if (mi === 2) add(22, 'debit', rupees(2750), 'POS 4521 XYZ ENTERPRISES');
    if (mi === 2) add(28, 'credit', rupees(1124), 'INT.PD SAVINGS INTEREST CREDIT');
    if (has(11)) goalDates.push(at(11));

    const opening = bankBalance;
    const bankRows = toRows(bank, opening, true, serial);
    serial += bankRows.length;
    const bankDebits = bank.filter((d) => d.direction === 'debit').reduce((s, d) => s + d.amount, 0);
    const bankCredits = bank.filter((d) => d.direction === 'credit').reduce((s, d) => s + d.amount, 0);
    bankBalance = opening + bankCredits - bankDebits;
    const periodEnd = isCurrent ? today : monthEnd(m);

    out.push({
      fileName: `sample-savings-${m}.pdf`,
      hash: `sample-savings-${m}`,
      parsed: {
        parserId: 'sample',
        parserVersion: 1,
        institution: 'ICICI',
        accountType: 'savings',
        accountMask: SAMPLE_BANK_MASK,
        holderName: 'SAMPLE USER',
        periodStart: `${m}-01`,
        periodEnd,
        openingBalance: opening,
        closingBalance: bankBalance,
        printedTotals: { debits: bankDebits, credits: bankCredits },
        rows: bankRows,
        skipped: [],
        warnings: [],
        reconciliation: {
          status: 'balanced',
          checks: [
            { label: 'Running balance', ok: true },
            { label: 'Opening + credits − debits = closing', ok: true, expected: bankBalance, actual: bankBalance },
          ],
          rowBalanceBreaks: 0,
        },
        detection: { confidence: 1, reasons: ['Sample data'] },
      },
    });

    const cardRows = toRows(card, null, false, 0);
    const minimum = Math.max(0, Math.round((due * 0.05) / 100) * 100);
    out.push({
      fileName: `sample-card-${m}.pdf`,
      hash: `sample-card-${m}`,
      parsed: {
        parserId: 'sample',
        parserVersion: 1,
        institution: 'ICICI',
        accountType: 'credit_card',
        accountMask: SAMPLE_CARD_MASK,
        cardMasks: [SAMPLE_CARD_MASK],
        holderName: 'SAMPLE USER',
        periodStart: `${m}-01`,
        periodEnd,
        openingBalance: previous,
        closingBalance: due,
        printedTotals: { debits: charges, credits, totalDue: due, previousBalance: previous },
        rows: cardRows,
        skipped: [],
        warnings: [],
        reconciliation: {
          status: 'balanced',
          checks: [{ label: 'Previous balance + purchases − payments = total due', ok: true, expected: due, actual: due }],
          rowBalanceBreaks: 0,
        },
        cardSummary: {
          statementDate: periodEnd,
          dueDate: `${addMonths(m, 1)}-20`,
          totalDue: due,
          minimumDue: minimum,
          previousBalance: previous,
          creditLimit: rupees(200_000),
          availableCredit: rupees(200_000) - due,
        },
        detection: { confidence: 1, reasons: ['Sample data'] },
      },
    });
  });

  return { statements: out, months, goalDates };
}

/** Fill the ACTIVE database with the sample ledger through the real commit path. */
async function populate(today: IsoDate): Promise<void> {
  const sample = generateSampleStatements(today);
  await updateSettings({ onboardingDone: true });
  for (const s of sample.statements) {
    const preview = await stageParsed({ name: s.fileName, size: 0, hash: s.hash }, s.parsed);
    await commitImport(preview, { mode: 'add' });
  }
  await upsertBudget('food_dining', rupees(8000));
  await upsertBudget('groceries', rupees(12_000));
  const goal = await createGoal({ name: 'Emergency fund', target: rupees(300_000), icon: 'ShieldCheck' });
  for (const [i, date] of sample.goalDates.entries()) {
    await addContribution({ goalId: goal.id, date, amount: rupees(10_000), type: 'deposit', note: 'Monthly top-up' });
    if (i === 2) await addContribution({ goalId: goal.id, date, amount: rupees(2000), type: 'withdrawal', note: 'Medical bill' });
  }
}

// ─── start / exit ────────────────────────────────────────────────────────────

/** Build the sample database, switch to it and reload. Personal data is never touched. */
export async function startSampleData(): Promise<void> {
  if (isSampleMode()) return;
  try {
    await Dexie.delete(SAMPLE_DB_NAME); // always start from a fresh sample
    switchDatabase(SAMPLE_DB_NAME);
    await db.open();
    await populate(todayIso());
    if (!writeFlag(true)) throw new Error('Your browser is blocking local storage, so sample data cannot be switched on.');
  } catch (e) {
    switchDatabase(PERSONAL_DB_NAME);
    await Dexie.delete(SAMPLE_DB_NAME);
    writeFlag(false);
    throw e;
  }
  reload();
}

/** Delete the sample database, go back to the personal one and reload. */
export async function exitSampleData(): Promise<void> {
  writeFlag(false);
  switchDatabase(PERSONAL_DB_NAME); // closes the sample DB if it was active
  await Dexie.delete(SAMPLE_DB_NAME);
  reload();
}
