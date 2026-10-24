import { IncorrectPasswordError, PasswordRequiredError, ScannedPdfError } from '../errors';
import { buildDoc, docHasText } from './layout';
import { loadPdfjs, type PdfTextItem } from './loader';
import type { LayoutDoc, RawTextItem } from './types';

function isTextItem(x: unknown): x is PdfTextItem {
  return typeof x === 'object' && x !== null && typeof (x as PdfTextItem).str === 'string' && Array.isArray((x as PdfTextItem).transform);
}

function passwordErrorCode(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException') {
    const code = (e as { code?: number }).code;
    return typeof code === 'number' ? code : 1;
  }
  return null;
}

/**
 * Read a PDF entirely on-device and reconstruct its positioned lines.
 * @throws PasswordRequiredError | IncorrectPasswordError | ScannedPdfError
 */
export async function extractLayout(bytes: Uint8Array, opts: { password?: string } = {}): Promise<LayoutDoc> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers/detaches the buffer it is given, so hand it a copy.
  const data = new Uint8Array(bytes);
  const task = pdfjs.getDocument({
    data,
    password: opts.password,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    const code = passwordErrorCode(e);
    if (code === 1) throw new PasswordRequiredError();
    if (code === 2) throw new IncorrectPasswordError();
    throw e;
  }
  try {
    const pages: { width: number; height: number; items: RawTextItem[] }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const it of content.items) {
        if (!isTextItem(it) || it.str.trim() === '') continue;
        const t = it.transform;
        // Skip rotated text (watermarks, vertical barcodes): statements read left to right.
        if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
        items.push({ str: it.str, x: t[4], y: t[5], width: it.width, height: it.height || Math.abs(t[3]) });
      }
      pages.push({ width: vp.width, height: vp.height, items });
      page.cleanup?.();
    }
    const doc = buildDoc(pages);
    if (!docHasText(doc)) throw new ScannedPdfError();
    return doc;
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}
