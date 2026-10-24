/**
 * The universal statement engine.
 *
 * One pipeline for every layout: pick the column interpretation (stored template, printed header,
 * or numbers-only inference), build rows, then let the statement verify itself - the running
 * balance chain for bank accounts, previous + charges - credits = total due for cards - and keep
 * the interpretation that reconciles best.
 */
import type {
  AccountType,
  CardSummary,
  Direction,
  Institution,
  IsoDate,
  Paise,
  ParsedRow,
  ParsedStatement,
  Reconciliation,
  StatementTemplate,
  TemplateDraft,
} from '@/domain/types';
import { addDays } from '@/lib/dates';
import { UnsupportedStatementError } from '../errors';
import { assembleStatement } from '../core/build';
import { findAccountMask, looksLikeHolder, stripTitle } from '../core/meta';
import { reconcile, type DraftRow } from '../core/reconcile';
import { collapse, readMoney } from '../core/text';
import type { LayoutDoc, LayoutLine } from '../pdf/types';
import { extractCardSummary } from './card';
import { inferDateOrder, parseDateTok, type DateOrder } from './dates';
import { cardMaskOf, findFurniture, profileDocument, type DocProfile } from './knowledge';
import { headerModelSet, headerlessModelSets, type ModelSet } from './models';
import { buildRows, SUMMARY_ROW, type BuildCtx, type BuildResult, type DescMode } from './rows';
import {
  documentSignature,
  makeDraft,
  matchTemplates,
  modelSetFromTemplate,
  type AmountStyle,
  type DescLayout,
} from './template';

export const UNIVERSAL_ID = 'universal';
export const UNIVERSAL_VERSION = 1;

export interface UniversalOptions {
  fileName: string;
  fileKind: 'pdf' | 'sheet';
  templates?: readonly StatementTemplate[];
  template?: StatementTemplate | TemplateDraft;
  /** Test hook: ignore printed headers so the headerless inference is exercised. */
  forceHeaderless?: boolean;
}

export interface Evaluated {
  set: ModelSet;
  build: BuildResult;
  rows: ParsedRow[];
  reconciliation: Reconciliation;
  ambiguousCount: number;
  score: number;
  order: DateOrder;
  mode: DescMode;
  nature: 'asset' | 'liability';
  opening?: Paise;
  closing?: Paise;
  printedTotals?: ParsedStatement['printedTotals'];
  cardSummary?: CardSummary;
  warnings: string[];
  reversed: boolean;
  amountStyle: AmountStyle;
}

// ── document-level pre-reading ────────────────────────────────────────────────

/** Vote for numeric day/month order over every whole-cell date in the document. */
function voteOrder(doc: LayoutDoc): { order: DateOrder; conclusive: boolean } {
  const texts: string[] = [];
  for (const p of doc.pages) {
    for (const l of p.lines) {
      for (const i of l.items) if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/]\d{1,2}$/.test(i.text.trim())) texts.push(i.text);
    }
  }
  const order = inferDateOrder(texts);
  let evidence = false;
  for (const t of texts) {
    const m = /^(\d{1,2})[-/.](\d{1,2})/.exec(t.trim());
    if (m && (Number(m[1]) > 12 || Number(m[2]) > 12)) evidence = true;
  }
  return { order, conclusive: evidence || order === 'YMD' || texts.length === 0 };
}

function latestYear(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/\b(20\d{2})\b/g)) {
    const y = Number(m[1]);
    if (best === null || y > best) best = y;
  }
  return best;
}

function holderOf(doc: LayoutDoc, text: string): string | undefined {
  const m = /(?:Account Name|Customer Name|Account Holder|Name of (?:the )?(?:Account )?Holder|Card ?[Mm]ember)\s*[:-]\s*([A-Za-z][A-Za-z .]{2,40})/.exec(text);
  if (m) return stripTitle(collapse(m[1]));
  // "ASHA VERMA   Credit Card Number": the holder is printed before the label on the same line
  for (const l of doc.pages[0]?.lines.slice(0, 40) ?? []) {
    const lab = /^(.*?)\s*Credit Card (?:Number|No\.?)\b/i.exec(l.text);
    const name = lab ? collapse(lab[1]).replace(/[^\p{L} .]/gu, '').trim() : '';
    if (name.length >= 3 && /\p{L}{2}/u.test(name) && !/statement|card|account/i.test(name)) return stripTitle(name);
  }
  for (const l of doc.pages[0]?.lines.slice(0, 40) ?? []) {
    const t = l.items[0]?.text ?? '';
    if (looksLikeHolder(t)) return stripTitle(t);
  }
  return undefined;
}

// ── evaluation of one interpretation ──────────────────────────────────────────

/** Wording that marks a card row as money coming back (a payment, refund, reversal…). */
const CREDIT_WORDS = /payment (received|thank|credited)|payments? ?- ?thank|thank you|received|refund|reversal|cashback|cash back|credit adjustment|waiver/i;

/** A subset of the amounts that adds up to exactly `target`, or null. Small, bounded search. */
function subsetSum(amounts: number[], target: number): Set<number> | null {
  if (target <= 0 || amounts.length === 0 || amounts.length > 40) return null;
  let reach = new Map<number, number[]>([[0, []]]);
  for (let i = 0; i < amounts.length; i++) {
    const next = new Map(reach);
    for (const [sum, picked] of reach) {
      const t = sum + amounts[i];
      if (t <= target && !next.has(t)) next.set(t, [...picked, i]);
    }
    reach = next;
    if (reach.size > 200_000) return null;
    const hit = reach.get(target);
    if (hit) return new Set(hit);
  }
  return null;
}

/**
 * Decide each row's direction. Variants 1 and 2 flip the sign conventions; variant 3 picks, among
 * rows that carry no marker at all, the ones that add up to the printed "Payments & Credits" total.
 */
function resolveDirections(b: BuildResult, nature: 'asset' | 'liability', variant: number, signed = false, creditTotal?: Paise): DraftRow[] {
  const anyNeg = signed || b.signals.some((s) => s?.negative);
  const flip = (d: Direction): Direction => (d === 'debit' ? 'credit' : 'debit');
  let chosen: Set<number> | null = null;
  if (variant === 3 && nature === 'liability' && creditTotal !== undefined) {
    const idx = b.rows.map((_, i) => i).filter((i) => b.signals[i] && !b.signals[i]?.negative && !b.signals[i]?.plus && !b.rows[i].direction);
    const found = subsetSum(idx.map((i) => b.rows[i].amount), creditTotal);
    if (found) chosen = new Set([...found].map((k) => idx[k]));
  }
  return b.rows.map((r, i) => {
    const s = b.signals[i];
    let direction = r.direction;
    if (!direction && s) {
      if (nature === 'liability') {
        if (s.negative || s.plus) direction = 'credit';
        else if (chosen) direction = chosen.has(i) ? 'credit' : 'debit';
        // with no CR / sign convention in the statement, the wording is the only hint
        else direction = !anyNeg && !b.usedIndicator && CREDIT_WORDS.test(r.description) ? 'credit' : 'debit';
      } else if (anyNeg) direction = s.negative ? 'debit' : 'credit';
    }
    // alternative conventions tried when a card summary does not reconcile
    if (direction && ((variant === 1 && s) || variant === 2)) direction = flip(direction);
    return { ...r, direction };
  });
}

function styleOf(set: ModelSet, b: BuildResult): AmountStyle {
  const roles = new Set(set.cols.map((c) => c.role));
  if (roles.has('debit') || roles.has('credit')) return 'split';
  if (roles.has('type')) return 'drcr_column';
  if (b.signals.some((s) => s !== null && s.negative) ) return 'signed';
  return b.usedIndicator ? 'drcr_suffix' : 'signed';
}

function scoreOf(ev: { rows: ParsedRow[]; reconciliation: Reconciliation; ambiguousCount: number; skipped: number }): number {
  const n = ev.rows.length;
  if (n === 0) return Number.NEGATIVE_INFINITY;
  const breaks = ev.reconciliation.rowBalanceBreaks;
  const failed = ev.reconciliation.checks.filter((c) => !c.ok && !c.label.startsWith('Running balance')).length;
  const flips = ev.rows.filter((r) => r.warnings.includes('direction_from_balance')).length;
  let s = n - 8 * breaks - 40 * failed - 0.6 * flips - 3 * ev.ambiguousCount - ev.skipped;
  if (ev.reconciliation.status === 'balanced') s += 200;
  return s;
}

function chronoInversions(rows: { date: IsoDate }[]): number {
  let n = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].date < rows[i - 1].date) n++;
  return n;
}

export interface EvalContext {
  doc: LayoutDoc;
  profile: DocProfile;
  fileKind: 'pdf' | 'sheet';
  order: DateOrder;
  end?: IsoDate;
  skipLines: Set<string>;
  summary: ReturnType<typeof extractCardSummary>;
  /** A taught template says amounts are signed (negative = money out). */
  signed?: boolean;
  /** Lines that carry both a date and an amount: what a reading ought to account for. */
  potential: number;
}

const REF_NO = /\s*-?\s*\bRef(?:erence)?\.?\s*(?:No\.?|Number)\s*[:.]?\s*([A-Z0-9]{6,})/i;
const BRACKET_CATEGORY = /\s*\[([^\]]{2,40})\]\s*$/;

/**
 * Keep only transactions: rows with no description (summary and total lines), summary rows, and rows
 * dated far outside the printed period (sample, schedule and offer tables) go to `skipped` with a
 * reason. Card rows also lose the issuer's "Ref No: …" and "[Category]" decorations to their own fields.
 */
function sanitize(b: BuildResult, ec: EvalContext, nature: 'asset' | 'liability'): BuildResult {
  const period = ec.profile.period;
  const near = (d: IsoDate) => !period || (d >= addDays(period.start, -45) && d <= addDays(period.end, 45));
  const usePeriod = !!period && b.rows.filter((r) => near(r.date)).length >= b.rows.length / 2;
  const skipped = [...b.skipped];
  const rows: DraftRow[] = [];
  const signals: BuildResult['signals'] = [];
  b.rows.forEach((r, i) => {
    let description = r.description;
    let reference = r.reference;
    let bankCategory = r.bankCategory;
    if (nature === 'liability') {
      const cat = BRACKET_CATEGORY.exec(description);
      if (cat) {
        bankCategory ??= cat[1].trim();
        description = description.replace(BRACKET_CATEGORY, '');
      }
      const ref = REF_NO.exec(description);
      if (ref) {
        reference ??= ref[1];
        description = description.replace(REF_NO, '');
      }
      description = description.replace(/\s+/g, ' ').replace(/[-\s]+$/, '').trim();
    }
    const bare = description.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    let reason: string | null = null;
    if (!bare && (nature === 'liability' || r.balanceAfter === undefined)) {
      reason = 'No description: this looks like a summary or total line, not a transaction';
    } else if (SUMMARY_ROW.test(bare)) reason = 'A summary line, not a transaction';
    else if (usePeriod && !near(r.date)) reason = 'Dated far outside the statement period (a sample, schedule or offer table)';
    if (reason) {
      skipped.push({ page: r.source.page, line: r.source.lineStart, text: r.source.rawLines.join(' '), reason });
      return;
    }
    rows.push({ ...r, description, reference, bankCategory });
    signals.push(b.signals[i]);
  });
  return { ...b, rows, signals, skipped };
}

function runOnce(ec: EvalContext, set: ModelSet, mode: BuildCtx['mode'], order: DateOrder): Evaluated {
  const ctx: BuildCtx = { order, end: ec.end, sheet: ec.fileKind === 'sheet', skipLines: ec.skipLines, mode };
  const raw = buildRows(ec.doc, set.modelFor, ctx);
  const nature: 'asset' | 'liability' = !raw.hasBalance && (ec.profile.cardLike || ec.profile.accountType === 'credit_card') ? 'liability' : 'asset';
  const build = sanitize(raw, ec, nature);
  const s = ec.summary;
  const periodStart = ec.profile.period?.start;
  const periodEnd = ec.profile.period?.end;
  const warnings: string[] = [];

  let best: { ev: ReturnType<typeof reconcile>; rows: DraftRow[]; totals: ParsedStatement['printedTotals'] } | null = null;
  const variants = nature === 'liability' ? [0, 3, 1, 2] : [0];
  for (const v of variants) {
    const drafts = resolveDirections(build, nature, v, ec.signed, s.payments);
    const totalsAll: ParsedStatement['printedTotals'] =
      nature === 'liability'
        ? {
            previousBalance: s.summary.previousBalance ?? build.opening,
            totalDue: s.summary.totalDue,
            debits: s.purchases !== undefined ? s.purchases + (s.cash ?? 0) + (s.extras ?? 0) : undefined,
            credits: s.payments,
          }
        : build.totals;
    const attempts: ParsedStatement['printedTotals'][] = nature === 'liability' ? [totalsAll, { previousBalance: totalsAll?.previousBalance, totalDue: totalsAll?.totalDue }] : [totalsAll];
    for (const t of attempts) {
      const ev = reconcile({
        rows: drafts,
        openingBalance: nature === 'asset' ? build.opening : undefined,
        closingBalance: nature === 'asset' ? build.closing : undefined,
        printedTotals: t,
        periodStart,
        periodEnd,
        nature,
      });
      if (!best || scoreOf({ ...ev, skipped: 0 }) > scoreOf({ ...best.ev, skipped: 0 })) best = { ev, rows: drafts, totals: t };
      if (ev.reconciliation.status === 'balanced') break;
    }
    if (best && best.ev.reconciliation.status === 'balanced') break;
  }
  const chosen = best!;
  let rows = chosen.ev.rows;
  let recon = chosen.ev.reconciliation;
  let ambiguous = chosen.ev.ambiguousCount;
  let reversed = false;

  // newest-first statements: the chain only holds when read bottom-up
  if (nature === 'asset' && build.hasBalance && rows.length >= 4 && recon.rowBalanceBreaks > rows.length * 0.3) {
    const rev = reconcile({
      rows: resolveDirections(build, nature, 0, ec.signed).reverse(),
      printedTotals: build.totals,
      periodStart,
      periodEnd,
      nature,
    });
    if (rev.reconciliation.rowBalanceBreaks < recon.rowBalanceBreaks * 0.5) {
      rows = rev.rows;
      recon = rev.reconciliation;
      ambiguous = rev.ambiguousCount;
      reversed = true;
      warnings.push('This statement lists the newest transactions first; rows were put in date order.');
    }
  }

  const skippedCount = build.skipped.length;
  const missing = Math.max(0, ec.potential - rows.length - 1);
  const score = scoreOf({ rows, reconciliation: recon, ambiguousCount: ambiguous, skipped: skippedCount }) - 25 * missing;
  return {
    set,
    build,
    rows,
    reconciliation: recon,
    ambiguousCount: ambiguous,
    score,
    order,
    mode: build.mode,
    nature,
    opening: reversed ? undefined : build.opening,
    closing: reversed ? undefined : build.closing,
    printedTotals: chosen.totals,
    cardSummary: nature === 'liability' ? { ...s.summary, ...(s.summary.statementDate || !periodEnd ? {} : { statementDate: periodEnd }) } : undefined,
    warnings,
    reversed,
    amountStyle: styleOf(set, build),
  };
}

/** Evaluate one column interpretation, trying the other description layouts when it does not balance. */
export function evaluateSet(
  ec: EvalContext,
  set: ModelSet,
  conclusive: boolean,
  force?: { order?: DateOrder; mode?: BuildCtx['mode'] },
): Evaluated {
  const order = force?.order ?? ec.order;
  if (force?.order || force?.mode) {
    // a taught format fixes these choices: no guessing
    return runOnce({ ...ec, signed: ec.signed }, set, force.mode ?? 'auto', order);
  }
  let best = runOnce(ec, set, 'auto', ec.order);
  if (best.reconciliation.status !== 'balanced' && best.build.mode !== 'single') {
    for (const m of ['below', 'above', 'centered'] as const) {
      if (m === best.build.mode) continue;
      const alt = runOnce(ec, set, m, ec.order);
      if (alt.score > best.score) best = alt;
    }
  }
  // Numeric dates with no value above 12: day-first is the Indian default, but let the data decide.
  if (!conclusive && ec.order === 'DMY' && best.rows.length > 1) {
    const alt = runOnce(ec, set, best.build.mode === 'single' ? 'auto' : best.build.mode, 'MDY');
    const penalty = (e: Evaluated) =>
      chronoInversions(e.rows) * 2 + e.rows.filter((r) => r.warnings.includes('date_out_of_period')).length * 5 + (e.rows.length === 0 ? 1e9 : 0);
    if (alt.rows.length > 0 && penalty(alt) < penalty(best)) best = alt;
  }
  return best;
}

// ── public entry ──────────────────────────────────────────────────────────────

export interface UniversalResult {
  statement: ParsedStatement;
  evaluated: Evaluated;
}

/** Lines with a date and an amount: the transactions (plus an opening-balance line) a reading must explain. */
function countPotential(doc: LayoutDoc, sheet: boolean): number {
  let n = 0;
  for (const p of doc.pages) {
    for (const l of p.lines) {
      const dated = l.items.some((i) => {
        const t = parseDateTok(i.text, 'DMY') ?? parseDateTok(i.text, 'MDY');
        return !!t && (t.y !== undefined || /[A-Za-z]/.test(i.text));
      });
      if (dated && l.items.some((i) => (sheet ? /^[-+(]?[\d,]+(\.\d+)?\)?(\s?(cr|dr))?$/i.test(i.text.trim()) && /\d/.test(i.text) : readMoney(i.text) !== null))) n++;
    }
  }
  return n;
}

function protectLine(l: LayoutLine): boolean {
  return l.items.some((i) => parseDateTok(i.text, 'DMY') !== null) && l.items.some((i) => readMoney(i.text) !== null);
}

/** Everything the engine reads from a document before it chooses an interpretation. */
export function prepare(doc: LayoutDoc, fileKind: 'pdf' | 'sheet'): { ec: EvalContext; conclusive: boolean } {
  const profile = profileDocument(doc);
  const { order, conclusive } = voteOrder(doc);
  const summary = extractCardSummary(doc, order, profile.period?.end);
  const fromYear = latestYear(profile.text);
  const end: IsoDate | undefined = profile.period?.end ?? summary.summary.statementDate ?? (fromYear ? `${fromYear}-12-31` : undefined);
  return {
    conclusive,
    ec: {
      doc,
      profile,
      fileKind,
      order,
      end,
      skipLines: findFurniture(doc, protectLine),
      summary,
      potential: countPotential(doc, fileKind === 'sheet'),
    },
  };
}

/** Interpretations read from the document itself (printed header, then numbers-only), best first. */
export function inferEvaluations(ec: EvalContext, conclusive: boolean, forceHeaderless = false): Evaluated[] {
  const out: Evaluated[] = [];
  if (!forceHeaderless) {
    const hs = headerModelSet(ec.doc);
    if (hs) {
      const ev = evaluateSet(ec, hs, conclusive);
      if (ev.rows.length > 0) out.push(ev);
    }
  }
  if (!out.some((e) => e.reconciliation.status === 'balanced')) {
    for (const set of headerlessModelSets(ec.doc, ec.order)) {
      const ev = evaluateSet(ec, set, conclusive);
      if (ev.rows.length > 0) out.push(ev);
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export function parseUniversal(doc: LayoutDoc, opts: UniversalOptions): ParsedStatement {
  const { ec, conclusive } = prepare(doc, opts.fileKind);
  const { profile } = ec;

  const evaluations: { ev: Evaluated; source: ParsedStatement['template'] }[] = [];

  // 1. a forced template (the "teach this format" flow)
  if (opts.template) {
    const set = modelSetFromTemplate(doc, opts.template);
    const ev = evaluateSet({ ...ec, signed: opts.template.amountStyle === 'signed' }, set, conclusive, templateForce(opts.template));
    if (ev.rows.length === 0) throw new UnsupportedStatementError('The chosen format did not produce any transactions from this file.', ['Check the column mapping and try again.']);
    return toStatement(ec, ev, opts, { id: 'id' in opts.template ? opts.template.id : undefined, source: 'source' in opts.template ? opts.template.source : 'user' });
  }

  // 2. stored templates whose signature fits
  let templateWinner: { ev: Evaluated; t: StatementTemplate } | null = null;
  if (opts.templates && opts.templates.length > 0) {
    const sig = documentSignature(doc, profile);
    for (const m of matchTemplates(opts.templates, sig, opts.fileKind).slice(0, 3)) {
      const ev = evaluateSet({ ...ec, signed: m.template.amountStyle === 'signed' }, modelSetFromTemplate(doc, m.template), conclusive, templateForce(m.template));
      if (ev.rows.length === 0) continue;
      if (!templateWinner || ev.score > templateWinner.ev.score) templateWinner = { ev, t: m.template };
      if (ev.reconciliation.status === 'balanced') break;
    }
    if (templateWinner && templateWinner.ev.reconciliation.status === 'balanced') {
      return toStatement(ec, templateWinner.ev, opts, { id: templateWinner.t.id, source: templateWinner.t.source });
    }
  }

  // 3. inference: printed header first, numbers-only when that is missing or does not reconcile
  for (const ev of inferEvaluations(ec, conclusive, opts.forceHeaderless)) evaluations.push({ ev, source: { source: 'inferred' } });
  if (templateWinner) evaluations.push({ ev: templateWinner.ev, source: { id: templateWinner.t.id, source: templateWinner.t.source } });
  if (evaluations.length === 0) {
    throw new UnsupportedStatementError('No transactions could be read from this file.', [
      'The file needs a table with a Date column and amounts. Use "Teach VyayaMitra this format" to map the columns once.',
    ]);
  }
  evaluations.sort((a, b) => b.ev.score - a.ev.score);
  const winner = evaluations[0];
  return toStatement(ec, winner.ev, opts, winner.source);
}

function templateForce(t: { dateOrder?: DateOrder; descriptionLayout?: DescLayout }): { order?: DateOrder; mode?: BuildCtx['mode'] } | undefined {
  const mode = t.descriptionLayout && t.descriptionLayout !== 'single' ? t.descriptionLayout : undefined;
  return t.dateOrder || mode ? { order: t.dateOrder, mode } : undefined;
}

function confidenceOf(ev: Evaluated): number {
  const r = ev.reconciliation;
  if (r.status === 'balanced') return ev.set.source === 'inferred' && ev.set.label !== 'header' ? 0.8 : 0.85;
  if (r.status === 'unverified') return 0.6;
  return 0.4;
}

function toStatement(ec: EvalContext, ev: Evaluated, opts: UniversalOptions, template: ParsedStatement['template']): ParsedStatement {
  const { profile } = ec;
  const b = ev.build;
  let cardMasks = b.cardMasks.length > 0 ? b.cardMasks : undefined;
  if (!cardMasks && ev.nature === 'liability') {
    // card number printed in the statement header, above the table
    const found: string[] = [];
    for (const l of ec.doc.pages.slice(0, 2).flatMap((p) => p.lines)) {
      const mask = cardMaskOf(l.text);
      if (mask && !found.includes(mask)) found.push(mask);
    }
    if (found.length > 0) cardMasks = found.slice(0, 6);
  }
  const accountType: AccountType =
    ev.nature === 'liability' ? 'credit_card' : profile.accountType === 'credit_card' ? 'savings' : profile.accountType;
  const warnings = [...ev.warnings];
  if (b.yearless > 0) warnings.push('Dates in this statement have no year; the year was taken from the statement period.');
  if (b.unresolvedYears > 0) warnings.push(`${b.unresolvedYears} dates had no year and the statement period is unknown, so those rows were skipped.`);
  if (ev.set.source === 'inferred' && ev.set.label !== 'header') warnings.push('There is no printed table header; columns were inferred from the numbers.');

  const st = assembleStatement(
    {
      parserId: UNIVERSAL_ID,
      parserVersion: UNIVERSAL_VERSION,
      institution: profile.institution,
      accountType,
      accountMask: ev.nature === 'liability' ? cardMasks?.[0] : findAccountMask(profile.text),
      cardMasks,
      holderName: holderOf(ec.doc, profile.text),
      periodStart: profile.period?.start,
      periodEnd: profile.period?.end ?? ev.cardSummary?.statementDate,
      openingBalance: ev.opening,
      closingBalance: ev.closing,
      printedTotals: ev.printedTotals,
      rows: [],
      skipped: b.skipped,
      warnings,
      detection: {
        confidence: confidenceOf(ev),
        reasons: [
          ev.set.source === 'template' ? 'Matched a stored statement format' : ev.set.label === 'header' ? 'Table header recognised' : ev.set.label,
          `${ev.rows.length} rows, ${ev.reconciliation.status}`,
        ],
      },
      nature: ev.nature,
    },
    {
      rows: ev.rows.map((r) => (r.cardMask || cardMasks?.length !== 1 ? r : { ...r, cardMask: cardMasks[0] })),
      ambiguousCount: ev.ambiguousCount,
      reconciliation: ev.reconciliation,
    },
  );
  if (ev.cardSummary) st.cardSummary = ev.cardSummary;
  st.template = template;
  if (template?.source === 'inferred') st.learnedTemplate = learnedDraft(ec, ev, opts, accountType, profile.institution);
  return st;
}

function learnedDraft(ec: EvalContext, ev: Evaluated, opts: UniversalOptions, accountType: AccountType, institution: Institution): TemplateDraft {
  const desc: DescLayout = ev.mode;
  return makeDraft({
    institution,
    accountType,
    fileKind: opts.fileKind,
    cols: ev.set.cols,
    signature: documentSignature(ec.doc, ec.profile, ev.set.cols),
    dateOrder: ev.order,
    descriptionLayout: desc,
    amountStyle: ev.amountStyle,
  });
}
