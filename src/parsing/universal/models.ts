/**
 * Column models for a document: read from header rows (any bank's synonyms, English and Hindi),
 * or inferred from the numbers alone when there is no header.
 */
import { findHeader, type Role, type TableHeader } from '../core/header';
import { readMoney } from '../core/text';
import type { LayoutDoc, LayoutItem, LayoutLine, LayoutPage } from '../pdf/types';
import { parseDateTok, type DateOrder } from './dates';
import { findForeign } from './foreign';
import { makePageModel, MONEY_ROLES, type PageModel, type UCol } from './model';

export interface ModelSet {
  /** Human label, e.g. "header" or "headerless: debit | credit | balance". */
  label: string;
  /** How the roles were decided: from printed headers, or inferred from numbers. */
  source: 'header' | 'inferred' | 'template';
  modelFor: (page: number) => PageModel | null;
  /** Representative columns (for templates and inspection). */
  cols: UCol[];
  headerPages: number[];
}

/** Every item on the header line(s), including labels we do not recognise. */
function headerLineItems(page: LayoutPage, h: TableHeader): LayoutItem[] {
  return page.lines.filter((l) => l.index >= h.lineIndex && l.index <= h.lastLineIndex).flatMap((l) => l.items);
}

/** Columns for one page from its header: recognised cells plus unknown labels as ignored columns. */
export function colsFromHeader(page: LayoutPage, h: TableHeader): UCol[] {
  const cols: UCol[] = h.cells.map((c) => ({ role: c.role, x0: c.x0, x1: c.x1, header: c.text.toLowerCase() }));
  const unknown: UCol[] = [];
  for (const it of headerLineItems(page, h)) {
    if (cols.some((c) => Math.min(c.x1, it.x1) - Math.max(c.x0, it.x0) > 0)) continue;
    if (!/[\p{L}]/u.test(it.text)) continue;
    unknown.push({ role: 'skip', x0: it.x0, x1: it.x1, header: it.text.toLowerCase() });
  }
  cols.push(...unknown);
  // No recognised description: the widest unknown label between the date and the money columns is it.
  if (!cols.some((c) => c.role === 'description')) {
    const firstMoney = Math.min(...cols.filter((c) => MONEY_ROLES.includes(c.role)).map((c) => c.x0), Number.POSITIVE_INFINITY);
    const cand = unknown.filter((u) => u.x1 <= firstMoney + 4).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
    if (cand) cand.role = 'description';
  }
  return cols.sort((a, b) => a.x0 - b.x0);
}

/** Models from printed headers. Pages without a header reuse the previous page's columns. */
export function headerModelSet(doc: LayoutDoc): ModelSet | null {
  const perPage = new Map<number, { skip: number; cols: UCol[] }>();
  let last: UCol[] | null = null;
  const headerPages: number[] = [];
  let firstCols: UCol[] | null = null;
  for (const page of doc.pages) {
    const h = findHeader(page);
    if (h) {
      const cols = colsFromHeader(page, h);
      perPage.set(page.page, { skip: h.lastLineIndex, cols });
      last = cols;
      firstCols ??= cols;
      headerPages.push(page.page);
    } else if (last) {
      perPage.set(page.page, { skip: -1, cols: last });
    }
  }
  if (!firstCols) return null;
  return {
    label: 'header',
    source: 'header',
    cols: firstCols,
    headerPages,
    modelFor: (p) => {
      const e = perPage.get(p);
      const page = doc.pages.find((x) => x.page === p);
      if (!e || !page) return null;
      return makePageModel(p, e.skip, e.cols, page.lines.filter((l) => l.index > e.skip));
    },
  };
}

// ── headerless inference ───────────────────────────────────────────────────────

interface Cluster {
  x1: number;
  x0min: number;
  count: number;
}

function clusterRights(tokens: { x0: number; x1: number }[]): Cluster[] {
  const sorted = [...tokens].sort((a, b) => a.x1 - b.x1);
  const out: Cluster[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && t.x1 - last.x1 <= 7) {
      last.x1 = (last.x1 * last.count + t.x1) / (last.count + 1);
      last.x0min = Math.min(last.x0min, t.x0);
      last.count++;
    } else out.push({ x1: t.x1, x0min: t.x0, count: 1 });
  }
  return out;
}

/** An amount followed by CR / DR: its right edge for column purposes is the end of the digits. */
function withoutSuffix(item: LayoutItem): LayoutItem {
  const m = /^(.*\d)\s*(CR|DR|Cr|Dr|C|D)\.?$/.exec(item.text.trim());
  if (!m) return item;
  const keep = m[1].length / item.text.trim().length;
  return { text: m[1], x0: item.x0, x1: item.x0 + (item.x1 - item.x0) * keep };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

/**
 * Candidate role assignments for a table with no recognisable header. The caller scores every
 * candidate by running-balance consistency and keeps the best.
 */
export function headerlessModelSets(doc: LayoutDoc, order: DateOrder): ModelSet[] {
  interface DLine {
    page: number;
    line: LayoutLine;
    date: LayoutItem;
    money: { item: LayoutItem }[];
  }
  const dlines: DLine[] = [];
  for (const page of doc.pages) {
    for (const line of page.lines) {
      const dateItem = line.items.find((i) => {
        const t = parseDateTok(i.text, order);
        return t && !readMoney(i.text) && (t.y !== undefined || /[A-Za-z]/.test(i.text));
      });
      if (!dateItem) continue;
      const fx = findForeign(line.items);
      const money = line.items
        .filter((i) => i !== dateItem && !fx?.used.includes(i) && readMoney(i.text) !== null)
        .map((item) => ({ item: withoutSuffix(item) }));
      if (money.length === 0) continue;
      dlines.push({ page: page.page, line, date: dateItem, money });
    }
  }
  // Keep the rows of the main table: per page, the dates that line up in the most common left edge.
  // (A due-date box or a sample table elsewhere on the page must not shape the columns.)
  {
    const kept: DLine[] = [];
    for (const page of doc.pages) {
      const mine = dlines.filter((d) => d.page === page.page);
      if (mine.length === 0) continue;
      const bins = new Map<number, number>();
      for (const d of mine) bins.set(Math.round(d.date.x0 / 8), (bins.get(Math.round(d.date.x0 / 8)) ?? 0) + 1);
      const best = [...bins.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      kept.push(...mine.filter((d) => Math.abs(Math.round(d.date.x0 / 8) - best) <= 1));
    }
    dlines.length = 0;
    dlines.push(...kept);
  }
  if (dlines.length < 3) return [];

  const clusters = clusterRights(dlines.flatMap((d) => d.money.map((m) => m.item)));
  const minSupport = dlines.length < 12 ? 1 : Math.max(2, Math.floor(dlines.length * 0.03));
  let kept = clusters.filter((c) => c.count >= minSupport);
  if (kept.length > 4) kept = [...kept].sort((a, b) => b.count - a.count).slice(0, 4);
  kept.sort((a, b) => a.x1 - b.x1);
  if (kept.length === 0) return [];

  const byPage = new Map<number, DLine[]>();
  for (const d of dlines) byPage.set(d.page, [...(byPage.get(d.page) ?? []), d]);

  /** Columns for one page: global money clusters re-measured on this page's own rows. */
  const colsForPage = (page: number, roles: Role[]): UCol[] => {
    const mine = byPage.get(page) ?? dlines;
    const dateX0 = median(mine.map((d) => d.date.x0));
    const dateX1 = Math.max(...mine.map((d) => d.date.x1));
    const money = kept.map((g) => {
      const near = mine.flatMap((d) => d.money.map((m) => m.item)).filter((i) => Math.abs(i.x1 - g.x1) <= 12);
      return near.length > 0 ? { x1: median(near.map((i) => i.x1)), x0min: Math.min(...near.map((i) => i.x0)) } : { x1: g.x1, x0min: g.x0min };
    });
    const firstMoneyLeft = Math.min(...money.map((c) => c.x0min));
    const cols: UCol[] = [
      { role: 'date', x0: dateX0 - 2, x1: dateX1 + 1 },
      { role: 'description', x0: dateX1 + 3, x1: Math.max(dateX1 + 4, firstMoneyLeft - 3) },
    ];
    const lefts = mine.map((d) => d.line.items.find((i) => i.x1 < d.date.x0 - 1 && /^\d{1,4}$/.test(i.text)));
    const items = lefts.filter((i): i is LayoutItem => !!i);
    if (items.length >= mine.length * 0.7) {
      cols.push({ role: 'serial', x0: Math.min(...items.map((i) => i.x0)) - 1, x1: Math.max(...items.map((i) => i.x1)) + 1 });
    }
    money.forEach((c, i) => cols.push({ role: roles[i], x0: c.x0min - 1, x1: c.x1 }));
    return cols;
  };

  const variants: { label: string; roles: Role[] }[] = [];
  const k = kept.length;
  if (k === 1) variants.push({ label: 'amount', roles: ['amount'] });
  else if (k === 2) {
    variants.push({ label: 'amount | balance', roles: ['amount', 'balance'] });
    variants.push({ label: 'debit | credit', roles: ['debit', 'credit'] });
    variants.push({ label: 'credit | debit', roles: ['credit', 'debit'] });
    variants.push({ label: 'foreign | amount', roles: ['foreign', 'amount'] });
  } else if (k === 3) {
    variants.push({ label: 'debit | credit | balance', roles: ['debit', 'credit', 'balance'] });
    variants.push({ label: 'credit | debit | balance', roles: ['credit', 'debit', 'balance'] });
    variants.push({ label: 'foreign | amount | balance', roles: ['foreign', 'amount', 'balance'] });
  } else {
    variants.push({ label: 'x | debit | credit | balance', roles: ['skip', 'debit', 'credit', 'balance'] });
    variants.push({ label: 'x | credit | debit | balance', roles: ['skip', 'credit', 'debit', 'balance'] });
  }
  const pages = new Map(doc.pages.map((p) => [p.page, p]));
  const firstPage = dlines[0].page;
  return variants.map((v): ModelSet => ({
    label: `headerless: ${v.label}`,
    source: 'inferred',
    cols: colsForPage(firstPage, v.roles),
    headerPages: [],
    modelFor: (p) => {
      const page = pages.get(p);
      return page ? makePageModel(p, -1, colsForPage(p, v.roles), page.lines) : null;
    },
  }));
}

/**
 * The label line just above the first dated row, for tables whose labels no dictionary knows.
 * Used to name columns when teaching a format and to recognise the format next time.
 */
export function labelLineAbove(doc: LayoutDoc, order: DateOrder = 'DMY'): { page: number; items: LayoutItem[] } | null {
  for (const page of doc.pages) {
    const first = page.lines.findIndex((l) => {
      const hasDate = l.items.some((i) => {
        const t = parseDateTok(i.text, order);
        return !!t && (t.y !== undefined || /[A-Za-z]/.test(i.text));
      });
      return hasDate && l.items.some((i) => readMoney(i.text) !== null || /^[-+(]?[\d,]+(\.\d+)?\)?$/.test(i.text.trim()));
    });
    if (first <= 0) continue;
    for (let k = first - 1; k >= 0 && k >= first - 3; k--) {
      const l = page.lines[k];
      const noData = !l.items.some((i) => readMoney(i.text) !== null || parseDateTok(i.text, order) !== null);
      if (l.items.length >= 2 && noData) return { page: page.page, items: l.items };
    }
  }
  return null;
}
