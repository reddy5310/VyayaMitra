/**
 * CONTRACT — owned by the ledger/import module.
 * Staged, reviewable, atomic imports:
 *   prepareImport  → parse + understand + duplicate check, writes NOTHING
 *   commitImport   → one Dexie transaction; on any failure nothing changes
 * A failed or cancelled import never touches existing data.
 *
 * Why this cannot lose data: parsing (the only step that can fail on a bad password or an
 * unsupported file) happens in `prepareImport`, which never writes. `commitImport` performs
 * every write — account, statement replacement, inserts, link patches — inside a single
 * all-tables Dexie transaction, so any throw rolls the database back to exactly what it was.
 */
import { readAll, writeAll, db } from '@/db/db';
import { bumpTemplate, scrubDraft, signatureKey, upsertTemplate } from '@/db/templates';
import {
  buildUnderstandContext,
  detachDeleted,
  loadLedgerContext,
  reprocessTransactions,
  relinkAll,
  retrainLearnedModel,
  understandTransaction,
  type LedgerContext,
} from '@/db/ledger';
import { ValidationError, validateNewAccount } from '@/db/validation';
import type {
  Account,
  Paise,
  ParsedRow,
  ParsedStatement,
  Statement,
  StatementTemplate,
  TemplateDraft,
  Transaction,
} from '@/domain/types';
import type { Understanding } from '@/engine/understand';
import {
  inspectStatement,
  parseStatement,
  type ParseOptions,
  type StatementFile,
  type StatementInspection,
} from '@/parsing';
import { newId, nowTimestamp, sha256Hex } from '@/lib/ids';
import {
  accountToInput,
  accountMasks,
  candidateAccounts,
  findMatchingAccount,
  proposeAccount,
  statementMasks,
  type NewAccountInput,
} from './accounts';
import { storedFileName } from './fileName';
import { computeFingerprints, rowFingerprint } from './fingerprint';

export type { NewAccountInput };
export { rowFingerprint, computeFingerprints };

export interface PreviewRow {
  /** Index into parsed.rows. */
  index: number;
  row: ParsedRow;
  understanding: Understanding;
  fingerprint: string;
  /** Existing transaction id this row duplicates (same account + fingerprint). */
  duplicateOf?: string;
}

export interface ImportPreview {
  file: { name: string; size: number; hash: string };
  parsed: ParsedStatement;
  /** The exact same file was imported before. */
  alreadyImported?: { statementId: string; accountId: string; importedAt: string };
  /** Existing statements of the chosen account whose period overlaps this one. */
  overlapping: { statementId: string; fileName: string; periodStart?: string; periodEnd?: string }[];
  /** Account the rows were understood against: an existing match, or a proposed new account. */
  account: { existingAccountId?: string; proposed: NewAccountInput };
  /** Other existing accounts that could plausibly be the right one. */
  candidateAccountIds: string[];
  rows: PreviewRow[];
  /** Set by the "teach this format" flow: committing saves this layout as a user template. */
  teachTemplate?: StatementTemplate | TemplateDraft;
  stats: {
    total: number;
    new: number;
    duplicates: number;
    needsReview: number;
    /** Sum of every debit / credit row in the file (not only the new ones). */
    debits: Paise;
    credits: Paise;
  };
}

export interface CommitChoices {
  /** Use an existing account… */
  accountId?: string;
  /** …or create this one (ignored when accountId is set). */
  newAccount?: NewAccountInput;
  /**
   * add     — insert new rows, skip duplicates
   * replace — atomically delete `replaceStatementId` (and its transactions) then insert all rows
   */
  mode: 'add' | 'replace';
  replaceStatementId?: string;
  /** Row indexes the user chose to leave out. */
  excludeRowIndexes?: number[];
}

export interface ImportResult {
  statementId: string;
  accountId: string;
  inserted: number;
  skippedDuplicates: number;
  linked: number;
  needsReview: number;
}

/** Stand-in id for an account that does not exist yet (fingerprints are recomputed at commit). */
export const PROVISIONAL_ACCOUNT_ID = '__new_account__';

// ─── preview ─────────────────────────────────────────────────────────────────

type Target = { accountId: string } | { newAccount: NewAccountInput } | undefined;

function understandRows(
  rows: readonly ParsedRow[],
  account: Account,
  lc: LedgerContext,
  extraAccounts: readonly Account[],
): Understanding[] {
  const ctx = buildUnderstandContext(account, lc, extraAccounts);
  return rows.map((row) =>
    understandTransaction(
      {
        rawDescription: row.description,
        amount: row.amount,
        direction: row.direction,
        date: row.date,
        reference: row.reference,
        balanceAfter: row.balanceAfter,
        bankCategory: row.bankCategory,
      },
      ctx,
    ),
  );
}

function periodOf(parsed: ParsedStatement): { start?: string; end?: string } {
  let start = parsed.periodStart;
  let end = parsed.periodEnd;
  for (const r of parsed.rows) {
    if (!start || r.date < start) start = r.date;
    if (!end || r.date > end) end = r.date;
  }
  return { start, end };
}

async function stage(
  file: ImportPreview['file'],
  parsed: ParsedStatement,
  target: Target,
  teachTemplate?: StatementTemplate | TemplateDraft,
): Promise<ImportPreview> {
  return readAll(async () => {
    const lc = await loadLedgerContext();
    let existing: Account | undefined;
    if (target && 'accountId' in target) {
      existing = lc.accounts.find((a) => a.id === target.accountId);
      if (!existing) throw new ValidationError('That account no longer exists.');
    } else if (!target) {
      existing = findMatchingAccount(lc.accounts, parsed);
    }
    const proposed: NewAccountInput =
      target && 'newAccount' in target ? target.newAccount : existing ? accountToInput(existing) : proposeAccount(parsed);

    const provisional: Account = { ...proposed, id: PROVISIONAL_ACCOUNT_ID, createdAt: nowTimestamp() };
    const account = existing ?? provisional;
    const understandings = understandRows(parsed.rows, account, lc, existing ? [] : [provisional]);
    const fingerprints = computeFingerprints(account.id, parsed.rows);

    // Duplicates against what is already stored for this account.
    const duplicateIds = new Map<string, string>();
    if (existing && fingerprints.length > 0) {
      const hits = await db.transactions
        .where('[accountId+fingerprint]')
        .anyOf(fingerprints.map((f) => [existing.id, f]))
        .toArray();
      for (const t of hits) duplicateIds.set(t.fingerprint, t.id);
    }

    const rows: PreviewRow[] = parsed.rows.map((row, index) => {
      const duplicateOf = duplicateIds.get(fingerprints[index]);
      const pr: PreviewRow = { index, row, understanding: understandings[index], fingerprint: fingerprints[index] };
      if (duplicateOf) pr.duplicateOf = duplicateOf;
      return pr;
    });

    const sameFile = await db.statements.where('fileHash').equals(file.hash).first();
    const period = periodOf(parsed);
    const overlapping = existing
      ? (await db.statements.where('accountId').equals(existing.id).toArray())
          .filter((s) => s.periodStart && s.periodEnd && period.start && period.end)
          .filter((s) => s.periodStart! <= period.end! && s.periodEnd! >= period.start!)
          .map((s) => ({ statementId: s.id, fileName: s.fileName, periodStart: s.periodStart, periodEnd: s.periodEnd }))
      : [];

    let debits = 0;
    let credits = 0;
    for (const r of parsed.rows) {
      if (r.direction === 'debit') debits += r.amount;
      else credits += r.amount;
    }
    const fresh = rows.filter((r) => !r.duplicateOf);

    const preview: ImportPreview = {
      file,
      parsed,
      overlapping,
      account: existing ? { existingAccountId: existing.id, proposed } : { proposed },
      candidateAccountIds: candidateAccounts(lc.accounts, parsed, existing?.id),
      rows,
      stats: {
        total: rows.length,
        new: fresh.length,
        duplicates: rows.length - fresh.length,
        needsReview: fresh.filter((r) => r.understanding.needsReview).length,
        debits,
        credits,
      },
    };
    if (teachTemplate) preview.teachTemplate = teachTemplate;
    if (sameFile) {
      preview.alreadyImported = {
        statementId: sameFile.id,
        accountId: sameFile.accountId,
        importedAt: sameFile.importedAt,
      };
    }
    return preview;
  });
}

export interface PrepareOptions extends Pick<ParseOptions, 'password' | 'ocr' | 'onProgress' | 'template'> {
  accountId?: string;
}

/**
 * Parse and stage. Writes nothing. Throws the parsing errors from '@/parsing'.
 * Stored templates are offered to the parser; `opts.template` forces one (the teach flow) and is
 * saved as a user template when the import is committed.
 */
export async function prepareImport(file: StatementFile, opts: PrepareOptions = {}): Promise<ImportPreview> {
  const hash = await sha256Hex(file.bytes);
  const templates = await db.templates.toArray();
  // Parsing is the step that can fail (password, scanned PDF, unknown bank). Nothing is written before it.
  const parsed = await parseStatement(file, {
    password: opts.password,
    templates,
    template: opts.template,
    ocr: opts.ocr,
    onProgress: opts.onProgress,
  });
  return stage(
    // A file named after its password is stored under a neutral name instead (see storedFileName).
    { name: storedFileName(file.name, opts.password, parsed), size: file.bytes.byteLength, hash },
    parsed,
    opts.accountId ? { accountId: opts.accountId } : undefined,
    opts.template,
  );
}

/** Analyse a file's structure for the "teach this format" screen. Writes nothing. */
export async function inspectImport(
  file: StatementFile,
  opts: Pick<ParseOptions, 'password' | 'ocr' | 'onProgress'> = {},
): Promise<StatementInspection> {
  return inspectStatement(file, opts);
}

/** Re-understand a staged preview against a different (existing or new) account. Writes nothing. */
export async function retargetPreview(
  preview: ImportPreview,
  target: { accountId: string } | { newAccount: NewAccountInput },
): Promise<ImportPreview> {
  return stage(preview.file, preview.parsed, target, preview.teachTemplate);
}

// ─── commit ──────────────────────────────────────────────────────────────────

/**
 * Template bookkeeping for a committed import (runs inside the commit transaction):
 *  - teach flow  → save the taught layout as a 'user' template (counts a use; counts a verification if balanced)
 *  - stored template used → bump its useCount (+ verifiedCount when balanced)
 *  - engine inferred a layout and the statement reconciled → save it as an 'auto' template, merged by signature
 * Returns the id of the template responsible for this statement, if any.
 */
async function recordTemplateUse(preview: ImportPreview): Promise<string | undefined> {
  const p = preview.parsed;
  const balanced = p.reconciliation.status === 'balanced';

  if (preview.teachTemplate) {
    const taught = preview.teachTemplate;
    if ('id' in taught && taught.id && (await db.templates.get(taught.id))) {
      return (await bumpTemplate(taught.id, balanced))?.id;
    }
    try {
      return (await upsertTemplate(taught, { source: 'user', use: 1, verified: balanced ? 1 : 0 })).id;
    } catch (e) {
      // A layout with nothing safe to recognise it by is skipped; the import itself still succeeds.
      if (e instanceof ValidationError) return undefined;
      throw e;
    }
  }

  let usedId: string | undefined;
  let usedKey: string | undefined;
  if (p.template?.id) {
    const used = await bumpTemplate(p.template.id, balanced);
    if (used) {
      usedId = used.id;
      usedKey = signatureKey(used);
    }
  }
  if (p.learnedTemplate && balanced) {
    const draft = scrubDraft(p.learnedTemplate);
    if (draft && signatureKey(draft) !== usedKey) {
      const saved = await upsertTemplate(draft, { source: 'auto', use: 1, verified: 1 });
      usedId ??= saved.id;
    }
  }
  return usedId;
}

function cleanStatement(s: Statement): Statement {
  const out = { ...s };
  for (const k of Object.keys(out) as (keyof Statement)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Commit atomically, then link transfers/refunds across the ledger. */
export async function commitImport(preview: ImportPreview, choices: CommitChoices): Promise<ImportResult> {
  if (choices.mode !== 'add' && choices.mode !== 'replace') throw new ValidationError('Choose how to import.');
  if (choices.mode === 'replace' && !choices.replaceStatementId) {
    throw new ValidationError('Choose which statement to replace.');
  }
  const rows = preview.parsed.rows;
  if (rows.length === 0) throw new ValidationError('This statement has no transactions to import.');
  const exclude = new Set(choices.excludeRowIndexes ?? []);

  return writeAll(async () => {
    const now = nowTimestamp();

    // 1 ── resolve the account (not written yet when new)
    // With no explicit choice, follow the preview — but if it proposed a new account that has since
    // been created (another import landed meanwhile), use that account instead of making a twin.
    let wantsExisting = choices.accountId;
    if (!wantsExisting && !choices.newAccount) {
      wantsExisting =
        preview.account.existingAccountId ??
        findMatchingAccount(await db.accounts.toArray(), preview.parsed)?.id;
    }
    let account: Account;
    let isNew = false;
    if (wantsExisting) {
      const found = await db.accounts.get(wantsExisting);
      if (!found) throw new ValidationError('That account no longer exists.');
      account = found;
    } else {
      const fields = validateNewAccount(choices.newAccount ?? preview.account.proposed);
      account = { ...fields, id: newId(), createdAt: now };
      isNew = true;
    }

    // 2 ── replace mode: remove the old statement and its rows (links to them are cleaned below)
    let removed: Transaction[] = [];
    if (choices.mode === 'replace') {
      const old = await db.statements.get(choices.replaceStatementId!);
      if (!old) throw new ValidationError('The statement to replace no longer exists.');
      if (old.accountId !== account.id) throw new ValidationError('That statement belongs to a different account.');
      removed = await db.transactions.where('statementId').equals(old.id).toArray();
      await db.transactions.where('statementId').equals(old.id).delete();
      await db.statements.delete(old.id);
    }

    // 3 ── fingerprints for the final account, and duplicates against what is stored right now
    const fingerprints = computeFingerprints(account.id, rows);
    const stored = new Map<string, string>(); // fingerprint -> statementId of the stored duplicate
    if (!isNew) {
      const hits = await db.transactions
        .where('[accountId+fingerprint]')
        .anyOf(fingerprints.map((f) => [account.id, f]))
        .toArray();
      for (const t of hits) stored.set(t.fingerprint, t.statementId);
    }

    // 4 ── understanding: reuse the preview's unless the target account changed since staging
    const previewKey = preview.account.existingAccountId ?? 'new';
    const effectiveKey = isNew ? 'new' : account.id;
    let understandings = preview.rows.map((r) => r.understanding);
    if (previewKey !== effectiveKey || understandings.length !== rows.length) {
      const lc = await loadLedgerContext();
      understandings = understandRows(rows, account, lc, isNew ? [account] : []);
    }

    // 5 ── decide which rows go in
    const seen = new Set<string>();
    const insertIdx: number[] = [];
    let skippedDuplicates = 0;
    let firstDuplicateStatement: string | undefined;
    for (let i = 0; i < rows.length; i++) {
      if (exclude.has(i)) continue;
      const fp = fingerprints[i];
      if (stored.has(fp) || seen.has(fp)) {
        skippedDuplicates++;
        firstDuplicateStatement ??= stored.get(fp);
        continue;
      }
      seen.add(fp);
      insertIdx.push(i);
    }

    if (insertIdx.length === 0 && choices.mode === 'add') {
      if (isNew) throw new ValidationError('Nothing to import: every row was left out.');
      const same = await db.statements.where('fileHash').equals(preview.file.hash).first();
      return {
        statementId: same?.id ?? firstDuplicateStatement ?? '',
        accountId: account.id,
        inserted: 0,
        skippedDuplicates,
        linked: 0,
        needsReview: 0,
      };
    }

    // 6 ── writes
    if (isNew) {
      await db.accounts.add(account);
    } else {
      const masks = new Set(accountMasks(account));
      const extra = statementMasks(preview.parsed).filter((m) => !masks.has(m));
      const patch: Partial<Account> = {};
      if (extra.length > 0) patch.extraMasks = [...(account.extraMasks ?? []), ...extra];
      if (!account.holderName && preview.parsed.holderName) patch.holderName = preview.parsed.holderName;
      if (!account.mask && extra.length > 0) {
        patch.mask = extra[0];
        patch.extraMasks = extra.slice(1);
      }
      if (Object.keys(patch).length > 0) {
        account = { ...account, ...patch };
        await db.accounts.put(account);
      }
    }

    const statementId = newId();
    const templateId = await recordTemplateUse(preview);
    let debits = 0;
    let credits = 0;
    let debitCount = 0;
    let creditCount = 0;
    const txns: Transaction[] = insertIdx.map((i) => {
      const row = rows[i];
      const u = understandings[i];
      if (row.direction === 'debit') {
        debits += row.amount;
        debitCount++;
      } else {
        credits += row.amount;
        creditCount++;
      }
      const t: Transaction = {
        id: newId(),
        accountId: account.id,
        statementId,
        date: row.date,
        amount: row.amount,
        direction: row.direction,
        rawDescription: row.description,
        channel: u.channel,
        counterparty: u.counterparty,
        merchant: u.merchant,
        merchantKey: u.merchantKey,
        kind: u.kind,
        kindSource: u.kindSource,
        category: u.category,
        categorySource: u.categorySource,
        confidence: u.confidence,
        reasons: [...u.reasons],
        needsReview: u.needsReview,
        reviewReasons: [...u.reviewReasons],
        fingerprint: fingerprints[i],
        source: row.source,
        createdAt: now,
        updatedAt: now,
      };
      if (row.valueDate) t.valueDate = row.valueDate;
      if (row.balanceAfter !== undefined) t.balanceAfter = row.balanceAfter;
      const reference = row.reference ?? u.reference;
      if (reference) t.reference = reference;
      if (row.cardMask) t.cardMask = row.cardMask;
      if (row.bankCategory) t.bankCategory = row.bankCategory;
      return t;
    });

    const warnings = [...preview.parsed.warnings];
    if (skippedDuplicates > 0) warnings.push(`${skippedDuplicates} rows were already in your ledger and were skipped.`);
    const p = preview.parsed;
    await db.statements.add(
      cleanStatement({
        id: statementId,
        accountId: account.id,
        fileName: preview.file.name,
        fileHash: preview.file.hash,
        parserId: p.parserId,
        parserVersion: p.parserVersion,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        openingBalance: p.openingBalance,
        closingBalance: p.closingBalance,
        totals: { debits, credits, debitCount, creditCount },
        reconciliation: p.reconciliation,
        warnings,
        rowCount: txns.length,
        importedAt: now,
        cardSummary: p.cardSummary,
        templateId,
      }),
    );
    // The unique [accountId+fingerprint] index makes a duplicate here abort (and roll back) everything.
    await db.transactions.bulkAdd(txns);

    // 7 ── clean up links into replaced rows, then link across the whole ledger
    await detachDeleted(removed);
    const linked = await relinkAll();

    const insertedIds = txns.map((t) => t.id);
    const final = await db.transactions.bulkGet(insertedIds);
    return {
      statementId,
      accountId: account.id,
      inserted: txns.length,
      skippedDuplicates,
      linked,
      needsReview: final.filter((t) => t?.needsReview).length,
    };
  });
}

// ─── delete & reprocess ──────────────────────────────────────────────────────

/** Atomically remove one statement and all of its transactions (and links pointing at them). */
export async function deleteStatement(statementId: string): Promise<void> {
  await writeAll(async () => {
    const statement = await db.statements.get(statementId);
    if (!statement) throw new ValidationError('That statement no longer exists.');
    const txns = await db.transactions.where('statementId').equals(statementId).toArray();
    await db.transactions.where('statementId').equals(statementId).delete();
    await db.statements.delete(statementId);
    await detachDeleted(txns);
    await relinkAll();
    await retrainLearnedModel();
  });
}

/**
 * Re-run understanding + linking for every transaction whose decision is not user-made
 * (e.g. after rules change or an app upgrade). Returns the number of transactions changed.
 */
export async function reprocessLedger(): Promise<number> {
  return writeAll(async () => {
    await retrainLearnedModel();
    return reprocessTransactions(null);
  });
}

export type { Transaction };
