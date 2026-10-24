import type { HeaderCell, Role, TableHeader } from '../core/header';
import { layoutAmountColumns, type AmountLayout } from '../core/table';
import type { LayoutLine } from '../pdf/types';

/** One column of a statement table, as the engine sees it. */
export interface UCol {
  role: Role;
  x0: number;
  x1: number;
  /** Header text, normalised, when the table has a header. */
  header?: string;
  /** Sheet column index. */
  index?: number;
}

export interface PageModel {
  page: number;
  /** Lines with an index up to this one are header or preamble and never rows. */
  skipThrough: number;
  cols: UCol[];
  /** Positions of the money columns (debit / credit / amount / balance) on this page. */
  layout: AmountLayout;
  /** Expected right edges of foreign-currency columns (ignored in favour of the INR amount). */
  foreign: number[];
  /** Right limit of description text. */
  descHi: number;
}

export const MONEY_ROLES: Role[] = ['debit', 'credit', 'amount', 'balance'];

export function makePageModel(page: number, skipThrough: number, cols: UCol[], bodyLines: LayoutLine[]): PageModel {
  const sorted = [...cols].sort((a, b) => a.x0 - b.x0);
  const header: TableHeader = {
    page,
    lineIndex: skipThrough,
    lastLineIndex: skipThrough,
    y: 0,
    cells: sorted.map((c): HeaderCell => ({ role: c.role, x0: c.x0, x1: c.x1, text: c.header ?? '' })),
  };
  const layout = layoutAmountColumns(header, bodyLines);
  const foreign = sorted.filter((c) => c.role === 'foreign').map((c) => c.x1 + layout.offset);
  const moneyLeft = sorted.filter((c) => MONEY_ROLES.includes(c.role)).map((c) => c.x0);
  const descHi = moneyLeft.length > 0 ? Math.min(...moneyLeft) + 8 : Number.POSITIVE_INFINITY;
  return { page, skipThrough, cols: sorted, layout, foreign, descHi };
}

export function colOf(model: PageModel, role: Role): UCol | undefined {
  return model.cols.find((c) => c.role === role);
}

/** Does the model have everything a bank statement table needs? */
export function hasMoneyColumns(cols: UCol[]): boolean {
  const roles = new Set(cols.map((c) => c.role));
  return roles.has('amount') || roles.has('debit') || roles.has('credit');
}
