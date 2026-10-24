import type { Paise, ParsedStatement, RowWarning, SkippedLine, SourceRef } from '@/domain/types';
import { attributeBlocks, type BlockDateLine } from '../core/blocks';
import { finishStatement } from '../core/build';
import { cellOf, findHeader, type TableHeader } from '../core/header';
import { docText, findPeriod, looksLikeHolder, stripTitle, textLines } from '../core/meta';
import type { DraftRow } from '../core/reconcile';
import { layoutAmountColumns, splitLine, type RowCells } from '../core/table';
import { collapse, joinWrapped, type WrappedLine } from '../core/text';
import type { Detection, ParseContext, PdfParser } from '../core/types';
import type { LayoutDoc, LayoutItem, LayoutLine } from '../pdf/types';

export const ICICI_SAVINGS_ID = 'icici-savings';
const VERSION = 1;

const TITLE_RE = /Statement of Transactions in\s+(Savings|Current)\s+Account\s+Number\s*:\s*([0-9Xx*]+)/i;
const TERMINATOR = /^(TOTAL\b|Account Related Other Information|Legends)/i;
const OPENING = /^(B\/F|BROUGHT FORWARD)\b/i;

function referenceFrom(description: string): string | undefined {
  const head = description.slice(0, 80);
  const m =
    /^UPI\/(\d{9,})\//.exec(head) ??
    /^MMT\/IMPS\/(\d{9,})\//.exec(head) ??
    /^BIL\/(?:INFT|ONL)\/([A-Z0-9]{6,})\//.exec(head) ??
    /^NEFT-([A-Z0-9]{8,})-/.exec(head) ??
    /^RTGS-([A-Z0-9]{8,})-/.exec(head);
  return m?.[1];
}

function hasHeaderShape(h: TableHeader | null): boolean {
  if (!h) return false;
  const roles = new Set(h.cells.map((c) => c.role));
  return roles.has('date') && roles.has('description') && roles.has('credit') && roles.has('debit') && roles.has('balance');
}

function detect(doc: LayoutDoc): Detection {
  const text = docText(doc, 3);
  const reasons: string[] = [];
  if (!/\bICICI\b/i.test(docText(doc))) return { confidence: 0, reasons: ['No ICICI Bank marker in the document'] };
  reasons.push('ICICI Bank marker');
  let c = 0.3;
  if (TITLE_RE.test(text)) {
    c += 0.35;
    reasons.push('"Statement of Transactions in Savings Account Number" title');
  }
  const header = doc.pages.map((p) => findHeader(p)).find((h) => hasHeaderShape(h)) ?? null;
  if (header) {
    c += 0.3;
    const hasMode = header.cells.some((c2) => c2.role === 'mode');
    if (hasMode) c += 0.05;
    reasons.push('Header: DATE / MODE / PARTICULARS / DEPOSITS / WITHDRAWALS / BALANCE');
  }
  // A card statement mentions ICICI too: it must not be read as a bank account.
  if (/CREDIT CARD STATEMENT/i.test(text) && !TITLE_RE.test(text)) {
    return { confidence: 0, reasons: ['Looks like a credit-card statement, not a savings account'] };
  }
  if (!TITLE_RE.test(text) && !header) return { confidence: 0, reasons: ['ICICI marker but no savings-account layout'] };
  return { confidence: Math.min(c, 0.99), reasons };
}

interface DateLine {
  line: LayoutLine;
  cells: RowCells;
  descItems: LayoutItem[];
  modeText: string;
}

interface PageRows {
  dates: DateLine[];
  gaps: LayoutLine[][];
}

function parse(doc: LayoutDoc, _ctx: ParseContext): ParsedStatement {
  const detection = detect(doc);
  const rows: DraftRow[] = [];
  const skipped: SkippedLine[] = [];
  let opening: Paise | undefined;
  let closing: Paise | undefined;
  let totals: { debits?: Paise; credits?: Paise } | undefined;
  let limitX1 = 0;

  const pages: { page: number; data: PageRows; header: TableHeader }[] = [];

  for (const page of doc.pages) {
    const header = findHeader(page);
    if (!hasHeaderShape(header) || !header) continue;
    const descCell = cellOf(header, 'description');
    const modeCell = cellOf(header, 'mode');
    if (!descCell) continue;
    const body: LayoutLine[] = [];
    let ended = false;
    for (const l of page.lines) {
      if (l.index <= header.lastLineIndex) continue;
      if (!ended && TERMINATOR.test(l.text)) {
        if (/^TOTAL\b/i.test(l.text)) body.push(l);
        ended = true;
        continue;
      }
      if (!ended) body.push(l);
    }
    const layout = layoutAmountColumns(header, body.filter((l) => !/^TOTAL\b/i.test(l.text)));
    const descStart = descCell.x0 - 8;
    const dateLimit = (modeCell?.x0 ?? descCell.x0) - 4;

    const data: PageRows = { dates: [], gaps: [[]] };
    for (const l of body) {
      const cells = splitLine(l, layout);
      if (/^TOTAL\b/i.test(l.text)) {
        const d = cells.amounts.find((a) => a.col.role === 'debit');
        const c = cells.amounts.find((a) => a.col.role === 'credit');
        const b = cells.amounts.find((a) => a.col.role === 'balance');
        totals = { debits: d?.money.paise, credits: c?.money.paise };
        if (b) closing = b.money.paise;
        continue;
      }
      const dateItem = cells.dates.find((d) => d.item.x0 < dateLimit);
      if (dateItem) {
        const descItems = cells.text.filter((i) => i.x0 >= descStart);
        const modeItems = cells.text.filter((i) => i.x0 < descStart);
        data.dates.push({
          line: l,
          cells,
          descItems,
          modeText: collapse(modeItems.map((i) => i.text).join(' ')),
        });
        data.gaps.push([]);
      } else {
        if (cells.amounts.length > 0 || cells.strayMoney.length > 0) {
          // Not a dated row and not the total: leave it out, but say so.
          skipped.push({ page: page.page, line: l.index, text: l.text, reason: 'Amount on a line without a date' });
          continue;
        }
        data.gaps[data.gaps.length - 1].push(l);
        for (const it of cells.text) limitX1 = Math.max(limitX1, it.x1);
      }
    }
    pages.push({ page: page.page, data, header });
  }

  for (const { page, data } of pages) {
    const gapYs = data.gaps.map((g) => g.map((l) => l.y));
    const dateInfo: BlockDateLine[] = data.dates.map((d) => ({ y: d.line.y, hasText: d.descItems.length > 0 }));
    const att = attributeBlocks(dateInfo, gapYs);

    data.dates.forEach((d, i) => {
      const upLines = data.gaps[i].slice(data.gaps[i].length - att.above[i]);
      const downLines = data.gaps[i + 1].slice(0, att.below[i]);
      const cells = d.cells;
      const money = cells.amounts;
      const debit = money.find((a) => a.col.role === 'debit');
      const credit = money.find((a) => a.col.role === 'credit');
      const balance = money.find((a) => a.col.role === 'balance');
      const dateIso = cells.dates[0].iso;
      const text = d.line.text;

      // Opening balance row ("B/F")
      const descOnLine = collapse(d.descItems.map((x) => x.text).join(' '));
      if (OPENING.test(descOnLine) && balance && !debit && !credit) {
        opening ??= balance.money.paise;
        return;
      }
      if (cells.strayMoney.length > 0) {
        skipped.push({ page, line: d.line.index, text, reason: 'An amount does not sit under any amount column' });
        return;
      }
      if (debit && credit) {
        skipped.push({ page, line: d.line.index, text, reason: 'Both a deposit and a withdrawal amount on one line' });
        return;
      }
      const amt = debit ?? credit;
      if (!amt) {
        if (balance) skipped.push({ page, line: d.line.index, text, reason: 'Dated line with a balance but no deposit or withdrawal' });
        return;
      }
      if (amt.money.paise === 0) {
        skipped.push({ page, line: d.line.index, text, reason: 'Zero amount' });
        return;
      }

      const parts: WrappedLine[] = [];
      const lineOf = (l: LayoutLine): WrappedLine => ({
        text: collapse(l.items.map((x) => x.text).join(' ')),
        x1: Math.max(...l.items.map((x) => x.x1)),
      });
      for (const l of upLines) parts.push(lineOf(l));
      if (d.descItems.length > 0) {
        parts.push({ text: descOnLine, x1: Math.max(...d.descItems.map((x) => x.x1)) });
      }
      for (const l of downLines) parts.push(lineOf(l));
      let description = joinWrapped(parts, limitX1 || undefined);
      if (d.modeText) description = description ? `${description} [${d.modeText}]` : `[${d.modeText}]`;

      const involved = [...upLines, d.line, ...downLines];
      const source: SourceRef = {
        page,
        lineStart: Math.min(...involved.map((l) => l.index)),
        lineEnd: Math.max(...involved.map((l) => l.index)),
        rawLines: involved.map((l) => l.text),
      };
      const warnings: RowWarning[] = [];
      if (att.uncertain[i]) warnings.push('description_merged');
      rows.push({
        date: dateIso,
        amount: amt.money.paise,
        direction: debit ? 'debit' : 'credit',
        balanceAfter: balance ? balance.money.paise : undefined,
        description,
        reference: referenceFrom(description),
        source,
        warnings,
      });
    });
  }

  // ---- statement metadata ----
  const first = textLines(doc, 1);
  const allText = docText(doc, 3);
  const title = TITLE_RE.exec(allText);
  const periodLine = /for the period\s+([^\n]+)/i.exec(allText)?.[1] ?? '';
  const period = findPeriod(periodLine);
  const holderLine = first.map((l) => l.items[0]?.text ?? '').find((t) => looksLikeHolder(t));
  const mask = title ? title[2].replace(/\D/g, '').slice(-4) || undefined : undefined;

  return finishStatement({
    parserId: ICICI_SAVINGS_ID,
    parserVersion: VERSION,
    institution: 'ICICI',
    accountType: title?.[1].toLowerCase() === 'current' ? 'current' : 'savings',
    accountMask: mask,
    holderName: holderLine ? stripTitle(holderLine) : undefined,
    periodStart: period?.start,
    periodEnd: period?.end,
    openingBalance: opening,
    closingBalance: closing,
    printedTotals: totals,
    rows,
    skipped,
    detection,
  });
}

export const iciciSavingsParser: PdfParser = {
  kind: 'pdf',
  id: ICICI_SAVINGS_ID,
  version: VERSION,
  label: 'ICICI Bank savings / current account statement',
  institution: 'ICICI',
  accountType: 'savings',
  fileTypes: ['pdf'],
  notes: 'Statement of Transactions PDF from iMobile / net banking.',
  detect,
  parse,
};
