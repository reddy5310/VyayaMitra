/**
 * Module Web Worker that runs parseStatement / inspectStatement off the main thread.
 *
 * Messages in:  { id, kind: 'parse' | 'inspect', file, opts }   (opts has no functions)
 * Messages out: { id, type: 'progress', progress } | { id, type: 'result', value } | { id, type: 'error', error }
 * Errors keep their class name and code so the client can re-throw the same class.
 * The password only ever travels inside the request message; it is neither stored nor logged here.
 */
import type { ParseOptions, StatementFile } from './index';
import { inspectDirect, parseDirect } from './direct';
import { setPdfjsLoader, type PdfjsModule } from './pdf/loader';

export interface WorkerRequest {
  id: number;
  kind: 'parse' | 'inspect';
  file: StatementFile;
  opts: Omit<ParseOptions, 'onProgress'>;
}

export interface SerializedError {
  name: string;
  code?: string;
  message: string;
  hints?: string[];
}

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: unknown }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; error: SerializedError };

// pdf.js already runs in this worker: give it its worker code in-thread instead of spawning a nested one.
setPdfjsLoader(async () => {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs')]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs as unknown as PdfjsModule;
});

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

function serialize(e: unknown): SerializedError {
  if (e instanceof Error) {
    const x = e as Error & { code?: string; hints?: string[] };
    return { name: x.name, code: x.code, message: x.message, hints: x.hints };
  }
  return { name: 'Error', message: String(e) };
}

scope.onmessage = async (e) => {
  const { id, kind, file, opts } = e.data;
  const onProgress = (progress: unknown) => scope.postMessage({ id, type: 'progress', progress });
  try {
    const value =
      kind === 'parse'
        ? await parseDirect(file, { ...opts, onProgress })
        : await inspectDirect(file, { ...opts, onProgress });
    scope.postMessage({ id, type: 'result', value });
  } catch (err) {
    scope.postMessage({ id, type: 'error', error: serialize(err) });
  }
};
