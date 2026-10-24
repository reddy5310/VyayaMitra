/**
 * What the engine knows about statements in general: which bank a document is from, what kind of
 * account it describes, and which lines are page furniture rather than data.
 */
import type { AccountType, Institution, IsoDate } from '@/domain/types';
import { INSTITUTIONS, institutionFromIfsc } from '@/domain/institutions';
import type { LayoutDoc, LayoutLine } from '../pdf/types';
import { findPeriod } from '../core/meta';
import { collapse, readMoney } from '../core/text';
import { daysBetween } from '@/lib/dates';
import { parseDateTok } from './dates';

export interface DocProfile {
  institution: Institution;
  /** Lower-case marker phrases from the knowledge base that appear in the document. */
  markers: string[];
  accountType: AccountType;
  /** True when the text reads like a credit-card statement. */
  cardLike: boolean;
  period: { start: IsoDate; end: IsoDate } | null;
  /** First 4 letters of an IFSC printed in the header area (bank code only, never the branch). */
  ifscBank?: string;
  text: string;
}

const CARD_SIGNS = [
  /total (amount |payment )?dues?\b/i,
  /minimum (amount |payment )?dues?\b/i,
  /payment due date|due date/i,
  /credit limit/i,
  /available (credit )?limit/i,
  /reward points?/i,
  /credit card/i,
  /card (no|number|statement)/i,
  /previous (statement )?balance/i,
];

const LOAN_SIGNS = /loan (account )?statement|loan a\/c|emi schedule|installment|instalment|principal outstanding|amortization/i;
const WALLET_SIGNS = /wallet (statement|transactions)|paytm wallet|phonepe wallet|amazon pay balance|mobikwik wallet|freecharge wallet/i;
const CURRENT_SIGNS = /current (a\/c|account)|cc\/od|overdraft account/i;
const SAVINGS_SIGNS = /savings? (bank )?(a\/c|account)|sb account/i;

/** A transaction row (date and amount). Its text names counterparties, not the statement's own bank. */
function isTxnLine(l: LayoutLine): boolean {
  return l.items.some((i) => {
    const t = parseDateTok(i.text, 'DMY') ?? parseDateTok(i.text, 'MDY');
    return !!t && (t.y !== undefined || /[A-Za-z]/.test(i.text));
  }) && l.items.some((i) => readMoney(i.text) !== null);
}

function headText(doc: LayoutDoc, pages = 2): string {
  return doc.pages
    .slice(0, pages)
    .flatMap((p) => p.lines)
    .filter((l) => !isTxnLine(l))
    .map((l) => l.text)
    .join('\n');
}

/** Count knowledge-base markers, longest first so "state bank of india" is not also "bank of india". */
function scoreInstitutions(text: string, heading: string): Map<string, { score: number; markers: Set<string> }> {
  const pairs: { marker: string; id: string }[] = [];
  for (const inst of INSTITUTIONS) for (const m of inst.markers) pairs.push({ marker: m, id: inst.id });
  pairs.sort((a, b) => b.marker.length - a.marker.length);
  const out = new Map<string, { score: number; markers: Set<string> }>();
  let body = text.toLowerCase();
  let head = heading.toLowerCase();
  for (const { marker, id } of pairs) {
    let n = 0;
    let at = body.indexOf(marker);
    while (at !== -1) {
      n++;
      body = body.slice(0, at) + ' '.repeat(marker.length) + body.slice(at + marker.length);
      at = body.indexOf(marker, at + marker.length);
    }
    let h = 0;
    at = head.indexOf(marker);
    while (at !== -1) {
      h++;
      head = head.slice(0, at) + ' '.repeat(marker.length) + head.slice(at + marker.length);
      at = head.indexOf(marker, at + marker.length);
    }
    if (n === 0 && h === 0) continue;
    const e = out.get(id) ?? { score: 0, markers: new Set<string>() };
    e.score += Math.min(n, 6) + h * 4;
    e.markers.add(marker);
    out.set(id, e);
  }
  return out;
}

/**
 * The statement period. Preferred: a line naming it ("Statement Period: 01 Jan 2024 to 31 Jan 2024"), possibly with the
 * dates on the next line. Otherwise any line holding two dates a billing cycle apart (some layouts print
 * the period as an unlabelled "16 AUG 2026 To 15 SEP 2026").
 */
function findStatementPeriod(doc: LayoutDoc): DocProfile['period'] {
  const lines = doc.pages.slice(0, 3).flatMap((p) => p.lines);
  const label = /statement|period|from|billing/i;
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i].text)) continue;
    const hit = findPeriod(lines[i].text) ?? (lines[i + 1] ? findPeriod(lines[i + 1].text) : null);
    if (hit) return hit;
  }
  for (const l of lines) {
    const hit = findPeriod(l.text);
    if (hit) {
      const days = daysBetween(hit.start, hit.end);
      if (days >= 20 && days <= 100) return hit;
    }
  }
  return null;
}

export function profileDocument(doc: LayoutDoc): DocProfile {
  const text = headText(doc, 3);
  const heading = (doc.pages[0]?.lines ?? [])
    .filter((l) => !isTxnLine(l))
    .slice(0, 30)
    .map((l) => l.text)
    .join('\n');
  const scores = scoreInstitutions(text, heading);

  // IFSC printed in the header area: bank code identifies the bank even with no name marker.
  const ifsc = /\b([A-Z]{4})0[A-Z0-9]{6}\b/.exec(text.slice(0, 6000));
  let ifscBank: string | undefined;
  if (ifsc && institutionFromIfsc(ifsc[1])) ifscBank = ifsc[1];

  let best: string | null = null;
  let bestScore = 0;
  for (const [id, e] of scores) {
    if (e.score > bestScore) {
      best = id;
      bestScore = e.score;
    }
  }
  let institution: Institution = best && bestScore >= 2 ? best : 'OTHER';
  if (institution === 'OTHER' && ifscBank) institution = institutionFromIfsc(ifscBank)?.id ?? 'OTHER';
  const markers = institution !== 'OTHER' ? [...(scores.get(institution)?.markers ?? [])] : [];

  const cardHits = CARD_SIGNS.filter((re) => re.test(text)).length;
  const cardLike = cardHits >= 3;
  let accountType: AccountType = 'savings';
  if (cardLike) accountType = 'credit_card';
  else if (LOAN_SIGNS.test(heading)) accountType = 'loan';
  else if (WALLET_SIGNS.test(heading)) accountType = 'wallet';
  else if (CURRENT_SIGNS.test(text) && !SAVINGS_SIGNS.test(text)) accountType = 'current';

  const period = findStatementPeriod(doc);
  return { institution, markers, accountType, cardLike, period, ifscBank, text };
}

/** Normalise a line so repeated furniture matches across pages ("Page 3 of 8" == "Page 4 of 8"). */
export function furnitureKey(line: LayoutLine): string {
  return collapse(line.text.toLowerCase().replace(/\d+/g, '#'));
}

const PAGE_FOOTER = /^(page\s*#?\s*(of\s*#)?|#\s*of\s*#|page\s*#\s*\/\s*#)$/i;

/**
 * Lines that repeat on most pages (letterhead, disclaimers, running titles) or are page counters.
 * Header rows are protected by the caller; dated/amount rows never repeat identically.
 */
export function findFurniture(doc: LayoutDoc, protect: (l: LayoutLine) => boolean): Set<string> {
  const out = new Set<string>();
  const pages = doc.pages.length;
  const counts = new Map<string, Set<number>>();
  for (const p of doc.pages) {
    for (const l of p.lines) {
      const key = furnitureKey(l);
      if (!key) continue;
      if (PAGE_FOOTER.test(key)) {
        out.add(`${p.page}:${l.index}`);
        continue;
      }
      const set = counts.get(key) ?? new Set<number>();
      set.add(p.page);
      counts.set(key, set);
    }
  }
  if (pages >= 3) {
    for (const p of doc.pages) {
      for (const l of p.lines) {
        const set = counts.get(furnitureKey(l));
        if (set && set.size >= Math.max(3, Math.ceil(pages * 0.6)) && !protect(l)) out.add(`${p.page}:${l.index}`);
      }
    }
  }
  return out;
}

/** Card-number mask: 4111 XXXX XXXX 1111, 4111XXXXXXXX1111, XXXX-XXXX-XXXX-1111, ************1111. */
export const CARD_MASK_RE =
  /(?:\d{4}[ -]?)?[Xx*•]{4}[ -]?[Xx*•]{4}[ -]?(?:[Xx*•]{4}[ -]?)?(\d{4})|\b\d{4,6}[Xx*•]{4,10}(\d{4})\b|\b[Xx*•]{8,12}(\d{4})\b|(?:[Xx*•]{4}[ -]?){2,3}[Xx*•]{0,3}(\d{2,4})\b/;

/** Trailing digits of a card mask. Some issuers show only the last two ("XXXX XXXX XXXX XX12"). */
export function cardMaskOf(text: string): string | undefined {
  const m = CARD_MASK_RE.exec(text);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined;
}
