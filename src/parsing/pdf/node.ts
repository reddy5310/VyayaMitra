/**
 * Node/test helper: point the loader at the legacy pdf.js build.
 * Kept out of index.ts so the browser bundle never references the legacy build.
 */
import { setPdfjsLoader, type PdfjsModule } from './loader';

export function useLegacyPdfjsForNode(): void {
  setPdfjsLoader(async () => {
    const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return mod as unknown as PdfjsModule;
  });
}
