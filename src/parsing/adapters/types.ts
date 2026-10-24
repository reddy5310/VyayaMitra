/** Shared adapter types. Re-exported from `./index`. */

export interface SheetTable {
  /** Sheet name (or 'OFX'). */
  name: string;
  /** Every row as display strings, exactly as the bank formatted them (dates and amounts as text). */
  records: string[][];
}

/** One recognised word, in rendered-image pixels (origin top-left, y grows downwards). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0..100 as reported by the OCR engine. */
  confidence: number;
  /** Words with the same `line` came from one recognised text line. */
  line: number;
}

export interface OcrPageInput {
  /** Page size in PDF points. */
  width: number;
  height: number;
  /** Rendered pixels per PDF point (e.g. 2.5). */
  scale: number;
  words: OcrWord[];
}
