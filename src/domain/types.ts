/**
 * VyayaMitra domain model — the single source of truth shared by every module.
 *
 * Money is ALWAYS integer paise (1 INR = 100 paise). Never store or sum floats.
 * Dates are ALWAYS calendar dates 'YYYY-MM-DD' (IsoDate). Never convert through
 * Date#toISOString(), which shifts dates across the UTC boundary in India.
 */

/** Calendar date 'YYYY-MM-DD' with no time or zone. */
export type IsoDate = string;
/** Calendar month 'YYYY-MM'. */
export type MonthKey = string;
/** Integer minor units (paise). Always a safe integer. */
export type Paise = number;
/** ISO-8601 timestamp, used only for audit fields (createdAt etc.). */
export type Timestamp = string;

// ─── Accounts ────────────────────────────────────────────────────────────────

/**
 * Institution id. Open-ended: well-known ids live in src/domain/institutions.ts ('HDFC', 'SBI', 'ICICI',
 * 'DBS', 'SBI_CARD', 'AMEX', …); any other bank is 'OTHER' or the id of a learned template's institution.
 */
export type Institution = string;

export type AccountType =
  | 'savings'
  | 'current'
  | 'credit_card'
  | 'wallet'
  | 'loan'
  | 'investment'
  | 'cash';

export interface Account {
  id: string;
  /** User-facing label, e.g. "ICICI Savings ••7422". */
  name: string;
  institution: Institution;
  type: AccountType;
  /** Last 4 digits only. Never store full account or card numbers. */
  mask?: string;
  /** Extra masks belonging to this account (e.g. add-on credit cards). Last 4 digits only. */
  extraMasks?: string[];
  /** Holder name as printed on statements; used on-device for self-transfer detection. */
  holderName?: string;
  currency: 'INR';
  archived?: boolean;
  createdAt: Timestamp;
}

// ─── Transactions ────────────────────────────────────────────────────────────

/** Relative to the account: debit = money leaves the bank account / a charge on a card. */
export type Direction = 'debit' | 'credit';

/**
 * The economic meaning of a transaction. This drives every metric.
 * See src/domain/kinds.ts for how each kind maps to income/spending/invested/neutral.
 */
export type TxnKind =
  | 'income' // salary, business/freelance income, rent received
  | 'interest' // interest credited by a bank
  | 'expense' // purchase of goods/services (card or bank)
  | 'cash_withdrawal' // ATM / cash withdrawal
  | 'fee' // bank charges, card fees, interest or GST charged
  | 'refund' // money back for an earlier expense
  | 'reversal' // failed/auto-reversed txn (both legs neutral)
  | 'self_transfer' // between the user's own accounts (either leg)
  | 'card_payment' // credit-card bill payment (bank debit leg or card credit leg)
  | 'investment' // money into SIP/stocks/MF/FD/RD/PPF/NPS/brokers
  | 'investment_return' // redemption / withdrawal from investments
  | 'loan_payment' // EMI / loan repayment
  | 'loan_disbursal' // loan proceeds received
  | 'p2p_out' // sent to another person (not proven merchant or own account)
  | 'p2p_in' // received from another person
  | 'unknown';

export type Channel =
  | 'UPI'
  | 'IMPS'
  | 'NEFT'
  | 'RTGS'
  | 'ACH' // ACH / NACH / ECS mandates
  | 'CMS' // corporate cash-management credits (e.g. broker payouts)
  | 'CARD' // card purchase (credit or debit card, online or POS)
  | 'ATM'
  | 'BILLPAY' // bank bill-pay / BIL/ entries
  | 'INTERNAL' // within-bank transfer, sweep, FD booking
  | 'CHEQUE'
  | 'INTEREST'
  | 'CHARGE'
  | 'OTHER';

export type CounterpartyType =
  | 'merchant'
  | 'person'
  | 'own_account'
  | 'bank'
  | 'employer'
  | 'investment_platform'
  | 'lender'
  | 'government'
  | 'unknown';

export interface Counterparty {
  /** Cleaned display name, e.g. "Apollo Pharmacy". */
  name?: string;
  /** UPI VPA, lower-cased, e.g. "apollopharmacy@axl". */
  vpa?: string;
  /** Counterparty bank as printed, e.g. "HDFC Bank". */
  bank?: string;
  ifsc?: string;
  /** Last 4 digits of a counterparty account/card if printed. */
  accountMask?: string;
  type: CounterpartyType;
}

/** Where a category/kind decision came from — kept separate from confidence. */
export type CategorySource =
  | 'user_txn' // user set it for this transaction only
  | 'user_rule' // user's remembered rule (merchant/VPA/description)
  | 'builtin_rule' // VyayaMitra's built-in merchant/keyword knowledge
  | 'learned' // on-device model trained only on the user's own confirmed choices
  | 'kind_default' // implied by the kind (e.g. cash_withdrawal → Cash)
  | 'none'; // no decision → "Needs review"

export type KindSource = 'user' | 'user_rule' | 'rule' | 'match' | 'heuristic';

/** Exact provenance of a row inside its statement. */
export interface SourceRef {
  /** 1-based page number. */
  page: number;
  /** 0-based index of the first/last reconstructed line on that page. */
  lineStart: number;
  lineEnd: number;
  /** The raw reconstructed text lines that produced this row. */
  rawLines: string[];
}

export type LinkRole =
  | 'transfer_out'
  | 'transfer_in'
  | 'card_payment_out' // bank leg
  | 'card_payment_in' // card leg
  | 'refund_of' // this credit refunds linkedTxnId
  | 'refunded_by' // this debit was refunded by linkedTxnId
  | 'reversal';

export interface Transaction {
  id: string;
  accountId: string;
  statementId: string;
  date: IsoDate;
  valueDate?: IsoDate;
  /** Always > 0. Sign is carried by `direction`. */
  amount: Paise;
  direction: Direction;
  /** Running balance printed on the statement (bank accounts). May be negative (overdraft). */
  balanceAfter?: Paise;
  /** Description exactly as reconstructed from the statement (wrapped lines joined with ' '). */
  rawDescription: string;
  /** Bank reference / RRN / SerNo / UPI ref when printed. */
  reference?: string;
  /** For credit-card statements with add-on cards: last 4 of the card used. */
  cardMask?: string;
  /** Merchant category printed by the issuer itself (e.g. "Transportation Services"), when present. */
  bankCategory?: string;

  // understanding
  channel: Channel;
  counterparty: Counterparty;
  /** Display label for the merchant or counterparty. */
  merchant: string;
  /** Canonical lower-case key used for rules, grouping and recurrence. */
  merchantKey: string;
  kind: TxnKind;
  kindSource: KindSource;
  /** Category id (see src/domain/categories.ts). 'uncategorized' when unknown. */
  category: string;
  categorySource: CategorySource;
  /** 0..1 confidence of the kind+category decision. Independent of categorySource. */
  confidence: number;
  /** Human-readable reasons for the decision, e.g. "UPI payment to a merchant QR". */
  reasons: string[];
  needsReview: boolean;
  reviewReasons: string[];

  // relationships
  /** Shared id between the two legs of a linked pair. */
  linkId?: string;
  linkRole?: LinkRole;
  linkedTxnId?: string;

  /** Stable identity used for de-duplication (see src/engine/import). */
  fingerprint: string;
  source: SourceRef;
  note?: string;
  /** User's label for a large or unusual expense: it stays in totals but stops raising generic alerts. */
  tag?: ExpenseTag;
  /** Structured meaning of a fee row (understanding output); undefined for non-fee rows. */
  chargeType?: ChargeType;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** planned = expected (holiday, annual fee); exceptional = one-off (medical); reimbursable = money expected back. */
export type ExpenseTag = 'planned' | 'exceptional' | 'reimbursable';

// ─── Statements / import batches ─────────────────────────────────────────────

export interface ReconciliationCheck {
  label: string;
  ok: boolean;
  expected?: Paise;
  actual?: Paise;
  detail?: string;
}

export interface Reconciliation {
  /**
   * balanced   — every verifiable check passed (running balances and/or printed totals)
   * mismatch   — at least one check failed; rows involved are flagged for review
   * unverified — statement prints nothing we can check against (rows still imported, clearly labelled)
   */
  status: 'balanced' | 'mismatch' | 'unverified';
  checks: ReconciliationCheck[];
  /** Rows where previous balance ± amount ≠ printed balance. */
  rowBalanceBreaks: number;
}

export interface Statement {
  id: string;
  accountId: string;
  fileName: string;
  /** SHA-256 hex of the original file bytes; identifies re-imports of the same file. */
  fileHash: string;
  parserId: string;
  parserVersion: number;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  openingBalance?: Paise;
  closingBalance?: Paise;
  totals: { debits: Paise; credits: Paise; debitCount: number; creditCount: number };
  reconciliation: Reconciliation;
  warnings: string[];
  rowCount: number;
  importedAt: Timestamp;
  /** Credit-card statement summary (due date, total due…), when printed. */
  cardSummary?: CardSummary;
  /** Template that parsed this statement, if any (see StatementTemplate). */
  templateId?: string;
}

/** Figures printed on a credit-card statement's summary block. */
export interface CardSummary {
  statementDate?: IsoDate;
  dueDate?: IsoDate;
  totalDue?: Paise;
  minimumDue?: Paise;
  previousBalance?: Paise;
  creditLimit?: Paise;
  availableCredit?: Paise;
}

// ─── Parsing output (src/parsing) ────────────────────────────────────────────

export type RowWarning =
  | 'balance_break' // running balance does not reconcile at this row
  | 'direction_from_balance' // debit/credit decided by balance movement, not column
  | 'ambiguous_amount' // more than one candidate amount
  | 'date_out_of_period' // row date outside the printed statement period
  | 'description_merged'; // description lines were attributed heuristically

export interface ParsedRow {
  date: IsoDate;
  valueDate?: IsoDate;
  amount: Paise;
  direction: Direction;
  balanceAfter?: Paise;
  description: string;
  reference?: string;
  cardMask?: string;
  /** Merchant category printed by the issuer (MCC text such as "Grocery Stores"), kept out of description. */
  bankCategory?: string;
  /** Original foreign-currency amount for international card transactions, e.g. { amount: 2500, currency: 'USD' } (minor units). */
  foreign?: { amount: number; currency: string };
  source: SourceRef;
  warnings: RowWarning[];
}

export interface SkippedLine {
  page: number;
  line: number;
  text: string;
  reason: string;
}

export interface ParsedStatement {
  parserId: string;
  parserVersion: number;
  institution: Institution;
  accountType: AccountType;
  /** Last 4 digits of the account / primary card. */
  accountMask?: string;
  /** Last 4 of every card seen (credit-card statements with add-on cards). */
  cardMasks?: string[];
  holderName?: string;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  openingBalance?: Paise;
  closingBalance?: Paise;
  /** Totals printed on the statement, when present. */
  printedTotals?: { debits?: Paise; credits?: Paise; totalDue?: Paise; previousBalance?: Paise };
  rows: ParsedRow[];
  /** Lines that looked transactional (had a date and an amount) but were not turned into rows. */
  skipped: SkippedLine[];
  warnings: string[];
  reconciliation: Reconciliation;
  detection: { confidence: number; reasons: string[] };
  cardSummary?: CardSummary;
  /** Which template produced the rows: a stored one (by id) or the universal engine's own inference. */
  template?: { id?: string; source: 'builtin' | 'inferred' | TemplateSource };
  /**
   * The layout the universal engine inferred, as a reusable template draft. The ledger stores it
   * (source 'auto') when the import reconciles, so the next statement in this format is recognised
   * instantly. Never contains personal data — only header labels, markers and column geometry.
   */
  learnedTemplate?: TemplateDraft;
}

// ─── Self-training: statement templates ──────────────────────────────────────

/** What a column of a statement table means. */
export type ColumnRole =
  | 'date'
  | 'value_date'
  | 'description'
  | 'reference'
  | 'debit'
  | 'credit'
  | 'amount' // single signed amount, or unsigned with a Dr/Cr marker
  | 'drcr' // separate Dr/Cr indicator column
  | 'balance'
  | 'ignore';

export interface TemplateColumn {
  role: ColumnRole;
  /** Header text as printed (normalised lower-case), if the table has a header. */
  header?: string;
  /** PDF tables: horizontal extent in points (numbers are matched by right edge). */
  x0?: number;
  x1?: number;
  /** Spreadsheet/CSV tables: 0-based column index. */
  index?: number;
}

export type TemplateSource = 'auto' | 'user' | 'imported';

/**
 * A learned statement format. Created automatically from verified imports, or taught by the user
 * ("Teach VyayaMitra this format"), or imported from a shared file. Contains NO personal data.
 */
export interface StatementTemplate {
  id: string;
  name: string;
  institution: Institution;
  accountType: AccountType;
  fileKind: 'pdf' | 'sheet';
  /** How the format is recognised: lower-case marker phrases and header tokens, plus column count. */
  signature: { markers: string[]; headerTokens: string[]; columnCount: number };
  columns: TemplateColumn[];
  dateOrder?: 'DMY' | 'MDY' | 'YMD';
  /** Where wrapped description lines sit relative to the line that carries the date/amounts. */
  descriptionLayout?: 'single' | 'below' | 'above' | 'centered';
  amountStyle: 'split' | 'signed' | 'drcr_suffix' | 'drcr_column';
  source: TemplateSource;
  /** Imports with this template whose running balance / totals reconciled. */
  verifiedCount: number;
  useCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastUsedAt?: Timestamp;
}

export type TemplateDraft = Omit<StatementTemplate, 'id' | 'source' | 'verifiedCount' | 'useCount' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>;

// ─── Self-training: feedback ─────────────────────────────────────────────────

/** One user correction or confirmation, kept on-device to calibrate and retrain understanding. */
export interface FeedbackEvent {
  id: string;
  at: Timestamp;
  txnId: string;
  merchantKey: string;
  vpa?: string;
  action: 'category' | 'kind' | 'merchant' | 'confirm' | 'reset' | 'tag';
  scope: 'this' | 'merchant';
  /** The automatic decision before the user acted. */
  before: { kind: TxnKind; category: string; categorySource: CategorySource; kindSource: KindSource; confidence: number };
  after: { kind: TxnKind; category: string };
}

// ─── Rules & learning ────────────────────────────────────────────────────────

export interface UserRule {
  id: string;
  match: {
    field: 'merchantKey' | 'vpa' | 'description';
    op: 'equals' | 'contains';
    /** Compared case-insensitively. */
    value: string;
  };
  /** Restrict to one account; omitted = all accounts. */
  accountId?: string;
  /** Restrict to one direction; omitted = both. */
  direction?: Direction;
  /** merchantKey: merchant alias — matching rows are grouped under this key (combine inconsistent names). */
  set: { category?: string; kind?: TxnKind; merchant?: string; merchantKey?: string };
  createdFromTxnId?: string;
  enabled: boolean;
  createdAt: Timestamp;
}

/** User-defined category in addition to the built-in catalogue. */
export interface CustomCategory {
  id: string;
  name: string;
  group: CategoryGroup;
  icon?: string;
  color?: string;
  createdAt: Timestamp;
}

export type CategoryGroup =
  | 'essentials'
  | 'lifestyle'
  | 'people'
  | 'commitments'
  | 'fees'
  | 'cash'
  | 'income'
  | 'saving'
  | 'transfer'
  | 'other';

// ─── Planning ────────────────────────────────────────────────────────────────

export interface Budget {
  id: string;
  category: string;
  /** Positive paise per calendar month. */
  monthlyLimit: Paise;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SavingsGoal {
  id: string;
  name: string;
  /** Positive paise. */
  target: Paise;
  targetDate?: IsoDate;
  icon: string;
  color: string;
  archived: boolean;
  createdAt: Timestamp;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  date: IsoDate;
  /** Positive paise; `type` carries the sign. */
  amount: Paise;
  type: 'deposit' | 'withdrawal';
  /** Set when the contribution is backed by an imported transaction (verified allocation). */
  linkedTxnId?: string;
  note?: string;
  createdAt: Timestamp;
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringDecision {
  /** merchantKey of the recurring series. */
  merchantKey: string;
  status: 'confirmed' | 'dismissed';
  cadence?: Cadence;
  expectedAmount?: Paise;
  label?: string;
  updatedAt: Timestamp;
}

export type SavingActionType = 'category_limit' | 'review_recurring' | 'goal_contribution' | 'custom';

/** A saving action the user chose from an insight, tracked against later periods. */
export interface SavingAction {
  id: string;
  type: SavingActionType;
  title: string;
  category?: string;
  merchantKey?: string;
  goalId?: string;
  /** Monthly spend (or contribution) before the action, from complete months. */
  baselineMonthly: Paise;
  /** What the user aims for per month. */
  targetMonthly: Paise;
  startMonth: MonthKey;
  status: 'active' | 'completed' | 'dropped';
  insightId?: string;
  /** What the action covers, so overlapping actions are never double counted. */
  scope?: { categories?: string[]; merchantKeys?: string[] };
  /** Assumptions shown with the estimate ("replacement meals also cost money"). */
  assumptions?: string[];
  /** What the outcome measures — never summed across kinds. */
  outcomeKind?: 'purchase_reduction' | 'goal_contribution';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

export interface AppSettings {
  theme: ThemePreference;
  /** Show amounts blurred until tapped (privacy in public). */
  hideAmounts: boolean;
  /** p2p_out at or above this many paise are flagged for review. Default ₹5,000. */
  p2pReviewThreshold: Paise;
  onboardingDone: boolean;
}

// ─── Review workspace ────────────────────────────────────────────────────────

/** What the user said about an insight. `key` is stable across periods (type + subject, e.g. "category_change:food_dining"). */
export interface InsightFeedback {
  id: string;
  key: string;
  insightId: string;
  action: 'dismissed' | 'expected' | 'irrelevant';
  at: Timestamp;
}

/** The month-end review ritual for one calendar month. */
export interface MonthReview {
  month: MonthKey;
  status: 'in_progress' | 'completed';
  /** Plain notes the user wrote or accepted ("Holiday in Goa was planned"). */
  notes: string[];
  /** SavingAction ids chosen as next month's adjustments. */
  nextActionIds: string[];
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}

// ─── Money back (refund cases) ───────────────────────────────────────────────

/**
 * A purchase the user expects money back for (or an unmatched credit). Statements prove what was
 * received; what is EXPECTED usually comes from the user, so `expectedSource` says how it was set.
 */
export interface RefundCase {
  id: string;
  /** Purchases this case is about (one or more). Empty for an unmatched credit awaiting matching. */
  purchaseTxnIds: string[];
  merchant: string;
  merchantKey: string;
  /** Unknown → the UI shows "Amount to confirm", never a percentage. */
  expectedAmount?: Paise;
  expectedSource: 'user' | 'full_purchase' | 'unknown';
  reason?: string;
  promisedDate?: IsoDate;
  notes?: string;
  /** User intent; the received/outstanding state is always computed from allocations. */
  state: 'open' | 'closed';
  closedReason?: 'received' | 'written_off' | 'not_expected';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Part (or all) of a received credit allocated to a case / purchase. One credit can be split; never over-allocated. */
export interface RefundAllocation {
  id: string;
  caseId: string;
  creditTxnId: string;
  purchaseTxnId?: string;
  amount: Paise;
  source: 'auto' | 'user';
  reason: string;
  createdAt: Timestamp;
}

// ─── Fees & charges ──────────────────────────────────────────────────────────

export type ChargeType =
  | 'fuel_surcharge'
  | 'annual_fee'
  | 'joining_fee'
  | 'late_payment_fee'
  | 'finance_charge'
  | 'forex_markup'
  | 'atm_charge'
  | 'cash_advance_fee'
  | 'processing_fee'
  | 'convenience_fee'
  | 'overlimit_fee'
  | 'bank_charge'
  | 'other_fee';

/** One component of a charge event: the charge, its tax, and any reversal of either. */
export interface ChargeLink {
  id: string;
  /** Shared by all components of one charge event (e.g. surcharge + its GST + reversal). */
  groupId: string;
  txnId: string;
  chargeType: ChargeType;
  role: 'charge' | 'tax' | 'reversal' | 'tax_reversal';
  /** The purchase that triggered it (fuel purchase for a fuel surcharge), when evidence supports it. */
  relatedPurchaseTxnId?: string;
  source: 'auto' | 'user';
  reason: string;
}

/**
 * Card terms the USER records from their card's published terms (VyayaMitra never invents issuer rules).
 * Used only to say a charge "might qualify for reversal — check your terms".
 */
export interface CardPolicy {
  id: string;
  accountId: string;
  chargeType: ChargeType;
  /** Plain summary in the user's words, e.g. "1% fuel surcharge waived on ₹400–₹4,000, max ₹100 a cycle". */
  summary: string;
  waiverMinPurchase?: Paise;
  waiverMaxPurchase?: Paise;
  /** Max surcharge waived per statement cycle. */
  cycleCap?: Paise;
  /** Whether tax on the charge is also reversed (null = not stated). */
  taxReversed: boolean | null;
  effectiveFrom?: IsoDate;
  sourceNote?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Adviser preferences ─────────────────────────────────────────────────────

/** protected = never suggest cutting; essential = ask for context first; fixed = commitments; adjustable = fair game. */
export type CategoryPreference = 'protected' | 'essential' | 'fixed' | 'adjustable';

export interface AdviserPreference {
  category: string;
  preference: CategoryPreference;
  updatedAt: Timestamp;
}
