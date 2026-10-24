/**
 * CONTRACT — owned by the ledger module (wave 2).
 * Persistence for self-training: statement templates and feedback events.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import type { FeedbackEvent, StatementTemplate, TemplateDraft, TemplateSource } from '@/domain/types';
import type { Calibration, LearnedModel } from '@/engine/understand';
import { META_CALIBRATION, META_LEARNED_MODEL, db, writeAll } from './db';
import {
  exportTemplateFile,
  importTemplateFile,
  upsertTemplate,
} from './templates';
import { ACCOUNT_TYPES, ValidationError, requireInstitution, requireName, requireOneOf } from './validation';

export { scrubDraft, signatureKey, TEMPLATE_FILE_FORMAT } from './templates';

export function useTemplates(): StatementTemplate[] | undefined {
  return useLiveQuery(async () => (await db.templates.toArray()).sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name)), []);
}

/** The on-device model and calibration, for UI that calls understand helpers directly (suggestions). */
export function useLearnedState(): { learned: LearnedModel | null; calibration: Calibration | null } | undefined {
  return useLiveQuery(async () => {
    const [model, calibration] = await db.meta.bulkGet([META_LEARNED_MODEL, META_CALIBRATION]);
    return {
      learned: (model?.value as LearnedModel | undefined) ?? null,
      calibration: (calibration?.value as Calibration | undefined) ?? null,
    };
  }, []);
}

/** Oldest first, so a trend can be drawn directly. */
export function useFeedback(): FeedbackEvent[] | undefined {
  return useLiveQuery(() => db.feedback.orderBy('at').toArray(), []);
}

/**
 * Insert, or merge into an existing template with the same signature (keeps counts).
 * An 'auto' save means "a verified import just used this format", so it counts one use and one verification;
 * user/imported saves add no counts (the import commit adds them itself after a real parse).
 */
export async function saveTemplate(
  draft: TemplateDraft,
  opts: { source: TemplateSource; name?: string },
): Promise<StatementTemplate> {
  return writeAll(() => upsertTemplate(draft, { ...opts, use: opts.source === 'auto' ? 1 : 0, verified: opts.source === 'auto' ? 1 : 0 }));
}

export async function updateTemplate(
  id: string,
  patch: Partial<Pick<StatementTemplate, 'name' | 'institution' | 'accountType'>>,
): Promise<void> {
  await writeAll(async () => {
    const t = await db.templates.get(id);
    if (!t) throw new ValidationError('That format no longer exists.');
    const next: StatementTemplate = { ...t, updatedAt: new Date().toISOString() };
    if (patch.name !== undefined) next.name = requireName(patch.name, 'Format name');
    if (patch.institution !== undefined) next.institution = requireInstitution(patch.institution);
    if (patch.accountType !== undefined) next.accountType = requireOneOf(patch.accountType, ACCOUNT_TYPES, 'Account type');
    await db.templates.put(next);
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}

/** JSON file of templates (scrubbed, no personal data) that can be shared or kept. */
export async function exportTemplates(ids?: string[]): Promise<Blob> {
  return exportTemplateFile(ids);
}

/** Validates + scrubs; returns how many were added/merged (and how many were rejected as unsafe or malformed). */
export async function importTemplates(file: Blob): Promise<{ added: number; merged: number; rejected: number }> {
  return importTemplateFile(file);
}

/**
 * Forget learned behaviour.
 *  'model'     — clears feedback events, calibration and the learned model (rules you made stay).
 *  'templates' — removes automatically learned templates (taught and imported ones stay).
 *  'all'       — both.
 * Existing transactions keep their current categories until the next reprocess.
 */
export async function resetLearning(what: 'model' | 'templates' | 'all'): Promise<void> {
  requireOneOf(what, ['model', 'templates', 'all'] as const, 'Reset target');
  await writeAll(async () => {
    if (what === 'model' || what === 'all') {
      await db.feedback.clear();
      await db.meta.bulkDelete([META_LEARNED_MODEL, META_CALIBRATION]);
    }
    if (what === 'templates' || what === 'all') {
      await db.templates.where('source').equals('auto').delete();
    }
  });
}
