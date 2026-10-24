/**
 * CONTRACT — owned by the adapters engineer (wave 2).
 * Turn non-PDF-text inputs into structures the universal engine already understands:
 *   spreadsheets (XLS, XLSX, ODS, and the HTML-tables-saved-as-.xls many Indian banks export) → SheetTable[]
 *   OFX / QFX bank exports → SheetTable (normalised columns)
 *   scanned PDFs → LayoutDoc via on-device OCR (Tesseract.js, self-hosted assets, lazy-loaded)
 * Everything runs on-device; no network requests except loading the app's own OCR assets.
 *
 * Heavy libraries (SheetJS, Tesseract.js, pdf.js) are imported lazily inside the functions, so
 * importing this module costs almost nothing. `ocrPdf` is lazy as a whole: callers may also
 * `await import('./adapters')` themselves.
 */
import type { LayoutDoc } from '../pdf/types';
import type { ParseProgress, StatementFile } from '../index';

export type { SheetTable, OcrWord, OcrPageInput } from './types';
export { isSpreadsheet, readSpreadsheet } from './spreadsheet';
export { isOfx, readOfx, OFX_HEADER } from './ofx';
export { ocrPagesToLayoutDoc } from './ocrLayout';

/** Render each PDF page with pdf.js and OCR it; positions are mapped back to PDF points. */
export async function ocrPdf(
  file: StatementFile,
  opts: { password?: string; onProgress?: (p: ParseProgress) => void } = {},
): Promise<LayoutDoc> {
  const { ocrPdf: run } = await import('./ocr');
  return run(file, opts);
}
