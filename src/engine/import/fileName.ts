import { institutionById } from '@/domain/institutions';
import type { ParsedStatement } from '@/domain/types';
import { formatMonth, monthKey } from '@/lib/dates';

const TYPE_LABEL: Record<string, string> = {
  savings: 'savings',
  current: 'current account',
  credit_card: 'card',
  wallet: 'wallet',
  loan: 'loan',
  investment: 'investment',
  cash: 'cash',
};

/**
 * The file name VyayaMitra keeps for a statement. Banks often name statements after their own
 * password convention, and people save them that way, so a file name that contains the password
 * used to open it is replaced with a neutral one ("SBI Card card statement October 2026.pdf").
 * The original name is never stored, exported or backed up in that case.
 */
export function storedFileName(original: string, password: string | undefined, parsed: ParsedStatement): string {
  if (!password || password.length < 4) return original;
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact(original).includes(compact(password))) return original;
  const ext = /\.([a-z0-9]{2,5})$/i.exec(original)?.[1]?.toLowerCase() ?? 'pdf';
  const bank = institutionById(parsed.institution).short;
  const type = TYPE_LABEL[parsed.accountType] ?? 'account';
  const end = parsed.periodEnd ?? parsed.rows.map((r) => r.date).sort().at(-1);
  const when = end ? ` ${formatMonth(monthKey(end))}` : '';
  return `${bank} ${type} statement${when}.${ext}`;
}
