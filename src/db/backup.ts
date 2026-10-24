/**
 * CONTRACT — owned by the ledger module.
 * Versioned, validated backup files. With a passphrase the payload is AES-GCM encrypted
 * (key from PBKDF2-SHA-256, ≥ 310k iterations, random salt + IV). Restore validates with zod
 * before touching the database and applies everything in one transaction.
 *
 * Plain file:     { format, schemaVersion, appVersion, createdAt, data: { <tables>, settings } }
 * Encrypted file: { format, encrypted: true, schemaVersion, appVersion, createdAt,
 *                   kdf: { name:'PBKDF2', hash:'SHA-256', iterations, salt }, cipher: { name:'AES-GCM', iv },
 *                   payload }            // salt, iv, payload are base64; payload = AES-GCM(plain file JSON)
 * The learned model is derived data and is not backed up; it is retrained after a restore.
 */
import { z } from 'zod';
import type {
  Account,
  AdviserPreference,
  AppSettings,
  Budget,
  CardPolicy,
  ChargeLink,
  CustomCategory,
  FeedbackEvent,
  GoalContribution,
  InsightFeedback,
  MonthReview,
  RecurringDecision,
  RefundAllocation,
  RefundCase,
  SavingAction,
  SavingsGoal,
  Statement,
  StatementTemplate,
  Transaction,
  UserRule,
} from '@/domain/types';
import { todayIso } from '@/lib/dates';
import { APP_VERSION, DB_SCHEMA_VERSION, META_SETTINGS, db, readAll, writeAll } from './db';
import { rebuildCalibration, retrainLearnedModel } from './ledger';
import { draftSchema, signatureKey } from './templates';

export const BACKUP_FORMAT = 'vyayamitra-backup';
export const PBKDF2_ITERATIONS = 310_000;
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 10_000_000;
const AAD = new TextEncoder().encode(BACKUP_FORMAT);

export interface BackupSummary {
  encrypted: boolean;
  appVersion?: string;
  schemaVersion?: number;
  createdAt?: string;
  /** Only available for unencrypted backups or after decryption. */
  counts?: Record<string, number>;
}

export type BackupErrorCode =
  | 'invalid_file'
  | 'unsupported_version'
  | 'passphrase_required'
  | 'wrong_passphrase'
  | 'crypto_unavailable';

/** Every failure in this module: the message is safe to show to the user. Nothing was changed. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/** File name to offer for a download: vyayamitra-backup-YYYY-MM-DD.json */
export function backupFileName(date: string = todayIso()): string {
  return `vyayamitra-backup-${date}.json`;
}

// ─── schemas ─────────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paise = z.number().int().safe();
const posPaise = z.number().int().safe().positive();
const str = z.string();

const accountSchema: z.ZodType<Account> = z.object({
  id: str.min(1),
  name: str,
  institution: str.min(1),
  type: z.enum(['savings', 'current', 'credit_card', 'wallet', 'loan', 'investment', 'cash']),
  mask: str.optional(),
  extraMasks: z.array(str).optional(),
  holderName: str.optional(),
  currency: z.literal('INR'),
  archived: z.boolean().optional(),
  createdAt: str,
});

const reconciliationSchema = z.object({
  status: z.enum(['balanced', 'mismatch', 'unverified']),
  checks: z.array(
    z.object({
      label: str,
      ok: z.boolean(),
      expected: paise.optional(),
      actual: paise.optional(),
      detail: str.optional(),
    }),
  ),
  rowBalanceBreaks: z.number().int(),
});

const statementSchema: z.ZodType<Statement> = z.object({
  id: str.min(1),
  accountId: str.min(1),
  fileName: str,
  fileHash: str,
  parserId: str,
  parserVersion: z.number(),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
  openingBalance: paise.optional(),
  closingBalance: paise.optional(),
  totals: z.object({ debits: paise, credits: paise, debitCount: z.number().int(), creditCount: z.number().int() }),
  reconciliation: reconciliationSchema,
  warnings: z.array(str),
  rowCount: z.number().int(),
  importedAt: str,
  cardSummary: z
    .object({
      statementDate: isoDate.optional(),
      dueDate: isoDate.optional(),
      totalDue: paise.optional(),
      minimumDue: paise.optional(),
      previousBalance: paise.optional(),
      creditLimit: paise.optional(),
      availableCredit: paise.optional(),
    })
    .optional(),
  templateId: str.optional(),
});

const counterpartySchema = z.object({
  name: str.optional(),
  vpa: str.optional(),
  bank: str.optional(),
  ifsc: str.optional(),
  accountMask: str.optional(),
  type: z.enum([
    'merchant', 'person', 'own_account', 'bank', 'employer', 'investment_platform', 'lender', 'government', 'unknown',
  ]),
});

const KINDS = [
  'income', 'interest', 'expense', 'cash_withdrawal', 'fee', 'refund', 'reversal', 'self_transfer', 'card_payment',
  'investment', 'investment_return', 'loan_payment', 'loan_disbursal', 'p2p_out', 'p2p_in', 'unknown',
] as const;
const kindSchema = z.enum(KINDS);
const chargeTypeSchema = z.enum([
  'fuel_surcharge', 'annual_fee', 'joining_fee', 'late_payment_fee', 'finance_charge', 'forex_markup', 'atm_charge',
  'cash_advance_fee', 'processing_fee', 'convenience_fee', 'overlimit_fee', 'bank_charge', 'other_fee',
]);

const transactionSchema: z.ZodType<Transaction> = z.object({
  id: str.min(1),
  accountId: str.min(1),
  statementId: str.min(1),
  date: isoDate,
  valueDate: isoDate.optional(),
  amount: posPaise,
  direction: z.enum(['debit', 'credit']),
  balanceAfter: paise.optional(),
  rawDescription: str,
  reference: str.optional(),
  cardMask: str.optional(),
  bankCategory: str.optional(),
  channel: z.enum([
    'UPI', 'IMPS', 'NEFT', 'RTGS', 'ACH', 'CMS', 'CARD', 'ATM', 'BILLPAY', 'INTERNAL', 'CHEQUE', 'INTEREST', 'CHARGE', 'OTHER',
  ]),
  counterparty: counterpartySchema,
  merchant: str,
  merchantKey: str,
  kind: kindSchema,
  kindSource: z.enum(['user', 'user_rule', 'rule', 'match', 'heuristic']),
  category: str,
  categorySource: z.enum(['user_txn', 'user_rule', 'builtin_rule', 'learned', 'kind_default', 'none']),
  confidence: z.number().min(0).max(1),
  reasons: z.array(str),
  needsReview: z.boolean(),
  reviewReasons: z.array(str),
  linkId: str.optional(),
  linkRole: z
    .enum(['transfer_out', 'transfer_in', 'card_payment_out', 'card_payment_in', 'refund_of', 'refunded_by', 'reversal'])
    .optional(),
  linkedTxnId: str.optional(),
  fingerprint: str.min(1),
  source: z.object({
    page: z.number().int(),
    lineStart: z.number().int(),
    lineEnd: z.number().int(),
    rawLines: z.array(str),
  }),
  note: str.optional(),
  tag: z.enum(['planned', 'exceptional', 'reimbursable']).optional(),
  chargeType: chargeTypeSchema.optional(),
  createdAt: str,
  updatedAt: str,
});

const ruleSchema: z.ZodType<UserRule> = z.object({
  id: str.min(1),
  match: z.object({
    field: z.enum(['merchantKey', 'vpa', 'description']),
    op: z.enum(['equals', 'contains']),
    value: str,
  }),
  accountId: str.optional(),
  direction: z.enum(['debit', 'credit']).optional(),
  set: z.object({
    category: str.optional(),
    kind: kindSchema.optional(),
    merchant: str.optional(),
    merchantKey: str.optional(),
  }),
  createdFromTxnId: str.optional(),
  enabled: z.boolean(),
  createdAt: str,
});

const customCategorySchema: z.ZodType<CustomCategory> = z.object({
  id: str.min(1),
  name: str,
  group: z.enum(['essentials', 'lifestyle', 'people', 'commitments', 'fees', 'cash', 'income', 'saving', 'transfer', 'other']),
  icon: str.optional(),
  color: str.optional(),
  createdAt: str,
});

const budgetSchema: z.ZodType<Budget> = z.object({
  id: str.min(1),
  category: str.min(1),
  monthlyLimit: posPaise,
  createdAt: str,
  updatedAt: str,
});

const goalSchema: z.ZodType<SavingsGoal> = z.object({
  id: str.min(1),
  name: str,
  target: posPaise,
  targetDate: isoDate.optional(),
  icon: str,
  color: str,
  archived: z.boolean(),
  createdAt: str,
});

const contributionSchema: z.ZodType<GoalContribution> = z.object({
  id: str.min(1),
  goalId: str.min(1),
  date: isoDate,
  amount: posPaise,
  type: z.enum(['deposit', 'withdrawal']),
  linkedTxnId: str.optional(),
  note: str.optional(),
  createdAt: str,
});

const recurringSchema: z.ZodType<RecurringDecision> = z.object({
  merchantKey: str.min(1),
  status: z.enum(['confirmed', 'dismissed']),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  expectedAmount: posPaise.optional(),
  label: str.optional(),
  updatedAt: str,
});

const savingActionSchema: z.ZodType<SavingAction> = z.object({
  id: str.min(1),
  type: z.enum(['category_limit', 'review_recurring', 'goal_contribution', 'custom']),
  title: str,
  category: str.optional(),
  merchantKey: str.optional(),
  goalId: str.optional(),
  baselineMonthly: paise,
  targetMonthly: paise,
  startMonth: str,
  status: z.enum(['active', 'completed', 'dropped']),
  insightId: str.optional(),
  scope: z.object({ categories: z.array(str).optional(), merchantKeys: z.array(str).optional() }).optional(),
  assumptions: z.array(str).optional(),
  outcomeKind: z.enum(['purchase_reduction', 'goal_contribution']).optional(),
  createdAt: str,
  updatedAt: str,
});

const refundCaseSchema: z.ZodType<RefundCase> = z.object({
  id: str.min(1),
  purchaseTxnIds: z.array(str),
  merchant: str,
  merchantKey: str,
  expectedAmount: posPaise.optional(),
  expectedSource: z.enum(['user', 'full_purchase', 'unknown']),
  reason: str.optional(),
  promisedDate: isoDate.optional(),
  notes: str.optional(),
  state: z.enum(['open', 'closed']),
  closedReason: z.enum(['received', 'written_off', 'not_expected']).optional(),
  createdAt: str,
  updatedAt: str,
});

const refundAllocationSchema: z.ZodType<RefundAllocation> = z.object({
  id: str.min(1),
  caseId: str.min(1),
  creditTxnId: str.min(1),
  purchaseTxnId: str.optional(),
  amount: posPaise,
  source: z.enum(['auto', 'user']),
  reason: str,
  createdAt: str,
});

const chargeLinkSchema: z.ZodType<ChargeLink> = z.object({
  id: str.min(1),
  groupId: str.min(1),
  txnId: str.min(1),
  chargeType: chargeTypeSchema,
  role: z.enum(['charge', 'tax', 'reversal', 'tax_reversal']),
  relatedPurchaseTxnId: str.optional(),
  source: z.enum(['auto', 'user']),
  reason: str,
});

const cardPolicySchema: z.ZodType<CardPolicy> = z.object({
  id: str.min(1),
  accountId: str.min(1),
  chargeType: chargeTypeSchema,
  summary: str,
  waiverMinPurchase: posPaise.optional(),
  waiverMaxPurchase: posPaise.optional(),
  cycleCap: posPaise.optional(),
  taxReversed: z.boolean().nullable(),
  effectiveFrom: isoDate.optional(),
  sourceNote: str.optional(),
  createdAt: str,
  updatedAt: str,
});

const adviserPreferenceSchema: z.ZodType<AdviserPreference> = z.object({
  category: str.min(1),
  preference: z.enum(['protected', 'essential', 'fixed', 'adjustable']),
  updatedAt: str,
});

const templateSchema: z.ZodType<StatementTemplate> = draftSchema
  .extend({
    name: str,
    id: str.min(1),
    source: z.enum(['auto', 'user', 'imported']),
    verifiedCount: z.number().int().min(0),
    useCount: z.number().int().min(0),
    createdAt: str,
    updatedAt: str,
    lastUsedAt: str.optional(),
  })
  .transform((t) => t as StatementTemplate);

const kindBeforeSchema = z.object({
  kind: kindSchema,
  category: str,
  categorySource: z.enum(['user_txn', 'user_rule', 'builtin_rule', 'learned', 'kind_default', 'none']),
  kindSource: z.enum(['user', 'user_rule', 'rule', 'match', 'heuristic']),
  confidence: z.number(),
});

const feedbackSchema: z.ZodType<FeedbackEvent> = z.object({
  id: str.min(1),
  at: str,
  txnId: str,
  merchantKey: str,
  vpa: str.optional(),
  action: z.enum(['category', 'kind', 'merchant', 'confirm', 'reset', 'tag']),
  scope: z.enum(['this', 'merchant']),
  before: kindBeforeSchema,
  after: z.object({ kind: kindSchema, category: str }),
});

const insightFeedbackSchema: z.ZodType<InsightFeedback> = z.object({
  id: str.min(1),
  key: str.min(1),
  insightId: str,
  action: z.enum(['dismissed', 'expected', 'irrelevant']),
  at: str,
});

const monthReviewSchema: z.ZodType<MonthReview> = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  status: z.enum(['in_progress', 'completed']),
  notes: z.array(str),
  nextActionIds: z.array(str),
  completedAt: str.optional(),
  updatedAt: str,
});

const settingsSchema: z.ZodType<Partial<AppSettings>> = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  hideAmounts: z.boolean().optional(),
  p2pReviewThreshold: posPaise.optional(),
  onboardingDone: z.boolean().optional(),
});

const dataSchema = z.object({
  accounts: z.array(accountSchema),
  statements: z.array(statementSchema),
  transactions: z.array(transactionSchema),
  rules: z.array(ruleSchema),
  customCategories: z.array(customCategorySchema),
  budgets: z.array(budgetSchema),
  goals: z.array(goalSchema),
  goalContributions: z.array(contributionSchema),
  recurringDecisions: z.array(recurringSchema),
  savingActions: z.array(savingActionSchema),
  templates: z.array(templateSchema),
  feedback: z.array(feedbackSchema),
  insightFeedback: z.array(insightFeedbackSchema),
  monthReviews: z.array(monthReviewSchema),
  refundCases: z.array(refundCaseSchema),
  refundAllocations: z.array(refundAllocationSchema),
  chargeLinks: z.array(chargeLinkSchema),
  cardPolicies: z.array(cardPolicySchema),
  adviserPreferences: z.array(adviserPreferenceSchema),
  settings: settingsSchema.optional(),
});

const plainSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().positive(),
  appVersion: str,
  createdAt: str,
  data: dataSchema,
});

const encryptedSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  encrypted: z.literal(true),
  schemaVersion: z.number().int().positive().optional(),
  appVersion: str.optional(),
  createdAt: str.optional(),
  kdf: z.object({
    name: z.literal('PBKDF2'),
    hash: z.literal('SHA-256'),
    iterations: z.number().int().min(MIN_ACCEPTED_ITERATIONS).max(MAX_ACCEPTED_ITERATIONS),
    salt: str.min(1),
  }),
  cipher: z.object({ name: z.literal('AES-GCM'), iv: str.min(1) }),
  payload: str.min(1),
});

type BackupData = z.infer<typeof dataSchema>;
type PlainBackup = z.infer<typeof plainSchema>;

const TABLE_NAMES = [
  'accounts',
  'statements',
  'transactions',
  'rules',
  'customCategories',
  'budgets',
  'goals',
  'goalContributions',
  'recurringDecisions',
  'savingActions',
  'templates',
  'feedback',
  'insightFeedback',
  'monthReviews',
  'refundCases',
  'refundAllocations',
  'chargeLinks',
  'cardPolicies',
  'adviserPreferences',
] as const;

function countsOf(data: BackupData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of TABLE_NAMES) counts[name] = data[name].length;
  return counts;
}

// ─── base64 + crypto ─────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    throw new BackupError('invalid_file', 'This backup file is damaged (it could not be decoded).');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new BackupError('crypto_unavailable', 'Encryption is not available in this browser.');
  return s;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── reading a file ──────────────────────────────────────────────────────────

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue.path.length ? ` (${issue.path.slice(0, 4).join(' › ')})` : '';
  return `This file is not a valid VyayaMitra backup${where}. Nothing was changed.`;
}

async function readJson(file: Blob): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new BackupError('invalid_file', 'This file is not a VyayaMitra backup (it is not valid JSON). Nothing was changed.');
  }
}

function requireSupportedVersion(version: number | undefined): void {
  if (version !== undefined && version > DB_SCHEMA_VERSION) {
    throw new BackupError(
      'unsupported_version',
      'This backup was made by a newer version of VyayaMitra. Update the app, then try again. Nothing was changed.',
    );
  }
}

/**
 * Lift older backups to the current layout.
 *  v1 → v2: adds the self-training tables (templates, feedback), which v1 files do not have.
 *  v2 → v3: adds the review-workspace tables (insightFeedback, monthReviews).
 *  v3 → v4: adds the money-back tables (refundCases, refundAllocations, chargeLinks, cardPolicies, adviserPreferences).
 */
export function migrateBackupData(data: unknown, fromVersion: number): unknown {
  if (typeof data !== 'object' || data === null) return data;
  let out = { ...(data as Record<string, unknown>) };
  if (fromVersion < 2) out = { templates: [], feedback: [], ...out };
  if (fromVersion < 3) out = { insightFeedback: [], monthReviews: [], ...out };
  if (fromVersion < 4) {
    out = { refundCases: [], refundAllocations: [], chargeLinks: [], cardPolicies: [], adviserPreferences: [], ...out };
  }
  return out;
}

function validatePlain(raw: unknown): PlainBackup {
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    throw new BackupError('invalid_file', 'This file is not a VyayaMitra backup. Nothing was changed.');
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number') requireSupportedVersion(version);
  const migrated =
    typeof version === 'number' && version < DB_SCHEMA_VERSION
      ? { ...(raw as object), data: migrateBackupData((raw as { data?: unknown }).data, version), schemaVersion: DB_SCHEMA_VERSION }
      : raw;
  const parsed = plainSchema.safeParse(migrated);
  if (!parsed.success) throw new BackupError('invalid_file', describeIssue(parsed.error));
  checkIntegrity(parsed.data.data);
  return parsed.data;
}

/** The backup must be internally consistent, or restoring it could leave orphaned rows. */
function checkIntegrity(data: BackupData): void {
  const bad = (what: string): never => {
    throw new BackupError('invalid_file', `This backup is inconsistent (${what}). Nothing was changed.`);
  };
  const ids = (rows: { id: string }[], table: string): Set<string> => {
    const set = new Set(rows.map((r) => r.id));
    if (set.size !== rows.length) bad(`duplicate ${table}`);
    return set;
  };
  const accounts = ids(data.accounts, 'accounts');
  const statements = ids(data.statements, 'statements');
  ids(data.transactions, 'transactions');
  ids(data.rules, 'rules');
  ids(data.customCategories, 'categories');
  ids(data.budgets, 'budgets');
  const goals = ids(data.goals, 'goals');
  ids(data.goalContributions, 'contributions');
  ids(data.savingActions, 'saving actions');
  if (new Set(data.budgets.map((b) => b.category)).size !== data.budgets.length) bad('two budgets for one category');
  if (new Set(data.recurringDecisions.map((r) => r.merchantKey)).size !== data.recurringDecisions.length) bad('duplicate recurring decisions');
  for (const s of data.statements) if (!accounts.has(s.accountId)) bad('a statement without its account');
  const fps = new Set<string>();
  for (const t of data.transactions) {
    if (!accounts.has(t.accountId)) bad('a transaction without its account');
    if (!statements.has(t.statementId)) bad('a transaction without its statement');
    const key = `${t.accountId}\u0000${t.fingerprint}`;
    if (fps.has(key)) bad('duplicate transactions');
    fps.add(key);
  }
  for (const c of data.goalContributions) if (!goals.has(c.goalId)) bad('a contribution without its goal');
  const cases = ids(data.refundCases, 'refund cases');
  ids(data.refundAllocations, 'refund allocations');
  ids(data.chargeLinks, 'charge links');
  ids(data.cardPolicies, 'card policies');
  for (const a of data.refundAllocations) if (!cases.has(a.caseId)) bad('an allocation without its refund case');
  const credited = new Map<string, number>();
  const amountOf = new Map(data.transactions.map((t) => [t.id, t.amount]));
  for (const a of data.refundAllocations) {
    const total = (credited.get(a.creditTxnId) ?? 0) + a.amount;
    credited.set(a.creditTxnId, total);
    const credit = amountOf.get(a.creditTxnId);
    if (credit !== undefined && total > credit) bad('a credit allocated more than its amount');
  }
}

async function openBackup(file: Blob, passphrase: string | undefined): Promise<{ plain: PlainBackup }> {
  const raw = await readJson(file);
  if (typeof raw === 'object' && raw !== null && (raw as { encrypted?: unknown }).encrypted === true) {
    const env = encryptedSchema.safeParse(raw);
    if (!env.success) throw new BackupError('invalid_file', describeIssue(env.error));
    requireSupportedVersion(env.data.schemaVersion);
    if (!passphrase) {
      throw new BackupError('passphrase_required', 'This backup is encrypted. Enter its passphrase to open it.');
    }
    const key = await deriveKey(passphrase, fromBase64(env.data.kdf.salt), env.data.kdf.iterations);
    let text: string;
    try {
      const plainBytes = await subtle().decrypt(
        { name: 'AES-GCM', iv: fromBase64(env.data.cipher.iv), additionalData: AAD },
        key,
        fromBase64(env.data.payload),
      );
      text = new TextDecoder().decode(plainBytes);
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError(
        'wrong_passphrase',
        'That passphrase did not open this backup (or the file is damaged). Nothing was changed.',
      );
    }
    let inner: unknown;
    try {
      inner = JSON.parse(text);
    } catch {
      throw new BackupError('invalid_file', 'This backup is damaged. Nothing was changed.');
    }
    return { plain: validatePlain(inner) };
  }
  return { plain: validatePlain(raw) };
}

// ─── public API ──────────────────────────────────────────────────────────────

async function collect(): Promise<BackupData> {
  return readAll(async () => {
    const [accounts, statements, transactions, rules, customCategories, budgets, goals, goalContributions, recurringDecisions, savingActions, templates, feedback, insightFeedback, monthReviews, refundCases, refundAllocations, chargeLinks, cardPolicies, adviserPreferences, settings] =
      await Promise.all([
        db.accounts.toArray(),
        db.statements.toArray(),
        db.transactions.toArray(),
        db.rules.toArray(),
        db.customCategories.toArray(),
        db.budgets.toArray(),
        db.goals.toArray(),
        db.goalContributions.toArray(),
        db.recurringDecisions.toArray(),
        db.savingActions.toArray(),
        db.templates.toArray(),
        db.feedback.toArray(),
        db.insightFeedback.toArray(),
        db.monthReviews.toArray(),
        db.refundCases.toArray(),
        db.refundAllocations.toArray(),
        db.chargeLinks.toArray(),
        db.cardPolicies.toArray(),
        db.adviserPreferences.toArray(),
        db.meta.get(META_SETTINGS),
      ]);
    const data: BackupData = {
      accounts, statements, transactions, rules, customCategories, budgets, goals, goalContributions, recurringDecisions, savingActions, templates, feedback, insightFeedback, monthReviews, refundCases, refundAllocations, chargeLinks, cardPolicies, adviserPreferences,
    };
    if (settings?.value) data.settings = settingsSchema.parse(settings.value);
    return data;
  });
}

/** Returns a JSON Blob ready to download as vyayamitra-backup-YYYY-MM-DD.json. */
export async function exportBackup(opts: { passphrase?: string } = {}): Promise<Blob> {
  const header = {
    format: BACKUP_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
  };
  const plain = JSON.stringify({ ...header, data: await collect() });
  if (!opts.passphrase) return new Blob([plain], { type: 'application/json' });

  const s = subtle();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(opts.passphrase, salt, PBKDF2_ITERATIONS);
  const cipher = await s.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(plain));
  const envelope = {
    encrypted: true,
    ...header,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    payload: toBase64(new Uint8Array(cipher)),
  };
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

/** Describe a backup file without changing anything. Pass the passphrase to see counts of an encrypted one. */
export async function inspectBackup(file: Blob, opts: { passphrase?: string } = {}): Promise<BackupSummary> {
  const raw = await readJson(file);
  const encrypted = typeof raw === 'object' && raw !== null && (raw as { encrypted?: unknown }).encrypted === true;
  if (encrypted && !opts.passphrase) {
    const env = encryptedSchema.safeParse(raw);
    if (!env.success) throw new BackupError('invalid_file', describeIssue(env.error));
    requireSupportedVersion(env.data.schemaVersion);
    return {
      encrypted: true,
      appVersion: env.data.appVersion,
      schemaVersion: env.data.schemaVersion,
      createdAt: env.data.createdAt,
    };
  }
  const { plain } = await openBackup(file, opts.passphrase);
  return {
    encrypted,
    appVersion: plain.appVersion,
    schemaVersion: plain.schemaVersion,
    createdAt: plain.createdAt,
    counts: countsOf(plain.data),
  };
}

/**
 * replace — wipe this device's data and restore the backup
 * merge   — add records whose ids don't exist yet
 * @throws Error with a user-presentable message on wrong passphrase / invalid file. Never partially applies.
 */
export async function restoreBackup(
  file: Blob,
  opts: { passphrase?: string; mode: 'replace' | 'merge' },
): Promise<{ counts: Record<string, number> }> {
  if (opts.mode !== 'replace' && opts.mode !== 'merge') throw new BackupError('invalid_file', 'Choose replace or merge.');
  // Everything that can fail on the file itself happens here, before the database is touched.
  const { plain } = await openBackup(file, opts.passphrase);
  const data = plain.data;

  return writeAll(async () => {
    if (opts.mode === 'replace') {
      await Promise.all(db.tables.map((t) => t.clear()));
      await db.accounts.bulkAdd(data.accounts);
      await db.statements.bulkAdd(data.statements);
      await db.transactions.bulkAdd(data.transactions);
      await db.rules.bulkAdd(data.rules);
      await db.customCategories.bulkAdd(data.customCategories);
      await db.budgets.bulkAdd(data.budgets);
      await db.goals.bulkAdd(data.goals);
      await db.goalContributions.bulkAdd(data.goalContributions);
      await db.recurringDecisions.bulkAdd(data.recurringDecisions);
      await db.savingActions.bulkAdd(data.savingActions);
      await db.templates.bulkAdd(data.templates);
      await db.feedback.bulkAdd(data.feedback);
      await db.insightFeedback.bulkAdd(data.insightFeedback);
      await db.monthReviews.bulkAdd(data.monthReviews);
      await db.refundCases.bulkAdd(data.refundCases);
      await db.refundAllocations.bulkAdd(data.refundAllocations);
      await db.chargeLinks.bulkAdd(data.chargeLinks);
      await db.cardPolicies.bulkAdd(data.cardPolicies);
      await db.adviserPreferences.bulkAdd(data.adviserPreferences);
      if (data.settings) await db.meta.put({ key: META_SETTINGS, value: data.settings });
      await retrainLearnedModel();
      await rebuildCalibration();
      return { counts: countsOf(data) };
    }

    // merge: add only what this device does not have yet
    const counts: Record<string, number> = {};
    const addNew = async <T extends { id: string }>(
      name: string,
      table: { toCollection(): { primaryKeys(): Promise<unknown[]> }; bulkAdd(items: T[]): Promise<unknown> },
      rows: T[],
    ): Promise<void> => {
      const have = new Set((await table.toCollection().primaryKeys()) as string[]);
      const fresh = rows.filter((r) => !have.has(r.id));
      await table.bulkAdd(fresh);
      counts[name] = fresh.length;
    };
    await addNew('accounts', db.accounts, data.accounts);
    await addNew('statements', db.statements, data.statements);

    const haveFp = new Set(
      (await db.transactions.toArray()).map((t) => `${t.accountId}\u0000${t.fingerprint}`),
    );
    const haveTxn = new Set((await db.transactions.toCollection().primaryKeys()) as string[]);
    const freshTxns = data.transactions.filter(
      (t) => !haveTxn.has(t.id) && !haveFp.has(`${t.accountId}\u0000${t.fingerprint}`),
    );
    await db.transactions.bulkAdd(freshTxns);
    counts.transactions = freshTxns.length;

    await addNew('rules', db.rules, data.rules);
    await addNew('customCategories', db.customCategories, data.customCategories);

    const haveCategory = new Set((await db.budgets.toArray()).map((b) => b.category));
    const haveBudget = new Set((await db.budgets.toCollection().primaryKeys()) as string[]);
    const freshBudgets = data.budgets.filter((b) => !haveBudget.has(b.id) && !haveCategory.has(b.category));
    await db.budgets.bulkAdd(freshBudgets);
    counts.budgets = freshBudgets.length;

    await addNew('goals', db.goals, data.goals);
    await addNew('goalContributions', db.goalContributions, data.goalContributions);

    const haveKeys = new Set((await db.recurringDecisions.toCollection().primaryKeys()) as string[]);
    const freshDecisions = data.recurringDecisions.filter((r) => !haveKeys.has(r.merchantKey));
    await db.recurringDecisions.bulkAdd(freshDecisions);
    counts.recurringDecisions = freshDecisions.length;

    await addNew('savingActions', db.savingActions, data.savingActions);

    const haveTemplateIds = new Set((await db.templates.toCollection().primaryKeys()) as string[]);
    const haveSignatures = new Set((await db.templates.toArray()).map((t) => signatureKey(t)));
    const freshTemplates = data.templates.filter((t) => !haveTemplateIds.has(t.id) && !haveSignatures.has(signatureKey(t)));
    await db.templates.bulkAdd(freshTemplates);
    counts.templates = freshTemplates.length;
    await addNew('feedback', db.feedback, data.feedback);
    await addNew('insightFeedback', db.insightFeedback, data.insightFeedback);
    const haveMonths = new Set((await db.monthReviews.toCollection().primaryKeys()) as string[]);
    const freshMonths = data.monthReviews.filter((r) => !haveMonths.has(r.month));
    await db.monthReviews.bulkAdd(freshMonths);
    counts.monthReviews = freshMonths.length;
    await addNew('refundCases', db.refundCases, data.refundCases);
    await addNew('refundAllocations', db.refundAllocations, data.refundAllocations);
    await addNew('chargeLinks', db.chargeLinks, data.chargeLinks);
    await addNew('cardPolicies', db.cardPolicies, data.cardPolicies);
    const havePrefs = new Set((await db.adviserPreferences.toCollection().primaryKeys()) as string[]);
    const freshPrefs = data.adviserPreferences.filter((p) => !havePrefs.has(p.category));
    await db.adviserPreferences.bulkAdd(freshPrefs);
    counts.adviserPreferences = freshPrefs.length;
    if (data.settings && !(await db.meta.get(META_SETTINGS))) {
      await db.meta.put({ key: META_SETTINGS, value: data.settings });
    }
    await retrainLearnedModel();
    await rebuildCalibration();
    return { counts };
  });
}
