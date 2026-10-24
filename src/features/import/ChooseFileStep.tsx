import { useMemo, useRef, useState, type DragEvent } from 'react';
import { FileUp, GraduationCap, Lock } from 'lucide-react';
import { ACCEPTED_FILE_TYPES, listSupportedFormats, type SupportedFormat } from '@/parsing';
import { Button, Card, CardHeader, Notice, cn } from '@/ui';
import type { ErrorView } from './describeError';
import { MAX_FILE_LABEL } from './files';

const FORMATS_COLLAPSED = 8;

function useSupportedFormats(): SupportedFormat[] {
  return useMemo(() => {
    try {
      return listSupportedFormats();
    } catch {
      return [];
    }
  }, []);
}

export function ChooseFileStep({
  error,
  problems,
  onFiles,
  onTeach,
}: {
  error: ErrorView | null;
  /** Offered when the file could not be read: the user can show VyayaMitra which column is which. */
  onTeach?: () => void;
  /** Files rejected before reading (too large, wrong type). */
  problems: string[];
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const formats = useSupportedFormats();
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? formats : formats.slice(0, FORMATS_COLLAPSED);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(files);
  }

  return (
    <div className="space-y-4">
      {error && (
        <Notice tone="negative" title={error.title}>
          <p>{error.body}</p>
          {error.hints.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {error.hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {onTeach && (
            <div className="mt-3">
              <p className="mb-2">You can show VyayaMitra which column is which. It remembers the format for next time.</p>
              <Button size="sm" variant="outline" onClick={onTeach} icon={<GraduationCap className="h-4 w-4" aria-hidden />}>
                Teach VyayaMitra this format
              </Button>
            </div>
          )}
        </Notice>
      )}
      {problems.length > 0 && (
        <Notice tone="warning" title="Some files were skipped">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Card
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('border-2 border-dashed text-center transition-colors', dragging ? 'border-primary bg-primary-soft/40' : 'border-border-strong')}
      >
        <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-4">
          <span className="rounded-2xl bg-primary-soft p-3 text-primary">
            <FileUp className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="text-base font-semibold text-fg">Choose a bank or card statement</h2>
          <p className="text-sm text-fg-muted">Drop PDF, CSV, Excel (XLS, XLSX, ODS) or OFX/QFX files here, or pick them from your device. Up to {MAX_FILE_LABEL} each.</p>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={ACCEPTED_FILE_TYPES}
            aria-label="Choose statement files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ''; // allow picking the same file again after a cancel
              if (files.length) onFiles(files);
            }}
          />
          <Button size="lg" onClick={() => input.current?.click()} icon={<FileUp className="h-5 w-5" aria-hidden />}>
            Choose files
          </Button>
        </div>
      </Card>

      <p className="flex items-center justify-center gap-2 text-sm font-medium text-fg">
        <Lock className="h-4 w-4 text-positive" aria-hidden />
        Read on this device only. Nothing is uploaded.
      </p>

      {formats.length > 0 && (
        <Card>
          <CardHeader title="Supported statements" subtitle="Other banks usually work too: VyayaMitra works out the columns itself, and you can teach it any format. You review everything before it is saved." />
          <ul className="divide-y divide-border text-sm">
            {listed.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-fg">{f.label}</span>
                  {f.notes && <span className="block text-xs text-fg-muted">{f.notes}</span>}
                </span>
                <span className="shrink-0 text-xs uppercase text-fg-subtle">{f.fileTypes.join(' · ')}</span>
              </li>
            ))}
          </ul>
          {formats.length > FORMATS_COLLAPSED && (
            <Button variant="ghost" size="sm" className="mt-2" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${formats.length} formats`}
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
