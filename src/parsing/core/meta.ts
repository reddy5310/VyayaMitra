import type { Institution, IsoDate } from '@/domain/types';
import type { LayoutDoc, LayoutLine } from '../pdf/types';
import { readDate } from './text';

const DATE_TOKEN =
  '(?:\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}[- ][A-Za-z]{3,9}[- ,]+\\d{2,4}|[A-Za-z]{3,9}\\.? \\d{1,2}, ?\\d{4}|\\d{4}-\\d{2}-\\d{2})';
const PERIOD_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:to|-|–|—|till|through|and)\\s*:?\\s*(${DATE_TOKEN})`, 'i');

/** Find "<date> to <date>" in a text and return both as ISO dates. */
export function findPeriod(text: string): { start: IsoDate; end: IsoDate } | null {
  const m = PERIOD_RE.exec(text);
  if (!m) return null;
  const start = readDate(m[1].replace(/\s+/g, ' '));
  const end = readDate(m[2].replace(/\s+/g, ' '));
  return start && end && start <= end ? { start, end } : null;
}

/** Text of the first `maxPages` pages, one line per row. */
export function textLines(doc: LayoutDoc, maxPages = doc.pages.length): LayoutLine[] {
  return doc.pages.slice(0, maxPages).flatMap((p) => p.lines);
}

export function docText(doc: LayoutDoc, maxPages = doc.pages.length): string {
  return textLines(doc, maxPages)
    .map((l) => l.text)
    .join('\n');
}

const INSTITUTIONS: [RegExp, Institution][] = [
  [/\bHDFC\s*BANK\b/i, 'HDFC'],
  [/\bICICI\s*BANK\b/i, 'ICICI'],
  [/\bSTATE BANK OF INDIA\b|\bSBI\b/i, 'SBI'],
  [/\bAXIS\s*BANK\b/i, 'AXIS'],
  [/\bKOTAK\s*(MAHINDRA\s*)?BANK\b/i, 'KOTAK'],
  [/\bDBS\s*BANK\b/i, 'DBS'],
];

/** Which bank the text mentions most often among the ones we know; OTHER when none is clear. */
export function sniffInstitution(text: string): Institution {
  let best: Institution = 'OTHER';
  let bestCount = 0;
  for (const [re, inst] of INSTITUTIONS) {
    const count = (text.match(new RegExp(re.source, 'gi')) ?? []).length;
    if (count > bestCount) {
      best = inst;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : 'OTHER';
}

/** Last 4 digits of an account number that follows a label such as "Account No". */
export function findAccountMask(text: string): string | undefined {
  const m = /Account\s*(?:No\.?|Number|#)\s*[:.]?\s*([0-9Xx*]{6,20})/i.exec(text);
  if (!m) return undefined;
  const d = m[1].replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : undefined;
}

const TITLE = /^(MR|MS|MRS|MISS|DR|SMT|SHRI|MX)\b\.?\s*/i;

/** Strip an honorific ("MS.", "MR ") from a printed holder name. */
export function stripTitle(name: string): string {
  return name.replace(TITLE, '').replace(/\s+/g, ' ').trim();
}

/** A holder line such as "MS.ASHA VERMA" / "MR RAHUL SHARMA". */
export function looksLikeHolder(text: string): boolean {
  return /^(MR|MS|MRS|MISS|DR|SMT|SHRI)\b\.?\s*[A-Za-z][A-Za-z .]+$/.test(text.trim());
}
