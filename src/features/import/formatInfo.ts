import type { ImportPreview } from '@/engine/import';

const LOW_CONFIDENCE = 0.6;

export function templateLabel(template: ImportPreview['parsed']['template'], name?: string): string | null {
  if (!template) return null;
  const suffix = name ? `: ${name}` : '';
  switch (template.source) {
    case 'builtin':
      return 'Read with the built-in reader for this bank.';
    case 'inferred':
      return 'No saved format matched, so VyayaMitra worked out the columns itself.';
    case 'auto':
      return `Used a format VyayaMitra learned automatically${suffix}.`;
    case 'user':
      return `Used a format you taught${suffix}.`;
    case 'imported':
      return `Used an imported format${suffix}.`;
  }
}

/** Whether the review step should proactively offer to teach the format. */
export function shouldOfferTeach(preview: ImportPreview): boolean {
  return preview.parsed.reconciliation.status === 'mismatch' || preview.parsed.detection.confidence < LOW_CONFIDENCE;
}
