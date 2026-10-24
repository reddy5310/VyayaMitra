import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveTemplate } from '@/db/learning';
import { META_CALIBRATION, db, resetDatabaseForTests } from '@/db/db';
import { fakeLink, fileOf, makeAccount, makeDraft, makeParsed, makeRow } from '@/db/testkit';
import { linkTransactions } from '@/engine/match';
import { understand } from '@/engine/understand';
import { inspectStatement, parseStatement } from '@/parsing';
import type { ParsedStatement, Reconciliation, StatementTemplate } from '@/domain/types';
import { commitImport, inspectImport, prepareImport, retargetPreview } from './index';

vi.mock('@/parsing', async () => ({
  ...(await import('@/parsing/errors')),
  parseStatement: vi.fn(),
  inspectStatement: vi.fn(),
  listSupportedFormats: () => [],
}));
vi.mock('@/engine/understand', async () => {
  const k = await import('@/db/testkit');
  return {
    understand: vi.fn(k.fakeUnderstand),
    trainLearnedModel: vi.fn(k.fakeTrain),
    buildCalibration: vi.fn(k.fakeCalibration),
    ruleMatches: k.fakeRuleMatches,
    normalizeMerchantKey: (s: string) => s.toLowerCase(),
  };
});
vi.mock('@/engine/match', async () => {
  const k = await import('@/db/testkit');
  return { linkTransactions: vi.fn(k.fakeLink) };
});

const mockParse = vi.mocked(parseStatement);
const BALANCED: Reconciliation = { status: 'balanced', checks: [{ label: 'running balance', ok: true }], rowBalanceBreaks: 0 };
const MISMATCH: Reconciliation = { status: 'mismatch', checks: [{ label: 'running balance', ok: false }], rowBalanceBreaks: 2 };

function rows(prefix: string) {
  return [
    makeRow({ date: '2025-03-02', amount: 25000, balanceAfter: 975000, description: `SWIGGY ${prefix}`, reference: `${prefix}1` }),
    makeRow({ date: '2025-03-03', amount: 4300, balanceAfter: 970700, description: `COFFEE ${prefix}`, reference: `${prefix}2` }),
  ];
}

function parsed(prefix: string, over: Partial<ParsedStatement> = {}) {
  return makeParsed(rows(prefix), { reconciliation: BALANCED, ...over });
}

async function importOne(name: string, p: ParsedStatement, preview?: { password?: string }) {
  mockParse.mockResolvedValueOnce(p);
  const prep = await prepareImport(fileOf(name, `bytes:${name}`), preview);
  return { prep, res: await commitImport(prep, { mode: 'add' }) };
}

beforeEach(async () => {
  await resetDatabaseForTests();
  vi.clearAllMocks();
  vi.mocked(linkTransactions).mockImplementation(fakeLink);
});

describe('automatic templates', () => {
  it('saves the inferred layout only when the statement is balanced, and merges on the next import', async () => {
    const draft = makeDraft();
    const first = await importOne('a.pdf', parsed('A', { learnedTemplate: draft, template: { source: 'inferred' } }));
    const stored = await db.templates.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: 'auto', useCount: 1, verifiedCount: 1 });
    expect((await db.statements.get(first.res.statementId))!.templateId).toBe(stored[0].id);

    await importOne('b.pdf', parsed('B', { learnedTemplate: draft, template: { source: 'inferred' } }));
    const merged = await db.templates.toArray();
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: stored[0].id, useCount: 2, verifiedCount: 2 });
  });

  it('does not learn from a mismatching or unverified statement', async () => {
    await importOne('m.pdf', parsed('M', { learnedTemplate: makeDraft(), reconciliation: MISMATCH }));
    await importOne('u.pdf', parsed('U', { learnedTemplate: makeDraft(), reconciliation: { status: 'unverified', checks: [], rowBalanceBreaks: 0 } }));
    expect(await db.templates.count()).toBe(0);
    expect((await db.statements.toArray()).every((s) => s.templateId === undefined)).toBe(true);
  });

  it('does not count a template for an import that adds nothing', async () => {
    const p = () => parsed('Z', { learnedTemplate: makeDraft() });
    await importOne('z.pdf', p());
    await importOne('z.pdf', p()); // same rows: all duplicates, no statement written
    expect((await db.templates.toArray())[0].useCount).toBe(1);
  });

  it('bumps a stored template that parsed the statement (verified only when balanced)', async () => {
    const t = await saveTemplate(makeDraft(), { source: 'user' });
    expect(t).toMatchObject({ useCount: 0, verifiedCount: 0 });
    const ok = await importOne('t1.pdf', parsed('T1', { template: { id: t.id, source: 'user' } }));
    expect(await db.templates.get(t.id)).toMatchObject({ useCount: 1, verifiedCount: 1 });
    expect((await db.statements.get(ok.res.statementId))!.templateId).toBe(t.id);
    await importOne('t2.pdf', parsed('T2', { template: { id: t.id, source: 'user' }, reconciliation: MISMATCH }));
    const after = (await db.templates.get(t.id))!;
    expect(after).toMatchObject({ useCount: 2, verifiedCount: 1 });
    expect(after.lastUsedAt).toBeTruthy();
    expect(await db.templates.count()).toBe(1);
  });

  it('does not double count when the engine also reports the stored template as learned', async () => {
    const t = await saveTemplate(makeDraft(), { source: 'auto' });
    await importOne('t.pdf', parsed('TT', { template: { id: t.id, source: 'auto' }, learnedTemplate: makeDraft() }));
    expect(await db.templates.get(t.id)).toMatchObject({ useCount: 2, verifiedCount: 2 });
  });

  it('offers stored templates and forwards parse options to the parser', async () => {
    const t = await saveTemplate(makeDraft(), { source: 'user' });
    const onProgress = vi.fn();
    mockParse.mockResolvedValueOnce(parsed('P'));
    await prepareImport(fileOf('p.pdf', 'p'), { password: 'pw', ocr: true, onProgress });
    expect(mockParse).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'p.pdf' }),
      expect.objectContaining({ password: 'pw', ocr: true, onProgress, templates: [expect.objectContaining({ id: t.id })] }),
    );
  });

  it('persists the card summary on the statement', async () => {
    const summary = { statementDate: '2025-03-15', dueDate: '2025-04-04', totalDue: 523400, minimumDue: 26200, creditLimit: 10000000 };
    const r = await importOne('card.pdf', parsed('C', { accountType: 'credit_card', cardSummary: summary }));
    expect((await db.statements.get(r.res.statementId))!.cardSummary).toEqual(summary);
  });

  it('a failed commit does not leave a half-saved template', async () => {
    mockParse.mockResolvedValueOnce(parsed('R', { learnedTemplate: makeDraft() }));
    const prep = await prepareImport(fileOf('r.pdf', 'r'));
    vi.mocked(linkTransactions).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(commitImport(prep, { mode: 'add' })).rejects.toThrow('boom');
    expect(await db.templates.count()).toBe(0);
    expect(await db.statements.count()).toBe(0);
  });
});

describe('teach this format', () => {
  it('prepare(template) -> commit saves the taught layout as a user template', async () => {
    const draft = makeDraft({ name: 'My credit union' });
    mockParse.mockResolvedValueOnce(parsed('X', { template: { source: 'user' } }));
    const prep = await prepareImport(fileOf('taught.pdf', 'taught'), { template: draft });
    expect(mockParse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ template: draft }));
    expect(prep.teachTemplate).toEqual(draft);
    expect(await db.templates.count()).toBe(0); // preview writes nothing

    const res = await commitImport(prep, { mode: 'add' });
    const [t] = await db.templates.toArray();
    expect(t).toMatchObject({ source: 'user', name: 'My credit union', useCount: 1, verifiedCount: 1 });
    expect((await db.statements.get(res.statementId))!.templateId).toBe(t.id);
  });

  it('the taught flag survives retargeting; an unreconciled teach is saved but unverified', async () => {
    await db.accounts.add(makeAccount({ id: 'other', mask: '7777', name: 'Other' }));
    mockParse.mockResolvedValueOnce(parsed('Y', { reconciliation: MISMATCH }));
    const prep = await prepareImport(fileOf('taught2.pdf', 'taught2'), { template: makeDraft() });
    const moved = await retargetPreview(prep, { accountId: 'other' });
    expect(moved.teachTemplate).toBeDefined();
    await commitImport(moved, { mode: 'add' });
    expect((await db.templates.toArray())[0]).toMatchObject({ source: 'user', useCount: 1, verifiedCount: 0 });
  });

  it('teaching an existing stored template bumps it instead of duplicating', async () => {
    const stored = await saveTemplate(makeDraft(), { source: 'user' });
    mockParse.mockResolvedValueOnce(parsed('W'));
    const prep = await prepareImport(fileOf('w.pdf', 'w'), { template: stored as StatementTemplate });
    await commitImport(prep, { mode: 'add' });
    expect(await db.templates.count()).toBe(1);
    expect(await db.templates.get(stored.id)).toMatchObject({ useCount: 1, verifiedCount: 1 });
  });

  it('a taught layout with nothing safe to store does not block the import', async () => {
    const unsafe = makeDraft({ signature: { markers: ['acct 99999999'], headerTokens: [], columnCount: 5 } });
    mockParse.mockResolvedValueOnce(parsed('V'));
    const prep = await prepareImport(fileOf('v.pdf', 'v'), { template: unsafe });
    const res = await commitImport(prep, { mode: 'add' });
    expect(res.inserted).toBe(2);
    expect(await db.templates.count()).toBe(0);
  });

  it('inspectImport passes straight through to the parser', async () => {
    const inspection = { fileKind: 'pdf' } as Awaited<ReturnType<typeof inspectStatement>>;
    vi.mocked(inspectStatement).mockResolvedValueOnce(inspection);
    const file = fileOf('i.pdf', 'i');
    expect(await inspectImport(file, { password: 'pw' })).toBe(inspection);
    expect(inspectStatement).toHaveBeenCalledWith(file, { password: 'pw' });
  });
});

describe('calibration reaches understanding', () => {
  it('passes stored calibration and the learned model into every understand call', async () => {
    await db.meta.put({ key: META_CALIBRATION, value: { version: 1, builtAt: 't', eventCount: 7 } });
    await db.meta.put({ key: 'learnedModel', value: { version: 1, trainedAt: 't', exampleCount: 3 } });
    mockParse.mockResolvedValueOnce(parsed('K'));
    await prepareImport(fileOf('k.pdf', 'k'));
    const ctxs = vi.mocked(understand).mock.calls.map((c) => c[1]);
    expect(ctxs).toHaveLength(2);
    for (const c of ctxs) {
      expect(c.calibration).toMatchObject({ eventCount: 7 });
      expect(c.learned).toMatchObject({ exampleCount: 3 });
    }
  });
});

describe('issuer category signal (bankCategory)', () => {
  it('reaches understand during staging and is stored on the transaction at commit', async () => {
    const r = rows('BC');
    r[0].bankCategory = 'Dining';
    mockParse.mockResolvedValueOnce(parsed('BC', { rows: r }));
    const prep = await prepareImport(fileOf('bc.pdf', 'bc'));
    const inputs = vi.mocked(understand).mock.calls.map((c) => c[0]);
    expect(inputs.map((i) => i.bankCategory)).toEqual(['Dining', undefined]);

    await commitImport(prep, { mode: 'add' });
    const txns = await db.transactions.toArray();
    expect(txns.find((t) => t.rawDescription.startsWith('SWIGGY'))!.bankCategory).toBe('Dining');
    expect(txns.find((t) => t.rawDescription.startsWith('COFFEE'))!.bankCategory).toBeUndefined();
  });

  it('is kept when re-understanding (reprocess and reset)', async () => {
    const { reprocessLedger } = await import('./index');
    const { resetTransaction } = await import('@/db/actions');
    const r = rows('RB');
    r[0].bankCategory = 'Groceries';
    mockParse.mockResolvedValueOnce(parsed('RB', { rows: r }));
    await commitImport(await prepareImport(fileOf('rb.pdf', 'rb')), { mode: 'add' });
    vi.mocked(understand).mockClear();
    await reprocessLedger();
    expect(vi.mocked(understand).mock.calls.some((c) => c[0].bankCategory === 'Groceries')).toBe(true);
    vi.mocked(understand).mockClear();
    const t = (await db.transactions.toArray()).find((x) => x.bankCategory)!;
    await resetTransaction(t.id);
    expect(vi.mocked(understand).mock.calls.map((c) => c[0].bankCategory)).toContain('Groceries');
  });
});
