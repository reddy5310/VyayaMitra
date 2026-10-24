import { categoryName } from '@/domain/categories';
import { metricBucket } from '@/domain/kinds';
import type { Paise } from '@/domain/types';
import type { CommitChoices, ImportPreview } from '@/engine/import';
import type { ParseProgress } from '@/parsing';

export type BatchStatus = 'queued' | 'reading' | 'password' | 'scanned' | 'ready' | 'imported' | 'failed' | 'skipped';

export interface BatchItem {
  key: number;
  name: string;
  status: BatchStatus;
  /** What is actually happening, in words. Never a made-up percentage. */
  text?: string;
}

export interface QueueItem {
  file: File;
  key: number;
}

export interface BatchTotals {
  inserted: number;
  duplicates: number;
  needsReview: number;
  /** Money out by category across everything imported in this batch. */
  spendByCategory: Record<string, Paise>;
}
export const EMPTY_TOTALS: BatchTotals = { inserted: 0, duplicates: 0, needsReview: 0, spendByCategory: {} };

export const STATUS_LABELS: Record<BatchStatus, string> = {
  queued: 'Waiting',
  reading: 'Working',
  password: 'Needs password',
  scanned: 'Scanned: needs OCR',
  ready: 'Ready to review',
  imported: 'Imported',
  failed: 'Could not read',
  skipped: 'Skipped',
};

/** Words for the stage the reader reported; counts are real page counts when it gives them. */
export function progressText(p: ParseProgress): string {
  const base = p.stage === 'reading' ? 'Reading pages' : p.stage === 'ocr' ? 'Reading page images' : 'Identifying transactions';
  return p.total > 0 && p.stage !== 'parsing' ? `${base} (${Math.min(p.done + 1, p.total)} of ${p.total})` : base;
}

/** The outcome of checking the statement against its own printed totals. */
export function reconText(preview: Pick<ImportPreview, 'parsed'>): string {
  const status = preview.parsed.reconciliation.status;
  return status === 'balanced' ? 'Totals match' : status === 'mismatch' ? 'Totals do not match' : 'Totals could not be checked';
}

export function addToTotals(
  prev: BatchTotals,
  preview: ImportPreview,
  choices: CommitChoices,
  result: { inserted: number; skippedDuplicates: number; needsReview: number },
): BatchTotals {
  const excluded = new Set(choices.excludeRowIndexes ?? []);
  const spend = { ...prev.spendByCategory };
  for (const r of preview.rows) {
    if (excluded.has(r.index) || (r.duplicateOf !== undefined && choices.mode === 'add')) continue;
    const { kind, category } = r.understanding;
    if (r.row.direction === 'debit' && metricBucket(kind, 'debit') === 'spending') spend[category] = (spend[category] ?? 0) + r.row.amount;
  }
  return {
    inserted: prev.inserted + result.inserted,
    duplicates: prev.duplicates + result.skippedDuplicates,
    needsReview: prev.needsReview + result.needsReview,
    spendByCategory: spend,
  };
}

/** One sentence, never more: where most of the money in this batch went. */
export function takeaway(totals: BatchTotals): { category?: string; text: string } {
  const entries = Object.entries(totals.spendByCategory).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((n, [, v]) => n + v, 0);
  if (entries.length === 0 || sum <= 0) {
    return { text: `${totals.inserted} transaction${totals.inserted === 1 ? '' : 's'} added. There was no spending in these files.` };
  }
  const [category, amount] = entries[0];
  const pct = Math.round((amount / sum) * 100);
  return { category, text: `Most of the spending in these files went to ${categoryName(category)}: ${pct}% of everything spent.` };
}
