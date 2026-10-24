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
   * Consumption net of refunds: cash, fees, EMIs, merchants, plus people flows under the NETTING RULE.
   * People flows still in their default categories (p2p_out 'sent_to_people', p2p_in
   * 'received_from_people') are unclassified: only max(0, unclassifiedOut - unclassifiedIn) counts as
   * spending (`peopleNetOut`), and a net inflow is never income. A p2p_out the user or a rule moved to a
   * real spending category (family_support, rent_housing, food_dining...) counts in full; a p2p_in
   * made income by kind counts as income.
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
   * bills, cash, fees and EMIs. Show "Spending" next to "Sent to people" using `peopleNetOut`.
   */
  consumption?: Paise;
  peopleIn: Paise;
  /** Gross p2p_out (all of it), for display. Only part of it is in `spending`, see the people netting rule. */
  peopleOut: Paise;
  /** (Fields below are always set by `summarize`.) Unclassified out: p2p_out still in the default 'sent_to_people' category. */
  peopleUnclassifiedOut?: Paise;
  /** Unclassified in: p2p_in still in the default 'received_from_people' category. */
  peopleUnclassifiedIn?: Paise;
  /** max(0, unclassifiedOut - unclassifiedIn): the part of people flows that counts toward `spending`. */
  peopleNetOut?: Paise;
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
  /** What supports it. */
  evidence: { txnIds: string[]; figures: { label: string; value: string }[] };
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
export { explainChange } from './explain';
export type { ScenarioResult } from './scenario';
export { planScenario } from './scenario';
