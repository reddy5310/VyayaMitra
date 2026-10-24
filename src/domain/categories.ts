import type { CategoryGroup, CustomCategory, TxnKind } from './types';

export interface CategoryDef {
  id: string;
  name: string;
  group: CategoryGroup;
  /** lucide-react icon name. */
  icon: string;
  /** Index into the --chart-1..--chart-10 palette. */
  colorIndex: number;
}

export const UNCATEGORIZED = 'uncategorized';

export const BUILTIN_CATEGORIES: readonly CategoryDef[] = [
  // essentials
  { id: 'groceries', name: 'Groceries', group: 'essentials', icon: 'ShoppingBasket', colorIndex: 1 },
  { id: 'rent_housing', name: 'Rent & housing', group: 'essentials', icon: 'Home', colorIndex: 2 },
  { id: 'utilities', name: 'Bills & utilities', group: 'essentials', icon: 'Plug', colorIndex: 3 },
  { id: 'mobile_internet', name: 'Mobile & internet', group: 'essentials', icon: 'Wifi', colorIndex: 4 },
  { id: 'transport', name: 'Transport & fuel', group: 'essentials', icon: 'Car', colorIndex: 5 },
  { id: 'healthcare', name: 'Health & medical', group: 'essentials', icon: 'HeartPulse', colorIndex: 6 },
  { id: 'insurance', name: 'Insurance', group: 'essentials', icon: 'ShieldCheck', colorIndex: 7 },
  { id: 'education', name: 'Education', group: 'essentials', icon: 'GraduationCap', colorIndex: 8 },
  // lifestyle
  { id: 'food_dining', name: 'Food & dining', group: 'lifestyle', icon: 'UtensilsCrossed', colorIndex: 9 },
  { id: 'shopping', name: 'Shopping', group: 'lifestyle', icon: 'ShoppingBag', colorIndex: 10 },
  { id: 'entertainment', name: 'Entertainment', group: 'lifestyle', icon: 'Clapperboard', colorIndex: 1 },
  { id: 'subscriptions', name: 'Subscriptions', group: 'lifestyle', icon: 'Repeat', colorIndex: 2 },
  { id: 'travel', name: 'Travel & stays', group: 'lifestyle', icon: 'Plane', colorIndex: 3 },
  { id: 'personal_care', name: 'Personal care', group: 'lifestyle', icon: 'Sparkles', colorIndex: 4 },
  { id: 'fitness', name: 'Fitness & sports', group: 'lifestyle', icon: 'Dumbbell', colorIndex: 5 },
  { id: 'gifts_donations', name: 'Gifts & donations', group: 'lifestyle', icon: 'Gift', colorIndex: 6 },
  // people
  { id: 'sent_to_people', name: 'Sent to people', group: 'people', icon: 'Send', colorIndex: 7 },
  { id: 'family_support', name: 'Family support', group: 'people', icon: 'Users', colorIndex: 8 },
  // commitments
  { id: 'loan_emi', name: 'Loan EMIs', group: 'commitments', icon: 'Landmark', colorIndex: 9 },
  // fees & cash
  { id: 'fees_charges', name: 'Fees & charges', group: 'fees', icon: 'Receipt', colorIndex: 10 },
  { id: 'taxes', name: 'Taxes', group: 'fees', icon: 'FileText', colorIndex: 1 },
  { id: 'cash', name: 'Cash', group: 'cash', icon: 'Banknote', colorIndex: 2 },
  // income
  { id: 'salary', name: 'Salary', group: 'income', icon: 'BriefcaseBusiness', colorIndex: 3 },
  { id: 'interest_income', name: 'Interest', group: 'income', icon: 'Percent', colorIndex: 4 },
  { id: 'other_income', name: 'Other income', group: 'income', icon: 'Coins', colorIndex: 5 },
  { id: 'received_from_people', name: 'Received from people', group: 'people', icon: 'HandCoins', colorIndex: 6 },
  // saving
  { id: 'investments', name: 'Investments', group: 'saving', icon: 'TrendingUp', colorIndex: 7 },
  // transfer (neutral)
  { id: 'self_transfer', name: 'Between my accounts', group: 'transfer', icon: 'ArrowLeftRight', colorIndex: 8 },
  { id: 'card_payment', name: 'Card bill payment', group: 'transfer', icon: 'CreditCard', colorIndex: 9 },
  { id: 'loan_received', name: 'Loan received', group: 'transfer', icon: 'Landmark', colorIndex: 10 },
  { id: 'refunds', name: 'Refunds', group: 'other', icon: 'Undo2', colorIndex: 1 },
  { id: 'reversal', name: 'Reversal', group: 'transfer', icon: 'RotateCcw', colorIndex: 2 },
  // fallback
  { id: UNCATEGORIZED, name: 'Needs review', group: 'other', icon: 'CircleHelp', colorIndex: 3 },
];

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  essentials: 'Essentials',
  lifestyle: 'Lifestyle',
  people: 'People',
  commitments: 'Commitments',
  fees: 'Fees & taxes',
  cash: 'Cash',
  income: 'Income',
  saving: 'Saving & investing',
  transfer: 'Transfers',
  other: 'Other',
};

/** Default category implied by a kind when nothing more specific is known. */
export const KIND_DEFAULT_CATEGORY: Record<TxnKind, string> = {
  income: 'other_income',
  interest: 'interest_income',
  expense: UNCATEGORIZED,
  cash_withdrawal: 'cash',
  fee: 'fees_charges',
  refund: 'refunds',
  reversal: 'reversal',
  self_transfer: 'self_transfer',
  card_payment: 'card_payment',
  investment: 'investments',
  investment_return: 'investments',
  loan_payment: 'loan_emi',
  loan_disbursal: 'loan_received',
  p2p_out: 'sent_to_people',
  p2p_in: 'received_from_people',
  unknown: UNCATEGORIZED,
};

const BUILTIN_BY_ID = new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c]));

export function allCategories(custom: readonly CustomCategory[] = []): CategoryDef[] {
  return [
    ...BUILTIN_CATEGORIES,
    ...custom.map((c, i) => ({
      id: c.id,
      name: c.name,
      group: c.group,
      icon: c.icon ?? 'Tag',
      colorIndex: (i % 10) + 1,
    })),
  ];
}

export function categoryById(id: string, custom: readonly CustomCategory[] = []): CategoryDef {
  return (
    BUILTIN_BY_ID.get(id) ??
    allCategories(custom).find((c) => c.id === id) ?? {
      id,
      name: id,
      group: 'other',
      icon: 'Tag',
      colorIndex: 3,
    }
  );
}

export function categoryName(id: string, custom: readonly CustomCategory[] = []): string {
  return categoryById(id, custom).name;
}

/** Categories that represent consumption — the ones budgets can be set on. */
export const BUDGETABLE_GROUPS: ReadonlySet<CategoryGroup> = new Set<CategoryGroup>([
  'essentials',
  'lifestyle',
  'people',
  'commitments',
  'fees',
  'cash',
]);
