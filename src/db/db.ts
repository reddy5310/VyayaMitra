/**
 * The on-device ledger database (IndexedDB via Dexie).
 *
 * ── Schema versioning ────────────────────────────────────────────────────────
 * Dexie only needs the *indexed* properties in `stores()`; every other property is stored as-is.
 * To change the schema in a future release NEVER edit an existing `version(n)`. Append a new version that
 * repeats ONLY the tables that changed, and add an `.upgrade()` when existing rows must be rewritten:
 *
 *   this.version(3)
 *     .stores({ transactions: 'id, accountId, statementId, date, linkId, merchantKey, &[accountId+fingerprint], kind' })
 *     .upgrade(async (tx) => {
 *       await tx.table('transactions').toCollection().modify((t) => { t.someNewField ??= 'default'; });
 *     });
 *
 * Then bump DB_SCHEMA_VERSION (it is written into backups) and teach `migrateBackupData` in
 * backup.ts how to lift a version-(n-1) backup to version n. Upgrades run inside a single
 * versionchange transaction, so a failing upgrade leaves the previous version untouched.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Account,
  AdviserPreference,
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

/** Version of the stored/backup data layout. Bump together with a new Dexie `version(n)`. */
export const DB_SCHEMA_VERSION = 4;
export const APP_VERSION = '1.3.0';

/** Key/value store: `settings` (AppSettings) and `learnedModel` (opaque JSON from the understand module). */
export interface MetaRecord {
  key: string;
  value: unknown;
}

export const META_SETTINGS = 'settings';
export const META_LEARNED_MODEL = 'learnedModel';
/** Per-source accuracy derived from the feedback table (see engine/understand buildCalibration). */
export const META_CALIBRATION = 'calibration';
/** Migration log written by upgrade(): `{ version, at }[]`. */
export const META_MIGRATIONS = 'migrations';

export class VyayaMitraDB extends Dexie {
  accounts!: Table<Account, string>;
  statements!: Table<Statement, string>;
  transactions!: Table<Transaction, string>;
  rules!: Table<UserRule, string>;
  customCategories!: Table<CustomCategory, string>;
  budgets!: Table<Budget, string>;
  goals!: Table<SavingsGoal, string>;
  goalContributions!: Table<GoalContribution, string>;
  recurringDecisions!: Table<RecurringDecision, string>;
  savingActions!: Table<SavingAction, string>;
  templates!: Table<StatementTemplate, string>;
  feedback!: Table<FeedbackEvent, string>;
  insightFeedback!: Table<InsightFeedback, string>;
  monthReviews!: Table<MonthReview, string>;
  refundCases!: Table<RefundCase, string>;
  refundAllocations!: Table<RefundAllocation, string>;
  chargeLinks!: Table<ChargeLink, string>;
  cardPolicies!: Table<CardPolicy, string>;
  adviserPreferences!: Table<AdviserPreference, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name = 'vyayamitra') {
    super(name);
    this.version(1).stores({
      accounts: 'id',
      statements: 'id, accountId, fileHash',
      // The unique compound index is the last line of defence against duplicate rows:
      // inserting the same (account, fingerprint) twice aborts the whole transaction.
      transactions: 'id, accountId, statementId, date, linkId, merchantKey, &[accountId+fingerprint]',
      rules: 'id',
      customCategories: 'id',
      budgets: 'id, &category',
      goals: 'id',
      goalContributions: 'id, goalId',
      recurringDecisions: 'merchantKey',
      savingActions: 'id',
      meta: 'key',
    });
    // v2 — self-training: learned statement formats and the user's correction history.
    // Existing tables are untouched; Dexie carries all v1 rows across. The upgrade only records the
    // migration so support/debug tooling can see when a device crossed it.
    this.version(2)
      .stores({
        templates: 'id, [institution+fileKind], source',
        feedback: 'id, txnId, merchantKey, at',
      })
      .upgrade(async (tx) => {
        const meta = tx.table<MetaRecord, string>('meta');
        const log = ((await meta.get(META_MIGRATIONS))?.value as { version: number; at: string }[] | undefined) ?? [];
        await meta.put({ key: META_MIGRATIONS, value: [...log, { version: 2, at: new Date().toISOString() }] });
      });
    // v3 — review workspace: insight dismissals ("expected", "irrelevant") and month-end reviews.
    // Transaction.tag is a plain (unindexed) property, so existing rows need no rewrite.
    this.version(3)
      .stores({
        insightFeedback: 'id, key, insightId, at',
        monthReviews: 'month',
      })
      .upgrade(async (tx) => {
        const meta = tx.table<MetaRecord, string>('meta');
        const log = ((await meta.get(META_MIGRATIONS))?.value as { version: number; at: string }[] | undefined) ?? [];
        await meta.put({ key: META_MIGRATIONS, value: [...log, { version: 3, at: new Date().toISOString() }] });
      });
    // v4 — money back & charges: refund cases + allocations, charge links, card terms, adviser preferences.
    // Transaction.chargeType is a plain property (filled the next time a row is re-understood).
    this.version(4)
      .stores({
        refundCases: 'id, state, merchantKey',
        refundAllocations: 'id, caseId, creditTxnId, purchaseTxnId',
        chargeLinks: 'id, groupId, txnId',
        cardPolicies: 'id, accountId',
        adviserPreferences: 'category',
      })
      .upgrade(async (tx) => {
        const meta = tx.table<MetaRecord, string>('meta');
        const log = ((await meta.get(META_MIGRATIONS))?.value as { version: number; at: string }[] | undefined) ?? [];
        await meta.put({ key: META_MIGRATIONS, value: [...log, { version: 4, at: new Date().toISOString() }] });
      });
  }
}

export const PERSONAL_DB_NAME = 'vyayamitra';
/** Sample-data mode uses a completely separate database so personal data is never read, written or mixed. */
export const SAMPLE_DB_NAME = 'VyayaMitraDB-sample';
export const SAMPLE_FLAG = 'vm-sample';

export function readSampleFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(SAMPLE_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * The active database. It is a live binding: every module reads `db` at call time, so
 * `switchDatabase` (used only by sample mode, which reloads the app right after) re-points them all.
 */
export let db = new VyayaMitraDB(readSampleFlag() ? SAMPLE_DB_NAME : PERSONAL_DB_NAME);

type ResetPhase = 'before' | 'after';
const resetListeners = new Set<(phase: ResetPhase) => void>();

/**
 * Shared live stores (store.ts) register here so they can drop their subscriptions before the
 * database is closed or swapped, and re-subscribe afterwards.
 */
export function onDatabaseReset(listener: (phase: ResetPhase) => void): void {
  resetListeners.add(listener);
}

function notifyReset(phase: ResetPhase): void {
  for (const l of resetListeners) l(phase);
}

/** Close the active database (data stays on disk) and make `name` the active one. */
export function switchDatabase(name: string): VyayaMitraDB {
  if (db.name !== name) {
    notifyReset('before');
    db.close();
    db = new VyayaMitraDB(name);
    notifyReset('after');
  }
  return db;
}

/** Run `fn` in ONE read-write transaction spanning every table. Any throw rolls everything back. */
export function writeAll<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.tables, fn);
}

/** Run `fn` in one read-only snapshot spanning every table. */
export function readAll<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('r', db.tables, fn);
}

/** Test helper: drop and recreate the database so each test starts empty. */
export async function resetDatabaseForTests(): Promise<void> {
  notifyReset('before');
  db.close();
  await db.delete();
  await db.open();
  notifyReset('after');
}
