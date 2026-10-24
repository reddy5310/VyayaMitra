/**
 * CONTRACT — owned by the ledger module.
 * Reactive reads backed by Dexie liveQuery. `undefined` means "still loading".
 * Components never hold their own copy of ledger data, so stale responses cannot overwrite newer ones.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import type {
  Account,
  AppSettings,
  Budget,
  CustomCategory,
  GoalContribution,
  RecurringDecision,
  SavingAction,
  SavingsGoal,
  Statement,
  Transaction,
  UserRule,
} from '@/domain/types';
import { META_SETTINGS, db } from './db';
import { createKeyedStores, createLiveStore } from './store';
import { DEFAULT_SETTINGS } from './settings';

export { DEFAULT_SETTINGS };

// One liveQuery per data set, shared by every subscriber (see store.ts).
const accountsStore = createLiveStore(() => db.accounts.toArray());
const statementsStore = createLiveStore(() => db.statements.toArray());
const customCategoriesStore = createLiveStore(() => db.customCategories.toArray());

export function useAccounts(): Account[] | undefined {
  return useSyncExternalStore(accountsStore.subscribe, accountsStore.getSnapshot);
}
export function useStatements(): Statement[] | undefined {
  return useSyncExternalStore(statementsStore.subscribe, statementsStore.getSnapshot);
}

/** Newest first: date desc, then later lines of a statement before earlier ones, then id (fully stable). */
export function compareTransactionsNewestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.statementId !== b.statementId) return a.statementId < b.statementId ? -1 : 1;
  if (a.source.page !== b.source.page) return b.source.page - a.source.page;
  if (a.source.lineStart !== b.source.lineStart) return b.source.lineStart - a.source.lineStart;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const transactionsStore = createLiveStore(async () => (await db.transactions.toArray()).sort(compareTransactionsNewestFirst));

/** All transactions, newest first (date desc, then statement order). Read and sorted once, shared by all callers. */
export function useTransactions(): Transaction[] | undefined {
  return useSyncExternalStore(transactionsStore.subscribe, transactionsStore.getSnapshot);
}

const rangeStores = createKeyedStores<Transaction[]>((key) => {
  const [start, end] = key.split('|');
  return async () => (await db.transactions.where('date').between(start, end, true, true).toArray()).sort(compareTransactionsNewestFirst);
});

/** Transactions dated from `start` to `end` inclusive (uses the date index), newest first. For screens that only show a period. */
export function useTransactionsInRange(start: string, end: string): Transaction[] | undefined {
  const store = useMemo(() => rangeStores(`${start}|${end}`), [start, end]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
/** `null` = not found; `undefined` = loading. */
export function useTransaction(id: string | undefined): Transaction | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.transactions.get(id)) ?? null) : null), [id]);
}
export function useRules(): UserRule[] | undefined {
  return useLiveQuery(() => db.rules.toArray(), []);
}
export function useCustomCategories(): CustomCategory[] | undefined {
  return useSyncExternalStore(customCategoriesStore.subscribe, customCategoriesStore.getSnapshot);
}
export function useBudgets(): Budget[] | undefined {
  return useLiveQuery(() => db.budgets.toArray(), []);
}
export function useGoals(): SavingsGoal[] | undefined {
  return useLiveQuery(() => db.goals.toArray(), []);
}
export function useGoalContributions(): GoalContribution[] | undefined {
  return useLiveQuery(() => db.goalContributions.toArray(), []);
}
export function useRecurringDecisions(): RecurringDecision[] | undefined {
  return useLiveQuery(() => db.recurringDecisions.toArray(), []);
}
export function useSavingActions(): SavingAction[] | undefined {
  return useLiveQuery(() => db.savingActions.toArray(), []);
}

/** Always defined (falls back to DEFAULT_SETTINGS while loading). */
export function useSettings(): AppSettings {
  const stored = useLiveQuery(async () => (await db.meta.get(META_SETTINGS))?.value as Partial<AppSettings> | undefined, []);
  return useMemo(() => ({ ...DEFAULT_SETTINGS, ...(stored ?? {}) }), [stored]);
}

export interface Ledger {
  ready: boolean;
  accounts: Account[];
  statements: Statement[];
  transactions: Transaction[];
  customCategories: CustomCategory[];
}

const EMPTY: never[] = [];

/** Convenience: the core ledger in one hook. Arrays are empty until `ready`. */
export function useLedger(): Ledger {
  const accounts = useAccounts();
  const statements = useStatements();
  const transactions = useTransactions();
  const customCategories = useCustomCategories();
  const ready = !!accounts && !!statements && !!transactions && !!customCategories;
  return useMemo(
    () => ({
      ready,
      accounts: accounts ?? EMPTY,
      statements: statements ?? EMPTY,
      transactions: transactions ?? EMPTY,
      customCategories: customCategories ?? EMPTY,
    }),
    [ready, accounts, statements, transactions, customCategories],
  );
}
