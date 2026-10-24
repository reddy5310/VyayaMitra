import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildPdf } from '../../tests/fixtures/parsing/builders';
import { buildEncryptedPdf } from '../../tests/fixtures/parsing/encrypted';
import { dbsPages } from '../../tests/fixtures/parsing/statements';
import { IncorrectPasswordError, PasswordRequiredError, ScannedPdfError, UnsupportedStatementError } from './errors';
import { useLegacyPdfjsForNode } from './pdf/node';
import type { WorkerRequest, WorkerResponse } from './worker';
import { reviveError, workerAvailable } from './workerClient';

describe('worker client', () => {
  it('stays in-thread under tests', () => {
    expect(workerAvailable()).toBe(false);
    expect(workerAvailable({ ocr: true })).toBe(false);
  });

  it('re-creates the same error classes, codes and hints on the main thread', () => {
    expect(reviveError({ name: 'PasswordRequiredError', message: 'x' })).toBeInstanceOf(PasswordRequiredError);
    expect(reviveError({ name: 'IncorrectPasswordError', message: 'x' })).toBeInstanceOf(IncorrectPasswordError);
    expect(reviveError({ name: 'ScannedPdfError', message: 'x' })).toBeInstanceOf(ScannedPdfError);
    const u = reviveError({ name: 'UnsupportedStatementError', message: 'nope', hints: ['try a CSV'] }) as UnsupportedStatementError;
    expect(u).toBeInstanceOf(UnsupportedStatementError);
    expect(u.hints).toEqual(['try a CSV']);
    expect(u.code).toBe('unsupported');
    expect(reviveError({ name: 'TypeError', message: 'boom' }).name).toBe('TypeError');
  });
});

describe('worker protocol (the worker module driven directly)', () => {
  const posted: WorkerResponse[] = [];
  const fakeSelf: { postMessage: (m: WorkerResponse) => void; onmessage: ((e: { data: WorkerRequest }) => Promise<void>) | null } = {
    postMessage: (m) => posted.push(m),
    onmessage: null,
  };

  beforeAll(async () => {
    vi.stubGlobal('self', fakeSelf);
    await import('./worker');
    useLegacyPdfjsForNode(); // the worker installs the browser pdf.js loader; Node needs the legacy build
  });
  afterEach(() => {
    posted.length = 0;
  });

  const send = async (req: WorkerRequest) => {
    await fakeSelf.onmessage?.({ data: req });
    return posted.filter((m) => m.id === req.id);
  };

  it('answers a parse request with progress events and the result', async () => {
    const bytes = await buildPdf((await dbsPages()).pages);
    const out = await send({ id: 1, kind: 'parse', file: { name: 'a.pdf', bytes }, opts: {} });
    expect(out.some((m) => m.type === 'progress')).toBe(true);
    const result = out.find((m) => m.type === 'result');
    expect(result && 'value' in result && (result.value as { rows: unknown[] }).rows.length).toBe(7);
  });

  it('answers an inspect request', async () => {
    const bytes = await buildPdf((await dbsPages()).pages);
    const out = await send({ id: 2, kind: 'inspect', file: { name: 'a.pdf', bytes }, opts: {} });
    const result = out.find((m) => m.type === 'result');
    expect(result && 'value' in result && (result.value as { columns: unknown[] }).columns.length).toBeGreaterThan(3);
  });

  it('serialises password errors so the client can re-throw the same class', async () => {
    const locked = buildEncryptedPdf('pw-1234');
    const none = await send({ id: 3, kind: 'parse', file: { name: 'l.pdf', bytes: locked }, opts: {} });
    const err1 = none.find((m) => m.type === 'error');
    expect(err1 && 'error' in err1 && err1.error).toMatchObject({ name: 'PasswordRequiredError', code: 'password_required' });
    const wrong = await send({ id: 4, kind: 'parse', file: { name: 'l.pdf', bytes: locked }, opts: { password: 'bad' } });
    const err2 = wrong.find((m) => m.type === 'error');
    expect(err2 && 'error' in err2 && err2.error.name).toBe('IncorrectPasswordError');
  });

  it('serialises unsupported-file errors with their hints', async () => {
    const out = await send({ id: 5, kind: 'parse', file: { name: 'x.csv', bytes: new TextEncoder().encode('name,city\nA,B') }, opts: {} });
    const err = out.find((m) => m.type === 'error');
    expect(err && 'error' in err && err.error.name).toBe('UnsupportedStatementError');
    expect(err && 'error' in err && (err.error.hints ?? []).length).toBeGreaterThan(0);
  });
});
