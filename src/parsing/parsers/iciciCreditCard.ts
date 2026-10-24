import type { ParsedStatement, SkippedLine, SourceRef } from '@/domain/types';
import { finishStatement } from '../core/build';
import { extractCardSummary } from '../universal/card';
import { foreignFromCell } from '../universal/foreign';
import { docText, findPeriod, looksLikeHolder, stripTitle, textLines } from '../core/meta';
import type { DraftRow } from '../core/reconcile';
import { collapse, joinWrapped, norm, readDate, readMoney, type WrappedLine } from '../core/text';
import type { Detection, ParseContext, PdfParser } from '../core/types';
import type { LayoutDoc, LayoutItem, LayoutPage } from '../pdf/types';

export const ICICI_CC_ID = 'icici-credit-card';
const VERSION = 1;

const CARD_RE = /(\d{4})[ -]?[Xx*]{4}[ -]?[Xx*]{4}[ -]?(\d{4})|(\d{4})[Xx*]{4,10}(\d{4})/;

interface CcHeader {
  page: number;
  /** Index of the last line that belongs to the header block. */
  lastLine: number;
  dateX0: number;
  serX0: number;
  detailsX0: number;
  rewardX0?: number;
  amountX1: number;
}

function findHeader(page: LayoutPage): CcHeader | null {
  for (let i = 0; i < page.lines.length; i++) {
    const l = page.lines[i];
    const byName = (n: string) => l.items.find((it) => norm(it.text) === n);
    const date = byName('date');
    const ser = l.items.find((it) => /^ser ?no$/.test(norm(it.text)));
    const details = byName('transaction details');
    const amount = l.items.find((it) => /^amount in/.test(norm(it.text)));
    if (!date || !ser || !details || !amount) continue;
    const reward = l.items.find((it) => /^reward/.test(norm(it.text)));
    // The header wraps ("Reward" / "Points", "Intl.#" / "amount"): swallow those words.
    let last = l.index;
    for (let j = i + 1; j < page.lines.length; j++) {
      const n = page.lines[j];
      if (n.y - page.lines[j - 1].y > 14) break;
      const words = n.items.filter((it) => it.x0 >= date.x0 - 8).map((it) => norm(it.text));
      if (words.length > 0 && words.every((w) => w === 'points' || w === 'amount' || w === 'points amount')) last = n.index;
      else break;
    }
    return {
      page: page.page,
      lastLine: last,
      dateX0: date.x0,
      serX0: ser.x0,
      detailsX0: details.x0,
      rewardX0: reward?.x0,
      amountX1: amount.x1,
    };
  }
  return null;
}

function detect(doc: LayoutDoc): Detection {
  const first = docText(doc, 1);
  const reasons: string[] = [];
  const iciciCount = (docText(doc, 2).match(/ICICI/gi) ?? []).length;
  if (iciciCount < 2) return { confidence: 0, reasons: ['No ICICI Bank markers (this card layout is only read for ICICI cards)'] };
  reasons.push('ICICI Bank markers');
  let c = 0.25;
  if (/CREDIT CARD STATEMENT/i.test(first)) {
    c += 0.25;
    reasons.push('"CREDIT CARD STATEMENT" title');
  }
  const hasHeader = doc.pages.some((p) => findHeader(p) !== null);
  if (!hasHeader) {
    return { confidence: Math.min(c, 0.3), reasons: [...reasons, 'No Date / SerNo. / Transaction Details table'] };
  }
  c += 0.4;
  reasons.push('Table header: Date / SerNo. / Transaction Details / Amount (in `)');
  if (/STATEMENT SUMMARY/i.test(first)) {
    c += 0.05;
    reasons.push('Statement summary block');
  }
  return { confidence: Math.min(c, 0.99), reasons };
}

function parse(doc: LayoutDoc, _ctx: ParseContext): ParsedStatement {
  const detection = detect(doc);
  const rows: DraftRow[] = [];
  const skipped: SkippedLine[] = [];
  const cardMasks: string[] = [];
  let currentCard: string | undefined;

  interface Pending {
    row: Omit<DraftRow, 'description'>;
    parts: WrappedLine[];
    lastY: number;
  }
  const pendings: Pending[] = [];
  let lastHeader: CcHeader | null = null;

  for (const page of doc.pages) {
    const found = findHeader(page);
    const header: CcHeader | null = found ?? lastHeader;
    if (!header) continue;
    lastHeader = header;
    // Without a header of its own, a later page is only read when it plainly continues the table.
    const start = found ? found.lastLine : -1;
    let current: Pending | null = null;

    for (const line of page.lines) {
      if (line.index <= start) continue;
      // Drop the left sidebar (spend mix, offers): anything left of the Date column.
      const items = line.items.filter((it) => it.x0 >= header.dateX0 - 8);
      if (items.length === 0) continue;
      const text = collapse(items.map((i) => i.text).join(' '));

      const card = CARD_RE.exec(text);
      if (card && items.length === 1 && items[0].x0 < header.detailsX0) {
        const mask = card[2] ?? card[4];
        currentCard = mask;
        if (!cardMasks.includes(mask)) cardMasks.push(mask);
        current = null;
        continue;
      }

      const first = items[0];
      const date = first.x0 <= header.dateX0 + 25 ? readDate(first.text) : null;
      if (date) {
        const ser = items.find((it) => it.x0 >= header.serX0 - 10 && it.x0 <= header.serX0 + 14 && /^\d{6,}$/.test(it.text));
        const amountTokens = items
          .map((it) => ({ it, m: readMoney(it.text) }))
          .filter((x): x is { it: LayoutItem; m: NonNullable<ReturnType<typeof readMoney>> } => x.m !== null);
        const amt = amountTokens.filter((x) => Math.abs(x.it.x1 - header.amountX1) <= 25).pop();
        if (!amt || amt.m.paise === 0) {
          if (amountTokens.length > 0) {
            skipped.push({
              page: page.page,
              line: line.index,
              text,
              reason: amt ? 'Zero amount' : 'No amount under the Amount column on a dated line',
            });
          }
          current = null;
          continue;
        }
        const detailItems = items.filter(
          (it) =>
            it !== first &&
            it !== ser &&
            it !== amt.it &&
            it.x0 >= header.detailsX0 - 8 &&
            // everything right of the details column is reward points, a foreign amount ("25 USD") or the INR amount
            !(header.rewardX0 !== undefined && it.x0 >= header.rewardX0 - 6) &&
            !(readMoney(it.text) && it.x1 < amt.it.x0 - 2 && it.x0 > header.detailsX0 + 150), // foreign-currency amount column
        );
        const parts: WrappedLine[] = [];
        if (detailItems.length > 0) {
          parts.push({ text: collapse(detailItems.map((d) => d.text).join(' ')), x1: Math.max(...detailItems.map((d) => d.x1)) });
        }
        const source: SourceRef = { page: page.page, lineStart: line.index, lineEnd: line.index, rawLines: [text] };
        current = {
          row: {
            date,
            amount: amt.m.paise,
            direction: amt.m.indicator === 'CR' ? 'credit' : 'debit',
            reference: ser?.text,
            cardMask: currentCard,
            foreign: items.map((it) => (it !== amt.it ? foreignFromCell(it.text) : null)).find((f) => f) ?? undefined,
            source,
            warnings: [],
          },
          parts,
          lastY: line.y,
        };
        pendings.push(current);
        continue;
      }

      // Wrapped details belong to the row above: same left edge as the details column, close below it.
      if (
        current &&
        first.x0 >= header.detailsX0 - 8 &&
        first.x0 <= header.detailsX0 + 10 &&
        line.y - current.lastY <= 12 &&
        !items.some((it) => readMoney(it.text))
      ) {
        current.parts.push({ text, x1: Math.max(...items.map((i) => i.x1)) });
        current.row.source.lineEnd = line.index;
        current.row.source.rawLines.push(text);
        current.lastY = line.y;
      } else {
        current = null;
      }
    }
  }

  for (const p of pendings) {
    rows.push({ ...p.row, description: joinWrapped(p.parts) });
  }

  // ---- statement-level metadata (page 1) ----
  const p1 = textLines(doc, 1);
  const allText = docText(doc, 2);
  const periodRaw = /Statement period\s*:?\s*([^\n]+)/i.exec(allText)?.[1] ?? '';
  const period = findPeriod(periodRaw);
  const extracted = extractCardSummary(doc, 'DMY', period?.end);
  const summary = extracted.summary;
  const haveDebitTotals = extracted.purchases !== undefined && extracted.cash !== undefined;
  const printedTotals: NonNullable<ParsedStatement['printedTotals']> = {
    previousBalance: summary.previousBalance,
    totalDue: summary.totalDue,
    debits: haveDebitTotals ? (extracted.purchases as number) + (extracted.cash as number) : extracted.purchases,
    credits: extracted.payments,
  };
  const holderLine = p1.map((l) => l.items[0]?.text ?? '').find((t) => looksLikeHolder(t));

  const statement = finishStatement({
    parserId: ICICI_CC_ID,
    parserVersion: VERSION,
    institution: 'ICICI',
    accountType: 'credit_card',
    accountMask: cardMasks[0],
    cardMasks: cardMasks.length > 0 ? cardMasks : undefined,
    holderName: holderLine ? stripTitle(holderLine) : undefined,
    periodStart: period?.start,
    periodEnd: period?.end ?? summary.statementDate,
    printedTotals,
    rows,
    skipped,
    detection,
    nature: 'liability',
  });
  statement.cardSummary = summary;
  statement.template = { source: 'builtin' };
  return statement;
}

export const iciciCreditCardParser: PdfParser = {
  kind: 'pdf',
  id: ICICI_CC_ID,
  version: VERSION,
  label: 'ICICI Bank credit card statement',
  institution: 'ICICI',
  accountType: 'credit_card',
  fileTypes: ['pdf'],
  notes: 'Includes add-on cards. Statements from other card issuers are not read by this parser.',
  detect,
  parse,
};

