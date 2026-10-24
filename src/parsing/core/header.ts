import type { LayoutItem, LayoutLine, LayoutPage } from '../pdf/types';
import { norm } from './text';

/** What a column of a statement table holds. */
export type Role =
  | 'date'
  | 'valueDate'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'type'
  | 'mode'
  | 'category'
  /** Running serial number column (ignored). */
  | 'serial'
  /** A column to ignore (reward points, branch codes). */
  | 'skip'
  /** Foreign-currency amount (ignored in favour of the INR amount). */
  | 'foreign';

export interface HeaderCell {
  role: Role;
  x0: number;
  x1: number;
  text: string;
}

export interface TableHeader {
  page: number;
  /** Index of the (first) header line on its page. */
  lineIndex: number;
  /** Index of the last line that belongs to the header (two-line headers). */
  lastLineIndex: number;
  y: number;
  cells: HeaderCell[];
}

const DESCRIPTION = new Set([
  'narration',
  'description',
  'particulars',
  'details',
  'transaction details',
  'details of transaction',
  'details of transactions',
  'remarks',
  'transaction remarks',
  'transaction description',
  'transaction particulars',
  'narrative',
  'description of transaction',
]);

const TYPE = new Set(['type', 'txn type', 'transaction type', 'dr cr', 'cr dr', 'drcr', 'crdr', 'indicator']);

/** Single-word vocabulary (English and Hindi) for bilingual and unusual headers. */
const VOCAB: Record<string, Role> = {};
const addVocab = (role: Role, words: string[]) => words.forEach((w) => (VOCAB[w] = role));
addVocab('date', ['date', 'dt', 'दिनांक', 'दिनाक', 'तारीख', 'तिथि', 'तारिख']);
addVocab('description', ['narration', 'description', 'particulars', 'details', 'remarks', 'narrative', 'विवरण', 'ब्योरा', 'वर्णन', 'विवरणी']);
addVocab('debit', ['withdrawal', 'withdrawals', 'debit', 'debits', 'dr', 'नामे', 'निकासी', 'डेबिट', 'आहरण']);
addVocab('credit', ['deposit', 'deposits', 'credit', 'credits', 'cr', 'जमा', 'क्रेडिट']);
addVocab('balance', ['balance', 'bal', 'शेष', 'शेषराशि']);
addVocab('reference', ['chq', 'cheque', 'ref', 'reference', 'utr', 'instrument', 'चेक', 'संदर्भ']);
addVocab('serial', ['sno', 'srno', 'slno', 'srl', 'क्र']);
addVocab('amount', ['राशि']);
/** Words that may accompany a label without changing its meaning. */
const MODIFIERS = new Set(['amt', 'amount', 'no', 'number', 'rs', 'inr', 'in', 'of', 'a', 'c', 'txn', 'tran', 'trans', 'transaction', 'closing', 'running', 'available', 'chq', 'cheque', 'sl', 'sr', 's', 'सं', 'dd', 'mm', 'yyyy', 'time']);

/**
 * Map one header label (already a single column's text) to a role, using the synonym dictionary.
 * Returns null for labels we do not recognise.
 */
export function matchRole(label: string): Role | null {
  const n = norm(label);
  if (!n) return null;
  if (/^(sr|s|sl|srl|serial) ?(no|num|number)?$/.test(n) || n === 'क्र सं' || n === 'क्रम सं' || n === 'क्र') return 'serial';
  if (/^(reward|rewards|reward points|points|bonus points|branch|sol|sol id|branch code)$/.test(n)) return 'skip';
  if (/^(intl|international|foreign|forex|fx)( |$)/.test(n) && /(amount|amt|intl)/.test(n)) return 'foreign';
  if (/^(value|val|valu) ?(date|dt)$/.test(n) || n === 'मूल्य तिथि') return 'valueDate';
  if (/^((txn|tran|trans|transaction|posting|post|book|booking|entry) )?(date|dt)$|^date of (txn|tran|transaction|posting)$/.test(n)) return 'date';
  if (DESCRIPTION.has(n)) return 'description';
  if (n === 'mode') return 'mode';
  if (/^(merchant |spend |transaction )?(category|categories)( code)?$|^mcc$/.test(n)) return 'category';
  if (TYPE.has(n)) return 'type';
  if (/^(chq|cheque|ref|reference|instrument|utr)\b/.test(n)) return 'reference';
  const hasBalance = /\b(balance|bal)\b/.test(n);
  const hasDebit = /\b(withdrawal|withdrawals|debit|debits|debited|dr|paid out|money out)\b/.test(n);
  const hasCredit = /\b(deposit|deposits|credit|credits|credited|cr|paid in|money in)\b/.test(n);
  // Two different columns glued together ("Deposit Amt. Closing Balance") are not one label.
  if (hasBalance && (hasDebit || hasCredit)) return null;
  if (hasBalance) return 'balance';
  if (hasDebit && hasCredit) return 'amount';
  if (hasDebit) return 'debit';
  if (hasCredit) return 'credit';
  if (/^(txn |transaction )?amount\b/.test(n)) return 'amount';
  return vocabRole(n);
}

/** Bilingual / unusual labels: every recognised word must agree on one role. */
function vocabRole(n: string): Role | null {
  const roles = new Set<Role>();
  for (const w of n.split(' ')) {
    const r = VOCAB[w];
    if (r) roles.add(r);
    else if (!MODIFIERS.has(w)) return null; // an unknown word: not a label we know
  }
  if (roles.size === 1) return [...roles][0];
  if (roles.size === 2 && roles.has('debit') && roles.has('credit')) return 'amount';
  return null;
}

/** "Withdrawal (Dr)/ Deposit (Cr)": one column carrying both directions. */
const COMBINED_AMOUNT = /(withdrawal|debit|dr)[^/]*\/[^/]*(deposit|credit|cr)|(deposit|credit|cr)[^/]*\/[^/]*(withdrawal|debit|dr)/i;

/**
 * Split a header item into recognised cells. pdf.js (and our line merge) can glue neighbouring
 * header labels into one item ("Deposit Amt. Closing Balance"); we split it into the partition
 * with the fewest unrecognised words, dividing the item's width by character position.
 */
function cellsFromItem(item: LayoutItem): HeaderCell[] {
  const whole = matchRole(item.text);
  if (whole) return [{ role: whole, x0: item.x0, x1: item.x1, text: item.text }];
  if (COMBINED_AMOUNT.test(item.text)) return [{ role: 'amount', x0: item.x0, x1: item.x1, text: item.text }];
  const words = item.text.split(' ').slice(0, 16);
  if (words.length < 2) return [];

  // best[i] = { skips, segments } for words[i..]
  type Plan = { skips: number; segs: { from: number; to: number; role: Role }[] };
  const best: Plan[] = new Array(words.length + 1);
  best[words.length] = { skips: 0, segs: [] };
  for (let i = words.length - 1; i >= 0; i--) {
    let plan: Plan = { skips: best[i + 1].skips + 1, segs: best[i + 1].segs };
    for (let len = 1; len <= Math.min(5, words.length - i); len++) {
      const role = matchRole(words.slice(i, i + len).join(' '));
      if (!role) continue;
      const rest = best[i + len];
      if (rest.skips < plan.skips || (rest.skips === plan.skips && rest.segs.length + 1 > plan.segs.length)) {
        plan = { skips: rest.skips, segs: [{ from: i, to: i + len, role }, ...rest.segs] };
      }
    }
    best[i] = plan;
  }
  const total = item.text.length || 1;
  const offsets: number[] = [];
  let pos = 0;
  for (const w of words) {
    offsets.push(pos);
    pos += w.length + 1;
  }
  const width = item.x1 - item.x0;
  const merged: { from: number; to: number; role: Role }[] = [];
  for (const seg of best[0].segs) {
    const last = merged[merged.length - 1];
    if (last && last.role === seg.role && last.to === seg.from) last.to = seg.to;
    else merged.push({ ...seg });
  }
  return merged.map((s) => {
    const startChar = offsets[s.from];
    const endChar = offsets[s.to - 1] + words[s.to - 1].length;
    return {
      role: s.role,
      text: words.slice(s.from, s.to).join(' '),
      x0: item.x0 + (width * startChar) / total,
      x1: item.x0 + (width * endChar) / total,
    };
  });
}

function cellsFromItems(items: LayoutItem[]): HeaderCell[] {
  const cells = items.flatMap(cellsFromItem);
  // Keep the first cell for each role; a header repeating a role is ambiguous, ignore the repeat.
  const seen = new Set<Role>();
  const out: HeaderCell[] = [];
  for (const c of cells.sort((a, b) => a.x0 - b.x0)) {
    if (seen.has(c.role)) continue;
    seen.add(c.role);
    out.push(c);
  }
  return out;
}

function isValidHeader(cells: HeaderCell[]): boolean {
  const roles = new Set(cells.map((c) => c.role));
  return roles.has('date') && (roles.has('debit') || roles.has('credit') || roles.has('amount')) && cells.length >= 3;
}

/** Merge a header line with the next line when the label wraps over two lines ("Withdrawal" / "Amt."). */
function mergeItems(a: LayoutItem[], b: LayoutItem[]): LayoutItem[] {
  const out = a.map((x) => ({ ...x }));
  for (const it of b) {
    const host = out.find((o) => Math.min(o.x1, it.x1) - Math.max(o.x0, it.x0) > 0.3 * Math.min(o.x1 - o.x0, it.x1 - it.x0));
    if (host) {
      host.text = `${host.text} ${it.text}`;
      host.x0 = Math.min(host.x0, it.x0);
      host.x1 = Math.max(host.x1, it.x1);
    } else {
      out.push({ ...it });
    }
  }
  return out.sort((p, q) => p.x0 - q.x0);
}

/**
 * Find the table header on a page: a line (or two wrapped lines) naming a date column and at least one
 * money column. Returns the first such header; statements repeat it on every page.
 */
export function findHeader(page: LayoutPage): TableHeader | null {
  const lines = page.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.items.length < 3) continue;
    let cells = cellsFromItems(l.items);
    if (isValidHeader(cells)) {
      return { page: page.page, lineIndex: l.index, lastLineIndex: l.index, y: l.y, cells };
    }
    const next = lines[i + 1];
    if (next && next.y - l.y < 16 && cells.length >= 2) {
      cells = cellsFromItems(mergeItems(l.items, next.items));
      if (isValidHeader(cells)) {
        return { page: page.page, lineIndex: l.index, lastLineIndex: next.index, y: next.y, cells };
      }
    }
  }
  return null;
}

export function cellOf(h: TableHeader, role: Role): HeaderCell | undefined {
  return h.cells.find((c) => c.role === role);
}

export function isHeaderLine(h: TableHeader | null, line: LayoutLine): boolean {
  return !!h && line.page === h.page && line.index >= h.lineIndex && line.index <= h.lastLineIndex;
}
