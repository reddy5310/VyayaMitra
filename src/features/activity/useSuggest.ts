import { useCallback } from 'react';
import { useRules, useSettings } from '@/db/hooks';
import { useLearnedState } from '@/db/learning';
import type { Account, CustomCategory, Transaction } from '@/domain/types';
import { suggestCategories, type CategorySuggestion } from '@/engine/understand';

/**
 * Top category suggestions for one-tap answers, computed with the same rules, learned model and
 * calibration the importer uses.
 */
export function useSuggest(accounts: readonly Account[], customCategories: readonly CustomCategory[]) {
  const rules = useRules();
  const { p2pReviewThreshold } = useSettings();
  const learnedState = useLearnedState();
  return useCallback(
    (txn: Transaction): CategorySuggestion[] => {
      const account = accounts.find((a) => a.id === txn.accountId);
      if (!account) return [];
      return suggestCategories(
        txn,
        {
          account,
          ownAccounts: accounts,
          rules: rules ?? [],
          learned: learnedState?.learned ?? null,
          calibration: learnedState?.calibration ?? null,
          p2pReviewThreshold,
          customCategories,
        },
        3,
      );
    },
    [accounts, rules, learnedState, p2pReviewThreshold, customCategories],
  );
}
