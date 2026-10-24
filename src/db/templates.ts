/**
 * Statement-template persistence (no React): scrubbing, signature merging, use counting and the
 * shareable file format. `learning.ts` re-exports the public parts together with the hooks.
 *
 * Privacy: a template may only contain lower-case marker phrases, header labels, column geometry and
 * format flags. Everything that enters or leaves this module passes `scrubDraft`, which drops any text
 * containing a digit run of 4+ (account numbers, phone numbers, years inside addresses…), any text
 * longer than 60 characters, and rejects tables with more than 40 columns.
 */
import { z } from 'zod';
import { institutionName } from '@/domain/institutions';
import type {
  AccountType,
  StatementTemplate,
  TemplateDraft,
  TemplateSource,
} from '@/domain/types';
import { newId, nowTimestamp } from '@/lib/ids';
import { db } from './db';
import { ACCOUNT_TYPES, ValidationError, requireName } from './validation';

export const TEMPLATE_LIMITS = { columns: 40, text: 60, markers: 30, headerTokens: 60 } as const;
export const TEMPLATE_FILE_FORMAT = 'vyayamitra-templates';

const ROLES = ['date', 'value_date', 'description', 'reference', 'debit', 'credit', 'amount', 'drcr', 'balance', 'ignore'] as const;

const columnSchema = z.object({
  role: z.enum(ROLES),
  header: z.string().optional(),
  x0: z.number().finite().optional(),
  x1: z.number().finite().optional(),
  index: z.number().int().min(0).max(1000).optional(),
});

export const draftSchema = z.object({
  name: z.string().optional(),
  institution: z.string().min(1).max(40),
  accountType: z.enum(ACCOUNT_TYPES as readonly [AccountType, ...AccountType[]]),
  fileKind: z.enum(['pdf', 'sheet']),
  signature: z.object({
    markers: z.array(z.string()),
    headerTokens: z.array(z.string()),
    columnCount: z.number().int().min(0).max(1000),
  }),
  columns: z.array(columnSchema),
  dateOrder: z.enum(['DMY', 'MDY', 'YMD']).optional(),
  descriptionLayout: z.enum(['single', 'below', 'above', 'centered']).optional(),
  amountStyle: z.enum(['split', 'signed', 'drcr_suffix', 'drcr_column']),
});

/** Text that is safe to keep in a shareable template. */
export function isSafeText(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= TEMPLATE_LIMITS.text && !/\d{4,}/.test(s);
}

function safeList(list: readonly string[], max: number): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const t = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    if (isSafeText(t)) out.add(t);
    if (out.size >= max) break;
  }
  return [...out];
}

/**
 * Validate and strip a draft. Returns null when it cannot be made safe (malformed, too many columns,
 * or nothing left to recognise the format by).
 */
export function scrubDraft(input: unknown): TemplateDraft | null {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.columns.length > TEMPLATE_LIMITS.columns) return null;
  const markers = safeList(d.signature.markers, TEMPLATE_LIMITS.markers);
  const headerTokens = safeList(d.signature.headerTokens, TEMPLATE_LIMITS.headerTokens);
  if (markers.length + headerTokens.length === 0) return null;
  const institution = d.institution.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_ .&-]*$/.test(institution)) return null;

  const columns = d.columns.map((c) => {
    const col: StatementTemplate['columns'][number] = { role: c.role };
    const header = c.header?.trim().toLowerCase();
    if (header && isSafeText(header)) col.header = header;
    if (c.x0 !== undefined) col.x0 = c.x0;
    if (c.x1 !== undefined) col.x1 = c.x1;
    if (c.index !== undefined) col.index = c.index;
    return col;
  });

  const draft: TemplateDraft = {
    name: isSafeText(d.name?.trim()) ? d.name!.trim() : defaultName(institution, d.accountType, d.fileKind),
    institution,
    accountType: d.accountType,
    fileKind: d.fileKind,
    signature: { markers, headerTokens, columnCount: d.signature.columnCount },
    columns,
    amountStyle: d.amountStyle,
  };
  if (d.dateOrder) draft.dateOrder = d.dateOrder;
  if (d.descriptionLayout) draft.descriptionLayout = d.descriptionLayout;
  return draft;
}

function defaultName(institution: string, type: AccountType, kind: 'pdf' | 'sheet'): string {
  const typeLabel = type === 'credit_card' ? 'card' : type.replace('_', ' ');
  return `${institutionName(institution)} ${typeLabel} (${kind === 'pdf' ? 'PDF' : 'spreadsheet'})`.slice(0, TEMPLATE_LIMITS.text);
}

/** Identity of a format: same bank/type/kind, column count and the same marker + header sets. */
export function signatureKey(t: Pick<TemplateDraft, 'institution' | 'accountType' | 'fileKind' | 'signature'>): string {
  const sorted = (xs: readonly string[]) => [...xs].map((x) => x.toLowerCase()).sort().join(',');
  return [
    t.institution,
    t.accountType,
    t.fileKind,
    t.signature.columnCount,
    sorted(t.signature.markers),
    sorted(t.signature.headerTokens),
  ].join('|');
}

const SOURCE_RANK: Record<TemplateSource, number> = { auto: 1, imported: 2, user: 3 };

export async function findBySignature(
  t: Pick<TemplateDraft, 'institution' | 'accountType' | 'fileKind' | 'signature'>,
): Promise<StatementTemplate | undefined> {
  const key = signatureKey(t);
  const candidates = await db.templates.where('[institution+fileKind]').equals([t.institution, t.fileKind]).toArray();
  return candidates.find((c) => signatureKey(c) === key);
}

export interface UpsertOptions {
  source: TemplateSource;
  name?: string;
  /** How much to add to useCount / verifiedCount. */
  use?: number;
  verified?: number;
}

/** Insert, or merge into the template with the same signature. A user-taught definition is never replaced by an automatic one. */
export async function upsertTemplate(input: TemplateDraft | StatementTemplate, opts: UpsertOptions): Promise<StatementTemplate> {
  const draft = scrubDraft(input);
  if (!draft) throw new ValidationError('That format has nothing safe to recognise it by, so it was not saved.');
  const name = opts.name === undefined ? undefined : requireName(opts.name, 'Format name');
  const use = opts.use ?? 0;
  const verified = opts.verified ?? 0;
  const now = nowTimestamp();
  const existing = await findBySignature(draft);

  if (existing) {
    const takeDefinition = SOURCE_RANK[opts.source] >= SOURCE_RANK[existing.source];
    const next: StatementTemplate = {
      ...existing,
      useCount: existing.useCount + use,
      verifiedCount: existing.verifiedCount + verified,
      updatedAt: now,
    };
    if (takeDefinition) {
      next.name = name ?? (opts.source === existing.source ? existing.name : draft.name);
      next.source = opts.source;
      next.columns = draft.columns;
      next.signature = draft.signature;
      next.amountStyle = draft.amountStyle;
      next.accountType = draft.accountType;
      if (draft.dateOrder) next.dateOrder = draft.dateOrder;
      else delete next.dateOrder;
      if (draft.descriptionLayout) next.descriptionLayout = draft.descriptionLayout;
      else delete next.descriptionLayout;
    } else if (name) {
      next.name = name;
    }
    if (use > 0) next.lastUsedAt = now;
    await db.templates.put(next);
    return next;
  }

  const created: StatementTemplate = {
    ...draft,
    name: name ?? draft.name,
    id: newId(),
    source: opts.source,
    verifiedCount: verified,
    useCount: use,
    createdAt: now,
    updatedAt: now,
  };
  if (use > 0) created.lastUsedAt = now;
  await db.templates.add(created);
  return created;
}

/** An existing template parsed another statement. */
export async function bumpTemplate(id: string, verified: boolean): Promise<StatementTemplate | undefined> {
  const t = await db.templates.get(id);
  if (!t) return undefined;
  const now = nowTimestamp();
  const next: StatementTemplate = {
    ...t,
    useCount: t.useCount + 1,
    verifiedCount: t.verifiedCount + (verified ? 1 : 0),
    lastUsedAt: now,
    updatedAt: now,
  };
  await db.templates.put(next);
  return next;
}

// ─── shareable file ──────────────────────────────────────────────────────────

const fileSchema = z.object({
  format: z.literal(TEMPLATE_FILE_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  templates: z.array(z.unknown()).max(500),
});

export async function exportTemplateFile(ids?: string[]): Promise<Blob> {
  const all = await db.templates.toArray();
  const picked = ids ? all.filter((t) => ids.includes(t.id)) : all;
  const templates = picked.map((t) => scrubDraft(t)).filter((d): d is TemplateDraft => d !== null);
  const body = { format: TEMPLATE_FILE_FORMAT, version: 1, exportedAt: nowTimestamp(), templates };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}

export async function importTemplateFile(file: Blob): Promise<{ added: number; merged: number; rejected: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new ValidationError('This is not a VyayaMitra templates file.');
  }
  const env = fileSchema.safeParse(raw);
  if (!env.success) throw new ValidationError('This is not a VyayaMitra templates file.');

  const drafts: TemplateDraft[] = [];
  let rejected = 0;
  for (const item of env.data.templates) {
    const d = scrubDraft(item);
    if (d) drafts.push(d);
    else rejected++;
  }
  return db.transaction('rw', db.templates, async () => {
    let added = 0;
    let merged = 0;
    for (const d of drafts) {
      if (await findBySignature(d)) merged++;
      else {
        await upsertTemplate(d, { source: 'imported' });
        added++;
      }
    }
    return { added, merged, rejected };
  });
}
