import type { LayoutDoc, LayoutLine } from '../pdf/types';
import { collapse } from '../core/text';
import { SHEET_CELL_WIDTH, SHEET_COL_WIDTH } from './template';

/**
 * Put spreadsheet / CSV records on the same footing as a PDF page: one line per record, one item per
 * non-empty cell at a fixed grid position. Column k occupies x0 = k*100 and x1 = k*100+90, so the
 * layout engine's right-edge column matching is exact and a column index maps straight back.
 */
export function sheetToLayout(records: string[][]): LayoutDoc {
  const lines: LayoutLine[] = records.map((rec, index) => {
    const items = rec
      .map((cell, k) => ({ text: collapse(cell ?? ''), x0: k * SHEET_COL_WIDTH, x1: k * SHEET_COL_WIDTH + SHEET_CELL_WIDTH }))
      .filter((c) => c.text !== '');
    return { page: 1, index, y: 20 + index * 12, height: 8, items, text: items.map((i) => i.text).join(' ') };
  });
  return { pages: [{ page: 1, width: Math.max(595, (records.reduce((m, r) => Math.max(m, r.length), 0) + 1) * SHEET_COL_WIDTH), height: 20 + records.length * 12 + 20, lines }] };
}
