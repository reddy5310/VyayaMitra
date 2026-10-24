import { GraduationCap, ScanText, Sparkles } from 'lucide-react';
import type { ImportPreview } from '@/engine/import';
import { Button, Notice } from '@/ui';
import { shouldOfferTeach, templateLabel } from './formatInfo';
import type { Via } from './importTypes';

/**
 * Everything the review step says about HOW the statement was read: OCR, which template, whether a format
 * was learned, and the offer to teach VyayaMitra when the reading looks doubtful.
 */
export function FormatNotices({
  preview,
  via,
  templateName,
  disabled,
  onTeach,
}: {
  preview: ImportPreview;
  via: Via;
  templateName?: string;
  disabled: boolean;
  onTeach?: () => void;
}) {
  const { parsed } = preview;
  const status = parsed.reconciliation.status;
  const label = templateLabel(parsed.template, templateName);
  const doubtful = shouldOfferTeach(preview);
  const learnedAuto = !via.taught && status === 'balanced' && Boolean(parsed.learnedTemplate);

  return (
    <div className="space-y-3">
      {via.ocr && (
        <Notice tone="warning" title="Read with OCR">
          <span className="flex items-start gap-2">
            <ScanText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>This text was read from page images, so a digit or date can be wrong. Check amounts and dates against your statement; these rows need extra review.</span>
          </span>
        </Notice>
      )}

      {via.taught && status === 'balanced' && (
        <Notice tone="positive" title="VyayaMitra learned this format">
          <span className="flex items-start gap-2">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Your column choices reproduce the statement&apos;s balances. “{via.taught.name}” is saved when you import, so next time it is instant.</span>
          </span>
        </Notice>
      )}
      {via.taught && status === 'unverified' && (
        <Notice tone="info" title="Format tried, but it cannot be checked">
          This statement prints no balances to check against. Look through the rows below; “{via.taught.name}” is saved when you import.
        </Notice>
      )}
      {via.taught && status === 'mismatch' && (
        <Notice
          tone="warning"
          title="That still does not match the statement"
          action={
            onTeach && (
              <Button size="sm" variant="outline" disabled={disabled} onClick={onTeach}>
                Adjust columns
              </Button>
            )
          }
        >
          The rows do not add up to the printed balances. Check the column choices, the date order and the amount style.
        </Notice>
      )}

      {learnedAuto && (
        <Notice tone="positive" title="Learned this format">
          <span className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Learned this format — next time it&apos;s instant.</span>
          </span>
        </Notice>
      )}

      {!via.taught && doubtful && onTeach && (
        <Notice
          tone="warning"
          title="We are not sure this was read correctly"
          action={
            <Button size="sm" variant="outline" disabled={disabled} onClick={onTeach} icon={<GraduationCap className="h-4 w-4" aria-hidden />}>
              Teach VyayaMitra this format
            </Button>
          }
        >
          {status === 'mismatch'
            ? 'The rows do not add up to the statement’s balances.'
            : 'The layout was only partly recognised.'}{' '}
          Show it which column is which and it will try again.
        </Notice>
      )}

      {(label || (onTeach && !doubtful && !via.taught)) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          {label && <span>{label}</span>}
          {onTeach && !doubtful && !via.taught && (
            <button type="button" disabled={disabled} onClick={onTeach} className="min-h-9 font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50">
              Columns look wrong? Teach VyayaMitra
            </button>
          )}
        </p>
      )}
    </div>
  );
}
