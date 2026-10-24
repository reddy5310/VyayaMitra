/**
 * Credit-card statement summary: total due, minimum due, due date, limit, previous balance…
 *
 * Labels and values appear side by side ("Total Amount Due: Rs. 5,000.00"), in the next cell on the
 * line, or stacked (label above value). Some issuers print the summary as pictures or boxes whose
 * labels are not text at all; two self-checking fallbacks cover those: the row of figures that
 * satisfies previous + charges - payments = total due, and a due-date / minimum-due pair beside a date.
 */
import type { CardSummary, IsoDate, Paise } from '@/domain/types';
import type { LayoutDoc, LayoutItem, LayoutLine } from '../pdf/types';
import { readMoney } from '../core/text';
import { parseDateTok, resolveDate, type DateOrder } from './dates';
import { daysBetween } from '@/lib/dates';

type Key =
  | 'totalDue'
  | 'minimumDue'
  | 'dueDate'
  | 'statementDate'
  | 'previousBalance'
  | 'creditLimit'
  | 'availableCredit'
  | 'purchases'
  | 'payments'
  | 'cashAdvances'
  | 'fees'
  | 'tax'
  | 'emi';

interface LabelDef {
  key: Key;
  re: RegExp;
  kind: 'money' | 'date';
  /** Phrases that disqualify a match. */
  not?: RegExp;
}

const LABELS: LabelDef[] = [
  { key: 'totalDue', re: /^total (amount |payment )?(due|payable)\b|^total dues?\b|^total outstanding\b|^amount due\b|^new balance\b|^closing balance\b/i, kind: 'money' },
  { key: 'minimumDue', re: /^(minimum|min\.?) ?(amount |amt\.? |payment )?(due|payable)?\b/i, kind: 'money', not: /date/i },
  { key: 'dueDate', re: /^(payment )?due date\b|^pay(ment)? (by|on or before)\b|^due on\b/i, kind: 'date' },
  { key: 'statementDate', re: /^(statement|bill) date\b|^date of statement\b|^statement generation date\b/i, kind: 'date' },
  { key: 'previousBalance', re: /^(previous|opening|last) (statement |bill )?(balance|dues|amount)\b/i, kind: 'money' },
  { key: 'creditLimit', re: /^(total )?credit limit\b/i, kind: 'money', not: /available/i },
  { key: 'availableCredit', re: /^available (credit )?(limit|credit)\b/i, kind: 'money' },
  { key: 'purchases', re: /^(purchases?|new charges|new debits)\b/i, kind: 'money' },
  { key: 'payments', re: /^payments?\b/i, kind: 'money', not: /due|date/i },
  { key: 'cashAdvances', re: /^cash advances?\b/i, kind: 'money' },
  { key: 'fees', re: /^(fees?|fee and charges|fees? ?(&|and) ?charges?|finance charges?)\b/i, kind: 'money' },
  { key: 'tax', re: /^(goods (&|and) services? tax|gst|igst)\b/i, kind: 'money' },
  { key: 'emi', re: /^monthly emi debits?\b/i, kind: 'money' },
];

type Found = Partial<Record<Key, string>>;

const MONEY_AT_END = /(?:Rs\.?|INR|₹|`)?\s*\d[\d,]*\.\d{2}(?:\s*(?:cr|dr)\.?)?$/i;

/** A summary figure; a CR / Cr printed after it (or a minus sign) makes it a credit balance, i.e. negative. */
export function signedFigure(text: string): Paise | undefined {
  const t = text.replace(/^[:\-\s]+/, '').trim();
  const m = readMoney(t) ?? readMoney(t.replace(/^(Rs\.?|INR|₹|`)\s*/i, ''));
  if (!m) return undefined;
  return m.indicator === 'CR' || m.negative ? -m.paise : m.paise;
}

/** The figure's text plus a CR / DR marker that sits in the next cell ("`2,076.76" "CR"). */
function withMarker(line: LayoutLine, item: LayoutItem): string {
  const next = line.items.filter((i) => i.x0 >= item.x1 - 1 && i.x0 - item.x1 < 30 && i !== item).sort((a, b) => a.x0 - b.x0)[0];
  return next && /^(cr|dr)\.?$/i.test(next.text.trim()) ? `${item.text} ${next.text.trim()}` : item.text;
}

function valueFor(def: LabelDef, lines: LayoutLine[], li: number, item: LayoutItem, rest: string, order: DateOrder): string | null {
  const accept = (s: string): boolean => (def.kind === 'money' ? signedFigure(s) !== undefined : parseDateTok(s.replace(/^[:\-\s]+/, ''), order) !== null);
  // 1. same cell: "Total Amount Due: Rs. 5,000.00" or "Total Amount Due PAY NOW 4,80,798.00"
  const inline = rest.replace(/^[:\-\s]+/, '');
  if (inline && accept(inline)) return inline;
  if (def.kind === 'money') {
    const tail = MONEY_AT_END.exec(inline);
    if (tail && accept(tail[0])) return tail[0];
  }
  const line = lines[li];
  // 2. the next cell on the same line (only the nearest one: a value two cells away belongs to another label)
  const right = line.items.filter((i) => i.x0 >= item.x1 - 1 && i !== item).sort((a, b) => a.x0 - b.x0)[0];
  if (right && accept(right.text)) return withMarker(line, right);
  // 3. stacked below
  const cx = (item.x0 + item.x1) / 2;
  for (let j = li + 1; j < Math.min(lines.length, li + 4); j++) {
    if (lines[j].y - line.y > 32) break;
    const hit = lines[j].items.find((i) => Math.abs((i.x0 + i.x1) / 2 - cx) <= 70 && accept(i.text));
    if (hit) return withMarker(lines[j], hit);
  }
  return null;
}

/** All money cells of a line, in order, signed. Null when the line holds words other than the figures. */
function figuresOnly(line: LayoutLine): Paise[] | null {
  const out: Paise[] = [];
  for (const it of line.items) {
    const v = signedFigure(it.text);
    if (v === undefined) {
      if (/[A-Za-z]{2}/.test(it.text)) return null;
      continue;
    }
    out.push(v);
  }
  return out;
}

/**
 * A row of bare figures that satisfies previous + charges - payments = total due: the summary of a
 * statement whose labels are not text. Returns the pieces so the caller can verify them against the rows.
 */
export function findSummaryEquation(lines: LayoutLine[]): { previous: Paise; due: Paise; debits: Paise; credits: Paise } | null {
  for (const line of lines) {
    const v = figuresOnly(line);
    if (!v || v.length < 3 || v.length > 8) continue;
    const orders: [number, number][] = [[0, v.length - 1]];
    for (let p = 0; p < v.length; p++) for (let d = 0; d < v.length; d++) if (p !== d && !(p === 0 && d === v.length - 1)) orders.push([p, d]);
    for (const [pi, di] of orders) {
      const rest = v.filter((_, i) => i !== pi && i !== di);
      if (rest.length === 0) continue;
      for (let mask = 0; mask < 1 << rest.length; mask++) {
        let credits = 0;
        let debits = 0;
        rest.forEach((x, i) => (mask & (1 << i) ? (credits += Math.abs(x)) : (debits += Math.abs(x))));
        if (v[pi] + debits - credits === v[di] && debits + credits > 0) {
          return { previous: v[pi], due: v[di], debits, credits };
        }
      }
    }
  }
  return null;
}

export interface CardSummaryResult {
  summary: CardSummary;
  purchases?: Paise;
  payments?: Paise;
  cash?: Paise;
  /** Fees, taxes and EMI debits printed as separate summary lines (part of the debits). */
  extras?: Paise;
}

/** Find the summary block figures on the first pages of a card statement. */
export function extractCardSummary(doc: LayoutDoc, order: DateOrder, end?: IsoDate): CardSummaryResult {
  const lines = doc.pages.slice(0, 2).flatMap((p) => p.lines);
  const found: Found = {};
  for (let li = 0; li < lines.length; li++) {
    for (const item of lines[li].items) {
      // summary lines are often written "- Payments & Credits", "+ New Debits"
      const text = item.text.trim().replace(/^[-+−–]\s*/, '');
      for (const def of LABELS) {
        if (found[def.key] !== undefined) continue;
        const m = def.re.exec(text);
        if (!m) continue;
        if (def.not && def.not.test(text)) continue;
        const v = valueFor(def, lines, li, item, text.slice(m[0].length), order);
        if (v !== null) found[def.key] = v;
      }
    }
  }
  const signed = (k: Key) => (found[k] ? signedFigure(found[k] as string) : undefined);
  const money = (k: Key) => {
    const v = signed(k);
    return v === undefined ? undefined : Math.abs(v);
  };
  const date = (k: Key): IsoDate | undefined => {
    const v = found[k];
    if (!v) return undefined;
    const tok = parseDateTok(v.replace(/^[:\-\s]+/, ''), order);
    return tok ? (resolveDate(tok, end) ?? undefined) : undefined;
  };
  const summary: CardSummary = {
    statementDate: date('statementDate'),
    dueDate: date('dueDate'),
    totalDue: signed('totalDue'),
    minimumDue: money('minimumDue'),
    previousBalance: signed('previousBalance'),
    creditLimit: money('creditLimit'),
    availableCredit: money('availableCredit'),
  };
  let purchases = money('purchases');
  let payments = money('payments');

  // Labels that are not text: the figures that add up.
  if (summary.previousBalance === undefined || summary.totalDue === undefined) {
    const eq = findSummaryEquation(lines.slice(0, 80));
    if (eq) {
      summary.previousBalance ??= eq.previous;
      summary.totalDue ??= eq.due;
      purchases ??= eq.debits;
      payments ??= eq.credits;
    }
  }
  // A date with one amount beside it, after the statement period: payment due date and minimum due.
  if ((summary.dueDate === undefined || summary.minimumDue === undefined) && end) {
    for (const line of lines.slice(0, 15)) {
      const dates = line.items.filter((i) => parseDateTok(i.text, order)?.y !== undefined);
      const moneyItems = line.items.filter((i) => signedFigure(i.text) !== undefined && !dates.includes(i));
      if (dates.length !== 1 || moneyItems.length !== 1 || line.items.some((i) => /[A-Za-z]{3}\s*[A-Za-z]{2}/.test(i.text) && !dates.includes(i))) continue;
      const iso = resolveDate(parseDateTok(dates[0].text, order) as NonNullable<ReturnType<typeof parseDateTok>>, end);
      if (!iso || iso <= end) continue;
      const gap = daysBetween(end, iso);
      const amount = Math.abs(signedFigure(moneyItems[0].text) as number);
      if (gap > 0 && gap <= 60 && (summary.totalDue === undefined || amount <= Math.abs(summary.totalDue))) {
        summary.dueDate ??= iso;
        summary.minimumDue ??= amount;
        break;
      }
    }
  }
  // The credit limit printed as a bare pair of figures (limit, cash limit) above the available credit.
  if (summary.creditLimit === undefined && summary.availableCredit !== undefined) {
    for (const line of lines.slice(0, 25)) {
      const v = figuresOnly(line);
      if (v && v.length >= 2 && v.length <= 3 && v.every((x) => x >= summary.availableCredit!)) {
        summary.creditLimit = Math.max(...v);
        break;
      }
    }
  }
  for (const k of Object.keys(summary) as (keyof CardSummary)[]) if (summary[k] === undefined) delete summary[k];
  const extraParts = [money('fees'), money('tax'), money('emi')].filter((x): x is Paise => x !== undefined);
  return {
    summary,
    purchases,
    payments,
    cash: money('cashAdvances'),
    extras: extraParts.length > 0 ? extraParts.reduce((a, b) => a + b, 0) : undefined,
  };
}
