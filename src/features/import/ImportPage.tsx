import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageChrome } from '@/app/chrome';
import { usePeriod } from '@/app/period';
import { monthEnd, monthStart } from '@/lib/dates';
import { landingMonth } from './landing';
import { useAccounts, useLedger } from '@/db/hooks';
import { saveTemplate, useTemplates } from '@/db/learning';
import type { TemplateDraft } from '@/domain/types';
import {
  commitImport,
  prepareImport,
  retargetPreview,
  type CommitChoices,
  type ImportPreview,
  type ImportResult,
  type PrepareOptions,
} from '@/engine/import';
import type { ParseProgress, StatementFile } from '@/parsing';
import { Button, Card, Spinner, cn } from '@/ui';
import { AccountStep, type AccountTarget } from './AccountStep';
import { BatchList, BatchSummary } from './BatchPanels';
import { ChooseFileStep } from './ChooseFileStep';
import { OcrOffer, OcrProgress } from './OcrSteps';
import { PasswordStep } from './PasswordStep';
import { ResultStep } from './ResultStep';
import { ReviewStep } from './ReviewStep';
import { TeachStep } from './TeachStep';
import { describeImportError, isIncorrectPassword, isPasswordRequired, isScannedPdf, isUnsupported, type ErrorView } from './describeError';
import { toStatementFile, validateFile } from './files';
import { EMPTY_TOTALS, addToTotals, progressText, reconText, type BatchItem, type BatchTotals, type QueueItem } from './batch';
import type { Via } from './importTypes';
import type { TeachCache } from './teachForm';

/**
 * The wizard. Every step before "Import" only stages data in memory, so cancelling or failing at any
 * point writes nothing. `commitImport` is reachable from exactly one place: the confirm button of the review step.
 *
 * The file (and, for protected PDFs, its password) is kept in memory only while a later step may need it:
 * OCR, or "teach this format". Both are dropped on cancel, on reset and when the import finishes.
 */
type ReviewPhase = { name: 'review'; preview: ImportPreview; target: AccountTarget; committing: boolean; via: Via };
type Phase =
  | { name: 'choose' }
  | { name: 'reading'; fileName: string }
  | { name: 'password'; file: StatementFile; wrong: boolean; busy: boolean }
  | { name: 'ocr_offer'; file: StatementFile }
  | { name: 'ocr'; file: StatementFile; progress: ParseProgress | null }
  | { name: 'teach' }
  | { name: 'account'; preview: ImportPreview; via: Via }
  | ReviewPhase
  | { name: 'done'; result: ImportResult; fileName: string; format: { kind: 'taught' | 'auto'; name?: string } | null };

const STEPS = ['Choose file', 'Account', 'Review', 'Done'] as const;

function stepIndex(p: Phase): number {
  switch (p.name) {
    case 'choose':
    case 'reading':
    case 'password':
    case 'ocr_offer':
    case 'ocr':
    case 'teach':
      return 0;
    case 'account':
      return 1;
    case 'review':
      return 2;
    case 'done':
      return 3;
  }
}

interface PrepareMode {
  ocr?: boolean;
  template?: { draft: TemplateDraft; name: string };
  accountId?: string;
}

export default function ImportPage() {
  usePageChrome({ title: 'Import statements' });
  const { setCustom } = usePeriod();
  const accounts = useAccounts() ?? [];
  const ledger = useLedger();
  const templates = useTemplates() ?? [];
  const [phase, setPhase] = useState<Phase>({ name: 'choose' });
  const [error, setError] = useState<ErrorView | null>(null);
  const [canTeach, setCanTeach] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [queue, setQueueState] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const setQueue = useCallback((q: QueueItem[]) => {
    queueRef.current = q;
    setQueueState(q);
  }, []);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [totals, setTotals] = useState<BatchTotals>(EMPTY_TOTALS);
  const currentKey = useRef(0);
  const advanceRef = useRef<() => void>(() => {});
  const mark = useCallback(
    (key: number, patch: Partial<BatchItem>) => setBatch((b) => b.map((i) => (i.key === key ? { ...i, ...patch } : i))),
    [],
  );
  const [teachCache, setTeachCache] = useState<TeachCache | null>(null);
  /** Incremented on every start/cancel so a slow parse that finishes late cannot resurrect a cancelled import. */
  const run = useRef(0);
  /** In memory only, and only while OCR or "teach this format" may still need them. */
  const fileRef = useRef<StatementFile | null>(null);
  const passwordRef = useRef<string | undefined>(undefined);
  /** The review screen to return to when the user cancels "teach this format" opened from it. */
  const returnTo = useRef<ReviewPhase | null>(null);

  const forgetFile = useCallback(() => {
    fileRef.current = null;
    passwordRef.current = undefined;
    returnTo.current = null;
  }, []);

  const reset = useCallback(() => {
    run.current += 1;
    forgetFile();
    setPhase({ name: 'choose' });
    setError(null);
    setCanTeach(false);
    setProblems([]);
    setCommitError(null);
    setQueue([]);
    setBatch([]);
    setTotals(EMPTY_TOTALS);
    setTeachCache(null);
  }, [forgetFile, setQueue]);

  /** Parse and stage. Throws the parsing errors; writes nothing. */
  const prepare = useCallback(async (file: StatementFile, password: string | undefined, id: number, mode: PrepareMode = {}) => {
    const opts: PrepareOptions = {};
    if (password !== undefined) opts.password = password;
    if (mode.ocr) opts.ocr = true;
    opts.onProgress = (progress) => {
      if (id !== run.current) return;
      mark(currentKey.current, { text: progressText(progress) });
      if (mode.ocr) setPhase((cur) => (cur.name === 'ocr' ? { ...cur, progress } : cur));
    };
    if (mode.template) opts.template = mode.template.draft;
    if (mode.accountId) opts.accountId = mode.accountId;
    return prepareImport(file, opts);
  }, [mark]);

  const attempt = useCallback(
    async (file: StatementFile, password: string | undefined, id: number, mode: PrepareMode = {}) => {
      fileRef.current = file;
      passwordRef.current = password;
      try {
        const preview = await prepare(file, password, id, mode);
        if (id !== run.current) return;
        mark(currentKey.current, { status: 'ready', text: reconText(preview) });
        setPhase({ name: 'account', preview, via: { ocr: Boolean(mode.ocr), taught: null } });
      } catch (e) {
        if (id !== run.current) return;
        if (isPasswordRequired(e) || isIncorrectPassword(e)) {
          passwordRef.current = undefined;
          mark(currentKey.current, { status: 'password', text: isIncorrectPassword(e) ? 'That password did not open it' : 'Enter the password to open it' });
          setPhase({ name: 'password', file, wrong: isIncorrectPassword(e), busy: false });
          return;
        }
        if (isScannedPdf(e) && !mode.ocr) {
          mark(currentKey.current, { status: 'scanned', text: 'No text in this PDF. OCR can read it on this device.' });
          setPhase({ name: 'ocr_offer', file });
          return;
        }
        // An unreadable layout can be taught; keep the file in memory for that. Anything else drops it.
        const view = describeImportError(e);
        mark(currentKey.current, { status: 'failed', text: view.title });
        if (queueRef.current.length > 0) {
          // More files are waiting: record this one as failed and carry on with the next.
          forgetFile();
          advanceRef.current();
          return;
        }
        const teachable = isUnsupported(e);
        if (!teachable) forgetFile();
        setCanTeach(teachable);
        setError(view);
        setPhase({ name: 'choose' });
      }
    },
    [prepare, forgetFile, mark],
  );

  const startFile = useCallback(
    async ({ file, key }: QueueItem) => {
      const id = ++run.current;
      currentKey.current = key;
      mark(key, { status: 'reading', text: 'Opening the file' });
      forgetFile();
      setError(null);
      setCanTeach(false);
      setCommitError(null);
      setTeachCache(null);
      setPhase({ name: 'reading', fileName: file.name });
      let statementFile: StatementFile;
      try {
        statementFile = await toStatementFile(file);
      } catch (e) {
        if (id !== run.current) return;
        const view = describeImportError(e);
        mark(key, { status: 'failed', text: view.title });
        if (queueRef.current.length > 0) {
          advanceRef.current();
          return;
        }
        setError(view);
        setPhase({ name: 'choose' });
        return;
      }
      if (id !== run.current) return;
      await attempt(statementFile, undefined, id);
    },
    [attempt, forgetFile, mark],
  );

  const onFiles = useCallback(
    (files: File[]) => {
      const good: File[] = [];
      const bad: string[] = [];
      for (const f of files) {
        const reason = validateFile(f);
        if (reason) bad.push(reason);
        else good.push(f);
      }
      if (good.length === 0) {
        setProblems([]);
        setCanTeach(false);
        setError(
          bad.length > 1
            ? { title: 'None of these files can be imported', body: 'Choose statements under 25 MB: PDF, CSV, Excel, OFX/QFX or TXT.', hints: bad }
            : { title: 'This file cannot be imported', body: bad[0] ?? 'Choose a statement file.', hints: [] },
        );
        return;
      }
      setError(null);
      setProblems(bad);
      const items = good.map((file, i) => ({ file, key: Date.now() + i }));
      setBatch(items.map((q) => ({ key: q.key, name: q.file.name, status: 'queued' as const })));
      setTotals(EMPTY_TOTALS);
      setQueue(items.slice(1));
      void startFile(items[0]);
    },
    [startFile, setQueue],
  );

  /** Move on to the next waiting file, or back to the file picker when none is left. */
  const advance = useCallback(() => {
    const [next, ...rest] = queueRef.current;
    setQueue(rest);
    setError(null);
    setProblems([]);
    if (next) void startFile(next);
    else setPhase({ name: 'choose' });
  }, [startFile, setQueue]);
  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  /** Leave this file out of the batch without cancelling the others. */
  const skipFile = useCallback(
    (key: number) => {
      if (key !== currentKey.current) return;
      run.current += 1;
      forgetFile();
      setTeachCache(null);
      mark(key, { status: 'skipped', text: 'Skipped by you. Nothing was saved.' });
      advance();
    },
    [forgetFile, mark, advance],
  );

  const submitPassword = useCallback(
    (password: string) => {
      if (phase.name !== 'password') return;
      const id = ++run.current;
      const { file } = phase;
      setPhase({ ...phase, busy: true });
      mark(currentKey.current, { status: 'reading', text: 'Opening with your password' });
      void attempt(file, password, id);
    },
    [phase, attempt, mark],
  );

  const startOcr = useCallback(() => {
    if (phase.name !== 'ocr_offer') return;
    const id = ++run.current;
    const { file } = phase;
    setPhase({ name: 'ocr', file, progress: null });
    mark(currentKey.current, { status: 'reading', text: 'Reading page images' });
    void attempt(file, passwordRef.current, id, { ocr: true });
  }, [phase, attempt, mark]);

  // ── teach this format ──────────────────────────────────────────────────────

  const startTeach = useCallback(() => {
    if (!fileRef.current) return;
    returnTo.current = phase.name === 'review' && !phase.committing ? phase : null;
    setPhase({ name: 'teach' });
  }, [phase]);

  const cancelTeach = useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    if (back) setPhase(back);
    else setPhase({ name: 'choose' });
  }, []);

  const tryTemplate = useCallback(
    async (draft: TemplateDraft, name: string) => {
      const file = fileRef.current;
      if (!file) throw new Error('The file is no longer available. Choose it again.');
      const back = returnTo.current;
      const accountId = back && 'accountId' in back.target ? back.target.accountId : undefined;
      const id = ++run.current;
      // A parse failure propagates to the teach screen, which shows it and lets the user adjust.
      const preview = await prepare(file, passwordRef.current, id, { template: { draft, name }, accountId });
      if (id !== run.current) return;
      const via: Via = { ocr: false, taught: { draft, name } };
      setError(null);
      setCanTeach(false);
      returnTo.current = null;
      if (back && accountId) setPhase({ name: 'review', preview, target: back.target, committing: false, via });
      else setPhase({ name: 'account', preview, via });
    },
    [prepare],
  );

  // ── account / review / commit ──────────────────────────────────────────────

  const retarget = useCallback(
    async (target: AccountTarget) => {
      if (phase.name !== 'account') return;
      const next = await retargetPreview(phase.preview, target);
      setPhase({ name: 'account', preview: next, via: phase.via });
    },
    [phase],
  );

  const toReview = useCallback(
    async (target: AccountTarget, needsRetarget: boolean) => {
      if (phase.name !== 'account') return;
      const preview = needsRetarget ? await retargetPreview(phase.preview, target) : phase.preview;
      setCommitError(null);
      setPhase({ name: 'review', preview, target, committing: false, via: phase.via });
    },
    [phase],
  );

  const confirm = useCallback(
    async (choices: CommitChoices) => {
      if (phase.name !== 'review' || phase.committing) return;
      const { preview, target, via } = phase;
      setCommitError(null);
      setPhase({ name: 'review', preview, target, committing: true, via });
      try {
        const result = await commitImport(preview, choices);
        mark(currentKey.current, { status: 'imported', text: `${result.inserted} added${result.skippedDuplicates ? `, ${result.skippedDuplicates} duplicates skipped` : ''}` });
        setTotals((t) => addToTotals(t, preview, choices, result));
        // Show the imported statement's month everywhere, so "Review N transactions" finds the new rows.
        const month = landingMonth(preview);
        if (month) setCustom(monthStart(month), monthEnd(month));

        // The import is already safe. Remembering the taught format is a bonus and must never undo it.
        const status = preview.parsed.reconciliation.status;
        let format: { kind: 'taught' | 'auto'; name?: string } | null = null;
        if (via.taught && status !== 'mismatch') {
          try {
            await saveTemplate(via.taught.draft, { source: 'user', name: via.taught.name });
            format = { kind: 'taught', name: via.taught.name };
          } catch {
            format = null;
          }
        } else if (!via.taught && status === 'balanced' && preview.parsed.learnedTemplate) {
          format = { kind: 'auto' };
        }
        forgetFile();
        setTeachCache(null);
        setPhase({ name: 'done', result, fileName: preview.file.name, format });
      } catch (e) {
        setCommitError(e instanceof Error && e.message ? e.message : 'The import failed.');
        setPhase({ name: 'review', preview, target, committing: false, via });
      }
    },
    [phase, setCustom, forgetFile, mark],
  );

  const importAnother = advance;

  const current = stepIndex(phase);
  const batchFinished =
    batch.length > 1 &&
    queue.length === 0 &&
    (phase.name === 'done' || phase.name === 'choose') &&
    batch.every((i) => i.status === 'imported' || i.status === 'failed' || i.status === 'skipped');
  const teachFile = fileRef.current;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4">
      <p className="text-sm text-fg-muted">Nothing is saved until you confirm on the review step.</p>

      <ol className="flex items-center gap-2 text-xs" aria-label="Import progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex min-h-8 flex-1 items-center justify-center rounded-lg px-1 text-center font-medium',
              i === current ? 'bg-primary text-primary-fg' : i < current ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-fg-subtle',
            )}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {batch.length > 1 && <BatchList items={batch} onSkip={phase.name === 'review' && phase.committing ? undefined : skipFile} />}

      {phase.name === 'choose' && (
        <ChooseFileStep error={error} problems={problems} onFiles={onFiles} onTeach={canTeach && teachFile ? startTeach : undefined} />
      )}

      {phase.name === 'reading' && (
        <Card className="space-y-3">
          <Spinner label={`Reading ${phase.fileName} on this device…`} />
          <Button variant="ghost" onClick={reset}>
            Cancel
          </Button>
        </Card>
      )}

      {phase.name === 'password' && (
        <PasswordStep fileName={phase.file.name} wrong={phase.wrong} busy={phase.busy} onSubmit={submitPassword} onCancel={reset} />
      )}

      {phase.name === 'ocr_offer' && <OcrOffer fileName={phase.file.name} onConfirm={startOcr} onCancel={reset} />}

      {phase.name === 'ocr' && <OcrProgress fileName={phase.file.name} progress={phase.progress} onCancel={reset} />}

      {phase.name === 'teach' && teachFile && (
        <TeachStep
          file={teachFile}
          password={passwordRef.current}
          cache={teachCache}
          onCache={setTeachCache}
          onTry={tryTemplate}
          onCancel={cancelTeach}
        />
      )}

      {phase.name === 'account' && (
        <AccountStep preview={phase.preview} accounts={accounts} onRetarget={retarget} onContinue={toReview} onCancel={reset} />
      )}

      {phase.name === 'review' && (
        <ReviewStep
          preview={phase.preview}
          accounts={accounts}
          target={phase.target}
          committing={phase.committing}
          commitError={commitError}
          via={phase.via}
          existing={ledger.transactions}
          statements={ledger.statements}
          templateName={templates.find((t) => t.id !== undefined && t.id === phase.preview.parsed.template?.id)?.name}
          onTeach={teachFile ? startTeach : undefined}
          onConfirm={(choices) => void confirm(choices)}
          onBack={() => setPhase({ name: 'account', preview: phase.preview, via: phase.via })}
          onCancel={reset}
        />
      )}

      {phase.name === 'done' && (
        <ResultStep result={phase.result} fileName={phase.fileName} waiting={queue.length} format={phase.format} onAnother={importAnother} />
      )}

      {batchFinished && <BatchSummary items={batch} totals={totals} />}
    </div>
  );
}
