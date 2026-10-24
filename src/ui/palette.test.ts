import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CATEGORIES } from '@/domain/categories';
import { chartColor } from './category';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='dark']"));
const darkBlock = css.slice(css.indexOf("[data-theme='dark']"));

describe('category palette', () => {
  for (const [name, block] of [
    ['light', lightBlock],
    ['dark', darkBlock],
  ] as const) {
    it(`defines chart slots 1..24 and a neutral in the ${name} theme`, () => {
      const slots = new Set<string>();
      for (let i = 1; i <= 24; i++) {
        const m = new RegExp(`--chart-${i}:\\s*(\\d+ \\d+ \\d+);`).exec(block);
        expect(m, `--chart-${i}`).not.toBeNull();
        slots.add(m![1]);
      }
      expect(slots.size).toBe(24); // all distinct
      expect(block).toMatch(/--chart-neutral:\s*\d+ \d+ \d+;/);
    });
  }

  it('every category colour slot resolves to a defined variable', () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(c.colorIndex).toBeGreaterThanOrEqual(0);
      expect(c.colorIndex).toBeLessThanOrEqual(24);
      expect(chartColor(c.colorIndex)).toMatch(/^rgb\(var\(--chart-(\d+|neutral)\)\)$/);
    }
  });
});
