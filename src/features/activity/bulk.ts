import { setTransactionsCategory, setTransactionsKind } from '@/db/actions';
import type { TxnKind } from '@/domain/types';

/** Bulk "these selected transactions" corrections (no merchant rule is created). */
export async function setCategoryForSelected(ids: string[], category: string): Promise<void> {
  await setTransactionsCategory(ids, category);
}

export async function setKindForSelected(ids: string[], kind: TxnKind): Promise<void> {
  await setTransactionsKind(ids, kind);
}
