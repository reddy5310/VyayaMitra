import type { ParsedStatement } from '@/domain/types';
import type { Detection, ParseContext, PdfParser } from '../core/types';
import type { LayoutDoc } from '../pdf/types';
import { parseUniversal, UNIVERSAL_ID, UNIVERSAL_VERSION } from '../universal/engine';

export { UNIVERSAL_ID };

const cache = new WeakMap<LayoutDoc, { st: ParsedStatement | null; error?: string }>();

function run(doc: LayoutDoc, ctx: ParseContext): { st: ParsedStatement | null; error?: string } {
  let r = cache.get(doc);
  if (!r) {
    try {
      r = { st: parseUniversal(doc, { fileName: ctx.fileName, fileKind: 'pdf' }) };
    } catch (e) {
      r = { st: null, error: e instanceof Error ? e.message : 'failed' };
    }
    cache.set(doc, r);
  }
  return r;
}

function detect(doc: LayoutDoc): Detection {
  const { st, error } = run(doc, { fileName: '' });
  if (!st) return { confidence: 0, reasons: [error ?? 'No transaction table found'] };
  const status = st.reconciliation.status;
  const c = status === 'balanced' ? 0.7 : status === 'unverified' ? 0.62 : 0.52;
  return { confidence: c, reasons: st.detection.reasons };
}

function parse(doc: LayoutDoc, ctx: ParseContext): ParsedStatement {
  const { st, error } = run(doc, ctx);
  if (!st) throw new Error(error ?? 'No transaction table found');
  return { ...st, parserVersion: UNIVERSAL_VERSION };
}

/** Reads any bank or card statement PDF by understanding its table, not by bank-specific rules. */
export const universalParser: PdfParser = {
  kind: 'pdf',
  id: UNIVERSAL_ID,
  version: UNIVERSAL_VERSION,
  label: 'Universal: any bank or credit-card statement',
  institution: 'OTHER',
  accountType: 'any',
  fileTypes: ['pdf'],
  notes:
    'Finds the transaction table, assigns columns by position (English and Hindi headers, or none), and proves the result with the running balance or the card summary.',
  detect,
  parse,
};
