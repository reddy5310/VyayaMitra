/**
 * Synthetic statement builders for the parsing tests.
 * Everything here is invented: names, accounts, VPAs and references are made up.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { docFromLines } from '@/parsing/pdf/layout';
import type { LayoutDoc } from '@/parsing/pdf/types';

// ─── Layout-level builders (positioned items, no PDF) ───────────────────────

/** Approximate glyph advance used for layout-level fixtures. */
const CHAR_W = 4.3;

export interface Cell {
  /** Left edge, or the right edge when `right` is true. */
  x: number;
  text: string;
  right?: boolean;
}

export const L = (x: number, text: string): Cell => ({ x, text });
export const R = (x: number, text: string): Cell => ({ x, text, right: true });

export interface LineSpec {
  y: number;
  cells: Cell[];
}

export function cellItem(c: Cell): { text: string; x0: number; x1: number } {
  const w = c.text.length * CHAR_W;
  return c.right ? { text: c.text, x0: c.x - w, x1: c.x } : { text: c.text, x0: c.x, x1: c.x + w };
}

export function layoutDoc(pages: LineSpec[][]): LayoutDoc {
  return docFromLines(
    pages.map((lines) => ({
      lines: lines.map((l) => ({ y: l.y, items: l.cells.map(cellItem).sort((a, b) => a.x0 - b.x0) })),
    })),
  );
}

// ─── Number formatting ──────────────────────────────────────────────────────

/** 12345678 paise → "1,23,456.78" (Indian grouping). */
export function inr(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  let grouped: string;
  if (whole.length <= 3) grouped = whole;
  else {
    const head = whole.slice(0, -3);
    const tail = whole.slice(-3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
  }
  return `${neg ? '-' : ''}${grouped}.${frac}`;
}

// ─── PDF-level builder (pdf-lib drawText at real positions) ─────────────────

export interface PdfText {
  /** Left edge, or right edge when `right` is true. */
  x: number;
  /** Distance from the TOP of the page. */
  y: number;
  text: string;
  size?: number;
  right?: boolean;
}

export interface PdfPageSpec {
  texts: PdfText[];
  width?: number;
  height?: number;
}

export async function buildPdf(pages: PdfPageSpec[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const width = spec.width ?? 595;
    const height = spec.height ?? 842;
    const page = pdf.addPage([width, height]);
    for (const t of spec.texts) {
      const size = t.size ?? 8;
      const w = font.widthOfTextAtSize(t.text, size);
      const x = t.right ? t.x - w : t.x;
      page.drawText(t.text, { x, y: height - t.y, size, font });
    }
  }
  return pdf.save();
}

/** A PDF page with no text at all (a "scanned" page). */
export async function buildBlankPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  return pdf.save();
}

export function T(x: number, y: number, text: string, size?: number): PdfText {
  return { x, y, text, size };
}
export function TR(x: number, y: number, text: string, size?: number): PdfText {
  return { x, y, text, size, right: true };
}

// ─── Text wrapping like the banks do ────────────────────────────────────────

/**
 * Returns a wrapper that breaks text like the statement generators do: at spaces when possible,
 * and in the middle of a token when a single token is wider than the column.
 */
export async function makeWrapper(): Promise<(text: string, size: number, maxWidth: number) => string[]> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  return (text, size, maxWidth) => {
    const w = (s: string) => font.widthOfTextAtSize(s, size);
    const lines: string[] = [];
    let line = '';
    for (const token of text.split(' ')) {
      const candidate = line ? `${line} ${token}` : token;
      if (w(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = token;
      while (w(rest) > maxWidth) {
        let n = rest.length - 1;
        while (n > 1 && w(rest.slice(0, n)) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    if (line) lines.push(line);
    return lines;
  };
}
