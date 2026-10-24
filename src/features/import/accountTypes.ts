import type { AccountType } from '@/domain/types';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  savings: 'Savings account',
  current: 'Current account',
  credit_card: 'Credit card',
  wallet: 'Wallet',
  loan: 'Loan',
  investment: 'Investment',
  cash: 'Cash',
};
