import { buildDoc } from '../pdf/layout';
import type { LayoutDoc, RawTextItem } from '../pdf/types';
import type { OcrPageInput, OcrWord } from './types';

/** Words below this engine confidence are almost always specks or ruling lines, not text. */
export const MIN_WORD_CONFIDENCE = 25;

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Convert OCR word boxes (pixels, top-down) into the same LayoutDoc a text PDF produces (PDF points).
 *
 * Words the engine placed on one recognised line share one baseline (the median word bottom), which
 * is steadier than each word's own box (descenders make boxes uneven). The shared layout builder then
 * regroups lines by y, so a table row the engine split into several fragments still comes back as one
 * row, and items are ordered by x.
 */
export function ocrPagesToLayoutDoc(pages: OcrPageInput[]): LayoutDoc {
  return buildDoc(
    pages.map((p) => {
      const words = p.words.filter((w) => w.text.trim() !== '' && w.confidence >= MIN_WORD_CONFIDENCE && w.x1 > w.x0 && w.y1 > w.y0);
      const byLine = new Map<number, OcrWord[]>();
      for (const w of words) {
        const g = byLine.get(w.line);
        if (g) g.push(w);
        else byLine.set(w.line, [w]);
      }
      const items: RawTextItem[] = [];
      for (const group of byLine.values()) {
        const bottom = median(group.map((w) => w.y1));
        const height = median(group.map((w) => w.y1 - w.y0));
        for (const w of group) {
          items.push({
            str: w.text.trim(),
            x: w.x0 / p.scale,
            // buildDoc expects bottom-up baselines (PDF space).
            y: p.height - bottom / p.scale,
            width: (w.x1 - w.x0) / p.scale,
            height: height / p.scale,
          });
        }
      }
      return { width: p.width, height: p.height, items };
    }),
  );
}
