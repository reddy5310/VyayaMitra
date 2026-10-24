import type { LayoutDoc, LayoutItem, LayoutLine, LayoutPage, RawTextItem } from './types';

/**
 * Group raw positioned fragments into lines (top to bottom) and items (left to right).
 * Grouping by y uses a tolerance relative to the glyph height; fragments that touch each
 * other on a line (no real gap) are merged into one item, wider gaps start a new item.
 */
export function buildLines(page: number, raw: RawTextItem[], pageHeight: number): LayoutLine[] {
  const frags = raw
    .filter((r) => r.str.trim() !== '')
    .map((r) => ({ ...r, top: pageHeight - r.y }))
    .sort((a, b) => a.top - b.top || a.x - b.x);

  const groups: { y: number; h: number; frags: typeof frags }[] = [];
  for (const f of frags) {
    const h = f.height > 0 ? f.height : 8;
    const tol = Math.max(1.5, h * 0.4);
    let g: (typeof groups)[number] | undefined;
    // Search recent groups only (frags are sorted by top, so the best candidate is the last one).
    for (let i = groups.length - 1; i >= 0 && i >= groups.length - 3; i--) {
      if (Math.abs(groups[i].y - f.top) <= tol) {
        g = groups[i];
        break;
      }
    }
    if (g) {
      g.frags.push(f);
      g.y = g.frags.reduce((s, x) => s + x.top, 0) / g.frags.length;
      g.h = Math.max(g.h, h);
    } else {
      groups.push({ y: f.top, h, frags: [f] });
    }
  }
  groups.sort((a, b) => a.y - b.y);

  return groups.map((g, index) => {
    const fr = [...g.frags].sort((a, b) => a.x - b.x);
    const items: LayoutItem[] = [];
    for (const f of fr) {
      const x0 = f.x;
      const x1 = f.x + f.width;
      const last = items[items.length - 1];
      const gap = last ? x0 - last.x1 : Infinity;
      const kern = Math.max(0.6, g.h * 0.1);
      const phrase = Math.max(g.h * 0.9, 4.5);
      if (last && gap <= kern && !/\s$/.test(last.text) && !/^\s/.test(f.str)) {
        last.text += f.str;
        last.x1 = Math.max(last.x1, x1);
      } else if (last && gap <= phrase) {
        last.text = last.text.replace(/\s+$/, '') + ' ' + f.str.replace(/^\s+/, '');
        last.x1 = Math.max(last.x1, x1);
      } else {
        items.push({ text: f.str, x0, x1 });
      }
    }
    for (const it of items) it.text = it.text.replace(/\s+/g, ' ').trim();
    const clean = items.filter((it) => it.text !== '');
    return {
      page,
      index,
      y: g.y,
      height: g.h,
      items: clean,
      text: clean.map((i) => i.text).join(' '),
    };
  });
}

export function buildDoc(pages: { width: number; height: number; items: RawTextItem[] }[]): LayoutDoc {
  const out: LayoutPage[] = pages.map((p, i) => ({
    page: i + 1,
    width: p.width,
    height: p.height,
    lines: buildLines(i + 1, p.items, p.height),
  }));
  return { pages: out };
}

/** Build a LayoutDoc directly from already-positioned lines (used by test fixtures). */
export function docFromLines(
  pages: { width?: number; height?: number; lines: { y: number; items: { text: string; x0: number; x1: number }[] }[] }[],
): LayoutDoc {
  return {
    pages: pages.map((p, pi) => ({
      page: pi + 1,
      width: p.width ?? 595,
      height: p.height ?? 842,
      lines: [...p.lines]
        .sort((a, b) => a.y - b.y)
        .map((l, index) => ({
          page: pi + 1,
          index,
          y: l.y,
          height: 8,
          items: l.items,
          text: l.items.map((i) => i.text).join(' '),
        })),
    })),
  };
}

export function docHasText(doc: LayoutDoc): boolean {
  return doc.pages.some((p) => p.lines.length > 0);
}
