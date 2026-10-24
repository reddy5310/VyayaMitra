/**
 * Main-thread side of the parsing worker. Used by the public API in the browser only; tests and Node
 * keep the in-thread path. If the worker cannot start, callers silently fall back to the in-thread path.
 */
import { IncorrectPasswordError, PasswordRequiredError, ScannedPdfError, UnsupportedStatementError } from './errors';
import type { ParseOptions, ParseProgress, StatementFile } from './index';
import type { SerializedError, WorkerRequest, WorkerResponse } from './worker';

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; onProgress?: (p: ParseProgress) => void }>();

/** True when the work should run in the worker: a browser with module workers, and not under tests. */
export function workerAvailable(opts: Pick<ParseOptions, 'ocr'> = {}): boolean {
  if (broken || typeof Worker === 'undefined' || typeof window === 'undefined') return false;
  if (import.meta.env.MODE === 'test') return false;
  // OCR renders pages to a canvas; without OffscreenCanvas that has to happen on the main thread.
  if (opts.ocr && typeof OffscreenCanvas === 'undefined') return false;
  return true;
}

export function reviveError(e: SerializedError): Error {
  switch (e.name) {
    case 'PasswordRequiredError':
      return new PasswordRequiredError();
    case 'IncorrectPasswordError':
      return new IncorrectPasswordError();
    case 'ScannedPdfError':
      return new ScannedPdfError();
    case 'UnsupportedStatementError':
      return new UnsupportedStatementError(e.message, e.hints ?? []);
    default: {
      const err = new Error(e.message);
      err.name = e.name;
      return err;
    }
  }
}

function failAll(reason: unknown): void {
  for (const p of pending.values()) p.reject(reason);
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.progress as ParseProgress);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'result') p.resolve(msg.value);
    else p.reject(reviveError(msg.error));
  };
  w.onerror = () => {
    // The worker itself failed (could not load, crashed): stop using it; callers retry in-thread.
    broken = true;
    worker = null;
    failAll(new WorkerUnavailable());
  };
  worker = w;
  return w;
}

class WorkerUnavailable extends Error {
  constructor() {
    super('The parsing worker is unavailable');
    this.name = 'WorkerUnavailable';
  }
}

/**
 * Run a parse or inspect request in the worker. The file bytes are copied once and the copy is
 * transferred, so the caller's buffer stays usable (for hashing or a retry with a password).
 */
export async function runInWorker<T>(kind: 'parse' | 'inspect', file: StatementFile, opts: ParseOptions): Promise<T> {
  let w: Worker;
  try {
    w = getWorker();
  } catch {
    broken = true;
    return fallback<T>(kind, file, opts);
  }
  const id = nextId++;
  const { onProgress, ...rest } = opts;
  const bytes = file.bytes.slice();
  const request: WorkerRequest = { id, kind, file: { name: file.name, bytes, type: file.type }, opts: rest };
  try {
    return await new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      w.postMessage(request, [bytes.buffer]);
    });
  } catch (e) {
    if (e instanceof WorkerUnavailable) return fallback<T>(kind, file, opts);
    throw e;
  }
}

async function fallback<T>(kind: 'parse' | 'inspect', file: StatementFile, opts: ParseOptions): Promise<T> {
  const { parseDirect, inspectDirect } = await import('./direct');
  return (kind === 'parse' ? parseDirect(file, opts) : inspectDirect(file, opts)) as Promise<T>;
}
