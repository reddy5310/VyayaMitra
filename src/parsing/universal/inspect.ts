/**
 * "Teach VyayaMitra this format": show the user what the engine sees (columns, sample values, role
 * guesses) and turn their corrections into a reusable, scrubbed template.
 */
import type { ColumnRole, TemplateColumn, TemplateDraft } from '@/domain/types';
import type { InspectedColumn, StatementInspection, TemplateMapping } from '../index';
import { readMoney } from '../core/text';
import type { LayoutDoc, LayoutItem } from '../pdf/types';
import { parseDateTok } from './dates';
import { inferEvaluations, prepare, type Evaluated } from './engine';
import { labelLineAbove } from './models';
import { MONEY_ROLES, type UCol } from './model';
import { SHEET_COL_WIDTH, documentSignature, scrubTemplate, toColumnRole } from './template';

const MAX_PREVIEW = 40;

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function isFullDate(text: string): boolean {
  const t = parseDateTok(text, 'DMY') ?? parseDateTok(text, 'MDY');
  return !!t && (t.y !== undefined || /[A-Za-z]/.test(text));
}

/** Which column does a cell of a data row belong to? Money by right edge, everything else by overlap. */
function columnFor(item: LayoutItem, cols: UCol[], sheet: boolean): number {
  const money = readMoney(item.text) !== null || (sheet && /^[-+(]?[\d,]+(\.\d+)?\)?$/.test(item.text.trim()));
  if (money) {
    let best = -1;
    let bestD = 30;
    cols.forEach((c, i) => {
      if (!MONEY_ROLES.includes(c.role) && c.role !== 'foreign' && c.role !== 'skip') return;
      const d = Math.abs(item.x1 - c.x1);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) return best;
  }
  let best = -1;
  let bestOv = 0;
  cols.forEach((c, i) => {
    const ov = overlap(item.x0, item.x1, c.x0, c.x1);
    if (ov > bestOv) {
      bestOv = ov;
      best = i;
    }
  });
  if (best >= 0) return best;
  const cx = (item.x0 + item.x1) / 2;
  let nearD = 40;
  cols.forEach((c, i) => {
    const d = Math.abs(cx - (c.x0 + c.x1) / 2);
    if (d < nearD) {
      nearD = d;
      best = i;
    }
  });
  return best;
}

function confidenceFor(col: UCol, source: Evaluated['set']['source'], balanced: boolean): number {
  let c: number;
  if (source === 'header') c = col.role === 'skip' ? 0.35 : 0.9;
  else if (MONEY_ROLES.includes(col.role)) c = 0.7;
  else if (col.role === 'date') c = 0.85;
  else c = 0.55;
  if (balanced && col.role !== 'skip') c = Math.min(0.98, c + 0.08);
  return Math.round(c * 100) / 100;
}

export function inspectDocument(doc: LayoutDoc, fileKind: 'pdf' | 'sheet'): StatementInspection {
  const { ec, conclusive } = prepare(doc, fileKind);
  const evs = inferEvaluations(ec, conclusive);
  const best = evs[0];
  const sheet = fileKind === 'sheet';
  const signature = documentSignature(doc, ec.profile, best?.set.cols);
  const base: StatementInspection = {
    fileKind,
    institutionGuess: ec.profile.institution,
    accountTypeGuess: best?.nature === 'liability' ? 'credit_card' : ec.profile.accountType === 'credit_card' ? 'savings' : ec.profile.accountType,
    markers: signature.markers,
    headerTokens: signature.headerTokens,
    columns: [],
    previewRows: [],
    guesses: { dateOrder: ec.order, descriptionLayout: 'single', amountStyle: 'split' },
  };
  if (!best) return base;

  const cols = [...best.set.cols].sort((a, b) => a.x0 - b.x0);
  const balanced = best.reconciliation.status === 'balanced';
  const columns: InspectedColumn[] = cols.map((c, i) => ({
    id: `c${i}`,
    header: c.header,
    ...(sheet ? { index: c.index ?? Math.round(c.x0 / SHEET_COL_WIDTH) } : { x0: Math.round(c.x0 * 10) / 10, x1: Math.round(c.x1 * 10) / 10 }),
    samples: [],
    guessedRole: toColumnRole(c.role),
    confidence: confidenceFor(c, best.set.source, balanced),
  }));

  // Name columns the dictionary could not: use the label line printed above the first row.
  const labels = labelLineAbove(doc, ec.order);
  if (labels) {
    cols.forEach((c, i) => {
      if (columns[i].header) return;
      const money = MONEY_ROLES.includes(c.role) || c.role === 'foreign';
      let pick: LayoutItem | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const it of labels.items) {
        const score = money ? 30 - Math.abs(it.x1 - c.x1) : overlap(it.x0, it.x1, c.x0, c.x1);
        if (score > bestScore && score > 0) {
          bestScore = score;
          pick = it;
        }
      }
      if (pick) columns[i].header = pick.text.toLowerCase();
    });
  }

  // sample the first dated rows of the first table page
  const firstPage = doc.pages.find((p) => p.lines.some((l) => l.items.some((i) => isFullDate(i.text)) && l.items.some((i) => readMoney(i.text) !== null || sheet)));
  if (firstPage) {
    for (const line of firstPage.lines) {
      if (base.previewRows.length >= MAX_PREVIEW) break;
      if (!line.items.some((i) => isFullDate(i.text))) continue;
      if (!sheet && !line.items.some((i) => readMoney(i.text) !== null)) continue;
      const cells: Record<string, string> = {};
      for (const item of line.items) {
        const k = columnFor(item, cols, sheet);
        if (k < 0) continue;
        const id = `c${k}`;
        cells[id] = cells[id] ? `${cells[id]} ${item.text}` : item.text;
      }
      if (Object.keys(cells).length < 2) continue;
      base.previewRows.push({ page: firstPage.page, cells });
      for (const [id, v] of Object.entries(cells)) {
        const col = columns.find((c) => c.id === id);
        if (col && col.samples.length < 4) col.samples.push(v);
      }
    }
  }
  base.columns = columns;
  base.guesses = {
    dateOrder: best.order,
    descriptionLayout: best.mode,
    amountStyle: best.amountStyle,
  };
  return base;
}

/** The user's column mapping becomes a template draft: roles + geometry + scrubbed labels, nothing else. */
export function draftFromInspection(inspection: StatementInspection, mapping: TemplateMapping): TemplateDraft {
  const columns: TemplateColumn[] = inspection.columns.map((c) => {
    const role: ColumnRole = mapping.roles[c.id] ?? 'ignore';
    return {
      role,
      header: c.header,
      ...(inspection.fileKind === 'sheet' ? { index: c.index ?? 0 } : { x0: c.x0, x1: c.x1 }),
    };
  });
  return scrubTemplate({
    name: mapping.name ?? 'Custom format',
    institution: mapping.institution ?? inspection.institutionGuess,
    accountType: mapping.accountType ?? inspection.accountTypeGuess,
    fileKind: inspection.fileKind,
    signature: { markers: inspection.markers, headerTokens: inspection.headerTokens, columnCount: inspection.columns.length },
    columns,
    dateOrder: mapping.dateOrder ?? inspection.guesses.dateOrder,
    descriptionLayout: mapping.descriptionLayout ?? inspection.guesses.descriptionLayout,
    amountStyle: mapping.amountStyle ?? inspection.guesses.amountStyle,
  });
}
