/**
 * Lazy, injectable pdf.js loader.
 *
 * In the browser the module is imported on demand (so pdf.js stays out of the main bundle) and
 * its worker is bundled by Vite and served from the app itself, so it works offline.
 * Tests and Node scripts call `setPdfjsLoader()` with the legacy build instead; this file never
 * statically imports a `?url` module, so Node never evaluates one.
 */

/** The subset of the pdf.js API we use. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}
export interface PdfPageProxy {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): void;
}
export interface PdfDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}
export interface PdfjsModule {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocumentProxy>; destroy?: () => Promise<void> };
  GlobalWorkerOptions?: { workerSrc: string };
  PasswordResponses?: { NEED_PASSWORD: number; INCORRECT_PASSWORD: number };
}

export type PdfjsLoader = () => Promise<PdfjsModule>;

let customLoader: PdfjsLoader | null = null;
let cached: Promise<PdfjsModule> | null = null;

/** Override how pdf.js is loaded (tests / Node). Pass null to restore the browser default. */
export function setPdfjsLoader(loader: PdfjsLoader | null): void {
  customLoader = loader;
  cached = null;
}

async function browserLoader(): Promise<PdfjsModule> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
  return pdfjs as unknown as PdfjsModule;
}

export function loadPdfjs(): Promise<PdfjsModule> {
  if (!cached) {
    cached = (customLoader ?? browserLoader)().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}
