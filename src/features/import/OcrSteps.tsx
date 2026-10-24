import { ScanText } from 'lucide-react';
import type { ParseProgress } from '@/parsing';
import { Button, Card, ProgressBar, Spinner } from '@/ui';

/** Asks before running OCR: it is slow and downloads its language data once. */
export function OcrOffer({ fileName, onConfirm, onCancel }: { fileName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl bg-info-soft p-2.5 text-info">
          <ScanText className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">This looks like a scanned statement</h2>
          <p className="truncate text-sm text-fg-muted">{fileName}</p>
        </div>
      </div>
      <p className="text-sm text-fg">Read it with on-device OCR?</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">
        <li>OCR runs on this device. The statement is never uploaded.</li>
        <li>It takes about 10 to 40 seconds per page. Keep this tab open.</li>
        <li>The OCR data (about 15 MB) loads once, then is kept for next time.</li>
        <li>Text read from a picture can have mistakes, so these rows get extra review before and after import.</li>
        <li>If you can, downloading the e-statement PDF from your bank is faster and more exact.</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} icon={<ScanText className="h-4 w-4" aria-hidden />}>
          Read with OCR
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

const STAGE_LABELS: Record<ParseProgress['stage'], string> = {
  reading: 'Opening the file',
  ocr: 'Reading text from page images',
  parsing: 'Finding the transactions',
};

export function OcrProgress({ fileName, progress, onCancel }: { fileName: string; progress: ParseProgress | null; onCancel: () => void }) {
  const known = progress && progress.total > 0;
  const label = progress ? (progress.stage === 'ocr' && known ? `Page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : STAGE_LABELS[progress.stage]) : 'Starting OCR';
  return (
    <Card className="space-y-3" aria-live="polite">
      <h2 className="text-base font-semibold text-fg">Reading {fileName} with OCR</h2>
      {known ? <ProgressBar value={progress.done / progress.total} label="OCR progress" /> : <Spinner label="Working…" />}
      <p className="text-sm text-fg-muted">
        {label}
        {progress?.message ? `: ${progress.message}` : ''}
      </p>
      <p className="text-xs text-fg-subtle">Nothing is saved until you review and confirm. Cancelling throws the result away.</p>
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </Card>
  );
}
