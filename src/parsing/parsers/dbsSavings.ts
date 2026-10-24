import type { ParsedStatement } from '@/domain/types';
import { finishStatement } from '../core/build';
import { parseColumnar } from '../core/columnar';
import { findHeader } from '../core/header';
import { docText, findAccountMask, findPeriod } from '../core/meta';
import { collapse } from '../core/text';
import type { Detection, ParseContext, PdfParser } from '../core/types';
import type { LayoutDoc } from '../pdf/types';

export const DBS_SAVINGS_ID = 'dbs-savings';
const VERSION = 1;

function referenceFrom(description: string): string | undefined {
  const head = description.slice(0, 80);
  const m = /^(?:UPI~|IMP-)(\d{6,})/.exec(head) ?? /^NEFT(?:IN|OUT)?\s+([A-Z]{0,6}\d{9,})/.exec(head);
  return m?.[1];
}

function hasDbsHeader(doc: LayoutDoc): boolean {
  for (const p of doc.pages) {
    const h = findHeader(p);
    if (!h) continue;
    const texts = h.cells.map((c) => c.text.toLowerCase());
    if (texts.some((t) => t.includes('details of transaction')) && texts.some((t) => t.includes('value date'))) return true;
  }
  return false;
}

function detect(doc: LayoutDoc): Detection {
  const reasons: string[] = [];
  const text = docText(doc, 4);
  const dbs = /\bDBS\b/i.test(text);
  if (!dbs) return { confidence: 0, reasons: ['No DBS Bank marker in the document'] };
  reasons.push('DBS Bank marker');
  let c = 0.3;
  if (hasDbsHeader(doc)) {
    c += 0.4;
    reasons.push('Header: Transaction Date / Value Date / Details of transaction / Debit / Credit / Balance');
  }
  if (/Statement Period/i.test(text)) {
    c += 0.1;
    reasons.push('"Statement Period" line');
  }
  if (/Account Name\s*:/i.test(text) && /Account No\.?\s*:/i.test(text)) {
    c += 0.1;
    reasons.push('Account Name / Account No. block');
  }
  if (/Opening Balance/i.test(text) || /Closing Balance/i.test(text)) {
    c += 0.05;
    reasons.push('Opening / Closing Balance rows');
  }
  return { confidence: Math.min(c, 0.99), reasons };
}

function parse(doc: LayoutDoc, _ctx: ParseContext): ParsedStatement {
  const detection = detect(doc);
  const res = parseColumnar(doc, { referenceFrom });
  const text = docText(doc, 4);
  const period = findPeriod(/Statement Period[^\n]*/i.exec(text)?.[0] ?? '');
  const holder = /Account Name\s*:\s*([^\n]+?)(?=\s{2,}|\n|$)/i.exec(text)?.[1];
  const accountType = /Account Type\s*:\s*[A-Z ]*CURRENT/i.test(text) ? 'current' : 'savings';

  return finishStatement({
    parserId: DBS_SAVINGS_ID,
    parserVersion: VERSION,
    institution: 'DBS',
    accountType,
    accountMask: findAccountMask(text),
    holderName: holder ? collapse(holder) : undefined,
    periodStart: period?.start,
    periodEnd: period?.end,
    openingBalance: res.openingBalance,
    closingBalance: res.closingBalance,
    printedTotals: res.printedTotals,
    rows: res.rows,
    skipped: res.skipped,
    detection,
  });
}

export const dbsSavingsParser: PdfParser = {
  kind: 'pdf',
  id: DBS_SAVINGS_ID,
  version: VERSION,
  label: 'DBS Bank savings account statement',
  institution: 'DBS',
  accountType: 'savings',
  fileTypes: ['pdf'],
  notes: 'E-statement PDF from digibank / net banking.',
  detect,
  parse,
};
