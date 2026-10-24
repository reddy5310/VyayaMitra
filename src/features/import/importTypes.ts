import type { TemplateDraft } from '@/domain/types';

/** How the staged rows were obtained, so the review step can be honest about it. */
export interface Via {
  /** Text was read from page images by on-device OCR. */
  ocr: boolean;
  /** The user taught the format for this import. Saved as a user template after a successful commit. */
  taught: { draft: TemplateDraft; name: string } | null;
}

