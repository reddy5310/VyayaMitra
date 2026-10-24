/**
 * Self-training: statement formats as reusable templates.
 *
 * A template holds only header labels, marker phrases from the bank knowledge base, column geometry
 * and format flags. Everything is scrubbed so that no names, numbers, addresses or amounts can leak.
 */
import type {
  AccountType,
  ColumnRole,
  Institution,
  StatementTemplate,
  TemplateColumn,
  TemplateDraft,
} from '@/domain/types';
import { findHeader, type Role } from '../core/header';
import { norm } from '../core/text';
import type { LayoutDoc } from '../pdf/types';
import { parseDateTok, type DateOrder } from './dates';
import { colsFromHeader, labelLineAbove, type ModelSet } from './models';
import { makePageModel, type UCol } from './model';
import type { DocProfile } from './knowledge';

export type AmountStyle = StatementTemplate['amountStyle'];
export type DescLayout = NonNullable<StatementTemplate['descriptionLayout']>;

const ROLE_TO_COLUMN: Record<Role, ColumnRole> = {
  date: 'date',
  valueDate: 'value_date',
  description: 'description',
  reference: 'reference',
  debit: 'debit',
  credit: 'credit',
  amount: 'amount',
  balance: 'balance',
  type: 'drcr',
  mode: 'description',
  category: 'ignore',
  serial: 'ignore',
  skip: 'ignore',
  foreign: 'ignore',
};

const COLUMN_TO_ROLE: Record<ColumnRole, Role> = {
  date: 'date',
  value_date: 'valueDate',
  description: 'description',
  reference: 'reference',
  debit: 'debit',
  credit: 'credit',
  amount: 'amount',
  drcr: 'type',
  balance: 'balance',
  ignore: 'skip',
};

export function toColumnRole(r: Role): ColumnRole {
  return ROLE_TO_COLUMN[r];
}
export function toRole(r: ColumnRole): Role {
  return COLUMN_TO_ROLE[r];
}

/** Sheet columns are laid out on a fixed grid when converted to a LayoutDoc. */
export const SHEET_COL_WIDTH = 100;
export const SHEET_CELL_WIDTH = 90;

// ── scrubbing ────────────────────────────────────────────────────────────────

/** A header label is safe to store when it is short, label-like and carries no digits runs or contact data. */
export function scrubLabel(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40) return undefined;
  if (/\d{4,}/.test(t) || /@|https?:|www\./.test(t)) return undefined;
  if (/\d/.test(t) && /[,/]/.test(t)) return undefined; // address-like
  if (t.split(' ').length > 6) return undefined;
  return t;
}

/** A template's display name keeps its case but never carries digit runs, contact data or long text. */
export function scrubName(s: string | undefined): string {
  const t = (s ?? '').split(/\s+/).join(' ').trim();
  if (!t || t.length > 60 || /\d{4,}/.test(t) || t.includes('@') || /https?:|www\./.test(t)) return 'Custom format';
  return t;
}

export function scrubMarkers(markers: string[]): string[] {
  return [...new Set(markers.map((m) => m.toLowerCase().trim()).filter((m) => m && m.length <= 40 && !/\d{4,}/.test(m)))];
}

/** Tokens of a header row that are safe to store: plain words of 2-20 letters. */
export function headerTokensOf(labels: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const l of labels) {
    const s = scrubLabel(l);
    if (!s) continue;
    for (const w of norm(s).split(' ')) if (/^\p{L}{2,20}$/u.test(w)) out.add(w);
  }
  return [...out].sort();
}

/** Remove anything personal from a template draft (used for taught and imported templates). */
export function scrubTemplate(t: TemplateDraft): TemplateDraft {
  return {
    ...t,
    name: scrubName(t.name),
    signature: {
      markers: scrubMarkers(t.signature.markers),
      headerTokens: headerTokensOf(t.signature.headerTokens),
      columnCount: Math.max(0, Math.min(40, Math.round(t.signature.columnCount))),
    },
    columns: t.columns.map((c) => ({
      role: c.role,
      header: scrubLabel(c.header),
      ...(c.x0 !== undefined ? { x0: Math.round(c.x0 * 10) / 10 } : {}),
      ...(c.x1 !== undefined ? { x1: Math.round(c.x1 * 10) / 10 } : {}),
      ...(c.index !== undefined ? { index: c.index } : {}),
    })),
  };
}

// ── signature of a document ──────────────────────────────────────────────────

export interface DocSignature {
  markers: string[];
  headerTokens: string[];
  columnCount: number;
}

export function documentSignature(doc: LayoutDoc, profile: DocProfile, cols?: UCol[]): DocSignature {
  let labels: string[] = [];
  let count = cols?.length ?? 0;
  for (const p of doc.pages) {
    const h = findHeader(p);
    if (h) {
      const hc = colsFromHeader(p, h);
      labels = hc.map((c) => c.header ?? '');
      count = hc.length;
      break;
    }
  }
  if (labels.length === 0) {
    // a table whose labels no dictionary knows: the label line above the first row still names it
    const line = labelLineAbove(doc);
    if (line) {
      labels = line.items.map((i) => i.text);
      count = line.items.length;
    }
  }
  return { markers: scrubMarkers(profile.markers), headerTokens: headerTokensOf(labels), columnCount: count };
}

export interface TemplateMatch {
  template: StatementTemplate;
  score: number;
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Templates of the right kind whose signature fits the document, best first. */
export function matchTemplates(templates: readonly StatementTemplate[], sig: DocSignature, fileKind: 'pdf' | 'sheet'): TemplateMatch[] {
  const out: TemplateMatch[] = [];
  for (const t of templates) {
    if (t.fileKind !== fileKind) continue;
    const markerScore =
      t.signature.markers.length === 0 ? 0.5 : t.signature.markers.some((m) => sig.markers.includes(m.toLowerCase())) ? 1 : 0;
    const tokenScore =
      t.signature.headerTokens.length === 0 || sig.headerTokens.length === 0
        ? t.signature.headerTokens.length === sig.headerTokens.length
          ? 1
          : 0.3
        : jaccard(t.signature.headerTokens, sig.headerTokens);
    const diff = Math.abs(t.signature.columnCount - sig.columnCount);
    const countScore = diff === 0 ? 1 : diff === 1 ? 0.5 : 0;
    const score = 0.4 * markerScore + 0.45 * tokenScore + 0.15 * countScore;
    if (score >= 0.6) out.push({ template: t, score });
  }
  return out.sort((a, b) => b.score - a.score || b.template.verifiedCount - a.template.verifiedCount);
}

// ── applying a template ──────────────────────────────────────────────────────

function colsFromTemplate(t: Pick<StatementTemplate, 'columns' | 'fileKind'>): UCol[] {
  return t.columns.map((c): UCol => {
    const role = toRole(c.role);
    if (t.fileKind === 'sheet' || c.index !== undefined) {
      const i = c.index ?? 0;
      return { role, x0: i * SHEET_COL_WIDTH, x1: i * SHEET_COL_WIDTH + SHEET_CELL_WIDTH, header: c.header, index: i };
    }
    return { role, x0: c.x0 ?? 0, x1: c.x1 ?? 0, header: c.header };
  });
}

/** Models that read the document with exactly the columns of a template. */
export function modelSetFromTemplate(doc: LayoutDoc, t: StatementTemplate | TemplateDraft): ModelSet {
  const base = colsFromTemplate(t);
  const headerWords = base.filter((c) => c.header).map((c) => norm(c.header as string));
  const sheet = t.fileKind === 'sheet';
  const perPage = new Map<number, { skip: number; cols: UCol[] }>();
  let firstDated = -1;
  for (const page of doc.pages) {
    let skip = -1;
    let cols = base;
    // Re-anchor columns on this page's header row when the template's labels are found there.
    if (!sheet && headerWords.length > 0) {
      let best: { line: number; cols: UCol[]; hits: number } | null = null;
      for (const line of page.lines) {
        if (line.items.length < 2) continue;
        let hits = 0;
        const next = base.map((c): UCol => {
          if (!c.header) return c;
          const it = line.items.find((i) => norm(i.text) === norm(c.header as string));
          if (!it) return c;
          hits++;
          return { ...c, x0: it.x0, x1: it.x1 };
        });
        if (hits > (best?.hits ?? 0)) best = { line: line.index, cols: next, hits };
      }
      if (best && best.hits >= Math.max(2, Math.ceil(headerWords.length * 0.6))) {
        skip = best.line;
        cols = best.cols;
      }
    }
    if (sheet && page.page === 1) {
      // everything before the first dated line is title / header
      const moneyX = base.filter((c) => c.role === 'debit' || c.role === 'credit' || c.role === 'amount' || c.role === 'balance').map((c) => c.x0);
      const isDate = (t: string) => {
        const k = parseDateTok(t, 'DMY') ?? parseDateTok(t, 'MDY');
        return !!k && k.y !== undefined;
      };
      firstDated = page.lines.findIndex(
        (l) => l.items.some((i) => isDate(i.text)) && l.items.some((i) => moneyX.some((x) => Math.abs(i.x0 - x) < 1) && /\d/.test(i.text)),
      );
      skip = firstDated > 0 ? firstDated - 1 : -1;
    }
    perPage.set(page.page, { skip, cols });
  }
  return {
    label: 'template',
    source: 'template',
    cols: base,
    headerPages: [],
    modelFor: (p) => {
      const e = perPage.get(p);
      const page = doc.pages.find((x) => x.page === p);
      if (!e || !page) return null;
      return makePageModel(p, e.skip, e.cols, page.lines.filter((l) => l.index > e.skip));
    },
  };
}

// ── making a template ────────────────────────────────────────────────────────

export interface DraftInput {
  name?: string;
  institution: Institution;
  accountType: AccountType;
  fileKind: 'pdf' | 'sheet';
  cols: UCol[];
  signature: DocSignature;
  dateOrder: DateOrder;
  descriptionLayout: DescLayout;
  amountStyle: AmountStyle;
}

export function makeDraft(i: DraftInput): TemplateDraft {
  const columns: TemplateColumn[] = i.cols.map((c) => ({
    role: toColumnRole(c.role),
    header: c.header,
    ...(i.fileKind === 'sheet' ? { index: c.index ?? Math.round(c.x0 / SHEET_COL_WIDTH) } : { x0: c.x0, x1: c.x1 }),
  }));
  return scrubTemplate({
    name: i.name ?? `${i.institution === 'OTHER' ? 'Custom' : i.institution} ${i.accountType.replace('_', ' ')} format`,
    institution: i.institution,
    accountType: i.accountType,
    fileKind: i.fileKind,
    signature: i.signature,
    columns,
    dateOrder: i.dateOrder,
    descriptionLayout: i.descriptionLayout,
    amountStyle: i.amountStyle,
  });
}
