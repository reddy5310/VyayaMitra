/**
 * Parse spreadsheet / CSV / OFX tables. The CSV reader and the universal engine both try; the one
 * whose result reconciles better wins (CSV on a tie, as it is the long-verified path).
 */
import type { ParsedStatement, StatementTemplate, TemplateDraft } from '@/domain/types';
import type { SheetTable } from './adapters';
import type { ParseContext } from './core/types';
import { UnsupportedStatementError } from './errors';
import { parseCsvTable } from './registry';
import { parseUniversal } from './universal/engine';
import { sheetToLayout } from './universal/sheet';

export interface TableOptions {
  templates?: readonly StatementTemplate[];
  template?: StatementTemplate | TemplateDraft;
}

function rank(st: ParsedStatement): number {
  const r = st.reconciliation;
  const failed = r.checks.filter((c) => !c.ok && !c.label.startsWith('Running balance')).length;
  return (r.status === 'balanced' ? 200 : 0) + st.rows.length - 8 * r.rowBalanceBreaks - 40 * failed - st.rows.filter((x) => x.warnings.includes('ambiguous_amount')).length * 3;
}

function parseOne(table: SheetTable, ctx: ParseContext, opts: TableOptions): ParsedStatement | null {
  const layout = sheetToLayout(table.records);
  const uni = (extra: Partial<Parameters<typeof parseUniversal>[1]> = {}): ParsedStatement | null => {
    try {
      return parseUniversal(layout, { fileName: ctx.fileName, fileKind: 'sheet', ...extra });
    } catch {
      return null;
    }
  };
  if (opts.template) return uni({ template: opts.template });
  let csv: ParsedStatement | null = null;
  try {
    csv = parseCsvTable({ records: table.records }, ctx);
    csv = { ...csv, template: { source: 'builtin' } };
  } catch {
    csv = null;
  }
  const u = uni({ templates: opts.templates });
  if (u && u.template?.id && u.reconciliation.status !== 'mismatch') return u;
  if (!csv) return u;
  if (!u) return csv;
  const winner = rank(u) > rank(csv) ? u : csv;
  // either way the universal reading's layout can be learned from
  return winner.learnedTemplate || !u.learnedTemplate || u.reconciliation.status === 'mismatch'
    ? winner
    : { ...winner, learnedTemplate: u.learnedTemplate };
}

export function parseTables(tables: SheetTable[], ctx: ParseContext, opts: TableOptions = {}): ParsedStatement {
  let best: ParsedStatement | null = null;
  for (const t of tables) {
    const st = parseOne(t, ctx, opts);
    if (st && st.rows.length > 0 && (!best || rank(st) > rank(best))) best = st;
  }
  if (!best) {
    throw new UnsupportedStatementError('No transactions could be read from this file.', [
      'The file needs a header row with a Date column and either Debit and Credit columns or an Amount column.',
      'Use "Teach VyayaMitra this format" to map the columns once.',
    ]);
  }
  return best;
}
