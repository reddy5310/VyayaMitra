/**
 * On-device OCR for scanned PDFs. Pages are rendered with pdf.js and recognised by Tesseract.js
 * (WebAssembly). The worker, wasm core and English model are the app's own files under `ocr/`
 * (copied from node_modules at build time by scripts/copy-ocr-assets.mjs), so no CDN is used and
 * everything works offline after first use. All of it is lazy-loaded, and the worker is terminated afterwards.
 */
import type { StatementFile, ParseProgress } from '../index';
import { IncorrectPasswordError, PasswordRequiredError, UnsupportedStatementError } from '../errors';
import { loadPdfjs, type PdfPageProxy } from '../pdf/loader';
import type { LayoutDoc } from '../pdf/types';
import { ocrPagesToLayoutDoc } from './ocrLayout';
import type { OcrPageInput, OcrWord } from './types';

/** Rendered pixels per PDF point. ~2.5 reads 9-pt statement text reliably without huge canvases. */
export const OCR_SCALE = 2.5;
/** Cap on the longer rendered side, so a poster-sized page cannot exhaust memory. */
const MAX_SIDE_PX = 3200;

interface RenderablePage extends PdfPageProxy {
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
}
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function passwordErrorCode(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException') {
    const code = (e as { code?: number }).code;
    return typeof code === 'number' ? code : 1;
  }
  return null;
}

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function canvasToBlob(c: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the page.'))), 'image/png'));
}

/** Absolute URL of the app's own OCR assets (works under /VyayaMitra/ and in dev). */
export function ocrAssetBase(): string {
  const base = `${import.meta.env.BASE_URL}ocr/`;
  const origin = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  return new URL(base, origin).href;
}

export async function ocrPdf(
  file: StatementFile,
  opts: { password?: string; onProgress?: (p: ParseProgress) => void } = {},
): Promise<LayoutDoc> {
  const report = (done: number, total: number, message: string) => opts.onProgress?.({ stage: 'ocr', done, total, message });

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(file.bytes), // pdf.js detaches the buffer it is given
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

  type Worker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>;
  let worker: Worker | undefined;
  try {
    const total = pdf.numPages;
    report(0, total, 'Loading the on-device text reader');
    const { createWorker, OEM, PSM } = (await import('tesseract.js/dist/tesseract.esm.min.js')).default;
    const base = ocrAssetBase();
    worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: base, // a directory: the worker picks the SIMD / non-SIMD wasm build the device supports
      langPath: base,
      gzip: false, // the model is shipped decompressed: the bundled in-browser gunzip corrupts it
      cacheMethod: 'none', // the service worker already caches these files
      logger: () => undefined,
    });
    await worker.setParameters({
      // Statements are tables: treat each page as one block so columns are not split into separate text flows.
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });

    const pages: OcrPageInput[] = [];
    for (let n = 1; n <= total; n++) {
      report(n - 1, total, `Reading page ${n} of ${total}`);
      const page = (await pdf.getPage(n)) as RenderablePage;
      const unit = page.getViewport({ scale: 1 });
      const scale = Math.min(OCR_SCALE, MAX_SIDE_PX / Math.max(unit.width, unit.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
      if (!ctx) throw new UnsupportedStatementError('This browser cannot draw the page for text recognition.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const image = await canvasToBlob(canvas);
      canvas.width = 0; // release the bitmap early
      page.cleanup?.();

      const { data } = await worker.recognize(image, {}, { blocks: true });
      const words: OcrWord[] = [];
      let line = 0;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const l of para.lines) {
            for (const w of l.words) {
              words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence, line });
            }
            line++;
          }
        }
      }
      pages.push({ width: unit.width, height: unit.height, scale, words });
      report(n, total, `Read page ${n} of ${total}`);
    }

    const doc = ocrPagesToLayoutDoc(pages);
    if (!doc.pages.some((p) => p.lines.length > 0)) {
      throw new UnsupportedStatementError('No readable text was found in this scanned statement.', [
        'Scan at a higher resolution (300 dpi) with the page straight and well lit.',
        'Or download the digital statement from your net banking.',
      ]);
    }
    return doc;
  } finally {
    await worker?.terminate().catch(() => undefined);
    await pdf.destroy().catch(() => undefined);
  }
}
