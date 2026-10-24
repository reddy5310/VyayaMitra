/** Positioned text reconstructed from a PDF page (or built synthetically in tests). */

/** One run of text on a line. x grows rightwards, in PDF points. */
export interface LayoutItem {
  text: string;
  x0: number;
  x1: number;
}

export interface LayoutLine {
  /** 1-based page number. */
  page: number;
  /** 0-based index of the line within its page (top to bottom). */
  index: number;
  /** Baseline y in "top-down" points (0 = top of page) so larger y = lower on page. */
  y: number;
  /** Typical glyph height on this line. */
  height: number;
  items: LayoutItem[];
  /** Items joined with single spaces, left to right. */
  text: string;
}

export interface LayoutPage {
  page: number;
  width: number;
  height: number;
  lines: LayoutLine[];
}

export interface LayoutDoc {
  pages: LayoutPage[];
}

/** A raw positioned text fragment, as pdf.js reports it (y bottom-up). */
export interface RawTextItem {
  str: string;
  x: number;
  /** Baseline y, bottom-up (PDF space). */
  y: number;
  width: number;
  height: number;
}
