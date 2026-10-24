/**
 * CONTRACT — owned by the analytics module.
 * Pure functions over ledger arrays. Every screen filters through `applyQuery` so lists,
 * totals, charts and reports always agree.
 */
import type {
  Account,
  Budget,
  Cadence,
  CategoryGroup,
  CustomCategory,
  Direction,
  GoalContribution,
  IsoDate,
  MonthKey,
  Paise,
  RecurringDecision,
  SavingAction,
  SavingActionType,
  SavingsGoal,
  Statement,
  Transaction,
  TxnKind,
} from '@/domain/types';
import type { ChargeType, ExpenseTag, InsightFeedback, RefundCase } from '@/domain/types';
import type { MetricBucket } from '@/domain/kinds';

// ─── The one filter contract ─────────────────────────────────────────────────

export interface LedgerQuery {
  /** Inclusive calendar dates. Omitted = unbounded. */
  start?: IsoDate;
  end?: IsoDate;
  accountIds?: string[];
  categories?: string[];
  kinds?: TxnKind[];
  buckets?: MetricBucket[];
  direction?: Direction;
  /** Case-insensitive match on merchant, raw description, counterparty name/VPA, note, reference, amount ("1,250" or "1250"). */
  search?: string;
  needsReview?: boolean;
  /** Explicit id list (deep links from insight evidence). */
  ids?: string[];
  /** Inclusive amount bounds in paise. */
  minAmount?: Paise;
  maxAmount?: Paise;
  merchantKeys?: string[];
  statementIds?: string[];
  /**
   * spending = expense/cash_withdrawal/fee/loan_payment/unknown debits; income = income/interest;
   * transfer = self_transfer/card_payment/reversal/loan_disbursal; refund = refund;
   * saving = investment/investment_return; people = p2p_out/p2p_in.
   */
  kindGroup?: 'spending' | 'income' | 'transfer' | 'refund' | 'saving' | 'people';
}

// ─── Periods ─────────────────────────────────────────────────────────────────

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'last_12_months'
  | 'this_year'
  | 'all'
  | 'custom';

export interface Period {
  preset: PeriodPreset;
  start: IsoDate;
  end: IsoDate;
  /** e.g. "September 2025", "Jul – Sep 2025", "All time (Jun 2024 – Sep 2025)". */
  label: string;
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export interface AccountCoverage {
  accountId: string;
  /** Days inside [start,end] covered by an imported statement of this account. */
  coveredDays: number;
  totalDays: number;
  gaps: { start: IsoDate; end: IsoDate }[];
  complete: boolean;
}

export interface Coverage {
  start: IsoDate;
  end: IsoDate;
  /** Accounts expected in [start,end] (not archived, with a statement starting on or before `end`). */
  accounts: AccountCoverage[];
  /**
   * Every active, already-tracked account fully covered. An account is expected only from the start of
   * its earliest imported statement; gaps after that (between statements or after the latest) count.
   */
  complete: boolean;
  /** Whether income-bearing (savings/current) accounts are covered. Credit-card-only → 'none'. */
  incomeCoverage: 'full' | 'partial' | 'none';
  /** Plain-language note when incomplete, e.g. "ICICI Savings has no statement for 1–14 Oct". */
  notes: string[];
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface CategoryTotal {
  category: string;
  group: CategoryGroup;
  /** Net paise (spending categories: debits − refunds). */
  amount: Paise;
  count: number;
  /** Share of total spending, 0..1. */
  share: number;
}

export interface LedgerSummary {
  start: IsoDate;
  end: IsoDate;
  income: Paise;
  /**
   * Spending net of refunds: merchants, bills, cash, fees, EMIs and money sent to people that has been
   * classified (p2p_out in a real category such as rent_housing or family_support counts in full).
   * UNRESOLVED people flows (p2p_out still in 'sent_to_people', p2p_in still in 'received_from_people')
   * are NOT spending and not income: they are reported in `unresolved` until the user classifies them,
   * and are never netted against each other. A confirmed reimbursement (p2p_in or refund categorised
   * 'refunds') offsets only its expense. savingsRate is null when unresolved.out > 5% of income.
   */
  spending: Paise;
  refunds: Paise;
  /** Net saved & invested (investments − withdrawals). */
  invested: Paise;
  /** income − spending. */
  netSavings: Paise;
  /**
   * netSavings / income × 100, or null when suppressed: income coverage not 'full', income under
   * max(₹1,000, 5% of spending), or |rate| > 100 with income under a quarter of the money arriving.
   */
  savingsRate: number | null;
  /** Why savingsRate is null, e.g. "Only a credit-card statement is imported for this period." */
  savingsRateNote?: string;
  /**
   * Consumption spending: spending bucket total excluding ALL people flows (p2p_out), i.e. merchants,
   * bills, cash, fees and EMIs. Show "Spending" next to "Sent to people" and `unresolved`.
   */
  consumption?: Paise;
  peopleIn: Paise;
  /** Gross p2p_out (all of it), for display. Only part of it is in `spending`, see the people netting rule. */
  peopleOut: Paise;
  /** (Fields below are always set by `summarize`.) Unclassified out: p2p_out still in the default 'sent_to_people' category. */
  peopleUnclassifiedOut?: Paise;
  /** Unclassified in: p2p_in still in the default 'received_from_people' category. */
  peopleUnclassifiedIn?: Paise;
  /** @deprecated No netting any more; always omitted. Use `unresolved`. */
  peopleNetOut?: Paise;
  /** Unclassified people flows: excluded from spending and income until classified. */
  unresolved?: { out: Paise; in: Paise; txnIds: string[] };
  neutral: { selfTransfers: Paise; cardPayments: Paise; reversals: Paise; loanReceived: Paise };
  /** Raw bank-account cash movement excluding transfers between own accounts. */
  cashFlow: { inflow: Paise; outflow: Paise; net: Paise };
  byCategory: CategoryTotal[];
  byGroup: { group: CategoryGroup; amount: Paise; share: number }[];
  counts: { total: number; needsReview: number; debits: number; credits: number };
  coverage: Coverage;
}

export interface SummaryContext {
  accounts: readonly Account[];
  statements: readonly Statement[];
  customCategories?: readonly CustomCategory[];
  start: IsoDate;
  end: IsoDate;
  /** Optional: caps the coverage window at today so future days of the current month are not reported as missing. */
  today?: IsoDate;
}

export interface MonthlyPoint {
  month: MonthKey;
  income: Paise;
  spending: Paise;
  invested: Paise;
  netSavings: Paise;
  /** Month fully covered by statements for all active accounts. */
  complete: boolean;
}

export interface MerchantStat {
  merchantKey: string;
  merchant: string;
  category: string;
  count: number;
  total: Paise;
  average: Paise;
  lastDate: IsoDate;
  txnIds: string[];
}

// ─── Recurring payments ──────────────────────────────────────────────────────

export interface RecurringSeries {
  merchantKey: string;
  merchant: string;
  category: string;
  cadence: Cadence;
  /** Median interval in days between consecutive payments. */
  intervalDays: number;
  typicalAmount: Paise;
  /** Monthly-equivalent cost (yearly ÷ 12 etc.). */
  monthlyCost: Paise;
  occurrences: number;
  lastDate: IsoDate;
  nextExpected: IsoDate;
  /** 0..1 — interval regularity × amount stability × occurrence count. */
  confidence: number;
  status: 'suggested' | 'confirmed' | 'dismissed';
  txnIds: string[];
  /** Is the latest expected payment overdue (missed or not yet imported)? */
  overdue: boolean;
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export interface BudgetStatus {
  budget: Budget;
  month: MonthKey;
  spent: Paise;
  remaining: Paise;
  /** spent / limit, 0..∞ */
  usage: number;
  /** Where spending "should" be by `today` if spread evenly (only for the current month). */
  expectedByToday?: Paise;
  state: 'ok' | 'watch' | 'over';
  /** Only when spent > limit: how far over, in paise and as a percentage of the limit. */
  overBy?: Paise;
  overPct?: number;
  /** Coverage of this month for accounts that carry this category. */
  coverageComplete: boolean;
  txnIds: string[];
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export interface GoalProgress {
  goal: SavingsGoal;
  saved: Paise;
  /** Portion of `saved` backed by imported transactions. */
  verified: Paise;
  remaining: Paise;
  /** 0..1 */
  progress: number;
  /** Needed per month to reach the target by targetDate (null if no date or already reached). */
  monthlyNeeded: Paise | null;
  /** Average monthly contribution over the last 3 months. */
  recentMonthlyPace: Paise;
  projectedCompletion?: IsoDate;
  onTrack: boolean | null;
  contributions: GoalContribution[];
}

// ─── Insights & saving actions ───────────────────────────────────────────────

export type InsightSeverity = 'positive' | 'info' | 'warning' | 'critical';

export interface Insight {
  /** Stable across renders for the same subject + period (used to link SavingAction.insightId). */
  id: string;
  /** Stable across periods: type + subject (e.g. "category_change:food_dining"). Used for dismiss/expected/irrelevant feedback. */
  key?: string;
  type:
    | 'category_change'
    | 'spending_change'
    | 'budget'
    | 'recurring'
    | 'large_transaction'
    | 'people_out'
    | 'needs_review'
    | 'coverage'
    | 'savings_rate'
    | 'action_outcome'
    | 'card_due'
    | 'learning';
  severity: InsightSeverity;
  title: string;
  /** What changed, in one or two plain sentences with real numbers. */
  body: string;
  /** `title` / `body` as structured parts (strings and `{ paise }`) so every rupee renders through <Money>. */
  titleParts?: InsightText;
  bodyParts?: InsightText;
  /** What supports it. */
  evidence: { txnIds: string[]; figures: { label: string; value: string; amount?: Paise }[] };
  /** The comparison basis, e.g. "Comparing 1–14 Sep with 1–14 Aug (equivalent days)". */
  basis?: string;
  /** What the user can do about it. */
  action?: {
    type: SavingActionType | 'review_transactions' | 'import_statement';
    label: string;
    category?: string;
    merchantKey?: string;
    /** Suggested monthly target for the action, in paise. */
    suggestedTarget?: Paise;
  };
  /** Estimated monthly saving opportunity (never shown as achieved). */
  estimatedMonthlySaving?: Paise;
}

export interface InsightInput {
  txns: readonly Transaction[];
  accounts: readonly Account[];
  statements: readonly Statement[];
  budgets: readonly Budget[];
  recurringDecisions: readonly RecurringDecision[];
  actions: readonly SavingAction[];
  /** User feedback; dismissed/expected insight ids are hidden, irrelevant keys never shown again. */
  feedback?: readonly InsightFeedback[];
  /** Period being viewed. */
  start: IsoDate;
  end: IsoDate;
  today: IsoDate;
}

export interface ActionOutcome {
  action: SavingAction;
  /** Months since startMonth that are fully covered. */
  monthsEvaluated: MonthKey[];
  /** Actual monthly average after the action. */
  actualMonthly: Paise | null;
  /** baseline − actual (positive = saved). Only from complete months; null until one exists. */
  achievedMonthlySaving: Paise | null;
  state: 'waiting_for_data' | 'on_track' | 'off_track' | 'achieved';
  txnIds: string[];
}

// ─── Implementations ─────────────────────────────────────────────────────────

export { applyQuery } from './query';
export { resolvePeriod, defaultPeriod, dataRange } from './periods';
export { learningStats } from './learning';
export { upcomingCardDues } from './cardDues';
export { computeCoverage } from './coverage';
export { summarize, monthlySeries, dailySpending, merchantBreakdown } from './summary';
export { detectRecurring, isSeriesActive } from './recurring';
export { budgetStatuses, categoryBaselines } from './budgets';
export { goalProgress } from './goals';
export { generateInsights } from './insights';
export { evaluateSavingActions } from './actions';
export { dataStatus, spendingPlan, cumulativeSpending, compareSpending, spendingCalendar, merchantPareto, moneyFlow, coverageGrid, cardCycles } from './review';

// ─── Wave 2: learning metrics & card dues ────────────────────────────────────

export interface LearningStats {
  totalTransactions: number;
  /** Share decided automatically with confidence ≥ 0.6 and not needing review. */
  autoUnderstoodShare: number;
  needsReview: number;
  bySource: Record<string, number>;
  rules: number;
  templates: { total: number; auto: number; user: number; imported: number };
  corrections: number;
  /** Monthly share of automatic decisions the user did NOT have to change (null when no feedback that month). */
  accuracyTrend: { month: MonthKey; accuracy: number | null; corrections: number; decisions: number }[];
  /** Merchants the user taught that now auto-apply, with how many rows each fixed. */
  topTaught: { merchantKey: string; merchant: string; rows: number }[];
}

export interface CardDue {
  accountId: string;
  statementId: string;
  dueDate: IsoDate;
  totalDue: Paise;
  minimumDue?: Paise;
  /** Payments matched to this card after the statement date. */
  paidSoFar: Paise;
  status: 'paid' | 'partly_paid' | 'due' | 'overdue';
  daysLeft: number;
}

/** Latest statement per credit-card account with a printed due date. */

// ─── Wave 5: guided-review analytics (contracts) ─────────────────────────────

/** What the ledger can honestly support right now — drives an Overview that adapts to the evidence. */
export interface DataStatus {
  /** Latest date covered by any statement (the "data through" boundary). */
  dataThrough: IsoDate | null;
  accountCount: number;
  statementCount: number;
  needsReview: number;
  /** Rows whose AMOUNT/DIRECTION is uncertain (balance breaks, ambiguous amounts) — distinct from category uncertainty. */
  extractionIssues: number;
  evidence: 'none' | 'cards_only' | 'bank_only' | 'bank_and_card';
  /** Calendar months fully covered for every tracked account, oldest first. */
  completeMonths: MonthKey[];
  latestCompleteMonth: MonthKey | null;
}

/** The user's spending plan = sum of monthly budgets (null when there are none). */

export interface CumulativePoint {
  date: IsoDate;
  /** Cumulative recorded spending; null on days not covered by statements (never drawn as zero). */
  actual: Paise | null;
  /** Even-pace plan line for the day, when a plan exists. */
  plan?: Paise;
  /** Projection only after the last covered day, only when justified (see projectionNote). */
  projected?: Paise;
  covered: boolean;
}
export interface CumulativeSeries {
  points: CumulativePoint[];
  total: Paise;
  planTotal?: Paise;
  projectedTotal?: Paise;
  projectionNote?: string;
  dataThrough: IsoDate | null;
}

export interface WaterfallStep {
  key: string;
  label: string;
  category?: string;
  /** current − previous (positive = spent more). */
  delta: Paise;
  txnIdsCurrent: string[];
  txnIdsPrevious: string[];
}
export interface SpendingComparison {
  current: { start: IsoDate; end: IsoDate; label: string; total: Paise };
  previous: { start: IsoDate; end: IsoDate; label: string; total: Paise };
  /** Largest contributors first; the remainder is folded into `other`. */
  steps: WaterfallStep[];
  other: Paise;
  /** e.g. "Comparing September with August (both fully covered)". */
  basis: string;
  /** false when either period is not fully covered — the UI must say so and not explain a "change". */
  comparable: boolean;
  note?: string;
}

export interface HeatDay {
  date: IsoDate;
  amount: Paise;
  count: number;
  /** false = no statement covers this day: render differently from a verified zero-spend day. */
  covered: boolean;
}

export interface ParetoRow extends MerchantStat {
  /** Share of total spending covered by this merchant and all ranked above it, 0..1. */
  cumulativeShare: number;
}

export interface FlowNode {
  id: string;
  label: string;
  kind: 'income' | 'people_in' | 'account' | 'spending_group' | 'saving' | 'people_out' | 'card' | 'unexplained';
}
export interface FlowLink {
  from: string;
  to: string;
  amount: Paise;
}
/**
 * 'spending'  — recorded inflows → accounts → spending groups / saving / people (card repayments never appear as spending);
 * 'transfers' — movements between the user's own accounts and card repayments only.
 */

export interface CoverageCell {
  accountId: string;
  month: MonthKey;
  state: 'full' | 'partial' | 'missing' | 'before_tracking';
  coveredDays: number;
  totalDays: number;
  statementIds: string[];
}

export interface CardCycle {
  statementId: string;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  statementDate?: IsoDate;
  dueDate?: IsoDate;
  totalDue?: Paise;
  minimumDue?: Paise;
  previousBalance?: Paise;
  purchases: Paise;
  refunds: Paise;
  fees: Paise;
  interest: Paise;
  payments: Paise;
  /** Bank-side debits linked to this card's payment credits after the statement date. */
  matchedRepayments: { txnId: string; amount: Paise; date: IsoDate; fromAccountId?: string }[];
  /** 'unknown' when no later statement or bank leg confirms payment. */
  paymentStatus: 'paid' | 'partly_paid' | 'unpaid' | 'unknown';
  txnIds: string[];
}
export type { MerchantChange, ChangeExplanation } from './explain';
import type { ChangeExplanation } from './explain';
export { explainChange } from './explain';
export type { ScenarioResult } from './scenario';
export { planScenario } from './scenario';

// ─── Wave 7: month-end review (contract) ─────────────────────────────────────

export interface MonthReviewData {
  month: MonthKey;
  /** Step 1–2: can this month be reviewed honestly? */
  readiness: {
    coverageComplete: boolean;
    /** Plain sentences, e.g. "No HDFC Savings statement covers 1–30 Sep 2026". */
    missing: string[];
    needsReview: number;
    extractionIssues: number;
  };
  /** Step 3: what changed vs the previous month (or equivalent days). null when no previous data. */
  changes: ChangeExplanation | null;
  /** Expenses the user tagged, kept in totals but not alarming. */
  tagged: { total: Paise; byTag: Partial<Record<ExpenseTag, Paise>>; txnIds: string[] };
  /** Insights the user marked as expected this month. */
  expectedInsightIds: string[];
  /** Step 4: did last month's chosen adjustments hold? */
  actions: ActionOutcome[];
  /** Plan status for the month (budgets). */
  budgets: BudgetStatus[];
  /** What is still uncertain, as sentences. */
  uncertain: string[];
  /** Step 5: candidate adjustments for next month (from insights, never more than 3). */
  suggestions: Insight[];
}

export { monthReviewData } from './monthReview';

// ─── Wave 8: money back, fees, adviser (contracts) ───────────────────────────

export interface MoneyBackCase {
  case: RefundCase;
  purchases: { txnId: string; date: IsoDate; amount: Paise; merchant: string }[];
  purchaseTotal: Paise;
  expected?: Paise;
  received: Paise;
  /** expected − received, only when expected is known. */
  outstanding?: Paise;
  status: 'expected' | 'partially_received' | 'received' | 'over_received' | 'closed' | 'amount_to_confirm';
  /** Days since the latest purchase (or promised date passed) while still open and outstanding. */
  ageDays: number;
  overdue: boolean;
  timeline: { date: IsoDate; kind: 'purchase' | 'credit' | 'promised' | 'note' | 'closed'; text: string; amount?: Paise; txnId?: string }[];
}

export interface MoneyBack {
  received: { creditTxnId: string; date: IsoDate; amount: Paise; allocated: Paise; unallocated: Paise; merchant: string; caseIds: string[] }[];
  cases: MoneyBackCase[];
  /** Credits that look like refunds but are not (fully) allocated. */
  needsMatching: { creditTxnId: string; date: IsoDate; amount: Paise; merchant: string; candidatePurchaseIds: string[] }[];
  totals: { receivedInPeriod: Paise; expectedOutstanding: Paise; openCases: number; amountToConfirm: number };
}

/** `view`: 'statement' = credits counted when posted; 'purchase' = credits reduce the purchase they belong to. */

export interface ChargeEvent {
  groupId: string;
  date: IsoDate;
  accountId: string;
  chargeType: ChargeType;
  charge: Paise;
  tax: Paise;
  reversed: Paise;
  /** charge + tax − reversed (what it actually cost). */
  net: Paise;
  relatedPurchaseTxnId?: string;
  txnIds: string[];
  status: 'reversed' | 'partly_reversed' | 'not_reversed';
  /** "might qualify for reversal under your recorded card terms" — only from a user-entered CardPolicy. */
  eligibility: { state: 'likely' | 'unlikely' | 'unknown'; note: string; policyId?: string };
  explanation: string;
}

export interface FeesSummary {
  events: ChargeEvent[];
  byMonth: { month: MonthKey; byType: Partial<Record<ChargeType, Paise>>; net: Paise }[];
  totals: { charged: Paise; tax: Paise; reversed: Paise; net: Paise };
  /** Charges that recur (same type in ≥ 2 of the last 3 months). */
  recurring: { chargeType: ChargeType; months: number; total: Paise }[];
}


export interface Recommendation {
  id: string;
  key: string;
  /** "Try two fewer delivery orders next month" */
  title: string;
  /** What happened, with structured amounts (render through <Money>). */
  happened: InsightText;
  evidence: { txnIds: string[]; basis: string };
  change: InsightText;
  /** Estimated monthly effect — a scenario, never "saved". */
  estimatedEffect?: Paise;
  assumptions: string[];
  /** How it will be checked: "Compare the next complete month with your target". */
  check: string;
  category?: string;
  merchantKey?: string;
  suggestedTarget?: Paise;
  /** Explainable ranking factors 0..1. */
  factors: { effect: number; evidence: number; urgency: number; effort: number };
  kind: 'reduce_frequency' | 'set_limit' | 'review_recurring' | 'chase_refund' | 'avoid_fee' | 'ask_context';
}

/** Text with structured amounts so "hide amounts" can mask them: render strings as-is, numbers via <Money>. */
export type InsightText = (string | { paise: Paise })[];


export interface ActionTotals {
  /** Kept separate on purpose — never summed into one "You saved". */
  purchaseReduction: { planned: Paise; observed: Paise | null; overlappingActionIds: string[][] };
  goalContributions: { planned: Paise; observed: Paise | null };
  refundsReceived: Paise;
  feesReversed: Paise;
  /** Plain explanation of how the figures were measured. */
  definition: string;
}

export { moneyBack } from './moneyBack';
export { feesSummary } from './fees';
export { recommendations, actionTotals } from './adviser';
export type { RecommendationContext } from './adviser';
